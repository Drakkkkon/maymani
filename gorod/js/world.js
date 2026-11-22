// «Мое_город» — хранилище миров (с 0.20.0; в куске карты с 0.21.0 ещё и срубленные деревья; с 0.22.0 в списке миров видно, есть ли в мире природа).
// Мир = мета (имя, размер, камера, бригады, машины, склад, счёт) + куски карты по 100×100 клеток.
// Локально всё лежит в IndexedDB «moe_gorod_worlds» (куски — отдельными записями: большая карта не грузится целиком).
// Если вы вошли в аккаунт (js/mm-account.js, Firebase-проект money99774, как на других моих сайтах), то мир ещё и лежит в облаке:
//   users/<uid>/apps/gorod_worlds/index/<мир>        — имя, размер, время правки, сводка (маленькая запись для списка миров)
//   users/<uid>/apps/gorod_worlds/meta/<мир>         — бригады, машины, склад, счёт, камера
//   users/<uid>/apps/gorod_worlds/chunks/<мир>/<cx>_<cz> — один кусок карты 100×100: здания, дороги, износ
// Правка с большим временем побеждает (по кускам). Облако читается по мере надобности: открыли мир — скачалась мета,
// подошли к краю — скачался нужный кусок. Всё, что вы сделали без интернета, уйдёт в облако при следующем входе.
(function () {
  'use strict';
  var WC = 100;                         // сторона куска карты, клеток
  var DB_NAME = 'moe_gorod_worlds', BASE = 'apps/gorod_worlds', FB_APP = 'mm-account';
  var PUSH_HARD = 2500, PUSH_MAX = 15000, PUSH_SOFT = 120000, TOMB_TTL = 180 * 86400000;

  // ---------- мелочи ----------
  var listeners = [];
  function noop(e) { if (e) console.warn('world: запись не удалась', e && (e.name || e.message || e)); }
  function emit(ev) { listeners.forEach(function (f) { try { f(ev); } catch (e) { console.warn('world: слушатель', e); } }); }
  var lastU = 0;
  function nextU() { var u = Date.now(); if (u <= lastU) u = lastU + 1; lastU = u; return u; }
  function ckey(id, cx, cz) { return id + '|' + cx + ',' + cz; }
  function tmo(p, ms, what) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Нет ответа от облака' + (what ? ' (' + what + ')' : ''))); }, ms); })]); }
  function newId() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function curUser() { try { return window.MMAccount ? window.MMAccount.user() : null; } catch (e) { return null; } }
  function fbdb() {
    try { if (!window.firebase) return null; var a = window.firebase.apps.filter(function (x) { return x.name === FB_APP; })[0]; return a ? a.database() : null; } catch (e) { return null; }
  }
  function cloudOn() { var u = curUser(); return !!(u && fbdb() && navigator.onLine !== false); }
  function root() { return fbdb().ref('users/' + curUser().uid + '/' + BASE); }
  function errText(e) {
    var m = String((e && e.message) || e);
    if (/permission/i.test(m)) return 'Нет доступа к облаку миров. Выйдите из аккаунта и войдите снова.';
    return 'Облако: ' + m;
  }

  // ---------- хранилище: IndexedDB (если недоступно — только в памяти на время сеанса) ----------
  var DB = null, memory = null;
  function idbReq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbDone(t) { return new Promise(function (res, rej) { t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error); }; }); }
  function store(name) {
    return {
      get: function (k) { return DB ? idbReq(DB.transaction(name).objectStore(name).get(k)) : Promise.resolve(memory[name].get(k)); },
      put: function (k, v) {
        if (!DB) { memory[name].set(k, v); return Promise.resolve(); }
        var t = DB.transaction(name, 'readwrite'), os = t.objectStore(name);
        if (name === 'worlds') os.put(v); else os.put(v, k);
        return idbDone(t);
      },
      del: function (k) {
        if (!DB) { memory[name].delete(k); return Promise.resolve(); }
        var t = DB.transaction(name, 'readwrite'); t.objectStore(name).delete(k); return idbDone(t);
      },
      all: function () { return DB ? idbReq(DB.transaction(name).objectStore(name).getAll()) : Promise.resolve(Array.from(memory[name].values())); },
      keys: function (prefix) {
        if (!DB) return Promise.resolve(Array.from(memory[name].keys()).filter(function (k) { return String(k).indexOf(prefix) === 0; }));
        return idbReq(DB.transaction(name).objectStore(name).getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')));
      }
    };
  }
  var S = { worlds: store('worlds'), chunks: store('chunks'), dirty: store('dirty') };
  function openDb() {
    return new Promise(function (res) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { res(null); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
        if (!d.objectStoreNames.contains('dirty')) d.createObjectStore('dirty');
      };
      req.onsuccess = function () { var d = req.result; d.onversionchange = function () { try { d.close(); } catch (e) {} DB = null; if (!memory) memory = mem(); }; res(d); };
      req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); res(null); };
      req.onblocked = function () { res(null); };
    });
  }
  function mem() { return { worlds: new Map(), chunks: new Map(), dirty: new Map() }; }

  var metas = {}, dirtyMap = {}, openId = '';
  var ready = openDb().then(function (d) {
    DB = d; if (!d) memory = mem();
    return Promise.all([S.worlds.all(), S.dirty.all(), DB ? idbReq(DB.transaction('dirty').objectStore('dirty').getAllKeys()) : Promise.resolve(Array.from(memory.dirty.keys()))]);
  }).then(function (r) {
    r[0].forEach(function (m) { metas[m.id] = m; if (m.u > lastU) lastU = m.u; });
    r[1].forEach(function (d, i) { dirtyMap[r[2][i]] = d; });
    return true;
  });

  // ---------- кодек куска карты ----------
  // Кусок: { v:1, b:[здания], r:[строки дорог 'a'/'d'/'c'/'.' по клеткам], w:[x, z, износ×10000, …], t:[номера срубленных деревьев] }; пустой кусок — null.
  // t (с 0.21.0): сами деревья не хранятся — их даёт «зерно» мира (js/terrain.js); в куске записаны только убранные (номер клетки внутри куска: z×100 + x).
  var RCH = { asphalt: 'a', dirt: 'd', cobble: 'c' }, RREV = { a: 'asphalt', d: 'dirt', c: 'cobble' };
  function rect(cx, cz, size) { var x0 = cx * WC, z0 = cz * WC; return { x0: x0, z0: z0, x1: Math.min(size, x0 + WC), z1: Math.min(size, z0 + WC) }; }
  function chunks1(size) { return Math.ceil(size / WC); }
  function encode(cx, cz, size, blds, roadAt, wearAt, cleared) {
    var q = rect(cx, cz, size), rows = [], any = false, wear = [], x, z;
    for (z = q.z0; z < q.z1; z++) {
      var row = '';
      for (x = q.x0; x < q.x1; x++) {
        var t = roadAt(x, z);
        if (t) { row += RCH[t] || 'd'; any = true; if (t === 'asphalt') { var w = wearAt(x, z); if (w > 0.0001) wear.push(x - q.x0, z - q.z0, Math.round(w * 10000)); } }
        else row += '.';
      }
      rows.push(row.replace(/\.+$/, ''));
    }
    if (!blds.length && !any && !(cleared && cleared.length)) return null;
    var doc = { v: 1 };
    if (blds.length) doc.b = blds.map(function (b) { return Object.assign({}, b); });
    if (any) doc.r = rows;
    if (wear.length) doc.w = wear;
    if (cleared && cleared.length) doc.t = cleared.slice();
    return doc;
  }
  function decode(doc, cx, cz) {
    var out = { b: [], roads: [], wear: [], t: [] };
    if (!doc) return out;
    var x0 = cx * WC, z0 = cz * WC;
    if (doc.b) out.b = doc.b.map(function (b) { return Object.assign({}, b); });
    if (doc.r) doc.r.forEach(function (row, dz) { for (var dx = 0; dx < row.length; dx++) { var c = row.charAt(dx); if (c !== '.') out.roads.push([x0 + dx, z0 + dz, RREV[c] || 'dirt']); } });
    if (Array.isArray(doc.t)) out.t = doc.t.filter(function (n) { return typeof n === 'number'; });
    if (doc.w) for (var i = 0; i + 2 < doc.w.length; i += 3) out.wear.push([x0 + doc.w[i], z0 + doc.w[i + 1], doc.w[i + 2] / 10000]);
    return out;
  }
  // Целую карту (старое сохранение, город-пример) → куски. foot(b) → {w, d}
  function chunkify(size, buildings, roads, wear, foot) {
    var out = {}, n = chunks1(size), cx, cz;
    for (cz = 0; cz < n; cz++) for (cx = 0; cx < n; cx++) out[cx + ',' + cz] = { b: [], rd: {}, wr: {} };
    buildings.forEach(function (b) {
      var f = foot(b);
      for (var qz = Math.floor(b.z / WC); qz <= Math.floor((b.z + f.d - 1) / WC); qz++) for (var qx = Math.floor(b.x / WC); qx <= Math.floor((b.x + f.w - 1) / WC); qx++) {
        var c = out[qx + ',' + qz]; if (c) c.b.push(b);
      }
    });
    Object.keys(roads).forEach(function (k) {
      var p = k.split(','), x = +p[0], z = +p[1], c = out[Math.floor(x / WC) + ',' + Math.floor(z / WC)]; if (!c) return;
      c.rd[k] = roads[k]; if (wear && wear[k]) c.wr[k] = wear[k];
    });
    var docs = {};
    Object.keys(out).forEach(function (ck) {
      var p = ck.split(','), c = out[ck];
      var d = encode(+p[0], +p[1], size, c.b, function (x, z) { return c.rd[x + ',' + z]; }, function (x, z) { return c.wr[x + ',' + z] || 0; });
      if (d) docs[ck] = d;
    });
    return docs;
  }

  // ---------- миры ----------
  function visible(m) { var u = curUser(); return !m.del && (!m.uid || !u || m.uid === u.uid); }
  function stats(m) { if (m.cloudOnly && m.st) return m.st; var b = 0, p = 0, j = 0, cs = m.cs || {}; Object.keys(cs).forEach(function (k) { b += cs[k][0] | 0; p += cs[k][1] | 0; j += cs[k][2] | 0; }); return [b, p, j]; }
  function view(m) { var s = stats(m); return { id: m.id, name: m.name, size: m.size, c: m.c, u: m.u, uid: m.uid || '', cloud: !!m.cu, cloudOnly: !!m.cloudOnly, needPull: !!m.needPull, b: s[0], p: s[1], j: s[2], dirty: worldDirty(m.id), nat: m.g ? !!m.g.env : null }; } // nat (с 0.22.0): есть ли в мире природа; null — неизвестно (мир ещё не скачан)
  function worldHardDirty(id) { var k, pre = id + '|'; for (k in dirtyMap) if (k.indexOf(pre) === 0 && dirtyMap[k].hard) return true; return false; }
  function worldDirty(id) { var k, pre = id + '|'; for (k in dirtyMap) if (k.indexOf(pre) === 0) return true; return false; }
  function list() {
    return ready.then(function () { return Object.keys(metas).map(function (k) { return metas[k]; }).filter(visible).sort(function (a, b) { return b.u - a.u; }).map(view); });
  }
  function saveMeta(m) { return S.worlds.put(m.id, m); }
  function markDirty(k, info, hard) {
    var d = dirtyMap[k], now = Date.now();
    if (!d) d = dirtyMap[k] = { k: k, id: info.id, cx: info.cx, cz: info.cz, meta: !!info.meta, hard: 0, first: now, at: now, ver: 0 };
    d.at = now; d.ver++; if (hard) d.hard = 1;
    S.dirty.put(k, d).catch(noop);
  }
  function dropDirty(d) { if (dirtyMap[d.k] === d) { delete dirtyMap[d.k]; S.dirty.del(d.k).catch(noop); } }

  function create(o) {
    return ready.then(function () {
      var id = o.id || newId(), u = curUser();
      var m = { id: id, name: o.name || 'Мой мир', size: o.size, c: Date.now(), u: nextU(), v: 1, uid: u ? u.uid : '', g: o.g || null, cam: o.cam || null, cs: o.cs || {} };
      metas[id] = m;
      markDirty(id + '|meta', { id: id, meta: true }, true);
      return saveMeta(m).then(function () { emit({ type: 'list' }); return view(m); });
    });
  }
  // Полная копия меты для игры (чтобы игра не меняла записи хранилища «в обход»)
  function get(id) { var m = metas[id]; return m ? JSON.parse(JSON.stringify(m)) : null; }
  function update(id, patch, hard) {
    var m = metas[id]; if (!m || m.del) return;
    Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
    m.u = nextU();
    saveMeta(m).catch(noop); markDirty(id + '|meta', { id: id, meta: true }, hard);
  }
  function rename(id, name) { update(id, { name: String(name || '').trim().slice(0, 40) || 'Мой мир' }, true); emit({ type: 'list' }); }
  function remove(id) {
    return ready.then(function () {
      var m = metas[id]; if (!m) return;
      return S.chunks.keys(id + '|').then(function (ks) {
        return Promise.all(ks.map(function (k) { return S.chunks.del(k); }));
      }).then(function () {
        Object.keys(dirtyMap).forEach(function (k) { if (k.indexOf(id + '|') === 0) dropDirty(dirtyMap[k]); });
        if (m.cu) { m.del = Date.now(); m.u = nextU(); return saveMeta(m); } // в облаке этот мир есть — отправим «надгробие»
        delete metas[id]; return S.worlds.del(id);
      }).then(function () { emit({ type: 'list' }); pushDeletes(); });
    });
  }

  // ---------- куски ----------
  function putChunk(id, cx, cz, doc, hard) {
    if (!DB && !memory) return ready.then(function () { return putChunk(id, cx, cz, doc, hard); });
    var m = metas[id]; if (!m || m.del) return Promise.resolve();
    var u = nextU(), k = ckey(id, cx, cz);
    markDirty(k, { id: id, cx: cx, cz: cz }, hard);
    return S.chunks.put(k, { u: u, doc: doc }).catch(function (e) { console.warn('world: запись куска', e); });   // запись запускается сразу — успевает даже при закрытии страницы
  }
  function getChunk(id, cx, cz) {
    return ready.then(function () {
      var k = ckey(id, cx, cz), m = metas[id], cc = cx + ',' + cz;
      return S.chunks.get(k).then(function (local) {
        if (!m || !m.cu || !cloudOn()) return local ? local.doc : null;
        var R = root(), ref = R.child('chunks/' + id + '/' + cx + '_' + cz);
        return tmo(ref.child('u').once('value'), 6000, 'кусок').then(function (s) {
          var cu = Number(s.val()) || 0, base = (m.cbs && m.cbs[cc]) || 0;
          if (cu === base) return local ? local.doc : null;                    // в облаке то же, на чём основана наша копия
          if (!cu) return local ? local.doc : null;
          return tmo(ref.once('value'), 20000, 'кусок').then(function (v) {
            var node = v.val(), doc = null;
            if (node && node.j) { try { doc = JSON.parse(node.j); } catch (e) { doc = null; } }
            (m.cbs = m.cbs || {})[cc] = cu; saveMeta(m).catch(noop);
            return S.chunks.put(k, { u: cu, doc: doc }).then(function () { if (dirtyMap[k]) dropDirty(dirtyMap[k]); return doc; });
          });
        }).catch(function (e) { console.warn('world: кусок из облака', e); return local ? local.doc : null; });
      });
    });
  }
  // Открыть мир: если в облаке мета новее (или мир ещё не скачан) — скачать её. Возвращает копию меты.
  function open(id) {
    return ready.then(function () {
      var m = metas[id]; if (!m || m.del) throw new Error('Такого мира нет');
      if (!(m.needPull || m.cloudOnly)) return get(id);
      if (!cloudOn()) { if (m.cloudOnly) throw new Error('Этот мир лежит в облаке и ещё не скачан на устройство. Подключитесь к интернету и войдите в аккаунт.'); return get(id); }
      return tmo(root().child('meta/' + id).once('value'), 15000, 'мир').then(function (s) {
        var v = s.val();
        if (v && v.j) {
          var cm = JSON.parse(v.j);
          ['name', 'size', 'c', 'g', 'cam', 'cs'].forEach(function (k) { if (cm[k] !== undefined) m[k] = cm[k]; });
          m.u = v.u; m.cu = v.u; m.needPull = false; m.cloudOnly = false;
          return saveMeta(m);
        }
        if (m.cloudOnly) throw new Error('Мир в облаке не найден');
      }).then(function () { return get(id); });
    });
  }
  function setOpen(id) { openId = id || ''; }

  // ---------- облако: отправка ----------
  var pushing = false, syncing = false, cstat = { state: 'off', text: '' }, lastSync = 0;
  function setStat(state, text) { cstat = { state: state, text: text || '' }; emit({ type: 'status' }); }
  function metaForCloud(m) { return { name: m.name, size: m.size, c: m.c, g: m.g, cam: m.cam, cs: m.cs }; }
  function pushOne(d) {
    var u = curUser(), R = root(), v0 = d.ver, m = metas[d.id];
    if (!m || m.del || (m.uid && m.uid !== u.uid)) { dropDirty(d); return Promise.resolve(); }
    if (d.meta) {
      return tmo(R.child('index/' + d.id + '/u').once('value'), 8000, 'мир').then(function (s) {
        var cu = Number(s.val()) || 0;
        if (cu !== (m.cu || 0)) {                    // после нашей последней отправки мир менял кто-то ещё (или удалил) — не затираем, заберём при открытии
          m.needPull = true; if (m.id === openId) emit({ type: 'remote', id: m.id });
          return saveMeta(m).then(function () { dropDirty(d); });
        }
        return R.child('meta/' + d.id).set({ u: m.u, j: JSON.stringify(metaForCloud(m)) }).then(function () {
          return R.child('index/' + d.id).set({ n: m.name, s: m.size, c: m.c, u: m.u, st: stats(m) });
        }).then(function () { m.uid = u.uid; m.cu = m.u; return saveMeta(m); });
      }).then(function () { if (d.ver === v0) dropDirty(d); });
    }
    return S.chunks.get(d.k).then(function (rec) {
      if (!rec) { dropDirty(d); return; }
      var ref = R.child('chunks/' + d.id + '/' + d.cx + '_' + d.cz);
      return tmo(ref.child('u').once('value'), 8000, 'кусок').then(function (s) {
        var cu = Number(s.val()) || 0, cc = d.cx + ',' + d.cz;
        if (cu !== ((m.cbs && m.cbs[cc]) || 0)) {      // кусок успели поменять с другого устройства: кто первый отправил, того и правка
          m.needPull = true; if (m.id === openId) emit({ type: 'remote', id: m.id });
          return saveMeta(m).then(function () { return 'skip'; });
        }
        return ref.set({ u: rec.u, j: JSON.stringify(rec.doc || null) }).then(function () { (m.cbs = m.cbs || {})[cc] = rec.u; return saveMeta(m); });
      }).then(function (r) { if (r === 'skip' || d.ver === v0) dropDirty(d); });
    });
  }
  function pushDirty(force) {
    if (pushing || !cloudOn()) return Promise.resolve();
    var now = Date.now(), ks = Object.keys(dirtyMap).filter(function (k) {
      var d = dirtyMap[k]; if (!d) return false;
      return force || (d.hard ? (now - d.at >= PUSH_HARD || now - d.first >= PUSH_MAX) : now - d.first >= PUSH_SOFT);
    }).sort(function (a, b) { return (dirtyMap[b].meta ? 1 : 0) - (dirtyMap[a].meta ? 1 : 0); });   // сначала меты
    if (!ks.length) return Promise.resolve();
    pushing = true; setStat('syncing', 'Отправляем миры в облако…');
    var chain = Promise.resolve();
    ks.forEach(function (k) { chain = chain.then(function () { var d = dirtyMap[k]; return d ? pushOne(d) : null; }); });
    return chain.then(function () { lastSync = Date.now(); setStat('ok', 'Синхронизировано ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })); emit({ type: 'list' }); })
      .catch(function (e) { console.warn('world: отправка', e); setStat('error', errText(e)); })
      .then(function () { pushing = false; });
  }
  function pushDeletes() {
    if (!cloudOn()) return Promise.resolve();
    var R = root(), dels = Object.keys(metas).map(function (k) { return metas[k]; }).filter(function (m) { return m.del; });
    return Promise.all(dels.map(function (m) {
      return R.child('index/' + m.id).set({ d: m.del }).then(function () { return Promise.all([R.child('meta/' + m.id).remove(), R.child('chunks/' + m.id).remove()]); })
        .then(function () { delete metas[m.id]; return S.worlds.del(m.id); });
    })).then(function () { emit({ type: 'list' }); }).catch(function (e) { console.warn('world: удаление в облаке', e); });
  }

  // Все локальные куски мира — в очередь на отправку (когда мир впервые попадает в облако)
  function enqueueAll(id) {
    return S.chunks.keys(id + '|').then(function (ks) {
      ks.forEach(function (k) { var p = k.slice(id.length + 1).split(','); markDirty(k, { id: id, cx: +p[0], cz: +p[1] }, true); });
    });
  }

  // ---------- облако: список миров ----------
  function sync(manual) {
    if (syncing) return Promise.resolve(false);
    if (!curUser()) { setStat('off', ''); return Promise.resolve(false); }
    if (!fbdb()) return Promise.resolve(false);
    if (navigator.onLine === false) { setStat('offline', 'Нет интернета — синхронизация позже'); return Promise.resolve(false); }
    syncing = true; setStat('syncing', 'Синхронизация миров…');
    var u = curUser(), R = root(), changed = false;
    return ready.then(function () { return tmo(R.child('index').once('value'), 15000, 'список миров'); }).then(function (snap) {
      var idx = snap.val() || {}, jobs = [];
      Object.keys(idx).forEach(function (id) {
        var C = idx[id], L = metas[id];
        if (C.d) {                                   // мир удалён на другом устройстве
          if (L && !L.del && (!L.uid || L.uid === u.uid)) {
            if (!worldHardDirty(id)) { jobs.push(S.chunks.keys(id + '|').then(function (ks) { return Promise.all(ks.map(function (k) { return S.chunks.del(k); })); }).then(function () { delete metas[id]; return S.worlds.del(id); })); changed = true; if (id === openId) emit({ type: 'removed', id: id }); }
            else { L.cu = 0; L.cbs = {}; markDirty(id + '|meta', { id: id, meta: true }, true); jobs.push(enqueueAll(id)); }   // после удаления мир успели изменить здесь — вернём в облако
          }
          if (Date.now() - C.d > TOMB_TTL) jobs.push(R.child('index/' + id).remove());
          return;
        }
        if (!L) {                                    // мир есть в облаке, на этом устройстве ещё нет
          var cs = {}; metas[id] = { id: id, name: C.n || 'Мир', size: C.s, c: C.c || C.u, u: C.u, cu: C.u, v: 1, uid: u.uid, g: null, cam: null, cs: cs, cloudOnly: true, st: C.st };
          jobs.push(saveMeta(metas[id])); changed = true; return;
        }
        if (L.del) return;
        if (L.uid && L.uid !== u.uid) return;        // мир другого аккаунта на этом устройстве
        if (!L.uid) { L.uid = u.uid; jobs.push(saveMeta(L)); }
        if (!pushing && C.u !== (L.cu || 0)) {       // мир менял другой устройство после нашей последней отправки
          L.cu = C.u; L.name = C.n || L.name; L.needPull = true;
          if (id === openId) emit({ type: 'remote', id: id });
          jobs.push(saveMeta(L)); changed = true;
        }
      });
      Object.keys(metas).forEach(function (id) {
        var L = metas[id]; if (idx[id] || L.del || (L.uid && L.uid !== u.uid) || L.cloudOnly) return;
        L.uid = u.uid; jobs.push(saveMeta(L), enqueueAll(id)); markDirty(id + '|meta', { id: id, meta: true }, true);   // мир есть только здесь — в облако
        changed = true;
      });
      return Promise.all(jobs);
    }).then(function () { return pushDeletes(); }).then(function () { syncing = false; return pushDirty(true); }).then(function () {
      lastSync = Date.now(); setStat(cstat.state === 'error' ? 'error' : 'ok', cstat.state === 'error' ? cstat.text : 'Синхронизировано ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      emit({ type: 'list' }); return true;
    }).catch(function (e) { console.warn('world: синхронизация', e); setStat('error', errText(e)); return false; })
      .then(function (ok) { syncing = false; return ok; });
  }
  function poke() { if (cloudOn() && Date.now() - lastSync > 20000) return sync(false); return Promise.resolve(false); }
  function flush() { return ready.then(function () { return pushDirty(true); }); }

  setInterval(function () { pushDirty(false); }, 5000);
  // вошли в аккаунт / вышли — запустить синхронизацию списка миров
  var lastUid = '';
  setInterval(function () {
    var u = curUser(), id = u ? u.uid : '';
    if (id === lastUid) return;
    lastUid = id;
    if (id) sync(false); else { setStat('off', ''); emit({ type: 'list' }); }
  }, 1500);
  window.addEventListener('online', function () { setTimeout(poke, 800); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(poke, 600); else pushDirty(true); });
  window.addEventListener('pagehide', function () { pushDirty(true); });

  window.WORLD = {
    WC: WC, ready: ready, list: list, get: get, open: open, setOpen: setOpen, create: create, update: update, rename: rename, remove: remove,
    getChunk: getChunk, putChunk: putChunk, codec: { encode: encode, decode: decode, chunkify: chunkify, rect: rect, count: chunks1 },
    stats: function (id) { var m = metas[id]; return m ? stats(m) : [0, 0, 0]; },
    exists: function (id) { return !!(metas[id] && !metas[id].del); },
    onChange: function (f) { listeners.push(f); },
    persistent: function () { return !!DB; },
    debug: function (id) { return { m: JSON.parse(JSON.stringify(metas[id] || {})), dirty: JSON.parse(JSON.stringify(dirtyMap)) }; },
    cloud: {
      on: cloudOn, sync: sync, poke: poke, flush: flush,
      status: function () { return { state: curUser() ? cstat.state : 'off', text: cstat.text, at: lastSync, user: curUser() }; }
    }
  };
})();
