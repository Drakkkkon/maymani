// «Мое_город» — градостроитель на Babylon.js. С 0.21.0: природа (деревья, каменистые площадки, горы — js/terrain.js) и камень. С 0.22.0: кнопка «🌲 Обновить» засевает природой старые миры. С 0.23.0: миникарта, Общество лесорубов (брёвна только от него), служебные машины появляются вместе со зданиями.
// Один вид — качественная изометрия («ИЗО HD», с 0.12.0): полное разрешение экрана, сглаживание
// и подробные текстуры. Свободный 3D-вид и пиксельная изометрия убраны.
// Одинаковые здания рисуются пачками (thin instances): тысячи домов — это десятки вызовов отрисовки.
(function () {
  'use strict';
  var G = window.GAME, N = G.mapSize, B = window.BABYLON, WORLD = window.WORLD, WC = 100; // WC — сторона куска карты (с 0.20.0)
  var SAVE_KEY = 'moe_gorod_save_v1', SEEN_KEY = 'moe_gorod_seen';
  var $ = function (id) { return document.getElementById(id); };
  var TOUCH = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  // ---------- Случайные числа с зерном ----------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function rint(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function newSeed() { return (Math.random() * 2147483647) | 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(c) { return B.Color3.FromHexString(c); }

  // ---------- Состояние ----------
  // b.prog (0…1) есть только у зданий, которые ещё строятся.
  var state, occ = new Int32Array(N * N);
  // Природа (с 0.21.0): terr — вид клетки (0 трава, 1 каменистая площадка, 2 склон горы, 3 подножие), treeA — дерево (0 нет, 1 дуб, 2 сосна, 3 ясень).
  // Заполняются при загрузке куска карты из «зерна» мира (state.env.seed), см. envLoad.
  var terr = new Uint8Array(N * N), treeA = new Uint8Array(N * N);
  function sizeOk(n) { return typeof n === 'number' && n >= 16 && n <= 1000 && (n | 0) === n; }
  function idx(x, z) { return z * N + x; }
  function inMap(x, z) { return x >= 0 && z >= 0 && x < N && z < N; }
  function key(x, z) { return x + ',' + z; }
  function foot(sz, rot) { var s = G.sizes[sz]; return rot % 2 ? { w: s.d, d: s.w } : { w: s.w, d: s.d }; }
  function isSite(b) { return typeof b.prog === 'number' && b.prog < 1; }

  function demoState(n) {
    n = n || G.mapSize;
    var s = emptyState(n);
    var x, z, o = Math.floor((n - 48) / 2); // пример нарисован для 48×48 — ставим его в центр
    function rd(x, z, t) { x += o; z += o; if (x >= 0 && z >= 0 && x < n && z < n) s.roads[key(x, z)] = t; }
    for (x = 12; x <= 36; x++) rd(x, 24, 'asphalt');
    for (z = 12; z <= 36; z++) rd(24, z, 'asphalt');
    for (x = 8; x <= 23; x++) rd(x, 31, 'dirt');
    for (z = 14; z <= 23; z++) rd(30, z, 'asphalt');
    for (z = 25; z <= 30; z++) rd(12, z, 'dirt');
    for (x = 25; x <= 31; x++) rd(x, 31, 'asphalt'); // подъезд к небоскрёбу (с 0.8.0 без дороги здания не работают)
    rd(13, 26, 'dirt'); rd(13, 27, 'dirt');            // подъезд к казарме
    var list = [
      ['res', '1x1', 19, 23, 0], ['res', '1x1', 21, 23, 0], ['res', '2x1', 16, 23, 0], ['res', '1x1', 14, 30, 2],
      ['res', '2x1', 17, 30, 2], ['res', '1x1', 20, 30, 2], ['res', '2x2', 26, 22, 0], ['res', '4x4', 31, 19, 0],
      ['social', '2x2', 26, 25, 2], ['social', '1x1', 22, 25, 2], ['gov', '2x2', 19, 25, 2], ['gov', '4x4', 25, 18, 0],
      ['corp', '4x4', 28, 27, 3], ['corp', '2x1', 22, 22, 0], ['corp', '1x1', 25, 30, 1], ['army', '2x2', 14, 26, 1]
    ];
    list.forEach(function (b) {
      var f = foot(b[1], b[4]), bx = b[2] + o, bz = b[3] + o;
      if (bx < 0 || bz < 0 || bx + f.w > n || bz + f.d > n) return;
      // в городе-примере показаны все четыре эпохи: корпорации — ар-деко, армия — баухаус, нижний ряд домов — модерн, остальное — бель-эпок
      var th = b[0] === 'corp' ? 2 : b[0] === 'army' ? 3 : (b[0] === 'res' && b[3] === 30) ? 1 : 0;
      s.buildings.push({ id: s.nextId++, cat: b[0], size: b[1], x: bx, z: bz, rot: b[4], seed: newSeed(), th: th });
    });
    return s;
  }
  // wear — износ асфальта по клеткам (0…1), rq — очередь ремонта, fql / fprog — очередь заказов завода, vehicles — машины завода
  function emptyState(n) { return { v: 1, thv: 2, size: n || G.mapSize, nextId: 1, buildings: [], roads: {}, brigades: [], nextBr: 1, spent: 0, wear: {}, rq: [], autoRepair: false, fql: [], fprog: 0, vehicles: [], nextVeh: 1, stock: { logs: 0, boards: 0, dsp: 0, stone: 0, gravel: 0 } }; }
  function fixState(s) {
    if (!sizeOk(s.size)) s.size = 48;
    if (!Array.isArray(s.brigades)) s.brigades = [];
    s.nextBr = s.nextBr || s.brigades.length + 1;
    s.spent = s.spent || 0;
    if (!s.wear || typeof s.wear !== 'object') s.wear = {};
    if (!Array.isArray(s.rq)) s.rq = [];
    s.autoRepair = !!s.autoRepair; s.fprog = +s.fprog || 0;
    if (!Array.isArray(s.fql)) { s.fql = []; for (var i = 0; i < (s.fq | 0); i++) s.fql.push('brigade'); } // до 0.10.0 — число заказанных бригад
    delete s.fq;
    // с 0.23.0 машины на заводе не заказывают (они появляются сами вместе со зданиями): заказанные ранее отменяются, деньги возвращаются; купленные остаются
    var OLD_PRICE = { garbage: 18000, ambulance: 16000, police: 14000, army: 24000, van: 12000, semi: 30000, dump: 20000 };
    s.fql = s.fql.filter(function (k) { if (k === 'brigade') return true; if (OLD_PRICE[k]) s.spent = (s.spent || 0) - OLD_PRICE[k]; return false; });
    if (!Array.isArray(s.vehicles)) s.vehicles = [];
    s.vehicles = s.vehicles.filter(function (v) { return v && G.vehicles[v.kind]; });
    s.nextVeh = s.nextVeh || s.vehicles.reduce(function (m, v) { return Math.max(m, v.id); }, 0) + 1;
    s.buildings = s.buildings.filter(function (b) { return G.cats[b.cat] && G.sizes[b.size]; });
    if (s.thv !== 2) { var TMAP = [0, 3, 2, 1]; s.buildings.forEach(function (b) { b.th = TMAP[b.th | 0] || 0; }); s.thv = 2; } // 0.19.0: стили A–D 0.18.0 → ближайшие эпохи
    s.buildings.forEach(function (b) { b.th = G.themes[b.th | 0] ? b.th | 0 : 0; }); // эпоха здания (с 0.18.0 — оформление); у старых сохранений — бель-эпок
    if (!s.stock || typeof s.stock !== 'object') s.stock = {};
    s.stock.boards = +s.stock.boards || 0; s.stock.dsp = +s.stock.dsp || 0; // склад досок и ДСП (с 0.11.0)
    s.stock.logs = +s.stock.logs || 0; // бревна (с 0.23.0): их рубит Общество лесорубов, лесопилки распиливают на доски
    s.stock.stone = +s.stock.stone || 0; s.stock.gravel = +s.stock.gravel || 0; // камень и щебень (с 0.21.0)
    if (s.env && (typeof s.env.seed !== 'number' || !isFinite(s.env.seed))) delete s.env; // природа: есть у миров, созданных с 0.21.0 или обновлённых кнопкой 🌲 (с 0.22.0)
    if (s.env && s.env.keep) s.env.keep = Array.isArray(s.env.keep) ? s.env.keep.filter(function (k) { return Array.isArray(k) && k.length === 4 && k.every(isFinite); }) : []; // зоны построенного (с 0.22.0)
    return s;
  }
  function catSizes(ck) { return G.cats[ck].sizes || ['1x1', '2x1', '2x2', '4x4']; }

  function legacyLoad() { // старое сохранение (до 0.20.0) — один город в браузере
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.v === 1 && Array.isArray(s.buildings) && s.roads) return fixState(s);
    } catch (e) {}
    return null;
  }

  // ---------- Миры и куски карты (с 0.20.0) ----------
  // Мир хранится в IndexedDB (и в облаке, если вы вошли в аккаунт) кусками по 100×100 клеток. В памяти — только те куски,
  // что рядом с камерой: state.buildings / state.roads / state.wear содержат лишь загруженную часть карты.
  var worldId = '', worldName = '', metaCs = {}, loaded = {}, loading = {}, dirtyCk = {}, worldTok = 0, switching = false, stale = false;
  function ckey(cx, cz) { return cx + ',' + cz; }
  function ckOf(x, z) { return ckey(Math.floor(x / WC), Math.floor(z / WC)); }
  function ckOfKey(k) { var i = k.indexOf(','); return ckey(Math.floor(+k.slice(0, i) / WC), Math.floor(+k.slice(i + 1) / WC)); }
  function nChunks() { return Math.ceil(N / WC); }
  function bChunks(b) { // куски, которых касается здание (дом на границе — в обоих)
    var f = foot(b.size, b.rot), out = [], x0 = Math.floor(b.x / WC), x1 = Math.floor((b.x + f.w - 1) / WC), z0 = Math.floor(b.z / WC), z1 = Math.floor((b.z + f.d - 1) / WC);
    for (var cz = z0; cz <= z1; cz++) for (var cx = x0; cx <= x1; cx++) out.push(ckey(cx, cz));
    return out;
  }
  function allLoaded(b) { return bChunks(b).every(function (c) { return loaded[c]; }); }
  function ready4(x, z, w, d) { return !!(loaded[ckOf(x, z)] && loaded[ckOf(x + w - 1, z)] && loaded[ckOf(x, z + d - 1)] && loaded[ckOf(x + w - 1, z + d - 1)]); }
  var META_SKIP = { buildings: 1, roads: 1, wear: 1 };
  function metaOf(st) { var g = {}; for (var k in st) if (!META_SKIP[k]) g[k] = st[k]; return JSON.parse(JSON.stringify(g)); }
  function camSave() { return { tx: Math.round(cam.tx * 100) / 100, tz: Math.round(cam.tz * 100) / 100, dist: Math.round(cam.dist * 10) / 10, yaw: Math.round(cam.yaw * 1000) / 1000 }; }
  // какие куски изменились (1 — мелочь вроде износа дорог и хода стройки, 2 — построили/снесли/переложили)
  function touchCk(ck, hard) { if (loaded[ck]) { dirtyCk[ck] = Math.max(dirtyCk[ck] || 0, hard ? 2 : 1); if (hard && mmDirty) mmDirty[ck] = 1; } }
  function touchB(b, hard) { bChunks(b).forEach(function (ck) { touchCk(ck, hard); }); }
  function touchCell(x, z, hard) { touchCk(ckOf(x, z), hard); }
  function flushChunks(only) {
    var set = {}, any = false;
    Object.keys(dirtyCk).forEach(function (ck) { if (!only || only === ck) { set[ck] = dirtyCk[ck]; delete dirtyCk[ck]; any = true; } });
    if (!any) return;
    var bl = {};
    state.buildings.forEach(function (b) { bChunks(b).forEach(function (ck) { if (set[ck]) (bl[ck] = bl[ck] || []).push(b); }); });
    Object.keys(set).forEach(function (ck) {
      var p = ck.split(','), cx = +p[0], cz = +p[1];
      var doc = WORLD.codec.encode(cx, cz, N, bl[ck] || [], function (x, z) { return state.roads[key(x, z)]; }, function (x, z) { return state.wear[key(x, z)] || 0; }, clearedList(ck));
      WORLD.putChunk(worldId, cx, cz, doc, set[ck] === 2);
    });
  }
  var saveTimer = 0, saveHard = false;
  function save() { saveHard = true; clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveNow(false); }, 250); }
  function saveSoft() { if (!saveTimer) saveTimer = setTimeout(function () { saveNow(true); }, 1500); }
  function saveNow(soft) {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!worldId || switching || stale || !WORLD.exists(worldId)) return;
    var hardMeta = !soft || saveHard; saveHard = false;
    flushChunks();
    computeStats();
    WORLD.update(worldId, { g: metaOf(state), cam: camSave(), cs: metaCs }, hardMeta);
  }

  // ---------- Подгрузка кусков по мере движения камеры ----------
  function validB(b) { return b && typeof b.x === 'number' && typeof b.z === 'number' && G.cats[b.cat] && G.sizes[b.size]; }
  function applyChunk(cx, cz, doc) {
    var ck = ckey(cx, cz), d = WORLD.codec.decode(doc, cx, cz), sites = 0, mx, mz;
    loaded[ck] = { x: cx, z: cz };
    d.b.forEach(function (b) {
      if (!validB(b) || byId[b.id]) return; // дом на границе лежит в двух кусках — берём один раз
      b.th = G.themes[b.th | 0] ? b.th | 0 : 0;
      if (b.id >= state.nextId) state.nextId = b.id + 1;
      state.buildings.push(b); markOcc(b, b.id); addBuildingMesh(b); if (isSite(b)) sites++;
    });
    d.roads.forEach(function (r) { if (inMap(r[0], r[1])) state.roads[key(r[0], r[1])] = r[2]; });
    d.wear.forEach(function (w) { state.wear[key(w[0], w[1])] = w[2]; });
    if (state.env) envLoad(cx, cz, d.t);
    var r = WC / CH; // куски дорог 20×20 вокруг и внутри (края зависят от соседей)
    for (mz = cz * r - 1; mz <= cz * r + r; mz++) for (mx = cx * r - 1; mx <= cx * r + r; mx++) if (mx >= 0 && mz >= 0 && mx * CH < N && mz * CH < N) dirtyChunks[mx + ',' + mz] = 1;
    resCache = {}; workCache = {};
    if (sites) assignBrigades();
    statsSoon(); dirty();
  }
  function loadChunk(cx, cz) {
    var ck = ckey(cx, cz);
    if (loaded[ck]) return Promise.resolve();
    if (loading[ck]) return loading[ck];
    var tok = worldTok, id = worldId;
    return (loading[ck] = WORLD.getChunk(id, cx, cz).then(function (doc) {
      if (tok !== worldTok) return;
      delete loading[ck]; applyChunk(cx, cz, doc);
    }, function (e) { if (tok === worldTok) delete loading[ck]; console.warn('кусок ' + ck + ' не загрузился', e); }));
  }
  function unloadChunk(ck) {
    var L = loaded[ck]; if (!L) return;
    flushChunks(ck); computeStats();
    delete loaded[ck]; if (mmKnown) mmKnown[ck] = 1;   // на миникарте остаётся как было; при следующей загрузке перерисуется
    var keep = [], gone = [];
    state.buildings.forEach(function (b) {
      var cks = bChunks(b);
      if (cks.indexOf(ck) < 0) { keep.push(b); return; }
      if (cks.some(function (c) { return loaded[c]; })) keep.push(b); else gone.push(b); // дом на границе остаётся, пока загружен соседний кусок
    });
    gone.forEach(function (b) {
      markOcc(b, 0); removeBuildingMesh(b.id); delete byId[b.id];
      if (infoId === b.id) closeInfo();
      if (moving && moving.b.id === b.id) cancelMove();
    });
    state.buildings = keep;
    var x0 = L.x * WC, z0 = L.z * WC, x1 = Math.min(N, x0 + WC), z1 = Math.min(N, z0 + WC), x, z;
    for (z = z0; z < z1; z++) for (x = x0; x < x1; x++) { var k = key(x, z); if (state.roads[k]) { delete state.roads[k]; delete state.wear[k]; } }
    envUnload(ck, L);
    var r = WC / CH, mx, mz;
    for (mz = L.z * r; mz < L.z * r + r; mz++) for (mx = L.x * r; mx < L.x * r + r; mx++) { var mk = mx + ',' + mz; (chunks[mk] || []).forEach(function (m) { m.dispose(); }); delete chunks[mk]; delete dirtyChunks[mk]; }
    for (mz = L.z * r - 1; mz <= L.z * r + r; mz++) for (mx = L.x * r - 1; mx <= L.x * r + r; mx++) if (mx >= 0 && mz >= 0 && chunks[mx + ',' + mz]) dirtyChunks[mx + ',' + mz] = 1;
    resCache = {}; workCache = {};
    statsSoon(); dirty();
  }
  function viewBox() { // какая часть карты (в клетках) сейчас на экране
    var rc = canvas.getBoundingClientRect(), x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    [[rc.left, rc.top], [rc.right, rc.top], [rc.left, rc.bottom], [rc.right, rc.bottom]].forEach(function (q) {
      var g = groundAt(q[0], q[1]); if (!g) return;
      x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x); z0 = Math.min(z0, g.z); z1 = Math.max(z1, g.z);
    });
    if (x0 > x1) { x0 = x1 = cam.tx; z0 = z1 = cam.tz; }
    return { x0: x0 + N / 2, x1: x1 + N / 2, z0: z0 + N / 2, z1: z1 + N / 2 };
  }
  function rangeOf(box, m) {
    var n = nChunks();
    return [Math.max(0, Math.floor((box.x0 - m) / WC)), Math.min(n - 1, Math.floor((box.x1 + m) / WC)), Math.max(0, Math.floor((box.z0 - m) / WC)), Math.min(n - 1, Math.floor((box.z1 + m) / WC))];
  }
  function ensureView() {
    if (!worldId || switching) return;
    var box = viewBox(), R = rangeOf(box, 14), K = rangeOf(box, 90), need = [], cx, cz, mid = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 };
    for (cz = R[2]; cz <= R[3]; cz++) for (cx = R[0]; cx <= R[1]; cx++) need.push([cx, cz]);
    need.sort(function (a, b) { return Math.hypot(a[0] * WC + 50 - mid.x, a[1] * WC + 50 - mid.z) - Math.hypot(b[0] * WC + 50 - mid.x, b[1] * WC + 50 - mid.z); });
    var active = Object.keys(loading).length;
    need.forEach(function (c) { var ck = ckey(c[0], c[1]); if (!loaded[ck] && !loading[ck] && active < 4) { loadChunk(c[0], c[1]); active++; } });
    var pin = {}; // куски со стройплощадками не выгружаем: там идёт работа
    state.buildings.forEach(function (b) { if (isSite(b)) bChunks(b).forEach(function (c) { pin[c] = 1; }); });
    Object.keys(loaded).forEach(function (ck) {
      var L = loaded[ck];
      if (pin[ck] || (L.x >= K[0] && L.x <= K[1] && L.z >= K[2] && L.z <= K[3])) return;
      unloadChunk(ck);
    });
    var ld = Object.keys(loading).length; $('chunkNote').hidden = !ld;
  }
  function waitLoads() { return Promise.all(Object.keys(loading).map(function (k) { return loading[k]; })); }
  function rebuildOcc() { occ.fill(0); state.buildings.forEach(function (b) { markOcc(b, b.id); }); }
  function markOcc(b, val) {
    var f = foot(b.size, b.rot);
    for (var z = b.z; z < b.z + f.d; z++) for (var x = b.x; x < b.x + f.w; x++) if (inMap(x, z)) occ[idx(x, z)] = val;
  }
  var byId = {};
  function getB(id) { return byId[id] || null; }
  function canPlace(sz, rot, x, z, ignoreId, cat) {
    var f = foot(sz, rot);
    if (!ready4(x, z, f.w, f.d)) return false; // эта часть карты ещё не подгружена
    for (var zz = z; zz < z + f.d; zz++) for (var xx = x; xx < x + f.w; xx++) {
      if (!inMap(xx, zz)) return false;
      var o = occ[idx(xx, zz)];
      if (o && o !== ignoreId) return false;
      if (state.roads[key(xx, zz)]) return false;
    }
    return !terrainProblem(cat, sz, rot, x, z);
  }
  // Что мешает поставить здание из-за природы (с 0.21.0): '' — ничего. Деревья не мешают — их убирают при стройке.
  // На склоне горы строить нельзя; на каменистой земле — только добычу камня (каменоломня: каменистая площадка, карьер: подножие горы).
  function terrainProblem(cat, sz, rot, x, z) {
    if (!state || !state.env || !cat) return '';
    var f = foot(sz, rot), rock = 0, mount = 0, foot3 = 0, area = f.w * f.d;
    for (var zz = z; zz < z + f.d; zz++) for (var xx = x; xx < x + f.w; xx++) {
      if (!inMap(xx, zz)) continue;
      var t = terr[idx(xx, zz)];
      if (t === 2) mount++; else if (t === 1) rock++; else if (t === 3) { rock++; foot3++; }
    }
    if (mount) return 'mount';
    if (cat === 'quarry') {
      var q = G.quarry[sz];
      if (q.rule === 'mount') return foot3 >= q.need ? '' : 'needMount';
      return rock >= q.need ? '' : 'needRock';
    }
    return rock ? 'rock' : '';
  }
  function terrainMsg(p, cat, sz) {
    var q = cat === 'quarry' ? G.quarry[sz] : null;
    return p === 'mount' ? '⛰️ Здесь склон горы — строить нельзя' :
      p === 'rock' ? '🪨 Это каменистая земля — она нужна для добычи камня. Обычные здания ставьте на траву' :
      p === 'needRock' ? '🪨 Каменоломню ставят на каменистую площадку: нужно хотя бы ' + q.need + ' клеток из ' + G.sizes[sz].w * G.sizes[sz].d + ' с камнем' :
      p === 'needMount' ? '⛰️ Горный карьер ставят вплотную к склону горы: нужно хотя бы ' + q.need + ' клеток подножия из ' + G.sizes[sz].w * G.sizes[sz].d : '';
  }

  // ---------- Доллары ----------
  function money() { return isFinite(G.money) ? G.money - state.spent : Infinity; }
  function canPay(x) { return money() >= x; }
  function pay(x) { state.spent += x; updateMoney(); }
  function usd(n) { return isFinite(n) ? '$' + Math.round(n).toLocaleString('ru-RU') : '∞'; }
  function costOf(cat, size) { return Math.round(G.costs[size] * (G.costK[cat] || 1) / 1000) * 1000; }
  function buildTime(b) { return G.buildTime[b.size] || 20; }
  function updateMoney() { var m = money(); $('stMoney').textContent = isFinite(m) ? Math.round(m).toLocaleString('ru-RU') : '∞'; }

  // ---------- Движок Babylon.js ----------
  var canvas = $('scene');
  var engine = new B.Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
  var scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;      // как в прежней версии: x вправо, z к зрителю
  scene.skipPointerMovePicking = true;    // свои обработчики касаний — движку не нужно искать объекты
  scene.autoClearDepthAndStencil = true;
  scene.clearColor = B.Color4.FromHexString('#141b27ff'); // фон за краем карты (как в «ИЗО HD»)
  scene.fogMode = B.Scene.FOGMODE_NONE;

  var camera = new B.FreeCamera('cam', new B.Vector3(0, 30, 30), scene);
  camera.fov = 45 * Math.PI / 180; camera.minZ = 0.1; camera.maxZ = 600;
  camera.inputs.clear();

  var hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.diffuse = hex('#e8f2ff'); hemi.groundColor = hex('#6f8a5a'); hemi.specular = B.Color3.Black(); hemi.intensity = 0.72;
  // Солнце идёт за камерой: тени чёткие на карте любого размера.
  var SUN_OFF = new B.Vector3(-22, 40, 18);
  var sun = new B.DirectionalLight('sun', SUN_OFF.scale(-1).normalize(), scene);
  sun.diffuse = hex('#fff3dc'); sun.specular = B.Color3.Black(); sun.intensity = 0.62;
  sun.autoUpdateExtends = false; sun.autoCalcShadowZBounds = false;
  sun.shadowMinZ = 1; sun.shadowMaxZ = 200;
  var shadowGen = new B.ShadowGenerator(2048, sun);
  shadowGen.bias = 0.0015; shadowGen.normalBias = 0.01;

  // ---------- Материалы (на каждую сцену свой набор) ----------
  // Стены (с 0.16.0 — Западная Европа начала XX века): текстура = один пролёт × один этаж, рисуется в «метрах» (клетках).
  // Стили: euro — оштукатуренный доходный дом, brick — красный кирпич, archb — кирпич с арочными окнами,
  // gov — камень с классическими окнами, arcade — рустованный цоколь с арками, shop — витрина лавки,
  // iron — большие окна в чугунном переплёте, dorm — слуховое окно мансарды, clock — башенные часы.
  var FH = 0.3; // высота одного этажа
  var TILE = { euro: [0.5, 0.3], brick: [0.5, 0.3], archb: [0.6, 0.3], gov: [0.6, 0.3], arcade: [0.6, 0.3], shop: [0.7, 0.3], iron: [0.5, 0.3], dorm: [0.3, 0.3], clock: [0.6, 0.6],
    deco: [0.5, 0.3], decot: [0.6, 0.3], decobase: [0.6, 0.3], indb: [0.5, 0.3], indw: [0.6, 0.3], indbase: [0.6, 0.3], panel: [0.6, 0.3], panelw: [0.6, 0.3], panelbase: [0.6, 0.3],
    nouv: [0.5, 0.3], bauh: [0.5, 0.3], bauhbase: [0.6, 0.3] };
  function shade(c, k) { // осветлить (k>0) или затемнить (k<0) цвет #rrggbb
    var n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function paintWall(style, wall, S) {
    var T = TILE[style] || TILE.euro, tw = T[0], th = T[1], kx = S / tw, ky = S / th, hi = S >= 128;
    var c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), r = rng(style.length * 131 + parseInt(wall.slice(1), 16));
    function R(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x * kx, y * ky, Math.max(1, w * kx), Math.max(1, h * ky)); }
    function grain(n, a) { if (!hi) return; for (var i = 0; i < n; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')'; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); } }
    function glassRect(x, y, w, h, c0, c1) {
      var gr = g.createLinearGradient(x * kx, y * ky, (x + w * 0.5) * kx, (y + h) * ky); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.fillRect(x * kx, y * ky, w * kx, h * ky);
      if (hi) { // отражение неба — косая светлая полоса
        g.save(); g.beginPath(); g.rect(x * kx, y * ky, w * kx, h * ky); g.clip();
        g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.moveTo((x + w * 0.1) * kx, (y + h) * ky); g.lineTo((x + w * 0.45) * kx, y * ky); g.lineTo((x + w * 0.62) * kx, y * ky); g.lineTo((x + w * 0.28) * kx, (y + h) * ky); g.fill();
        g.restore();
      }
    }
    function line(x0, y0, x1, y1, col, wm) { g.strokeStyle = col; g.lineWidth = Math.max(1, wm * kx); g.beginPath(); g.moveTo(x0 * kx, y0 * ky); g.lineTo(x1 * kx, y1 * ky); g.stroke(); }
    function archPath(cx, yb, w, h) { // проём с круглой аркой сверху: yb — низ, h — полная высота
      g.beginPath(); g.moveTo((cx - w / 2) * kx, yb * ky); g.lineTo((cx - w / 2) * kx, (yb - h + w / 2) * ky);
      g.ellipse(cx * kx, (yb - h + w / 2) * ky, w / 2 * kx, w / 2 * ky, 0, Math.PI, 0); g.lineTo((cx + w / 2) * kx, yb * ky); g.closePath();
    }
    function archWin(cx, yb, w, h, trim, c0, c1, frame, sill) {
      var t = 0.022;
      archPath(cx, yb + 0.004, w + 2 * t, h + t + 0.004); g.fillStyle = trim; g.fill();
      archPath(cx, yb, w, h); g.save(); g.clip(); glassRect(cx - w / 2, yb - h, w, h, c0, c1); g.restore();
      archPath(cx, yb, w, h); g.strokeStyle = frame; g.lineWidth = Math.max(1, 0.012 * kx); g.stroke();
      line(cx, yb - h + w / 2, cx, yb, frame, 0.008); line(cx - w / 2, yb - h * 0.42, cx + w / 2, yb - h * 0.42, frame, 0.008);
      if (sill) { R(cx - w / 2 - t - 0.012, yb, w + 2 * t + 0.024, 0.014, sill); R(cx - w / 2 - t, yb + 0.014, w + 2 * t, 0.006, 'rgba(0,0,0,.22)'); }
      if (hi) R(cx - 0.012, yb - h - t - 0.004, 0.024, 0.02, shade(trim, 0.25)); // замковый камень
    }
    function rectWin(cx, y, w, h, trim, frame, c0, c1, o) {
      o = o || {}; var t = o.t === undefined ? 0.02 : o.t;
      R(cx - w / 2 - t, y - t, w + 2 * t, h + t, trim);
      R(cx - w / 2 - 0.004, y - 0.004, w + 0.008, h + 0.008, 'rgba(0,0,0,.35)');
      glassRect(cx - w / 2, y, w, h, c0, c1);
      line(cx, y, cx, y + h, frame, 0.008); line(cx - w / 2, y + h * 0.38, cx + w / 2, y + h * 0.38, frame, 0.008);
      if (o.lintel) R(cx - w / 2 - t - 0.02, y - t - 0.026, w + 2 * t + 0.04, 0.026, o.lintel);
      if (o.sill !== false) { R(cx - w / 2 - t - 0.014, y + h, w + 2 * t + 0.028, 0.014, o.sillCol || trim); R(cx - w / 2 - t, y + h + 0.014, w + 2 * t, 0.006, 'rgba(0,0,0,.22)'); }
    }
    function bricks(col) {
      R(0, 0, tw, th, col);
      var rows = 15, rh = th / rows, bl = 0.05, nb = Math.round(tw / bl), i, j;
      if (hi) for (i = 0; i < rows; i++) for (j = 0; j < nb; j++) { var k = r(); R(j * tw / nb + (i % 2 ? tw / nb / 2 : 0), i * rh, tw / nb, rh, k > 0.6 ? 'rgba(255,255,255,.07)' : k < 0.25 ? 'rgba(0,0,0,.1)' : 'rgba(0,0,0,0)'); }
      g.fillStyle = 'rgba(224,210,182,.5)';
      for (i = 0; i < rows; i++) {
        g.fillRect(0, i * rh * ky, S, Math.max(1, 0.0028 * ky));
        if (hi) for (j = 0; j < nb; j++) g.fillRect((j * tw / nb + (i % 2 ? tw / nb / 2 : 0)) * kx, i * rh * ky, Math.max(1, 0.0022 * kx), rh * ky);
      }
    }
    function ashlar(col) {
      R(0, 0, tw, th, col); grain(900, 0.05);
      var rows = Math.round(th / 0.05), i, j;
      for (i = 1; i < rows; i++) {
        R(0, i * th / rows, tw, 0.003, 'rgba(0,0,0,.16)');
        if (hi) for (j = 0; j < 5; j++) R(((j * 0.1 + (i % 2) * 0.05) % tw), i * th / rows, 0.003, th / rows, 'rgba(0,0,0,.12)');
      }
    }
    function band(col) { R(0, 0, tw, 0.018, shade(col, 0.2)); R(0, 0.018, tw, 0.008, 'rgba(0,0,0,.14)'); }
    var wl = wall, GL0 = '#bcd6ea', GL1 = '#4f7497', cx = tw / 2, i;
    if (style === 'euro') { // оштукатуренный дом: высокое окно, каменное обрамление, чугунная решётка балкона
      R(0, 0, tw, th, wl); grain(1500, 0.05); band(wl);
      var wy = 0.055, wh = 0.2, ww = 0.19;
      R(cx - ww / 2 - 0.024, wy - 0.034, ww + 0.048, wh + 0.04, shade(wl, 0.3));
      R(cx - ww / 2 - 0.036, wy - 0.05, ww + 0.072, 0.018, shade(wl, 0.34));
      glassRect(cx - ww / 2, wy, ww, wh, GL0, GL1);
      line(cx, wy, cx, wy + wh, '#f6f2e6', 0.008); line(cx - ww / 2, wy + wh * 0.36, cx + ww / 2, wy + wh * 0.36, '#f6f2e6', 0.008);
      R(cx - ww / 2, wy, ww, 0.012, 'rgba(0,0,0,.28)');
      R(cx - ww / 2 - 0.04, wy + wh - 0.06, ww + 0.08, 0.006, '#25282d');
      if (hi) for (i = 0; i < 12; i++) R(cx - ww / 2 - 0.04 + i * (ww + 0.08) / 11, wy + wh - 0.06, 0.0035, 0.06, '#25282d'); else R(cx - ww / 2 - 0.04, wy + wh - 0.05, ww + 0.08, 0.05, 'rgba(25,28,33,.55)');
      R(cx - ww / 2 - 0.044, wy + wh, ww + 0.088, 0.014, shade(wl, 0.34)); R(cx - ww / 2 - 0.04, wy + wh + 0.014, ww + 0.08, 0.008, 'rgba(0,0,0,.22)');
    } else if (style === 'brick') { // кирпич, прямоугольное окно с каменной перемычкой и подоконником
      bricks(wl); R(0, 0, tw, 0.014, 'rgba(235,228,210,.7)');
      rectWin(cx, 0.075, 0.18, 0.18, '#ece6d4', '#f6f2e6', GL0, GL1, { lintel: '#ece6d4', t: 0.016 });
    } else if (style === 'archb') { // кирпич, высокое арочное окно с каменной оправой
      bricks(wl); R(0, 0, tw, 0.014, 'rgba(235,228,210,.7)');
      archWin(cx, 0.265, 0.2, 0.24, '#e9e2d0', GL0, GL1, '#f6f2e6', '#e9e2d0');
    } else if (style === 'gov') { // камень, окно с треугольным фронтоном
      ashlar(wl); band(wl);
      rectWin(cx, 0.1, 0.16, 0.16, shade(wl, 0.28), '#f6f2e6', GL0, GL1, { t: 0.018 });
      g.fillStyle = shade(wl, 0.34); g.beginPath(); g.moveTo((cx - 0.12) * kx, 0.075 * ky); g.lineTo(cx * kx, 0.026 * ky); g.lineTo((cx + 0.12) * kx, 0.075 * ky); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.moveTo((cx - 0.08) * kx, 0.072 * ky); g.lineTo(cx * kx, 0.04 * ky); g.lineTo((cx + 0.08) * kx, 0.072 * ky); g.closePath(); g.fill();
    } else if (style === 'arcade') { // рустованный цоколь с арками
      ashlar(shade(wl, -0.06));
      archWin(cx, 0.3, 0.22, 0.26, shade(wl, 0.18), '#3a424a', '#161a1f', '#25282d', null);
      if (hi) for (i = 1; i < 5; i++) line(cx - 0.11 + i * 0.044, 0.18, cx - 0.11 + i * 0.044, 0.3, '#25282d', 0.004);
    } else if (style === 'shop') { // витрина: деревянная рама (цвет стены), вывеска сверху, глухая панель снизу
      R(0, 0, tw, th, wl); grain(600, 0.05);
      R(0, 0, tw, 0.075, '#eadfbd'); R(0, 0.075, tw, 0.008, 'rgba(0,0,0,.3)');
      if (hi) for (i = 0; i < 7; i++) R(0.07 + r() * 0.5, 0.02 + r() * 0.035, 0.04 + r() * 0.05, 0.008, 'rgba(60,40,20,.65)');
      glassRect(0.05, 0.1, tw - 0.1, 0.14, '#f7e3a6', '#9d7640');
      for (i = 1; i < 4; i++) line(0.05 + i * (tw - 0.1) / 4, 0.1, 0.05 + i * (tw - 0.1) / 4, 0.24, wl, 0.012);
      R(0.05, 0.1, tw - 0.1, 0.03, 'rgba(0,0,0,.2)'); line(0.05, 0.13, tw - 0.05, 0.13, wl, 0.008);
      R(0.05, 0.24, tw - 0.1, 0.06, shade(wl, -0.2)); R(0, 0, 0.03, th, shade(wl, 0.15)); R(tw - 0.03, 0, 0.03, th, shade(wl, 0.15));
    } else if (style === 'iron') { // каменные пилоны и широкое окно в чугунном переплёте
      R(0, 0, tw, th, wl); grain(900, 0.05); band(wl);
      var iw = 0.34, ix = cx - iw / 2;
      R(ix - 0.016, 0.034, iw + 0.032, 0.236, '#2f393d');
      glassRect(ix, 0.05, iw, 0.2, '#b2d0e4', '#46698a');
      for (i = 1; i < 3; i++) line(ix + i * iw / 3, 0.05, ix + i * iw / 3, 0.25, '#2f393d', 0.01);
      line(ix, 0.12, ix + iw, 0.12, '#2f393d', 0.01);
      R(ix - 0.016, 0.25, iw + 0.032, 0.03, '#3b4448'); if (hi) for (i = 0; i < 6; i++) R(ix + 0.01 + i * iw / 6, 0.256, 0.02, 0.018, 'rgba(200,170,90,.55)');
    } else if (style === 'dorm') { // слуховое окно на цинковой мансарде
      R(0, 0, tw, th, wl); grain(500, 0.05);
      archWin(cx, 0.27, 0.12, 0.19, shade(wl, 0.3), GL0, GL1, '#f6f2e6', shade(wl, 0.3));
    } else if (style === 'clock') { // часы на башне
      R(0, 0, tw, th, wl); grain(900, 0.05);
      R(cx - 0.26, 0.04, 0.52, 0.52, shade(wl, 0.2));
      g.fillStyle = '#c9a24a'; g.beginPath(); g.ellipse(cx * kx, 0.3 * ky, 0.23 * kx, 0.23 * ky, 0, 0, 7); g.fill();
      g.fillStyle = '#f7f3e6'; g.beginPath(); g.ellipse(cx * kx, 0.3 * ky, 0.2 * kx, 0.2 * ky, 0, 0, 7); g.fill();
      for (i = 0; i < 12; i++) { var a = i * Math.PI / 6, rr = i % 3 ? 0.17 : 0.155; line(cx + Math.sin(a) * rr, 0.3 - Math.cos(a) * rr, cx + Math.sin(a) * 0.19, 0.3 - Math.cos(a) * 0.19, '#26282c', 0.012); }
      line(cx, 0.3, cx - 0.09, 0.3 - 0.07, '#26282c', 0.016); line(cx, 0.3, cx + 0.03, 0.3 - 0.15, '#26282c', 0.012);
      g.fillStyle = '#26282c'; g.beginPath(); g.ellipse(cx * kx, 0.3 * ky, 0.012 * kx, 0.012 * ky, 0, 0, 7); g.fill();
    } else if (style === 'deco') { // ар-деко: белая штукатурка, ленточное окно, золотая полоса
      R(0, 0, tw, th, wl); grain(1500, 0.05); R(0, 0, tw, 0.012, shade(wl, 0.3));
      R(0, 0.07, tw, 0.175, '#2f3a40'); glassRect(0, 0.082, tw, 0.15, GL0, GL1);
      line(0, 0.082, 0, 0.232, '#2f3a40', 0.014); line(cx, 0.082, cx, 0.232, '#2f3a40', 0.01); line(0, 0.157, tw, 0.157, '#2f3a40', 0.006);
      R(0, 0.245, tw, 0.02, shade(wl, -0.14)); R(0, 0.288, tw, 0.008, '#c9a24a');
    } else if (style === 'decot') { // ар-деко: узкие высокие окна и пилястры
      R(0, 0, tw, th, wl); grain(1300, 0.05); R(0, 0, tw, 0.012, shade(wl, 0.3));
      [0.15, 0.45].forEach(function (x) {
        R(x - 0.075, 0.03, 0.15, 0.25, shade(wl, -0.1)); glassRect(x - 0.06, 0.045, 0.12, 0.22, GL0, GL1);
        line(x, 0.045, x, 0.265, '#2f3a40', 0.008); line(x - 0.06, 0.12, x + 0.06, 0.12, '#2f3a40', 0.006);
        R(x - 0.075, 0.27, 0.15, 0.012, '#c9a24a');
      });
      R(0.3 - 0.012, 0, 0.024, th, shade(wl, 0.28)); R(0, 0, 0.012, th, shade(wl, 0.28)); R(tw - 0.012, 0, 0.012, th, shade(wl, 0.28));
    } else if (style === 'nouv') { // модерн: охристая штукатурка, арочное окно с лепной рамой, волнистый пояс
      R(0, 0, tw, th, wl); grain(1500, 0.05);
      g.strokeStyle = shade(wl, 0.4); g.lineWidth = Math.max(1, 0.012 * ky); g.beginPath();
      for (i = 0; i <= 24; i++) { var wx0 = i * tw / 24, wy0 = 0.022 + Math.sin(i * 1.05) * 0.008; if (i) g.lineTo(wx0 * kx, wy0 * ky); else g.moveTo(wx0 * kx, wy0 * ky); }
      g.stroke(); R(0, 0.04, tw, 0.006, shade(wl, -0.16));
      archWin(cx, 0.27, 0.19, 0.22, shade(wl, 0.34), '#d3e4d4', '#4d7a66', '#3d5a49', shade(wl, 0.34));
      g.strokeStyle = shade(wl, 0.32); g.lineWidth = Math.max(1, 0.01 * kx);
      [-1, 1].forEach(function (sd) { g.beginPath(); g.moveTo((cx + sd * 0.16) * kx, 0.27 * ky); g.bezierCurveTo((cx + sd * 0.2) * kx, 0.17 * ky, (cx + sd * 0.12) * kx, 0.1 * ky, (cx + sd * 0.05) * kx, 0.075 * ky); g.stroke(); });
    } else if (style === 'bauh') { // баухаус: гладкая белая стена, ленточное окно с тонкими стальными переплётами
      R(0, 0, tw, th, wl); grain(900, 0.04);
      R(0, 0.064, tw, 0.19, '#2a3238'); glassRect(0, 0.072, tw, 0.174, GL0, GL1);
      for (i = 0; i <= 4; i++) line(i * tw / 4, 0.072, i * tw / 4, 0.246, '#2a3238', 0.008);
      line(0, 0.2, tw, 0.2, '#2a3238', 0.005);
      R(0, 0.262, tw, 0.012, shade(wl, -0.12)); R(0, 0, tw, 0.008, shade(wl, 0.2));
    } else if (style === 'bauhbase') { // баухаус: цоколь-витрина, стекло в тёмной раме
      R(0, 0, tw, th, shade(wl, -0.05)); grain(700, 0.04);
      R(0.03, 0.05, tw - 0.06, 0.22, '#2a3238'); glassRect(0.045, 0.062, tw - 0.09, 0.196, '#cfe2ee', '#476b8a');
      for (i = 1; i < 5; i++) line(0.045 + i * (tw - 0.09) / 5, 0.062, 0.045 + i * (tw - 0.09) / 5, 0.258, '#2a3238', 0.008);
      R(0, 0, tw, 0.008, shade(wl, 0.2));
    } else if (style === 'decobase') { // ар-деко: тёмный каменный цоколь с золотыми окнами
      R(0, 0, tw, th, shade(wl, -0.3)); grain(1000, 0.06); R(0, 0, tw, 0.01, '#c9a24a');
      for (i = 1; i < 6; i++) R(0, i * th / 6, tw, 0.003, 'rgba(0,0,0,.2)');
      [0.12, 0.3, 0.48].forEach(function (x) { R(x - 0.055, 0.065, 0.11, 0.17, '#c9a24a'); glassRect(x - 0.045, 0.075, 0.09, 0.15, '#6a7e88', '#1f2a31'); line(x, 0.075, x, 0.225, '#c9a24a', 0.006); });
    } else if (style === 'indb') { // закопчённый кирпич, арочное окно со стальным переплётом
      bricks(wl); R(0, 0, tw, th, 'rgba(22,17,14,.11)'); grain(1800, 0.07);
      archWin(cx, 0.265, 0.2, 0.24, '#8f857a', '#a3b6c0', '#3b4b55', '#1a1f23', '#8f857a');
      for (i = 1; i < 4; i++) line(cx - 0.1 + i * 0.05, 0.05, cx - 0.1 + i * 0.05, 0.265, '#1a1f23', 0.005);
      line(cx - 0.1, 0.2, cx + 0.1, 0.2, '#1a1f23', 0.005);
    } else if (style === 'indw') { // кирпич, широкое окно цеха в стальной раме
      bricks(wl); R(0, 0, tw, th, 'rgba(22,17,14,.11)'); grain(1800, 0.07);
      R(0.04, 0.052, tw - 0.08, 0.026, '#8f857a'); R(0.05, 0.078, tw - 0.1, 0.16, '#1a1f23'); glassRect(0.06, 0.088, tw - 0.12, 0.14, '#a9bcc6', '#3a4a54');
      for (i = 1; i < 6; i++) line(0.06 + i * (tw - 0.12) / 6, 0.088, 0.06 + i * (tw - 0.12) / 6, 0.228, '#1a1f23', 0.006);
      line(0.06, 0.158, tw - 0.06, 0.158, '#1a1f23', 0.006); R(0.04, 0.238, tw - 0.08, 0.016, '#8f857a');
    } else if (style === 'indbase') { // гранитный цоколь с арками
      ashlar('#77726b'); band('#77726b'); R(0, 0, tw, th, 'rgba(20,18,16,.12)');
      archWin(cx, 0.3, 0.22, 0.26, '#948f86', '#3a424a', '#161a1f', '#1a1f23', null);
      for (i = 1; i < 5; i++) line(cx - 0.11 + i * 0.044, 0.18, cx - 0.11 + i * 0.044, 0.3, '#1a1f23', 0.004);
    } else if (style === 'panel' || style === 'panelw' || style === 'panelbase') { // бетонные панели со швами
      var pb = style === 'panelbase';
      R(0, 0, tw, th, pb ? shade(wl, -0.12) : wl); grain(1800, 0.06);
      R(0, 0, tw, 0.007, 'rgba(45,45,42,.5)'); R(0, 0, 0.006, th, 'rgba(45,45,42,.5)');
      if (style === 'panel') {
        R(cx - 0.12, 0.065, 0.24, 0.18, '#46586c'); glassRect(cx - 0.105, 0.08, 0.1, 0.15, GL0, GL1);
        glassRect(cx + 0.005, 0.08, 0.1, 0.068, GL0, GL1); glassRect(cx + 0.005, 0.162, 0.1, 0.068, GL0, GL1);
        R(cx - 0.14, 0.245, 0.28, 0.014, shade(wl, 0.3)); R(cx - 0.11, 0.259, 0.22, 0.03, 'rgba(0,0,0,.07)');
      } else if (style === 'panelw') {
        R(0.04, 0.07, tw - 0.08, 0.17, '#46586c');
        for (i = 0; i < 4; i++) glassRect(0.052 + i * (tw - 0.1) / 4, 0.082, (tw - 0.1) / 4 - 0.012, 0.146, GL0, GL1);
        R(0.03, 0.245, tw - 0.06, 0.014, shade(wl, 0.3));
      } else {
        glassRect(0.07, 0.06, 0.2, 0.23, '#cfe2ee', '#476b8a'); line(0.17, 0.06, 0.17, 0.29, '#2c3a47', 0.012); R(0.06, 0.05, 0.22, 0.012, '#2c3a47');
        glassRect(0.34, 0.1, 0.2, 0.15, GL0, GL1); R(0.34, 0.25, 0.2, 0.012, shade(wl, 0.3));
      }
    } else { R(0, 0, tw, th, wl); }
    return c;
  }
  // ---------- Эпохи (с 0.19.0; в 0.18.0 — «оформления» A–D): 0 — бель-эпок (прежний вид), 1 — модерн, 2 — ар-деко, 3 — баухаус ----------
  // Эпоха меняет текстуры стен (стиль окон и цвет), текстуру крыш и сами формы крыш и деталей: см. Shapes и buildModel (th).
  var TH_WALL = [null,
    ['#e3c27d', '#dcae6b', '#e9d7a8', '#d3955f', '#d9c48c', '#c9d2a8'],
    ['#6b3a30', '#5d3a36', '#4d4d56', '#3f4b55', '#7a4a3a', '#54433e'],
    ['#f3f1ea', '#ece9df', '#f6efe2', '#e6e4dc', '#f1ebd9', '#eae6da']];
  var TH_ROOF = [null,
    ['#4f8a6c', '#5d9a7c', '#b5532f', '#4a7e8a'],
    ['#6e747c', '#5a6068'],
    ['#8d9188', '#9a9c94']];
  var TH_STYLE = [null,
    { euro: 'nouv', brick: 'nouv', archb: 'archb', gov: 'nouv' },
    { euro: 'decot', brick: 'decot', archb: 'decot', gov: 'decot', arcade: 'decobase', iron: 'decot' },
    { euro: 'bauh', brick: 'bauh', archb: 'bauh', gov: 'bauh', arcade: 'bauhbase', iron: 'bauh' }];
  function hashStr(t) { var h = 7; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; }
  function themeWall(style, col, th) {
    if (!th || !TH_WALL[th]) return [style, col];
    var st = TH_STYLE[th][style] || style;
    if (style === 'shop' || style === 'dorm' || style === 'clock') return [st, style === 'shop' ? col : TH_WALL[th][hashStr(col) % TH_WALL[th].length]];
    return [st, TH_WALL[th][hashStr(col) % TH_WALL[th].length]];
  }
  function themeRoof(col, th) { return !th || !TH_ROOF[th] ? col : TH_ROOF[th][hashStr(col) % TH_ROOF[th].length]; }
  // Текстура крыши: светлая, чтобы цвет материала красил её; одна плитка = 1/3 клетки.
  function paintRoof(th) {
    var S = 128, c = document.createElement('canvas'); c.width = c.height = S; var g = c.getContext('2d'), r = rng(500 + th), i, j;
    function tone(v) { var k = Math.round(255 * v); return 'rgb(' + k + ',' + k + ',' + k + ')'; }
    g.fillStyle = tone(0.9); g.fillRect(0, 0, S, S);
    if (th === 0) { // черепица / шифер: ряды с разбежкой швов
      var rows = 6, rh = S / rows, nc = 3, cw = S / nc;
      for (i = 0; i < rows; i++) for (j = 0; j < nc; j++) {
        var x0 = j * cw + (i % 2 ? cw / 2 : 0);
        [x0, x0 - S].forEach(function (xx) { g.fillStyle = tone(0.8 + r() * 0.2); g.fillRect(xx + 1, i * rh + 1, cw - 2, rh - 2); });
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, i * rh + rh - 3, S, 3);
      }
    } else if (th === 1) { // чешуя (модерн): ряды полукруглых плиток со сдвигом
      var sr = 8, sh2 = S / sr, sw2 = S / 4;
      for (i = 0; i <= sr; i++) for (j = -1; j < 5; j++) {
        var cxs = j * sw2 + (i % 2 ? sw2 / 2 : 0), cys = i * sh2;
        g.fillStyle = tone(0.74 + r() * 0.26); g.beginPath(); g.arc(cxs, cys, sw2 / 2, 0, Math.PI); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2; g.stroke();
      }
    } else if (th === 2) { // рифлёное железо с ржавчиной
      for (i = 0; i < 8; i++) { var gx = i * S / 8, gr = g.createLinearGradient(gx, 0, gx + S / 8, 0); gr.addColorStop(0, tone(1)); gr.addColorStop(0.55, tone(0.6)); gr.addColorStop(1, tone(0.82)); g.fillStyle = gr; g.fillRect(gx, 0, S / 8, S); }
      for (i = 0; i < 26; i++) { g.fillStyle = 'rgba(120,60,20,' + (0.12 + r() * 0.2) + ')'; g.fillRect(r() * S, r() * S, 2 + r() * 8, 3 + r() * 10); }
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, S - 3, S, 3);
    } else { // волнистый шифер
      for (i = 0; i < 4; i++) { var wx = i * S / 4, wg = g.createLinearGradient(wx, 0, wx + S / 4, 0); wg.addColorStop(0, tone(0.98)); wg.addColorStop(0.5, tone(0.7)); wg.addColorStop(1, tone(0.95)); g.fillStyle = wg; g.fillRect(wx, 0, S / 4, S); }
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, S / 2 - 1, S, 3);
    }
    for (i = 0; i < 500; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'; g.fillRect(r() * S, r() * S, 2, 2); }
    return c;
  }
  function windowCanvas(style, wall) { return paintWall(style, wall, 64); }
  function windowCanvasHD(style, wall) { return paintWall(style, wall, 256); }
  function makeKit(sc) {
    var mats = {}, wallM = {}, wallInfo = [], kitHD = false, roofM = {}, roofT = {};
    function base(name) { var m = new B.StandardMaterial(name, sc); m.specularColor = B.Color3.Black(); return m; }
    return {
      scene: sc,
      mat: function (color) {
        if (mats[color]) return mats[color];
        var m = base('m' + color); m.diffuseColor = hex(color); return (mats[color] = m);
      },
      wall: function (style, wall) {
        var k = style + wall; if (wallM[k]) return wallM[k];
        var m = base('w' + k), info = { m: m, style: style, wall: wall, lo: null, hi: null };
        m.diffuseColor = B.Color3.White(); wallInfo.push(info);
        wallTex(info, kitHD);
        return (wallM[k] = m);
      },
      // оформление (с 0.18.0): стиль и цвет стены в выбранном оформлении th (0 — A, прежний вид)
      wm: function (style, col, th) { return themeWall(style, col, th | 0); },
      // крыша с текстурой своего оформления; цвет берётся из палитры оформления
      roof: function (color, th) {
        th = th | 0; var k = 'r' + th + color; if (roofM[k]) return roofM[k];
        var m = base('rf' + k); m.diffuseColor = hex(themeRoof(color, th));
        if (!roofT[th]) { roofT[th] = new B.DynamicTexture('rt' + th, paintRoof(th), sc, true); roofT[th].update(); roofT[th].wrapU = roofT[th].wrapV = B.Texture.WRAP_ADDRESSMODE; roofT[th].anisotropicFilteringLevel = 4; }
        m.diffuseTexture = roofT[th]; return (roofM[k] = m);
      },
      // переключить окна всех домов между обычными (64 px) и HD (256 px)
      setHD: function (hd) { kitHD = hd; wallInfo.forEach(function (i) { wallTex(i, hd); }); }
    };
    function wallTex(info, hd) {
      var slot = hd ? 'hi' : 'lo';
      if (!info[slot]) {
        var t = new B.DynamicTexture('t' + slot + info.style + info.wall, (hd ? windowCanvasHD : windowCanvas)(info.style, info.wall), sc, true);
        t.update(); t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = hd ? 8 : 4;
        info[slot] = t;
      }
      info.m.diffuseTexture = info[slot];
      if (info.style === 'glass') info.m.specularColor = hd ? hex('#3a4656') : B.Color3.Black(); // блик на стеклянных башнях
      if (info.style === 'glass') info.m.specularPower = 48;
    }
  }
  var kit = makeKit(scene);

  // ---------- Модели зданий (с 0.16.0 — архитектура Западной Европы начала XX века) ----------
  // Модель собирается из простых фигур и сливается в ОДНУ сетку (с несколькими материалами).
  // Стиль: доходные дома с мансардами (Париж, Осман), кирпичные виллы и школы, ар-нуво, неоклассика,
  // ратуша с часовой башней, кирпичные фабрики с высокой трубой, чугунные порталы метро.
  var RES_WALL = ['#efe3c4', '#e7d4a6', '#ddd0bc', '#ecd5c3', '#a9513a', '#b86c48'];   // четыре штукатурки и два кирпича
  var BRICKS = ['#a9513a', '#b86c48'];
  var RES_ROOF = ['#a9482f', '#4d5660', '#6a7683', '#8a4630', '#5b4a44'];
  var STONE = '#e6ddc9', STONE2 = '#cfc5af', TRIM = '#f4efe2', ZINC = '#56616c', ZINC2 = '#66717c', SLATE = '#3d444c', TILEC = '#b04a2f',
    PAT = '#5aa593', IRON = '#2b2f35', GOLD = '#d9b04a', BRK = '#a2503a', RED = '#c8342c', WOODC = '#6e4a2e';

  function Shapes(K, ox, oz, th) {
    var sc = K.scene, parts = [];
    function put(m, material, x, y, z) { m.position.set(x - ox, y, z - oz); m.material = material; parts.push(m); return m; }
    // Произвольная грань-многоугольник: faces — списки точек [x,y,z] в координатах здания, ins — точка внутри тела (чтобы повернуть нормали наружу).
    function solid(faces, color, ins, roof) {
      var pos = [], nor = [], uv = [], ind = [];
      faces.forEach(function (f) {
        var a = f[0], b = f[1], c = f[2];
        var nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        var cx = 0, cy = 0, cz = 0; f.forEach(function (p) { cx += p[0]; cy += p[1]; cz += p[2]; }); cx /= f.length; cy /= f.length; cz /= f.length;
        if ((cx - ins[0]) * nx + (cy - ins[1]) * ny + (cz - ins[2]) * nz < 0) { f = f.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
        var l = Math.hypot(nx, ny, nz) || 1, o = pos.length / 3;
        // текстурные координаты: u — вдоль горизонтали грани, v — вдоль ската (по настоящей длине); одна плитка = 1/3 клетки
        var tx = nx / l, ty = ny / l, tz = nz / l, hl = Math.hypot(tx, tz), ux = hl > 1e-4 ? -tz / hl : 1, uz = hl > 1e-4 ? tx / hl : 0;
        var vx = ty * uz, vy = tz * ux - tx * uz, vz = -ty * ux;
        f.forEach(function (p) { pos.push(p[0] - ox, p[1], p[2] - oz); nor.push(tx, ty, tz); uv.push((p[0] * ux + p[2] * uz) * 3, (p[0] * vx + p[1] * vy + p[2] * vz) * 3); });
        for (var i = 1; i < f.length - 1; i++) ind.push(o, o + i + 1, o + i); // порядок вершин под правостороннюю сцену (0.17.0)
      });
      var mesh = new B.Mesh('s', sc), vd = new B.VertexData();
      vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = ind; vd.applyToMesh(mesh);
      mesh.material = roof ? K.roof(color, th) : K.mat(color); parts.push(mesh); return mesh;
    }
    // усечённая пирамида: низ — прямоугольник, верх — он же, сдвинутый внутрь на i
    function frust(x0, z0, x1, z1, y0, i, h, color, noTop) {
      var y1 = y0 + h, ins = [(x0 + x1) / 2, y0 + h * 0.4, (z0 + z1) / 2];
      var fs = [
        [[x0, y0, z1], [x1, y0, z1], [x1 - i, y1, z1 - i], [x0 + i, y1, z1 - i]],
        [[x0, y0, z0], [x1, y0, z0], [x1 - i, y1, z0 + i], [x0 + i, y1, z0 + i]],
        [[x0, y0, z0], [x0, y0, z1], [x0 + i, y1, z1 - i], [x0 + i, y1, z0 + i]],
        [[x1, y0, z0], [x1, y0, z1], [x1 - i, y1, z1 - i], [x1 - i, y1, z0 + i]]
      ];
      if (!noTop) fs.push([[x0 + i, y1, z0 + i], [x1 - i, y1, z0 + i], [x1 - i, y1, z1 - i], [x0 + i, y1, z1 - i]]);
      return solid(fs, color, ins, true);
    }
    var api = {
      parts: parts,
      box: function (w, h, d, material, x, y, z, faceUV) {
        return put(B.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d, faceUV: faceUV, wrap: true }, sc), material, x, y, z);
      },
      cube: function (x0, z0, x1, z1, y0, h, color) {
        return api.box(x1 - x0, h, z1 - z0, K.mat(color), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
      },
      cyl: function (rt, rb, h, seg, color, x, y, z) {
        return put(B.MeshBuilder.CreateCylinder('c', { diameterTop: rt * 2, diameterBottom: rb * 2, height: h, tessellation: seg }, sc), K.mat(color), x, y, z);
      },
      // поворот «запекается» в вершины, затем масштаб — как в прежней версии
      bake: function (m, rx, ry, rz) { m.rotation.set(rx || 0, ry || 0, rz || 0); var p = m.position.clone(); m.position.set(0, 0, 0); m.bakeCurrentTransformIntoVertices(); m.position.copyFrom(p); return m; },
      sph: function (rad, color, x, y, z, sy) {
        var q = B.MeshBuilder.CreateSphere('p', { diameter: rad * 2, segments: 6 }, sc); q.scaling.y = sy || 1; return put(q, K.mat(color), x, y, z);
      },
      // купол: полусфера, y — уровень основания
      dome: function (rad, color, x, y, z, sy) {
        var q = B.MeshBuilder.CreateSphere('d', { diameter: rad * 2, segments: 14, slice: 0.5 }, sc); q.scaling.y = sy || 1; return put(q, K.mat(color), x, y, z);
      },
      // башня с окнами по кругу (текстура стены): uw окон по окружности, fl этажей
      twr: function (rad, h, seg, material, x, y0, z, uw, fl) {
        var q = B.MeshBuilder.CreateCylinder('t', { diameter: rad * 2, height: h, tessellation: seg,
          faceUV: [new B.Vector4(0.02, 0.02, 0.03, 0.03), new B.Vector4(0, 0, uw, fl), new B.Vector4(0.02, 0.02, 0.03, 0.03)] }, sc);
        return put(q, material, x, y0 + h / 2, z);
      },
      solid: solid,
      // двускатная крыша; гребень вдоль оси ax ('x' или 'z'); end — цвет торцевых треугольников (фронтонов)
      gable: function (x0, z0, x1, z1, y0, rh, color, ax, ov, endColor) {
        ov = ov === undefined ? 0.05 : ov;
        var u0 = ax === 'x' ? x0 : z0, u1 = ax === 'x' ? x1 : z1, v0 = ax === 'x' ? z0 : x0, v1 = ax === 'x' ? z1 : x1;
        var vc = (v0 + v1) / 2, k = rh / ((v1 - v0) / 2), yE = y0 - k * ov, ua = u0 - ov * 0.6, ub = u1 + ov * 0.6, yr = y0 + rh;
        function P(u, v, y) { return ax === 'x' ? [u, y, v] : [v, y, u]; }
        var ins = P((u0 + u1) / 2, vc, y0 + rh * 0.3);
        solid([[P(ua, v0 - ov, yE), P(ub, v0 - ov, yE), P(ub, vc, yr), P(ua, vc, yr)], [P(ua, v1 + ov, yE), P(ub, v1 + ov, yE), P(ub, vc, yr), P(ua, vc, yr)]], color, ins, true);
        if (endColor) solid([[P(u0, v0, y0), P(u0, v1, y0), P(u0, vc, yr)], [P(u1, v0, y0), P(u1, v1, y0), P(u1, vc, yr)]], endColor, ins);
      },
      // вальмовая крыша (у квадрата — шатёр-пирамида)
      hip: function (x0, z0, x1, z1, y0, rh, color, ov) {
        ov = ov === undefined ? 0.05 : ov;
        var w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, yr = y0 + rh, k = rh / (Math.min(w, d) / 2), yE = y0 - k * ov;
        var xa = x0 - ov, xb = x1 + ov, za = z0 - ov, zb = z1 + ov, rx = Math.max(0, (w - d) / 2), rz = Math.max(0, (d - w) / 2), ins = [cx, y0 + rh * 0.3, cz];
        solid([
          [[xa, yE, zb], [xb, yE, zb], [cx + rx, yr, cz + rz], [cx - rx, yr, cz + rz]],
          [[xa, yE, za], [xb, yE, za], [cx + rx, yr, cz - rz], [cx - rx, yr, cz - rz]],
          [[xa, yE, za], [xa, yE, zb], [cx - rx, yr, cz + rz], [cx - rx, yr, cz - rz]],
          [[xb, yE, za], [xb, yE, zb], [cx + rx, yr, cz + rz], [cx + rx, yr, cz - rz]]
        ], color, ins, true);
      },
      // мансардная крыша: крутой нижний скат (hl, вглубь на i1) и пологий верхний (hu, ещё на i2)
      mansard: function (x0, z0, x1, z1, y0, hl, hu, i1, i2, c1, c2) {
        frust(x0, z0, x1, z1, y0, i1, hl, c1, true);
        return frust(x0 + i1, z0 + i1, x1 - i1, z1 - i1, y0 + hl, i2, hu, c2 || c1, false);
      },
      merge: function () {
        var m = B.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
        m.refreshBoundingInfo();
        return m;
      }
    };
    api.nTwr = 0;
    var oTwr = api.twr; api.twr = function () { api.nTwr++; return oTwr.apply(api, arguments); };
    // Эпоха «модерн»: конусы башенок — зелёная медь
    if (th === 1) {
      var mCyl = api.cyl;
      api.cyl = function (rt, rb, h, seg, color, x, y, z) { return mCyl(rt, rb, h, seg, rt < 0.001 && color === SLATE ? PAT : color, x, y, z); };
    }
    // Эпохи «ар-деко» и «баухаус» (с 0.19.0): вместо скатных крыш — другие формы. Высота крыши сохраняется,
    // чтобы флагштоки, шпили и башни стояли на своих местах.
    if (th === 2 || th === 3) {
      var oCyl = api.cyl, oSph = api.sph, oDome = api.dome;
      var STN = '#d6ccb4', STN2 = '#c9bea4', SLAB = '#ece9e0', wmB = K.wm('euro', '#f3f1ea', 3);
      api.crown = function (x0, z0, x1, z1, y0, rh) {
        var w = x1 - x0, d = z1 - z0, mn = Math.min(w, d), i, e, y;
        if (th === 2) { // ар-деко: ступенчатый «зиккурат» из светлого камня с золотой каймой, на башнях — золотой шпиль
          api.cube(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y0, 0.03, STN);
          api.cube(x0 - 0.034, z0 - 0.034, x1 + 0.034, z1 + 0.034, y0 + 0.02, 0.01, GOLD);
          var n = rh > 0.5 ? 3 : rh > 0.2 ? 2 : 1, hh = Math.max(0.03, (rh - 0.03) / n), st = Math.min(mn * 0.17, 0.13);
          y = y0 + 0.03; e = 0;
          for (i = 0; i < n; i++) {
            e = Math.max(0, Math.min(st * (i + 0.7), (mn - 0.07) / 2));
            api.cube(x0 + e, z0 + e, x1 - e, z1 - e, y, hh, i % 2 ? STN2 : STN);
            api.cube(x0 + e - 0.008, z0 + e - 0.008, x1 - e + 0.008, z1 - e + 0.008, y + hh - 0.012, 0.012, GOLD);
            y += hh;
          }
          if (mn - 2 * e < 0.45 && rh > 0.2) { var mh = 0.24 + rh * 0.3; oCyl(0.005, 0.013, mh, 6, GOLD, (x0 + x1) / 2, y + mh / 2, (z0 + z1) / 2); }
          return y;
        }
        // баухаус: плита перекрытия с вылетом и отступной этаж-терраса с ленточными окнами
        api.cube(x0 - 0.025, z0 - 0.025, x1 + 0.025, z1 + 0.025, y0, 0.03, SLAB);
        y = y0 + 0.03;
        if (rh >= 0.16 && mn > 0.3) {
          e = Math.min(0.12, mn * 0.2);
          var fl = Math.max(1, Math.round(rh * 0.78 / 0.3)), ph = fl * 0.3, ww = w - 2 * e, dd = d - 2 * e;
          var uw = Math.max(1, Math.round(ww / 0.5)), ud = Math.max(1, Math.round(dd / 0.5));
          function V(a, b, c, d2) { return new B.Vector4(a, b, c, d2); }
          var CP = V(0.02, 0.02, 0.03, 0.03);
          api.box(ww, ph, dd, K.wall(wmB[0], wmB[1]), (x0 + x1) / 2, y + ph / 2, (z0 + z1) / 2, [V(0, 0, uw, fl), V(0, 0, uw, fl), V(0, 0, ud, fl), V(0, 0, ud, fl), CP, CP]);
          y += ph;
          api.cube(x0 + e - 0.03, z0 + e - 0.03, x1 - e + 0.03, z1 - e + 0.03, y, 0.03, SLAB); y += 0.03;
        }
        return y;
      };
      api.gable = function (x0, z0, x1, z1, y0, rh) { return api.crown(x0, z0, x1, z1, y0, rh); };
      api.hip = function (x0, z0, x1, z1, y0, rh) { return api.crown(x0, z0, x1, z1, y0, rh); };
      api.mansard = function (x0, z0, x1, z1, y0, hl, hu) { return api.crown(x0, z0, x1, z1, y0, hl + hu); };
      api.cyl = function (rt, rb, h, seg, color, x, y, z) {
        var cone = rt < 0.001 && (color === PAT || color === SLATE);
        if (th === 2) return oCyl(rt, rb, h, seg, cone ? GOLD : color, x, y, z);                                  // шпиль — золотой
        if (cone) return oCyl(rb * 1.05, rb * 1.05, 0.03, seg, SLAB, x, y - h / 2 + 0.015, z);                    // конус → плоская крышка
        if (color === GOLD) return oCyl(0.0005, 0.0005, 0.001, 3, GOLD, x, y, z);                                  // золотые шпили и флюгера в баухаусе не нужны
        return oCyl(rt, rb, h, seg, color, x, y, z);
      };
      api.sph = function (rad, color, x, y, z, sy) { return th === 3 && color === GOLD ? oSph(0.001, GOLD, x, y, z, 1) : oSph(rad, color, x, y, z, sy); };
      api.dome = function (rad, color, x, y, z, sy) { return th === 3 ? oCyl(rad, rad, 0.14, 16, SLAB, x, y + 0.07, z) : oDome(rad, GOLD, x, y, z, sy); };
    }
    return api;
  }

  function buildModel(K, cat, size, seed, th) {
    th = th | 0;
    var s = G.sizes[size], W = s.w, D = s.d, m = 0.08;
    var r = rng(seed), S = Shapes(K, W / 2, D / 2, th), cube = S.cube;
    function kwall(style, col) { var q = K.wm(style, col, th); return K.wall(q[0], q[1]); } // стена в выбранном оформлении
    var F = [m, m, W - m, D - m], bw = { a: 0, top: 0 };
    function V4(a, b, c, d) { return new B.Vector4(a, b, c, d); }
    var CAP = V4(0.02, 0.02, 0.03, 0.03);
    // ---- общие детали ----
    // стены с окнами: этажи по fl штук, высота этажа fh; возвращает высоту верха
    function wallBox(x0, z0, x1, z1, y0, fl, style, col, fh) {
      fh = fh || FH; var q = K.wm(style, col, th); style = q[0]; col = q[1];
      var h = fl * fh, w = x1 - x0, d = z1 - z0, tw = TILE[style][0];
      if (w * d >= bw.a) bw = { a: w * d, x0: x0, z0: z0, x1: x1, z1: z1, top: y0 + h };   // самый большой корпус — для угловой башенки модерна
      var uw = Math.max(1, Math.round(w / tw)), ud = Math.max(1, Math.round(d / tw));
      S.box(w, h, d, K.wall(style, col), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2, [V4(0, 0, uw, fl), V4(0, 0, uw, fl), V4(0, 0, ud, fl), V4(0, 0, ud, fl), CAP, CAP]);
      return y0 + h;
    }
    function chim(x, z, y0, h) {
      if (th >= 2) return;   // ар-деко и баухаус: без печных труб
      cube(x - 0.035, z - 0.03, x + 0.035, z + 0.03, y0, h, '#9a4b35'); cube(x - 0.047, z - 0.042, x + 0.047, z + 0.042, y0 + h, 0.025, '#d9d2c2'); cube(x - 0.03, z - 0.025, x + 0.03, z + 0.025, y0 + h + 0.025, 0.012, '#2b2b2b');
    }
    function flag(x, y, z, color) {
      S.cyl(0.015, 0.015, 0.6, 6, '#c9ccd1', x, y + 0.3, z);
      S.box(0.26, 0.15, 0.01, K.mat(color || '#c8342c'), x + 0.14, y + 0.51, z);
    }
    function tree(x, z, k) { k = k || 1; S.cyl(0.025 * k, 0.035 * k, 0.16 * k, 6, '#6b4a2e', x, 0.08 * k, z); S.sph(0.13 * k, '#4f8f4a', x, 0.27 * k, z, 1); }
    function cornice(x0, z0, x1, z1, y, col) { if (th === 3) return; cube(x0 - 0.035, z0 - 0.035, x1 + 0.035, z1 + 0.035, y, 0.04, th === 2 ? '#d6ccb4' : col || STONE); }
    function sband(x0, z0, x1, z1, y, col) { if (th === 3) return; cube(x0 - 0.015, z0 - 0.015, x1 + 0.015, z1 + 0.015, y, 0.018, th === 2 ? GOLD : col || STONE); }
    // чугунные балконы по сторонам: f — перед (+z), b — зад, l — слева, r — справа
    function balc(x0, z0, x1, z1, y, sides) {
      var BS = th === 3 ? '#f1eee6' : th === 2 ? '#2a2d32' : '#383c42', IRON = th === 3 ? '#4c525a' : th === 2 ? GOLD : '#2b2f35', e = 0.06;
      if (sides.indexOf('f') >= 0) { cube(x0, z1, x1, z1 + e, y, 0.022, BS); cube(x0, z1 + e - 0.008, x1, z1 + e, y + 0.022, 0.045, IRON); }
      if (sides.indexOf('b') >= 0) { cube(x0, z0 - e, x1, z0, y, 0.022, BS); cube(x0, z0 - e, x1, z0 - e + 0.008, y + 0.022, 0.045, IRON); }
      if (sides.indexOf('l') >= 0) { cube(x0 - e, z0, x0, z1, y, 0.022, BS); cube(x0 - e, z0, x0 - e + 0.008, z1, y + 0.022, 0.045, IRON); }
      if (sides.indexOf('r') >= 0) { cube(x1, z0, x1 + e, z1, y, 0.022, BS); cube(x1 + e - 0.008, z0, x1 + e, z1, y + 0.022, 0.045, IRON); }
    }
    // полосатый тент над витриной
    function awning(x0, x1, z, y, dp, ca, cb) {
      var n = Math.max(2, Math.round((x1 - x0) / 0.1)), w = (x1 - x0) / n;
      for (var i = 0; i < n; i++) S.bake(S.box(w, 0.012, dp, K.mat(i % 2 ? cb : ca), x0 + (i + 0.5) * w, y, z + dp / 2), 0.45, 0, 0);
      cube(x0, z + dp - 0.005, x1, z + dp + 0.005, y - dp * 0.4 - 0.012, 0.02, ca);
    }
    // слуховое окно с двускатной крышей; (fx,fz) — центр лицевой стенки на скате, dir: 0 +z, 1 +x, 2 -z, 3 -x
    function dorm(fx, fz, yb, dir, wc, rc) {
      if (th >= 2) return;
      var w = 0.13, h = 0.14, dp = 0.1, dx = [0, 1, 0, -1][dir], dz = [1, 0, -1, 0][dir];
      var cx = fx - dx * dp / 2, cz = fz - dz * dp / 2, bw = dir % 2 ? dp : w, bd = dir % 2 ? w : dp, fu = [0, 2, 1, 3][dir], uv = [CAP, CAP, CAP, CAP, CAP, CAP];
      uv[fu] = V4(0, 0, 1, 1);
      S.box(bw, h, bd, kwall('dorm', wc), cx, yb + h / 2, cz, uv);
      S.gable(cx - bw / 2, cz - bd / 2, cx + bw / 2, cz + bd / 2, yb + h, 0.07, rc, dir % 2 ? 'x' : 'z', 0.02, wc);
    }
    // ряд слуховых окон по скату мансарды (стороны sides), n — по шагу ≈ 0.46
    function mdorms(X0, Z0, X1, Z1, y0, hl, i1, wc, rc, sides, yd) {
      yd = yd || 0.045; var ins = i1 * yd / hl;
      function row(a0, a1, fixed, dir, alongX) {
        var n = Math.max(1, Math.round((a1 - a0) / 0.46));
        for (var k = 0; k < n; k++) { var a = a0 + (k + 0.5) * (a1 - a0) / n; if (alongX) dorm(a, fixed, y0 + yd, dir, wc, rc); else dorm(fixed, a, y0 + yd, dir, wc, rc); }
      }
      if (sides.indexOf('f') >= 0) row(X0 + 0.1, X1 - 0.1, Z1 - ins, 0, true);
      if (sides.indexOf('b') >= 0) row(X0 + 0.1, X1 - 0.1, Z0 + ins, 2, true);
      if (sides.indexOf('l') >= 0) row(Z0 + 0.1, Z1 - 0.1, X0 + ins, 3, false);
      if (sides.indexOf('r') >= 0) row(Z0 + 0.1, Z1 - 0.1, X1 - ins, 1, false);
    }
    function mans(x0, z0, x1, z1, y, hl, hu, i1, i2, col, col2, wc, sides) { // карниз + мансарда + слуховые окна
      cube(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y, 0.04, th === 3 ? '#ece9e0' : th === 2 ? '#d6ccb4' : STONE);
      S.mansard(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y + 0.04, hl, hu, i1, i2, col, col2);
      if (sides) mdorms(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y + 0.04, hl, i1, wc || '#cfc6b2', col, sides);
      return y + 0.04 + hl + hu;
    }
    function cross(x, y, z, color, flat) { // крест
      if (flat) { cube(x - 0.25, z - 0.07, x + 0.25, z + 0.07, y, 0.03, color); cube(x - 0.07, z - 0.25, x + 0.07, z + 0.25, y, 0.03, color); }
      else { cube(x - 0.1, z - 0.012, x + 0.1, z + 0.012, y - 0.03, 0.06, color); cube(x - 0.03, z - 0.012, x + 0.03, z + 0.012, y - 0.1, 0.2, color); }
    }
    function door(x0, x1, z, h, col) { cube(x0, z - 0.006, x1, z + 0.008, 0, h, th === 3 ? '#c8483a' : th === 2 ? '#2b2a30' : col || '#4a3322'); }
    function steps(x0, x1, z, n, wd) { for (var i = 0; i < n; i++) cube(x0 - i * 0.01, z + (n - 1 - i) * wd, x1 + i * 0.01, z + (n - i) * wd + 0.01, 0, 0.022 * (i + 1), STONE2); }
    function lamp(x, z, h) { // газовый фонарь
      h = h || 0.32; S.cyl(0.008, 0.012, h, 6, '#1f3a2f', x, h / 2, z); S.cyl(0.02, 0.014, 0.012, 6, '#1f3a2f', x, 0.02, z); S.sph(0.026, '#fff1b8', x, h + 0.02, z, 1.2);
    }
    function pavilionRoof(x0, z0, x1, z1, y, rh, col) { S.hip(x0, z0, x1, z1, y, rh, col, 0.04); }

    var wc, rc, br, st;
    if (cat === 'res') {
      wc = pick(r, RES_WALL); rc = pick(r, RES_ROOF); br = BRICKS.indexOf(wc) >= 0; st = br ? 'brick' : 'euro';
      if (size === '1x1') { // вилла начала века: щипцовая крыша, эркер, труба, палисадник
        var y1 = wallBox(0.12, 0.16, 0.88, 0.84, 0, 2, st, wc);
        cube(0.1, 0.14, 0.9, 0.86, 0, 0.05, STONE2); sband(0.12, 0.16, 0.88, 0.84, 0.3, br ? STONE : TRIM);
        S.gable(0.12, 0.16, 0.88, 0.84, y1, 0.3, rc, 'x', 0.05, wc);
        var by = wallBox(0.3, 0.84, 0.62, 0.95, 0, 1, st, wc); S.hip(0.3, 0.84, 0.62, 0.95, by, 0.12, rc, 0.02);
        door(0.7, 0.8, 0.842, 0.19); S.gable(0.67, 0.84, 0.83, 0.93, 0.2, 0.05, rc, 'z', 0.015);
        chim(0.22, 0.5, y1, 0.42);
        cube(0.08, 0.96, 0.92, 0.974, 0.02, 0.014, TRIM); cube(0.08, 0.96, 0.92, 0.974, 0.065, 0.014, TRIM);
        [0.1, 0.3, 0.5, 0.7, 0.9].forEach(function (x) { cube(x - 0.01, 0.958, x + 0.01, 0.976, 0, 0.08, TRIM); });
        tree(0.2, 0.91, 0.55);
      } else if (size === '2x1') { // дом на две семьи: две половины, каждая со своим щипцом, эркером и входом
        var wc2 = pick(r, RES_WALL), st2 = BRICKS.indexOf(wc2) >= 0 ? 'brick' : 'euro';
        var yy = wallBox(0.1, 0.14, 1.0, 0.86, 0, 2, st, wc); wallBox(1.0, 0.14, 1.9, 0.86, 0, 2, st2, wc2);
        cube(0.08, 0.12, 1.92, 0.88, 0, 0.05, STONE2);
        S.gable(0.1, 0.14, 1.0, 0.86, yy, 0.3, rc, 'z', 0.03, wc); S.gable(1.0, 0.14, 1.9, 0.86, yy, 0.3, rc, 'z', 0.03, wc2);
        [[0.28, 0.58, st, wc], [1.42, 1.72, st2, wc2]].forEach(function (e) { var q = wallBox(e[0], 0.86, e[1], 0.96, 0, 1, e[2], e[3]); S.hip(e[0], 0.86, e[1], 0.96, q, 0.11, rc, 0.02); });
        door(0.72, 0.82, 0.862, 0.19); S.gable(0.69, 0.86, 0.85, 0.94, 0.2, 0.05, rc, 'z', 0.015);
        door(1.18, 1.28, 0.862, 0.19); S.gable(1.15, 0.86, 1.31, 0.94, 0.2, 0.05, rc, 'z', 0.015);
        chim(1.0, 0.5, yy, 0.4); chim(0.4, 0.4, yy + 0.05, 0.28); chim(1.6, 0.4, yy + 0.05, 0.28);
        tree(0.2, 0.93, 0.5); tree(1.8, 0.93, 0.5);
      } else if (size === '2x2') { // доходный дом в духе османовского Парижа: рустованный цоколь, балконы, мансарда с окнами, трубы
        var a = m, b = W - m, y2 = wallBox(a, a, b, b, 0, 1, 'arcade', '#ddd2bb', 0.34), y3 = wallBox(a, a, b, b, y2, 4, st, wc);
        sband(a, a, b, b, y2 - 0.012, STONE); cornice(a, a, b, b, y3 - 0.005, STONE);
        balc(a + 0.04, a + 0.04, b - 0.04, b - 0.04, y2, 'fblr'); balc(a + 0.04, a + 0.04, b - 0.04, b - 0.04, y3 - 0.3, 'fb');
        var yt = mans(a, a, b, b, y3 + 0.035, 0.26, 0.07, 0.14, 0.2, ZINC, ZINC2, '#cfc6b2', 'fbrl');
        [[0.62, 0.62], [1.38, 0.62], [0.62, 1.38], [1.38, 1.38]].forEach(function (c) { chim(c[0], c[1], yt - 0.03, 0.2); });
        door(0.86, 1.14, b + 0.001, 0.26, '#2c241c'); cube(0.8, b, 1.2, b + 0.05, 0.28, 0.03, STONE);
      } else { // жилой комплекс: квартал с внутренним двором, сквозная арка, угловые башенки
        var CORN = [[m, m, 1.0, 1.0], [3.0, m, W - m, 1.0], [m, 3.0, 1.0, D - m], [3.0, 3.0, W - m, D - m]];
        var WING = [[1.0, m, 3.0, 1.0, 'z'], [1.0, 3.0, 3.0, D - m, 'z'], [m, 1.0, 1.0, 3.0, 'x'], [3.0, 1.0, W - m, 3.0, 'x']];
        var base = 0.34, ytw = 0, ytc = 0;
        CORN.forEach(function (c) {
          var q = wallBox(c[0], c[1], c[2], c[3], 0, 1, 'arcade', '#ddd2bb', base); ytc = wallBox(c[0], c[1], c[2], c[3], q, 5, st, wc);
          cornice(c[0], c[1], c[2], c[3], ytc - 0.005, STONE); S.hip(c[0], c[1], c[2], c[3], ytc + 0.035, 0.38, ZINC, 0.05);
        });
        WING.forEach(function (w, i) {
          var x0 = w[0], z0 = w[1], x1 = w[2], z1 = w[3];
          if (i === 1) { // передний корпус с аркой посередине
            wallBox(x0, z0, 1.8, z1, 0, 1, 'arcade', '#ddd2bb', base); wallBox(2.2, z0, x1, z1, 0, 1, 'arcade', '#ddd2bb', base);
            cube(1.8, z0, 2.2, z1, 0, 0.012, '#6c6760'); cube(1.8, z0, 1.82, z1, 0, base, STONE2); cube(2.18, z0, 2.2, z1, 0, base, STONE2);
            cube(1.8, z0 + 0.4, 2.2, z0 + 0.42, 0, 0.3, '#15181c');
            cube(1.78, z0, 2.22, z1, 0.3, 0.04, STONE);
            ytw = wallBox(x0, z0, x1, z1, base, 4, st, wc);
          } else { var q2 = wallBox(x0, z0, x1, z1, 0, 1, 'arcade', '#ddd2bb', base); ytw = wallBox(x0, z0, x1, z1, q2, 4, st, wc); }
          cornice(x0, z0, x1, z1, ytw - 0.005, STONE);
          S.gable(x0, z0, x1, z1, ytw + 0.035, 0.3, i % 2 ? ZINC : ZINC2, w[4], 0.05, STONE2);
        });
        balc(1.0, 3.0, 3.0, D - m, base, 'f');
        // двор: газон, дорожки, фонтан, деревья
        cube(1.04, 1.04, 2.96, 2.96, 0, 0.02, '#7fb25e'); cube(1.96, 1.04, 2.04, 2.96, 0.02, 0.006, '#d9cfb7'); cube(1.04, 1.96, 2.96, 2.04, 0.02, 0.006, '#d9cfb7');
        S.cyl(0.22, 0.24, 0.07, 14, '#cfc9bb', 2.0, 0.055, 2.0); S.cyl(0.19, 0.19, 0.01, 14, '#7fc1e0', 2.0, 0.095, 2.0); S.cyl(0.02, 0.03, 0.18, 8, '#cfc9bb', 2.0, 0.17, 2.0);
        tree(1.35, 1.35, 0.9); tree(2.65, 1.35, 0.9); tree(1.35, 2.65, 0.9); tree(2.65, 2.65, 0.9);
        // угловые башенки в стиле ар-нуво
        [[0.17, 3.83], [3.83, 0.17]].forEach(function (p) {
          S.twr(0.17, 1.0, 10, kwall('euro', wc), p[0], 0.9, p[1], 2, 3);
          S.cyl(0.19, 0.19, 0.03, 10, STONE, p[0], 1.9, p[1]); S.cyl(0, 0.2, 0.5, 10, PAT, p[0], 2.17, p[1]); S.sph(0.025, GOLD, p[0], 2.46, p[1], 1);
        });
        [[1.5, 0.55], [2.5, 0.55], [0.55, 1.5], [3.45, 1.5], [0.55, 2.5], [3.45, 2.5]].forEach(function (c) { chim(c[0], c[1], 1.5, 0.3); });
      }
    } else if (cat === 'social') {
      if (size === '1x1') { // аптека в стиле модерн: зелёная витрина, ступенчатый фронтон, подвесной крест
        var g1 = wallBox(0.1, 0.16, 0.9, 0.84, 0, 1, 'shop', '#2f6f55', 0.36), g2 = wallBox(0.1, 0.16, 0.9, 0.84, g1, 1, 'euro', '#efe6cc');
        sband(0.1, 0.16, 0.9, 0.84, g1 - 0.01, STONE);
        cube(0.1, 0.78, 0.9, 0.86, g2, 0.09, '#efe6cc'); cube(0.22, 0.78, 0.78, 0.86, g2 + 0.09, 0.09, '#efe6cc'); cube(0.36, 0.78, 0.64, 0.86, g2 + 0.18, 0.08, '#efe6cc');
        cube(0.08, 0.76, 0.92, 0.88, g2 + 0.085, 0.012, STONE); cube(0.2, 0.76, 0.8, 0.88, g2 + 0.175, 0.012, STONE); S.sph(0.03, GOLD, 0.5, g2 + 0.3, 0.82, 1);
        S.gable(0.1, 0.16, 0.9, 0.84, g2, 0.26, TILEC, 'z', 0.0, '#efe6cc');
        awning(0.14, 0.86, 0.84, 0.33, 0.1, '#2f6f55', '#f1ece0');
        cube(0.93, 0.84, 0.97, 0.9, 0.47, 0.02, IRON);
        cube(0.9, 0.9, 0.99, 0.914, 0.42, 0.03, '#2fa64a'); cube(0.935, 0.9, 0.955, 0.914, 0.36, 0.09, '#2fa64a');
        chim(0.78, 0.4, g2, 0.38);
      } else if (size === '2x1') { // детский сад: невысокий дом в стиле «города-сада», высокая черепичная крыша, фонарь, площадка
        var yk = wallBox(0.1, 0.12, 1.9, 0.62, 0, 1, 'euro', '#f3e4b4', 0.4);
        cube(0.08, 0.1, 1.92, 0.64, 0, 0.05, STONE2);
        S.hip(0.1, 0.12, 1.9, 0.62, yk, 0.36, '#c25a35', 0.06);
        dorm(0.55, 0.56, yk + 0.02, 0, '#f3e4b4', '#c25a35'); dorm(1.45, 0.56, yk + 0.02, 0, '#f3e4b4', '#c25a35');
        wallBox(0.75, 0.62, 1.25, 0.78, 0, 1, 'euro', '#f8edc9', 0.32); S.gable(0.75, 0.62, 1.25, 0.78, 0.32, 0.16, '#c25a35', 'z', 0.03, '#f8edc9');
        door(0.93, 1.07, 0.782, 0.2, '#3f7f9c'); steps(0.9, 1.1, 0.78, 2, 0.04);
        chim(0.35, 0.3, yk + 0.12, 0.3); chim(1.65, 0.3, yk + 0.12, 0.3);
        cube(0.06, 0.82, 0.9, 0.834, 0.02, 0.012, TRIM); cube(1.1, 0.82, 1.94, 0.834, 0.02, 0.012, TRIM);
        [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 1.9].forEach(function (x) { cube(x - 0.008, 0.818, x + 0.008, 0.836, 0, 0.07, TRIM); });
        cube(0.2, 0.86, 0.55, 0.96, 0, 0.025, '#e6cf8f');                                                    // песочница
        cube(1.4, 0.88, 1.43, 0.91, 0, 0.2, '#7a5634'); cube(1.7, 0.88, 1.73, 0.91, 0, 0.2, '#7a5634'); cube(1.4, 0.88, 1.73, 0.91, 0.2, 0.025, '#7a5634'); // качели
        tree(1.1, 0.93, 0.5);
      } else if (size === '2x2') { // школа: красный кирпич с каменными поясами, часовая башня с медным шпилем
        var BR = '#a64f3a', ysc = wallBox(0.08, 0.95, 1.92, 1.92, 0, 3, 'archb', BR);
        wallBox(0.08, 0.08, 0.7, 0.95, 0, 3, 'archb', BR); wallBox(1.3, 0.08, 1.92, 0.95, 0, 3, 'archb', BR);
        [[0.08, 0.95, 1.92, 1.92], [0.08, 0.08, 0.7, 0.95], [1.3, 0.08, 1.92, 0.95]].forEach(function (q) { sband(q[0], q[1], q[2], q[3], 0.29, STONE); sband(q[0], q[1], q[2], q[3], 0.59, STONE); cornice(q[0], q[1], q[2], q[3], ysc - 0.005, STONE); });
        S.gable(0.08, 0.95, 1.92, 1.92, ysc + 0.035, 0.3, SLATE, 'x', 0.05, BR);
        S.gable(0.08, 0.08, 0.7, 0.95, ysc + 0.035, 0.28, SLATE, 'z', 0.04, BR); S.gable(1.3, 0.08, 1.92, 0.95, ysc + 0.035, 0.28, SLATE, 'z', 0.04, BR);
        var yw = wallBox(0.78, 1.48, 1.22, 1.94, 0, 5, 'archb', BR); sband(0.78, 1.48, 1.22, 1.94, 0.29, STONE); sband(0.78, 1.48, 1.22, 1.94, 0.59, STONE);
        S.box(0.4, 0.4, 0.5, kwall('clock', '#e0d7c2'), 1.0, yw + 0.2, 1.71, [V4(0, 0, 1, 1), V4(0, 0, 1, 1), CAP, CAP, CAP, CAP]);
        cornice(0.78, 1.48, 1.22, 1.94, yw + 0.4, STONE); S.hip(0.76, 1.46, 1.24, 1.96, yw + 0.44, 0.5, PAT, 0.04);
        S.cyl(0.006, 0.012, 0.18, 6, GOLD, 1.0, yw + 0.44 + 0.5 + 0.08, 1.71); flag(1.0, yw + 1.05, 1.71, '#c8342c');
        door(0.9, 1.1, 1.945, 0.2); steps(0.84, 1.16, 1.94, 2, 0.03);
        cube(0.7, 0.08, 1.3, 0.95, 0, 0.012, '#cdbf9b'); tree(1.0, 0.45, 0.7);
        chim(0.5, 1.4, ysc + 0.04, 0.3); chim(1.5, 1.4, ysc + 0.04, 0.3); chim(0.4, 0.4, ysc + 0.04, 0.26); chim(1.6, 0.4, ysc + 0.04, 0.26);
      } else { // больница-павильон: центральный корпус с медным куполом, боковые крылья, красный крест, навес приёма
        var HS = '#ede5d1', yh = wallBox(1.4, 2.0, 2.6, 3.78, 0, 4, 'gov', HS);
        cornice(1.4, 2.0, 2.6, 3.78, yh - 0.005, STONE); sband(1.4, 2.0, 2.6, 3.78, 0.5, STONE2);
        var yl = wallBox(0.08, 2.4, 1.4, 3.78, 0, 3, 'gov', HS); var yr2 = wallBox(2.6, 2.4, 3.92, 3.78, 0, 3, 'gov', HS);
        cornice(0.08, 2.4, 1.4, 3.78, yl - 0.005, STONE); cornice(2.6, 2.4, 3.92, 3.78, yl - 0.005, STONE);
        S.hip(0.08, 2.4, 1.4, 3.78, yl + 0.035, 0.28, SLATE, 0.05); S.hip(2.6, 2.4, 3.92, 3.78, yl + 0.035, 0.28, SLATE, 0.05);
        var BRH = '#b05a40';
        wallBox(0.08, 0.08, 1.0, 2.4, 0, 3, 'brick', BRH); wallBox(3.0, 0.08, 3.92, 2.4, 0, 3, 'brick', BRH);
        [[0.08, 0.08, 1.0, 2.4], [3.0, 0.08, 3.92, 2.4]].forEach(function (q) { cornice(q[0], q[1], q[2], q[3], 0.895, STONE); S.gable(q[0], q[1], q[2], q[3], 0.935, 0.3, SLATE, 'z', 0.04, BRH); sband(q[0], q[1], q[2], q[3], 0.29, STONE); sband(q[0], q[1], q[2], q[3], 0.59, STONE); });
        S.hip(1.4, 2.0, 2.6, 3.78, yh + 0.035, 0.3, SLATE, 0.05);
        S.cyl(0.3, 0.3, 0.26, 14, HS, 2.0, yh + 0.035 + 0.3 + 0.0, 2.9); S.dome(0.31, PAT, 2.0, yh + 0.035 + 0.43, 2.9, 0.95);
        S.cyl(0.07, 0.09, 0.14, 10, HS, 2.0, yh + 0.035 + 0.43 + 0.3 + 0.05, 2.9); S.cyl(0, 0.08, 0.14, 10, PAT, 2.0, yh + 0.035 + 0.43 + 0.3 + 0.19, 2.9); S.sph(0.02, GOLD, 2.0, yh + 0.035 + 0.43 + 0.3 + 0.28, 2.9, 1);
        cross(2.0, 0.98, 3.785, RED, true); S.bake(S.box(0.5, 0.012, 0.14, K.mat(RED), 2.0, 1.0, 3.8), Math.PI / 2, 0, 0); S.bake(S.box(0.14, 0.012, 0.5, K.mat(RED), 2.0, 1.0, 3.8), Math.PI / 2, 0, 0);
        cube(1.6, 3.78, 2.4, 3.96, 0.42, 0.04, '#7a8a96'); [1.62, 2.38].forEach(function (x) { cube(x - 0.02, 3.9, x + 0.02, 3.94, 0, 0.42, STONE); });
        door(1.85, 2.15, 3.781, 0.3, '#3c4a52'); steps(1.7, 2.3, 3.78, 2, 0.05);
        cube(1.04, 0.1, 2.96, 2.38, 0, 0.02, '#7fb25e'); cube(1.96, 0.1, 2.04, 2.38, 0.02, 0.006, '#d9cfb7');
        S.cyl(0.2, 0.22, 0.07, 14, '#cfc9bb', 2.0, 1.2, 1.2); S.cyl(0.17, 0.17, 0.01, 14, '#7fc1e0', 2.0, 0.095, 1.2);
        tree(1.4, 0.5, 0.9); tree(2.6, 0.5, 0.9); tree(1.4, 1.9, 0.9); tree(2.6, 1.9, 0.9); tree(1.5, 1.2, 0.7); tree(2.5, 1.2, 0.7);
        chim(0.9, 0.5, 1.0, 0.3); chim(3.1, 0.5, 1.0, 0.3);
      }
    } else if (cat === 'gov') {
      if (size === '1x1') { // почтовое отделение: каменное здание с мансардой, часы и красная почтовая тумба
        var gp = wallBox(0.1, 0.16, 0.9, 0.84, 0, 1, 'arcade', '#e3dbc8', 0.34), yp = wallBox(0.1, 0.16, 0.9, 0.84, gp, 1, 'gov', '#e3dbc8');
        sband(0.1, 0.16, 0.9, 0.84, gp - 0.01, STONE); cube(0.3, 0.84, 0.7, 0.855, gp - 0.07, 0.06, '#2a4f8f');
        var ym = mans(0.1, 0.16, 0.9, 0.84, yp, 0.17, 0.05, 0.1, 0.16, ZINC, ZINC2, '#cfc6b2', 'f');
        S.box(0.16, 0.16, 0.1, kwall('clock', '#e3dbc8'), 0.5, yp + 0.12, 0.86, [V4(0, 0, 1, 1), V4(0, 0, 1, 1), CAP, CAP, CAP, CAP]);
        flag(0.14, ym - 0.04, 0.22, '#2a4f8f');
        S.cyl(0.045, 0.045, 0.16, 10, RED, 0.22, 0.08, 0.93); S.sph(0.045, RED, 0.22, 0.16, 0.93, 0.6);
        door(0.43, 0.57, 0.842, 0.22, '#3a2a1c');
      } else if (size === '2x1') { // полицейский участок: кирпич, угловая башенка, синий фонарь у входа
        var BP = '#a4533c', yq = wallBox(0.1, 0.14, 1.9, 0.86, 0, 3, 'archb', BP);
        sband(0.1, 0.14, 1.9, 0.86, 0.29, STONE); sband(0.1, 0.14, 1.9, 0.86, 0.59, STONE); cornice(0.1, 0.14, 1.9, 0.86, yq - 0.005, STONE);
        S.hip(0.1, 0.14, 1.9, 0.86, yq + 0.035, 0.34, SLATE, 0.05);
        wallBox(0.78, 0.72, 1.22, 0.96, 0, 3, 'archb', BP); cornice(0.78, 0.72, 1.22, 0.96, yq - 0.005, STONE); S.gable(0.78, 0.72, 1.22, 0.96, yq + 0.035, 0.2, SLATE, 'z', 0.03, BP);
        door(0.9, 1.1, 0.962, 0.22, '#2c3a52'); steps(0.84, 1.16, 0.96, 1, 0.02);
        S.twr(0.14, 0.9, 8, kwall('archb', BP), 0.2, 0, 0.74, 2, 3); S.cyl(0.16, 0.16, 0.03, 8, STONE, 0.2, 0.915, 0.74); S.cyl(0, 0.18, 0.32, 8, SLATE, 0.2, 1.09, 0.74);
        S.cyl(0.006, 0.006, 0.22, 6, IRON, 0.74, 0.11, 0.97); S.sph(0.035, '#3f8cf0', 0.74, 0.28, 0.97, 1.2);
        chim(0.45, 0.4, yq, 0.4); chim(1.55, 0.4, yq, 0.4); flag(1.0, yq + 0.2, 0.5, '#2a4f8f');
      } else if (size === '2x2') { // здание суда: неоклассика, портик из шести колонн с фронтоном, купол-фонарь
        cube(0.06, 1.5, 1.94, 1.96, 0, 0.06, STONE2);
        var yc = wallBox(0.08, 0.08, 1.92, 1.55, 0, 3, 'gov', '#e8e2d2'); cornice(0.08, 0.08, 1.92, 1.55, yc - 0.005, STONE);
        S.hip(0.08, 0.08, 1.92, 1.55, yc + 0.035, 0.22, SLATE, 0.04);
        for (var kcol = 0; kcol < 6; kcol++) { var cxk = 0.45 + kcol * 0.22; S.cyl(0.032, 0.036, 0.78, 10, TRIM, cxk, 0.06 + 0.39, 1.82); S.cyl(0.048, 0.04, 0.03, 10, STONE, cxk, 0.855, 1.82); S.cyl(0.044, 0.044, 0.02, 10, STONE, cxk, 0.065, 1.82); }
        cube(0.36, 1.58, 1.64, 1.94, 0.87, 0.07, STONE); S.gable(0.34, 1.56, 1.66, 1.96, 0.94, 0.17, STONE, 'z', 0.0, '#f0ebdc');
        cube(0.4, 1.9, 1.6, 1.98, 0.0, 0.03, STONE2); door(0.88, 1.12, 1.552, 0.42, '#3a2a1c');
        S.cyl(0.2, 0.2, 0.22, 12, STONE, 1.0, yc + 0.035 + 0.14, 0.82); S.dome(0.2, PAT, 1.0, yc + 0.035 + 0.25, 0.82, 0.95); S.cyl(0.006, 0.01, 0.16, 6, GOLD, 1.0, yc + 0.035 + 0.25 + 0.27, 0.82);
        flag(0.2, yc + 0.0, 0.3, '#c8342c');
      } else { // ратуша (акимат): часовая башня со шпилем, мансардные крылья, угловые башенки
        var HC = '#ece4d0', yt1 = wallBox(0.9, 0.5, 3.1, 3.8, 0, 4, 'gov', HC);
        cornice(0.9, 0.5, 3.1, 3.8, yt1 - 0.005, STONE); sband(0.9, 0.5, 3.1, 3.8, 0.5, STONE2);
        var ywng = wallBox(0.08, 1.2, 0.9, 3.8, 0, 3, 'gov', HC); wallBox(3.1, 1.2, 3.92, 3.8, 0, 3, 'gov', HC);
        cornice(0.08, 1.2, 0.9, 3.8, ywng - 0.005, STONE); cornice(3.1, 1.2, 3.92, 3.8, ywng - 0.005, STONE);
        mans(0.08, 1.2, 0.9, 3.8, ywng, 0.2, 0.05, 0.16, 0.18, ZINC, ZINC2, '#cfc6b2', 'f'); mans(3.1, 1.2, 3.92, 3.8, ywng, 0.2, 0.05, 0.16, 0.18, ZINC, ZINC2, '#cfc6b2', 'f');
        mans(0.9, 0.5, 3.1, 3.8, yt1, 0.3, 0.08, 0.3, 0.4, SLATE, '#5a636d', '#cfc6b2', 'fbrl');
        var ytw2 = wallBox(1.7, 3.0, 2.3, 3.7, yt1 - 0.4 + 0.4, 5, 'gov', HC);          // башня
        cornice(1.7, 3.0, 2.3, 3.7, ytw2 - 0.005, STONE);
        S.box(0.5, 0.42, 0.5, kwall('clock', '#e8dfc9'), 2.0, ytw2 + 0.21, 3.35, [V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), CAP, CAP]);
        cornice(1.72, 3.02, 2.28, 3.68, ytw2 + 0.42, STONE);
        var ybf = wallBox(1.76, 3.06, 2.24, 3.64, ytw2 + 0.46, 1, 'arcade', '#e8dfc9', 0.3);
        S.hip(1.7, 3.0, 2.3, 3.7, ybf + 0.0, 0.75, PAT, 0.05); S.cyl(0.008, 0.014, 0.28, 6, GOLD, 2.0, ybf + 0.75 + 0.12, 3.35); S.sph(0.03, GOLD, 2.0, ybf + 0.75 + 0.06, 3.35, 1);
        steps(1.55, 2.45, 3.78, 3, 0.04); door(1.85, 2.15, 3.781, 0.34, '#3c2a1c'); balc(1.75, 3.7, 2.25, 3.78, 0.45, 'f');
        [[0.2, 3.7], [3.8, 3.7]].forEach(function (p) {
          S.twr(0.14, 0.95, 10, kwall('gov', HC), p[0], 0, p[1], 2, 3); S.cyl(0.16, 0.16, 0.03, 10, STONE, p[0], 0.965, p[1]); S.cyl(0, 0.18, 0.4, 10, PAT, p[0], 1.18, p[1]);
        });
        flag(0.5, 1.3, 2.4, '#c8342c'); flag(3.5, 1.3, 2.4, '#c8342c');
        S.cyl(0.015, 0.02, 0.1, 6, '#6c6760', 2.0, 0.05, 3.95);
      }
    } else if (cat === 'army') {
      var ARM = '#9a4f3b';
      if (size === '1x1') { // блокпост: кирпичная караулка, полосатый шлагбаум, мешки с песком, флаг
        cube(0.06, 0.06, 0.94, 0.94, 0, 0.008, '#8c8678');
        var ya = wallBox(0.55, 0.28, 0.9, 0.7, 0, 1, 'brick', ARM, 0.4); cornice(0.55, 0.28, 0.9, 0.7, ya - 0.005, STONE); S.hip(0.55, 0.28, 0.9, 0.7, ya + 0.035, 0.2, SLATE, 0.04);
        door(0.66, 0.78, 0.702, 0.2, '#2f3a2c');
        cube(0.1, 0.6, 0.14, 0.66, 0, 0.3, '#444a52');
        for (var ib = 0; ib < 6; ib++) cube(0.14 + ib * 0.07, 0.585, 0.14 + (ib + 1) * 0.07, 0.625, 0.24, 0.045, ib % 2 ? '#d8262e' : '#f4f4ee');
        for (var is = 0; is < 5; is++) { cube(0.58 + is * 0.06, 0.74, 0.63 + is * 0.06, 0.82, 0, 0.05, '#cdbd8f'); if (is < 4) cube(0.61 + is * 0.06, 0.745, 0.66 + is * 0.06, 0.815, 0.05, 0.05, '#c2b283'); }
        flag(0.15, 0.2, 0.3, '#c8342c');
      } else if (size === '2x1') { // военкомат: охристое здание с вальмовой крышей и фронтоном над входом
        var yv = wallBox(0.1, 0.14, 1.9, 0.86, 0, 3, 'euro', '#e0c97a'); sband(0.1, 0.14, 1.9, 0.86, 0.29, TRIM); cornice(0.1, 0.14, 1.9, 0.86, yv - 0.005, STONE);
        S.hip(0.1, 0.14, 1.9, 0.86, yv + 0.035, 0.32, '#8f4636', 0.05);
        wallBox(0.75, 0.72, 1.25, 0.96, 0, 3, 'euro', '#e8d490'); cornice(0.75, 0.72, 1.25, 0.96, yv - 0.005, STONE); S.gable(0.75, 0.72, 1.25, 0.96, yv + 0.035, 0.2, '#8f4636', 'z', 0.03, '#e8d490');
        door(0.9, 1.1, 0.962, 0.24, '#3a2a1c'); steps(0.84, 1.16, 0.96, 2, 0.03);
        chim(0.45, 0.4, yv, 0.42); chim(1.55, 0.4, yv, 0.42); flag(1.0, yv + 0.2, 0.45, '#2f6b3a');
      } else if (size === '2x2') { // казарма: два кирпичных корпуса и плац с флагштоком, угловые башенки
        var yb2 = wallBox(0.08, 0.08, 1.92, 0.8, 0, 3, 'archb', ARM); wallBox(0.08, 1.2, 1.92, 1.92, 0, 3, 'archb', ARM); wallBox(0.08, 0.8, 0.5, 1.2, 0, 3, 'archb', ARM);
        [[0.08, 0.08, 1.92, 0.8], [0.08, 1.2, 1.92, 1.92], [0.08, 0.8, 0.5, 1.2]].forEach(function (q) { sband(q[0], q[1], q[2], q[3], 0.29, STONE); sband(q[0], q[1], q[2], q[3], 0.59, STONE); cornice(q[0], q[1], q[2], q[3], yb2 - 0.005, STONE); });
        S.hip(0.08, 0.08, 1.92, 0.8, yb2 + 0.035, 0.3, SLATE, 0.05); S.hip(0.08, 1.2, 1.92, 1.92, yb2 + 0.035, 0.3, SLATE, 0.05); S.gable(0.08, 0.8, 0.5, 1.2, yb2 + 0.035, 0.2, SLATE, 'z', 0.03, ARM);
        cube(0.5, 0.8, 1.92, 1.2, 0, 0.012, '#c8bb98'); S.cyl(0.012, 0.016, 0.55, 6, '#c9ccd1', 1.4, 0.275, 1.0); S.box(0.22, 0.13, 0.01, K.mat('#c8342c'), 1.51, 0.48, 1.0);
        [[1.8, 1.8], [1.8, 0.2]].forEach(function (p) { S.twr(0.12, 1.2, 8, kwall('archb', ARM), p[0], 0, p[1], 2, 4); S.cyl(0, 0.15, 0.3, 8, SLATE, p[0], 1.35, p[1]); });
        door(0.9, 1.1, 1.922, 0.22, '#2f3a2c');
      } else { // военная база: зубчатая каменная ограда, ворота между двумя круглыми башнями, казармы, плац, пушки
        var WALL = '#b8ae98', WH = 0.28, TH = 0.07;
        function wallRun(x0, z0, x1, z1) {
          var horiz = z0 === z1, len = horiz ? x1 - x0 : z1 - z0, n = Math.max(2, Math.round(len / 0.22)), q = len / n, i;
          if (horiz) cube(x0, z0 - TH / 2, x1, z0 + TH / 2, 0, WH, WALL); else cube(x0 - TH / 2, z0, x0 + TH / 2, z1, 0, WH, WALL);
          for (i = 0; i < n; i += 2) { if (horiz) cube(x0 + i * q, z0 - TH / 2, x0 + (i + 1) * q, z0 + TH / 2, WH, 0.06, WALL); else cube(x0 - TH / 2, z0 + i * q, x0 + TH / 2, z0 + (i + 1) * q, WH, 0.06, WALL); }
        }
        wallRun(0.12, 0.12, 3.88, 0.12); wallRun(0.12, 0.12, 0.12, 3.88); wallRun(3.88, 0.12, 3.88, 3.88); wallRun(0.12, 3.88, 1.6, 3.88); wallRun(2.4, 3.88, 3.88, 3.88);
        cube(0.14, 0.14, 3.86, 3.86, 0, 0.008, '#b8ad92');
        [[1.62, 3.88], [2.38, 3.88]].forEach(function (p) { S.twr(0.17, 0.72, 10, kwall('archb', '#a89a82'), p[0], 0, p[1], 2, 2); S.cyl(0.19, 0.19, 0.03, 10, STONE2, p[0], 0.735, p[1]); S.cyl(0, 0.21, 0.4, 10, SLATE, p[0], 0.95, p[1]); });
        cube(1.6, 3.82, 2.4, 3.94, 0.4, 0.06, '#a89a82'); cube(1.6, 3.82, 2.4, 3.94, 0.46, 0.04, WALL);
        S.cyl(0.006, 0.006, 0.4, 6, '#c9ccd1', 2.0, 0.66, 3.88); S.box(0.2, 0.12, 0.01, K.mat('#c8342c'), 2.11, 0.78, 3.88);
        var yb4 = wallBox(0.45, 0.5, 3.55, 1.4, 0, 3, 'archb', ARM); sband(0.45, 0.5, 3.55, 1.4, 0.29, STONE); sband(0.45, 0.5, 3.55, 1.4, 0.59, STONE); cornice(0.45, 0.5, 3.55, 1.4, yb4 - 0.005, STONE);
        S.hip(0.45, 0.5, 3.55, 1.4, yb4 + 0.035, 0.34, SLATE, 0.05);
        wallBox(1.7, 1.4, 2.3, 1.62, 0, 3, 'archb', ARM); S.gable(1.7, 1.4, 2.3, 1.62, yb4 + 0.035, 0.18, SLATE, 'z', 0.03, ARM);
        var yo = wallBox(2.9, 2.3, 3.7, 3.1, 0, 2, 'euro', '#ecd9a8'); S.hip(2.9, 2.3, 3.7, 3.1, yo, 0.28, '#8f4636', 0.05); chim(3.3, 2.7, yo + 0.1, 0.3);
        S.cyl(0.012, 0.016, 0.7, 6, '#c9ccd1', 2.0, 0.35, 2.55); S.box(0.28, 0.16, 0.01, K.mat('#c8342c'), 2.15, 0.62, 2.55);
        [[1.0, 3.2], [2.6, 3.4]].forEach(function (p, ig) {
          cube(p[0] - 0.14, p[1] - 0.04, p[0] + 0.14, p[1] + 0.04, 0.04, 0.05, '#4a3a2a'); S.bake(S.cyl(0.026, 0.034, 0.3, 8, '#3a3d42', p[0], 0.12, p[1] + 0.0), Math.PI / 2, ig ? 0.3 : -0.3, 0);
          S.bake(S.cyl(0.05, 0.05, 0.02, 10, '#2a2c30', p[0] - 0.15, 0.06, p[1] - 0.045), 0, 0, Math.PI / 2); S.bake(S.cyl(0.05, 0.05, 0.02, 10, '#2a2c30', p[0] - 0.15, 0.06, p[1] + 0.045), 0, 0, Math.PI / 2);
        });
        for (var ib2 = 0; ib2 < 3; ib2++) for (var ic = 0; ic < 3 - ib2; ic++) S.sph(0.04, '#3a3d42', 0.5 + ic * 0.09 + ib2 * 0.045, 0.04 + ib2 * 0.07, 3.3, 1);
        S.twr(0.16, 0.9, 8, kwall('archb', '#a89a82'), 0.35, 0, 3.6, 2, 3); S.cyl(0.19, 0.19, 0.03, 8, STONE2, 0.35, 0.915, 3.6); S.cyl(0, 0.2, 0.35, 8, SLATE, 0.35, 1.11, 3.6);
        chim(1.0, 0.95, yb4 + 0.1, 0.32); chim(3.0, 0.95, yb4 + 0.1, 0.32);
      }
    } else if (cat === 'corp') {
      if (size === '1x1') { // лавка с полосатым тентом, вывеской и ящиками фруктов
        var gs = wallBox(0.1, 0.16, 0.9, 0.84, 0, 1, 'shop', pick(r, ['#7a2f2f', '#2a3b52', '#35573f']), 0.36), ys = wallBox(0.1, 0.16, 0.9, 0.84, gs, 1, 'euro', '#f1dfb3');
        sband(0.1, 0.16, 0.9, 0.84, gs - 0.01, STONE);
        var yms = mans(0.1, 0.16, 0.9, 0.84, ys, 0.16, 0.05, 0.1, 0.16, ZINC, ZINC2, '#cfc6b2', 'f');
        awning(0.12, 0.88, 0.84, 0.34, 0.12, '#d9534f', '#f6efe0');
        cube(0.15, 0.92, 0.3, 0.98, 0, 0.05, '#a8844f'); cube(0.17, 0.93, 0.28, 0.97, 0.05, 0.02, '#d9733a'); cube(0.34, 0.92, 0.49, 0.98, 0, 0.05, '#a8844f'); cube(0.36, 0.93, 0.47, 0.97, 0.05, 0.02, '#6fae4a');
        chim(0.78, 0.4, ys + 0.02, 0.3);
      } else if (size === '2x1') { // торговая контора: каменный фасад, два эркера, чугунные окна, пологая мансарда
        var gc = wallBox(0.1, 0.14, 1.9, 0.86, 0, 1, 'shop', '#2a3b52', 0.36), yc2 = wallBox(0.1, 0.14, 1.9, 0.86, gc, 3, 'iron', '#e2d8c2');
        sband(0.1, 0.14, 1.9, 0.86, gc - 0.01, STONE); cornice(0.1, 0.14, 1.9, 0.86, yc2 - 0.005, STONE);
        [[0.3, 0.75], [1.25, 1.7]].forEach(function (e) { var q = wallBox(e[0], 0.86, e[1], 0.98, gc, 2, 'iron', '#e2d8c2'); S.hip(e[0] - 0.01, 0.85, e[1] + 0.01, 0.99, q, 0.14, PAT, 0.02); });
        mans(0.1, 0.14, 1.9, 0.86, yc2 + 0.035, 0.14, 0.05, 0.1, 0.2, ZINC, ZINC2, '#cfc6b2', 'f');
        awning(0.9, 1.1, 0.86, 0.33, 0.1, '#2a3b52', '#e6d9a8'); door(0.92, 1.08, 0.862, 0.26, '#2c241c');
        chim(0.5, 0.3, yc2 + 0.1, 0.25); chim(1.5, 0.3, yc2 + 0.1, 0.25);
      } else if (size === '2x2') { // универмаг в духе «Галери Лафайет»: чугунные окна, угловые башенки, большой стеклянный купол
        var gd = wallBox(0.08, 0.08, 1.92, 1.92, 0, 1, 'shop', '#2f3f58', 0.36), yd = wallBox(0.08, 0.08, 1.92, 1.92, gd, 5, 'iron', '#e6dcc4');
        sband(0.08, 0.08, 1.92, 1.92, gd - 0.01, STONE); cornice(0.08, 0.08, 1.92, 1.92, yd - 0.005, STONE); sband(0.08, 0.08, 1.92, 1.92, gd + 0.6, STONE);
        cube(0.08, 0.08, 1.92, 1.92, yd + 0.035, 0.02, '#8795a2');
        [[0.12, 0.12], [1.88, 0.12], [0.12, 1.88], [1.88, 1.88]].forEach(function (p) { S.twr(0.15, 0.4, 10, kwall('iron', '#e6dcc4'), p[0], yd + 0.03, p[1], 2, 1); S.cyl(0.17, 0.17, 0.03, 10, STONE, p[0], yd + 0.45, p[1]); S.cyl(0, 0.18, 0.32, 10, PAT, p[0], yd + 0.62, p[1]); S.sph(0.02, GOLD, p[0], yd + 0.8, p[1], 1); });
        S.cyl(0.5, 0.52, 0.18, 16, STONE2, 1.0, yd + 0.13, 1.0); S.dome(0.5, '#8fc3b4', 1.0, yd + 0.22, 1.0, 0.8); S.cyl(0.07, 0.09, 0.12, 10, STONE, 1.0, yd + 0.22 + 0.4 + 0.04, 1.0); S.sph(0.03, GOLD, 1.0, yd + 0.22 + 0.4 + 0.12, 1.0, 1);
        awning(0.2, 0.9, 1.92, 0.33, 0.1, '#a83a3a', '#f3ead3'); awning(1.1, 1.8, 1.92, 0.33, 0.1, '#a83a3a', '#f3ead3'); door(0.92, 1.08, 1.922, 0.26, '#2c241c');
      } else { // высотное здание начала века: арочный цоколь, ступенчатый башенный объём, часы, медный шпиль
        var gt = wallBox(0.08, 0.08, 3.92, 3.92, 0, 1, 'arcade', '#d8cdb5', 0.36), yt3 = wallBox(0.08, 0.08, 3.92, 3.92, gt, 3, 'iron', '#e4dac3');
        sband(0.08, 0.08, 3.92, 3.92, gt - 0.01, STONE); cornice(0.08, 0.08, 3.92, 3.92, yt3 - 0.005, STONE);
        [[0.08, 0.08], [3.0, 0.08], [0.08, 3.0], [3.0, 3.0]].forEach(function (p) { var q = wallBox(p[0], p[1], p[0] + 0.92, p[1] + 0.92, yt3, 1, 'iron', '#e4dac3'); S.hip(p[0], p[1], p[0] + 0.92, p[1] + 0.92, q, 0.3, PAT, 0.04); });
        cube(0.08, 0.08, 3.92, 3.92, yt3 + 0.035, 0.015, '#8795a2');
        var yt4 = wallBox(0.95, 0.95, 3.05, 3.05, yt3 + 0.035, 9, 'iron', '#e4dac3'); cornice(0.95, 0.95, 3.05, 3.05, yt4 - 0.005, STONE);
        var yt5 = wallBox(1.4, 1.4, 2.6, 2.6, yt4 + 0.035, 4, 'iron', '#e4dac3'); cornice(1.4, 1.4, 2.6, 2.6, yt5 - 0.005, STONE);
        S.box(0.7, 0.7, 0.7, kwall('clock', '#e6ddc7'), 2.0, yt5 + 0.4, 2.0, [V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), CAP, CAP]);
        cornice(1.65, 1.65, 2.35, 2.35, yt5 + 0.75, STONE);
        S.hip(1.65, 1.65, 2.35, 2.35, yt5 + 0.79, 0.85, PAT, 0.06); S.cyl(0.006, 0.014, 0.4, 6, GOLD, 2.0, yt5 + 0.79 + 0.85 + 0.15, 2.0); S.sph(0.04, GOLD, 2.0, yt5 + 0.79 + 0.85 + 0.0, 2.0, 1);
        for (var iw2 = 0; iw2 < 5; iw2++) awning(0.3 + iw2 * 0.7, 0.9 + iw2 * 0.7, 3.92, 0.35, 0.08, iw2 % 2 ? '#2f3f58' : '#a83a3a', '#f3ead3');
        door(1.8, 2.2, 3.922, 0.3, '#2c241c');
      }
    } else if (cat === 'factory') {
      // Механический завод 3×3: кирпичный цех с пилообразной крышей и арочными окнами, ворота, контора с часами, высокая труба, готовый грузовик во дворе
      var FB = '#a8482f', ROOF = '#6f7882', HH = 0.9, RH = 0.3, ZB = 2.0;
      wallBox(m, m, W - m, ZB, 0, 3, 'archb', FB); cornice(m, m, W - m, ZB, HH - 0.005, STONE2); sband(m, m, W - m, ZB, 0.29, STONE2);
      var P = (ZB - m) / 4;
      for (var t = 0; t < 4; t++) {
        var z0 = m + t * P;
        S.bake(S.box(W - 2 * m, 0.03, Math.hypot(P, RH), K.mat(ROOF), W / 2, HH + RH / 2 + 0.035, z0 + P / 2), Math.atan2(RH, P), 0, 0);
        S.box(W - 2 * m - 0.02, RH, 0.02, K.mat('#9cc3dd'), W / 2, HH + RH / 2 + 0.035, z0 + 0.012);
      }
      cube(1.45, ZB - 0.005, 2.8, ZB + 0.025, 0, 0.66, STONE2); cube(1.5, ZB - 0.005, 2.75, ZB + 0.03, 0, 0.62, '#4f545c');       // ворота в каменной раме
      for (var gl = 1; gl < 6; gl++) cube(1.5, ZB + 0.03, 2.75, ZB + 0.04, gl * 0.1, 0.012, '#7c828b');
      cube(1.45, ZB - 0.01, 2.8, ZB + 0.1, 0.66, 0.05, STONE2);
      var yoff = wallBox(m, ZB, 1.3, D - m, 0, 3, 'archb', FB); cornice(m, ZB, 1.3, D - m, yoff - 0.005, STONE2); S.hip(m, ZB, 1.3, D - m, yoff + 0.035, 0.3, SLATE, 0.05);
      S.box(0.3, 0.3, 0.3, kwall('clock', '#e0d7c2'), 0.69, yoff + 0.4, 2.42, [V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), V4(0, 0, 1, 1), CAP, CAP]);
      cube(1.3, ZB, W - m, D - m, 0, 0.012, '#6b6f74');                                              // двор
      cube(1.42, D - 0.2, 1.62, D - m, 0, 0.016, '#f1f1e6');
      // готовый зелёный грузовик во дворе (смотрит к выезду)
      cube(2.05, 2.15, 2.33, 2.55, 0.06, 0.05, '#2c2c2a'); cube(2.04, 2.15, 2.34, 2.52, 0.11, 0.1, '#a8844f');
      cube(2.06, 2.55, 2.32, 2.78, 0.06, 0.2, '#4f8f3e'); cube(2.07, 2.7, 2.31, 2.79, 0.17, 0.07, '#9cc3dd');
      [[2.03, 2.25], [2.35, 2.25], [2.03, 2.68], [2.35, 2.68]].forEach(function (w) { cube(w[0] - 0.03, w[1] - 0.05, w[0] + 0.03, w[1] + 0.05, 0, 0.1, '#1c1c1c'); });
      // высокая кирпичная труба с поясами и каменным оголовком
      S.cyl(0.09, 0.14, 2.5, 12, '#9a4a36', 0.45, 1.25, 0.42); S.cyl(0.11, 0.11, 0.05, 12, STONE2, 0.45, 1.6, 0.42); S.cyl(0.115, 0.1, 0.12, 12, STONE2, 0.45, 2.54, 0.42);
      S.cyl(0.095, 0.095, 0.1, 12, '#f2f2ea', 0.45, 2.1, 0.42); S.cyl(0.092, 0.092, 0.1, 12, '#c8362b', 0.45, 2.3, 0.42);
      S.cyl(0.2, 0.2, 0.32, 14, '#8f9aa6', 2.45, HH + RH + 0.22, 0.55); S.cyl(0, 0.21, 0.12, 14, '#6d7782', 2.45, HH + RH + 0.44, 0.55);
    } else if (cat === 'depot') {
      // Дорожное депо 2×2: кирпичное каретное здание с двумя арочными воротами и щипцовой крышей, двор с мощёной площадкой, бочки и кучи материалов
      var DB = '#b0802f';
      var yde = wallBox(m, m, W - m, 1.15, 0, 2, 'brick', '#b4623f', 0.35); cornice(m, m, W - m, 1.15, yde - 0.005, STONE2);
      S.gable(m, m, W - m, 1.15, yde + 0.035, 0.28, '#6a4a3d', 'x', 0.04, '#b4623f');
      [0.53, 1.47].forEach(function (x) {
        cube(x - 0.38, 1.145, x + 0.38, 1.18, 0, 0.5, STONE2); cube(x - 0.34, 1.145, x + 0.34, 1.19, 0, 0.46, '#5a4a3a');
        S.bake(S.cyl(0.34, 0.34, 0.045, 12, '#5a4a3a', x, 0.46, 1.17), Math.PI / 2, 0, 0).scaling.y = 1;
        for (var k = 1; k < 5; k++) cube(x - 0.34, 1.19, x + 0.34, 1.198, k * 0.09, 0.01, '#7a6650');
      });
      cube(0.55, 0.96, 1.45, 1.0, yde + 0.03, 0.14, '#f0c040'); cube(0.55, 1.0, 1.45, 1.01, yde + 0.065, 0.05, '#2b2b2b');
      cube(m, 1.15, W - m, D - m, 0, 0.014, '#6d6a62');                                          // булыжный двор
      S.cyl(0, 0.26, 0.24, 9, '#9b9384', 1.66, 0.12, 1.66);                                       // щебень
      S.cyl(0, 0.17, 0.15, 9, '#26282b', 1.25, 0.075, 1.74);                                      // асфальт
      [0.2, 0.4].forEach(function (x) { S.cyl(0.04, 0.04, 0.1, 8, WOODC, x, 0.06, D - 0.16); S.cyl(0.042, 0.042, 0.01, 8, '#3a3d42', x, 0.085, D - 0.16); }); // бочки
      chim(0.3, 0.45, yde + 0.1, 0.26);
    } else if (cat === 'saw') {
      // Лесопилки: кирпичные цеха, паровая труба, брёвна и штабели досок
      var LOG = '#8a5a33', LOGE = '#d8b07a', BRD = '#e2c48c', DSP = '#c9a06a';
      function log(x0, x1, y, z, rr) { S.bake(S.cyl(rr, rr, x1 - x0, 10, LOG, (x0 + x1) / 2, y, z), 0, 0, Math.PI / 2); S.bake(S.cyl(rr * 0.8, rr * 0.8, 0.005, 10, LOGE, x1 + 0.002, y, z), 0, 0, Math.PI / 2); }
      function logPile(x0, x1, z0, rows, rr) { for (var a = 0; a < rows; a++) for (var q = 0; q < rows - a; q++) log(x0, x1, rr + a * rr * 1.7, z0 + (q + a / 2) * rr * 2.02, rr); }
      function boards(x0, z0, x1, z1, n) { for (var q = 0; q < n; q++) { cube(x0, z0, x1, z1, q * 0.045, 0.035, BRD); if (q % 3 === 2) cube(x0 + 0.02, z0 - 0.005, x0 + 0.05, z1 + 0.005, q * 0.045 + 0.035, 0.01, '#7a5a3a'); } }
      function shed(x0, z0, x1, z1, h, roof) {
        [[x0, z0], [x1 - 0.05, z0], [x0, z1 - 0.05], [x1 - 0.05, z1 - 0.05]].forEach(function (pp) { cube(pp[0], pp[1], pp[0] + 0.05, pp[1] + 0.05, 0, h, '#6b4a2e'); });
        S.gable(x0, z0, x1, z1, h, 0.2, roof, 'x', 0.04, '#7a5a3a');
      }
      function blade(x, y, z, rr) { S.bake(S.cyl(rr, rr, 0.015, 18, '#cfd3d8', x, y, z), 0, 0, Math.PI / 2); S.bake(S.cyl(rr * 0.25, rr * 0.25, 0.02, 10, '#4a4e55', x, y, z), 0, 0, Math.PI / 2); }
      cube(m, m, W - m, D - m, 0, 0.012, '#b8a07a');                                              // утоптанная площадка
      if (size === '2x2') {
        shed(0.15, 0.2, 1.2, 1.25, 0.55, '#7f4a3a');                                               // навес с черепицей
        cube(0.3, 0.55, 1.05, 0.85, 0, 0.2, '#6d5b4a'); blade(0.68, 0.3, 0.7, 0.15); log(0.35, 0.95, 0.26, 0.7, 0.06);
        logPile(1.32, 1.9, 0.25, 3, 0.075); boards(0.25, 1.45, 1.05, 1.75, 5); boards(1.25, 1.45, 1.85, 1.75, 3);
        S.cyl(0.05, 0.07, 1.1, 10, '#9a4a36', 1.5, 0.55, 1.2); S.cyl(0.07, 0.06, 0.06, 10, STONE2, 1.5, 1.12, 1.2);   // труба паровой машины
        cube(1.3, 1.31, 1.75, 1.33, 0.4, 0.14, '#f0c040');
      } else {
        wallBox(0.15, 0.15, 2.0, 1.7, 0, 3, 'archb', '#a8582f'); cornice(0.15, 0.15, 2.0, 1.7, 0.895, STONE2); S.gable(0.15, 0.15, 2.0, 1.7, 0.935, 0.3, '#6f4a3d', 'x', 0.05, '#a8582f');
        cube(0.7, 1.69, 1.45, 1.72, 0, 0.55, '#4f3a28'); cube(0.14, 0.9, 2.01, 1.0, 0.45, 0.05, '#e2c48c');
        wallBox(2.2, 0.15, 3.85, 1.9, 0, 3, 'archb', '#c0b4a0'); cornice(2.2, 0.15, 3.85, 1.9, 0.895, STONE2); S.hip(2.2, 0.15, 3.85, 1.9, 0.935, 0.28, SLATE, 0.05);
        cube(2.6, 1.89, 3.4, 1.92, 0, 0.62, '#5b6068');
        S.cyl(0.08, 0.12, 2.2, 12, '#9a4a36', 3.6, 1.1 + 0.55, 0.45); S.cyl(0.1, 0.095, 0.06, 12, STONE2, 3.6, 2.72, 0.45);
        S.cyl(0.22, 0.22, 0.5, 14, '#8f9aa6', 2.55, 1.35, 0.6); S.cyl(0, 0.23, 0.15, 14, '#6d7782', 2.55, 1.67, 0.6);
        cube(1.95, 0.9, 2.25, 1.1, 0.95, 0.08, '#7d838c');                                         // конвейер между цехами
        logPile(0.2, 1.4, 2.2, 4, 0.08); logPile(0.2, 1.4, 3.0, 3, 0.08);                          // склад брёвен
        S.cyl(0.035, 0.035, 1.3, 8, '#5a6068', 1.65, 0.65, 2.6); cube(1.6, 2.1, 1.7, 3.55, 1.25, 0.07, '#5a6068');  // кран-балка
        boards(2.2, 2.25, 3.0, 2.6, 6); boards(2.2, 2.8, 3.0, 3.15, 4);
        for (var q = 0; q < 6; q++) cube(3.15, 2.25, 3.8, 3.1, q * 0.05, 0.04, q % 2 ? DSP : '#d6b27c'); // листы ДСП
        cube(2.2, 3.35, 2.55, 3.7, 0.04, 0.12, '#a8844f'); cube(2.32, 3.55, 2.36, 3.7, 0.16, 0.16, '#3b3f45'); // телега с грузом
        [[2.23, 3.4], [2.52, 3.4], [2.23, 3.65], [2.52, 3.65]].forEach(function (w) { S.bake(S.cyl(0.05, 0.05, 0.02, 10, '#1c1c1c', w[0], 0.05, w[1]), 0, 0, Math.PI / 2); });
      }
    } else if (cat === 'lumber') {
      // Общество лесорубов 2×2 (с 0.23.0): бревенчатая изба с каменным цоколем, навес с поленницей, штабель брёвен, пень с топором
      var LB = '#8a5a33', LB2 = '#9a6a3c', LBE = '#d8b07a';
      function lgx(x0, x1, y, z, rr, col) { S.bake(S.cyl(rr, rr, x1 - x0, 8, col || LB, (x0 + x1) / 2, y, z), 0, 0, Math.PI / 2); S.bake(S.cyl(rr * 0.8, rr * 0.8, 0.005, 8, LBE, x1 + 0.002, y, z), 0, 0, Math.PI / 2); }
      function lgz(z0, z1, y, x, rr, col) { S.bake(S.cyl(rr, rr, z1 - z0, 8, col || LB, x, y, (z0 + z1) / 2), Math.PI / 2, 0, 0); S.bake(S.cyl(rr * 0.8, rr * 0.8, 0.005, 8, LBE, x, y, z1 + 0.002), Math.PI / 2, 0, 0); }
      cube(m, m, W - m, D - m, 0, 0.012, '#7b6a47');                                              // вытоптанная земля
      cube(0.17, 0.17, 1.33, 1.13, 0, 0.04, '#7d7a72');                                           // каменный цоколь
      for (var li = 0; li < 7; li++) {                                                            // сруб: венцы из брёвен, концы выступают «в лапу»
        var ly = 0.075 + li * 0.07, off = (li % 2) * 0.05;
        lgx(0.17 - off, 1.33 + off, ly, 0.2, 0.036, li % 3 === 1 ? LB2 : LB); lgx(0.17 - off, 1.33 + off, ly, 1.1, 0.036, li % 3 === 1 ? LB2 : LB);
        lgz(0.2, 1.1, ly, 0.2, 0.036, li % 3 === 0 ? LB2 : LB); lgz(0.2, 1.1, ly, 1.3, 0.036, li % 3 === 0 ? LB2 : LB);
      }
      S.gable(0.2, 0.2, 1.3, 1.1, 0.56, 0.3, '#6b4a2e', 'x', 0.07, LB);                           // тесовая крыша
      cube(0.6, 1.1, 0.92, 1.135, 0.04, 0.32, '#4a2f1a');                                         // дверь
      cube(0.98, 1.1, 1.22, 1.13, 0.2, 0.2, '#4a2f1a'); cube(1.0, 1.1, 1.2, 1.14, 0.22, 0.16, '#9cc3dd');   // окно в раме
      cube(1.08, 0.4, 1.18, 0.5, 0.5, 0.45, '#9a4b35'); cube(1.06, 0.38, 1.2, 0.52, 0.95, 0.03, '#d9d2c2'); // печная труба
      [[1.4, 0.25], [1.88, 0.25], [1.4, 0.9], [1.88, 0.9]].forEach(function (pp) { cube(pp[0], pp[1], pp[0] + 0.04, pp[1] + 0.04, 0, 0.42, '#6b4a2e'); });   // навес для дров
      cube(1.35, 0.2, 1.94, 0.97, 0.42, 0.04, '#7a5a3a');
      [[1.52, 0.045], [1.64, 0.045], [1.76, 0.045], [1.58, 0.13], [1.7, 0.13], [1.64, 0.215]].forEach(function (pp) { lgz(0.3, 0.88, pp[1], pp[0], 0.05, LB2); });   // поленница
      for (var la = 0; la < 3; la++) for (var lq = 0; lq < 3 - la; lq++) lgx(0.25, 1.15, 0.05 + la * 0.085, 1.45 + (lq + la / 2) * 0.102, 0.05);   // штабель брёвен у ворот
      S.cyl(0.07, 0.08, 0.1, 10, LB2, 1.45, 0.05, 1.6); S.cyl(0.07, 0.07, 0.01, 10, LBE, 1.45, 0.105, 1.6);                 // пень
      S.bake(S.cyl(0.012, 0.012, 0.2, 6, '#5a3d28', 1.45, 0.2, 1.6), 0.25, 0, 0.45); cube(1.45, 1.55, 1.56, 1.62, 0.25, 0.07, '#b9bec6');   // топор в пне
      tree(1.78, 1.72, 0.8); tree(0.14, 1.85, 0.55); lamp(0.3, 1.3, 0.3);
    } else if (cat === 'quarry' || cat === 'stonework') {
      // Камень (с 0.21.0): каменоломня и горный карьер — скальные уступы, рельсы с вагонетками, копёр; камнеобработка — навес с пилой и дробилка, завод с бункерами
      var SG = '#a39d92', SG2 = '#b8b2a5', SG3 = '#8c867b', SBL = '#d8d0bd', SBL2 = '#cdc5b1', RAILC = '#6b7077', TIE = '#5a4630';
      function qground(col) { cube(m, m, W - m, D - m, 0, 0.012, col); }
      function rails(x, z0, z1) { // рельсы вдоль z со шпалами
        for (var zz = z0; zz < z1 - 0.03; zz += 0.16) cube(x - 0.17, zz, x + 0.17, zz + 0.035, 0.012, 0.012, TIE);
        cube(x - 0.11, z0, x - 0.09, z1, 0.024, 0.02, RAILC); cube(x + 0.09, z0, x + 0.11, z1, 0.024, 0.02, RAILC);
      }
      function wagon(x, z, load) { // вагонетка; load — с камнями
        cube(x - 0.14, z - 0.2, x + 0.14, z + 0.2, 0.05, 0.04, '#3b3f45'); cube(x - 0.17, z - 0.22, x + 0.17, z + 0.22, 0.09, 0.1, '#7a5a3a'); cube(x - 0.15, z - 0.2, x + 0.15, z + 0.2, 0.19, 0.012, '#4a3a28');
        [[-0.11, -0.14], [0.11, -0.14], [-0.11, 0.14], [0.11, 0.14]].forEach(function (w) { S.bake(S.cyl(0.032, 0.032, 0.02, 8, '#1c1c1c', x + w[0], 0.045, z + w[1]), 0, 0, Math.PI / 2); });
        if (load) { S.sph(0.08, '#cfc8b8', x - 0.05, 0.22, z - 0.07, 0.8); S.sph(0.07, '#b9b2a2', x + 0.07, 0.22, z + 0.03, 0.8); S.sph(0.06, '#d8d0bd', x - 0.02, 0.24, z + 0.12, 0.8); }
      }
      function sblocks(x0, z0, x1, z1, n, hh) { hh = hh || 0.085; for (var q = 0; q < n; q++) cube(x0 + q * 0.012, z0 + q * 0.012, x1 - q * 0.012, z1 - q * 0.012, q * hh, hh - 0.005, q % 2 ? SBL2 : SBL); }
      function gpile(x, z, rr, col) { S.cyl(0, rr, rr * 0.85, 9, col, x, rr * 0.425, z); }
      function bould(x, z, rr, col) { S.sph(rr, col || '#8a857c', x, rr * 0.7, z, 0.75); }
      if (cat === 'quarry' && size === '3x3') {
        qground('#8f897d');
        cube(0.12, 0.12, 2.88, 0.95, 0, 0.16, SG3); cube(0.3, 0.12, 2.7, 0.72, 0.16, 0.16, SG); cube(0.6, 0.12, 2.4, 0.5, 0.32, 0.16, SG2);   // скальный уступ с террасами
        S.cyl(0, 0.34, 0.26, 7, SG2, 0.9, 0.61, 0.28); S.cyl(0, 0.26, 0.2, 7, '#bdb7aa', 2.0, 0.58, 0.3);
        bould(0.45, 1.08, 0.11); bould(2.6, 1.05, 0.12); bould(0.25, 1.32, 0.09, '#7a766e'); bould(2.8, 1.3, 0.08);
        rails(1.5, 0.95, 2.9); wagon(1.5, 1.45, true); wagon(1.5, 1.95, false);
        S.cyl(0.018, 0.028, 0.95, 6, WOODC, 0.5, 0.47, 1.55); cube(0.5, 1.5, 1.15, 1.54, 0.9, 0.03, WOODC);   // деревянный кран-деррик
        S.cyl(0.005, 0.005, 0.4, 4, '#222', 1.1, 0.7, 1.52); cube(1.04, 1.46, 1.16, 1.58, 0.36, 0.13, SBL);
        var yq = wallBox(2.0, 1.6, 2.75, 2.4, 0, 1, 'brick', '#a9553b', 0.4);                                    // бытовка
        S.gable(2.0, 1.6, 2.75, 2.4, yq + 0.035, 0.2, '#5b4a44', 'z', 0.04, '#a9553b'); door(2.25, 2.4, 2.403, 0.22); chim(2.15, 1.8, yq + 0.1, 0.2);
        sblocks(2.05, 2.55, 2.5, 2.88, 3); sblocks(0.2, 2.3, 0.75, 2.75, 2); gpile(0.6, 1.95, 0.22, '#9b9384');
        lamp(0.2, 2.85, 0.34);
      } else if (cat === 'quarry') {
        qground('#85807a');
        cube(0.1, 0.1, 3.9, 1.0, 0, 0.14, SG3); cube(0.25, 0.1, 3.75, 0.8, 0.14, 0.14, SG); cube(0.5, 0.1, 3.5, 0.62, 0.28, 0.14, SG2); cube(0.9, 0.1, 3.1, 0.45, 0.42, 0.14, '#c4beb1');   // четыре уступа
        S.cyl(0, 0.42, 0.34, 7, SG2, 0.8, 0.77, 0.3); S.cyl(0, 0.3, 0.26, 7, '#c4beb1', 3.2, 0.7, 0.3);
        cube(1.5, 0.98, 2.5, 1.06, 0, 0.44, '#d2cbb9'); cube(1.62, 0.98, 2.38, 1.08, 0, 0.36, '#201e1c');          // портал штольни
        cube(1.5, 0.98, 2.5, 1.06, 0.44, 0.05, '#d2cbb9'); cube(1.6, 1.05, 1.66, 1.1, 0, 0.38, WOODC); cube(2.34, 1.05, 2.4, 1.1, 0, 0.38, WOODC); cube(1.6, 1.05, 2.4, 1.1, 0.36, 0.04, WOODC);
        rails(2.0, 1.1, 3.9); wagon(2.0, 1.6, true); wagon(2.0, 2.15, true); wagon(2.0, 2.7, false);
        [[3.0, 1.5], [3.4, 1.5], [3.0, 1.9], [3.4, 1.9]].forEach(function (p) { S.cyl(0.02, 0.03, 1.3, 6, '#4a4e55', p[0], 0.65, p[1]); });   // копёр
        cube(2.95, 1.45, 3.45, 1.95, 1.3, 0.04, '#3b3f45'); S.bake(S.cyl(0.14, 0.14, 0.04, 14, '#2b2f35', 3.2, 1.46, 1.7), 0, 0, Math.PI / 2); cube(3.14, 1.62, 3.26, 1.78, 1.34, 0.12, '#c8342c');
        var yc = wallBox(0.2, 1.7, 1.4, 2.8, 0, 2, 'gov', '#c0b4a0', 0.35); cornice(0.2, 1.7, 1.4, 2.8, yc - 0.005, STONE2); S.hip(0.2, 1.7, 1.4, 2.8, yc + 0.035, 0.3, SLATE, 0.05);   // дробилка
        door(0.6, 0.85, 2.803, 0.25); S.cyl(0.07, 0.1, 1.3, 10, '#9a4a36', 1.2, 0.65, 1.85); S.cyl(0.1, 0.09, 0.05, 10, STONE2, 1.2, 1.32, 1.85);
        S.bake(S.box(0.16, 0.04, 1.1, K.mat('#3b3f45'), 1.0, 0.42, 3.35), -0.3, 0, 0);                              // конвейер
        gpile(2.9, 3.35, 0.36, '#9b9384'); gpile(3.45, 3.1, 0.28, '#b4ac9a'); sblocks(0.25, 3.2, 0.95, 3.75, 3);
        bould(3.7, 2.4, 0.13); bould(0.2, 1.2, 0.1, '#7a766e'); lamp(0.15, 3.85, 0.4); lamp(3.85, 3.85, 0.4);
      } else if (size === '2x2') {
        qground('#a8a094');
        [[0.15, 0.2], [1.2, 0.2], [0.15, 1.15], [1.2, 1.15]].forEach(function (pp) { cube(pp[0], pp[1], pp[0] + 0.05, pp[1] + 0.05, 0, 0.5, '#6b4a2e'); });  // навес на столбах
        S.gable(0.15, 0.2, 1.25, 1.2, 0.5, 0.2, '#6a5a52', 'x', 0.04, '#7a5a3a');
        cube(0.3, 0.45, 1.05, 0.9, 0, 0.2, '#6d6a63'); cube(0.4, 0.52, 0.9, 0.82, 0.2, 0.14, SBL);                 // верстак с каменным блоком
        S.bake(S.cyl(0.16, 0.16, 0.012, 18, '#cfd3d8', 0.65, 0.4, 0.67), 0, 0, Math.PI / 2); S.bake(S.cyl(0.04, 0.04, 0.02, 10, '#4a4e55', 0.65, 0.4, 0.67), 0, 0, Math.PI / 2);
        S.cyl(0.24, 0.08, 0.3, 10, '#7d838c', 1.6, 0.55, 0.45); [[1.45, 0.3], [1.75, 0.3], [1.45, 0.6], [1.75, 0.6]].forEach(function (pp) { S.cyl(0.015, 0.015, 0.4, 5, '#4a4e55', pp[0], 0.2, pp[1]); });   // дробилка-бункер
        gpile(1.55, 1.45, 0.3, '#b9b1a0'); gpile(1.3, 1.7, 0.2, '#9b9384'); sblocks(0.2, 1.4, 0.85, 1.85, 3, 0.06);
        S.cyl(0.035, 0.05, 0.9, 8, '#9a4a36', 0.2, 0.45, 0.3); bould(0.2, 1.1, 0.07);
      } else {
        qground('#a39d92');
        var yw = wallBox(0.15, 0.15, 2.4, 1.9, 0, 3, 'gov', '#c9bfa9'); cornice(0.15, 0.15, 2.4, 1.9, yw - 0.005, STONE2); S.gable(0.15, 0.15, 2.4, 1.9, yw + 0.035, 0.3, '#6f6a64', 'x', 0.05, '#c9bfa9');   // цех дробления
        cube(0.7, 1.89, 1.5, 1.92, 0, 0.55, '#4f5660'); cube(0.65, 1.89, 1.55, 1.93, 0.55, 0.05, STONE2);          // ворота
        var yt = wallBox(2.5, 0.15, 3.2, 1.0, 0, 4, 'gov', '#b9ae98', 0.3); cornice(2.5, 0.15, 3.2, 1.0, yt - 0.005, STONE2); S.hip(2.5, 0.15, 3.2, 1.0, yt + 0.035, 0.28, SLATE, 0.05);    // башня грохота
        S.bake(S.box(0.16, 0.04, 1.5, K.mat('#3b3f45'), 2.85, 0.95, 1.65), -0.5, 0, 0);                              // конвейер вниз к бункерам
        [[3.4, 1.9], [3.4, 2.5], [3.4, 3.1]].forEach(function (pp, q) { S.cyl(0.2, 0.2, 0.6, 12, q % 2 ? '#9aa3ad' : '#8f9aa6', pp[0], 0.7, pp[1]); S.cyl(0.2, 0.05, 0.25, 12, '#6d7782', pp[0], 0.275, pp[1]); S.cyl(0, 0.21, 0.1, 12, '#6d7782', pp[0], 1.05, pp[1]); });   // бункеры
        gpile(0.5, 2.5, 0.42, '#9b9384'); gpile(1.15, 2.85, 0.34, '#b9b1a0'); gpile(1.75, 2.45, 0.3, '#aaa393'); gpile(0.7, 3.4, 0.28, '#c4bcab');
        sblocks(2.2, 2.4, 2.9, 3.0, 3, 0.06); sblocks(2.2, 3.15, 2.9, 3.75, 2, 0.06);
        cube(1.2, 3.35, 1.55, 3.85, 0.06, 0.1, '#a8844f'); cube(1.2, 3.35, 1.55, 3.55, 0.16, 0.14, '#8a7a5a'); cube(1.2, 3.55, 1.55, 3.7, 0.06, 0.2, '#4f8f3e'); // самосвал
        [[1.17, 3.45], [1.58, 3.45], [1.17, 3.75], [1.58, 3.75]].forEach(function (w) { cube(w[0] - 0.03, w[1] - 0.05, w[0] + 0.03, w[1] + 0.05, 0, 0.1, '#1c1c1c'); });
        S.cyl(0.07, 0.11, 1.9, 10, '#9a4a36', 2.3, 0.95, 1.25); S.cyl(0.11, 0.1, 0.06, 10, STONE2, 2.3, 1.9, 1.25);
        lamp(0.2, 3.8, 0.4); lamp(3.8, 3.8, 0.4);
      }
    } else if (cat === 'park' || cat === 'upark') {
      // Парковки: мощёные дворы с газовыми фонарями и старинными автомобилями; подземные — чугунные входы в стиле ар-нуво (как в Парижском метро)
      var under = cat === 'upark', CARC = ['#2e3a2f', '#6b2a2a', '#e8dcc0', '#2e2e33', '#3a4a6a', '#7a5a2a'];
      function pcar(cx, cz, rotZ, col) { // автомобиль 1910-х: длинный капот, высокий кузов, чёрный верх, тонкие колёса
        var ww = rotZ ? 0.36 : 0.22, dd = rotZ ? 0.22 : 0.36, fx = rotZ ? 1 : 0, fz = rotZ ? 0 : 1;
        cube(cx - ww / 2, cz - dd / 2, cx + ww / 2, cz + dd / 2, 0.045, 0.07, col);
        cube(cx - ww * (rotZ ? 0.12 : 0.36), cz - dd * (rotZ ? 0.36 : 0.12), cx + ww * (rotZ ? 0.38 : 0.36), cz + dd * (rotZ ? 0.36 : 0.38), 0.115, 0.07, col);
        cube(cx - ww * (rotZ ? 0.08 : 0.4), cz - dd * (rotZ ? 0.4 : 0.08), cx + ww * (rotZ ? 0.0 : 0.4), cz + dd * (rotZ ? 0.4 : 0.0), 0.185, 0.012, '#1b1b1b');
        [[-0.4, -0.5], [0.4, -0.5], [-0.4, 0.5], [0.4, 0.5]].forEach(function (p) { S.bake(S.cyl(0.035, 0.035, 0.02, 8, '#1b1b1b', cx + (rotZ ? p[1] * ww : p[0] * ww), 0.035, cz + (rotZ ? p[0] * dd : p[1] * dd)), 0, 0, rotZ ? 0 : Math.PI / 2); });
      }
      if (!under) {
        cube(m, m, W - m, D - m, 0, 0.014, '#7a746a');                                             // булыжник
        for (var gi = 0; gi < Math.round((D - 2 * m) / 0.25); gi++) cube(m, m + gi * 0.25, W - m, m + gi * 0.25 + 0.006, 0.014, 0.003, '#5e5950');
        cube(m - 0.005, m - 0.005, W - m + 0.005, m + 0.03, 0, 0.05, '#cfcabd');                   // бордюр сзади
        var nz = Math.round((D - 2 * m) / 0.5), rows = W >= 2 ? [[m, m + 0.5], [W - m - 0.5, W - m]] : [[m, W - m]], gz;
        rows.forEach(function (rw) {
          for (gz = 0; gz <= nz; gz++) cube(rw[0], m + gz * 0.5 - 0.008, rw[1], m + gz * 0.5 + 0.008, 0.014, 0.004, '#d9d4c4');
          for (gz = 0; gz < nz; gz++) if (r() < 0.65) pcar((rw[0] + rw[1]) / 2, m + gz * 0.5 + 0.25, W >= 2, pick(r, CARC));
        });
        if (W >= 3) for (var col2 = 1; col2 < W - 1; col2++) {
          for (gz = 0; gz <= nz; gz++) cube(col2 + 0.05, m + gz * 0.5 - 0.008, col2 + 0.95, m + gz * 0.5 + 0.008, 0.014, 0.004, '#d9d4c4');
          for (gz = 0; gz < nz; gz++) if (r() < 0.6) pcar(col2 + 0.5, m + gz * 0.5 + 0.25, true, pick(r, CARC));
        }
        if (W >= 2) {                                                                                // будка сторожа с черепичной крышей и шлагбаум
          var ysg = wallBox(W - m - 0.34, D - m - 0.32, W - m - 0.04, D - m - 0.04, 0, 1, 'brick', '#a9553b', 0.3); S.hip(W - m - 0.34, D - m - 0.32, W - m - 0.04, D - m - 0.04, ysg, 0.14, '#6a4a3d', 0.03);
          cube(m + 0.05, D - m - 0.08, W - m - 0.38, D - m - 0.05, 0.22, 0.03, '#e03b3b'); S.cyl(0.03, 0.03, 0.25, 8, '#d0d6dc', W - m - 0.4, 0.12, D - m - 0.06);
        }
        if (W >= 3) [[0.1, 0.3], [W - 0.1, 0.3], [0.1, D - 0.6], [W - 0.1, D * 0.5]].forEach(function (lp) { lamp(lp[0], lp[1], 0.42); });
        else lamp(0.14, D - 0.14, 0.34);
        S.cyl(0.012, 0.012, 0.45, 6, '#2b2f35', 0.12, 0.22, D - 0.12);                            // знак «P»
        S.box(0.16, 0.16, 0.01, K.mat('#2a4f8f'), 0.12, 0.52, D - 0.12); S.box(0.06, 0.1, 0.012, K.mat('#f1ece0'), 0.12, 0.52, D - 0.12);
      } else {
        // подземная: газон сверху, пандус въезда у фасада, портал-арка из зелёного чугуна, фонари-шары, вентиляция
        var rw0 = W >= 2 ? W / 2 - 0.42 : 0.12, rw1 = W >= 2 ? W / 2 + 0.42 : 0.88, rz0 = D - m - Math.min(1.2, D * 0.45), GRN = '#2f6a4f';
        cube(m - 0.005, m - 0.005, W - m + 0.005, D - m + 0.005, 0, 0.03, '#b9b2a6');
        cube(m, m, W - m, rz0, 0.03, 0.025, '#6fae5a');
        if (rw0 - 0.06 > m) cube(m, rz0, rw0 - 0.06, D - m, 0.03, 0.025, '#6fae5a');
        if (rw1 + 0.06 < W - m) cube(rw1 + 0.06, rz0, W - m, D - m, 0.03, 0.025, '#6fae5a');
        cube(rw0, rz0, rw1, D - m, 0, 0.031, '#1d1f22');
        cube(rw0 - 0.06, rz0, rw0, D - m, 0, 0.2, '#a9a49a'); cube(rw1, rz0, rw1 + 0.06, D - m, 0, 0.2, '#a9a49a');
        var rl = (D - m - rz0) * 0.6;
        S.bake(S.box(rw1 - rw0, 0.02, rl, K.mat('#4a4e55'), (rw0 + rw1) / 2, 0.035, D - m - rl / 2), -0.08, 0, 0);
        for (var st2 = 0; st2 < 3; st2++) cube((rw0 + rw1) / 2 - 0.015, D - m - rl + 0.05 + st2 * rl / 3, (rw0 + rw1) / 2 + 0.015, D - m - rl + 0.05 + st2 * rl / 3 + rl / 6, 0.05, 0.004, '#d9d4c4');
        // портал в стиле Гимара: два зелёных столба, дуга, вывеска «METRO»-подобная и два светящихся шара
        [rw0 - 0.05, rw1 + 0.05].forEach(function (x) { cube(x - 0.025, rz0 - 0.05, x + 0.025, rz0 + 0.01, 0.03, 0.3, GRN); S.sph(0.04, '#fff1b8', x, 0.4, rz0 - 0.02, 1.1); });
        cube(rw0 - 0.075, rz0 - 0.05, rw1 + 0.075, rz0 + 0.01, 0.31, 0.035, GRN);
        S.bake(S.cyl(0.0001 + (rw1 - rw0) / 2 + 0.05, (rw1 - rw0) / 2 + 0.05, 0.012, 14, GRN, (rw0 + rw1) / 2, 0.37, rz0 - 0.02), Math.PI / 2, 0, 0).scaling.y = 1;
        S.box(0.3, 0.06, 0.012, K.mat('#f3ead3'), (rw0 + rw1) / 2, 0.375, rz0 + 0.012);
        cube(rw0, rz0 + 0.002, rw1, rz0 + 0.004, 0.02, 0.22, '#1d1f22');
        var vz = W >= 2 ? 0.35 : 0.3;
        [[W >= 2 ? 0.35 : 0.5, vz], [W - 0.35, vz]].slice(0, W >= 2 ? 2 : 1).forEach(function (v) {
          cube(v[0] - 0.09, v[1] - 0.09, v[0] + 0.09, v[1] + 0.09, 0.05, 0.22, '#6e7a72'); S.hip(v[0] - 0.1, v[1] - 0.1, v[0] + 0.1, v[1] + 0.1, 0.27, 0.07, GRN, 0.01);
        });
        if (W >= 2) {
          lamp(0.2, D * 0.55, 0.34); tree(W - 0.3, D * 0.45, 0.7); tree(0.7, 0.75, 0.6);
          cube(W / 2 - 0.2, D * 0.42, W / 2 + 0.2, D * 0.42 + 0.07, 0.05, 0.06, '#8a6b4a');
        }
        if (W >= 3) { tree(1.2, 1.5, 0.8); tree(2.2, 2.3, 0.75); tree(0.6, 2.6, 0.7); S.cyl(0.25, 0.28, 0.06, 16, '#c9c2b3', 1.5, 0.08, 2.9); S.cyl(0.18, 0.18, 0.02, 16, '#6fb6e0', 1.5, 0.11, 2.9); }
      }
    }
    // Модерн (с 0.19.0): круглая угловая башенка с зелёным шатром и золотым шариком (у зданий без собственных башен, кроме 4×4)
    if (th === 1 && size !== '4x4' && bw.a > 0 && !S.nTwr && ['res', 'social', 'gov', 'army', 'corp'].indexOf(cat) >= 0) {
      var tr = Math.min(0.15, Math.min(bw.x1 - bw.x0, bw.z1 - bw.z0) * 0.22), tx = bw.x1 - tr * 0.6, tz = bw.z1 - tr * 0.6;
      var tfl = Math.max(1, Math.round(bw.top / FH)), th2 = tfl * FH;
      S.twr(tr, th2, 12, kwall('euro', '#e3c27d'), tx, 0, tz, 2, tfl);
      S.cyl(tr + 0.02, tr + 0.02, 0.03, 12, STONE, tx, th2 + 0.015, tz);
      S.cyl(0, tr * 1.3, tr * 3.4, 12, PAT, tx, th2 + 0.03 + tr * 1.7, tz);
      S.sph(0.028, GOLD, tx, th2 + 0.04 + tr * 3.4, tz, 1);
    }
    return S.merge();
  }

  // ---------- Дорожный каток депо (оранжевый). Смотрит вперёд по +z ----------
  function rollerModel(K) {
    var S = Shapes(K, 0, 0), OR = '#f08a24', DK = '#3a3d42', YEL = '#ffcf3a';
    function box(w, h, d, color, x, y, z) { return S.box(w, h, d, K.mat(color), x, y, z); }
    S.bake(S.cyl(0.11, 0.11, 0.34, 18, '#5d6168', 0, 0.11, 0.22), 0, 0, Math.PI / 2);           // передний вальц
    S.bake(S.cyl(0.05, 0.05, 0.35, 10, OR, 0, 0.11, 0.22), 0, 0, Math.PI / 2);
    box(0.06, 0.12, 0.2, OR, 0.19, 0.16, 0.22); box(0.06, 0.12, 0.2, OR, -0.19, 0.16, 0.22);        // рама вальца
    box(0.3, 0.14, 0.36, OR, 0, 0.17, -0.1);                                                       // корпус с двигателем
    box(0.31, 0.02, 0.37, DK, 0, 0.245, -0.1);
    [0.16, -0.16].forEach(function (x) { S.bake(S.cyl(0.085, 0.085, 0.07, 14, '#1c1c1c', x, 0.085, -0.2), 0, 0, Math.PI / 2); });
    box(0.16, 0.07, 0.12, DK, 0, 0.29, -0.06);                                                     // сиденье и пульт
    [[0.12, 0.04], [-0.12, 0.04], [0.12, -0.24], [-0.12, -0.24]].forEach(function (p) { box(0.018, 0.22, 0.018, DK, p[0], 0.36, p[1]); });
    box(0.3, 0.025, 0.34, YEL, 0, 0.48, -0.1);                                                     // крыша
    box(0.05, 0.03, 0.05, '#ff9a2e', 0, 0.505, -0.1);                                              // маячок
    box(0.3, 0.03, 0.03, '#f4f2ec', 0, 0.2, 0.08);
    return S.merge();
  }

  // ---------- Грузовик «Бригада» (зелёный, в стиле 60-х). Смотрит вперёд по +z ----------
  function truckModel(K) {
    var S = Shapes(K, 0, 0);
    var GREEN = '#4f8f3e', DARK = '#3b6e2e', CREAM = '#ece4c8', CHROME = '#d9dcd2', TIRE = '#1c1c1c', WOOD = '#a8844f', GLASS = '#9cc3dd';
    function box(w, h, d, color, x, y, z) { return S.box(w, h, d, K.mat(color), x, y, z); }
    box(0.26, 0.05, 0.86, '#2c2c2a', 0, 0.12, -0.02);                                   // рама
    [[0.15, 0.27], [-0.15, 0.27], [0.15, -0.25], [-0.15, -0.25]].forEach(function (p) {   // колёса с белыми колпаками
      S.bake(S.cyl(0.075, 0.075, 0.06, 14, TIRE, p[0], 0.075, p[1]), 0, 0, Math.PI / 2);
      S.bake(S.cyl(0.035, 0.035, 0.064, 10, CHROME, p[0], 0.075, p[1]), 0, 0, Math.PI / 2);
    });
    [0.15, -0.15].forEach(function (x) { box(0.08, 0.03, 0.2, DARK, x, 0.17, 0.27); });  // крылья над передними колёсами
    box(0.22, 0.1, 0.22, GREEN, 0, 0.2, 0.33);                                            // капот
    var hood = S.bake(S.cyl(0.11, 0.11, 0.22, 14, GREEN, 0, 0.25, 0.33), Math.PI / 2, 0, 0); hood.scaling.set(1, 0.5, 1);
    box(0.15, 0.08, 0.012, CHROME, 0, 0.2, 0.445);                                        // решётка, бампер, фары
    for (var i = 0; i < 3; i++) box(0.15, 0.008, 0.016, '#7b7e78', 0, 0.175 + i * 0.025, 0.446);
    box(0.32, 0.03, 0.035, CHROME, 0, 0.12, 0.46);
    [0.085, -0.085].forEach(function (x) { S.bake(S.cyl(0.028, 0.028, 0.02, 12, '#fff4c2', x, 0.245, 0.447), Math.PI / 2, 0, 0); });
    box(0.3, 0.2, 0.2, GREEN, 0, 0.3, 0.12);                                              // кабина
    box(0.31, 0.035, 0.21, CREAM, 0, 0.418, 0.12);
    box(0.24, 0.085, 0.012, GLASS, 0, 0.345, 0.222);
    box(0.304, 0.075, 0.12, GLASS, 0, 0.345, 0.125);
    box(0.302, 0.02, 0.202, CREAM, 0, 0.27, 0.12);
    box(0.32, 0.03, 0.42, WOOD, 0, 0.17, -0.21);                                          // кузов
    box(0.02, 0.1, 0.42, WOOD, 0.15, 0.23, -0.21); box(0.02, 0.1, 0.42, WOOD, -0.15, 0.23, -0.21);
    box(0.32, 0.1, 0.02, WOOD, 0, 0.23, -0.41); box(0.32, 0.13, 0.02, DARK, 0, 0.245, 0.0);
    box(0.322, 0.012, 0.422, '#7d6136', 0, 0.255, -0.21);
    box(0.18, 0.07, 0.14, '#b5563c', -0.04, 0.22, -0.13);                                 // кирпич и доски
    box(0.08, 0.04, 0.33, '#e0c48a', 0.08, 0.205, -0.22);
    box(0.04, 0.02, 0.3, '#f0b23c', -0.07, 0.28, -0.26);                                  // стремянка
    return S.merge();
  }

  // ---------- Машины завода и легковые (с 0.10.0). Смотрят вперёд по +z ----------
  function wheelSet(S, pts, r, w, hub) {
    pts.forEach(function (p) {
      S.bake(S.cyl(r, r, w, 14, '#1c1c1c', p[0], r, p[1]), 0, 0, Math.PI / 2);
      S.bake(S.cyl(r * 0.5, r * 0.5, w + 0.004, 10, hub || '#c9ccd0', p[0], r, p[1]), 0, 0, Math.PI / 2);
    });
  }
  // кабина грузовика: cz — центр по длине, col — цвет
  function cabin(S, K, col, cz, w, h, y0) {
    function box(bw, bh, bd, c, x, y, z) { return S.box(bw, bh, bd, K.mat(c), x, y, z); }
    box(w, h, 0.22, col, 0, y0 + h / 2, cz);
    box(w * 0.82, h * 0.42, 0.012, '#9cc3dd', 0, y0 + h * 0.68, cz + 0.111);          // лобовое
    box(w + 0.004, h * 0.36, 0.13, '#9cc3dd', 0, y0 + h * 0.68, cz + 0.01);            // боковые окна
    box(w + 0.01, 0.03, 0.035, '#d9dcd2', 0, y0 + 0.02, cz + 0.12);                    // бампер
    [w / 2 - 0.05, -w / 2 + 0.05].forEach(function (x) { box(0.045, 0.03, 0.01, '#fff4c2', x, y0 + 0.08, cz + 0.112); }); // фары
  }
  function vehicleModel(K, kind) {
    var S = Shapes(K, 0, 0);
    function box(w, h, d, c, x, y, z) { return S.box(w, h, d, K.mat(c), x, y, z); }
    var y0 = 0.13;
    if (kind === 'garbage') {                     // мусоровоз: белая кабина, синий кузов с прессом
      box(0.26, 0.04, 0.84, '#2c2c2a', 0, 0.11, 0);
      wheelSet(S, [[0.14, 0.28], [-0.14, 0.28], [0.14, -0.2], [-0.14, -0.2], [0.14, -0.32], [-0.14, -0.32]], 0.07, 0.06);
      cabin(S, K, '#f1f1ec', 0.3, 0.3, 0.24, y0);
      box(0.32, 0.3, 0.5, '#2f6fb3', 0, y0 + 0.17, -0.1);
      for (var i = 0; i < 4; i++) box(0.326, 0.02, 0.5, '#255a93', 0, y0 + 0.06 + i * 0.07, -0.1);
      box(0.3, 0.26, 0.1, '#7b8691', 0, y0 + 0.15, -0.39);                              // задний пресс
      box(0.2, 0.06, 0.02, '#ffcf3a', 0, y0 + 0.05, -0.445);
      box(0.04, 0.03, 0.04, '#ff9a2e', 0, y0 + 0.26, 0.26);
    } else if (kind === 'ambulance') {           // скорая: белый фургон, красная полоса, маячки
      box(0.24, 0.04, 0.78, '#2c2c2a', 0, 0.1, 0);
      wheelSet(S, [[0.13, 0.25], [-0.13, 0.25], [0.13, -0.24], [-0.13, -0.24]], 0.065, 0.055);
      box(0.3, 0.12, 0.18, '#f6f6f2', 0, y0 + 0.04, 0.3);                               // капот
      box(0.3, 0.32, 0.6, '#f6f6f2', 0, y0 + 0.16, -0.08);                              // кузов
      box(0.244, 0.11, 0.012, '#9cc3dd', 0, y0 + 0.21, 0.222);
      box(0.304, 0.1, 0.12, '#9cc3dd', 0, y0 + 0.21, 0.15);
      box(0.306, 0.045, 0.6, '#d8262e', 0, y0 + 0.08, -0.08);                           // полоса
      box(0.308, 0.1, 0.03, '#d8262e', 0, y0 + 0.2, -0.12); box(0.308, 0.03, 0.1, '#d8262e', 0, y0 + 0.2, -0.12); // крест
      box(0.07, 0.04, 0.05, '#2f7cf0', 0.08, y0 + 0.34, 0.16); box(0.07, 0.04, 0.05, '#ff3030', -0.08, y0 + 0.34, 0.16);
      box(0.32, 0.03, 0.03, '#d9dcd2', 0, 0.12, 0.39);
      [0.1, -0.1].forEach(function (x) { box(0.05, 0.03, 0.01, '#fff4c2', x, y0 + 0.06, 0.391); });
    } else if (kind === 'police') {              // полиция: бело-синий седан с мигалкой
      box(0.26, 0.1, 0.66, '#f4f4f0', 0, 0.13, 0);
      wheelSet(S, [[0.12, 0.21], [-0.12, 0.21], [0.12, -0.2], [-0.12, -0.2]], 0.06, 0.05);
      box(0.262, 0.05, 0.66, '#1f4fa8', 0, 0.15, 0);                                     // синяя полоса
      box(0.23, 0.1, 0.3, '#f4f4f0', 0, 0.23, -0.04);                                   // салон
      box(0.234, 0.07, 0.24, '#5d7fa0', 0, 0.23, -0.04);
      box(0.2, 0.03, 0.08, '#2a2a2a', 0, 0.295, -0.04);
      box(0.08, 0.035, 0.07, '#2f7cf0', 0.05, 0.3, -0.04); box(0.08, 0.035, 0.07, '#ff3030', -0.05, 0.3, -0.04);
      [0.09, -0.09].forEach(function (x) { box(0.05, 0.025, 0.01, '#fff4c2', x, 0.15, 0.331); });
    } else if (kind === 'army') {                // армейский грузовик: хаки, тент
      var KH = '#5f6b3a', KD = '#4b5530';
      box(0.26, 0.05, 0.86, '#2a2a26', 0, 0.12, 0);
      wheelSet(S, [[0.15, 0.3], [-0.15, 0.3], [0.15, -0.16], [-0.15, -0.16], [0.15, -0.31], [-0.15, -0.31]], 0.075, 0.065, '#3b3f2c');
      box(0.26, 0.11, 0.16, KH, 0, y0 + 0.07, 0.36);                                     // капот
      cabin(S, K, KH, 0.2, 0.3, 0.24, y0);
      box(0.34, 0.04, 0.5, KD, 0, y0 + 0.05, -0.2);                                     // кузов
      box(0.34, 0.24, 0.5, '#6f7a47', 0, y0 + 0.19, -0.2);                              // тент
      S.bake(S.cyl(0.17, 0.17, 0.5, 14, '#6f7a47', 0, y0 + 0.31, -0.2), Math.PI / 2, 0, 0).scaling.set(1, 0.35, 1);
      box(0.25, 0.16, 0.012, '#3d4428', 0, y0 + 0.18, -0.451);
    } else if (kind === 'van') {                 // фургон доставки: синяя будка
      box(0.24, 0.04, 0.78, '#2c2c2a', 0, 0.1, 0);
      wheelSet(S, [[0.13, 0.26], [-0.13, 0.26], [0.13, -0.24], [-0.13, -0.24]], 0.065, 0.055);
      cabin(S, K, '#f2f2ee', 0.27, 0.28, 0.22, y0);
      box(0.32, 0.34, 0.5, '#2563c9', 0, y0 + 0.19, -0.12);
      box(0.324, 0.07, 0.36, '#ffcf3a', 0, y0 + 0.22, -0.12);                           // полоса компании
      box(0.3, 0.3, 0.012, '#1d4c9c', 0, y0 + 0.18, -0.372);
    } else if (kind === 'semi') {                // тягач с прицепом-контейнером
      box(0.24, 0.05, 0.36, '#2a2a28', 0, 0.12, 0.3);
      wheelSet(S, [[0.13, 0.4], [-0.13, 0.4], [0.13, 0.2], [-0.13, 0.2]], 0.07, 0.06);
      cabin(S, K, '#c8342c', 0.4, 0.3, 0.3, y0);
      box(0.3, 0.12, 0.08, '#a82a23', 0, y0 + 0.3, 0.38);                               // спальник
      box(0.24, 0.05, 0.72, '#2a2a28', 0, 0.14, -0.2);
      wheelSet(S, [[0.14, -0.4], [-0.14, -0.4], [0.14, -0.52], [-0.14, -0.52]], 0.07, 0.06);
      box(0.34, 0.32, 0.78, '#3c7d7a', 0, y0 + 0.24, -0.22);                            // контейнер
      for (var j = 0; j < 7; j++) box(0.346, 0.3, 0.015, '#336b68', 0, y0 + 0.24, -0.56 + j * 0.11);
      box(0.3, 0.28, 0.012, '#2c5e5b', 0, y0 + 0.24, -0.612);
    } else if (kind === 'timber') {              // лесовоз (с 0.23.0): рыжая кабина с краном-манипулятором, длинный прицеп-роспуск с брёвнами
      box(0.24, 0.05, 0.36, '#2a2a28', 0, 0.12, 0.3);
      wheelSet(S, [[0.13, 0.4], [-0.13, 0.4], [0.13, 0.2], [-0.13, 0.2]], 0.07, 0.06);
      cabin(S, K, '#c9692b', 0.4, 0.3, 0.28, y0);
      box(0.05, 0.05, 0.9, '#2a2a28', 0, 0.15, -0.2);                                     // дышло прицепа
      wheelSet(S, [[0.14, -0.5], [-0.14, -0.5], [0.14, -0.62], [-0.14, -0.62]], 0.07, 0.06);
      box(0.36, 0.035, 0.05, '#2a2a28', 0, 0.2, 0.1); box(0.36, 0.035, 0.05, '#2a2a28', 0, 0.2, -0.55);   // поперечины-кониксы
      [[0.12, 0.26], [0.0, 0.26], [-0.12, 0.26], [0.06, 0.35], [-0.06, 0.35], [0.0, 0.44]].forEach(function (p) {   // штабель брёвен
        S.bake(S.cyl(0.055, 0.055, 0.95, 8, '#8a5a33', p[0], p[1], -0.22), Math.PI / 2, 0, 0);
        S.bake(S.cyl(0.044, 0.044, 0.006, 8, '#d8b07a', p[0], p[1], 0.26), Math.PI / 2, 0, 0);
      });
      [[0.19, 0.1], [-0.19, 0.1], [0.19, -0.55], [-0.19, -0.55]].forEach(function (p) { box(0.015, 0.3, 0.015, '#3a3a38', p[0], 0.33, p[1]); });   // стойки
      box(0.05, 0.05, 0.1, '#3a3a38', 0.12, y0 + 0.3, 0.2);                               // кран-манипулятор у кабины
    } else if (kind === 'dump') {                // самосвал: жёлтая кабина, оранжевый кузов со щебнем
      box(0.26, 0.05, 0.84, '#2c2c2a', 0, 0.12, 0);
      wheelSet(S, [[0.15, 0.28], [-0.15, 0.28], [0.15, -0.18], [-0.15, -0.18], [0.15, -0.31], [-0.15, -0.31]], 0.075, 0.065);
      cabin(S, K, '#f2c230', 0.3, 0.3, 0.26, y0);
      box(0.34, 0.04, 0.52, '#e0702a', 0, y0 + 0.06, -0.16);
      box(0.03, 0.16, 0.52, '#e0702a', 0.155, y0 + 0.14, -0.16); box(0.03, 0.16, 0.52, '#e0702a', -0.155, y0 + 0.14, -0.16);
      box(0.34, 0.16, 0.03, '#e0702a', 0, y0 + 0.14, -0.41); box(0.34, 0.22, 0.04, '#c45e1f', 0, y0 + 0.17, 0.1);
      box(0.28, 0.08, 0.44, '#6e6a64', 0, y0 + 0.17, -0.17);                            // щебень
      box(0.16, 0.05, 0.22, '#58554f', 0.03, y0 + 0.22, -0.2);
    }
    return S.merge();
  }
  function carModel(K, m) {
    var S = Shapes(K, 0, 0), info = G.cars.models.filter(function (c) { return c.id === m; })[0] || G.cars.models[0], C = info.color, GL = '#6f8fae';
    function box(w, h, d, c, x, y, z) { return S.box(w, h, d, K.mat(c), x, y, z); }
    var len = m === 'hatch' ? 0.48 : 0.58;
    box(0.26, 0.09, len, C, 0, 0.11, 0);                                                // кузов
    wheelSet(S, [[0.12, len / 2 - 0.1], [-0.12, len / 2 - 0.1], [0.12, -len / 2 + 0.1], [-0.12, -len / 2 + 0.1]], 0.055, 0.045, '#bfc3c8');
    if (m === 'sedan') { box(0.23, 0.09, 0.26, C, 0, 0.2, -0.03); box(0.234, 0.065, 0.2, GL, 0, 0.2, -0.03); box(0.2, 0.06, 0.012, GL, 0, 0.2, 0.1); }
    else if (m === 'hatch') { box(0.23, 0.1, 0.27, C, 0, 0.2, -0.06); box(0.234, 0.07, 0.22, GL, 0, 0.2, -0.05); box(0.2, 0.07, 0.012, GL, 0, 0.2, 0.076); }
    else { box(0.23, 0.1, 0.38, C, 0, 0.2, -0.07); box(0.234, 0.07, 0.33, GL, 0, 0.2, -0.06); box(0.2, 0.07, 0.012, GL, 0, 0.2, 0.121); box(0.18, 0.015, 0.3, '#3a3a3a', 0, 0.26, -0.08); }
    box(0.27, 0.025, 0.025, '#d9dcd2', 0, 0.08, len / 2); box(0.27, 0.025, 0.025, '#d9dcd2', 0, 0.08, -len / 2);
    [0.09, -0.09].forEach(function (x) { box(0.045, 0.022, 0.008, '#fff4c2', x, 0.13, len / 2 + 0.002); box(0.045, 0.022, 0.008, '#d8262e', x, 0.13, -len / 2 - 0.002); });
    return S.merge();
  }
  function vehicleThumb(k, car) {
    return thumbReq((car ? 'car_' : 'veh_') + k, function (K) {
      var root = new B.Mesh('thumb', K.scene), t = car ? carModel(K, k) : vehicleModel(K, k); t.rotation.y = -0.35; t.parent = root;
      var pad = B.MeshBuilder.CreateBox('pad', { width: 0.75, height: 0.04, depth: car ? 0.8 : 1.3 }, K.scene); pad.position.y = -0.02; pad.material = K.mat('#8cc068'); pad.parent = root;
      return root;
    });
  }

  // ---------- Пачки (thin instances): одна сетка — много копий ----------
  var batches = {}, dirtyBatches = {};
  var tmpM = B.Matrix.Identity(), tmpQ = new B.Quaternion(), tmpS = new B.Vector3(), tmpT = new B.Vector3();
  function getBatch(k, make) {
    var bt = batches[k];
    if (bt) return bt;
    var mesh = make();
    mesh.isPickable = false; mesh.receiveShadows = true; mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    shadowGen.addShadowCaster(mesh, false);
    bt = batches[k] = { key: k, mesh: mesh, h: mesh.getBoundingInfo().boundingBox.maximumWorld.y, ids: [], at: {}, buf: new Float32Array(16 * 8) };
    return bt;
  }
  function batchSet(bt, id, x, y, z, yaw, sx, sy, sz, roll, pitch) {
    var i = bt.at[id];
    if (i === undefined) {
      i = bt.at[id] = bt.ids.length; bt.ids.push(id);
      if (bt.buf.length < bt.ids.length * 16) { var nb = new Float32Array(bt.buf.length * 2); nb.set(bt.buf); bt.buf = nb; }
    }
    B.Quaternion.FromEulerAnglesToRef(pitch || 0, yaw, roll || 0, tmpQ);
    tmpS.set(sx, sy, sz); tmpT.set(x, y, z);
    B.Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    tmpM.copyToArray(bt.buf, i * 16);
    dirtyBatches[bt.key] = bt;
  }
  function batchRemove(bt, id) {
    var i = bt.at[id]; if (i === undefined) return;
    var last = bt.ids.length - 1, lid = bt.ids[last];
    if (i !== last) { bt.buf.copyWithin(i * 16, last * 16, last * 16 + 16); bt.ids[i] = lid; bt.at[lid] = i; }
    bt.ids.pop(); delete bt.at[id];
    dirtyBatches[bt.key] = bt;
  }
  function flushBatches() {
    for (var k in dirtyBatches) {
      var bt = dirtyBatches[k], n = bt.ids.length;
      if (n) {
        bt.mesh.thinInstanceSetBuffer('matrix', bt.buf.subarray(0, n * 16), 16, false);
        bt.mesh.setEnabled(true);
      } else bt.mesh.setEnabled(false);
    }
    dirtyBatches = {};
  }

  // Вариант модели: у жилых — 6 расцветок, у остальных — одна.
  var RES_VARIANTS = 6;
  function variantOf(cat, seed) { return cat === 'res' ? (seed >>> 0) % RES_VARIANTS : 0; }
  function modelSeed(cat, v) { return cat === 'res' ? 9001 + v * 7919 : 1; }
  function tplKey(cat, size, seed, th) { return cat + '|' + size + '|' + variantOf(cat, seed) + '|' + (th | 0); }
  function buildingBatch(b) {
    var v = variantOf(b.cat, b.seed), th = b.th | 0;
    return getBatch(tplKey(b.cat, b.size, b.seed, th), function () { return buildModel(kit, b.cat, b.size, modelSeed(b.cat, v), th); });
  }

  // ---------- Карта: земля, сетка, рамка, «срез» земли ----------
  var mapNodes = [];
  var frameMat = kit.mat('#c9b78f');
  var slabHD = null, gridMesh = null, groundMesh = null;
  function buildMapScene() {
    if (slabHD && slabHD.material) { slabHD.material.diffuseTexture.dispose(); slabHD.material.dispose(); }
    mapNodes.forEach(function (o) { o.dispose(); }); mapNodes = [];
    var ground = groundMesh = B.MeshBuilder.CreateGround('ground', { width: N, height: N }, scene);
    var gm = hdMats().grass;
    gm.diffuseTexture.uScale = gm.diffuseTexture.vScale = N / 3; // одна «плитка» травы на 3 клетки
    ground.material = gm; ground.receiveShadows = true; ground.isPickable = false; mapNodes.push(ground);
    // Срез земли под картой (как в SimCity 2000): один блок с нарисованными слоями — дёрн, земля с камнями, глина, скала.
    slabHD = B.MeshBuilder.CreateBox('slabHD', { width: N, height: 2.12, depth: N }, scene);
    slabHD.position.y = -1.06 - 0.001; slabHD.isPickable = false; slabHD.material = hdMats().slab(N); mapNodes.push(slabHD);
    var lines = [], h = N / 2;
    for (var i = 0; i <= N; i++) {
      lines.push([new B.Vector3(-h + i, 0.006, -h), new B.Vector3(-h + i, 0.006, h)]);
      lines.push([new B.Vector3(-h, 0.006, -h + i), new B.Vector3(h, 0.006, -h + i)]);
    }
    var grid = B.MeshBuilder.CreateLineSystem('grid', { lines: lines }, scene);
    grid.color = hex('#2d4a22'); grid.alpha = (N > 80 ? 0.16 : 0.22) * 0.35; grid.isPickable = false; grid.applyFog = false; mapNodes.push(grid);
    gridMesh = grid;
    var t = 0.25, fh = 0.12;
    [[0, -N / 2 - t / 2, N + 2 * t, t], [0, N / 2 + t / 2, N + 2 * t, t], [-N / 2 - t / 2, 0, t, N], [N / 2 + t / 2, 0, t, N]].forEach(function (a) {
      var e = B.MeshBuilder.CreateBox('frame', { width: a[2], height: fh, depth: a[3] }, scene);
      e.position.set(a[0], fh / 2 - 0.02, a[1]); e.material = frameMat; e.receiveShadows = true; e.isPickable = false; mapNodes.push(e);
    });
  }

  function cellCenter(x, z) { return { x: x - N / 2 + 0.5, z: z - N / 2 + 0.5 }; }

  // ---------- Плоские четырёхугольники (дороги, подсветка) ----------
  function flatMat(color, opts) {
    opts = opts || {};
    var m = new B.StandardMaterial('f' + color, scene);
    m.specularColor = B.Color3.Black(); m.backFaceCulling = false;
    if (opts.overlay) { m.disableLighting = true; m.emissiveColor = hex(color); m.alpha = opts.alpha; m.zOffset = -3; m.disableDepthWrite = true; }
    else m.diffuseColor = hex(color);
    return m;
  }
  function quadsMesh(name, quads, material) { // quads: [cx, cz, w, d, y]
    var pos = [], nor = [], uv = [], ind = [];
    quads.forEach(function (q, i) {
      var x0 = q[0] - q[2] / 2, x1 = q[0] + q[2] / 2, z0 = q[1] - q[3] / 2, z1 = q[1] + q[3] / 2, y = q[4];
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      var r = (q[5] || 0) & 3, U = [0, 0, 1, 0, 1, 1, 0, 1]; // q[5] — поворот текстуры на 90°×r (чтобы трещины не повторялись)
      for (var u = 0; u < 4; u++) uv.push(U[((u + r) % 4) * 2], U[((u + r) % 4) * 2 + 1]);
      var o = i * 4; ind.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    var m = new B.Mesh(name, scene), vd = new B.VertexData();
    vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = ind; vd.applyToMesh(m);
    m.material = material; m.isPickable = false;
    return m;
  }

  // ---------- Дороги: куски 20×20 клеток, каждый — одна сетка на материал ----------
  var roadMat = {};
  ['asphalt', 'dirt'].forEach(function (t) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
    g.fillStyle = G.roads[t].color; g.fillRect(0, 0, 64, 64);
    var r = rng(t === 'dirt' ? 7 : 3);
    for (var i = 0; i < 260; i++) {
      var v = r(); g.fillStyle = t === 'dirt' ? (v > .5 ? 'rgba(120,90,55,.35)' : 'rgba(200,170,120,.3)') : (v > .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.07)');
      g.fillRect(r() * 64, r() * 64, 2, 2);
    }
    var m = flatMat('#ffffff'), tx = new B.DynamicTexture('road' + t, c, scene, true); tx.update();
    m.diffuseTexture = tx; roadMat[t] = m;
  });
  // Булыжник (с 0.18.0): мощёная мостовая — камни рядами с разбежкой швов
  (function () {
    var S2 = 128, c = document.createElement('canvas'); c.width = c.height = S2; var g = c.getContext('2d'), r = rng(77);
    g.fillStyle = '#4a4741'; g.fillRect(0, 0, S2, S2);
    var rows = 8, rh = S2 / rows, nc = 7, cw = S2 / nc;
    for (var i = 0; i < rows; i++) for (var j = -1; j < nc; j++) {
      var x0 = j * cw + (i % 2 ? cw / 2 : 0) + (r() - 0.5) * 3, y0 = i * rh + (r() - 0.5) * 2, k = r();
      var base = k > 0.66 ? [150, 146, 136] : k > 0.33 ? [128, 124, 116] : [108, 105, 99], v = (r() - 0.5) * 18;
      g.fillStyle = 'rgb(' + Math.round(base[0] + v) + ',' + Math.round(base[1] + v) + ',' + Math.round(base[2] + v - 2) + ')';
      var rd = 4 + r() * 2, w2 = cw - 3, h2 = rh - 3;
      g.beginPath(); g.moveTo(x0 + 1.5 + rd, y0 + 1.5); g.arcTo(x0 + 1.5 + w2, y0 + 1.5, x0 + 1.5 + w2, y0 + 1.5 + h2, rd); g.arcTo(x0 + 1.5 + w2, y0 + 1.5 + h2, x0 + 1.5, y0 + 1.5 + h2, rd);
      g.arcTo(x0 + 1.5, y0 + 1.5 + h2, x0 + 1.5, y0 + 1.5, rd); g.arcTo(x0 + 1.5, y0 + 1.5, x0 + 1.5 + w2, y0 + 1.5, rd); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0 + 4, y0 + 3, w2 * 0.55, 2);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x0 + 4, y0 + h2 - 1, w2 * 0.8, 2);
    }
    for (i = 0; i < 400; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.1)'; g.fillRect(r() * S2, r() * S2, 2, 2); }
    var m = flatMat('#ffffff'), tx = new B.DynamicTexture('roadcobble', c, scene, true); tx.update();
    m.diffuseTexture = tx; roadMat.cobble = m;
  })();
  roadMat.line = flatMat('#f1f1e6'); roadMat.curb = flatMat('#c4c4bc'); roadMat.rut = flatMat('#8a6a44');
  roadMat.line1 = flatMat('#b9b9ad'); // выцветшая разметка на изношенном асфальте
  // Изношенный асфальт (с 0.9.0): 1 — средний износ (трещины, светлее), 2 — почти изношен (ямы, заплатки, щебень).
  function crack(g, r, x, y, n, len, w) {
    g.beginPath(); g.moveTo(x, y);
    var a = r() * Math.PI * 2;
    for (var i = 0; i < n; i++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y); }
    g.lineWidth = w; g.stroke();
  }
  [1, 2].forEach(function (lv) {
    var S2 = 128, c = document.createElement('canvas'); c.width = c.height = S2; var g = c.getContext('2d'), r = rng(lv * 977);
    g.fillStyle = lv === 1 ? '#4a4e55' : '#5c5f63'; g.fillRect(0, 0, S2, S2);
    for (var i = 0; i < 900; i++) { // зерно и выкрошенный щебень
      var v = r(); g.fillStyle = v > 0.6 ? 'rgba(0,0,0,.2)' : v > 0.25 ? 'rgba(255,255,255,.08)' : 'rgba(170,160,140,' + (lv === 2 ? '.35' : '.15') + ')';
      g.fillRect(r() * S2, r() * S2, 2, 2);
    }
    if (lv === 2) { // заплатки свежим асфальтом
      for (i = 0; i < 2; i++) { var px = r() * 90, py = r() * 90, pw = 18 + r() * 20, ph = 14 + r() * 16; g.fillStyle = 'rgba(62,65,70,.9)'; g.fillRect(px, py, pw, ph); g.strokeStyle = 'rgba(35,36,40,.45)'; g.lineWidth = 1; g.strokeRect(px, py, pw, ph); }
    }
    g.strokeStyle = 'rgba(25,26,28,.85)'; g.lineCap = 'round';
    for (i = 0; i < (lv === 1 ? 5 : 11); i++) crack(g, r, r() * S2, r() * S2, 4 + Math.floor(r() * 5), 6 + r() * 6, lv === 1 ? 1.2 : 1.8);
    if (lv === 2) { // сетка мелких трещин и ямы
      g.strokeStyle = 'rgba(25,26,28,.55)';
      for (i = 0; i < 14; i++) crack(g, r, r() * S2, r() * S2, 3, 4 + r() * 3, 1);
      for (i = 0; i < 3; i++) {
        var hx = 16 + r() * 96, hy = 16 + r() * 96, rx = 6 + r() * 7, ry = 4 + r() * 5;
        g.fillStyle = 'rgba(150,140,120,.7)'; g.beginPath(); g.ellipse(hx, hy, rx + 2.5, ry + 2.5, r() * 3, 0, 7); g.fill();
        var hg = g.createRadialGradient(hx, hy - 1, 1, hx, hy, rx);
        hg.addColorStop(0, '#16171a'); hg.addColorStop(1, '#34363a');
        g.fillStyle = hg; g.beginPath(); g.ellipse(hx, hy, rx, ry, 0, 0, 7); g.fill();
      }
    }
    var m = flatMat('#ffffff'), tx = new B.DynamicTexture('roadW' + lv, c, scene, true); tx.update();
    m.diffuseTexture = tx; roadMat['asphalt' + lv] = m;
  });
  // Стадия износа клетки асфальта: 0 — новая, 1 — средний износ, 2 — почти изношена
  function wearOf(k) { return state.wear[k] || 0; }
  function wearStage(w) { return w < G.wear.mid ? 0 : w < G.wear.worn ? 1 : 2; }
  var CH = 20, chunks = {}, dirtyChunks = {}; // 20 клеток: куски дорог ровно ложатся на куски мира 100×100
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function markRoad(x, z) { dirtyChunks[Math.floor(x / CH) + ',' + Math.floor(z / CH)] = 1; }
  function buildChunk(ck) {
    (chunks[ck] || []).forEach(function (m) { m.dispose(); }); chunks[ck] = [];
    var p = ck.split(','), X0 = +p[0] * CH, Z0 = +p[1] * CH, Q = { asphalt: [], asphalt1: [], asphalt2: [], dirt: [], cobble: [], line: [], line1: [], curb: [], rut: [] };
    for (var z = Z0; z < Z0 + CH; z++) for (var x = X0; x < X0 + CH; x++) {
      var t = state.roads[key(x, z)]; if (!t || !inMap(x, z)) continue;
      var c = cellCenter(x, z), ws = t === 'asphalt' ? wearStage(wearOf(key(x, z))) : 0;
      Q[ws ? t + ws : t].push([c.x, c.z, 1, 1, 0.012, (x * 7 + z * 13) & 3]);
      DIRS.forEach(function (dv) {
        var n = state.roads[key(x + dv[0], z + dv[1])], hx = dv[0] !== 0, sgn = dv[0] + dv[1];
        if (t === 'asphalt') {
          if (n === 'asphalt') Q[ws ? 'line1' : 'line'].push(hx ? [c.x + sgn * 0.3, c.z, 0.22, 0.05, 0.016] : [c.x, c.z + sgn * 0.3, 0.05, 0.22, 0.016]);
          else if (!n) Q.curb.push(hx ? [c.x + sgn * 0.46, c.z, 0.08, 1, 0.018] : [c.x, c.z + sgn * 0.46, 1, 0.08, 0.018]);
        } else if (t === 'cobble') {
          if (!n) Q.curb.push(hx ? [c.x + sgn * 0.46, c.z, 0.08, 1, 0.018] : [c.x, c.z + sgn * 0.46, 1, 0.08, 0.018]);
        } else if (n) {
          Q.rut.push(hx ? [c.x + sgn * 0.25, c.z - 0.18, 0.5, 0.06, 0.015] : [c.x - 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015]);
          Q.rut.push(hx ? [c.x + sgn * 0.25, c.z + 0.18, 0.5, 0.06, 0.015] : [c.x + 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015]);
        }
      });
    }
    Object.keys(Q).forEach(function (k) {
      if (!Q[k].length) return;
      var m = quadsMesh('road', Q[k], roadMat[k]); m.receiveShadows = true; chunks[ck].push(m);
    });
  }
  function flushRoads() { for (var ck in dirtyChunks) buildChunk(ck); dirtyChunks = {}; }
  function refreshRoadAround(x, z) { markRoad(x, z); DIRS.forEach(function (d) { markRoad(x + d[0], z + d[1]); }); }

  // ---------- Природа (с 0.21.0): деревья, каменистые площадки, горы ----------
  // Что где стоит, считает js/terrain.js по «зерну» мира (state.env.seed); здесь — только картинка и правила.
  // Деревья рисуются пачками (thin instances), каменистая земля — плоскими плитками под дорогами, горы — по одной сетке на гору.
  // Срубленные деревья запоминаются в куске карты (cleared[кусок] = {номер клетки в куске: 1}); сами деревья не растут и не возвращаются.
  var envC = {}, mtMesh = {}, cleared = {};
  var TREE_NAME = ['', 'Дуб', 'Сосна', 'Ясень'];
  function treeModel(kind) {
    var S = Shapes(kit, 0, 0);
    if (kind === 1) { // дуб: толстый ствол и круглая раскидистая крона из нескольких шаров
      S.cyl(0.035, 0.055, 0.34, 6, '#6b4a2e', 0, 0.17, 0);
      S.sph(0.3, '#4c8a3b', 0, 0.56, 0, 0.82); S.sph(0.22, '#5b9a45', 0.17, 0.5, 0.08, 0.85); S.sph(0.22, '#43802f', -0.15, 0.52, -0.1, 0.85); S.sph(0.2, '#63a34c', 0.02, 0.8, 0.03, 0.9);
    } else if (kind === 2) { // сосна: ярусы тёмных «лап»-конусов на тонком стволе
      S.cyl(0.02, 0.04, 0.3, 6, '#5a3d28', 0, 0.15, 0);
      S.cyl(0, 0.3, 0.36, 7, '#2c6a3e', 0, 0.3, 0); S.cyl(0, 0.24, 0.32, 7, '#33764a', 0, 0.54, 0); S.cyl(0, 0.17, 0.3, 7, '#2c6a3e', 0, 0.76, 0); S.cyl(0, 0.1, 0.26, 7, '#33764a', 0, 0.96, 0);
    } else { // ясень: высокий светлый ствол и узкая яйцевидная светлая крона
      S.cyl(0.03, 0.045, 0.5, 6, '#8b7d6a', 0, 0.25, 0);
      S.sph(0.22, '#86bd5a', 0, 0.78, 0, 1.55); S.sph(0.16, '#93c764', 0.07, 1.02, 0.03, 1.3); S.sph(0.14, '#7bb050', -0.07, 0.62, -0.05, 1.2);
    }
    return S.merge();
  }
  function treeBatch(k) { return getBatch('tree' + k, function () { return treeModel(k); }); }
  function boulderModel(v) { // валун: приплюснутый многогранник
    var S = Shapes(kit, 0, 0);
    var m = B.MeshBuilder.CreatePolyhedron('bl', { type: v ? 3 : 2, size: v ? 0.1 : 0.09 }, kit.scene);
    m.scaling.set(1.15, 0.62, 0.9); m.position.y = 0.045; m.material = kit.mat(v ? '#938f88' : '#807c75');
    S.parts.push(m);
    return S.merge();
  }
  function boulderBatch(v) { return getBatch('boulder' + v, function () { return boulderModel(v); }); }
  var rockMats = {};
  function rockMat(foot) { // каменистая земля: щебень и мелкая галька; у подножия горы темнее
    var k = foot ? 'f' : 'r'; if (rockMats[k]) return rockMats[k];
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d'), r = rng(foot ? 91 : 61);
    g.fillStyle = foot ? '#8b877e' : '#a8a194'; g.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 26; i++) { var x = r() * 128, y = r() * 128, rad = 8 + r() * 18, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, r() > 0.5 ? 'rgba(70,64,56,.22)' : 'rgba(225,218,200,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    for (i = 0; i < 230; i++) {
      var v = r(), px = r() * 128, py = r() * 128, w = 2 + r() * 5;
      g.fillStyle = v > 0.66 ? 'rgba(236,230,214,.75)' : v > 0.33 ? 'rgba(96,90,82,.75)' : 'rgba(150,142,128,.8)';
      g.beginPath(); g.ellipse(px, py, w, w * (0.55 + r() * 0.3), r() * 3, 0, 7); g.fill();
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(px + 1, py + 1.5, w * 0.9, w * 0.45, 0, 0, 7); g.fill();
    }
    for (i = 0; i < 34; i++) { g.fillStyle = 'rgba(96,136,70,.55)'; g.fillRect(r() * 128, r() * 128, 2, 3 + r() * 3); } // редкая трава между камнями
    var m = flatMat('#ffffff'), tx = new B.DynamicTexture('rock' + k, c, scene, true); tx.update();
    m.diffuseTexture = tx; return (rockMats[k] = m);
  }
  var mtMat = null;
  function mountainMat() {
    if (!mtMat) { mtMat = new B.StandardMaterial('mtMat', scene); mtMat.diffuseColor = B.Color3.White(); mtMat.specularColor = B.Color3.Black(); mtMat.backFaceCulling = false; }
    return mtMat;
  }
  function mountainNode(d) { // грани — «низкополигональные», цвет в вершинах: серая скала, внизу земля, на вершинах снег
    var md = TERRAIN.mountainMesh(d), m = new B.Mesh('mt', scene), vd = new B.VertexData();
    vd.positions = md.pos; vd.normals = md.nor; vd.colors = md.col; vd.indices = md.ind; vd.applyToMesh(m);
    m.position.set(-N / 2, 0, -N / 2);   // сетка посчитана в клетках карты, сцена — от центра
    m.material = mountainMat(); m.isPickable = false; m.receiveShadows = true;
    shadowGen.addShadowCaster(m, false);
    return m;
  }
  function disposeMt(id) {
    var r = mtMesh[id]; if (!r) return;
    shadowGen.removeShadowCaster(r.mesh); r.mesh.dispose(); delete mtMesh[id];
  }
  function putTree(i, x, z, kind) {
    var L = TERRAIN.treeLook(state.env.seed, x, z, kind), c = cellCenter(x, z);
    batchSet(treeBatch(kind), i, c.x + L.dx, 0, c.z + L.dz, L.yaw, L.s, L.s, L.s);
  }
  function putBoulders(i, x, z, t) {
    var c = cellCenter(x, z);
    TERRAIN.boulders(state.env.seed, x, z, t).forEach(function (b, n) { batchSet(boulderBatch(b[4]), i * 4 + n, c.x + b[0], 0, c.z + b[1], b[3], b[2], b[2], b[2]); });
  }
  function dropBoulders(i, x, z, t) {
    TERRAIN.boulders(state.env.seed, x, z, t).forEach(function (b, n) { batchRemove(boulderBatch(b[4]), i * 4 + n); });
  }
  function envReset() {
    if (terr.length !== N * N) { terr = new Uint8Array(N * N); treeA = new Uint8Array(N * N); } else { terr.fill(0); treeA.fill(0); }
    Object.keys(envC).forEach(function (ck) { [envC[ck].rock, envC[ck].foot].forEach(function (m) { if (m) m.dispose(); }); });
    Object.keys(mtMesh).forEach(disposeMt);
    ['tree1', 'tree2', 'tree3', 'boulder0', 'boulder1'].forEach(function (k) { var bt = batches[k]; if (bt) { bt.ids = []; bt.at = {}; dirtyBatches[k] = bt; } });
    envC = {}; mtMesh = {}; cleared = {};
  }
  // Кусок карты загрузился: расставить деревья, камни и горы (кроме клеток под зданиями и дорогами)
  function envLoad(cx, cz, tlist) {
    var ck = ckey(cx, cz), x0 = cx * WC, z0 = cz * WC, x1 = Math.min(N, x0 + WC), z1 = Math.min(N, z0 + WC), w = x1 - x0;
    var cl = cleared[ck] = {}, rockQ = [], footQ = [], x, z;
    (tlist || []).forEach(function (n) { cl[n] = 1; });
    var g = TERRAIN.cells(state.env, N, x0, z0, x1, z1);
    for (z = z0; z < z1; z++) for (x = x0; x < x1; x++) {
      var li = (z - z0) * w + (x - x0), i = idx(x, z), t = g.terr[li], tr = g.tree[li], free = !occ[i] && !state.roads[key(x, z)];
      terr[i] = t;
      if (tr && free && !cl[(z - z0) * WC + (x - x0)]) { treeA[i] = tr; putTree(i, x, z, tr); }
      if (t === 1 || t === 3) {
        var c = cellCenter(x, z); (t === 3 ? footQ : rockQ).push([c.x, c.z, 1, 1, 0.008, (x * 7 + z * 13) & 3]);
        if (free) putBoulders(i, x, z, t);
      }
    }
    var e = envC[ck] = { mts: [] };
    if (rockQ.length) { e.rock = quadsMesh('rockfield', rockQ, rockMat(false)); e.rock.receiveShadows = true; }
    if (footQ.length) { e.foot = quadsMesh('rockfoot', footQ, rockMat(true)); e.foot.receiveShadows = true; }
    TERRAIN.mountains(state.env, N, x0, z0, x1, z1).forEach(function (d) {
      var r = mtMesh[d.id]; if (!r) r = mtMesh[d.id] = { mesh: mountainNode(d), n: 0, chunks: {}, d: d };
      if (!r.chunks[ck]) { r.chunks[ck] = 1; r.n++; e.mts.push(d.id); }
    });
    dirty();
  }
  function envUnload(ck, L) {
    if (!state.env) return;
    var x0 = L.x * WC, z0 = L.z * WC, x1 = Math.min(N, x0 + WC), z1 = Math.min(N, z0 + WC), x, z;
    for (z = z0; z < z1; z++) for (x = x0; x < x1; x++) {
      var i = idx(x, z);
      if (treeA[i]) { batchRemove(treeBatch(treeA[i]), i); treeA[i] = 0; }
      if (terr[i] === 1 || terr[i] === 3) dropBoulders(i, x, z, terr[i]);
      terr[i] = 0;
    }
    var e = envC[ck];
    if (e) {
      [e.rock, e.foot].forEach(function (m) { if (m) m.dispose(); });
      e.mts.forEach(function (id) { var r = mtMesh[id]; if (!r) return; delete r.chunks[ck]; if (--r.n <= 0) disposeMt(id); });
      delete envC[ck];
    }
    delete cleared[ck];
    dirty();
  }
  function clearedList(ck) { var c = cleared[ck]; return c ? Object.keys(c).map(Number) : []; }
  function localCell(x, z) { return (z - Math.floor(z / WC) * WC) * WC + (x - Math.floor(x / WC) * WC); }
  // Убрать дерево в клетке (стройка, дорога или «Удалить»). Возвращает true, если дерево было.
  function clearTree(x, z) {
    if (!state.env || !inMap(x, z)) return false;
    var i = idx(x, z), k = treeA[i]; if (!k) return false;
    var c = cleared[ckOf(x, z)]; if (!c) return false; // кусок не загружен
    treeA[i] = 0; batchRemove(treeBatch(k), i);
    c[localCell(x, z)] = 1; touchCell(x, z, true);
    if (undoLog) undoLog.push(['t', x, z, k]);
    dirty(); return true;
  }
  function restoreTree(x, z, k) { // отмена случайного жеста: дерево возвращается на место
    if (!state.env || !inMap(x, z)) return;
    var i = idx(x, z), c = cleared[ckOf(x, z)]; if (!c || treeA[i] || occ[i] || state.roads[key(x, z)]) return;
    treeA[i] = k; putTree(i, x, z, k); delete c[localCell(x, z)]; touchCell(x, z, true); dirty();
  }
  // Площадка под здание: деревья убираются, валуны на каменистой земле — тоже
  function clearArea(x0, z0, w, d) {
    if (!state.env) return 0;
    var n = 0;
    for (var z = z0; z < z0 + d; z++) for (var x = x0; x < x0 + w; x++) {
      if (!inMap(x, z)) continue;
      if (clearTree(x, z)) n++;
      var t = terr[idx(x, z)]; if (t === 1 || t === 3) dropBoulders(idx(x, z), x, z, t);
    }
    return n;
  }
  // Справка о природе по нажатию в режиме «Смотреть»
  function terrainText(x, z) {
    if (!state.env || !inMap(x, z) || !loaded[ckOf(x, z)]) return '';
    var i = idx(x, z), tr = treeA[i], t = terr[i];
    if (tr) return '🌳 ' + TREE_NAME[tr] + '. Деревья не растут и не размножаются. Уберутся сами, если здесь построить здание или проложить дорогу, или инструментом «Удалить»';
    if (t === 1) return '🪨 Каменистая площадка. Здесь добывают камень: ⛏️ «Камень» → Каменоломня (нужно 5 клеток из 9 с камнем). Обычные здания тут не ставят, дорогу проложить можно';
    if (t === 3) return '⛰️ Подножие горы — каменистая земля. Здесь добывают камень: Горный карьер ставят вплотную к склону (6 клеток подножия из 16) и Каменоломню — на любой каменистой земле';
    if (t === 2) return '🏔️ Склон горы. Строить и прокладывать дороги нельзя. Камень добывают у подножия — Горный карьер';
    return '';
  }
  function pickMountain(sx, sy) { // луч в гору: земля за горой не считается
    var ids = Object.keys(mtMesh); if (!state.env || !ids.length) return null;
    var r = rayAt(sx, sy), o = r.origin, d = r.direction; if (d.y > -1e-6) return null;
    var t0 = Math.max(0, (o.y - 6.5) / -d.y), t1 = o.y / -d.y;
    for (var t = t0; t < t1; t += 0.08) {
      var px = o.x + d.x * t + N / 2, py = o.y + d.y * t, pz = o.z + d.z * t + N / 2;
      for (var k = 0; k < ids.length; k++) {
        var md = mtMesh[ids[k]].d;
        if (px < md.x0 || px > md.x1 || pz < md.z0 || pz > md.z1) continue;
        if (TERRAIN.heightAt(md, px, pz) >= py - 0.02) return md;
      }
    }
    return null;
  }

  // ---------- Здания и стройплощадки на сцене ----------
  var placed = {}, sites = {}; // id -> batch; id -> стройплощадка
  function bPos(b) { var f = foot(b.size, b.rot); return { x: b.x + f.w / 2 - N / 2, z: b.z + f.d / 2 - N / 2, yaw: -b.rot * Math.PI / 2 }; }
  function writeBuilding(b) {
    var bt = placed[b.id]; if (!bt) return;
    var p = bPos(b), hide = moving && moving.b.id === b.id;
    if (isSite(b)) {
      // готовое здание на стройке не рисуется пачкой — у площадки своя модель с отсечением по высоте
      batchRemove(bt, b.id);
      var st = sites[b.id];
      if (st && (st.bx !== b.x || st.bz !== b.z || st.rot !== b.rot)) { disposeSite(b.id); addSite(b); updateSite(b, 0); st = sites[b.id]; }
      if (st) { st.node.setEnabled(!hide); if (st.crane) st.crane.root.setEnabled(!hide); st.hidden = hide; }
    } else if (hide) batchSet(bt, b.id, p.x, -50, p.z, p.yaw, 0.001, 0.001, 0.001);
    else batchSet(bt, b.id, p.x, 0, p.z, p.yaw, 1, 1, 1);
    pinFor(b);
    dirty();
  }

  // Этапы стройки — как в жизни. to — до какой доли прогресса длится этап.
  var STAGES = [
    { to: 0.10, name: 'Подготовка площадки', about: 'забор, котлован, монтаж крана' },
    { to: 0.20, name: 'Фундамент', about: 'бетонная плита' },
    { to: 0.84, name: 'Возведение этажей', about: 'этаж за этажом, леса растут вместе с домом' },
    { to: 0.95, name: 'Отделка и снятие лесов', about: 'леса разбирают сверху вниз' },
    { to: 1.00, name: 'Уборка площадки', about: 'разбирают кран, рабочие уезжают' }
  ];
  function stageOf(p) { for (var i = 0; i < STAGES.length; i++) if (p < STAGES[i].to) return i; return STAGES.length - 1; }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function mix(a, b, k) { return a + (b - a) * k; }
  function mixAng(a, b, k) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k; }
  var LH = 0.3; // высота яруса лесов ≈ один этаж

  // Отрезок-балка от p0 до p1 (для кранов и лесов)
  function beam(S, color, x0, y0, z0, x1, y1, z1, th) {
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
    var m = S.box(th, th, len, kit.mat(color), 0, 0, 0);
    S.bake(m, -Math.asin(dy / len), Math.atan2(dx, dz), 0);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return m;
  }
  function finishMesh(m, shadow) {
    m.isPickable = false; m.receiveShadows = true;
    if (shadow) shadowGen.addShadowCaster(m, false);
    return m;
  }

  // Модель будущего здания: свои копии материалов с плоскостью отсечения — дом «вырастает» снизу вверх.
  function siteModel(b, plane) {
    var m = buildModel(kit, b.cat, b.size, modelSeed(b.cat, variantOf(b.cat, b.seed)), b.th | 0), pairs = [];
    function copy(src) {
      var d = new B.StandardMaterial('sm' + b.id, scene);
      pairs.push({ s: src, d: d }); syncMat(src, d); d.clipPlane = plane; return d;
    }
    if (m.material && m.material.subMaterials) {
      var mm = new B.MultiMaterial('smm' + b.id, scene);
      mm.subMaterials = m.material.subMaterials.map(copy);
      var old = m.material; m.material = mm; old.subMaterials = []; old.dispose();
    } else if (m.material) m.material = copy(m.material);
    m.isPickable = false; m.receiveShadows = true;
    return { mesh: m, pairs: pairs };
  }
  function syncMat(s, d) {
    d.diffuseColor = s.diffuseColor.clone(); d.diffuseTexture = s.diffuseTexture || null;
    d.specularColor = s.specularColor.clone(); d.specularPower = s.specularPower;
  }
  function syncSiteMats() { for (var id in sites) if (sites[id].model) sites[id].model.pairs.forEach(function (p) { syncMat(p.s, p.d); }); }

  // Ярус строительных лесов: стойки в два ряда, настил из досок, перила и зелёная сетка.
  var netMat = null;
  function scaffoldLevel(hx, hz) {
    var S = Shapes(kit, 0, 0), PIPE = '#b8c0c8', PLANK = '#c49a5c';
    var ri = 0.015, ro = 0.11, ax = hx + ri, bx = hx + ro, az = hz + ri, bz = hz + ro;
    function posts(x0, z0, x1, z1) { // стойки вдоль стороны
      var len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 0.45));
      for (var i = 0; i <= n; i++) { var k = i / n; S.box(0.012, LH, 0.012, kit.mat(PIPE), mix(x0, x1, k), LH / 2, mix(z0, z1, k)); }
      return n;
    }
    [[ax, az], [bx, bz]].forEach(function (r) {
      posts(-r[0], -r[1], r[0], -r[1]); posts(-r[0], r[1], r[0], r[1]);
      posts(-r[0], -r[1] + 0.45, -r[0], r[1] - 0.45); posts(r[0], -r[1] + 0.45, r[0], r[1] - 0.45);
    });
    var mx = (ax + bx) / 2, mz = (az + bz) / 2, w = ro - ri + 0.02;
    // настил
    S.box(2 * bx, 0.012, w, kit.mat(PLANK), 0, LH - 0.006, -mz); S.box(2 * bx, 0.012, w, kit.mat(PLANK), 0, LH - 0.006, mz);
    S.box(w, 0.012, 2 * az, kit.mat(PLANK), -mx, LH - 0.006, 0); S.box(w, 0.012, 2 * az, kit.mat(PLANK), mx, LH - 0.006, 0);
    // перила снаружи и горизонтали
    [LH * 0.5, LH - 0.03].forEach(function (y) {
      S.box(2 * bx, 0.008, 0.008, kit.mat(PIPE), 0, y, -bz); S.box(2 * bx, 0.008, 0.008, kit.mat(PIPE), 0, y, bz);
      S.box(0.008, 0.008, 2 * bz, kit.mat(PIPE), -bx, y, 0); S.box(0.008, 0.008, 2 * bz, kit.mat(PIPE), bx, y, 0);
    });
    // диагональные связи на каждой стороне
    beam(S, PIPE, -bx, 0.01, -bz, -bx + Math.min(0.5, bx), LH - 0.02, -bz, 0.007);
    beam(S, PIPE, bx, 0.01, bz, bx - Math.min(0.5, bx), LH - 0.02, bz, 0.007);
    beam(S, PIPE, -bx, 0.01, bz, -bx, LH - 0.02, bz - Math.min(0.5, bz), 0.007);
    beam(S, PIPE, bx, 0.01, -bz, bx, LH - 0.02, -bz + Math.min(0.5, bz), 0.007);
    var frame = S.merge();
    // сетка — отдельная прозрачная сетка-оболочка
    if (!netMat) {
      netMat = new B.StandardMaterial('net', scene); netMat.diffuseColor = hex('#3f9a52'); netMat.specularColor = B.Color3.Black();
      netMat.alpha = 0.24; netMat.backFaceCulling = false;
    }
    var N2 = Shapes(kit, 0, 0), nh = LH * 0.62, ny = LH * 0.5 + 0.004;
    N2.box(2 * bx, nh, 0.002, netMat, 0, ny, -bz - 0.004); N2.box(2 * bx, nh, 0.002, netMat, 0, ny, bz + 0.004);
    N2.box(0.002, nh, 2 * bz, netMat, -bx - 0.004, ny, 0); N2.box(0.002, nh, 2 * bz, netMat, bx + 0.004, ny, 0);
    var net = B.Mesh.MergeMeshes(N2.parts, true, true); net.material = netMat; net.isPickable = false;
    net.parent = frame;
    return frame;
  }

  // Башенный кран. Стрела смотрит по +z, поворот — rotation.y.
  var SW = 0.1, SH = 0.16, YEL = '#f2b705';
  function craneSection() {
    var S = Shapes(kit, 0, 0), t = 0.012, h = SW / 2;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { S.box(t, SH, t, kit.mat(YEL), c[0] * h, SH / 2, c[1] * h); });
    S.box(SW, 0.008, 0.008, kit.mat(YEL), 0, 0.006, -h); S.box(SW, 0.008, 0.008, kit.mat(YEL), 0, 0.006, h);
    S.box(0.008, 0.008, SW, kit.mat(YEL), -h, 0.006, 0); S.box(0.008, 0.008, SW, kit.mat(YEL), h, 0.006, 0);
    beam(S, YEL, -h, 0.006, -h, h, SH, -h, 0.007); beam(S, YEL, h, 0.006, h, -h, SH, h, 0.007);
    beam(S, YEL, -h, 0.006, h, -h, SH, -h, 0.007); beam(S, YEL, h, 0.006, -h, h, SH, h, 0.007);
    return S.merge();
  }
  function craneTop(JL, CJ) {
    var S = Shapes(kit, 0, 0), y0 = 0.05;
    S.box(0.15, 0.05, 0.15, kit.mat('#d79c07'), 0, 0.025, 0);                         // поворотный круг
    S.box(0.08, 0.075, 0.085, kit.mat(YEL), 0.085, 0.0, 0.07);                      // кабина
    S.box(0.082, 0.04, 0.06, kit.mat('#9cc3dd'), 0.085, 0.01, 0.09);
    // оголовок
    beam(S, YEL, -0.04, y0, -0.04, 0, 0.36, 0, 0.012); beam(S, YEL, 0.04, y0, -0.04, 0, 0.36, 0, 0.012);
    beam(S, YEL, -0.04, y0, 0.04, 0, 0.36, 0, 0.012); beam(S, YEL, 0.04, y0, 0.04, 0, 0.36, 0, 0.012);
    // стрела: треугольная ферма
    var a = 0.035, top = y0 + 0.075;
    S.box(0.009, 0.009, JL, kit.mat(YEL), -a, y0 + 0.005, JL / 2); S.box(0.009, 0.009, JL, kit.mat(YEL), a, y0 + 0.005, JL / 2);
    S.box(0.009, 0.009, JL, kit.mat(YEL), 0, top, JL / 2);
    var bay = 0.12, n = Math.max(2, Math.round(JL / bay)); bay = JL / n;
    for (var i = 0; i < n; i++) {
      var z0 = i * bay, z1 = z0 + bay / 2, z2 = z0 + bay;
      beam(S, YEL, -a, y0 + 0.005, z0, 0, top, z1, 0.006); beam(S, YEL, 0, top, z1, -a, y0 + 0.005, z2, 0.006);
      beam(S, YEL, a, y0 + 0.005, z0, 0, top, z1, 0.006); beam(S, YEL, 0, top, z1, a, y0 + 0.005, z2, 0.006);
      S.box(2 * a, 0.006, 0.006, kit.mat(YEL), 0, y0 + 0.005, z2);
    }
    // противовесная консоль с бетонными блоками
    S.box(0.1, 0.025, CJ, kit.mat(YEL), 0, y0 + 0.012, -CJ / 2);
    S.box(0.12, 0.09, 0.1, kit.mat('#9a9a92'), 0, y0 - 0.02, -CJ + 0.07);
    S.box(0.12, 0.004, 0.004, kit.mat('#6d6d66'), 0, y0 - 0.02, -CJ + 0.07 + 0.051);
    // ванты от оголовка
    beam(S, '#7c6a2a', 0, 0.36, 0, 0, top, JL * 0.62, 0.005);
    beam(S, '#7c6a2a', 0, 0.36, 0, 0, y0 + 0.025, -CJ + 0.02, 0.005);
    var m = S.merge(); return m;
  }
  function craneLoad(kind) {
    var S = Shapes(kit, 0, 0);
    if (kind === 0) { // поддон с кирпичом
      S.box(0.15, 0.018, 0.11, kit.mat('#a8844f'), 0, -0.1, 0);
      S.box(0.13, 0.07, 0.095, kit.mat('#b5563c'), 0, -0.056, 0);
      for (var i = 0; i < 3; i++) S.box(0.132, 0.004, 0.097, kit.mat('#d9cbb5'), 0, -0.08 + i * 0.022, 0);
    } else if (kind === 1) { // двутавровая балка
      S.box(0.36, 0.008, 0.035, kit.mat('#5f6f80'), 0, -0.09, 0); S.box(0.36, 0.008, 0.035, kit.mat('#5f6f80'), 0, -0.06, 0);
      S.box(0.36, 0.03, 0.007, kit.mat('#5f6f80'), 0, -0.075, 0);
    } else { // бадья с бетоном
      S.cyl(0.045, 0.03, 0.08, 10, '#7a8088', 0, -0.06, 0); S.cyl(0.042, 0.042, 0.004, 10, '#b9b4a8', 0, -0.019, 0);
    }
    beam(S, '#3a3a3a', 0, 0, 0, kind === 1 ? -0.15 : -0.05, -0.05, 0, 0.004);
    beam(S, '#3a3a3a', 0, 0, 0, kind === 1 ? 0.15 : 0.05, -0.05, 0, 0.004);
    return S.merge();
  }
  // Место для крана: угол участка, снаружи — если соседняя клетка свободна.
  function cranePlace(b) {
    var f = foot(b.size, b.rot), c = siteCenter(b), best = null, score = -1;
    [[1, -1], [-1, 1], [-1, -1], [1, 1]].forEach(function (s) {
      var cx = s[0] > 0 ? b.x + f.w : b.x - 1, cz = s[1] > 0 ? b.z + f.d : b.z - 1, sc = 0;
      if (inMap(cx, cz) && !occ[idx(cx, cz)]) sc = state.roads[key(cx, cz)] ? 1 : 2;
      if (sc > score) { score = sc; best = s; }
    });
    var out = score > 0 ? 0.13 : -0.12;
    return { x: c.x + best[0] * (f.w / 2 + out), z: c.z + best[1] * (f.d / 2 + out), sx: best[0], sz: best[1] };
  }
  function buildCrane(b, st) {
    var cp = cranePlace(b), c = siteCenter(b), f = foot(b.size, b.rot);
    var mastH = Math.max(1.0, st.h + 0.55), nSec = Math.ceil(mastH / SH); mastH = nSec * SH + 0.05;
    var reach = Math.hypot(c.x - cp.x, c.z - cp.z), JL = Math.max(1.1, reach + 0.45), CJ = Math.min(0.55, 0.25 + JL * 0.12);
    var root = new B.TransformNode('crane' + b.id, scene); root.position.set(cp.x, 0, cp.z);
    var base = B.MeshBuilder.CreateBox('cbase', { width: 0.24, height: 0.05, depth: 0.24 }, scene);
    base.material = kit.mat('#8f8b82'); base.position.y = 0.025; base.parent = root; finishMesh(base, true);
    var sec0 = craneSection(); finishMesh(sec0, true); sec0.parent = root; sec0.position.y = 0.05;
    var secs = [sec0];
    for (var i = 1; i < nSec; i++) { var s = sec0.createInstance('cs'); s.parent = root; s.position.y = 0.05 + i * SH; s.isPickable = false; secs.push(s); }
    var slew = new B.TransformNode('slew', scene); slew.parent = root; slew.position.y = 0.05 + nSec * SH;
    var top = craneTop(JL, CJ); finishMesh(top, true); top.parent = slew;
    var trolley = B.MeshBuilder.CreateBox('trol', { width: 0.06, height: 0.025, depth: 0.07 }, scene);
    trolley.material = kit.mat('#3d4148'); trolley.parent = slew; trolley.position.y = 0.035; finishMesh(trolley, true);
    var cable = B.MeshBuilder.CreateBox('cab', { width: 0.005, height: 1, depth: 0.005 }, scene);
    cable.material = kit.mat('#2b2b2b'); cable.parent = trolley; finishMesh(cable, false);
    var hook = B.MeshBuilder.CreateBox('hook', { width: 0.034, height: 0.03, depth: 0.024 }, scene);
    hook.material = kit.mat('#e0402a'); hook.parent = trolley; finishMesh(hook, true);
    var loads = [0, 1, 2].map(function (k) { var l = craneLoad(k); l.parent = hook; finishMesh(l, true); l.setEnabled(false); return l; });
    // откуда берём груз: середина стороны участка у крана — там встаёт грузовик
    var pick = { x: c.x + cp.sx * 0, z: c.z + cp.sz * (f.d / 2 + 0.5) };
    var cr = { root: root, secs: secs, slew: slew, trolley: trolley, cable: cable, hook: hook, loads: loads, JL: JL,
      topY: slew.position.y, mast: { x: cp.x, z: cp.z }, pick: pick, drop: { x: c.x, z: c.z }, yaw: Math.atan2(c.x - cp.x, c.z - cp.z), r: Math.min(reach, JL - 0.05), hy: 0 };
    cr.hy = cr.topY - 0.25; placeHook(cr, -1);
    return cr;
  }
  function placeHook(cr, load) {
    cr.slew.rotation.y = cr.yaw;
    cr.trolley.position.z = clamp(cr.r, 0.22, cr.JL - 0.04);
    var drop = Math.max(0.05, cr.topY + 0.035 - cr.hy);
    cr.hook.position.y = -drop; cr.cable.scaling.y = drop; cr.cable.position.y = -drop / 2;
    cr.loads.forEach(function (l, i) { l.setEnabled(i === load); });
  }
  // Цикл крана: опустить крюк к грузовику → поднять → повернуть к дому → опустить на этаж → отцепить → вернуться.
  function animCrane(st, workH) {
    var cr = st.crane, PER = 8, u = (st.clock / PER) % 1, cyc = Math.floor(st.clock / PER);
    var A = cr.pick, Bp = cr.drop, M = cr.mast;
    var yA = Math.atan2(A.x - M.x, A.z - M.z), rA = Math.hypot(A.x - M.x, A.z - M.z);
    var yB = Math.atan2(Bp.x - M.x, Bp.z - M.z), rB = Math.hypot(Bp.x - M.x, Bp.z - M.z);
    var hiY = cr.topY - 0.25, loA = 0.3, loB = Math.min(hiY - 0.05, workH + 0.14), k;
    if (u < 0.12) { k = smooth(u / 0.12); cr.yaw = yA; cr.r = rA; cr.hy = mix(hiY, loA, k); }
    else if (u < 0.24) { cr.hy = mix(loA, hiY, smooth((u - 0.12) / 0.12)); }
    else if (u < 0.46) { k = smooth((u - 0.24) / 0.22); cr.yaw = mixAng(yA, yB, k); cr.r = mix(rA, rB, k); cr.hy = hiY; }
    else if (u < 0.58) { cr.yaw = yB; cr.r = rB; cr.hy = mix(hiY, loB, smooth((u - 0.46) / 0.12)); }
    else if (u < 0.66) { cr.hy = loB; }
    else if (u < 0.78) { cr.hy = mix(loB, hiY, smooth((u - 0.66) / 0.12)); }
    else { k = smooth((u - 0.78) / 0.22); cr.yaw = mixAng(yB, yA, k); cr.r = mix(rB, rA, k); cr.hy = hiY; }
    placeHook(cr, u > 0.1 && u < 0.62 ? cyc % 3 : -1);
  }

  // Рабочие-миниатюры: тело и ноги — пачки (thin instances), ноги шагают.
  function workerBody(K, carry) {
    var S = Shapes(K, 0, 0), VEST = '#ff7a1a', PANTS = '#2e3a55';
    S.box(0.046, 0.016, 0.028, K.mat(PANTS), 0, 0.074, 0);
    S.box(0.05, 0.056, 0.03, K.mat(VEST), 0, 0.108, 0);
    S.box(0.052, 0.006, 0.032, K.mat('#eef0d8'), 0, 0.098, 0);
    [-1, 1].forEach(function (s) {
      var arm = S.box(0.014, 0.05, 0.016, K.mat(VEST), s * 0.032, 0.105, 0);
      if (carry) { S.bake(arm, -1.1, 0, 0); arm.position.set(s * 0.032, 0.112, 0.018); }
    });
    if (carry) S.box(0.056, 0.024, 0.032, K.mat('#b5563c'), 0, 0.118, 0.042);
    var head = B.MeshBuilder.CreateSphere('hd', { diameter: 0.03, segments: 6 }, K.scene); head.material = K.mat('#e9b48f'); head.position.set(0, 0.148, 0); S.parts.push(head);
    var hel = B.MeshBuilder.CreateSphere('hl', { diameter: 0.036, segments: 6, slice: 0.5 }, K.scene); hel.material = K.mat(carry ? '#f6c623' : '#f4f4ee'); hel.position.set(0, 0.153, 0); S.parts.push(hel);
    S.cyl(0.023, 0.023, 0.004, 10, carry ? '#f6c623' : '#f4f4ee', 0, 0.153, 0.004);
    return S.merge();
  }
  function workerLeg(K) {
    var S = Shapes(K, 0, 0);
    S.box(0.018, 0.064, 0.022, K.mat('#2e3a55'), 0, -0.032, 0);
    S.box(0.02, 0.012, 0.03, K.mat('#3a2a1e'), 0, -0.064, 0.004);
    return S.merge();
  }
  function wBody(carry) { return getBatch(carry ? 'wbody1' : 'wbody0', function () { return workerBody(kit, carry); }); }
  function wLeg() { return getBatch('wleg', function () { return workerLeg(kit); }); }
  function removeWorker(id, k) {
    var wid = 'w' + id + '_' + k;
    batchRemove(wBody(0), wid); batchRemove(wBody(1), wid); batchRemove(wLeg(), wid + 'L'); batchRemove(wLeg(), wid + 'R');
  }
  var WS = 1.25; // масштаб человечков: чуть крупнее «настоящего», чтобы их было видно
  // поставить рабочего: x, z — в осях участка (до поворота), yaw — куда смотрит, walk — фаза шага
  function putWorker(st, k, carry, lx, y, lz, yaw, walk, bend) {
    var th = st.yaw, cs = Math.cos(th), sn = Math.sin(th), wx = st.cx + lx * cs + lz * sn, wz = st.cz - lx * sn + lz * cs, wy = yaw + th;
    var wid = 'w' + st.id + '_' + k, sw = walk === null ? 0 : Math.sin(walk) * 0.6, bob = walk === null ? 0 : Math.abs(Math.sin(walk)) * 0.008;
    batchRemove(wBody(!carry), wid);
    batchSet(wBody(carry), wid, wx, y + bob, wz, wy, WS, WS, WS, 0, bend || 0);
    var c2 = Math.cos(wy), s2 = Math.sin(wy);
    [[-1, 'L'], [1, 'R']].forEach(function (L) {
      var ox = L[0] * 0.012 * WS;
      batchSet(wLeg(), wid + L[1], wx + ox * c2, y + 0.07 * WS + bob, wz - ox * s2, wy, WS, WS, WS, 0, L[0] * sw);
    });
  }
  // точка на прямоугольном обходе (полупериметры hx, hz), s — пройденный путь
  function loopAt(hx, hz, s) {
    var P = 4 * (hx + hz); s = ((s % P) + P) % P;
    if (s < 2 * hx) return { x: -hx + s, z: hz, yaw: Math.PI / 2 };
    s -= 2 * hx; if (s < 2 * hz) return { x: hx, z: hz - s, yaw: Math.PI };
    s -= 2 * hz; if (s < 2 * hx) return { x: hx - s, z: -hz, yaw: -Math.PI / 2 };
    s -= 2 * hx; return { x: -hx, z: -hz + s, yaw: 0 };
  }
  function animWorkers(st, stage, levels, workH, here, moving) {
    var cap = { '1x1': 4, '2x1': 5, '2x2': 7, '4x4': 10 }[st.size] || 5;
    var n = here ? Math.min(cap, 2 + here * 2) : 0;
    if (stage === 4) n = Math.min(n, 2);
    for (var k = n; k < st.wn; k++) removeWorker(st.id, k);
    st.wn = n;
    var hx = st.hx, hz = st.hz, gx = hx + 0.155, gz = hz + 0.155, t = st.clock;
    for (k = 0; k < n; k++) {
      var role = stage >= 2 && stage <= 3 ? k % 3 : (k % 2 ? 1 : 2);
      var deck = Math.min(levels - 1, Math.floor(workH / LH) - 1) - (role === 2 ? 1 : 0);
      if (role !== 1 && deck >= 0 && stage >= 2 && stage <= 3) { // на лесах
        var side = (k + st.id) % 4, len = side % 2 ? hz : hx, dk = (deck + 1) * LH;
        if (role === 0) { // ходит по настилу туда-сюда
          var ph = (t * 0.22 + k * 0.37) % 2, pos = ph < 1 ? ph : 2 - ph, along = mix(-len + 0.06, len - 0.06, pos), dir = ph < 1 ? 1 : -1;
          var o = side % 2 ? hx + 0.062 : hz + 0.062;
          var P = [[along, o, dir > 0 ? Math.PI / 2 : -Math.PI / 2], [o, -along, dir > 0 ? Math.PI : 0], [-along, -o, dir > 0 ? -Math.PI / 2 : Math.PI / 2], [-o, along, dir > 0 ? 0 : Math.PI]][side];
          putWorker(st, k, false, P[0], dk, P[1], P[2], moving ? t * 9 + k : null, 0);
        } else { // стоит у стены и работает (кладёт кирпич)
          var a2 = (k * 0.29) % 1, o2 = (side % 2 ? hx : hz) + 0.05, al = mix(-len + 0.1, len - 0.1, a2);
          var Q = [[al, o2, Math.PI], [o2, -al, -Math.PI / 2], [-al, -o2, 0], [-o2, al, Math.PI / 2]][side];
          putWorker(st, k, false, Q[0], dk, Q[1], Q[2], null, moving ? 0.35 * Math.max(0, Math.sin(t * 5 + k * 2)) : 0);
        }
      } else if (role === 2 && stage <= 1) { // копает / заливает в центре площадки
        var a3 = k * 2.1 + st.id;
        putWorker(st, k, false, Math.cos(a3) * hx * 0.45, stage === 1 ? 0.05 : 0, Math.sin(a3) * hz * 0.45, a3 + Math.PI / 2, null,
          moving ? 0.45 * Math.max(0, Math.sin(t * 4 + k)) : 0);
      } else { // носит кирпич по кругу вдоль забора
        var L2 = loopAt(gx, gz, t * 0.2 + k * (gx + gz) * 1.3);
        putWorker(st, k, true, L2.x, 0, L2.z, L2.yaw, moving ? t * 9 + k : null, 0);
      }
    }
  }

  function addSite(b) {
    var s = G.sizes[b.size], W = s.w, D = s.d, p = bPos(b), c = siteCenter(b);
    var node = new B.TransformNode('site' + b.id, scene); node.position.set(p.x, 0, p.z); node.rotation.y = p.yaw;
    var hx = W / 2 - 0.08, hz = D / 2 - 0.08, h = Math.max(0.45, placed[b.id].h);
    var st = { id: b.id, size: b.size, node: node, bx: b.x, bz: b.z, rot: b.rot, yaw: p.yaw, cx: c.x, cz: c.z, W: W, D: D, hx: hx, hz: hz, h: h,
      levels: Math.max(1, Math.round(h * 0.85 / LH)), clock: (b.id * 1.7) % 8, wn: 0, stage: -1 };
    // забор (снаружи участка), котлован, фундамент
    var S = Shapes(kit, 0, 0), fx = W / 2 + 0.12, fz = D / 2 + 0.12, e = 0.014, OR = '#ff8a1f';
    [0.05, 0.11].forEach(function (y) {
      S.box(2 * fx, 0.022, e, kit.mat(OR), 0, y, -fz); S.box(2 * fx, 0.022, e, kit.mat(OR), 0, y, fz);
      S.box(e, 0.022, 2 * fz, kit.mat(OR), -fx, y, 0); S.box(e, 0.022, 2 * fz, kit.mat(OR), fx, y, 0);
    });
    for (var i = 0; i <= Math.round(2 * fx / 0.4); i++) { var xx = -fx + i * 2 * fx / Math.round(2 * fx / 0.4); S.box(0.016, 0.14, 0.016, kit.mat('#f2f2ea'), xx, 0.07, -fz); S.box(0.016, 0.14, 0.016, kit.mat('#f2f2ea'), xx, 0.07, fz); }
    for (i = 1; i < Math.round(2 * fz / 0.4); i++) { var zz = -fz + i * 2 * fz / Math.round(2 * fz / 0.4); S.box(0.016, 0.14, 0.016, kit.mat('#f2f2ea'), -fx, 0.07, zz); S.box(0.016, 0.14, 0.016, kit.mat('#f2f2ea'), fx, 0.07, zz); }
    S.box(2 * fx, 0.006, 2 * fz, kit.mat('#b49a74'), 0, 0.003, 0);             // утоптанная земля
    var fence = finishMesh(S.merge(), true); fence.parent = node;
    var pit = B.MeshBuilder.CreateBox('pit', { width: 2 * hx + 0.04, height: 0.01, depth: 2 * hz + 0.04 }, scene);
    pit.material = kit.mat('#5a3e26'); pit.position.y = 0.008; pit.parent = node; finishMesh(pit, false);
    var mound = B.MeshBuilder.CreateCylinder('mnd', { diameterTop: 0, diameterBottom: Math.min(0.5, W * 0.35), height: 0.14, tessellation: 7 }, scene);
    mound.material = kit.mat('#7b5a3c'); mound.position.set(-hx + 0.18, 0.07, -hz + 0.18); mound.parent = node; finishMesh(mound, true);
    var slabF = B.MeshBuilder.CreateBox('fnd', { width: 2 * hx + 0.02, height: 1, depth: 2 * hz + 0.02 }, scene);
    slabF.setEnabled(false); slabF.material = kit.mat('#a7a29a'); slabF.parent = node; finishMesh(slabF, true);
    st.fence = fence; st.pit = pit; st.mound = mound; st.slab = slabF;
    // полоска прогресса
    var bw = Math.min(W, 2.4) * 0.8, bar = new B.TransformNode('bar', scene); bar.parent = node;
    var bg = B.MeshBuilder.CreateBox('bbg', { width: bw + 0.06, height: 0.07, depth: 0.07 }, scene); bg.material = kit.mat('#26303d'); bg.parent = bar;
    var fill = B.MeshBuilder.CreateBox('bfill', { width: bw, height: 0.045, depth: 0.08 }, scene);
    fill.setPivotPoint(new B.Vector3(-bw / 2, 0, 0)); fill.material = kit.mat('#5fd35a'); fill.parent = bar;
    [bg, fill].forEach(function (m) { m.isPickable = false; });
    st.bar = bar; st.fill = fill;
    sites[b.id] = st;
  }
  // Тяжёлые части (модель, леса, кран) создаются, когда стройка реально началась.
  function siteHeavy(b, st) {
    if (st.model) return;
    st.plane = new B.Plane(0, 1, 0, 0);
    st.model = siteModel(b, st.plane); st.model.mesh.parent = st.node;
    shadowGen.addShadowCaster(st.model.mesh, false);
    // «крышки» на срезе стен — перекрытие этажа, который сейчас строят
    st.caps = []; var wallTop = 0.3;
    st.model.mesh.subMeshes.forEach(function (sm) {
      var bb = sm.getBoundingInfo().boundingBox, mn = bb.minimum, mx = bb.maximum, w = mx.x - mn.x, d = mx.z - mn.z, mat = st.model.mesh.material.subMaterials ? st.model.mesh.material.subMaterials[sm.materialIndex] : null;
      if (sm.verticesCount !== 24 || w * d < 0.12 || mx.y - mn.y < 0.2 || !(mat && mat.diffuseTexture || w * d > 0.3)) return; // только коробки-стены
      if (mat && mat.diffuseTexture) wallTop = Math.max(wallTop, mx.y);
      var cap = B.MeshBuilder.CreateBox('cap', { width: w - 0.01, height: 0.022, depth: d - 0.01 }, scene);
      cap.material = kit.mat('#b8b3aa'); cap.parent = st.node; cap.position.set((mn.x + mx.x) / 2, 0, (mn.z + mx.z) / 2); finishMesh(cap, false);
      cap.setEnabled(false); st.caps.push({ m: cap, y0: mn.y, y1: mx.y });
    });
    st.levels = Math.max(1, Math.ceil((wallTop - 0.05) / LH));
    var lv = scaffoldLevel(st.hx, st.hz); finishMesh(lv, true); lv.parent = st.node;
    st.scaf = [lv];
    for (var i = 1; i < st.levels; i++) { var c = lv.createInstance('sl'); c.parent = st.node; c.position.y = i * LH; c.isPickable = false; st.scaf.push(c);
      var nc = lv.getChildMeshes()[0].createInstance('sn'); nc.parent = c; }
    st.crane = buildCrane(b, st);
    if (st.hidden) { st.crane.root.setEnabled(false); }
  }
  function disposeSite(id) {
    var st = sites[id]; if (!st) return;
    for (var k = 0; k < st.wn; k++) removeWorker(id, k);
    if (st.model) st.model.pairs.forEach(function (p) { p.d.dispose(); });
    if (st.crane) st.crane.root.dispose(false, false);
    st.node.dispose(false, false);
    delete sites[id];
  }
  // Показать стройку в нужном этапе. moving — идёт ли работа (рабочие шагают, кран крутится).
  function updateSite(b, dt) {
    var st = sites[b.id]; if (!st) return;
    var p = clamp(b.prog, 0, 1), stage = stageOf(p), crew = siteCrew(b.id), working = crew.here > 0;
    if (p > 0 || working) siteHeavy(b, st);
    st.fill.scaling.x = Math.max(0.001, p);
    st.bar.position.y = st.h + 0.5;
    // котлован и фундамент
    var f1 = seg(p, 0.10, 0.20);
    st.pit.setEnabled(stage <= 1); st.mound.setEnabled(stage === 0);
    st.slab.setEnabled(p >= 0.10); st.slab.scaling.y = Math.max(0.001, 0.05 * f1); st.slab.position.y = 0.025 * f1;
    if (!st.model) return;
    // дом растёт этажами; леса на ярус впереди
    var f2 = seg(p, 0.20, 0.84), clipH = stage <= 1 ? 0 : stage === 2 ? mix(0.05, st.h + 0.02, f2) : st.h + 5;
    st.plane.d = -clipH; st.model.mesh.setEnabled(stage >= 2);
    var lv = 0;
    if (stage === 2) lv = Math.min(st.levels, Math.floor(clipH / LH) + 2);
    else if (stage === 3) lv = Math.round(st.levels * (1 - seg(p, 0.86, 0.95)));
    st.scaf.forEach(function (m, i) { m.setEnabled(i < lv); });
    st.caps.forEach(function (c) {
      var on = stage === 2 && clipH > c.y0 + 0.02 && clipH < c.y1 - 0.01;
      c.m.setEnabled(on); if (on) c.m.position.y = clipH - 0.011;
    });
    // кран: монтаж секций в начале, демонтаж в конце
    var cr = st.crane, ns = cr.secs.length, vis = ns, slewOn = true;
    if (stage === 0) { vis = Math.ceil(ns * seg(p, 0.005, 0.08)); slewOn = p >= 0.08; }
    else if (stage === 4) { var g = seg(p, 0.955, 0.995); vis = Math.ceil(ns * (1 - g)); slewOn = g <= 0; }
    cr.secs.forEach(function (m, i) { m.setEnabled(i < vis); });
    cr.slew.setEnabled(slewOn && vis === ns);
    if (working && dt) st.clock += dt;
    var workH = stage === 2 ? clipH : stage === 3 ? lv * LH : 0;
    if (working && slewOn && stage >= 1 && stage <= 3) animCrane(st, stage === 1 ? 0.05 : workH);
    else if (stage !== st.stage) placeHook(cr, -1);
    animWorkers(st, stage, lv, workH, crew.here, working);
    st.stage = stage;
    dirty();
  }
  function siteTop(b) { var st = sites[b.id]; if (!st) return 0.3; if (!st.model || st.stage < 2) return 0.3; return Math.max(0.3, Math.min(st.h, -st.plane.d)); }
  function addBuildingMesh(b) {
    byId[b.id] = b;
    placed[b.id] = buildingBatch(b);
    if (isSite(b)) { addSite(b); updateSite(b, 0); }
    writeBuilding(b);
  }
  function removeBuildingMesh(id) {
    if (placed[id]) { batchRemove(placed[id], id); delete placed[id]; }
    if (batches.noroad) batchRemove(batches.noroad, id);
    disposeSite(id);
    dirty();
  }

  // ---------- Бригады ----------
  function truckBatch() { return getBatch('truck', function () { return truckModel(kit); }); }
  function writeTruck(br, bob, roll) { batchSet(truckBatch(), br.id, br.x, bob || 0, br.z, br.yaw || 0, 0.78, 0.78, 0.78, roll || 0); }
  function parkSpot(i, cx, cz) { // стоянка бригад — рядом с центром экрана (или с заводом), а не у края карты
    if (cx === undefined) { cx = cam.tx; cz = cam.tz; }
    var h = N / 2 - 1;
    return { x: clamp(cx + ((i % 6) - 2.5) * 0.9, -h, h), z: clamp(cz + Math.floor(i / 6) * 0.9, -h, h) };
  }
  function siteCenter(b) { var f = foot(b.size, b.rot); return { x: b.x + f.w / 2 - N / 2, z: b.z + f.d / 2 - N / 2 }; }
  // k-я машина на объекте встаёт вдоль сторон участка
  function slotPos(b, k) {
    var f = foot(b.size, b.rot), c = siteCenter(b);
    var sides = [[0, 1, f.w, f.d], [1, 0, f.d, f.w], [0, -1, f.w, f.d], [-1, 0, f.d, f.w]];
    for (var lap = 0; lap < 30; lap++) for (var s = 0; s < 4; s++) {
      var sd = sides[s], len = sd[2], cap = Math.max(1, Math.floor(len / 0.75));
      if (k < cap) {
        var t = -len / 2 + (k + 0.5) * len / cap, out = sd[3] / 2 + 0.5 + lap * 0.62;
        return { x: c.x + sd[0] * out + (sd[1] !== 0 ? t : 0), z: c.z + sd[1] * out + (sd[0] !== 0 ? t : 0), yaw: sd[0] !== 0 ? 0 : Math.PI / 2 };
      }
      k -= cap;
    }
    return { x: c.x, z: c.z, yaw: 0 };
  }
  // Бригады делятся между стройками поровну; уже работающие остаются на своём объекте.
  function assignBrigades() {
    var S = state.buildings.filter(isSite), n = state.brigades.length;
    if (!S.length) { state.brigades.forEach(function (br) { if (br.site) { br.park = { x: br.x, z: br.z }; } br.site = 0; }); return; }
    var want = {}, have = {};
    S.forEach(function (s, i) { want[s.id] = Math.floor(n / S.length) + (i < n % S.length ? 1 : 0); have[s.id] = 0; });
    var free = [];
    state.brigades.forEach(function (br) {
      if (br.site && want[br.site] !== undefined && have[br.site] < want[br.site]) have[br.site]++;
      else free.push(br);
    });
    free.forEach(function (br) {
      var best = 0, bd = 1e9;
      S.forEach(function (s) {
        if (have[s.id] >= want[s.id]) return;
        var c = siteCenter(s), d = Math.hypot(c.x - br.x, c.z - br.z);
        if (d < bd) { bd = d; best = s.id; }
      });
      br.site = best; if (best) have[best]++;
    });
  }
  function siteCrew(id) {
    var all = 0, here = 0;
    state.brigades.forEach(function (br) { if (br.site === id) { all++; if (br.work) here++; } });
    return { all: all, here: here };
  }
  function rebuildTrucks() {
    var bt = truckBatch();
    bt.ids.slice().forEach(function (id) { batchRemove(bt, id); });
    state.brigades.forEach(function (br) { writeTruck(br); });
    dirty();
  }
  function buyBrigade() {
    var u = G.units.brigade;
    if (state.brigades.length >= u.importMax) { hint('Привезти можно только ' + u.importMax + ' бригады. Дальше — заказывайте на Механическом заводе (🏭 Здания)', true); return; }
    if (!canPay(u.price)) { hint('Не хватает долларов на бригаду', true); return; }
    pay(u.price); snd('buy');
    var i = state.brigades.length, p = parkSpot(i);
    var br = { id: state.nextBr++, x: p.x, z: Math.min(N / 2 - 0.2, p.z + 3), yaw: Math.PI, park: p, site: 0 };
    state.brigades.push(br); writeTruck(br); dirty();
    assignBrigades(); save(); refreshNeed(); renderMech();
    hint(state.buildings.some(isSite) ? '🚚 Бригада выехала на стройку' : '🚚 Бригада куплена — теперь можно строить');
  }
  function sellBrigade() {
    if (!state.brigades.length) return;
    var j = state.brigades.length - 1;
    for (var i = state.brigades.length - 1; i >= 0; i--) if (!state.brigades[i].site) { j = i; break; } // сначала свободную
    var br = state.brigades.splice(j, 1)[0]; snd('sell');
    batchRemove(truckBatch(), br.id);
    state.spent -= Math.round(G.units.brigade.price / 2); updateMoney();
    assignBrigades(); save(); refreshNeed(); renderMech(); dirty();
    hint('Бригада продана, вернули ' + usd(G.units.brigade.price / 2));
  }
  function angTo(a, b, k) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k; }
  // Шаг анимации: машины едут к объектам, стройка растёт. Возвращает true, если что-то двигалось.
  function tickBrigades(dt, t) {
    if (!state.brigades.length) return false;
    var any = false, perSite = {}, arrived = {}, u = G.units.brigade;
    state.brigades.forEach(function (br) {
      var b = br.site ? getB(br.site) : null, tgt = null, atSite = false;
      if (b && isSite(b)) { var k = perSite[b.id] || 0; perSite[b.id] = k + 1; tgt = slotPos(b, k); atSite = true; }
      else if (br.park) tgt = { x: br.park.x, z: br.park.z, yaw: br.yaw };
      var was = br.work, moved = false;
      br.work = false;
      if (tgt) {
        var dx = tgt.x - br.x, dz = tgt.z - br.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          var v = Math.max(u.speed, d / 3), st = Math.min(d, v * dt);
          br.x += dx / d * st; br.z += dz / d * st;
          br.yaw = angTo(br.yaw || 0, Math.atan2(dx, dz), Math.min(1, dt * 10)); moved = true;
        } else {
          br.x = tgt.x; br.z = tgt.z;
          if (Math.abs(Math.atan2(Math.sin(tgt.yaw - br.yaw), Math.cos(tgt.yaw - br.yaw))) > 0.01) { br.yaw = angTo(br.yaw, tgt.yaw, Math.min(1, dt * 8)); moved = true; }
          if (atSite) { br.work = true; arrived[b.id] = (arrived[b.id] || 0) + 1; moved = true; }
        }
      }
      if (moved || was) {
        writeTruck(br, br.work ? Math.abs(Math.sin(t * 0.012 + br.id * 1.7)) * 0.012 : 0, br.work ? Math.sin(t * 0.02 + br.id) * 0.02 : 0);
        any = true;
      }
    });
    var done = [];
    state.buildings.forEach(function (b) {
      if (!isSite(b)) return;
      var a = arrived[b.id], st = sites[b.id];
      if (a) { b.prog = Math.min(1, b.prog + dt * a * u.power * (1 + useStock(dt)) / buildTime(b)); touchB(b, false); }
      if (a || (st && st.wn)) updateSite(b, dt);
      if (b.prog >= 1) done.push(b);
    });
    done.forEach(finishSite);
    if (any) dirty();
    return any;
  }
  function finishSite(b) {
    delete b.prog; touchB(b, true);
    removeBuildingMesh(b.id); addBuildingMesh(b);
    newVehNote = '';
    snd('done');
    assignBrigades(); updateStats(); saveNow();
    var vnote = newVehNote ? ' · с ним появилась машина: ' + newVehNote : ''; newVehNote = '';
    if (infoId === b.id) renderInfo(b, true);
    if (hasRoad(b)) hint('✅ Построено: ' + G.cats[b.cat].names[b.size] + vnote);
    else hint('✅ Построено: ' + G.cats[b.cat].names[b.size] + '. Но к нему нет дороги — подведите, чтобы заработало', true);
    renderMech();
  }


  // ---------- Механический завод: выпуск машин (с 0.9.0; общая очередь и 7 новых машин — с 0.10.0) ----------
  // ---------- Склад города: доски и ДСП (с 0.11.0) ----------
  // Лесопилки производят, стройки берут. Возвращает прибавку к скорости стройки (0, 0.25 или 0.5).
  function useStock(dt) {
    var U = G.buildUse, st = state.stock, k = 0, nb = U.boards * dt, nd = U.dsp * dt;
    if (st.boards >= nb) { st.boards -= nb; k += U.bonus; stockDirty = true;
      if (st.dsp >= nd) { st.dsp -= nd; k += U.bonus; } }
    return k;
  }
  function sawRate() { // штук в минуту от всех работающих лесопилок; use — сколько брёвен в минуту им нужно
    var o = { boards: 0, dsp: 0, use: 0 };
    working('saw').forEach(function (b) { var p = G.sawmill[b.size]; o.boards += p.boards; o.dsp += p.dsp; o.use += p.use; });
    return o;
  }
  var stockDirty = true, sawCache = null, sawT = 0, stoneCache = null, stoneT = 0;
  // Камень (с 0.21.0): каменоломни добывают, камнеобработка превращает камень в щебень
  function stoneRate() {
    var o = { stone: 0, gravel: 0, use: 0 };
    working('quarry').forEach(function (b) { o.stone += G.quarry[b.size].stone; });
    working('stonework').forEach(function (b) { var p = G.stonework[b.size]; o.use += p.use; o.gravel += p.gravel; });
    return o;
  }
  function tickStone(dt) {
    if (!state.env) return;
    stoneT -= dt; if (!stoneCache || stoneT <= 0) { stoneCache = stoneRate(); stoneT = 1; }
    var R = stoneCache, st = state.stock; if (!R.stone && !R.use) return;
    st.stone += R.stone * dt / 60;
    if (R.use) { var k = Math.min(1, st.stone / (R.use * dt / 60)); if (k > 0) { st.stone -= R.use * dt / 60 * k; st.gravel += R.gravel * dt / 60 * k; } }
    stockDirty = true;
  }
  // Лесопилка (с 0.23.0) берёт брёвна со склада и делает из них доски и ДСП; брёвен нет — стоит.
  // В мире без природы (нет деревьев и лесорубов) работает по-старому — без брёвен.
  function tickSawmills(dt) {
    sawT -= dt; if (!sawCache || sawT <= 0) { sawCache = sawRate(); sawT = 1; }
    var R = sawCache; if (!R.boards && !R.dsp) return;
    var st = state.stock, k = 1;
    if (state.env) {
      var need = R.use * dt / 60;
      k = need > 0 ? Math.min(1, st.logs / need) : 0;
      if (k <= 0) return;
      st.logs -= need * k;
    }
    st.boards += R.boards * dt / 60 * k; st.dsp += R.dsp * dt / 60 * k; stockDirty = true;
  }
  function stockText(n) { return Math.floor(n).toLocaleString('ru-RU'); }
  function updateStock() {
    if (!stockDirty) return; stockDirty = false; updateStone();
    var st = state.stock, R = sawCache || sawRate(), hasSaw = state.buildings.some(function (b) { return b.cat === 'saw' || b.cat === 'lumber'; }),
      show = st.boards >= 1 || st.dsp >= 1 || st.logs >= 1 || R.boards > 0 || hasSaw;
    $('stStockWrap').hidden = !show; if (!show) return;
    var lj = $('stLogsWrap'); if (lj) lj.hidden = !state.env && st.logs < 1;
    $('stLogs').textContent = stockText(st.logs); $('stBoards').textContent = stockText(st.boards); $('stDsp').textContent = stockText(st.dsp);
    $('stStockWrap').title = 'Склад: бревна ' + stockText(st.logs) + ', доски ' + stockText(st.boards) + ', ДСП ' + stockText(st.dsp) + '. Лесорубы валят деревья и несут брёвна; лесопилки берут ' + Math.round(R.use) + ' брёвен в минуту и дают ' + R.boards + ' досок и ' + R.dsp + ' ДСП. Стройка с досками на 25% быстрее, с досками и ДСП — на 50%.';
    var e = $('iStock'); if (e) e.innerHTML = '🪵 ' + stockText(st.logs) + ' · 🪚 ' + stockText(st.boards) + ' · 🟫 ' + stockText(st.dsp);
  }
  function updateStone() {
    var w = $('stStoneWrap'); if (!w) return;
    if (!state.env) { w.hidden = true; return; }
    var st = state.stock, R = stoneCache || stoneRate(); w.hidden = false;
    $('stStone').textContent = stockText(st.stone); $('stGravel').textContent = stockText(st.gravel);
    w.title = 'Склад: камень ' + stockText(st.stone) + ', щебень ' + stockText(st.gravel) + '. Добыча ' + Math.round(R.stone) + ' камня в минуту, переработка ' + Math.round(R.use) + ' камня в ' + Math.round(R.gravel) + ' щебня. Булыжная дорога — камень, асфальт — щебень.';
  }
  // Парковки: сколько машин жителей стоит рядом (дома в радиусе 8 клеток)
  function parkUse(b) {
    var c = siteCenter(b), n = 0, places = G.parkSpots[b.cat][b.size];
    for (var id in carAgents) { var a = carAgents[id], h = getB(a.home); if (!h) continue; var hc = siteCenter(h); if (Math.abs(hc.x - c.x) + Math.abs(hc.z - c.z) <= 8) n++; }
    return { places: places, near: n };
  }
  function working(cat) { return state.buildings.filter(function (b) { return b.cat === cat && isWorking(b); }); }
  // точка здания в его собственных координатах (lx, lz от центра; +z — фасад) → мир
  function localPos(b, lx, lz) {
    var c = siteCenter(b), yaw = -b.rot * Math.PI / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
    return { x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs, yaw: yaw };
  }
  // Что заказывают: 'brigade' или ключ из G.vehicles
  function prodInfo(kind) {
    var u = G.units.brigade; return { name: 'Бригада', icon: '🚚', price: u.factoryPrice, time: u.makeTime };
  }
  function queued(kind) { var n = 0; state.fql.forEach(function (k) { if (k === kind) n++; }); return n; }
  var factoryTurn = 0;
  // Сколько секунд до выхода машины номер i в очереди (число заводов скорость не меняет — правило 0.10.0)
  function factoryEta(i) {
    var t = 0;
    for (var j = 0; j <= i && j < state.fql.length; j++) t += prodInfo(state.fql[j]).time - (j === 0 ? state.fprog : 0);
    return Math.max(0, t);
  }
  function factoryNext() { return state.fql.length ? factoryEta(0) : 0; }
  function tickFactory(dt) {
    if (!state.fql.length) { state.fprog = 0; return false; }
    var F = working('factory'); if (!F.length) return false;
    state.fprog += dt;
    var guard = 0;
    while (state.fql.length && state.fprog >= prodInfo(state.fql[0]).time && guard++ < 20) {
      state.fprog -= prodInfo(state.fql[0]).time;
      var kind = state.fql.shift(), fb = F[factoryTurn++ % F.length];
      spawnTruck(fb);
    }
    if (!state.fql.length) state.fprog = 0;
    return false;
  }
  function spawnTruck(fb) {
    var g = localPos(fb, 0.6, 0.65), i = state.brigades.length;
    var br = { id: state.nextBr++, x: g.x, z: g.z, yaw: g.yaw, park: parkSpot(i, g.x, g.z + 2), site: 0 };
    state.brigades.push(br); writeTruck(br);
    assignBrigades(); saveNow(); refreshNeed(); renderMech(); dirty();
    hint('🏭 Завод выпустил грузовик «Бригада»' + (br.site ? ' — он поехал на стройку' : ''));
  }
  function noFactoryMsg() {
    return state.buildings.some(function (b) { return b.cat === 'factory' && !isSite(b); }) ? '🏭 Завод не работает — подведите к нему дорогу' :
      state.buildings.some(function (b) { return b.cat === 'factory'; }) ? '🏭 Завод ещё строится' : '🏭 Сначала постройте Механический завод: 🚚 Механизмы → 🏭 Здания';
  }
  function orderKind(kind) {
    if (kind !== 'brigade') return; // с 0.23.0 завод собирает только «Бригады»
    var p = prodInfo(kind);
    if (!working('factory').length) { hint(noFactoryMsg(), true); return; }
    if (!canPay(p.price)) { hint('Не хватает долларов: нужно ' + usd(p.price), true); return; }
    pay(p.price); state.fql.push(kind); save(); renderMech(); refreshLive();
    var n = state.fql.length;
    hint('🏭 ' + p.icon + ' «' + p.name + '» заказан' + (n > 1 ? ': в очереди ' + n + ', выйдет через ≈ ' + secText(factoryEta(n - 1)) : ' — выйдет через ≈ ' + secText(factoryEta(0))));
  }
  function orderTruck() { orderKind('brigade'); }
  function cancelKind(kind) {
    var i = state.fql.lastIndexOf(kind); if (i < 0) return;
    state.fql.splice(i, 1); if (i === 0) state.fprog = 0;
    var p = prodInfo(kind); state.spent -= p.price;
    updateMoney(); save(); renderMech(); refreshLive();
    hint('Заказ «' + p.name + '» отменён, вернули ' + usd(p.price));
  }
  function cancelOrder() { cancelKind('brigade'); }
  function fqText(kind) {
    var L = state.fql;
    if (kind) {
      var n = queued(kind); if (!n) return 'нет заказов';
      return '<b>' + n + '</b> · ' + (working('factory').length ? 'выйдет через ≈ ' + secText(factoryEta(L.indexOf(kind))) : '<span class="bad">завод не работает</span>');
    }
    if (!L.length) return 'нет заказов';
    var p = prodInfo(L[0]);
    return '<b>' + L.length + '</b> · ' + (working('factory').length ? 'сейчас ' + p.icon + ' ' + esc(p.name) + ', ≈ ' + secText(factoryNext()) : '<span class="bad">завод не работает</span>');
  }

  // ---------- Машины на дорогах (с 0.10.0) ----------
  // Машины завода (state.vehicles) и легковые жителей ездят по клеткам дорог по правой полосе.
  var agents = {}, carAgents = {}, LANE = 0.17, planBudget = 0, carsDriving = 0;
  function vehBatch(kind) { return getBatch('veh_' + kind, function () { return vehicleModel(kit, kind); }); }
  function carBatch(m) { return getBatch('car_' + m, function () { return carModel(kit, m); }); }
  function agentBatch(a) { return a.car ? carBatch(a.model) : vehBatch(a.kind); }
  function writeAgent(a) { var s = a.car ? 0.8 : 0.72; batchSet(agentBatch(a), a.id, a.x, 0, a.z, a.yaw, s, s, s); }
  function cellOf(x, z) { return { x: Math.floor(x + N / 2), z: Math.floor(z + N / 2) }; }
  // клетки дороги у стороны здания и место «у входа» на каждой (у бордюра, вдоль стороны)
  function curbSpots(b, inset) {
    inset = inset || 0.33;
    var f = foot(b.size, b.rot), out = [];
    edgeKeys(b, function (k) {
      if (!state.roads[k]) return;
      var p = k.split(','), x = +p[0], z = +p[1], nx = 0, nz = 0;
      if (x === b.x - 1) nx = 1; else if (x === b.x + f.w) nx = -1; else if (z === b.z - 1) nz = 1; else nz = -1;
      var c = cellCenter(x, z);
      out.push({ k: k, x: c.x + nx * inset, z: c.z + nz * inset, tx: nz, tz: nx, yaw: nx ? 0 : Math.PI / 2 });
    });
    return out;
  }
  function spotAt(b, n, inset) {
    var S = curbSpots(b, inset); if (!S.length) return null;
    var s = S[n % S.length], sh = (Math.floor(n / S.length) % 3 - 1) * 0.3; // если машин больше, чем клеток, — сдвиг вдоль бордюра
    return { k: s.k, x: s.x + s.tx * sh, z: s.z + s.tz * sh, yaw: s.yaw };
  }
  // Поиск пути по дорогам (в ширину). Возвращает список клеток от start до любой из goal.
  function roadPath(start, goal) {
    if (!state.roads[start] || !goal) return null;
    if (goal[start]) return [start];
    var prev = {}, q = [start], h = 0; prev[start] = '';
    while (h < q.length) {
      var k = q[h++], p = k.split(','), x = +p[0], z = +p[1];
      for (var d = 0; d < 4; d++) {
        var nk = key(x + DIRS[d][0], z + DIRS[d][1]);
        if (prev[nk] !== undefined || !state.roads[nk]) continue;
        prev[nk] = k;
        if (goal[nk]) { var path = [nk]; while (prev[path[0]]) path.unshift(prev[path[0]]); return path; }
        q.push(nk);
      }
    }
    return null;
  }
  // Клетки → точки на правой полосе (на поворотах — точка пересечения полос)
  function lanePoints(cells) {
    var pts = [], C = cells.map(function (k) { var p = k.split(','); return cellCenter(+p[0], +p[1]); });
    for (var i = 0; i < C.length; i++) {
      var a = C[i - 1], b = C[i], c = C[i + 1];
      var din = a ? { x: b.x - a.x, z: b.z - a.z } : null, dout = c ? { x: c.x - b.x, z: c.z - b.z } : null;
      din = din || dout; dout = dout || din; if (!din) { pts.push({ x: b.x, z: b.z }); continue; }
      var ri = { x: din.z, z: -din.x }, ro = { x: dout.z, z: -dout.x };
      if (ri.x === ro.x && ri.z === ro.z) pts.push({ x: b.x + ri.x * LANE, z: b.z + ri.z * LANE });
      else if (ri.x === -ro.x && ri.z === -ro.z) { // разворот в тупике
        pts.push({ x: b.x + ri.x * LANE + din.x * 0.3, z: b.z + ri.z * LANE + din.z * 0.3 });
        pts.push({ x: b.x + ro.x * LANE + din.x * 0.3, z: b.z + ro.z * LANE + din.z * 0.3 });
      } else pts.push({ x: b.x + (ri.x + ro.x) * LANE, z: b.z + (ri.z + ro.z) * LANE });
    }
    return pts;
  }
  function goalSet(b) { var g = {}, n = 0; curbSpots(b).forEach(function (s) { g[s.k] = 1; n++; }); return n ? g : null; }
  // Отправить машину к зданию b. Возвращает true, если путь найден.
  function sendTo(a, b, slot) {
    var inset = a.car ? 0.33 : 0.08; // машины завода встают прямо в полосе — не налезают на легковые у бордюра
    var spot = spotAt(b, slot, inset); if (!spot) return false;
    var path = roadPath(a.cell, goalSet(b));
    if (!path) return false;
    var pts = lanePoints(path);
    var last = path[path.length - 1];
    if (last !== spot.k) { var S2 = curbSpots(b, inset).filter(function (s) { return s.k === last; }); if (S2.length) spot = { k: last, x: S2[0].x, z: S2[0].z, yaw: S2[0].yaw }; }
    pts.push({ x: spot.x, z: spot.z });
    a.pts = pts; a.pi = 0; a.dest = b.id; a.spot = spot; a.mode = 'drive';
    return true;
  }
  function nearestRoad(x, z) {
    var c = cellOf(x, z);
    for (var r = 0; r <= 4; r++) for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      var k = key(c.x + dx, c.z + dz); if (state.roads[k]) return k;
    }
    return null;
  }
  // --- служебные машины (с 0.23.0 появляются сами вместе со зданиями) ---
  // Сколько машин каждого вида «положено» городу: каждое работающее здание обслуживаемого вида приводит с собой долю машины (G.vehicles[..].per),
  // доли складываются и округляются вверх. Куски карты вдали выгружены и их зданий не видно, поэтому машин автоматически становится больше, но не меньше:
  // убавляются они только когда загружена вся карта (миры до 100×100).
  var newVehNote = '';
  function vehWanted() {
    var want = {}, V = G.vehicles, ks = Object.keys(V);
    ks.forEach(function (k) { want[k] = 0; });
    state.buildings.forEach(function (b) {
      if (!isWorking(b)) return;
      ks.forEach(function (k) { if (V[k].serves === b.cat) want[k] += (V[k].per && V[k].per[b.size]) || 0; });
    });
    ks.forEach(function (k) { want[k] = Math.min(V[k].max || 40, Math.ceil(want[k] - 1e-9)); });
    return want;
  }
  function fullyLoaded() { return Object.keys(loaded).length >= nChunks() * nChunks(); }
  function syncVehicles() {
    if (!state) return;
    var want = vehWanted(), changed = false, canDrop = fullyLoaded();
    Object.keys(G.vehicles).forEach(function (k) {
      var have = vehCount(k);
      while (have < want[k]) { spawnService(k); have++; changed = true; var v = G.vehicles[k]; newVehNote += (newVehNote ? ', ' : '') + v.icon + ' ' + v.name; }
      while (canDrop && have > want[k]) { removeService(k); have--; changed = true; }
    });
    if (changed) { save(); renderMech(); dirty(); }
  }
  function spawnService(kind) {
    var info = G.vehicles[kind], b = randomOf(working(info.serves)), v = { id: state.nextVeh++, kind: kind };
    state.vehicles.push(v);
    var x, z, yaw = 0, cell = null, sp = b && spotAt(b, vehCount(kind), 0.08);
    if (sp) { x = sp.x; z = sp.z; yaw = sp.yaw; cell = sp.k; }
    else if (b) { var c = siteCenter(b); x = c.x; z = c.z + 1.6; }
    else { var pk = parkSpot(v.id); x = pk.x; z = pk.z; }
    var a = makeAgent(v, x, z, yaw); if (cell) a.cell = cell; a.t = 0.6 + Math.random() * 3;
    return info;
  }
  function removeService(kind) {
    var j = -1; for (var i = state.vehicles.length - 1; i >= 0; i--) if (state.vehicles[i].kind === kind) { j = i; break; }
    if (j < 0) return;
    var v = state.vehicles.splice(j, 1)[0], a = agents[v.id];
    if (a) { batchRemove(agentBatch(a), a.id); delete agents[v.id]; }
  }
  function makeAgent(v, x, z, yaw) {
    var a = agents[v.id] = { id: v.id, kind: v.kind, x: x, z: z, yaw: yaw || 0, cell: nearestRoad(x, z), mode: 'park', t: 0.5 + Math.random() * 2, pts: null };
    v.x = x; v.z = z; writeAgent(a); return a;
  }
  function vehCount(kind) { var n = 0; state.vehicles.forEach(function (v) { if (v.kind === kind) n++; }); return n; }
  function clearAgents() {
    Object.keys(agents).forEach(function (id) { batchRemove(agentBatch(agents[id]), +id); });
    Object.keys(carAgents).forEach(function (id) { batchRemove(agentBatch(carAgents[id]), +id); });
    agents = {}; carAgents = {}; carsDriving = 0;
    clearJacks();
  }
  function rebuildAgents() {
    clearAgents();
    state.vehicles.forEach(function (v, i) {
      var p = typeof v.x === 'number' ? { x: clamp(v.x, -N / 2, N / 2), z: clamp(v.z, -N / 2, N / 2 + 2) } : parkSpot(i + state.brigades.length);
      makeAgent(v, p.x, p.z, 0);
    });
    syncCars();
  }
  // --- легковые жителей: сколько и где стоят ---
  function syncCars() {
    var C = G.cars, want = {}, total = 0;
    state.buildings.forEach(function (b) {
      if (b.cat !== 'res' || !isWorking(b) || total >= C.max) return;
      var n = Math.min(C.perHouse[b.size] || 1, C.max - total);
      for (var k = 0; k < n; k++) { want[b.id * 10 + k] = { b: b, k: k }; total++; }
    });
    Object.keys(carAgents).forEach(function (id) {
      var a = carAgents[id], w = want[id];
      if (!w || (a.mode === 'park' && a.dest === a.home && !spotAt(w.b, w.k))) { if (a.mode === 'drive') carsDriving--; batchRemove(agentBatch(a), +id); delete carAgents[id]; }
    });
    Object.keys(want).forEach(function (id) {
      var old = carAgents[id];
      if (old) { // стоит у дома, а дорогу у дома переложили — переставить к новому бордюру
        if (old.mode === 'park' && old.dest === old.home) { var s2 = spotAt(want[id].b, want[id].k); if (s2 && s2.k !== old.cell) { old.x = s2.x; old.z = s2.z; old.yaw = s2.yaw; old.cell = s2.k; writeAgent(old); } }
        return;
      }
      var w = want[id], s = spotAt(w.b, w.k); if (!s) return;
      var m = G.cars.models[((w.b.seed >>> 0) + w.k * 7) % G.cars.models.length].id;
      var a = carAgents[id] = { id: +id, car: 1, model: m, home: w.b.id, slot: w.k, x: s.x, z: s.z, yaw: s.yaw, cell: s.k, mode: 'park', dest: w.b.id,
        t: C.wait[0] + Math.random() * (C.wait[1] - C.wait[0]) };
      writeAgent(a);
    });
    dirty();
  }
  function carCount(bid) { var n = 0; for (var id in carAgents) if (carAgents[id].home === bid) n++; return n; }
  function randomOf(list, r) { return list.length ? list[Math.floor((r === undefined ? Math.random() : r) * list.length)] : null; }
  // Куда ехать машине: жители — на работу, в магазин, школу и т. п. (и назад домой); машины завода — к своим зданиям
  function planAgent(a) {
    if (planBudget <= 0) { a.t = 0.1; return; }
    planBudget--;
    if (!a.cell || !state.roads[a.cell]) a.cell = nearestRoad(a.x, a.z);
    var ok = false, target = null;
    if (a.car) {
      var home = getB(a.home);
      if (!home) return;
      if (a.dest !== a.home) target = home;
      else if (carsDriving < G.cars.driveMax) {
        var W = state.buildings.filter(function (b) { return b.cat !== 'res' && isWorking(b); });
        // предпочитаем места поближе: берём лучшее из нескольких случайных
        var hb = siteCenter(home), best = null, bd = 1e9;
        for (var i = 0; i < 4 && W.length; i++) { var c = randomOf(W), cc = siteCenter(c), d = Math.hypot(cc.x - hb.x, cc.z - hb.z) * (0.6 + Math.random()); if (d < bd) { bd = d; best = c; } }
        target = best;
      }
      if (target) ok = sendTo(a, target, target === home ? a.slot : 4 + (a.id % 5));
      if (ok) carsDriving++;
      a.t = ok ? 0 : 6 + Math.random() * 10;
    } else {
      var info = G.vehicles[a.kind], L = working(info.serves).filter(function (b) { return b.id !== a.dest; });
      if (!L.length) L = working(info.serves);
      for (var tries = 0; tries < 3 && L.length && !ok; tries++) { target = randomOf(L); ok = sendTo(a, target, 6 + (a.id % 3)); }
      a.t = ok ? 0 : 4 + Math.random() * 4;
    }
  }
  function tickAgent(a, dt) {
    if (a.mode === 'park') { a.t -= dt; if (a.t <= 0) planAgent(a); return a.mode === 'drive'; }
    var sp = (a.car ? G.cars.speed : G.vehicleSpeed) * dt, moved = false;
    while (sp > 0 && a.pts) {
      var p = a.pts[a.pi], dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
      // дорогу убрали прямо перед машиной — встаём и ищем путь заново
      if (a.pi < a.pts.length - 1) { var ck = cellOf(p.x, p.z), kk = key(ck.x, ck.z); if (!state.roads[kk]) { arrive(a, false); return true; } }
      if (d > 1e-4) { a.yawT = Math.atan2(dx, dz); }
      if (d <= sp) { a.x = p.x; a.z = p.z; sp -= d; a.pi++; var c2 = cellOf(a.x, a.z), k2 = key(c2.x, c2.z); if (state.roads[k2]) a.cell = k2; if (a.pi >= a.pts.length) { arrive(a, true); break; } }
      else { a.x += dx / d * sp; a.z += dz / d * sp; sp = 0; }
      moved = true;
    }
    if (a.yawT !== undefined) a.yaw = angTo(a.yaw, a.mode === 'park' && a.spot ? a.spot.yaw : a.yawT, Math.min(1, dt * 9));
    writeAgent(a);
    return moved;
  }
  function arrive(a, ok) {
    if (a.car && a.mode === 'drive') carsDriving--;
    a.mode = 'park'; a.pts = null;
    if (ok && a.spot) { a.cell = a.spot.k; a.yaw = a.spot.yaw; a.yawT = undefined; }
    else { a.dest = a.car ? -1 : 0; a.cell = nearestRoad(a.x, a.z); }
    if (a.car) a.t = a.dest === a.home ? G.cars.wait[0] + Math.random() * (G.cars.wait[1] - G.cars.wait[0]) : 4 + Math.random() * 10;
    else a.t = 3 + Math.random() * 6;
    if (!a.car) { var v = state.vehicles.filter(function (x) { return x.id === a.id; })[0]; if (v) { v.x = a.x; v.z = a.z; } }
    writeAgent(a);
  }
  function tickTraffic(dt) {
    planBudget = 6;
    var any = false, id;
    for (id in agents) if (tickAgent(agents[id], dt)) any = true;
    for (id in carAgents) if (tickAgent(carAgents[id], dt)) any = true;
    if (any) dirty();
    return any;
  }
  // ---------- Общество лесорубов (с 0.23.0) ----------
  // У здания 4 лесоруба. Каждый: идёт по полю 20×20 к ближайшему дереву (поиск пути в ширину, обходя здания и склоны гор),
  // рубит его несколько секунд — дерево исчезает (как при «Удалить», срубленное запоминается в куске карты) — и несёт брёвна обратно в здание.
  // Брёвна попадают на склад города (state.stock.logs); оттуда их берут лесопилки. Лесорубы работают только в мирах с природой
  // и только пока здание работает (есть дорога). Сами лесорубы не сохраняются — после загрузки мира выходят заново.
  var jacks = {}, jackSeq = 0, jackT = 0, jackBudget = 0, jackClaim = {};
  function jackModel(K, carry) {
    var S = Shapes(K, 0, 0);
    function box(w, h, d, c, x, y, z) { return S.box(w, h, d, K.mat(c), x, y, z); }
    box(0.035, 0.1, 0.04, '#3a4660', 0.025, 0.05, 0); box(0.035, 0.1, 0.04, '#3a4660', -0.025, 0.05, 0);   // ноги
    box(0.09, 0.1, 0.055, '#b8402a', 0, 0.15, 0); box(0.092, 0.012, 0.057, '#2a2a2a', 0, 0.115, 0);          // клетчатая рубаха, пояс
    box(0.025, 0.08, 0.03, '#b8402a', 0.06, 0.15, 0); box(0.025, 0.08, 0.03, '#b8402a', -0.06, 0.15, 0);      // руки
    S.sph(0.034, '#e8b890', 0, 0.235, 0.005, 1); S.cyl(0.04, 0.04, 0.02, 8, '#2f3b4a', 0, 0.262, 0.005);     // голова и шапка
    if (carry) {                                                                                               // бревно на плече
      S.bake(S.cyl(0.032, 0.032, 0.28, 8, '#8a5a33', 0.05, 0.22, 0), Math.PI / 2, 0, 0);
      S.bake(S.cyl(0.026, 0.026, 0.004, 8, '#d8b07a', 0.05, 0.22, 0.14), Math.PI / 2, 0, 0);
    } else {                                                                                                   // топор на плече
      box(0.012, 0.15, 0.012, '#5a3d28', 0.075, 0.2, 0); box(0.05, 0.04, 0.012, '#b9bec6', 0.1, 0.27, 0);
    }
    return S.merge();
  }
  function jackBatch(carry) { return getBatch('jack' + (carry ? 1 : 0), function () { return jackModel(kit, carry); }); }
  function jackWrite(j, sy) { var q = 1.25; batchSet(jackBatch(j.carry), j.id, j.x, 0, j.z, j.yaw, q, q * (sy || 1), q); }
  // поле деятельности: квадрат zone×zone вокруг здания (по карте обрезается); x1, z1 — не включительно
  function jackZone(b) {
    var f = foot(b.size, b.rot), Z = G.lumber.zone, x0 = Math.round(b.x + f.w / 2 - Z / 2), z0 = Math.round(b.z + f.d / 2 - Z / 2);
    return { x0: Math.max(0, x0), z0: Math.max(0, z0), x1: Math.min(N, x0 + Z), z1: Math.min(N, z0 + Z) };
  }
  function zoneTrees(b) {
    var Z = jackZone(b), n = 0;
    for (var z = Z.z0; z < Z.z1; z++) for (var x = Z.x0; x < Z.x1; x++) if (treeA[idx(x, z)] > 0) n++;
    return n;
  }
  function jackCountOf(bid) { var n = 0; for (var id in jacks) if (jacks[id].bid === bid) n++; return n; }
  function jackDoor(b) { var f = foot(b.size, b.rot), p = localPos(b, 0, f.d / 2 + 0.28); return { x: p.x, z: p.z }; }
  function jackRelease(j) { if (j.tree >= 0 && jackClaim[j.tree] === j.id) delete jackClaim[j.tree]; j.tree = -1; }
  function addJack(b) {
    var d = jackDoor(b), j = { id: ++jackSeq, bid: b.id, x: d.x, z: d.z, yaw: Math.random() * 6.28, mode: 'idle', carry: 0, t: 0.4 + jackCountOf(b.id) * 1.3, pts: null, pi: 0, tree: -1 };
    jacks[j.id] = j; jackWrite(j);
  }
  function removeJack(j, pay) {
    jackRelease(j);
    if (pay && j.carry && state && state.stock) { state.stock.logs += j.carry; stockDirty = true; }
    batchRemove(jackBatch(j.carry), j.id); delete jacks[j.id];
  }
  function clearJacks() { Object.keys(jacks).forEach(function (id) { removeJack(jacks[id], false); }); jacks = {}; jackClaim = {}; }
  function syncJacks() {
    var L = working('lumber'), want = {};
    L.forEach(function (b) { want[b.id] = b; });
    Object.keys(jacks).forEach(function (id) { var j = jacks[id]; if (!want[j.bid]) removeJack(j, true); });
    L.forEach(function (b) { for (var n = jackCountOf(b.id); n < G.lumber.jacks; n++) addJack(b); });
  }
  // Путь от лесоруба к ближайшему «ничьему» дереву в поле. Деревья не мешают ходить (они редкие и маленькие), здания и склоны гор — мешают.
  function jackPlan(j, b) {
    var Z = jackZone(b), W = Z.x1 - Z.x0, H = Z.z1 - Z.z0, sx = Math.floor(j.x + N / 2), sz = Math.floor(j.z + N / 2);
    function inZ(x, z) { return x >= Z.x0 && z >= Z.z0 && x < Z.x1 && z < Z.z1; }
    if (!inZ(sx, sz)) return false;
    function free(x, z) { var i = idx(x, z); return treeA[i] > 0 && !jackClaim[i] && !occ[i]; }
    var vis = new Int32Array(W * H).fill(-2), qx = [sx], qz = [sz], hd = 0, goal = -2, si = (sz - Z.z0) * W + (sx - Z.x0);
    vis[si] = -1;
    if (free(sx, sz)) goal = si;
    while (hd < qx.length && goal === -2) {
      var cx = qx[hd], cz = qz[hd]; hd++;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
        if (!inZ(nx, nz)) continue;
        var vi = (nz - Z.z0) * W + (nx - Z.x0); if (vis[vi] !== -2) continue;
        var ni = idx(nx, nz);
        if (!loaded[ckOf(nx, nz)] || occ[ni] || terr[ni] === 2) continue;
        vis[vi] = (cz - Z.z0) * W + (cx - Z.x0);
        if (free(nx, nz)) { goal = vi; break; }
        qx.push(nx); qz.push(nz);
      }
    }
    if (goal === -2) return false;
    var cells = [], vv = goal;
    while (vv !== -1) { cells.unshift([Z.x0 + vv % W, Z.z0 + Math.floor(vv / W)]); vv = vis[vv]; }
    var pts = cells.map(function (c) { var cc = cellCenter(c[0], c[1]); return { x: cc.x + (Math.random() - 0.5) * 0.4, z: cc.z + (Math.random() - 0.5) * 0.4 }; });
    var last = cells[cells.length - 1], tc = cellCenter(last[0], last[1]), pv = pts.length > 1 ? pts[pts.length - 2] : { x: j.x, z: j.z };
    var ddx = pv.x - tc.x, ddz = pv.z - tc.z, dl = Math.hypot(ddx, ddz) || 1;
    pts[pts.length - 1] = { x: tc.x + ddx / dl * 0.3, z: tc.z + ddz / dl * 0.3 };        // встаёт у дерева со стороны, откуда пришёл
    var door = jackDoor(b);
    j.back = pts.slice(0, -1).reverse(); j.back.push({ x: door.x, z: door.z });
    j.tx = last[0]; j.tz = last[1]; j.tree = idx(last[0], last[1]); jackClaim[j.tree] = j.id;
    j.pts = pts; j.pi = 0; j.mode = 'out';
    return true;
  }
  function jackChop(j) {
    snd('chop');
    var kind = j.tree >= 0 ? treeA[j.tree] : 0;
    if (kind) {
      var ul = undoLog; undoLog = null; var ok = clearTree(j.tx, j.tz); undoLog = ul;   // это не жест игрока — в журнал отмены не пишем
      if (ok) { j.carry = G.lumber.perTree[kind] || 3; saveSoft(); }
    }
    jackRelease(j);
    if (j.carry) batchRemove(jackBatch(0), j.id);
    j.mode = 'back'; j.pts = j.back || []; j.pi = 0; j.back = null;
    jackWrite(j);
  }
  function jackArrive(j) {
    if (j.carry) { state.stock.logs += j.carry; stockDirty = true; batchRemove(jackBatch(1), j.id); j.carry = 0; }
    j.mode = 'idle'; j.pts = null; j.t = 0.6 + Math.random() * 1.5;
    jackWrite(j);
  }
  function stepJack(j, dt) {
    var b = getB(j.bid); if (!b) return false;
    var L = G.lumber;
    if (j.mode === 'idle') {
      j.t -= dt; if (j.t > 0) return false;
      if (jackBudget <= 0) return false;
      jackBudget--;
      if (!jackPlan(j, b)) { j.t = 3 + Math.random() * 3; return false; }
    }
    if (j.mode === 'out' || j.mode === 'back') {
      var sp = L.speed * dt;
      while (sp > 0 && j.pi < j.pts.length) {
        var p = j.pts[j.pi], dx = p.x - j.x, dz = p.z - j.z, d = Math.hypot(dx, dz);
        if (d > 1e-4) j.yawT = Math.atan2(dx, dz);
        if (d <= sp) { j.x = p.x; j.z = p.z; sp -= d; j.pi++; } else { j.x += dx / d * sp; j.z += dz / d * sp; sp = 0; }
      }
      if (j.yawT !== undefined) j.yaw = angTo(j.yaw, j.yawT, Math.min(1, dt * 9));
      if (j.pi >= j.pts.length) {
        if (j.mode === 'out') { var tc = cellCenter(j.tx, j.tz); j.mode = 'chop'; j.t = L.chop * (0.8 + Math.random() * 0.4); j.yawT = Math.atan2(tc.x - j.x, tc.z - j.z); }
        else { jackArrive(j); return true; }
      }
      jackWrite(j); return true;
    }
    if (j.mode === 'chop') {
      j.t -= dt; j.ph = (j.ph || 0) + dt * 15;
      j.yaw = angTo(j.yaw, j.yawT, Math.min(1, dt * 9));
      jackWrite(j, 1 + Math.sin(j.ph) * 0.07);          // взмахи топором — фигурка «приседает» в такт ударам
      if (j.t <= 0) jackChop(j);
      return true;
    }
    return false;
  }
  function tickJacks(dt) {
    if (!state || !state.env) return;
    jackBudget = 3; jackT -= dt;
    if (jackT <= 0) { jackT = 1.5; syncJacks(); }
    var any = false;
    for (var id in jacks) if (stepJack(jacks[id], dt)) any = true;
    if (any) dirty();
  }

  // Какие машины завода обслуживают здания этого вида
  function servingText(cat) {
    var out = [];
    Object.keys(G.vehicles).forEach(function (k) { var v = G.vehicles[k]; if (v.serves === cat) out.push(v.icon + ' ' + v.name + ': ' + vehCount(k)); });
    return out.join(', ');
  }

  // ---------- Износ асфальта (с 0.9.0) ----------
  // Клетки асфальта стареют со временем; у работающих зданий движение больше — износ быстрее.
  var traffic = {}, cellKc = {};
  function edgeKeys(b, fn) {
    var f = foot(b.size, b.rot);
    for (var x = b.x - 1; x <= b.x + f.w; x++) for (var z = b.z - 1; z <= b.z + f.d; z++) {
      var onEdge = x === b.x - 1 || x === b.x + f.w || z === b.z - 1 || z === b.z + f.d;
      var corner = (x === b.x - 1 || x === b.x + f.w) && (z === b.z - 1 || z === b.z + f.d);
      if (onEdge && !corner) fn(key(x, z));
    }
  }
  function rebuildTraffic() {
    traffic = {};
    state.buildings.forEach(function (b) { if (isWorking(b)) edgeKeys(b, function (k) { if (state.roads[k]) traffic[k] = 1; }); });
  }
  function cellK(k) { // у каждой клетки своя скорость старения 0,75…1,25
    var v = cellKc[k];
    if (v === undefined) { var h = 7; for (var i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 2654435761); v = cellKc[k] = 0.75 + ((h >>> 0) % 1000) / 2000; }
    return v;
  }
  function markRoadKey(k) { var p = k.split(','); markRoad(+p[0], +p[1]); }
  var wearAcc = 0, wearSaveT = 0, brokeHintT = 0;
  function tickWear(dt) {
    wearAcc += dt; if (wearAcc < 1) return;
    var step = wearAcc; wearAcc = 0;
    var wearCk = {}, base = step / G.wear.life, auto = state.autoRepair && working('depot').length > 0, qd = auto ? queuedSet() : null, broken = [], ch = false;
    for (var k in state.roads) {
      if (state.roads[k] !== 'asphalt' || fixing[k]) continue;
      var w = state.wear[k] || 0, nw = w + base * cellK(k) * (traffic[k] ? G.wear.traffic : 1);
      if (wearStage(nw) !== wearStage(w)) { markRoadKey(k); ch = true; }
      if (nw >= 1) { broken.push(k); continue; }
      state.wear[k] = nw; wearCk[ckOfKey(k)] = 1;
      if (auto && nw >= G.repair.autoAt && !qd[k]) { state.rq.push(k); qd[k] = 1; }
    }
    // разбитый асфальт становится простой дорогой — здания у неё продолжают работать
    broken.forEach(function (k) { var p = k.split(','); state.roads[k] = 'dirt'; delete state.wear[k]; touchCk(ckOfKey(k), true); refreshRoadAround(+p[0], +p[1]); });
    if (broken.length) {
      var t = performance.now();
      if (t - brokeHintT > 20000) { brokeHintT = t; hint('🕳️ Асфальт разбит (' + broken.length + ' ' + plural(broken.length, 'клетка', 'клетки', 'клеток') + ') и стал простой дорогой. Чините дороги в Дорожном депо', true); }
      statsSoon();
    }
    if (ch || broken.length) dirty();
    Object.keys(wearCk).forEach(function (c) { touchCk(c, false); });
    wearSaveT += step; if (wearSaveT >= 5 || broken.length) { wearSaveT = 0; if (broken.length) save(); else saveSoft(); }
  }
  function roadStats() {
    var r = { asphalt: 0, dirt: 0, cobble: 0, mid: 0, worn: 0, sum: 0, todo: 0, todoCost: 0 }, qd = queuedSet();
    for (var k in state.roads) {
      if (state.roads[k] === 'cobble') { r.cobble++; continue; }
      if (state.roads[k] !== 'asphalt') { r.dirt++; continue; }
      var w = state.wear[k] || 0, sg = wearStage(w);
      r.asphalt++; r.sum += w; if (sg === 1) r.mid++; else if (sg === 2) r.worn++;
      if (w >= G.repair.manualAt && !qd[k]) { r.todo++; r.todoCost += repairCost(w); }
    }
    r.avg = r.asphalt ? r.sum / r.asphalt : 0;
    return r;
  }
  function pctText(v) { return Math.round(v * 100) + '%'; }
  function wearName(w) { var s = wearStage(w); return s === 0 ? 'хороший' : s === 1 ? 'средний износ' : 'почти изношен'; }

  // ---------- Дорожное депо: ремонт асфальта катком (с 0.9.0) ----------
  var rollers = {}, fixing = {}; // id депо -> каток; клетки, которые сейчас ремонтируют
  function repairCost(w) { return Math.max(G.repair.min, Math.round(G.repair.full * w / 10) * 10); }
  function rollerBatch() { return getBatch('roller', function () { return rollerModel(kit); }); }
  function writeRoller(r, bob) { batchSet(rollerBatch(), r.id, r.x, bob || 0, r.z, r.yaw, 0.82, 0.82, 0.82); dirty(); }
  function depotHome(b) { return localPos(b, -0.47, 0.5); } // на площадке у левых ворот, носом к выезду
  function syncRollers() {
    var on = {};
    working('depot').forEach(function (b) {
      on[b.id] = 1;
      var h = depotHome(b), r = rollers[b.id];
      if (!r) { r = rollers[b.id] = { id: b.id, x: h.x, z: h.z, yaw: h.yaw, job: null, work: false, t: 0 }; writeRoller(r); }
      r.home = h;
    });
    Object.keys(rollers).forEach(function (id) {
      if (on[id]) return;
      var r = rollers[id]; if (r.job) { delete fixing[r.job]; state.rq.unshift(r.job); }
      batchRemove(rollerBatch(), +id); delete rollers[id]; dirty();
    });
  }
  function clearRollers() {
    Object.keys(rollers).forEach(function (id) { batchRemove(rollerBatch(), +id); });
    for (var k in fixing) state.rq.unshift(k);
    rollers = {}; fixing = {};
  }
  function queuedSet() { var o = {}; state.rq.forEach(function (k) { o[k] = 1; }); for (var k in fixing) o[k] = 1; return o; }
  function queueRepair(min, only) {
    var qd = queuedSet(), n = 0, cost = 0;
    (only ? [only] : Object.keys(state.roads)).forEach(function (k) {
      if (state.roads[k] !== 'asphalt' || qd[k]) return;
      var w = state.wear[k] || 0; if (w < min || w < 0.005) return;
      state.rq.push(k); qd[k] = 1; n++; cost += repairCost(w);
    });
    return { n: n, cost: cost };
  }
  function takeJob(r) {
    state.rq = state.rq.filter(function (k, i, a) { return state.roads[k] === 'asphalt' && state.wear[k] > 0.005 && !fixing[k] && a.indexOf(k) === i; });
    var best = -1, bd = 1e9;
    state.rq.forEach(function (k, i) {
      var p = k.split(','), c = cellCenter(+p[0], +p[1]), d = Math.hypot(c.x - r.x, c.z - r.z);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return null;
    var k = state.rq.splice(best, 1)[0]; fixing[k] = 1; return k;
  }
  function finishJob(r) { if (r.job) delete fixing[r.job]; r.job = null; r.work = false; save(); }
  var repairedN = 0;
  function tickRepair(dt, t) {
    var ids = Object.keys(rollers); if (!ids.length) return false;
    var any = false, R = G.repair;
    ids.forEach(function (id) {
      var r = rollers[id];
      if (!r.job && state.rq.length) r.job = takeJob(r);
      if (r.job && r.work) { // укатывает клетку: катается вперёд-назад, износ уходит
        var k = r.job;
        if (state.roads[k] !== 'asphalt') { finishJob(r); return; }
        r.t += dt;
        var q = Math.min(1, r.t / R.work), s0 = wearStage(state.wear[k] || 0), w = r.w0 * (1 - q);
        state.wear[k] = w; touchCk(ckOfKey(k), false); if (wearStage(w) !== s0) markRoadKey(k);
        var off = Math.sin(r.t * 3.2) * 0.26;
        r.x = r.bx + Math.sin(r.yaw) * off; r.z = r.bz + Math.cos(r.yaw) * off;
        writeRoller(r, Math.abs(Math.sin(t * 0.03)) * 0.005); any = true;
        if (q >= 1) { delete state.wear[k]; touchCk(ckOfKey(k), true); markRoadKey(k); repairedN++; finishJob(r); }
        return;
      }
      var tgt = r.home;
      if (r.job) { var p = r.job.split(','), c = cellCenter(+p[0], +p[1]); tgt = { x: c.x, z: c.z, yaw: r.yaw }; }
      var dx = tgt.x - r.x, dz = tgt.z - r.z, d = Math.hypot(dx, dz);
      if (d > 0.02) {
        var v = Math.max(R.speed, d / 3), st = Math.min(d, v * dt);
        r.x += dx / d * st; r.z += dz / d * st;
        r.yaw = angTo(r.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
        writeRoller(r); any = true; return;
      }
      r.x = tgt.x; r.z = tgt.z;
      if (!r.job) { // в гараже: развернуться как надо
        if (Math.abs(Math.atan2(Math.sin(tgt.yaw - r.yaw), Math.cos(tgt.yaw - r.yaw))) > 0.01) { r.yaw = angTo(r.yaw, tgt.yaw, Math.min(1, dt * 8)); writeRoller(r); any = true; }
        return;
      }
      // приехал: оплата и начало укатки
      var kk = r.job, ww = state.wear[kk] || 0;
      if (state.roads[kk] !== 'asphalt' || ww < 0.005) { finishJob(r); return; }
      var cost = repairCost(ww);
      if (!canPay(cost)) { hint('Не хватает долларов на ремонт дороги: нужно ' + usd(cost), true); state.rq = []; finishJob(r); return; }
      pay(cost); r.work = true; r.w0 = ww; r.t = 0; r.bx = r.x; r.bz = r.z;
      r.yaw = Math.round(r.yaw / (Math.PI / 2)) * (Math.PI / 2); // вдоль дороги
      any = true;
    });
    return any;
  }
  function rollerText(id) {
    var r = rollers[id]; if (!r) return '<span class="bad">не работает</span>';
    if (r.job && r.work) return '🚧 ремонтирует (' + Math.floor(Math.min(1, r.t / G.repair.work) * 100) + '%)';
    if (r.job) return '🚜 едет к дороге';
    return '🅿️ в гараже';
  }
  function rollersText() {
    var ids = Object.keys(rollers);
    if (!ids.length) return state.buildings.some(function (b) { return b.cat === 'depot'; }) ? '<span class="bad">депо не работает</span>' : 'нет депо';
    return ids.map(rollerText).join('<br>');
  }
  function noDepotMsg() {
    return state.buildings.some(function (b) { return b.cat === 'depot' && !isSite(b); }) ? '🛠️ Депо не работает — подведите к нему дорогу' :
      state.buildings.some(function (b) { return b.cat === 'depot'; }) ? '🛠️ Депо ещё строится' : '🛠️ Сначала постройте Дорожное депо: 🚚 Механизмы → 🏭 Здания';
  }
  function repairAllAct() {
    if (!working('depot').length) { hint(noDepotMsg(), true); return; }
    var r = queueRepair(G.repair.manualAt);
    hint(r.n ? '🛠️ В ремонт: ' + r.n + ' ' + plural(r.n, 'клетка', 'клетки', 'клеток') + ' асфальта, ≈ ' + usd(r.cost) : 'Изношенного асфальта нет — ремонтировать нечего');
    save(); refreshLive();
  }
  function repairOneAct(k) {
    if (!working('depot').length) { hint(noDepotMsg(), true); return; }
    var r = queueRepair(0, k);
    hint(r.n ? '🛠️ Клетка в очереди на ремонт, ≈ ' + usd(r.cost) : 'Эту клетку ремонтировать не нужно');
    save(); refreshLive();
  }
  function toggleAuto() {
    state.autoRepair = !state.autoRepair;
    if (state.autoRepair && working('depot').length) queueRepair(G.repair.autoAt);
    save(); refreshLive();
    hint(state.autoRepair ? '🔄 Автоматический ремонт включён: депо само чинит асфальт с износом от ' + pctText(G.repair.autoAt) +
      (working('depot').length ? '' : ' (когда заработает депо)') : 'Автоматический ремонт выключен');
  }
  function autoLabel() { return '🔄 Ремонтировать автоматически: <b>' + (state.autoRepair ? 'ВКЛ' : 'ВЫКЛ') + '</b>'; }

  // Живые надписи в справке и в «Механизмах» — обновляются по id, без пересборки кнопок.
  function refreshLive() {
    function set(id, v) { var e = $(id); if (e && e.innerHTML !== v) e.innerHTML = v; }
    var need = $('iRs') || $('mRs') || $('irWear') || $('iFq') || $('mFq') || $('mFqAll') || $('mVq_garbage');
    if (!need && !infoRoad) return;
    if (infoRoad) {
      var t = state.roads[infoRoad];
      if (!t) { closeInfo(); return; }
      if (t !== infoRoadT) { renderRoadInfo(); return; }
      if (t === 'asphalt') {
        var w = state.wear[infoRoad] || 0, qd = queuedSet();
        set('irWear', pctText(w));
        set('irState', fixing[infoRoad] ? '🚧 ремонтируется' : qd[infoRoad] ? '⏳ в очереди на ремонт' : wearName(w));
        set('irCost', w < 0.005 ? 'не нужен' : usd(repairCost(w)));
        var bar = $('irBar'); if (bar) { bar.style.width = Math.max(2, w * 100) + '%'; bar.className = 'w' + wearStage(w); }
      }
    }
    if ($('iRs') || $('mRs')) {
      var R = roadStats(), rs = R.asphalt ? R.asphalt + ' кл., средний износ ' + pctText(R.avg) : 'асфальта нет';
      set('iRs', rs); set('mRs', rs);
      set('mMid', String(R.mid)); set('mWorn', R.worn ? '<span class="bad">' + R.worn + '</span>' : '0');
      set('iWornN', R.mid + ' / ' + (R.worn ? '<span class="bad">' + R.worn + '</span>' : '0'));
      var qn = state.rq.length + Object.keys(fixing).length, qt = qn ? qn + ' ' + plural(qn, 'клетка', 'клетки', 'клеток') : 'пусто';
      set('iQ', qt); set('mQ', qt);
      set('iRoller', rollersText()); set('mRoller', rollersText());
      var rb = '🛠️ Отремонтировать изношенные' + (R.todo ? ' · ' + R.todo + ' кл. ≈ ' + usd(R.todoCost) : '');
      set('iRep', rb); set('mRep', rb);
      ['iAuto', 'mAuto'].forEach(function (id) { var e = $(id); if (e) { set(id, autoLabel()); e.classList.toggle('on', state.autoRepair); } });
    }
    set('iFq', fqText()); set('mFq', fqText('brigade')); set('mFqAll', fqText());
    ['iCancel', 'mCancel'].forEach(function (id) { var e = $(id); if (e) e.disabled = !queued('brigade'); });
    if ($('mVn_garbage')) Object.keys(G.vehicles).forEach(function (k) {
      set('mVn_' + k, String(vehCount(k)));
      var w = working(G.vehicles[k].serves).length; set('mVw_' + k, w ? w + ' ' + plural(w, 'здание', 'здания', 'зданий') : '<span class="bad">нет работающих</span>');
    });
    if ($('mCarsN')) set('mCarsN', String(Object.keys(carAgents).length));
  }

  function rebuildAll() {
    if (!mapNodes.length || state.size !== N) { N = state.size; occ = new Int32Array(N * N); buildMapScene(); }
    envReset(); mmReset();
    Object.keys(placed).forEach(function (id) { removeBuildingMesh(+id); });
    byId = {};
    Object.keys(chunks).forEach(function (ck) { chunks[ck].forEach(function (m) { m.dispose(); }); }); chunks = {};
    rebuildOcc();
    state.buildings.forEach(addBuildingMesh);
    Object.keys(state.roads).forEach(function (k) { var p = k.split(','); markRoad(+p[0], +p[1]); });
    rebuildTrucks(); assignBrigades(); clearRollers(); rebuildAgents();
    resCache = {}; workCache = {};
    updateStats(); updateMoney(); refreshNeed(); dirty();
  }

  // ---------- Призрак и курсор ----------
  var ghost = null, ghostKey = '', ghostCat = '';
  var ghostFoot = quadsMesh('gfoot', [[0, 0, 1, 1, 0.03]], flatMat('#4cd964', { overlay: true, alpha: 0.45 }));
  var cursor = quadsMesh('cursor', [[0, 0, 1, 1, 0.035]], flatMat('#ffffff', { overlay: true, alpha: 0.4 }));
  var hl = quadsMesh('hl', [[0, 0, 1, 1, 0.025]], flatMat('#ffc94a', { overlay: true, alpha: 0.55 }));
  var zoneMesh = quadsMesh('zone', [[0, 0, 1, 1, 0.022]], flatMat('#8fe06f', { overlay: true, alpha: 0.2 }));   // поле деятельности Общества лесорубов (с 0.23.0)
  [ghostFoot, cursor, hl, zoneMesh].forEach(function (m) { m.setEnabled(false); });
  function showZone(b) { var Z = jackZone(b); setOverlay(zoneMesh, (Z.x0 + Z.x1) / 2 - N / 2, (Z.z0 + Z.z1) / 2 - N / 2, Z.x1 - Z.x0, Z.z1 - Z.z0); }
  function zoneOff() { if (zoneMesh.isEnabled()) { zoneMesh.setEnabled(false); dirty(); } }
  function zoneKeep() { var ib = infoId && getB(infoId); if (ib && ib.cat === 'lumber') showZone(ib); else zoneOff(); }
  function setOverlay(m, x, z, w, d, color) {
    m.position.set(x, 0, z); m.scaling.set(w, 1, d);
    if (color) m.material.emissiveColor = hex(color);
    m.setEnabled(true); dirty();
  }

  function setGhost(cat, size, seed, th) {
    th = th === undefined ? buildTheme : th;
    var k = tplKey(cat, size, seed, th);
    if (k === ghostKey && ghost) return;
    if (ghost) { var mm = ghost.material; ghost.dispose(); if (mm) mm.dispose(); ghost = null; }
    ghostKey = k; ghostCat = cat;
    ghost = buildModel(kit, cat, size, modelSeed(cat, variantOf(cat, seed)), th);
    ghost.visibility = 0.6; ghost.isPickable = false;
    ghost.setEnabled(false);
  }
  function showGhostAt(size, rot, x, z, ok) {
    var b = { size: size, rot: rot, x: x, z: z }, f = foot(size, rot), p = bPos(b);
    ghost.position.set(p.x, 0, p.z); ghost.rotation.y = p.yaw; ghost.setEnabled(true);
    setOverlay(ghostFoot, p.x, p.z, f.w, f.d, ok ? '#4cd964' : '#ff3b30');
    if (ghostCat === 'lumber') showZone(b); else zoneKeep();
  }
  function hideGhost() { if (ghost) ghost.setEnabled(false); ghostFoot.setEnabled(false); zoneKeep(); dirty(); }
  function showCursor(x, z, color) {
    if (!inMap(x, z)) { cursor.setEnabled(false); dirty(); return; }
    var c = cellCenter(x, z); setOverlay(cursor, c.x, c.z, 1, 1, color);
  }

  // ---------- Камера: изометрия ----------
  var ISO_PITCH = Math.PI / 6; // 30° — пропорция клетки 2:1, как в SimCity 2000
  var cam = { tx: 0, tz: 2, dist: 34, yaw: Math.PI / 4, pitch: ISO_PITCH, yawGoal: null };
  function snapYaw(y) { var q = Math.PI / 2; return Math.round((y - Math.PI / 4) / q) * q + Math.PI / 4; }
  function camHome() {
    cam.tx = 0; cam.tz = 2; cam.yaw = Math.PI / 4; cam.pitch = ISO_PITCH; cam.yawGoal = null;
    cam.dist = clamp(N * 0.72, 24, 45) * (window.innerWidth < window.innerHeight ? 1.3 : 1);
    updateCam();
  }
  function aspect() { return engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()); }
  function updateCam() {
    cam.dist = clamp(cam.dist, 5, Math.max(80, Math.min(N * 1.3, 150))); // дальше 150 не отдаляем: видимая часть не должна быть больше ~5×5 кусков
    cam.pitch = ISO_PITCH;
    cam.tx = clamp(cam.tx, -N / 2, N / 2); cam.tz = clamp(cam.tz, -N / 2, N / 2);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), dx = cp * Math.sin(cam.yaw), dz = cp * Math.cos(cam.yaw);
    var halfH = cam.dist * Math.tan(camera.fov / 2);
    // Ортографическая камера: дальние дома не уменьшаются, все линии параллельны.
    var far = Math.min(N * 2 + 60, 600);
    camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoTop = halfH; camera.orthoBottom = -halfH;
    // Компьютер и планшет: панель справа — центр города сдвигаем в середину свободной части экрана (влево)
    var shift = 0;
    if (SIDE && SIDE.matches) shift = (12 + $('dock').offsetWidth) / 2 * (2 * halfH / Math.max(1, window.innerHeight));
    camera.orthoLeft = -halfH * aspect() + shift; camera.orthoRight = halfH * aspect() + shift;
    camera.position.set(cam.tx + far * dx, far * sp, cam.tz + far * dz);
    camera.minZ = 1; camera.maxZ = far * 2.5;
    var ext = halfH * Math.max(1, aspect()) * 1.6;
    camera.setTarget(new B.Vector3(cam.tx, 0, cam.tz));
    // солнце и тени следуют за камерой
    sun.position.set(cam.tx + SUN_OFF.x * 2, SUN_OFF.y * 2, cam.tz + SUN_OFF.z * 2);
    sun.orthoLeft = -ext; sun.orthoRight = ext; sun.orthoTop = ext; sun.orthoBottom = -ext;
    sun.shadowMaxZ = 200 + ext;
    dirty();
  }

  // ---------- Качество картинки («ИЗО HD») ----------
  // Полное разрешение экрана, сглаживание (MSAA + FXAA),
  // тени 4096, кинематографичная цветокоррекция (ACES), окна 256 px, трава и срез земли с фактурой.
  var hdState = null, hdMatCache = null;
  function canvasTex(name, c, uS, vS) {
    var t = new B.DynamicTexture(name, c, scene, true); t.update();
    t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8;
    t.uScale = uS || 1; t.vScale = vS || 1; return t;
  }
  function hdMats() {
    if (hdMatCache) return hdMatCache;
    // трава: пятна разного оттенка и короткие травинки
    var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d'), r = rng(42);
    g.fillStyle = '#86bd62'; g.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 90; i++) {
      var x = r() * 256, y = r() * 256, rad = 10 + r() * 30;
      var gr = g.createRadialGradient(x, y, 0, x, y, rad), col = r() > 0.5 ? '120,178,84' : '150,196,104';
      gr.addColorStop(0, 'rgba(' + col + ',.3)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = gr;
      [[0, 0], [-256, 0], [256, 0], [0, -256], [0, 256]].forEach(function (o) { g.fillRect(x + o[0] - rad, y + o[1] - rad, rad * 2, rad * 2); });
    }
    for (i = 0; i < 2600; i++) {
      g.fillStyle = r() > 0.55 ? 'rgba(60,110,40,.35)' : 'rgba(205,232,150,.35)';
      g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3);
    }
    var grass = new B.StandardMaterial('grassHD', scene); grass.specularColor = B.Color3.Black();
    grass.diffuseTexture = canvasTex('grassHDt', c, 1, 1);
    // срез земли
    function slabCanvas() {
      var W = 512, H = 256, s = document.createElement('canvas'); s.width = W; s.height = H; var q = s.getContext('2d'), rr = rng(7);
      var L = [[0, 0.07, '#5f9a43'], [0.07, 0.43, '#7b5a3c'], [0.43, 0.76, '#5e4632'], [0.76, 1, '#4a4a50']];
      L.forEach(function (l, k) {
        var y0 = l[0] * H, y1 = l[1] * H, gr = q.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, shade(l[2], 0.08)); gr.addColorStop(1, shade(l[2], -0.12));
        q.fillStyle = gr; q.fillRect(0, y0, W, y1 - y0 + 1);
        // волнистая граница слоя
        if (k) { q.fillStyle = shade(l[2], -0.2); for (var x = 0; x < W; x += 4) q.fillRect(x, y0 + Math.sin(x / 23 + k) * 3, 4, 3); }
      });
      for (var i = 0; i < 520; i++) { // камешки
        var x = rr() * W, y = (0.1 + rr() * 0.9) * H, w = 2 + rr() * (y > H * 0.76 ? 14 : 6);
        q.fillStyle = y > H * 0.76 ? (rr() > 0.5 ? '#5d5d64' : '#38383d') : (rr() > 0.5 ? 'rgba(160,130,95,.7)' : 'rgba(40,28,18,.5)');
        q.beginPath(); q.ellipse(x, y, w, w * 0.6, 0, 0, Math.PI * 2); q.fill();
      }
      for (i = 0; i < 160; i++) { q.fillStyle = 'rgba(70,120,50,.8)'; q.fillRect(rr() * W, 0.06 * H, 2, 2 + rr() * 6); } // корешки травы
      return s;
    }
    var slabC = slabCanvas();
    hdMatCache = {
      grass: grass,
      slab: function (n) {
        var m = new B.StandardMaterial('slabHD', scene); m.specularColor = B.Color3.Black();
        m.emissiveColor = new B.Color3(0.3, 0.28, 0.26); // срез в тени не должен уходить в черноту
        m.diffuseTexture = canvasTex('slabHDt', slabC, n / 8, -1); // -1: дёрн сверху, скала снизу
        return m;
      }
    };
    return hdMatCache;
  }
  function enableHD() {
    if (hdState) return;
    kit.setHD(true); syncSiteMats();
    hdState = {};
    hemi.intensity = 0.7; hemi.groundColor = hex('#66745a');
    sun.intensity = 1.0; sun.diffuse = hex('#fff1d8'); sun.specular = hex('#ffffff');
    // один и тот же мягкий фильтр теней; смена фильтра на лету пересобирает шейдеры
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.usePoissonSampling = false;
    shadowGen.getShadowMap().resize(TOUCH ? 2048 : 4096);
    shadowGen.filteringQuality = B.ShadowGenerator.QUALITY_HIGH;
    shadowGen.darkness = 0.04;
    var pp = new B.DefaultRenderingPipeline('hd', true, scene, [camera]);
    pp.samples = 4; pp.fxaaEnabled = true;
    pp.imageProcessingEnabled = true;
    var ip = pp.imageProcessing;
    ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.32; ip.contrast = 1.18;
    ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteStretch = 0.4; ip.vignetteColor = new B.Color4(0.02, 0.03, 0.06, 0);
    pp.sharpenEnabled = true; pp.sharpen.edgeAmount = 0.22; pp.sharpen.colorAmount = 1;
    hdState.pp = pp;
    dirty();
  }

  // Полное разрешение экрана (до 2× на «ретина»-экранах).
  function pixelScale() { return 1 / Math.min(window.devicePixelRatio || 1, 2); }
  function rotateCam(dir) { // dir: +1 влево, -1 вправо; карта поворачивается ровно на 90°
    cam.yawGoal = snapYaw((cam.yawGoal === null ? cam.yaw : cam.yawGoal) + dir * Math.PI / 2);
  }
  function tickCam(dt) {
    if (cam.yawGoal === null) return;
    var d = cam.yawGoal - cam.yaw;
    if (Math.abs(d) < 0.002) { cam.yaw = cam.yawGoal; cam.yawGoal = null; }
    else cam.yaw += d * Math.min(1, dt * 12);
    updateCam();
  }
  function resize() {
    engine.setHardwareScalingLevel(pixelScale());
    engine.resize();
    camera.fov = (window.innerWidth < window.innerHeight ? 55 : 45) * Math.PI / 180;
    updateCam(); fitGrid();
  }
  window.addEventListener('resize', resize);

  // Луч из точки экрана: пересечение с землёй и со зданиями (без помощи движка — быстро и на тысячах домов).
  var rayM = B.Matrix.Identity();
  function rayAt(sx, sy) {
    var rc = canvas.getBoundingClientRect();
    return scene.createPickingRay(sx - rc.left, sy - rc.top, rayM, camera, false);
  }
  function groundAt(sx, sy) {
    var r = rayAt(sx, sy);
    if (Math.abs(r.direction.y) < 1e-6) return null;
    var t = -r.origin.y / r.direction.y; if (t < 0) return null;
    return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
  }
  function cellAt(sx, sy) {
    var p = groundAt(sx, sy); if (!p) return null;
    return { x: Math.floor(p.x + N / 2), z: Math.floor(p.z + N / 2), px: p.x + N / 2, pz: p.z + N / 2 };
  }
  function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
    var tmin = -Infinity, tmax = Infinity, a = [o.x, o.y, o.z], v = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (var i = 0; i < 3; i++) {
      if (Math.abs(v[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return -1; continue; }
      var t1 = (lo[i] - a[i]) / v[i], t2 = (hi[i] - a[i]) / v[i];
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmax < 0 ? -1 : Math.max(0, tmin);
  }
  function pickBuilding(sx, sy) {
    var r = rayAt(sx, sy), best = null, bt = Infinity;
    state.buildings.forEach(function (b) {
      var f = foot(b.size, b.rot), x0 = b.x - N / 2, z0 = b.z - N / 2, bh = placed[b.id] ? placed[b.id].h : 1;
      var h = isSite(b) ? siteTop(b) : bh;
      var t = rayBox(r.origin, r.direction, x0 + 0.05, 0, z0 + 0.05, x0 + f.w - 0.05, h, z0 + f.d - 0.05);
      if (t >= 0 && t < bt) { bt = t; best = b; }
    });
    if (best) return best;
    var c = cellAt(sx, sy);
    if (c && inMap(c.x, c.z) && occ[idx(c.x, c.z)]) return getB(occ[idx(c.x, c.z)]);
    return null;
  }
  function originFor(size, rot, c) {
    var f = foot(size, rot);
    return { x: clamp(Math.round(c.px - f.w / 2), 0, N - f.w), z: clamp(Math.round(c.pz - f.d / 2), 0, N - f.d) };
  }

  // ---------- Инструменты ----------
  var tool = 'view', buildCat = 'res', buildSize = '1x1', buildRot = 0, buildSeed = newSeed(), roadType = 'asphalt';
  var THEME_KEY = 'moe_gorod_epoch', buildTheme = 0;
  try { buildTheme = clamp(parseInt(localStorage.getItem(THEME_KEY), 10) || 0, 0, G.themes.length - 1); } catch (e) {}
  var moving = null; // {b, offX, offZ, rot, x, z}

  var HINTS = {
    view: TOUCH ? 'Нажмите на здание — справка. Два пальца — масштаб и поворот на 90°.' : 'Нажмите на здание — справка. ЛКМ/ПКМ — двигать карту, колесо — масштаб, Q/E — поворот на 90°.',
    build: TOUCH ? 'Ведите пальцем, отпустите — начнётся стройка.' : 'Наведите на карту и нажмите — начнётся стройка. R — повернуть.',
    road: 'Ведите по клеткам, чтобы проложить дорогу.',
    move: TOUCH ? 'Возьмите здание пальцем и перетащите на новое место.' : 'Зажмите здание и перетащите на новое место. R — повернуть.',
    delete: 'Нажмите на здание, дерево или ведите по дороге, чтобы удалить.'
  };
  var NO_BRIGADE = 'Сначала купите бригаду — кнопка «Купить» вверху меню «Строить»';
  var hintTimer = 0;
  function snd(name) { if (window.MoeAudio) window.MoeAudio.sfx(name); }   // звуки действий — js/audio.js (с 0.24.0)
  function hint(text, warn) {
    if (warn && text && text.charAt(0) !== '✅') snd('error');
    var h = $('hint'); h.textContent = text || HINTS[tool]; h.className = 'hint' + (warn ? ' warn' : ''); h.style.opacity = 1;
    clearTimeout(hintTimer);
    hintTimer = warn ? setTimeout(function () { hint(); }, 2200) : setTimeout(function () { h.style.opacity = 0; }, 6000);
  }

  function setTool(t) {
    var was = tool;
    tool = t;
    document.querySelectorAll('.tool').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    $('panelBuild').hidden = t !== 'build';
    document.body.classList.toggle('sp-open', t === 'build' || t === 'road');
    $('panelRoad').hidden = t !== 'road';
    hideGhost(); cursor.setEnabled(false);
    if (moving) cancelMove();
    if (t !== 'view') closeInfo();
    if (t === 'build') { setGhost(buildCat, buildSize, buildSeed); refreshNeed(); }
    if (t !== 'build') catsOpen(false); else if (was !== 'build') catsOpen(true);   // «Строить» — сразу открываются категории
    if (t === 'build' && !state.brigades.length) hint(NO_BRIGADE, true); else hint();
    fitGrid();
  }
  // Покупка бригады прямо в панели «Строить» (с 0.15.0). Строка обновляется, только если что-то изменилось.
  var brKey = '';
  function updateBrRow() {
    var u = G.units.brigade, n = state.brigades.length, busy = 0, lim = n >= u.importMax, price = usd(u.price);
    state.brigades.forEach(function (br) { if (br.site) busy++; });
    var sub = !n ? 'строить некому' : lim ? 'лимит завоза: ' + u.importMax : busy ? 'заняты ' + busy + ' из ' + n : 'все свободны';
    var k = n + '|' + busy + '|' + price;
    if (k === brKey) return;
    brKey = k;
    $('brN').textContent = n;
    $('brSub').textContent = sub;
    $('brBuy').textContent = 'Купить · ' + price;
    $('brBuy').classList.toggle('lim', lim);
    $('brRow').classList.toggle('none', !n);
    $('brRow').title = 'Бригад: ' + n + (n ? ', заняты ' + busy : '') + '. Чем больше бригад — тем быстрее стройка.' +
      (lim ? ' Привезти можно только ' + u.importMax + ' — остальные заказывайте на Механическом заводе.' : '');
    $('brBuy').title = lim ? 'Привезти можно только ' + u.importMax + ' бригады — дальше заказывайте на заводе' : 'Купить бригаду за ' + price;
  }
  function refreshNeed() { updateBrRow(); fitGrid(); }
  $('brBuy').addEventListener('click', buyBrigade);

  // Компьютер и планшет: меню построек — боковая панель справа (с 0.13.0; в 0.12.0 была слева), 2 колонки × 10 рядов.
  // Высота карточки подбирается так, чтобы 10 рядов поместились в экран (от 50 до 72 px);
  // если экран совсем низкий — лишнее прокручивается.
  var SIDE = window.matchMedia('(min-width: 700px) and (min-height: 500px)');
  function fitGrid() {
    var dock = $('dock'), g = $('bGrid');
    if (!SIDE.matches || $('panelBuild').hidden) { dock.style.removeProperty('--bh'); return; }
    var chrome = dock.offsetHeight - g.offsetHeight;                 // всё в панели, кроме самой сетки
    var avail = (parseFloat(getComputedStyle(dock).maxHeight) || window.innerHeight - 24) - chrome;
    var bh = clamp(Math.floor((avail - 9 * 6) / 10), 50, 72);
    dock.style.setProperty('--bh', bh + 'px');
    g.classList.toggle('scroll', g.scrollHeight > g.clientHeight + 1);
  }
  if (SIDE.addEventListener) SIDE.addEventListener('change', fitGrid);
  // --- миниатюры: отдельный маленький движок, рисуются по очереди и подставляются в карточки ---
  var thumbs = {}, tq = [], T = null, tBusy = false;
  function thumbReq(k, make) {
    if (thumbs[k] !== undefined) return thumbs[k];
    thumbs[k] = ''; tq.push({ k: k, make: make }); pumpThumbs();
    return '';
  }
  function thumbInit() {
    var tc = document.createElement('canvas'); tc.width = tc.height = 160;
    var en = new B.Engine(tc, true, { preserveDrawingBuffer: true, stencil: false, alpha: true }, false);
    var sc = new B.Scene(en); sc.useRightHandedSystem = true; sc.clearColor = new B.Color4(0, 0, 0, 0);
    var h = new B.HemisphericLight('h', new B.Vector3(0, 1, 0), sc); h.diffuse = hex('#eef6ff'); h.groundColor = hex('#6d8a55'); h.intensity = 0.85; h.specular = B.Color3.Black();
    var dl = new B.DirectionalLight('d', new B.Vector3(3, -6, -4), sc); dl.intensity = 0.6; dl.specular = B.Color3.Black();
    var c = new B.FreeCamera('c', new B.Vector3(0, 3, 3), sc); c.fov = 30 * Math.PI / 180; c.minZ = 0.05; c.maxZ = 100;
    T = { canvas: tc, engine: en, scene: sc, cam: c, kit: makeKit(sc) }; T.kit.setHD(true);
  }
  function pumpThumbs() { if (tBusy || !tq.length) return; tBusy = true; requestAnimationFrame(thumbStep); }
  function thumbStep() {
    try {
      if (!T) thumbInit();
      var it = tq[0];
      if (!it.mesh) {
        it.mesh = it.make(T.kit);
        it.mesh.computeWorldMatrix(true);
        var bi = it.mesh.getHierarchyBoundingVectors(true), ctr = bi.min.add(bi.max).scale(0.5), rad = bi.max.subtract(bi.min).length() / 2;
        var dist = rad / Math.sin(T.cam.fov / 2) * 1.02;
        T.cam.position.set(ctr.x + dist * 0.55, ctr.y + dist * 0.5, ctr.z + dist * 0.67);
        T.cam.setTarget(ctr);
        it.tries = 0;
      }
      if (!T.scene.isReady() && it.tries++ < 60) { requestAnimationFrame(thumbStep); return; }
      T.scene.render();
      var url = T.canvas.toDataURL('image/png');
      thumbs[it.k] = url;
      document.querySelectorAll('img[data-th="' + it.k + '"]').forEach(function (im) { im.src = url; });
      it.mesh.getChildMeshes(false).concat([it.mesh]).forEach(function (m) { var mm = m.material; m.dispose(); if (mm && mm.subMaterials) mm.dispose(); });
    } catch (e) { if (tq[0]) thumbs[tq[0].k] = ''; }
    tq.shift();
    if (tq.length) requestAnimationFrame(thumbStep); else tBusy = false;
  }
  function thumbKey(cat, size, th) { return cat + size + 't' + (th === undefined ? buildTheme : th); }
  function thumbUrl(cat, size, th) {
    th = th === undefined ? buildTheme : th;
    return thumbReq(thumbKey(cat, size, th), function (K) {
      var root = new B.Mesh('thumb', K.scene), g = buildModel(K, cat, size, modelSeed(cat, 0), th), s0 = G.sizes[size];
      g.parent = root;
      var pad = B.MeshBuilder.CreateBox('pad', { width: s0.w, height: 0.06, depth: s0.d }, K.scene); pad.position.y = -0.03; pad.material = K.mat('#8cc068'); pad.parent = root;
      return root;
    });
  }
  function truckThumb() {
    return thumbReq('truck', function (K) {
      var root = new B.Mesh('thumb', K.scene), t = truckModel(K); t.rotation.y = -0.35; t.parent = root;
      var pad = B.MeshBuilder.CreateBox('pad', { width: 0.75, height: 0.04, depth: 1.05 }, K.scene); pad.position.y = -0.02; pad.material = K.mat('#8cc068'); pad.parent = root;
      return root;
    });
  }
  function thumbImg(cls, k, src) { return '<img class="' + cls + '" alt="" data-th="' + k + '"' + (src ? ' src="' + src + '"' : '') + '>'; }

  function workText(cat, size) {
    var c = G.cats[cat];
    if (cat === 'res') { var f = c.families[size]; return '👥 ' + f + ' ' + plural(f, 'семья', 'семьи', 'семей'); }
    if (cat === 'saw') { var sp = G.sawmill[size]; return '🪵 ' + sp.use + ' → 🪚 ' + sp.boards + (sp.dsp ? ' + 🟫 ' + sp.dsp : '') + '/мин'; }
    if (cat === 'lumber') return '🪓 ' + G.lumber.jacks + ' ' + plural(G.lumber.jacks, 'лесоруб', 'лесоруба', 'лесорубов') + ' · ' + G.lumber.zone + '×' + G.lumber.zone;
    if (cat === 'quarry') return '⛏️ ' + G.quarry[size].stone + ' 🪨 камня/мин';
    if (cat === 'stonework') { var sw = G.stonework[size]; return '🪨 ' + sw.use + ' → ⚪ ' + sw.gravel + ' щебня/мин'; }
    if (cat === 'park' || cat === 'upark') { var ps = G.parkSpots[cat][size]; return '🅿️ ' + ps + ' ' + plural(ps, 'место', 'места', 'мест') + (cat === 'upark' ? '<span class="wl"> под землёй</span>' : ''); }
    var n = c.staff[size]; return '👷 ~' + n.toLocaleString('ru-RU') + '<span class="wl"> работают</span><span class="ws"> чел.</span>';
  }
  var buildFilter = 'all';
  function catLabel(f) {
    if (f === 'all') return { t: 'Все', c: '#c9d3e0' };
    if (G.cats[f]) return { t: G.cats[f].label, c: G.cats[f].tag };
    for (var i = 0; i < G.buildGroups.length; i++) if (G.buildGroups[i].id === f) return { t: G.buildGroups[i].label, c: G.buildGroups[i].tag };
    return { t: 'Все', c: '#c9d3e0' };
  }
  function catCount(f) { return filterCats(f).reduce(function (n, ck) { return n + catSizes(ck).length; }, 0); }
  function catItem(id) {
    var l = catLabel(id);
    return '<button class="chip' + (buildFilter === id ? ' on' : '') + '" data-cat="' + id + '" role="menuitem"><span class="sw" style="background:' + l.c + '"></span><span class="nm">' + l.t + '</span><em>' + catCount(id) + '</em></button>';
  }
  // Оформление: A / B / C / D (с 0.18.0)
  function themeChips(cur, act) {
    return G.themes.map(function (t, i) {
      return '<button class="chip' + (i === cur ? ' on' : '') + '" ' + act + '="' + i + '" title="' + esc(t.name + ', ' + t.era) + '"><b><span class="sw" style="background:' + t.color + '"></span>' + t.letter + '</b><small>' + esc(t.short) + '</small></button>';
    }).join('');
  }
  function renderStyleRow() {
    var t = G.themes[buildTheme];
    $('styleRow').innerHTML = '<span class="stl">Эпоха: <b>' + t.letter + ' · ' + esc(t.name) + '</b> · ' + esc(t.era) + '</span>' + themeChips(buildTheme, 'data-bth');
  }
  function renderChips() {
    $('catChips').innerHTML = catItem('all') + Object.keys(G.cats).filter(function (k) { return !G.cats[k].mech && !G.cats[k].group; }).map(catItem).join('') +
      G.buildGroups.map(function (g) { return catItem(g.id); }).join('');
    var cl = catLabel(buildFilter); $('catCur').textContent = cl.t; $('catSw').style.background = cl.c;
    $('roadChips').innerHTML = Object.keys(G.roads).map(function (k) {
      return '<button class="chip' + (k === roadType ? ' on' : '') + '" data-road="' + k + '"><span class="sw" style="background:' + G.roads[k].color + '"></span>' + G.roads[k].label + (state.env && G.roadCost[k] ? ' <em>' + G.roadCost[k].n + (G.roadCost[k].res === 'stone' ? '🪨' : '⚪') + '</em>' : '') + '</button>';
    }).join('');
    renderStyleRow();
    renderCards();
  }
  function renderCards() {
    var cats = filterCats(buildFilter), h = '';
    cats.forEach(function (ck) {
      var c = G.cats[ck];
      catSizes(ck).forEach(function (sk) {
        var on = ck === buildCat && sk === buildSize;
        h += '<button class="bcard' + (on ? ' on' : '') + '" data-cat="' + ck + '" data-size="' + sk + '">' + thumbImg('th', thumbKey(ck, sk), thumbUrl(ck, sk)) +
          '<span class="tx"><b>' + esc(c.names[sk]) + '</b><small>' + workText(ck, sk) + '</small>' +
          '<span class="sz"><i style="background:' + c.tag + '"></i>' + G.sizes[sk].label + ' · <em>' + usd(costOf(ck, sk)) + '</em></span></span></button>';
      });
    });
    $('bGrid').innerHTML = h;
    var sel = $('bGrid').querySelector('.bcard.on');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    fitGrid();
  }
  function secText(s) { if (s < 10) { var h = Math.max(0.5, Math.ceil(s * 2) / 2); return String(h).replace('.', ',') + ' с'; } s = Math.ceil(s); return s < 60 ? s + ' с' : Math.floor(s / 60) + ' мин ' + (s % 60 ? s % 60 + ' с' : ''); }
  function buildHint() {
    var n = state.brigades.length;
    if (!n) { hint(NO_BRIGADE, true); return; }
    hint('Строим: ' + G.cats[buildCat].names[buildSize] + ' (' + G.sizes[buildSize].label + ') · ' + usd(costOf(buildCat, buildSize)) +
      ' · ⏱ ~' + secText(G.buildTime[buildSize] / n) + ' (' + n + ' ' + plural(n, 'бригада', 'бригады', 'бригад') + ')');
  }
  function filterCats(f) {
    var all = Object.keys(G.cats);
    return f === 'all' ? all : f === 'mech' ? all.filter(function (k) { return G.cats[k].mech; }) :
      f === 'resrc' || f === 'stone' ? all.filter(function (k) { return G.cats[k].group === f; }) : [f];
  }
  // Меню категорий: кнопка «Категория» под главными кнопками, по нажатию открывается список (с 0.13.0)
  function catsOpen(on) {
    var l = $('catChips'); if (l.hidden === !on) return;
    l.hidden = !on; $('catBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  $('catBtn').addEventListener('click', function () { catsOpen($('catChips').hidden); });
  document.addEventListener('pointerdown', function (e) { if (!$('catChips').hidden && !e.target.closest('#catRow')) catsOpen(false); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('catChips').hidden) { catsOpen(false); e.stopPropagation(); } }); // Esc сначала закрывает список
  $('catChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    buildFilter = b.dataset.cat;
    var fc = filterCats(buildFilter), ch = false;
    if (fc.indexOf(buildCat) < 0) { buildCat = fc[0]; ch = true; }
    if (catSizes(buildCat).indexOf(buildSize) < 0) { buildSize = catSizes(buildCat)[0]; ch = true; }
    if (ch) { buildSeed = newSeed(); setGhost(buildCat, buildSize, buildSeed); buildHint(); }
    renderChips(); $('bGrid').scrollTop = 0; catsOpen(false);
  });
  // Кнопка «Построить» на странице «Механизмы» → «Здания»
  function startPlace(ck) {
    buildCat = ck; buildSize = catSizes(ck)[0]; buildFilter = 'mech'; buildSeed = newSeed();
    closeMech(); setTool('build'); renderChips(); catsOpen(false);
    if (state.brigades.length) hint('Поставьте «' + G.cats[ck].names[buildSize] + '» вплотную к дороге · ' + usd(costOf(ck, buildSize)));
  }
  $('bGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.bcard'); if (!b) return;
    buildCat = b.dataset.cat; buildSize = b.dataset.size; buildSeed = newSeed();
    $('bGrid').querySelectorAll('.bcard').forEach(function (x) { x.classList.toggle('on', x === b); });
    setGhost(buildCat, buildSize, buildSeed); buildHint();
  });
  $('styleRow').addEventListener('click', function (e) {
    var b = e.target.closest('[data-bth]'); if (!b) return;
    buildTheme = +b.dataset.bth; try { localStorage.setItem(THEME_KEY, String(buildTheme)); } catch (e2) {}
    renderStyleRow(); renderCards(); setGhost(buildCat, buildSize, buildSeed);
    if (lastHover && tool === 'build' && ghost && ghost.isEnabled()) buildGhostTo(lastHover);
    hint('Эпоха: ' + G.themes[buildTheme].name + ' · ' + G.themes[buildTheme].era);
  });
  $('roadChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-road]'); if (!b) return;
    roadType = b.dataset.road; renderChips();
  });
  function rotateCurrent() {
    if (moving) { moving.rot = (moving.rot + 1) % 4; if (lastHover) moveGhostTo(lastHover); return; }
    buildRot = (buildRot + 1) % 4;
    if (tool === 'build' && lastHover && ghost && ghost.isEnabled()) buildGhostTo(lastHover);
  }
  $('btnRotate').addEventListener('click', rotateCurrent);
  $('toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('.tool'); if (!b) return;
    if (b.dataset.tool === 'mech') openMech(); else if (b.dataset.tool === 'epochs') openEpochs(); else if (b.dataset.tool === 'home') centerCam(); else setTool(b.dataset.tool);
  });

  // --- действия ---
  var lastHover = null;
  function buildGhostTo(c) {
    var o = originFor(buildSize, buildRot, c);
    showGhostAt(buildSize, buildRot, o.x, o.z, canPlace(buildSize, buildRot, o.x, o.z, 0, buildCat) && state.brigades.length > 0);
    return o;
  }
  function placeBuilding(c) {
    if (!state.brigades.length) { hint(NO_BRIGADE, true); return; }
    var o = originFor(buildSize, buildRot, c), cost = costOf(buildCat, buildSize);
    var f0 = foot(buildSize, buildRot);
    if (inMap(o.x, o.z) && !ready4(o.x, o.z, f0.w, f0.d)) { hint('Эта часть карты ещё подгружается — подождите секунду', true); return; }
    if (!canPlace(buildSize, buildRot, o.x, o.z, 0, buildCat)) {
      var tp = inMap(o.x, o.z) ? terrainProblem(buildCat, buildSize, buildRot, o.x, o.z) : '';
      hint(tp ? terrainMsg(tp, buildCat, buildSize) : 'Здесь занято или край карты', true); return;
    }
    if (!canPay(cost)) { hint('Не хватает долларов: нужно ' + usd(cost), true); return; }
    pay(cost); clearArea(o.x, o.z, f0.w, f0.d);
    var b = { id: state.nextId++, cat: buildCat, size: buildSize, x: o.x, z: o.z, rot: buildRot, seed: buildSeed, th: buildTheme, prog: 0 };
    state.buildings.push(b); markOcc(b, b.id); touchB(b, true); addBuildingMesh(b);
    assignBrigades(); snd('place');
    buildSeed = newSeed(); setGhost(buildCat, buildSize, buildSeed);
    save(); updateStats(); renderMech(); dirty();
    var crew = siteCrew(b.id).all;
    var msg = crew ? '🏗️ Стройка началась: ' + G.cats[b.cat].names[b.size] : '🏗️ Стройка ждёт: все бригады заняты — купите ещё, чтобы быстрее';
    hint(hasRoad(b) ? msg : msg + '. 🛣️ Не забудьте дорогу — без неё здание не заработает');
  }
  // Смена оформления готового здания (с 0.18.0): бесплатно, без новой стройки
  function setBuildingTheme(b, th) {
    if (isSite(b) || !G.themes[th] || (b.th | 0) === th) return;
    b.th = th; touchB(b, true);
    if (moving && moving.b.id === b.id) cancelMove();
    removeBuildingMesh(b.id); addBuildingMesh(b);
    save(); dirty();
    if (infoId === b.id) renderInfo(b, true);
  }
  function deleteBuilding(b) {
    if (!allLoaded(b)) { hint('Эта часть карты ещё подгружается — подождите секунду', true); return; }
    if (undoLog) undoLog.push(['b', JSON.parse(JSON.stringify(b))]);
    touchB(b, true); markOcc(b, 0); removeBuildingMesh(b.id); delete byId[b.id]; snd('del');
    state.buildings.splice(state.buildings.indexOf(b), 1);
    if (infoId === b.id) closeInfo();
    if (isSite(b)) { assignBrigades(); renderMech(); }
    save(); updateStats(); dirty();
  }
  // Дорога делается из камня (с 0.21.0, в мирах с природой): булыжник — камень, асфальт — щебень, простая — бесплатно
  function roadCostOf(t) { var c = state.env && t && G.roadCost[t]; return c ? { res: c.res, n: c.n } : null; }
  function setRoad(x, z, t) {
    if (!inMap(x, z) || !loaded[ckOf(x, z)]) return;
    var k = key(x, z), pt = state.roads[k], pw = state.wear[k], paid = null;
    if (t) {
      if (occ[idx(x, z)] || pt === t) return;
      if (terr[idx(x, z)] === 2) { hint('⛰️ Через склон горы дорогу не проложить', true); return; }
      paid = roadCostOf(t);
      if (paid && state.stock[paid.res] < paid.n) {
        var rs = G.stock[paid.res];
        hint('Не хватает материала: ' + G.roadCost[t].n + ' ' + rs.icon + ' ' + rs.name.toLowerCase() + ' на клетку (' + G.roads[t].label.toLowerCase() + '). ' + (paid.res === 'stone' ? 'Добывайте камень: ⛏️ «Камень» → Каменоломня' : 'Щебень делают из камня: ⛏️ «Камень» → Камнеобработка') + '. Простая дорога бесплатна', true);
        return;
      }
      clearTree(x, z);
      if (paid) { state.stock[paid.res] -= paid.n; stockDirty = true; }
      state.roads[k] = t; delete state.wear[k];
      var tt = terr[idx(x, z)]; if (tt === 1 || tt === 3) dropBoulders(idx(x, z), x, z, tt);
    }
    else { if (!pt) return; delete state.roads[k]; delete state.wear[k]; }
    if (undoLog) undoLog.push(['r', k, pt, pw, paid]);
    snd(t ? 'road' : 'roadx');
    touchCell(x, z, true); refreshRoadAround(x, z); save(); statsSoon(); dirty();
  }
  function lineCells(a, b, fn) { // Брезенхэм
    var x0 = a.x, z0 = a.z, x1 = b.x, z1 = b.z, dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1, err = dx - dz;
    for (var guard = 0; guard < 500; guard++) {
      fn(x0, z0);
      if (x0 === x1 && z0 === z1) break;
      var e2 = 2 * err;
      if (e2 > -dz && e2 < dx) { // без диагональных шагов: дорога остаётся связной
        if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) { err -= dz; x0 += sx; } else { err += dx; z0 += sz; }
      } else {
        if (e2 > -dz) { err -= dz; x0 += sx; }
        if (e2 < dx) { err += dx; z0 += sz; }
      }
    }
  }
  function deleteAt(sx, sy, c) {
    if (c && inMap(c.x, c.z) && state.roads[key(c.x, c.z)]) { setRoad(c.x, c.z, null); return; }
    var b = pickBuilding(sx, sy); if (b) { deleteBuilding(b); return; }
    if (c && clearTree(c.x, c.z)) save();
  }

  function startMove(b, c) {
    if (!allLoaded(b)) { hint('Эта часть карты ещё подгружается — подождите секунду', true); return; }
    moving = { b: b, offX: c.px - b.x, offZ: c.pz - b.z, rot: b.rot, x: b.x, z: b.z };
    writeBuilding(b);
    setGhost(b.cat, b.size, b.seed, b.th | 0);
    moveGhostTo(c);
  }
  function moveGhostTo(c) {
    var f = foot(moving.b.size, moving.rot), fo = foot(moving.b.size, moving.b.rot);
    // центр захвата сохраняется при повороте
    var cx = c.px - moving.offX + fo.w / 2, cz = c.pz - moving.offZ + fo.d / 2;
    moving.x = clamp(Math.round(cx - f.w / 2), 0, N - f.w); moving.z = clamp(Math.round(cz - f.d / 2), 0, N - f.d);
    showGhostAt(moving.b.size, moving.rot, moving.x, moving.z, canPlace(moving.b.size, moving.rot, moving.x, moving.z, moving.b.id, moving.b.cat));
  }
  function finishMove() {
    var mv = moving, b = mv.b; moving = null;
    if (canPlace(b.size, mv.rot, mv.x, mv.z, b.id, b.cat)) {
      var fm = foot(b.size, mv.rot); clearArea(mv.x, mv.z, fm.w, fm.d);
      touchB(b, true); markOcc(b, 0); b.x = mv.x; b.z = mv.z; b.rot = mv.rot; markOcc(b, b.id); touchB(b, true);
      save(); updateStats(); snd('drop');
      if (!isSite(b) && !hasRoad(b)) hint('🛣️ Здесь нет дороги — здание не работает, пока её не подведёте', true);
    } else hint('Сюда нельзя — здание вернулось на место', true);
    writeBuilding(b);
    hideGhost();
  }
  function cancelMove() { if (!moving) return; var b = moving.b; moving = null; writeBuilding(b); hideGhost(); }

  // ---------- Указатель: мышь и касания ----------
  var ptrs = new Map(), gest = null;
  function centroid() { var a = Array.from(ptrs.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x) }; }
  function startPan(e, tap) { var p = groundAt(e.clientX, e.clientY); gest = { type: 'pan', grab: p, sx: e.clientX, sy: e.clientY, moved: false, tap: tap, t: Date.now() }; }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    canvas.focus();
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      cancelAction();
      var c = centroid();
      gest = { type: 'two', c: c, grab: groundAt(c.x, c.y), dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch };
      return;
    }
    if (ptrs.size > 2) return;
    var mouse = e.pointerType === 'mouse';
    if (mouse && e.button === 1) { gest = { type: 'rotate', lx: e.clientX, ly: e.clientY, acc: 0 }; return; }
    if (mouse && e.button === 2) { if (e.shiftKey) gest = { type: 'rotate', lx: e.clientX, ly: e.clientY, acc: 0 }; else startPan(e, false); return; }
    if (tool === 'view') { startPan(e, true); return; }
    var c2 = cellAt(e.clientX, e.clientY); if (!c2) return;
    gest = { type: 'action', sx: e.clientX, sy: e.clientY, t: Date.now(), touch: !mouse, last: c2 };
    if (tool === 'build') buildGhostTo(c2);
    else if (tool === 'road') { gest.log = undoLog = []; setRoad(c2.x, c2.z, roadType); }
    else if (tool === 'delete') { gest.log = undoLog = []; deleteAt(e.clientX, e.clientY, c2); }
    else if (tool === 'move') {
      var b = pickBuilding(e.clientX, e.clientY);
      if (b) startMove(b, c2); else startPan(e, false);
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var p = ptrs.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (!gest) { // наведение мышью
      if (e.pointerType !== 'mouse') return;
      var h = cellAt(e.clientX, e.clientY); lastHover = h; if (!h) return;
      if (tool === 'build') buildGhostTo(h);
      else if (tool === 'road') showCursor(h.x, h.z, G.roads[roadType].color === '#3c4047' ? '#ffffff' : '#ffe08a');
      else if (tool === 'delete') showCursor(h.x, h.z, '#ff3b30');
      return;
    }
    if (gest.type === 'two' && ptrs.size === 2) {
      var c = centroid();
      cam.dist = gest.dist * (gest.c.d / Math.max(c.d, 1));
      var da = c.ang - gest.c.ang; // поворот двумя пальцами — щелчком на 90°
      if (Math.abs(da) > 0.6) { rotateCam(da > 0 ? -1 : 1); gest.c.ang = c.ang; }
      updateCam();
      var g2 = groundAt(c.x, c.y);
      if (g2 && gest.grab) { cam.tx -= g2.x - gest.grab.x; cam.tz -= g2.z - gest.grab.z; updateCam(); }
      return;
    }
    if (gest.type === 'rotate') { // средняя кнопка или Shift + правая: карта щёлкает на 90°
      gest.acc += e.clientX - gest.lx; gest.lx = e.clientX;
      if (Math.abs(gest.acc) > 80) { rotateCam(gest.acc > 0 ? -1 : 1); gest.acc = 0; }
      return;
    }
    if (gest.type === 'pan') {
      if (Math.hypot(e.clientX - gest.sx, e.clientY - gest.sy) > 6) gest.moved = true;
      if (!gest.moved || !gest.grab) return;
      var g = groundAt(e.clientX, e.clientY);
      if (g) { cam.tx -= g.x - gest.grab.x; cam.tz -= g.z - gest.grab.z; updateCam(); }
      return;
    }
    if (gest.type === 'action') {
      var cl = cellAt(e.clientX, e.clientY); if (!cl) return; lastHover = cl;
      if (tool === 'build') buildGhostTo(cl);
      else if (tool === 'move' && moving) moveGhostTo(cl);
      else if (tool === 'road') { lineCells(gest.last, cl, function (x, z) { setRoad(x, z, roadType); }); showCursor(cl.x, cl.z, '#ffffff'); }
      else if (tool === 'delete') {
        lineCells(gest.last, cl, function (x, z) { if (inMap(x, z) && state.roads[key(x, z)]) setRoad(x, z, null); else if (inMap(x, z) && treeA[idx(x, z)] && !occ[idx(x, z)] && clearTree(x, z)) save(); });
        if (cl.x !== gest.last.x || cl.z !== gest.last.z) { var bb = pickBuilding(e.clientX, e.clientY); if (bb) deleteBuilding(bb); }
        showCursor(cl.x, cl.z, '#ff3b30');
      }
      gest.last = cl;
    }
  });

  function endPointer(e) {
    ptrs.delete(e.pointerId);
    if (!gest) return;
    if (gest.type === 'two') { if (ptrs.size === 0) gest = null; return; }
    if (ptrs.size > 0) return;
    var g = gest; gest = null; undoLog = null;
    if (e.type === 'pointercancel') { cancelAction(g); return; }
    if (g.type === 'pan' && g.tap && !g.moved) {
      var b = pickBuilding(e.clientX, e.clientY);
      if (b) openInfo(b);
      else {
        var rc = cellAt(e.clientX, e.clientY), mt = pickMountain(e.clientX, e.clientY);
        if (!mt && rc && inMap(rc.x, rc.z) && state.roads[key(rc.x, rc.z)]) openRoadInfo(rc.x, rc.z);
        else { closeInfo(); var tt = mt ? terrainText(Math.floor(mt.cx), Math.floor(mt.cz)) : rc ? terrainText(rc.x, rc.z) : ''; if (mt) tt = '🏔️ Гора со снежной вершиной. Склон не застроить и не пересечь дорогой. Камень добывают у подножия — Горный карьер: ⛏️ «Камень»'; if (tt) hint(tt); }
      }
      return;
    }
    if (g.type === 'action') {
      var c = cellAt(e.clientX, e.clientY) || g.last;
      if (tool === 'build') { placeBuilding(c); if (g.touch) hideGhost(); else buildGhostTo(c); }
      else if (tool === 'move' && moving) finishMove();
      if (g.touch) { cursor.setEnabled(false); dirty(); }
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !gest) { if (!moving) hideGhost(); cursor.setEnabled(false); dirty(); } });

  var undoLog = null;
  function undoOps(log) { // вернуть дороги и здания, тронутые случайным жестом (журнал, а не снимок всего города)
    for (var i = log.length - 1; i >= 0; i--) {
      var o = log[i];
      if (o[0] === 'r') {
        var k = o[1], p = k.split(',');
        if (o[2]) state.roads[k] = o[2]; else delete state.roads[k];
        if (o[3]) state.wear[k] = o[3]; else delete state.wear[k];
        if (o[4]) { state.stock[o[4].res] += o[4].n; stockDirty = true; } // камень, потраченный на случайную дорогу, возвращается
        touchCk(ckOfKey(k), true); refreshRoadAround(+p[0], +p[1]);
      } else if (o[0] === 't') {
        restoreTree(o[1], o[2], o[3]);
      } else if (!byId[o[1].id]) {
        var b = o[1]; state.buildings.push(b); markOcc(b, b.id); touchB(b, true); addBuildingMesh(b);
      }
    }
    assignBrigades(); updateStats(); save(); dirty();
  }
  function cancelAction(g) {
    g = g || gest;
    if (!g || g.type !== 'action') return;
    if (tool === 'build') hideGhost();
    if (tool === 'move') cancelMove();
    // второй палец быстро после первого — отменить случайную дорогу/удаление
    if (g.touch && Date.now() - g.t < 450) {
      if (g.log) undoOps(g.log);
    }
    undoLog = null;
    cursor.setEnabled(false); gest = null; dirty();
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var before = groundAt(e.clientX, e.clientY);
    cam.dist *= Math.exp(e.deltaY * 0.0012); updateCam();
    var after = groundAt(e.clientX, e.clientY);
    if (before && after) { cam.tx -= after.x - before.x; cam.tz -= after.z - before.z; updateCam(); }
  }, { passive: false });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === 'q' || k === 'й') rotateCam(1);
    else if (k === 'e' || k === 'у') rotateCam(-1);
    else if (k === 'r' || k === 'к') rotateCurrent();
    else if (k === 'escape') { if (sideOpen) closeSide(); else if (!$('modal').hidden) closeModal(); else if (!$('mech').hidden) closeMech(); else if (!$('epochs').hidden) closeEpochs(); else { closeInfo(); setTool('view'); } }
    else if (k === '6') openMech();
    else if (k === '7') openEpochs();
    else if (k === '8') centerCam();
    else if ('12345'.indexOf(k) >= 0 && k) setTool(['view', 'build', 'road', 'move', 'delete'][+k - 1]);
    else if (k === '+' || k === '=') { cam.dist /= 1.2; updateCam(); }
    else if (k === '-') { cam.dist *= 1.2; updateCam(); }
    keys[k] = true;
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { keys = {}; });
  function keyPan(dt) {
    if (!$('mech').hidden || !$('epochs').hidden) return;
    var f = 0, s = 0;
    if (keys.w || keys['ц'] || keys.arrowup) f += 1;
    if (keys.s || keys['ы'] || keys.arrowdown) f -= 1;
    if (keys.d || keys['в'] || keys.arrowright) s += 1;
    if (keys.a || keys['ф'] || keys.arrowleft) s -= 1;
    if (!f && !s) return;
    var sp = cam.dist * 0.9 * dt, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    cam.tx += (-sy * f + cy * s) * sp; cam.tz += (-cy * f - sy * s) * sp; updateCam();
  }

  $('camRotL').addEventListener('click', function () { rotateCam(1); });
  $('camRotR').addEventListener('click', function () { rotateCam(-1); });
  $('camIn').addEventListener('click', function () { cam.dist /= 1.25; updateCam(); });
  $('camOut').addEventListener('click', function () { cam.dist *= 1.25; updateCam(); });

  // ---------- Страница «Эпохи» (с 0.19.0) ----------
  // Четыре карточки: миниатюра, годы, рассказ о времени, стилистика и что это значит в игре.
  // «Строить в этой эпохе» — выбор эпохи для новых зданий; «Весь город в эту эпоху» — перекрасить уже построенные (нажать дважды).
  var epochArm = -1;
  function openEpochs() {
    closeInfo(); if (moving) cancelMove(); closeSide && sideOpen && closeSide(); epochArm = -1;
    $('epochs').hidden = false;
    document.querySelector('.tool.epochs').classList.add('open');
    renderEpochs(); $('epochsBody').scrollTop = 0;
  }
  function closeEpochs() { $('epochs').hidden = true; document.querySelector('.tool.epochs').classList.remove('open'); epochArm = -1; }
  function renderEpochs() {
    if ($('epochs').hidden) return;
    var cnt = G.themes.map(function () { return 0; }), done = 0;
    state.buildings.forEach(function (b) { if (!isSite(b)) { cnt[b.th | 0]++; done++; } });
    var h = '<p class="note epnote">Четыре эпохи архитектуры Европы начала XX века. Любое здание можно построить в любой из них: у каждой свои крыши, окна, цвета и детали.</p>';
    G.themes.forEach(function (t, i) {
      var cur = i === buildTheme, other = done - cnt[i], arm = epochArm === i;
      h += '<div class="epc' + (cur ? ' on' : '') + '" style="--ec:' + t.color + '">' +
        '<div class="epc-top">' + thumbImg('epc-img', thumbKey('res', '2x2', i), thumbUrl('res', '2x2', i)) +
        '<div class="epc-hd"><h3><span class="epc-let">' + t.letter + '</span>' + esc(t.name) + '</h3><div class="epc-era">' + t.icon + ' ' + esc(t.era) + '</div>' +
        '<div class="epc-ab">' + esc(t.about) + '</div></div></div>' +
        '<div class="epc-sec"><b>🕰️ О времени</b><p>' + esc(t.time) + '</p></div>' +
        '<div class="epc-sec"><b>🏛️ Стилистика</b><p>' + esc(t.look) + '</p></div>' +
        '<div class="epc-sec"><b>🎮 В игре</b><p>' + esc(t.game) + '</p></div>' +
        '<div class="epc-cnt">В городе в этой эпохе: <b>' + cnt[i] + '</b> ' + plural(cnt[i], 'здание', 'здания', 'зданий') + (cur ? ' · выбрана для новых построек' : '') + '</div>' +
        '<div class="epc-btns"><button class="btn-buy" data-ep="use" data-th="' + i + '">' + (cur ? '✔ Строить в этой эпохе' : 'Строить в этой эпохе') + '</button>' +
        '<button class="btn-sell' + (arm ? ' arm' : '') + '" data-ep="all" data-th="' + i + '"' + (other ? '' : ' disabled') + '>' +
        (arm ? 'Точно? Нажмите ещё раз (' + other + ')' : other ? 'Весь город в эту эпоху (' + other + ')' : 'Весь город уже в этой эпохе') + '</button></div></div>';
    });
    var sc = $('epochsBody').scrollTop;
    $('epochsBody').innerHTML = h; $('epochsBody').scrollTop = sc;
  }
  function epochAct(act, th) {
    var t = G.themes[th]; if (!t) return;
    if (act === 'use') {
      buildTheme = th; try { localStorage.setItem(THEME_KEY, String(th)); } catch (e) {}
      renderStyleRow(); renderCards(); setGhost(buildCat, buildSize, buildSeed);
      closeEpochs(); setTool('build');
      hint('Эпоха для новых зданий: ' + t.name + ' · ' + t.era);
    } else if (act === 'all') {
      if (epochArm !== th) { epochArm = th; renderEpochs(); return; }
      epochArm = -1; var n = 0;
      state.buildings.slice().forEach(function (b) { if (!isSite(b) && (b.th | 0) !== th) { setBuildingTheme(b, th); n++; } });
      renderEpochs(); hint('Весь город — эпоха «' + t.name + '»: ' + n + ' ' + plural(n, 'здание', 'здания', 'зданий'));
    }
  }
  $('epochsClose').addEventListener('click', closeEpochs);
  $('epochs').addEventListener('click', function (e) {
    if (e.target === $('epochs')) { closeEpochs(); return; }
    var b = e.target.closest('[data-ep]'); if (b && !b.disabled) epochAct(b.dataset.ep, +b.dataset.th);
  });

  // ---------- Страница «Механизмы» ----------
  var mechTab = 'build';
  function openMech(tab) {
    if (tab) mechTab = tab;
    closeInfo(); if (moving) cancelMove();
    $('mech').hidden = false;
    document.querySelector('.tool.mech').classList.add('open');
    $('mechTabs').innerHTML = G.mechTabs.map(function (t) { return '<button class="tab' + (t.id === mechTab ? ' on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>'; }).join('');
    $('mechBody').innerHTML = mechTab === 'plants' ? plantsHtml() : mechTab === 'cars' ? carsHtml() : brigadeHtml();
    $('mechBody').scrollTop = 0;
    renderMech();
  }
  function brigadeHtml() {
    var h = '';
    Object.keys(G.units).forEach(function (k) {
      var u = G.units[k]; if (u.tab !== 'build') return;
      h += '<div class="unit">' + (k === 'brigade' ? thumbImg('uimg', 'truck', truckThumb()) : '<span class="uimg"></span>') +
        '<div class="uinfo"><h3>' + esc(u.name) + '</h3><p>' + esc(u.about) + '</p>' +
        '<div class="ukv"><span>Цена</span><span class="usd">' + usd(u.price) + ' · на заводе ' + usd(u.factoryPrice) + '</span>' +
        '<span>В парке</span><span><b id="mHave">0</b></span>' +
        '<span>Сейчас строят</span><span id="mBusy">—</span>' +
        '<span>Скорость</span><span id="mSpeed">—</span>' +
        '<span>Заказ на заводе</span><span id="mFq">—</span></div></div></div>' +
        '<div class="ubtns wrap"><button class="btn-buy" data-act="buy" id="mBuy">Купить за ' + usd(u.price) + '</button>' +
        '<button class="btn-buy alt" data-act="order" id="mOrder">🏭 Заказать на заводе · ' + usd(u.factoryPrice) + '</button>' +
        '<button class="btn-sell" data-act="sell" id="mSell">Продать</button></div>' +
        '<div class="unote" id="mBuyNote"></div>';
    });
    h += '<h4>Стройки</h4><div id="mSites"></div>' +
      '<p class="note">Как это работает: без бригады строить нельзя. Поставьте здание — бригада приедет, поставит кран и леса, и дом начнёт расти этаж за этажом. ' +
      'Бригады делятся между стройками поровну; две бригады на одном доме строят вдвое быстрее. Без завода можно привезти только ' + G.units.brigade.importMax +
      ' бригады — остальные собирает Механический завод (🏭 Здания). Деньги пока бесконечные (∞), продажа возвращает половину цены.</p>';
    return h;
  }
  function plantsHtml() {
    var u = G.units.brigade, R = G.repair, W = G.wear;
    function card(ck) {
      var c = G.cats[ck], sz = catSizes(ck)[0];
      return '<div class="unit">' + thumbImg('uimg', ck + sz, thumbUrl(ck, sz)) +
        '<div class="uinfo"><h3>' + esc(c.names[sz]) + '</h3><p>' + esc(c.about[sz]) + '</p>' +
        '<div class="ukv"><span>Размер</span><span>' + G.sizes[sz].label + '</span>' +
        '<span>Цена</span><span class="usd">' + usd(costOf(ck, sz)) + '</span>' +
        '<span>Работников</span><span>~' + c.staff[sz] + '</span>' +
        '<span>Стройка</span><span>' + secText(G.buildTime[sz]) + ' одной бригадой</span>' +
        '<span>На карте</span><span id="mCnt_' + ck + '">—</span></div></div></div>' +
        '<div class="ubtns"><button class="btn-buy" data-act="place" data-cat="' + ck + '">🏗️ Построить</button></div>';
    }
    return card('factory') +
      '<div class="pbox"><b>🏭 Выпуск машин</b>' +
      '<div class="ukv"><span>Очередь завода</span><span id="mFqAll">—</span><span>«Бригада»</span><span class="usd">' + usd(u.factoryPrice) + '</span>' +
      '<span>Время</span><span>' + secText(u.makeTime) + ' на грузовик; грузовики выходят по очереди, число заводов скорость не меняет</span></div>' +
      '<div class="ubtns wrap"><button class="btn-buy alt" data-act="order">🚚 Заказать «Бригаду»</button><button class="btn-sell" data-act="cancel" id="mCancel">Отменить</button>' +
      '<button class="btn-buy" data-act="cars">🚗 Машины города</button></div>' +
      '<div class="unote">Завод собирает только «Бригады». Скорая, полиция, мусоровоз и другие машины появляются сами вместе со зданиями.</div></div>' +
      card('depot') +
      '<div class="pbox"><b>🛠️ Ремонт дорог</b>' +
      '<div class="ukv"><span>Асфальт</span><span id="mRs">—</span><span>Средний износ</span><span id="mMid">0</span><span>Почти изношен</span><span id="mWorn">0</span>' +
      '<span>Очередь ремонта</span><span id="mQ">—</span><span>Каток</span><span id="mRoller">—</span></div>' +
      '<button class="btn-buy wide" data-act="repair" id="mRep">🛠️ Отремонтировать изношенные</button>' +
      '<button class="btn-tog" data-act="auto" id="mAuto">' + autoLabel() + '</button></div>' +
      '<p class="note">Асфальт изнашивается со временем — у работающих зданий быстрее: средний износ с ' + pctText(W.mid) + ' (трещины), почти изношен с ' + pctText(W.worn) +
      ' (ямы и заплатки), при 100% асфальт разбит и становится простой дорогой. Ремонт клетки стоит до ' + usd(R.full) + ' (зависит от износа). ' +
      'Кнопка «Отремонтировать изношенные» отправляет в ремонт всё с износом от ' + pctText(R.manualAt) + '; автоматический ремонт сам чинит клетки с износом от ' + pctText(R.autoAt) + '. Простая дорога не изнашивается.</p>';
  }
  function carsHtml() {
    var h = '<div class="pbox"><b>🚗 Машины города</b>' +
      '<div class="unote">Машины разных профессий <b>появляются сами вместе со зданиями</b>: достроили больницу — приехала скорая, построили депо — появился самосвал. Купить их нельзя — покупается только «Бригада» (🚚 «Строительство»).</div></div>';
    Object.keys(G.vehicles).forEach(function (k) {
      var v = G.vehicles[k], per = Object.keys(v.per).map(function (sz) { return G.sizes[sz].label + ' — ' + String(v.per[sz]).replace('.', ','); }).join(', ');
      h += '<div class="unit">' + thumbImg('uimg', 'veh_' + k, vehicleThumb(k)) +
        '<div class="uinfo"><h3>' + v.icon + ' ' + esc(v.name) + '</h3><p>' + esc(v.about) + '</p>' +
        '<div class="ukv"><span>Обслуживает</span><span>' + esc(G.cats[v.serves].one) + ' · <span id="mVw_' + k + '">—</span></span>' +
        '<span>Приходит с работающим зданием</span><span>' + per + '</span>' +
        '<span>В городе</span><span><b id="mVn_' + k + '">0</b></span></div></div></div>';
    });
    h += '<h4>🚗 Легковые машины жителей</h4>';
    G.cars.models.forEach(function (m) {
      h += '<div class="unit">' + thumbImg('uimg', 'car_' + m.id, vehicleThumb(m.id, true)) +
        '<div class="uinfo"><h3>' + esc(m.name) + '</h3><p>Появляется сама у жилых домов с дорогой. Ездит к работе, магазинам и школам и возвращается домой.</p></div></div>';
    });
    var P = G.cars.perHouse;
    h += '<p class="note">Сейчас легковых машин в городе: <b id="mCarsN">0</b>. У частного дома и дома на две семьи — ' + P['1x1'] + ' машина, у многоквартирного — ' + P['2x2'] +
      ', у жилого комплекса — ' + P['4x4'] + '. Машины ездят только по дорогам, по правой полосе. Служебная машина ездит между работающими зданиями своего вида; если таких нет — стоит и ждёт. ' +
      'Доли машин складываются и округляются вверх: у первого работающего здания вида машина есть всегда.</p>';
    return h;
  }
  function closeMech() { $('mech').hidden = true; document.querySelector('.tool.mech').classList.remove('open'); }
  function renderMech() {
    if ($('mech').hidden) return;
    if (mechTab === 'cars') { refreshLive(); return; }
    if (mechTab === 'plants') {
      ['factory', 'depot'].forEach(function (ck) {
        var e = $('mCnt_' + ck); if (!e) return;
        var all = state.buildings.filter(function (b) { return b.cat === ck; }), wk = all.filter(isWorking).length, st = all.filter(isSite).length;
        var t = all.length ? all.length + ' шт.' + (wk ? ', работает ' + wk : '') + (st ? ', строится ' + st : '') + (all.length - wk - st ? ', <span class="bad">без дороги ' + (all.length - wk - st) + '</span>' : '') : 'нет';
        if (e.innerHTML !== t) e.innerHTML = t;
      });
      refreshLive();
      return;
    }
    if (!$('mHave')) return;
    var n = state.brigades.length, busy = 0, u = G.units.brigade, nf = working('factory').length;
    state.brigades.forEach(function (br) { if (br.site) busy++; });
    $('mHave').textContent = n;
    $('mBusy').textContent = n ? busy + ' из ' + n : 'нет бригад';
    $('mSpeed').textContent = n ? 'одна стройка — до ×' + n : 'стройка невозможна';
    $('mSell').disabled = !n;
    $('mBuy').disabled = n >= u.importMax;
    $('mOrder').disabled = !nf;
    var note = n >= u.importMax ? 'Привезти из другого города можно только ' + u.importMax + ' бригады. ' : '';
    note += nf ? '🏭 Завод работает: грузовик ' + usd(u.factoryPrice) + ', ' + secText(u.makeTime) + '.' : noFactoryMsg().replace('🏭 ', '🏭 Чтобы собирать свои грузовики: ') + '.';
    if ($('mBuyNote').textContent !== note) $('mBuyNote').textContent = note;
    refreshLive();
    var S = state.buildings.filter(isSite), h = '';
    S.forEach(function (b) {
      var crew = siteCrew(b.id), left = (1 - b.prog) * buildTime(b) / Math.max(1, crew.all), pct = Math.floor(b.prog * 100);
      h += '<div class="site-row"><div class="sr-top"><b>' + esc(G.cats[b.cat].names[b.size]) + '</b><span>' + esc(STAGES[stageOf(b.prog)].name.toLowerCase()) + ' · ' + pct + '%</span></div>' +
        '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
        '<div style="font-size:13px;color:#a9b6c8;margin:-4px 0 8px">' + (crew.all ? '🚚 ' + crew.all + ' ' + plural(crew.all, 'бригада', 'бригады', 'бригад') +
          (crew.here < crew.all ? ' (едут: ' + (crew.all - crew.here) + ')' : '') + ' · осталось ≈ ' + secText(left) : '<span class="wait">ждёт свободную бригаду</span>') + '</div></div>';
    });
    h = h || '<div class="empty">Сейчас ничего не строится.</div>';
    if ($('mSites').innerHTML !== h) $('mSites').innerHTML = h;
  }
  function mechAct(a, el) {
    if (a === 'buy') buyBrigade(); else if (a === 'sell') sellBrigade();
    else if (a === 'order') orderTruck(); else if (a === 'cancel') cancelOrder();
    else if (a === 'place') startPlace(el.dataset.cat);
    else if (a === 'repair') repairAllAct(); else if (a === 'auto') toggleAuto();
    else if (a === 'fixone' && infoRoad) repairOneAct(infoRoad);
    else if (a === 'cars') { openMech('cars'); return; }
    else if (a === 'style') { var sb = getB(infoId); if (sb) setBuildingTheme(sb, +el.dataset.th); return; }
    renderMech();
  }
  $('mechClose').addEventListener('click', closeMech);
  $('mech').addEventListener('click', function (e) {
    if (e.target === $('mech')) { closeMech(); return; }
    var t = e.target.closest('[data-tab]'); if (t) { openMech(t.dataset.tab); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    mechAct(a.dataset.act, a);
  });
  $('infoBody').addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) return;
    mechAct(a.dataset.act, a);
  });

  // ---------- Жители и сотрудники ----------
  var P = G.people;
  function person(r, male, sur, ageMin, ageMax) {
    var age = rint(r, ageMin, ageMax);
    var job = age < 7 ? 'дошкольник' : age < 18 ? 'школьник' : age < 22 && r() < 0.6 ? 'студент' : age >= 63 ? 'пенсионер' : pick(r, P.jobs);
    return { name: (male ? pick(r, P.male) : pick(r, P.female)) + ' ' + (male ? sur[0] : sur[1]), age: age, job: job, m: male };
  }
  function ageWord(n) { var a = n % 10, b = n % 100; return n + ' ' + (b >= 11 && b <= 14 ? 'лет' : a === 1 ? 'год' : a >= 2 && a <= 4 ? 'года' : 'лет'); }
  function canWork(m) { return m.age >= 18 && m.age < 63 && m.job !== 'студент'; }
  var resCache = {};
  function residents(b) {
    var ck = b.id + ':' + b.seed; if (resCache[ck]) return resCache[ck];
    var r = rng(b.seed ^ 0x5bd1e995), nf = G.cats.res.families[b.size], fams = [], total = 0, adults = 0;
    for (var i = 0; i < nf; i++) {
      var sur = pick(r, P.surnames), roll = r(), mem = [], male = r() < 0.5;
      if (roll < 0.18) mem.push(person(r, male, sur, 20, 80));
      else if (roll < 0.4) { mem.push(person(r, true, sur, 24, 60)); mem.push(person(r, false, sur, 22, 58)); }
      else if (roll < 0.88) {
        var pa = person(r, true, sur, 28, 50); mem.push(pa); mem.push(person(r, false, sur, 26, 48));
        var kids = rint(r, 1, 3);
        for (var k = 0; k < kids; k++) mem.push(person(r, r() < 0.5, sur, 1, Math.min(20, pa.age - 20)));
      } else { mem.push(person(r, true, sur, 63, 85)); mem.push(person(r, false, sur, 61, 83)); }
      var fam = { surname: sur, members: mem, pet: r() < 0.35 ? pick(r, P.pets) : null, flat: b.size === '2x2' || b.size === '4x4' ? String(i + 1) : null };
      total += mem.length; mem.forEach(function (m) { if (canWork(m)) adults++; }); fams.push(fam);
    }
    return (resCache[ck] = { families: fams, total: total, adults: adults });
  }
  var workCache = {};
  function workplace(b) {
    var ck = b.id + ':' + b.seed; if (workCache[ck]) return workCache[ck];
    var c = G.cats[b.cat], r = rng(b.seed ^ 0x27d4eb2f);
    var staff = Math.max(2, Math.round(c.staff[b.size] * (0.85 + r() * 0.3)));
    var sur = pick(r, P.surnames), male = r() < 0.55;
    var head = (male ? pick(r, P.male) : pick(r, P.female)) + ' ' + (male ? sur[0] : sur[1]);
    var team = [];
    for (var i = 0; i < Math.min(4, staff - 1); i++) {
      var s2 = pick(r, P.surnames), m2 = r() < 0.5;
      team.push({ name: (m2 ? pick(r, P.male) : pick(r, P.female)) + ' ' + (m2 ? s2[0] : s2[1]), role: pick(r, c.roles), age: rint(r, 20, 60) });
    }
    var vn = c.visitN[b.size];
    var res = { staff: staff, head: head, team: team, visits: rint(r, vn[0], vn[1]), company: c.company ? pick(r, c.company) : null };
    return (workCache[ck] = res);
  }
  function address(b) { return G.streets[Math.floor(b.z / 4) % G.streets.length] + ', ' + (b.x + 1); }
  // Правило (с 0.8.0): здание работает, только если к нему подведена дорога — любая.
  // Дорога должна касаться стороны здания; клетка наискосок от угла не считается.
  function roadsAt(sz, rot, bx, bz) {
    var f = foot(sz, rot), seen = {};
    for (var x = bx - 1; x <= bx + f.w; x++) for (var z = bz - 1; z <= bz + f.d; z++) {
      var onEdge = x === bx - 1 || x === bx + f.w || z === bz - 1 || z === bz + f.d;
      var corner = (x === bx - 1 || x === bx + f.w) && (z === bz - 1 || z === bz + f.d);
      if (onEdge && !corner) { var t = state.roads[key(x, z)]; if (t) seen[t] = 1; }
    }
    return seen;
  }
  function hasRoad(b) { var s = roadsAt(b.size, b.rot, b.x, b.z); return !!(s.asphalt || s.dirt || s.cobble); }
  function isWorking(b) { return !isSite(b) && hasRoad(b); }
  function roadNear(b) {
    var seen = roadsAt(b.size, b.rot, b.x, b.z);
    var nm = [];
    if (seen.asphalt) nm.push('асфальт'); if (seen.cobble) nm.push('булыжник'); if (seen.dirt) nm.push('простая');
    return nm.length ? nm.join(' и ') : '<span class="bad">нет</span>';
  }

  // ---------- Расчёт жителей в фоне (js/sim.js) ----------
  var sim = { people: 0, adults: 0, employed: 0, unemployed: 0, jobs: 0, freeJobs: 0, home: {}, work: {}, ms: 0, ready: false };
  var simTimer = 0;
  function simRequest() {
    clearTimeout(simTimer);
    simTimer = setTimeout(function () {
      var homes = [], works = [];
      state.buildings.forEach(function (b) {
        if (!isWorking(b)) return; // без дороги здание не работает
        var c = siteCenter(b);
        if (b.cat === 'res') { var R = residents(b); homes.push([b.id, c.x, c.z, R.adults, R.total]); }
        else works.push([b.id, c.x, c.z, workplace(b).staff]);
      });
      window.SIM.run({ homes: homes, works: works });
    }, 200);
  }
  window.SIM.onResult(function (r) {
    sim.people = r.people; sim.adults = r.adults; sim.employed = r.employed; sim.unemployed = r.unemployed;
    sim.jobs = r.jobs; sim.freeJobs = r.freeJobs; sim.ms = r.ms; sim.ready = true;
    sim.home = {}; sim.work = {};
    r.homes.forEach(function (h) { sim.home[h[0]] = h[1]; });
    r.works.forEach(function (w) { sim.work[w[0]] = w[1]; });
    $('stJobsWrap').title = 'Рабочие места: ' + r.jobs.toLocaleString('ru-RU') + ', занято ' + r.employed.toLocaleString('ru-RU') + ', без работы ' + r.unemployed.toLocaleString('ru-RU');
    if (infoId) { var ib = getB(infoId); if (ib) renderInfo(ib, true); }
  });

  // ---------- Справка о здании ----------
  var infoId = 0;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function openInfo(b) { renderInfo(b, false); }
  function renderInfo(b, keepScroll) {
    infoId = b.id; infoRoad = '';
    var c = G.cats[b.cat], name = c.names[b.size], h = '';
    h += '<h2>' + esc(name) + '</h2>';
    h += '<div class="sub"><span class="tag" style="background:' + c.tag + '">' + esc(c.label) + '</span>' + esc(address(b)) + ' · ' + G.sizes[b.size].label + '</div>';
    if (!isSite(b)) var bt0 = G.themes[b.th | 0]; h += '<div class="strow info"><span class="stl">Эпоха: <b>' + bt0.letter + ' · ' + esc(bt0.name) + '</b> · ' + esc(bt0.era) + ' — сменить можно бесплатно</span>' + themeChips(b.th | 0, 'data-act="style" data-th') + '</div>';
    if (isSite(b)) {
      var crew = siteCrew(b.id), pct = Math.floor(b.prog * 100), left = (1 - b.prog) * buildTime(b) / Math.max(1, crew.all);
      var sg = stageOf(b.prog);
      h += '<div class="build-now">🏗️ Идёт стройка — ' + pct + '%</div><div class="pbar"><i style="width:' + pct + '%"></i></div>';
      h += '<ol class="stages">' + STAGES.map(function (x, i) {
        return '<li class="' + (i < sg ? 'done' : i === sg ? 'now' : '') + '"><b>' + (i < sg ? '✓ ' : '') + esc(x.name) + '</b>' + (i === sg ? '<small>' + esc(x.about) + '</small>' : '') + '</li>';
      }).join('') + '</ol>';
      h += '<div class="kv"><span>Бригады</span><span>' + (crew.all ? crew.all + (crew.here < crew.all ? ' (в пути ' + (crew.all - crew.here) + ')' : ' на месте') : state.brigades.length ? 'ждёт свободную' : 'нет — купите в «Механизмы»') + '</span>' +
        (crew.all ? '<span>Осталось</span><span>≈ ' + secText(left) + '</span>' : '') +
        '<span>Цена</span><span>' + usd(costOf(b.cat, b.size)) + '</span>' +
        '<span>После стройки</span><span>' + (b.cat === 'res' ? 'заедут ' + c.families[b.size] + ' ' + plural(c.families[b.size], 'семья', 'семьи', 'семей') : 'работа для ~' + c.staff[b.size] + ' чел.') + '</span>' +
        '<span>Дорога рядом</span><span>' + roadNear(b) + '</span></div>';
      if (!hasRoad(b)) h += '<div class="noroad">🛣️ К стройке нет дороги. Достроить можно, но работать здание начнёт, только когда к нему подведут дорогу.</div>';
    } else if (!hasRoad(b)) {
      h += '<div class="noroad"><b>⛔ Не работает — нет дороги</b>Подведите к зданию любую дорогу (асфальт, булыжник или простую): она должна касаться его стороны. ' +
        (b.cat === 'res' ? 'Тогда заедут ' + c.families[b.size] + ' ' + plural(c.families[b.size], 'семья', 'семьи', 'семей') + '.' : 'Тогда откроется ' + workplace(b).staff + ' рабочих мест.') + '</div>';
      if (b.cat !== 'res') h += '<div class="about">' + esc(c.about[b.size]) + '</div>';
      h += '<div class="kv"><span>Дорога рядом</span><span>' + roadNear(b) + '</span>' +
        (b.cat === 'res' ? '<span>Живут</span><span>никого — дом пустой</span>' : '<span>Работают</span><span>никто — закрыто</span>') + '</div>';
    } else if (b.cat === 'res') {
      var R = residents(b), emp = sim.home[b.id];
      h += '<div class="kv"><span>Живут</span><span><b>' + R.total + '</b> чел., ' + R.families.length + ' ' + plural(R.families.length, 'семья', 'семьи', 'семей') + '</span>' +
        '<span>Работают</span><span>' + (emp === undefined ? '…считаем' : emp + ' из ' + R.adults + ' взрослых' + (emp < R.adults ? ' — ' + (R.adults - emp) + ' ищут работу' : '')) + '</span>' +
        '<span>Машины жильцов</span><span>🚗 ' + carCount(b.id) + '</span>' +
        '<span>Мусоровозы в городе</span><span>' + vehCount('garbage') + '</span>' +
        '<span>Дорога рядом</span><span>' + roadNear(b) + '</span></div>';
      var show = R.families.slice(0, 8);
      show.forEach(function (f) {
        var adults = f.members.length;
        h += '<div class="fam"><b>' + (f.flat ? 'Кв. ' + f.flat + ' — ' : '') + (adults > 1 ? 'Семья ' + esc(famName(f.surname[0])) : ('Живёт ' + (f.members[0].m ? 'один' : 'одна'))) + '</b>' +
          f.members.map(function (m) { return '<div>' + esc(m.name) + ', ' + ageWord(m.age) + ' — ' + esc(m.job) + '</div>'; }).join('') +
          (f.pet ? '<div>🐾 ' + esc(f.pet) + '</div>' : '') + '</div>';
      });
      if (R.families.length > show.length) h += '<div class="more">…и ещё ' + (R.families.length - show.length) + ' ' + plural(R.families.length - show.length, 'семья', 'семьи', 'семей') + '</div>';
    } else {
      var w = workplace(b), headLabel = c.head[b.size] + (c.rank ? ' (' + c.rank[b.size] + ')' : ''), filled = sim.work[b.id];
      h += '<div class="about">' + esc(c.about[b.size]) + '</div>';
      if (b.cat === 'factory') {
        var u = G.units.brigade;
        h += '<div class="pbox"><b>🏭 Выпуск машин</b><div class="kv"><span>Очередь</span><span id="iFq">' + fqText() + '</span>' +
          '<span>«Бригада»</span><span>' + usd(u.factoryPrice) + ', ' + secText(u.makeTime) + '</span></div>' +
          '<div class="ubtns wrap"><button class="btn-buy alt" data-act="order">🚚 Заказать «Бригаду»</button><button class="btn-sell" data-act="cancel" id="iCancel"' + (queued('brigade') ? '' : ' disabled') + '>Отменить</button>' +
          '<button class="btn-buy" data-act="cars">🚗 Машины города</button></div></div>';
      } else if (b.cat === 'saw') {
        var sp = G.sawmill[b.size], R0 = sawRate();
        h += '<div class="pbox"><b>🪚 Производство</b><div class="kv">' +
          (state.env ? '<span>Берёт брёвен</span><span><b>' + sp.use + '</b> в минуту</span>' : '') +
          '<span>Доски</span><span><b>' + sp.boards + '</b> в минуту</span>' +
          (sp.dsp ? '<span>ДСП</span><span><b>' + sp.dsp + '</b> листов в минуту</span>' : '<span>ДСП</span><span>нет — делает только Большая лесопилка</span>') +
          '<span>Все лесопилки города</span><span>' + R0.boards + ' досок + ' + R0.dsp + ' ДСП / мин</span>' +
          '<span>На складе</span><span id="iStock">—</span></div>' +
          (state.env ? (state.stock.logs < 1 ? '<div class="noroad"><b>🪵 Нет брёвен</b>Лесопилка стоит. Брёвна даёт только Общество лесорубов: 🏠 «Строить» → 🪵 «Ресурсы». Поставьте его у леса и подведите дорогу.</div>' : '') :
            '<div class="unote">В этом мире нет деревьев, поэтому лесопилка работает без брёвен. Нажмите ☰ → «🌲 Обновить карту» — появятся деревья и лесорубы.</div>') +
          '<div class="unote">Стройка берёт материалы со склада: с досками бригады строят на 25% быстрее, с досками и ДСП — на 50%.</div></div>';
      } else if (b.cat === 'lumber') {
        var LJ = G.lumber, zn = jackZone(b), ztr = zoneTrees(b), nj = jackCountOf(b.id);
        h += '<div class="pbox"><b>🪓 Лесоповал</b><div class="kv"><span>Поле деятельности</span><span><b>' + LJ.zone + '×' + LJ.zone + '</b> клеток (подсвечено на карте)</span>' +
          '<span>Деревьев в поле</span><span><b>' + (state.env ? ztr : 0) + '</b>' + (state.env && !ztr ? ' — лес кончился' : '') + '</span>' +
          '<span>Лесорубов</span><span><b>' + nj + '</b> из ' + LJ.jacks + '</span>' +
          '<span>Брёвен с дерева</span><span>' + LJ.perTree[1] + ' (дуб), ' + LJ.perTree[2] + ' (сосна), ' + LJ.perTree[3] + ' (ясень)</span>' +
          '<span>На складе</span><span id="iStock">—</span></div>' +
          (!state.env ? '<div class="noroad"><b>🌲 В мире нет деревьев</b>Лесорубам нечего рубить. Нажмите ☰ → «🌲 Обновить карту» — свободная площадь засеется лесом.</div>' :
            !ztr ? '<div class="noroad"><b>🌲 В поле не осталось деревьев</b>Деревья не растут. Перенесите общество к другому лесу: ✋ «Перенести».</div>' : '') +
          '<div class="unote">Лесорубы ходят по полю, валят деревья и носят брёвна в общество. Брёвна идут на склад города, оттуда их берут лесопилки.</div></div>';
      } else if (b.cat === 'park' || b.cat === 'upark') {
        var pu = parkUse(b);
        h += '<div class="pbox"><b>🅿️ ' + (b.cat === 'upark' ? 'Подземная парковка' : 'Наземная парковка') + '</b><div class="kv"><span>Мест</span><span><b>' + pu.places + '</b>' + (b.cat === 'upark' ? ' (под землёй, сверху газон)' : '') + '</span>' +
          '<span>Машин жителей рядом</span><span>🚗 ' + pu.near + (pu.near > pu.places ? ' — мест не хватает' : pu.near ? ' — все помещаются' : '') + '</span></div></div>';
      } else if (b.cat === 'depot') {
        h += '<div class="pbox"><b>🛠️ Ремонт дорог</b><div class="kv"><span>Каток</span><span id="iRoller">' + rollerText(b.id) + '</span>' +
          '<span>Асфальт</span><span id="iRs">—</span><span>Средний / почти изношен</span><span id="iWornN">—</span><span>Очередь</span><span id="iQ">—</span></div>' +
          '<button class="btn-buy wide" data-act="repair" id="iRep">🛠️ Отремонтировать изношенные</button>' +
          '<button class="btn-tog' + (state.autoRepair ? ' on' : '') + '" data-act="auto" id="iAuto">' + autoLabel() + '</button></div>';
      }
      h += '<div class="kv">' + (w.company ? '<span>Компания</span><span>«' + esc(w.company) + '»</span>' : '') +
        '<span>' + esc(headLabel) + '</span><span>' + esc(w.head) + '</span>' +
        '<span>' + (b.cat === 'park' || b.cat === 'upark' ? 'Рабочих мест' : 'Мест') + '</span><span><b>' + w.staff + '</b></span>' +
        '<span>Из горожан</span><span>' + (filled === undefined ? '…считаем' : filled + ' чел.' + (filled < w.staff ? ' — свободно ' + (w.staff - filled) : ' — все места заняты')) + '</span>' +
        '<span>' + esc(cap(c.visitors[b.size])) + '</span><span>' + w.visits + '</span>' +
        (servingText(b.cat) ? '<span>Машины в городе</span><span>' + esc(servingText(b.cat)) + '</span>' : '') +
        '<span>Дорога рядом</span><span>' + roadNear(b) + '</span></div>';
      if (w.team.length) {
        h += '<div class="fam"><b>Сотрудники</b>' + w.team.map(function (t) { return '<div>' + esc(t.name) + ', ' + ageWord(t.age) + ' — ' + esc(t.role) + '</div>'; }).join('') + '</div>';
        if (w.staff - 1 > w.team.length) h += '<div class="more">…и ещё ' + (w.staff - 1 - w.team.length) + ' чел.</div>';
      }
    }
    $('infoBody').innerHTML = h; $('info').hidden = false; if (!keepScroll) $('info').scrollTop = 0;
    highlight(b.id);
    stockDirty = true; updateStock();
    refreshLive();
  }
  // Справка о клетке дороги (с 0.9.0): износ, цена ремонта, кнопка ремонта
  var infoRoad = '', infoRoadT = '';
  function openRoadInfo(x, z) { closeInfo(); infoRoad = key(x, z); renderRoadInfo(); }
  function renderRoadInfo() {
    var k = infoRoad, t = state.roads[k]; if (!t) { closeInfo(); return; }
    infoRoadT = t;
    var p = k.split(','), x = +p[0], z = +p[1], h = '<h2>' + (t === 'asphalt' ? '🛣️ Асфальт' : t === 'cobble' ? '🪨 Булыжник' : '🟫 Простая дорога') + '</h2>' +
      '<div class="sub">' + esc(G.streets[Math.floor(z / 4) % G.streets.length]) + ' · клетка ' + (x + 1) + ':' + (z + 1) + (traffic[k] ? ' · у работающего здания' : '') + '</div>';
    if (t === 'asphalt') {
      h += '<div class="kv"><span>Износ</span><span id="irWear">—</span><span>Состояние</span><span id="irState">—</span><span>Ремонт</span><span id="irCost">—</span></div>' +
        '<div class="pbar wear"><i id="irBar"></i></div>';
      h += working('depot').length ? '<button class="btn-buy wide" data-act="fixone">🛠️ Отремонтировать эту клетку</button>' :
        '<div class="noroad"><b>Ремонтировать некому</b>Постройте Дорожное депо: 🚚 Механизмы → 🏭 Здания. Без него асфальт будет только изнашиваться.</div>';
      h += '<p class="note">Асфальт стареет со временем, у работающих зданий — в ' + String(G.wear.traffic).replace('.', ',') + ' раза быстрее. С ' + pctText(G.wear.mid) +
        ' — трещины, с ' + pctText(G.wear.worn) + ' — ямы. При 100% он разбит и становится простой дорогой.</p>';
    } else if (t === 'cobble') h += '<div class="about">Булыжная мостовая: камни, уложенные рядами, с каменными бордюрами. Не изнашивается и ремонта не требует. Здания у неё работают так же, как у асфальта.</div>';
    else h += '<div class="about">Простая дорога не изнашивается и ремонта не требует. Здания у неё работают так же, как у асфальта. Чтобы положить асфальт: 🛣️ «Дорога» → «Асфальт» и проведите по клеткам.</div>';
    $('infoBody').innerHTML = h; $('info').hidden = false; $('info').scrollTop = 0;
    var c = cellCenter(x, z); setOverlay(hl, c.x, c.z, 1.12, 1.12);
    refreshLive();
  }
  function famName(s) { return /(ов|ев|ин)$/.test(s) ? s + 'ых' : s; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, a, b, c) { var x = n % 10, y = n % 100; return y >= 11 && y <= 14 ? c : x === 1 ? a : x >= 2 && x <= 4 ? b : c; }
  function closeInfo() { infoId = 0; infoRoad = ''; $('info').hidden = true; highlight(0); }
  $('infoClose').addEventListener('click', closeInfo);
  function highlight(id) {
    var b = id && getB(id);
    if (!b) { hl.setEnabled(false); zoneOff(); dirty(); return; }
    var f = foot(b.size, b.rot), p = bPos(b);
    setOverlay(hl, p.x, p.z, f.w + 0.2, f.d + 0.2);
    if (b.cat === 'lumber') showZone(b); else zoneOff();
  }

  // ---------- Статистика ----------
  var noRoadCount = 0, statsTimer = 0;
  // Сводка по кускам (здания, жители, рабочие места): загруженные считаем заново, остальные берём из записи мира
  function computeStats() {
    var per = {}, off = 0;
    Object.keys(loaded).forEach(function (ck) { per[ck] = [0, 0, 0]; });
    state.buildings.forEach(function (b) {
      pinFor(b);
      var c = per[ckOf(b.x, b.z)];
      if (isSite(b)) return;
      if (c) c[0]++;
      if (!hasRoad(b)) { off++; return; }
      if (c) { if (b.cat === 'res') c[1] += residents(b).total; else c[2] += workplace(b).staff; }
    });
    Object.keys(per).forEach(function (ck) { var a = per[ck]; if (a[0] || a[1] || a[2]) metaCs[ck] = a; else delete metaCs[ck]; });
    var T = totals(); T.off = off; return T;
  }
  function totals() { var r = { b: 0, p: 0, j: 0 }; for (var ck in metaCs) { r.b += metaCs[ck][0]; r.p += metaCs[ck][1]; r.j += metaCs[ck][2]; } return r; }
  function updateStats() {
    clearTimeout(statsTimer);
    var T = computeStats(), people = T.p, jobs = T.j, built = T.b, off = T.off;
    noRoadCount = off;
    $('stPeople').textContent = people.toLocaleString('ru-RU');
    $('stJobs').textContent = jobs.toLocaleString('ru-RU');
    $('stBuild').textContent = built;
    $('stOff').textContent = off; $('stOffWrap').hidden = !off;
    $('stOffWrap').title = 'Без дороги: ' + off + ' ' + plural(off, 'здание', 'здания', 'зданий') + ' не работают. Подведите к ним дорогу.';
    rebuildTraffic(); syncRollers(); syncCars(); syncVehicles(); sawCache = null; stoneCache = null; stockDirty = true; updateStock();
    if (infoId) { var ib = getB(infoId); if (ib) renderInfo(ib, true); }
    simRequest();
  }
  function statsSoon() { clearTimeout(statsTimer); statsTimer = setTimeout(updateStats, 120); }

  // ---------- Меню ----------
  function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  // Гайд: текст в js/guide.js (тот же текст — в файле GUIDE.txt)
  function guideHtml(welcome) {
    var g = window.GUIDE, open = { start: 1, roads: 1 };
    open[TOUCH ? 'touch' : 'pc'] = 1;
    if (!g) return '<p>Гайд не загрузился.</p>';
    return (welcome ? '' : '<h2>📖 ' + esc(g.title) + '</h2><p style="font-size:13px;color:#a9b6c8">Версия ' + esc(g.version) + ' · ' + esc(g.date) + '</p>') +
      '<div class="gtoc">' + g.sections.map(function (x) { return '<button class="chip" data-m="gsec" data-s="' + x.id + '">' + esc(x.title) + '</button>'; }).join('') + '</div>' +
      g.sections.map(function (x) {
        return '<details class="guide" id="g-' + x.id + '"' + (open[x.id] ? ' open' : '') + '><summary>' + esc(x.title) + '</summary><ul>' +
          x.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul></details>';
      }).join('');
  }
  function cityHtml() {
    var f = function (n) { return Number(n).toLocaleString('ru-RU'); };
    var nb = Object.keys(batches).filter(function (k) { return batches[k].ids.length; }).length;
    return '<h2>📊 Город</h2><div class="kv">' +
      '<span>Мир</span><span>' + esc(worldName) + ', ' + N + '×' + N + '</span>' +
      '<span>Загружено кусков 100×100</span><span>' + Object.keys(loaded).length + ' из ' + nChunks() * nChunks() + '</span>' +
      '<span>Жителей во всём мире</span><span><b>' + f(totals().p) + '</b></span>' +
      '<span>Из них в загруженной части</span><span>' + f(sim.people) + '</span>' +
      '<span>Взрослых, кто может работать</span><span>' + f(sim.adults) + '</span>' +
      '<span>Работают</span><span>' + f(sim.employed) + '</span>' +
      '<span>Ищут работу</span><span>' + f(sim.unemployed) + '</span>' +
      '<span>Рабочих мест</span><span>' + f(sim.jobs) + ' (свободно ' + f(sim.freeJobs) + ')</span>' +
      '<span>Зданий во всём мире</span><span>' + f(totals().b) + '</span>' +
      '<span>Не работают — нет дороги (загруженная часть)</span><span>' + (noRoadCount ? '<span class="bad">' + f(noRoadCount) + '</span>' : '0') + '</span>' +
      (function () { var R = roadStats(); return '<span>Асфальт</span><span>' + f(R.asphalt) + ' кл., средний износ ' + pctText(R.avg) + '</span>' +
        '<span>Средний износ / почти изношен</span><span>' + f(R.mid) + ' / ' + (R.worn ? '<span class="bad">' + f(R.worn) + '</span>' : '0') + '</span>' +
        '<span>Простая дорога</span><span>' + f(R.dirt) + ' кл.</span>' +
        '<span>Булыжник</span><span>' + f(R.cobble) + ' кл.</span>' +
        '<span>Автоматический ремонт</span><span>' + (state.autoRepair ? 'включён' : 'выключен') + '</span>' +
        '<span>Очередь завода</span><span>' + state.fql.length + '</span>' +
        '<span>Служебные машины</span><span>' + f(state.vehicles.length) + '</span>' +
        '<span>Легковые машины жителей</span><span>' + f(Object.keys(carAgents).length) + '</span>'; })() + '</div>' +
      '<p style="font-size:13px;color:#a9b6c8">Расчёт жителей: ' + (window.SIM.threaded() ? 'в фоновом потоке' : 'на странице') + ', ' + sim.ms + ' мс. ' +
      'Отрисовка: Babylon.js ' + B.Engine.Version + ', ' + nb + ' ' + plural(nb, 'пачка', 'пачки', 'пачек') + ' одинаковых моделей.</p>';
  }
  function changelogHtml() {
    return G.changelog.map(function (c) { return '<p><b>' + c.v + '</b> · ' + c.date + '</p><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }).join('');
  }
  // Меню настроек (☰) — боковая панель слева (с 0.14.0). Гайд, «Что нового», «Город» и «Размер карты»
  // открываются внутри неё (кнопка «←» — назад в меню); при первом запуске новой версии окно «Что нового» остаётся всплывающим.
  var sideOpen = false;
  function menuRootHtml() {
    var u = WORLD.cloud.status().user;
    return '<h2>Мое_город ' + G.version + '</h2>' +
      '<button class="menu-btn" data-m="worlds">🌍 Миры<span class="mb-sub">' + esc(worldName) + ' · ' + N + '×' + N + '</span></button>' +
      (worldId && state && !state.env && !stale ? '<button class="menu-btn nat" data-m="wnat" data-id="' + worldId + '">🌲 Обновить карту<span class="mb-sub">засеять свободную площадь деревьями и горами</span></button>' : '') +
      '<button class="menu-btn" data-m="acct">👤 Аккаунт<span class="mb-sub">' + (u ? esc(u.email) : 'вход не выполнен') + '</span></button>' +
      '<button class="menu-btn" data-m="help">📖 Гайд по игре</button>' +
      '<button class="menu-btn" data-m="news">📝 Что нового</button>' +
      '<button class="menu-btn" data-m="city">📊 Город</button>' +
      '<button class="menu-btn" data-m="mech">🚚 Механизмы</button>' +
      '<button class="menu-btn" data-m="center">🎯 В центр карты<span class="mb-sub">камера вернётся в середину карты · клавиша 8</span></button>' +
      '<p style="font-size:13px;color:#a9b6c8">Миры сохраняются сами — на этом устройстве, а после входа в аккаунт ещё и в облаке (одни и те же миры на телефоне и компьютере). Бригады, машины и деньги у каждого мира свои.</p>';
  }
  function sideShow(html, sub, keep) { var st = $('sbBody').scrollTop; $('sbBody').innerHTML = html; $('sbBody').scrollTop = keep ? st : 0; $('sbPrev').hidden = !sub; }
  function menuView(html, sub, keep) { if (sideOpen) sideShow(html, sub, keep); else openModal(html); }
  function openSide() {
    if (sideOpen) return;
    sideOpen = true; confirmArm = ''; menuMode = ''; snd('open');
    sideShow(menuRootHtml(), false);
    $('sidebar').classList.add('open'); $('sidebar').setAttribute('aria-hidden', 'false'); $('sbScrim').classList.add('open');
    $('btnMenu').setAttribute('aria-expanded', 'true');
  }
  function closeSide() {
    if (!sideOpen) return;
    sideOpen = false; snd('close');
    $('sidebar').classList.remove('open'); $('sidebar').setAttribute('aria-hidden', 'true'); $('sbScrim').classList.remove('open');
    $('btnMenu').setAttribute('aria-expanded', 'false');
  }
  function openMenu() { if (sideOpen) closeSide(); else openSide(); }
  $('sbClose').addEventListener('click', closeSide);
  $('sbScrim').addEventListener('click', closeSide);
  $('sbPrev').addEventListener('click', function () { confirmArm = ''; menuMode = ''; sideShow(menuRootHtml(), false); });
  // ---------- Миры (с 0.20.0) ----------
  var menuMode = '', confirmArm = '', newSize = G.mapSize, newDemo = false, newNature = true, newName = '';
  function sizeLabel(n) { for (var i = 0; i < G.mapSizes.length; i++) if (G.mapSizes[i].n === n) return G.mapSizes[i].label; return 'Своя'; }
  function worldCard(w) {
    var cur = w.id === worldId, nc = Math.ceil(w.size / WC);
    var tags = [w.size + '×' + w.size, '🏢 ' + w.b.toLocaleString('ru-RU'), '👥 ' + w.p.toLocaleString('ru-RU')];
    if (w.cloudOnly) tags.push('☁️ только в облаке'); else if (w.cloud) tags.push('☁️ в облаке'); else if (WORLD.cloud.on()) tags.push('⏳ ждёт отправки');
    var btns = '';
    if (!cur) btns += '<button class="mini" data-m="wopen" data-id="' + w.id + '">Открыть</button>';
    else if (stale) btns += '<button class="mini" data-m="wopen" data-id="' + w.id + '">↻ Загрузить новую версию</button>';
    var canNat = cur ? !!(state && !state.env && !stale) : (w.nat === false && !w.cloudOnly && !w.needPull);   // мир без природы — можно засеять (с 0.22.0)
    if (canNat) btns += '<button class="mini nat" data-m="wnat" data-id="' + w.id + '">🌲 Обновить</button>';
    btns += '<button class="mini" data-m="wren" data-id="' + w.id + '" aria-label="Переименовать">✏️</button><button class="mini danger" data-m="wdel" data-id="' + w.id + '" aria-label="Удалить">🗑️</button>';
    return '<div class="wcard' + (cur ? ' cur' : '') + '"><div class="wc-top"><b>' + esc(w.name) + '</b>' + (cur ? '<em>▶ открыт</em>' : '') + '</div>' +
      '<div class="wc-sub">' + tags.join(' · ') + ' · ' + nc * nc + ' ' + plural(nc * nc, 'кусок', 'куска', 'кусков') + '</div>' +
      (canNat ? '<div class="wc-note">🌲 В этом мире нет природы. «Обновить» засеет всю свободную площадь деревьями и горами; построенное останется на месте.</div>' : '') +
      '<div class="wc-btns">' + btns + '</div></div>';
  }
  function showWorlds(keep) {
    menuMode = 'worlds';
    return WORLD.list().then(function (L) {
      if (menuMode !== 'worlds') return;
      var h = '<h2>🌍 Миры</h2><button class="menu-btn acc" data-m="wnew">➕ Новый мир</button>' +
        (L.length ? L.map(worldCard).join('') : '<p>Миров пока нет — создайте первый.</p>') +
        '<p style="font-size:13px;color:#a9b6c8">' + (WORLD.cloud.on() ? '☁️ Миры сохраняются в облаке вашего аккаунта и открываются на любом устройстве.' : 'Миры лежат на этом устройстве. Войдите в аккаунт («👤 Аккаунт»), и они появятся в облаке — на телефоне и на компьютере будет одно и то же.') + '</p>';
      menuView(h, true, keep);
    });
  }
  function showNew() {
    menuMode = 'new'; confirmArm = '';
    var groups = [], h = '<h2>➕ Новый мир</h2><p style="font-size:13px;color:#a9b6c8">Карта начинается пустой: купите бригаду, проложите дорогу и стройте. Большие миры загружаются кусками по 100×100 клеток — по мере того, как вы двигаете камеру.</p>' +
      '<input id="wName" class="wname" maxlength="40" placeholder="Название мира" value="' + esc(newName) + '">';
    G.mapSizes.forEach(function (m) { if (groups.indexOf(m.g) < 0) groups.push(m.g); });
    groups.forEach(function (g) {
      h += '<div class="sz-h">' + g + '</div><div class="size-grid">' + G.mapSizes.filter(function (m) { return m.g === g; }).map(function (m) {
        var c = Math.ceil(m.n / WC);
        return '<button class="size-opt' + (m.n === newSize ? ' on' : '') + '" data-n="' + m.n + '"><i style="width:' + Math.round(12 + Math.sqrt(m.n / 1000) * 30) + 'px;height:' + Math.round(12 + Math.sqrt(m.n / 1000) * 30) + 'px"></i><b>' + m.n + '×' + m.n + '</b><span>' + (c * c > 1 ? c * c + ' ' + plural(c * c, 'кусок', 'куска', 'кусков') : '1 кусок') + '</span></button>';
      }).join('') + '</div>';
    });
    h += '<label class="chk"><input type="checkbox" id="wNature"' + (newNature ? ' checked' : '') + '> 🌲 Природа: леса, каменистые площадки, горы со снежными пиками, камень для дорог</label>' +
      '<label class="chk"><input type="checkbox" id="wDemo"' + (newDemo ? ' checked' : '') + '> Положить в центр город-пример</label>' +
      '<button class="menu-btn acc" data-m="wmake" id="wMake">✅ Создать мир ' + newSize + '×' + newSize + '</button>';
    menuView(h, true);
  }
  function showAcct() {
    menuMode = 'acct';
    menuView('<h2>👤 Аккаунт</h2><div id="acct-box"></div><div id="acct-cloud"></div>' +
      '<p style="font-size:13px;color:#a9b6c8">Это тот же аккаунт, что на других моих сайтах: вошли один раз — вошли везде. Без входа миры остаются только на этом устройстве.</p>', true);
    if (window.MMAccount) MMAccount.mount('#acct-box'); else $('acct-box').innerHTML = '<p class="warn">Модуль входа не загрузился. Проверьте интернет и обновите страницу.</p>';
    renderCloud();
  }
  function renderCloud() {
    var el = $('acct-cloud'); if (!el) return;
    var c = WORLD.cloud.status(), ico = { ok: '✅', syncing: '🔄', error: '⚠️', offline: '📴', off: '💾' }[c.state] || '💾';
    el.innerHTML = c.user ? '<div class="cloudrow">' + ico + ' <span>Миры в облаке: ' + esc(c.text || 'готово') + '</span></div><button class="menu-btn" data-m="wsync">🔄 Синхронизировать миры сейчас</button>' : '';
  }
  function updateChip() {
    var c = WORLD.cloud.status(), ico = !c.user ? '' : stale ? '⚠️' : { ok: '☁️', syncing: '🔄', error: '⚠️', offline: '📴' }[c.state] || '';
    $('worldName').textContent = worldName || '…'; $('worldCloud').textContent = ico;
    $('worldChip').title = (stale ? 'Мир изменили на другом устройстве — откройте его заново. ' : '') + (c.text || '');
  }
  WORLD.onChange(function (ev) {
    if (ev.type === 'list') { if (sideOpen && menuMode === 'worlds') showWorlds(true); updateChip(); }
    else if (ev.type === 'status') { updateChip(); if (sideOpen && menuMode === 'acct') renderCloud(); }
    else if (ev.type === 'remote' && ev.id === worldId) { stale = true; updateChip(); hint('☁️ Этот мир изменили на другом устройстве. «🌍 Миры» → «Загрузить новую версию». Пока сохранения этого устройства на паузе.', true); }
    else if (ev.type === 'removed' && ev.id === worldId) { worldId = ''; hint('Этот мир удалили на другом устройстве', true); openAnyWorld(); }
  });
  $('worldChip').addEventListener('click', function () { openSide(); showWorlds(); WORLD.cloud.poke(); });

  // ---------- Открыть, создать, удалить мир ----------
  function showLoading(t) { $('loading').textContent = t || 'Загрузка мира…'; $('loading').classList.remove('done'); }
  function hideLoading() { $('loading').classList.add('done'); dirty(); }
  function openWorld(id) {
    if (switching) return Promise.resolve();
    if (worldId) saveNow(false);
    switching = true; showLoading('Загрузка мира…');
    return WORLD.open(id).then(function (meta) {
      closeInfo(); cancelMove(); closeMech(); closeEpochs();
      worldTok++; loaded = {}; loading = {}; dirtyCk = {}; stale = false; undoLog = null;
      worldId = meta.id; worldName = meta.name; WORLD.setOpen(meta.id);
      var g = Object.assign(emptyState(meta.size), meta.g || {}); g.buildings = []; g.roads = {}; g.wear = {}; g.size = meta.size;
      state = fixState(g); metaCs = meta.cs || {};
      rebuildAll();
      if (meta.cam && isFinite(meta.cam.tx)) { cam.tx = meta.cam.tx; cam.tz = meta.cam.tz; cam.dist = meta.cam.dist || cam.dist; cam.yaw = meta.cam.yaw || Math.PI / 4; cam.pitch = ISO_PITCH; cam.yawGoal = null; updateCam(); }
      else camHome();
      try { localStorage.setItem('moe_gorod_last', meta.id); } catch (e) {}
      switching = false;
      updateChip(); ensureView();
      return waitLoads();
    }).then(function () { ensureView(); return waitLoads(); }).then(function () {
      assignBrigades(); updateStats(); hideLoading();
      if (!WORLD.persistent()) hint('Хранилище браузера недоступно: мир живёт, пока открыта страница', true);
    }).catch(function (e) {
      switching = false; hideLoading();
      hint(String((e && e.message) || e), true);
    });
  }
  function openAnyWorld() {
    return WORLD.list().then(function (L) {
      if (L.length) return openWorld(L[0].id);
      return createWorld('Мой город', G.mapSize, false).then(openWorld);
    });
  }
  function createWorld(name, size, demo, nature) {
    var s0 = emptyState(size);
    if (nature) {
      s0.env = { seed: newSeed() }; s0.stock.stone = G.startStock.stone; s0.stock.gravel = G.startStock.gravel;
      if (demo) { var o0 = Math.floor((size - 48) / 2); s0.env.hole = [o0 - 1, o0 - 1, o0 + 49, o0 + 49]; }
    }
    return WORLD.create({ name: name, size: size, g: metaOf(s0), cs: {} }).then(function (w) {
      if (!demo) return w.id;
      var d = demoState(size), docs = WORLD.codec.chunkify(size, d.buildings, d.roads, {}, function (b) { return foot(b.size, b.rot); });
      WORLD.update(w.id, { g: Object.assign(metaOf(s0), { nextId: d.nextId }) }, true);
      return Promise.all(Object.keys(docs).map(function (ck) { var q = ck.split(','); return WORLD.putChunk(w.id, +q[0], +q[1], docs[ck], true); })).then(function () { return w.id; });
    });
  }
  // ---------- Обновить старый мир: засеять природой (с 0.22.0) ----------
  // Мир без природы (создан до 0.21.0 или без галочки «Природа») получает «зерно» природы (env.seed), и вся свободная площадь покрывается деревьями,
  // каменистыми площадками и горами — так же, как в новых мирах. Всё построенное остаётся как было:
  //  • клетки под зданиями и дорогами записываются в куски как «убранные» (t) — деревья там не вырастут, даже если потом снести здание;
  //  • вокруг построенного (квадраты 10×10 клеток, где что-то стоит, склеены в прямоугольники) гор и камней нет — env.keep; деревья на свободных клетках внутри есть.
  // Вокруг центра карты — чистая лужайка (как в новых мирах). Как в новом мире, добавляется стартовый запас камня и щебня (дороги теперь из камня).
  function natureUpgrade(id) {
    if (switching) return Promise.resolve();
    return (id === worldId ? Promise.resolve() : openWorld(id)).then(function () {
      if (id !== worldId || !state || switching) return;
      if (stale) { hint('Мир изменили на другом устройстве — сначала «🌍 Миры» → «Загрузить новую версию»', true); return; }
      if (state.env) { hint('В этом мире уже есть природа', true); return; }
      return natureRun(id);
    });
  }
  // Квадраты bs×bs клеток, где что-то стоит (blocks: Set номеров bz×1000+bx в блоках по 10 клеток) → список прямоугольников [x0, z0, x1, z1] (конец не входит)
  function keepRects(blocks, bsz, mapN) {
    var per = bsz / 10, cells = {}, list = [], k;
    blocks.forEach(function (k10) { var bz = Math.floor(k10 / 1000), bx = k10 % 1000; cells[Math.floor(bz / per) * 1000 + Math.floor(bx / per)] = 1; });
    var ks = Object.keys(cells).map(Number).sort(function (a, b) { return a - b; }), open = {};
    ks.forEach(function (c) {
      var bz = Math.floor(c / 1000), bx = c % 1000, last = list[list.length - 1];
      if (last && last.bz === bz && last.bx1 === bx - 1) { last.bx1 = bx; return; }   // продолжение ряда
      list.push({ bz: bz, bx0: bx, bx1: bx, bz0: bz });
    });
    var out = [], byRange = {};
    list.forEach(function (r) {                                                        // одинаковые ряды друг под другом — в один прямоугольник
      var key = r.bx0 + ':' + r.bx1, o = byRange[key];
      if (o && o.bz1 === r.bz - 1) { o.bz1 = r.bz; return; }
      o = { bx0: r.bx0, bx1: r.bx1, bz0: r.bz, bz1: r.bz }; byRange[key] = o; out.push(o);
    });
    return out.map(function (o) { return [o.bx0 * bsz, o.bz0 * bsz, Math.min(mapN, (o.bx1 + 1) * bsz), Math.min(mapN, (o.bz1 + 1) * bsz)]; });
  }
  function natureRun(id) {
    saveNow(false);                                   // всё, что уже построено, — в хранилище
    switching = true; showLoading('🌲 Засеваем карту деревьями и горами…');
    var n = nChunks(), todo = [], blocks = new Set(), busy = 0, cx, cz;
    for (cz = 0; cz < n; cz++) for (cx = 0; cx < n; cx++) todo.push([cx, cz]);
    function one(c) {
      return WORLD.getChunk(id, c[0], c[1]).then(function (doc) {
        if (!doc) return;
        var d = WORLD.codec.decode(doc, c[0], c[1]), x0 = c[0] * WC, z0 = c[1] * WC, x1 = Math.min(N, x0 + WC), z1 = Math.min(N, z0 + WC), occupied = {}, any = false;
        function mark(x, z) {
          if (x < x0 || z < z0 || x >= x1 || z >= z1) return;
          occupied[(z - z0) * WC + (x - x0)] = 1; any = true;
          blocks.add(Math.floor(z / 10) * 1000 + Math.floor(x / 10));
        }
        d.b.forEach(function (b) { if (!validB(b)) return; var f = foot(b.size, b.rot); for (var z = b.z; z < b.z + f.d; z++) for (var x = b.x; x < b.x + f.w; x++) mark(x, z); });
        d.roads.forEach(function (r) { mark(r[0], r[1]); });
        if (!any) return;
        (doc.t || []).forEach(function (k) { occupied[k] = 1; });
        return WORLD.putChunk(id, c[0], c[1], Object.assign({}, doc, { t: Object.keys(occupied).map(Number) }), true);
      });
    }
    function worker() { // до четырёх кусков одновременно
      var c = todo.shift(); if (!c) return Promise.resolve();
      return one(c).then(worker);
    }
    var ws = []; for (busy = 0; busy < 4; busy++) ws.push(worker());
    return Promise.all(ws).then(function () {
      var keep = [], bsz = 10;
      if (blocks.size) { do { keep = keepRects(blocks, bsz, N); bsz *= (bsz === 10 ? 2 : bsz === 20 ? 2.5 : 2); } while (keep.length > 400 && bsz <= 100); }   // квадраты 10, 20, 50, 100 клеток — чтобы прямоугольников было немного
      state.env = { seed: newSeed() }; if (keep.length) state.env.keep = keep;
      state.stock.stone = (+state.stock.stone || 0) + G.startStock.stone; state.stock.gravel = (+state.stock.gravel || 0) + G.startStock.gravel;
      dirtyCk = {}; switching = false;                // устаревшие куски из памяти не должны затереть записанные выше
      saveNow(false);                                 // запись «природа есть» в мир
      return openWorld(id);                           // открыть мир заново: деревья и горы появятся вместе с кусками карты
    }).then(function () {
      if (state && state.env) hint('🌲 Готово! Свободная площадь засеяна деревьями и горами. Добавили ' + G.startStock.stone + ' 🪨 камня и ' + G.startStock.gravel + ' ⚪ щебня — теперь дороги строятся из камня', true);
    }).catch(function (e) {
      switching = false; hideLoading();
      hint('Не удалось обновить карту: ' + ((e && e.message) || e), true);
    });
  }
  function migrateLegacy() { // прежнее сохранение (одна карта в браузере) становится первым миром
    var done = false; try { done = !!localStorage.getItem('moe_gorod_migrated'); } catch (e) {}
    var old = done ? null : legacyLoad();
    if (!old) return Promise.resolve();
    var docs = WORLD.codec.chunkify(old.size, old.buildings, old.roads, old.wear, function (b) { return foot(b.size, b.rot); });
    return WORLD.create({ name: 'Мой город', size: old.size, g: metaOf(old), cs: {} }).then(function (w) {
      return Promise.all(Object.keys(docs).map(function (ck) { var q = ck.split(','); return WORLD.putChunk(w.id, +q[0], +q[1], docs[ck], true); }));
    }).then(function () { try { localStorage.setItem('moe_gorod_migrated', '1'); } catch (e) {} });
  }
  function deleteWorld(id) {
    var cur = id === worldId;
    if (cur) { saveNow(false); worldId = ''; worldTok++; }
    return WORLD.remove(id).then(function () { if (cur) return openAnyWorld(); });
  }
  function startWorlds() {
    var remembered = false; try { remembered = !!localStorage.getItem('mma.user'); } catch (e) {}
    return WORLD.ready.then(migrateLegacy).then(function () { return WORLD.list(); }).then(function (L) {
      if (L.length || !remembered || !window.MMAccount) return L;
      // первый запуск на этом устройстве, но вход уже был: даём облаку несколько секунд — вдруг там уже есть миры
      return Promise.race([MMAccount.whenReady(3000).then(function () { return WORLD.cloud.sync(false); }), new Promise(function (r) { setTimeout(r, 5000); })]).then(function () { return WORLD.list(); });
    }).then(function (L) {
      if (!L.length) return createWorld('Мой город', G.mapSize, false).then(function () { return WORLD.list(); });
      return L;
    }).then(function (L) {
      var last = ''; try { last = localStorage.getItem('moe_gorod_last') || ''; } catch (e) {}
      var pick = L.filter(function (w) { return w.id === last; })[0] || L[0];
      return openWorld(pick.id);
    }).catch(function (e) { console.error(e); hint('Не удалось открыть мир: ' + ((e && e.message) || e), true); hideLoading(); });
  }

  $('btnMenu').addEventListener('click', openMenu);
  function menuClick(e) {
    var b = e.target.closest('[data-m],[data-n]'); if (!b) return;
    var m = b.dataset.m;
    var sb = e.target.closest('[data-n]');
    if (sb && !m) { // выбор размера нового мира
      newSize = +sb.dataset.n;
      var box = sb.closest('#sbBody, #modalBody');
      Array.prototype.forEach.call(box.querySelectorAll('.size-opt'), function (x) { x.classList.toggle('on', x === sb); });
      var mk = $('wMake'); if (mk) mk.textContent = '✅ Создать мир ' + newSize + '×' + newSize;
      return;
    }
    if (m === 'help') menuView(guideHtml(), true);
    else if (m === 'gsec') { var d = document.getElementById('g-' + b.dataset.s); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }
    else if (m === 'city') { menuMode = 'city'; menuView(cityHtml(), true); }
    else if (m === 'mech') { closeModal(); closeSide(); openMech(); }
    else if (m === 'center') { closeModal(); closeSide(); centerCam(); }
    else if (m === 'news') menuView('<h2>Что нового</h2>' + changelogHtml(), true);
    else if (m === 'worlds') { showWorlds(); WORLD.cloud.poke(); }
    else if (m === 'acct') showAcct();
    else if (m === 'wsync') { WORLD.cloud.sync(true).then(function () { renderCloud(); }); }
    else if (m === 'wnew') { WORLD.list().then(function (L) { newName = 'Мир ' + (L.length + 1); showNew(); }); }
    else if (m === 'wopen') { var id = b.dataset.id; closeModal(); closeSide(); openWorld(id); }
    else if (m === 'wren') {
      var wid = b.dataset.id, cur0 = WORLD.get(wid), nm = window.prompt('Название мира', cur0 ? cur0.name : '');
      if (nm !== null) { WORLD.rename(wid, nm); if (wid === worldId) { worldName = (WORLD.get(wid) || {}).name || worldName; updateChip(); } }
    }
    else if (m === 'wdel') {
      var did = b.dataset.id, tag = 'wdel' + did;
      if (confirmArm !== tag) { confirmArm = tag; b.textContent = 'Точно? Мир исчезнет навсегда'; return; }
      confirmArm = ''; deleteWorld(did);
    }
    else if (m === 'wnat') {
      var nid = b.dataset.id, ntag = 'wnat' + nid;
      if (confirmArm !== ntag) { confirmArm = ntag; b.textContent = 'Точно? Деревья и горы займут всю свободную площадь — это не отменить'; return; }
      confirmArm = ''; closeModal(); closeSide(); natureUpgrade(nid);
    }
    else if (m === 'wmake') {
      var nmv = (($('wName') || {}).value || '').trim() || 'Новый мир', demo = !!($('wDemo') || {}).checked; newNature = !!($('wNature') || {}).checked;
      newDemo = demo; b.disabled = true; b.textContent = 'Создаём…';
      if (worldId) saveNow(false);
      createWorld(nmv, newSize, demo, newNature).then(function (id) { closeModal(); closeSide(); return openWorld(id); });
    }
  }
  $('modalBody').addEventListener('click', menuClick);
  $('sbBody').addEventListener('click', menuClick);

  // ---------- Цикл отрисовки ----------
  // Кадр рисуется только когда что-то изменилось — телефон не греется на пустом месте.
  // ---------- Метка «нет дороги» над зданием (красный шар с белой полосой) ----------
  function pinModel(K) {
    var S = Shapes(K, 0, 0), sc = K.scene;
    function glow(name, c, e) { var m = new B.StandardMaterial(name, sc); m.diffuseColor = hex(c); m.emissiveColor = hex(e); m.specularColor = B.Color3.Black(); return m; }
    var red = glow('pinRed', '#e8352b', '#8a1810'), white = glow('pinWhite', '#ffffff', '#9a9a9a');
    var cone = B.MeshBuilder.CreateCylinder('pc', { diameterTop: 0.2, diameterBottom: 0, height: 0.26, tessellation: 16 }, sc);
    cone.position.set(0, 0.13, 0); cone.material = red; S.parts.push(cone);
    var ball = B.MeshBuilder.CreateSphere('ps', { diameter: 0.34, segments: 12 }, sc);
    ball.position.set(0, 0.4, 0); ball.material = red; S.parts.push(ball);
    var band = B.MeshBuilder.CreateCylinder('pb', { diameter: 0.352, height: 0.075, tessellation: 24 }, sc);
    band.position.set(0, 0.4, 0); band.material = white; S.parts.push(band);
    return S.merge();
  }
  function pinBatch() { return getBatch('noroad', function () { return pinModel(kit); }); }
  function pinFor(b) {
    var pb = pinBatch(), bt = placed[b.id];
    var show = bt && !isSite(b) && !hasRoad(b) && !(moving && moving.b.id === b.id);
    if (!show) { batchRemove(pb, b.id); dirty(); return; }
    var p = bPos(b);
    batchSet(pb, b.id, p.x, bt.h + 0.2, p.z, 0, 1.6, 1.6, 1.6);
    dirty();
  }

  // ---------- Миникарта и центр карты (с 0.23.0) ----------
  // Внизу слева: вся карта целиком (север — вверху), над ней — координаты камеры («игрока»). Белая рамка — что сейчас на экране,
  // жёлтая точка — центр экрана, крестик — центр карты. Нажмите или проведите по миникарте — камера переедет туда.
  // Картинка рисуется кусками по мере загрузки карты и остаётся, когда куски выгружаются; в мирах с природой лес и горы дальних кусков дорисовываются заранее.
  var mmCv = $('miniMap'), mmCo = $('miniCo'), mmBuf = document.createElement('canvas'), mmB = mmBuf.getContext('2d'), MMR = 0;
  var mmKnown = {}, mmDirty = {}, mmQueue = null, mmVer = 0, mmSig = '', mmCoT = '', lastMm = 0, mmDrag = false;
  var MM_NATURE = [[127, 179, 90], [62, 125, 58], [166, 160, 148], [118, 123, 132]];           // трава, лес, каменистая земля, гора
  var MM_ROAD = [[201, 164, 107], [176, 160, 128], [88, 94, 104]];                               // простая, булыжник, асфальт
  var mmCatIdx = {}, mmPal = null;
  function mmPalette() {
    if (mmPal) return mmPal;
    mmPal = MM_NATURE.concat(MM_ROAD);
    Object.keys(G.cats).forEach(function (k, i) { mmCatIdx[k] = i; var c = B.Color3.FromHexString(G.cats[k].color); mmPal.push([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]); });
    return mmPal;
  }
  function mmReset() {
    MMR = Math.max(16, Math.min(N, 256));
    mmBuf.width = mmBuf.height = MMR;
    mmB.fillStyle = 'rgb(30,42,59)'; mmB.fillRect(0, 0, MMR, MMR);
    mmKnown = {}; mmDirty = {}; mmQueue = null; mmVer++; mmSig = '';
  }
  // класс клетки: 0 трава, 1 лес, 2 камень, 3 гора, 4–6 дороги, 7+ здания (чем больше номер, тем «главнее» — выигрывает в пикселе)
  function mmClassLoaded(x, z) {
    var i = idx(x, z), o = occ[i];
    if (o) { var bb = byId[o]; return 7 + (bb ? mmCatIdx[bb.cat] | 0 : 0); }
    var r = state.roads[key(x, z)]; if (r) return r === 'asphalt' ? 6 : r === 'cobble' ? 5 : 4;
    var t = terr[i]; if (t === 2) return 3; if (t === 1 || t === 3) return 2;
    return treeA[i] ? 1 : 0;
  }
  function mmPaint(cx, cz, g) { // g — природа куска из TERRAIN.cells (кусок не загружен); без g — берём загруженную карту
    var pal = mmPalette(), s = N / MMR, x0 = cx * WC, z0 = cz * WC, x1 = Math.min(N, x0 + WC), z1 = Math.min(N, z0 + WC), gw = x1 - x0;
    var px0 = Math.floor(x0 / s), px1 = Math.min(MMR, Math.ceil(x1 / s)), pz0 = Math.floor(z0 / s), pz1 = Math.min(MMR, Math.ceil(z1 / s));
    var w = px1 - px0, h = pz1 - pz0; if (w <= 0 || h <= 0) return;
    var img = mmB.createImageData(w, h), d = img.data, st = Math.max(1, Math.floor(s / 3));
    for (var py = 0; py < h; py++) for (var px = 0; px < w; px++) {
      var xa = Math.min(x1 - 1, Math.max(x0, Math.floor((px0 + px) * s))), xb = Math.min(x1, Math.max(xa + 1, Math.ceil((px0 + px + 1) * s)));
      var za = Math.min(z1 - 1, Math.max(z0, Math.floor((pz0 + py) * s))), zb = Math.min(z1, Math.max(za + 1, Math.ceil((pz0 + py + 1) * s))), best = 0;
      for (var zz = za; zz < zb; zz += st) for (var xx = xa; xx < xb; xx += st) {
        var c;
        if (g) { var li = (zz - z0) * gw + (xx - x0), t = g.terr[li]; c = t === 2 ? 3 : (t === 1 || t === 3) ? 2 : g.tree[li] ? 1 : 0; }
        else c = mmClassLoaded(xx, zz);
        if (c > best) best = c;
      }
      var col = pal[best] || pal[0], o = (py * w + px) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    mmB.putImageData(img, px0, pz0); mmVer++;
  }
  function mmTick() {
    if (!state || !worldId || switching || !MMR) return;
    var ck, n = 0;
    for (ck in loaded) {
      if (mmKnown[ck] === 2 && !mmDirty[ck]) continue;
      if (n >= 3) break;
      var L = loaded[ck]; mmPaint(L.x, L.z); mmKnown[ck] = 2; delete mmDirty[ck]; n++;
    }
    if (n || !state.env) return;
    if (!mmQueue) {   // дальние куски: сначала ближние к камере
      var nc = nChunks(), ccx = Math.floor((cam.tx + N / 2) / WC), ccz = Math.floor((cam.tz + N / 2) / WC), cx, cz;
      mmQueue = [];
      for (cz = 0; cz < nc; cz++) for (cx = 0; cx < nc; cx++) mmQueue.push([cx, cz]);
      mmQueue.sort(function (a, b) { return Math.hypot(a[0] - ccx, a[1] - ccz) - Math.hypot(b[0] - ccx, b[1] - ccz); });
    }
    while (mmQueue.length) {
      var q = mmQueue.shift(), k2 = ckey(q[0], q[1]);
      if (mmKnown[k2]) continue;
      var x0 = q[0] * WC, z0 = q[1] * WC, g = TERRAIN.cells(state.env, N, x0, z0, Math.min(N, x0 + WC), Math.min(N, z0 + WC));
      mmPaint(q[0], q[1], g); mmKnown[k2] = 1; break;
    }
  }
  function mmCoordsOf(tx, tz) { return { x: clamp(Math.round(tx), 1, N), z: clamp(Math.round(tz), 1, N) }; }
  function drawMini(force) {
    if (!MMR || !mmCv.clientWidth) return;
    var cw = mmCv.clientWidth, dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(cw * dpr);
    if (mmCv.width !== W) { mmCv.width = W; mmCv.height = W; force = true; }
    var tx = cam.tx + N / 2, tz = cam.tz + N / 2, sig = [Math.round(tx * 2), Math.round(tz * 2), Math.round(cam.yaw * 50), Math.round(cam.dist), N, mmVer, W].join();
    var co = mmCoordsOf(tx, tz), ct = '📍 ' + co.x + ' : ' + co.z;
    if (ct !== mmCoT) { mmCoT = ct; mmCo.textContent = ct; mmCv.title = 'Вы здесь: клетка ' + co.x + ' : ' + co.z + '. Центр карты: ' + Math.round(N / 2) + ' : ' + Math.round(N / 2) + '. Нажмите на миникарту, чтобы перейти.'; }
    if (!force && sig === mmSig) return; mmSig = sig;
    var g = mmCv.getContext('2d'), k = W / N, c = W / 2, a = Math.max(4, W * 0.035);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, W); g.drawImage(mmBuf, 0, 0, W, W);
    // центр карты — крестик
    g.lineCap = 'round';
    [['rgba(0,0,0,.65)', 3], ['rgba(255,255,255,.95)', 1.4]].forEach(function (o) {
      g.strokeStyle = o[0]; g.lineWidth = o[1]; g.beginPath(); g.moveTo(c - a, c); g.lineTo(c + a, c); g.moveTo(c, c - a); g.lineTo(c, c + a); g.stroke();
    });
    // что сейчас на экране
    var rc = canvas.getBoundingClientRect(), P = [[rc.left, rc.top], [rc.right, rc.top], [rc.right, rc.bottom], [rc.left, rc.bottom]].map(function (q) {
      var pp = groundAt(q[0], q[1]); return pp ? [(pp.x + N / 2) * k, (pp.z + N / 2) * k] : null;
    });
    if (P.every(Boolean)) {
      g.beginPath(); P.forEach(function (q, i) { if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath();
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.stroke();
    }
    // игрок (центр экрана)
    var px = clamp(tx * k, 2, W - 2), pz = clamp(tz * k, 2, W - 2), r = Math.max(3, W * 0.03);
    g.beginPath(); g.arc(px, pz, r, 0, 7); g.fillStyle = '#ffc94a'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#1b2433'; g.stroke();
  }
  function mmGo(e) {
    var r = mmCv.getBoundingClientRect(), u = clamp((e.clientX - r.left) / r.width, 0, 1), v = clamp((e.clientY - r.top) / r.height, 0, 1);
    cam.tx = (u - 0.5) * N; cam.tz = (v - 0.5) * N; updateCam(); ensureView(); drawMini(true);
  }
  function mmEnd(e) { if (!mmDrag) return; mmDrag = false; try { mmCv.releasePointerCapture(e.pointerId); } catch (x) {} saveSoft(); }
  mmCv.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); mmDrag = true; try { mmCv.setPointerCapture(e.pointerId); } catch (x) {} mmGo(e); });
  mmCv.addEventListener('pointermove', function (e) { if (mmDrag) { e.preventDefault(); mmGo(e); } });
  mmCv.addEventListener('pointerup', mmEnd); mmCv.addEventListener('pointercancel', mmEnd);
  // Центр карты: кнопка 🎯 «Центр» рядом с «Эпохами», пункт меню ☰ и клавиша 8. Масштаб и поворот камеры остаются.
  function centerCam() {
    if (!state || switching) return;
    cam.tx = 0; cam.tz = 0; updateCam(); ensureView(); drawMini(true); saveSoft();
    var m = Math.round(N / 2); hint('🎯 Вернулись в центр карты · ' + m + ' : ' + m);
  }

  var needRender = true, lastT = performance.now(), lastSave = 0, lastUi = 0, frames = 0, lastView = 0, camSig = '', camT = 0;
  function dirty() { needRender = true; }
  function loop() {
    var t = performance.now(), dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    keyPan(dt); tickCam(dt);
    var active = tickBrigades(dt, t);
    tickFactory(dt); tickWear(dt); tickTraffic(dt); tickSawmills(dt); tickStone(dt); tickJacks(dt);
    var fixingNow = tickRepair(dt, t);
    if ((active || fixingNow) && t - lastSave > 2000) { saveNow(true); lastSave = t; }
    if (t - lastView > 220) { lastView = t; ensureView(); var sg = Math.round(cam.tx) + ',' + Math.round(cam.tz) + ',' + Math.round(cam.dist); if (sg !== camSig) { camSig = sg; camT = t; } else if (camT && t - camT > 2500) { camT = 0; saveSoft(); } }
    if (t - lastUi > 400) {
      lastUi = t;
      if (infoId) { var ib = getB(infoId); if (ib && (isSite(ib) || ib.cat === 'lumber')) renderInfo(ib, true); }
      renderMech(); refreshLive(); updateStock();
      if (!$('panelBuild').hidden) updateBrRow();   // «заняты N из M» меняется, когда бригады уезжают на стройки
    }
    if (t - lastMm > 150) { lastMm = t; mmTick(); drawMini(false); }
    flushRoads(); flushBatches();
    if (needRender) {
      needRender = false;
      scene.render();
      frames++;
      if (!scene.isReady()) needRender = true; // шейдеры ещё собираются — дорисуем следующим кадром
    }
  }
  window.addEventListener('pagehide', function () { saveNow(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(false); });

  // ---------- Старт ----------
  state = emptyState(G.mapSize); // до открытия мира — пустая заготовка
  $('ver').textContent = G.version;
  try { localStorage.removeItem('moe_gorod_view'); } catch (e) {} // старая настройка вида (3D / ИЗО / HD) больше не нужна
  enableHD(); resize();
  $('brImg').innerHTML = thumbImg('brimg', 'truck', truckThumb());   // картинка грузовика в строке «Бригады»
  renderChips(); rebuildAll(); setTool('view');
  camHome();
  engine.runRenderLoop(loop);
  setTimeout(function () { $('loading').classList.add('done'); }, 15000);
  if (window.MMAccount) MMAccount.setup({ app: 'gorod', title: 'Мое_город', toast: function (t) { hint(t); }, ls: ['moe_gorod_prefs'], onRemoteApplied: function () {},
    note: 'Сами миры (карты) хранятся в облаке отдельно — они в разделе «🌍 Миры».' });
  startWorlds();
  // Стук на стройке (с 0.24.0): пока хотя бы одна бригада работает на стройплощадке — изредка слышны удары молотка
  setInterval(function () { if (document.visibilityState === 'visible' && state && state.brigades && state.brigades.some(function (br) { return br.site; })) snd('work'); }, 1400);
  try {
    var seen = localStorage.getItem(SEEN_KEY);
    if (seen !== G.version) {
      openModal(seen ? '<h2>Что нового в ' + G.version + '</h2>' + changelogHtml() : '<h2>Добро пожаловать в «Мое_город»!</h2><p>Нажмите 🏠 «Строить» и купите бригаду (кнопка вверху панели), проложите дорогу и стройте вдоль неё дома и службы. Здание без дороги не работает! Нажмите на любое здание, чтобы узнать, кто там живёт.</p>' + guideHtml(true));
      localStorage.setItem(SEEN_KEY, G.version);
    }
  } catch (e) {}
  window.__gorod = {
    state: function () { return state; }, size: function () { return N; }, world: function () { return worldId; }, loaded: function () { return Object.keys(loaded); }, loading: function () { return Object.keys(loading); }, ensureView: ensureView, beginLog: function () { undoLog = []; }, undo: function () { var l = undoLog; undoLog = null; if (l) undoOps(l); }, delAt: function (x, z) { deleteAt(0, 0, { x: x, z: z }); }, openWorld: openWorld, createWorld: createWorld, natureUpgrade: natureUpgrade, saveNow: saveNow, metaCs: function () { return metaCs; }, ready4: ready4, WC: WC, cam: cam, setTool: setTool, openInfo: function (id) { openInfo(getB(id)); }, updateCam: updateCam,
    road: function (x, z, t) { setRoad(x, z, t); }, stats: updateStats, setTheme: function (id, th) { var b = getB(id); if (b) setBuildingTheme(b, th); }, allTheme: function (th) { state.buildings.forEach(function (b) { setBuildingTheme(b, th); }); },
    scene: scene, buy: buyBrigade, siteAt: function (id, p) { var b = getB(id); b.prog = p; writeBuilding(b); updateSite(b, 0.016); }, openMech: openMech, sim: function () { return sim; }, frames: function () { return frames; },
    batches: function () { return Object.keys(batches).map(function (k) { return k + ':' + batches[k].ids.length; }); },
    wearAll: function (w) { for (var k in state.roads) if (state.roads[k] === 'asphalt') { state.wear[k] = typeof w === 'function' ? w(k) : w; markRoadKey(k); } dirty(); },
    finishAll: function () { state.buildings.forEach(function (b) { if (isSite(b)) { b.prog = 1; finishSite(b); } }); },
    env: function () { return { terr: terr, treeA: treeA, mt: Object.keys(mtMesh).length, cleared: cleared }; }, clearArea: clearArea, canPlace: canPlace, agents: function () { return { veh: agents, cars: carAgents, driving: carsDriving }; }, orderKind: orderKind, rollers: function () { return rollers; }, roadInfo: openRoadInfo, startPlace: startPlace, order: orderTruck, repairAll: repairAllAct, toggleAuto: toggleAuto,
    jackTick: function (n, dt) { for (var i = 0; i < n; i++) tickJacks(dt); },
    jacks: function () { return Object.keys(jacks).map(function (k) { var j = jacks[k]; return j.mode + ' ' + j.x.toFixed(1) + ',' + j.z.toFixed(1) + ' t' + j.tree + ' c' + j.carry; }); },
    place: function (cat, size, x, z) { buildCat = cat; buildSize = size; buildRot = 0; placeBuilding({ px: x + G.sizes[size].w / 2, pz: z + G.sizes[size].d / 2 }); },
    bulk: function (n) { // тест: мгновенно застроить карту n зданиями
      var cats = Object.keys(G.cats), sz = ['1x1', '2x1', '2x2'], made = 0;
      for (var tries = 0; tries < n * 20 && made < n; tries++) {
        var cat = cats[made % cats.length], s = sz[made % 3], f = foot(s, 0), x = Math.floor(Math.random() * (N - f.w)), z = Math.floor(Math.random() * (N - f.d));
        if (!canPlace(s, 0, x, z, 0)) continue;
        var b = { id: state.nextId++, cat: cat, size: s, x: x, z: z, rot: 0, seed: newSeed() };
        state.buildings.push(b); markOcc(b, b.id); touchB(b, true); addBuildingMesh(b); made++;
      }
      updateStats(); save(); return made;
    }
  };
})();
