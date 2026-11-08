/* Мое_сайты: показ программ и версий + подключение Google Диска (вход Google, список и скачивание архивов). */
(function () {
  'use strict';
  var H = window.HUB, $ = function (s, r) { return (r || document).querySelector(s); };
  var DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, a, b, c) { var m = n % 100, k = n % 10; return n + ' ' + (m > 10 && m < 15 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c); }
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function fmtSize(n) { if (!n) return ''; return n >= 1048576 ? (n / 1048576).toFixed(2).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  function vlabel(v) { return v && v.v && v.v !== '—' ? 'Версия ' + v.v : (v && v.name) || 'Без номера версии'; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища тоже работаем */ } }

  /* ======================= Google Диск ======================= */
  var Cloud = { token: '', until: 0, files: null, state: 'off', error: '', count: 0, total: 0, client: null };
  var subs = [];
  function notify() { subs.forEach(function (f) { f(); }); }
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function loadGis() {
    return new Promise(function (res, rej) {
      if (gisReady()) return res();
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { gisReady() ? res() : rej(new Error('Вход Google не загрузился')); };
      s.onerror = function () { rej(new Error('Не удалось загрузить вход Google: проверьте интернет и блокировщики рекламы')); };
      document.head.appendChild(s);
    });
  }
  function haveToken() { return !!Cloud.token && Date.now() < Cloud.until; }
  function connect() {
    Cloud.state = 'busy'; Cloud.error = ''; notify();
    return loadGis().then(function () {
      return new Promise(function (resolve) {
        Cloud.client = Cloud.client || google.accounts.oauth2.initTokenClient({
          client_id: H.clientId, scope: H.scope,
          callback: function (r) { Cloud._cb && Cloud._cb(r); },
          error_callback: function (e) { Cloud._cb && Cloud._cb({ error: (e && e.type) || 'error' }); }
        });
        Cloud._cb = function (r) { resolve(r); };
        Cloud.client.requestAccessToken({ prompt: '' });
      });
    }).then(function (r) {
      if (!r || r.error || !r.access_token) {
        var e = r && r.error || '';
        throw new Error(e === 'popup_closed' || e === 'access_denied' ? 'Вход отменён' : e === 'popup_failed_to_open' ? 'Браузер заблокировал окно входа: разрешите всплывающие окна для этого сайта' : 'Google не пустил: ' + (r && (r.error_description || r.error) || 'неизвестная ошибка'));
      }
      Cloud.token = r.access_token; Cloud.until = Date.now() + ((+r.expires_in || 3600) - 60) * 1000; lsSet('hub_cloud', '1');
      return refresh();
    }).catch(function (e) { Cloud.state = 'err'; Cloud.error = e.message || String(e); notify(); });
  }
  function drive(path, opt) {
    if (!haveToken()) { Cloud.state = 'exp'; Cloud.token = ''; notify(); return Promise.reject(new Error('Сессия Google закончилась')); }
    var o = opt || {}; o.headers = Object.assign({ Authorization: 'Bearer ' + Cloud.token }, o.headers || {});
    return fetch('https://www.googleapis.com/drive/v3/' + path, o).then(function (r) {
      if (r.status === 401) { Cloud.token = ''; Cloud.state = 'exp'; notify(); throw new Error('Сессия Google закончилась'); }
      if (r.status === 403) { throw new Error('Google Drive API отказал (403): включите Google Drive API в проекте Google Cloud и добавьте свой адрес в «Test users»'); }
      if (!r.ok) throw new Error('Диск ответил ошибкой ' + r.status);
      return r;
    });
  }
  function refresh() {
    Cloud.state = 'busy'; notify();
    var files = {}, pages = 0;
    function page(tok) {
      var q = "trashed=false and mimeType!='application/vnd.google-apps.folder' and (mimeType='application/zip' or mimeType='application/x-zip-compressed' or mimeType='application/octet-stream')";
      var p = new URLSearchParams({ q: q, pageSize: '1000', fields: 'nextPageToken,files(id,name,size,modifiedTime)', orderBy: 'modifiedTime desc', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (tok) p.set('pageToken', tok);
      return drive('files?' + p.toString()).then(function (r) { return r.json(); }).then(function (j) {
        (j.files || []).forEach(function (f) { if (!files[f.name]) files[f.name] = f; });
        if (j.nextPageToken && ++pages < 10) return page(j.nextPageToken);
      });
    }
    return page('').then(function () { Cloud.files = files; Cloud.state = 'on'; var seen = {}; Cloud.count = 0; Cloud.total = 0; (H.programs || []).forEach(function (p) { p.versions.forEach(function (v) { var n = v.bundle || v.file; if (!n || seen[n]) return; seen[n] = 1; Cloud.total++; if (files[n]) Cloud.count++; }); }); notify(); })
      .catch(function (e) { if (Cloud.state !== 'exp') { Cloud.state = 'err'; Cloud.error = e.message; } notify(); });
  }
  function disconnect() {
    try { if (Cloud.token && gisReady()) google.accounts.oauth2.revoke(Cloud.token, function () {}); } catch (e) { /* ничего */ }
    Cloud.token = ''; Cloud.files = null; Cloud.state = 'off'; Cloud.error = ''; lsSet('hub_cloud', ''); notify();
  }
  function saveBlob(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }
  function fileOf(v) { return v.bundle || v.file; }
  function downloadFrom(v, btn) {
    var f = Cloud.files && Cloud.files[fileOf(v)]; if (!f) return;
    var old = btn.innerHTML; btn.disabled = true; btn.textContent = 'Скачиваю…';
    drive('files/' + encodeURIComponent(f.id) + '?alt=media&supportsAllDrives=true').then(function (r) { return r.blob(); })
      .then(function (b) { saveBlob(b, f.name); })
      .catch(function (e) { Cloud.error = e.message; if (Cloud.state !== 'exp') Cloud.state = 'err'; notify(); })
      .then(function () { btn.disabled = false; btn.innerHTML = old; });
  }

  /* ======================= Блок «Google Диск» ======================= */
  function cloudHtml() {
    var wrongOrigin = location.origin !== H.origin;
    var s = Cloud.state, txt, acts = '';
    if (s === 'on') { txt = '<b>Google Диск подключён.</b> Нашёл ваших архивов: ' + Cloud.count + ' из ' + Cloud.total + '. Кнопки «Скачать» берут файлы прямо с вашего Диска.'; acts = '<button class="btn small is-tonal" data-a="refresh">Обновить список</button><button class="btn small is-line" data-a="out">Отключить</button>'; }
    else if (s === 'busy') { txt = 'Связываюсь с Google Диском…'; }
    else if (s === 'exp') { txt = '<b>Вход Google закончился</b> (он действует час). Подключитесь ещё раз, это одно нажатие.'; acts = '<button class="btn small" data-a="in">Подключить снова</button>'; }
    else { txt = '<b>Google Диск не подключён.</b> Архивов на GitHub нет, они лежат на вашем Google Диске. ' + (lsGet('hub_cloud') ? 'Нажмите, чтобы продолжить.' : 'Подключите Диск, чтобы скачивать напрямую и видеть, каких файлов на Диске не хватает.'); acts = '<button class="btn small" data-a="in">Подключить Google Диск</button>'; }
    return '<div class="cloud" data-s="' + esc(s === 'on' ? 'on' : s === 'err' ? 'err' : s === 'busy' ? 'busy' : 'off') + '"><div class="st"><span class="dot"></span><div>' + txt + '</div></div>' +
      (Cloud.error ? '<p class="err">' + esc(Cloud.error) + '</p>' : '') + (acts ? '<div class="acts">' + acts + '</div>' : '') +
      (wrongOrigin ? '<p class="hint">Вход Google настроен для адреса ' + esc(H.origin) + '. Сейчас открыт другой адрес, поэтому вход может не сработать.</p>' : '') +
      '<p class="hint"><a href="' + esc(H.driveFolder.url) + '" target="_blank" rel="noopener">Открыть папку «' + esc(H.driveFolder.name) + '» на Диске</a></p></div>';
  }
  function mountCloud() {
    var host = $('#cloud'); if (!host) return;
    function draw() { host.innerHTML = cloudHtml(); }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'in') connect(); else if (a === 'refresh') refresh(); else if (a === 'out') disconnect();
    });
    subs.push(draw); draw();
  }

  /* ======================= Карточка версии ======================= */
  function dlHtml(v) {
    var name = fileOf(v);
    if (!v.file) return '<div class="dl"><div class="f"><b>Архива нет</b><span>Эта версия описана в журнале, но файла у меня нет</span></div><span class="btn is-line" aria-disabled="true">Нет файла</span></div>';
    var meta = [v.private ? 'общий закрытый архив' : '', fmtSize(v.private ? H.bundle.size : v.size)].filter(Boolean).join(' · ');
    var sha = (v.private ? '' : v.sha256) ? '<span title="SHA-256 ' + esc(v.sha256) + '">SHA-256 ' + esc(v.sha256.slice(0, 12)) + '…</span>' : '';
    var extra = v.src ? '<span>Собрано из GitHub (коммит ' + esc(v.src) + '), без ваших ключей</span>' : '';
    var warn = v.private ? '<p class="st warn">Внутри ключ подписи приложения и пароль: файл лежит только на закрытом Диске, не на GitHub. Одним файлом скачиваются все шесть Android-версий.</p>' : '';
    return '<div class="dl" data-file="' + esc(name) + '"><div class="f"><b>' + esc(name) + '</b><span>' + esc(meta) + '</span>' + sha + extra + '</div><span class="act"></span>' + warn + '<p class="st" data-st></p></div>';
  }
  function verHtml(v, idx, open) {
    var items = v.items || [], first = open ? 4 : 1;
    var li = items.map(function (t, i) { return '<li' + (i >= first ? ' hidden data-x' : '') + '>' + esc(t) + '</li>'; }).join('');
    var more = items.length > first ? '<button type="button" class="more" data-more>Ещё ' + (items.length - first) + ' ▾</button>' : '';
    var shots = (v.shots && v.shots.length) ? '<div class="shots">' + v.shots.map(function (s) { return '<figure><a href="' + esc(s.src) + '" target="_blank" rel="noopener"><img src="' + esc(s.src) + '" alt="' + esc(s.cap) + '" loading="lazy"></a><figcaption>' + esc(s.cap) + '</figcaption></figure>'; }).join('') + '</div>' : '';
    var when = [fmtDate(v.date), v.time].filter(Boolean).join(', ');
    var tags = (v.flag ? '<span class="pill warn">' + esc(v.flag) + '</span>' : '');
    var warn = v.warn ? '<p class="note">' + esc(v.warn) + '</p>' : '';
    return '<li class="ver" id="v' + idx + '" data-vi="' + idx + '"><div class="vh"><span class="vb">' + esc(v.v && v.v !== '—' ? v.v : (v.name || 'Без номера')) + '</span>' + (v.name && v.v && v.v !== '—' ? '<span class="vn">«' + esc(v.name) + '»</span>' : '') + tags + '<span class="vd">' + esc(when) + '</span></div>' +
      '<ul class="items">' + li + '</ul>' + more + shots + warn + dlHtml(v) + '</li>';
  }
  function applyButtons(prog) {
    document.querySelectorAll('.ver').forEach(function (el) {
      var v = prog.versions[+el.getAttribute('data-vi')], box = el.querySelector('.dl[data-file]'); if (!box) return;
      var act = box.querySelector('.act'), st = box.querySelector('[data-st]'), name = fileOf(v), f = Cloud.files && Cloud.files[name];
      var label = v.private ? 'Скачать общий архив' : 'Скачать';
      if (Cloud.files && f) {
        act.innerHTML = '<button type="button" class="btn" data-dl>' + DL + label + '</button>'; st.className = 'st ok'; st.textContent = '✓ Есть на вашем Диске' + (f.size ? ' · ' + fmtSize(+f.size) : '');
      } else if (Cloud.files && !f) {
        act.innerHTML = '<span class="btn is-line" aria-disabled="true">Нет на Диске</span>'; st.className = 'st no'; st.textContent = 'Файла «' + name + '» на Диске не нашлось: загрузите его в папку «' + H.driveFolder.name + '».';
      } else {
        var href = v.driveId ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(v.driveId) : 'https://drive.google.com/drive/search?q=' + encodeURIComponent(name);
        act.innerHTML = '<a class="btn" target="_blank" rel="noopener" href="' + esc(href) + '">' + DL + (v.driveId ? label : 'Найти на Диске') + '</a>';
        st.className = 'st'; st.textContent = v.driveId ? '' : 'Подключите Google Диск выше — тогда скачивание и проверка наличия пойдут прямо отсюда.';
      }
    });
  }
  function bindVersions(prog) {
    document.addEventListener('click', function (e) {
      var m = e.target.closest('[data-more]');
      if (m) { var card = m.closest('.ver'), hid = card.querySelectorAll('li[data-x]'), open = m.getAttribute('data-open') === '1'; hid.forEach(function (li) { li.hidden = open; }); m.setAttribute('data-open', open ? '' : '1'); m.textContent = open ? 'Ещё ' + hid.length + ' ▾' : 'Свернуть ▴'; return; }
      var d = e.target.closest('[data-dl]');
      if (d) { var el = d.closest('.ver'); downloadFrom(prog.versions[+el.getAttribute('data-vi')], d); }
    });
    subs.push(function () { applyButtons(prog); });
  }

  /* ======================= Страницы ======================= */
  function renderIndex() {
    document.title = H.title;
    var list = H.programs.map(function (p) {
      var v0 = p.versions[0]; var vs = p.versions.length;
      return '<li><a class="prog" href="' + esc(p.page) + '"><img src="' + esc(p.icon) + '" alt="" width="56" height="56"><span><b>' + esc(p.name) + '</b><span class="s">' + esc(vlabel(v0)) + (v0.date ? ' · ' + esc(fmtDate(v0.date)) : '') + '</span><span class="s">' + plural(vs, 'версия', 'версии', 'версий') + ' с журналом и скачиванием</span></span><span class="go" aria-hidden="true">›</span></a></li>';
    }).join('');
    var sites = H.programs.filter(function (p) { return p.site; }).map(function (p) {
      return '<li><img src="' + esc(p.icon) + '" alt="" width="40" height="40"><div><a href="' + esc(p.site) + '" target="_blank" rel="noopener">' + esc(p.name) + ' ↗</a><p>' + esc(p.siteBlurb) + '</p></div></li>';
    }).join('');
    $('#app').innerHTML = '<header class="top"><h1>' + esc(H.title) + '</h1><p class="lead">Все версии моих программ: журнал изменений и кнопка «Скачать» в одной карточке. Файлы лежат на Google Диске.</p></header>' +
      '<div id="cloud"></div><section><h2>Программы</h2><ul class="progs">' + list + '</ul></section>' +
      '<aside class="sites" aria-label="Мои сайты"><h2>Мои сайты</h2><ul>' + sites + '</ul></aside>' +
      '<footer>Страница «' + esc(H.title) + '» ' + esc(H.version) + ' · ' + esc(fmtDate(H.date)) + ' Архивов на GitHub нет: версии хранятся только на Google Диске.</footer>';
    mountCloud();
  }
  function renderProgram(id) {
    var prog = H.programs.filter(function (p) { return p.id === id; })[0];
    if (!prog) { $('#app').innerHTML = '<p>Программа не найдена. <a href="index.html">На главную</a></p>'; return; }
    document.title = prog.name + ' — ' + H.title;
    var v0 = prog.versions[0], order = Object.keys(prog.groups), idx = {};
    prog.versions.forEach(function (v, i) { (idx[v.group || 'main'] = idx[v.group || 'main'] || []).push(i); });
    var groupsHtml = order.filter(function (g) { return idx[g]; }).map(function (g, gi) {
      var cards = idx[g].map(function (i, k) { return verHtml(prog.versions[i], i, gi === 0 && k < 3); }).join('');
      return '<details class="grp"' + (gi === 0 ? ' open data-def' : '') + '><summary><span>' + esc(prog.groups[g]) + '</span><span class="n">' + plural(idx[g].length, 'версия', 'версии', 'версий') + '</span></summary><ul class="vers">' + cards + '</ul></details>';
    }).join('');
    var chips = '<li class="chip is-fill">' + esc(vlabel(v0)) + '</li>' + (v0.date ? '<li class="chip">' + esc(fmtDate(v0.date)) + '</li>' : '') + '<li class="chip">' + plural(prog.versions.length, 'версия', 'версии', 'версий') + '</li>' + (prog.site ? '<li><a class="chip" href="' + esc(prog.site) + '" target="_blank" rel="noopener">Открыть сайт ↗</a></li>' : '');
    $('#app').innerHTML = '<header class="top"><a class="back" href="index.html">← ' + esc(H.title) + '</a><div class="phead"><img src="' + esc(prog.icon) + '" alt="" width="56" height="56"><h1>' + esc(prog.name) + '</h1></div><p class="lead">' + esc(prog.blurb) + '</p><ul class="chips">' + chips + '</ul></header>' +
      '<div id="cloud"></div><div class="tools"><input id="q" type="search" placeholder="Найти версию или слово в журнале" aria-label="Поиск по версиям"></div>' + groupsHtml +
      '<p class="note" id="none" hidden>Ничего не найдено.</p><footer><a href="index.html">← ' + esc(H.title) + '</a> · Архивов на GitHub нет: версии хранятся только на Google Диске.</footer>';
    mountCloud(); bindVersions(prog); applyButtons(prog);
    $('#q').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase(), shown = 0;
      document.querySelectorAll('.ver').forEach(function (el) { var ok = !q || el.textContent.toLowerCase().indexOf(q) >= 0; el.hidden = !ok; if (ok) shown++; });
      document.querySelectorAll('details.grp').forEach(function (d) { d.open = q ? !!d.querySelector('.ver:not([hidden])') : d.hasAttribute('data-def'); });
      $('#none').hidden = shown > 0;
    });
  }
  window.Hub = { renderIndex: renderIndex, renderProgram: renderProgram, Cloud: Cloud };
})();
