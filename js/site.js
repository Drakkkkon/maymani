/* Мое_Сайты: показ программ и версий + подключение Google Диска (вход Google, список и скачивание архивов). */
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

  /* Архивы лежат в ветке archives этого репозитория на GitHub: кнопка «Скачать» — обычная ссылка, вход никуда не нужен (2.6.0).
     Закрытый архив с ключами Android — только на Google Диске, туда ведёт простая ссылка. */
  function fileOf(v) { return v.bundle || v.file; }
  function urlOf(v) { return H.archives.base + v.path.split('/').map(encodeURIComponent).join('/'); }

  /* ======================= Карточка версии ======================= */
  function dlHtml(v) {
    var name = fileOf(v);
    if (!v.file) return '<div class="dl"><div class="f"><b>Архива нет</b><span>Эта версия описана в журнале, но файла у меня нет</span></div><span class="btn is-line" aria-disabled="true">Нет файла</span></div>';
    if (v.private) {
      return '<div class="dl"><div class="f"><b>' + esc(H.bundle.file) + '</b><span>общий закрытый архив · ' + esc(fmtSize(H.bundle.size)) + '</span></div>' +
        '<a class="btn is-line" target="_blank" rel="noopener" href="' + esc(H.driveFolder.url) + '">' + DL + 'Открыть на Диске</a>' +
        '<p class="st warn">Внутри ключ подписи приложения и пароль: файл лежит только на вашем закрытом Google Диске, не на GitHub. Одним файлом скачиваются все шесть Android-версий.</p></div>';
    }
    if (v.missing) {
      return '<div class="dl"><div class="f"><b>' + esc(name) + '</b><span>архива пока нет</span></div><span class="btn is-line" aria-disabled="true">Нет архива</span>' +
        '<p class="st no">Этого файла не было ни на Google Диске, ни в истории GitHub. Пришлите его под этим именем — он появится здесь.</p></div>';
    }
    var meta = fmtSize(v.size);
    var sha = v.sha256 ? '<span title="SHA-256 ' + esc(v.sha256) + '">SHA-256 ' + esc(v.sha256.slice(0, 12)) + '…</span>' : '';
    var extra = v.src ? '<span>Собрано из GitHub (коммит ' + esc(v.src) + '), без ваших ключей</span>' : '';
    return '<div class="dl"><div class="f"><b>' + esc(name) + '</b><span>' + esc(meta) + '</span>' + sha + extra + '</div>' +
      '<a class="btn" href="' + esc(urlOf(v)) + '" download="' + esc(name) + '">' + DL + 'Скачать</a></div>';
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
  function bindVersions() {
    document.addEventListener('click', function (e) {
      var m = e.target.closest('[data-more]');
      if (m) { var card = m.closest('.ver'), hid = card.querySelectorAll('li[data-x]'), open = m.getAttribute('data-open') === '1'; hid.forEach(function (li) { li.hidden = open; }); m.setAttribute('data-open', open ? '' : '1'); m.textContent = open ? 'Ещё ' + hid.length + ' ▾' : 'Свернуть ▴'; return; }
    });
  }

  /* ======================= Страницы ======================= */
  /* Разделы сайта: на главной только ссылки, версии разложены по APK, веб и Windows. */
  var TABS = [['index.html', 'Главная'], ['apk.html', 'APK'], ['sites.html', 'Сайты'], ['windows.html', 'Windows']];
  function nav(cur) {
    return '<nav class="tabs" aria-label="Разделы">' + TABS.map(function (t) { return '<a href="' + t[0] + '"' + (t[0] === cur ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav>';
  }
  function head(cur, title, lead) { return '<header class="top">' + nav(cur) + '<h1>' + esc(title) + '</h1><p class="lead">' + esc(lead) + '</p></header>'; }
  function foot() { return '<footer>Страница «' + esc(H.title) + '» ' + esc(H.version) + ' · ' + esc(fmtDate(H.date)) + ' Архивы версий лежат на GitHub (<a href="' + esc(H.archives.tree) + '" target="_blank" rel="noopener">ветка archives</a>).</footer>'; }
  function renderIndex() {
    document.title = H.title;
    var sites = H.programs.filter(function (p) { return p.site; }).map(function (p) {
      return '<li><a class="prog" href="' + esc(p.site) + '" target="_blank" rel="noopener"><img src="' + esc(p.icon) + '" alt="" width="56" height="56"><span><b>' + esc(p.name) + '</b><span class="s">' + esc(p.siteBlurb) + '</span></span><span class="go" aria-hidden="true">↗</span></a></li>';
    }).join('');
    $('#app').innerHTML = head('index.html', H.title, 'Ссылки на все мои сайты и веб-приложения.') + '<ul class="progs links">' + sites + '</ul>' + foot();
  }
  /* Что показывать в разделе. APK внутри zip записан в поле apk. */
  var SECTIONS = {
    apk: { page: 'apk.html', title: 'APK', lead: 'Все версии приложений для Android.', has: function (v) { return v.kind === 'apk' || !!v.apk; },
      show: function (v) { return v.apk ? Object.assign({}, v, v.apk) : v; } },
    web: { page: 'sites.html', title: 'Сайты', lead: 'Все версии веб-сайтов.', has: function (v) { return v.kind === 'web'; } },
    win: { page: 'windows.html', title: 'Windows', lead: 'Программы для компьютера и прочие архивы.', has: function (v) { return v.kind !== 'web' && v.kind !== 'apk' && !v.apk; } }
  };
  function renderSection(id) {
    var S = SECTIONS[id], all = [];
    document.title = S.title + ' — ' + H.title;
    var groups = H.programs.map(function (p) {
      var list = p.versions.filter(S.has);
      if (!list.length) return '';
      /* свежие сверху */
      list.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      var cards = list.map(function (v) { all.push(v); return verHtml(S.show ? S.show(v) : v, all.length - 1, false); }).join('');
      return '<details class="grp"><summary><span class="gn"><img src="' + esc(p.icon) + '" alt="" width="32" height="32">' + esc(p.name) + '</span><span class="n">' + plural(list.length, 'версия', 'версии', 'версий') + '</span></summary><p class="note"><a href="' + esc(p.page) + '">Весь журнал «' + esc(p.name) + '» →</a></p><ul class="vers">' + cards + '</ul></details>';
    }).join('');
    $('#app').innerHTML = head(S.page, S.title, S.lead) + '<div class="tools"><input id="q" type="search" placeholder="Найти программу, версию или слово" aria-label="Поиск по версиям"></div>' + groups + '<p class="note" id="none" hidden>Ничего не найдено.</p>' + foot();
    bindVersions();
    bindSearch();
  }
  function bindSearch() {
    $('#q').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase(), shown = 0;
      document.querySelectorAll('details.grp').forEach(function (d) {
        var name = d.querySelector('summary').textContent.toLowerCase(), any = false;
        d.querySelectorAll('.ver').forEach(function (el) { var ok = !q || name.indexOf(q) >= 0 || el.textContent.toLowerCase().indexOf(q) >= 0; el.hidden = !ok; if (ok) { shown++; any = true; } });
        d.hidden = !any;
        d.open = q ? any : d.hasAttribute('data-def');
      });
      $('#none').hidden = shown > 0;
    });
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
      '<div class="tools"><input id="q" type="search" placeholder="Найти версию или слово в журнале" aria-label="Поиск по версиям"></div>' + groupsHtml +
      '<p class="note" id="none" hidden>Ничего не найдено.</p><footer><a href="index.html">← ' + esc(H.title) + '</a> · Архивы версий лежат на GitHub (<a href="' + esc(H.archives.tree) + '" target="_blank" rel="noopener">ветка archives</a>).</footer>';
    bindVersions();
    bindSearch();
  }

  /* ======================= Настройки приложения Android ======================= */
  /* Круглая кнопка справа внизу есть только внутри APK (там есть window.MSApp); в браузере сайт не меняется. */
  function appSettings() {
    var A = window.MSApp;
    if (!A) return;
    var fab = document.createElement('button'), box = document.createElement('div');
    fab.type = 'button'; fab.className = 'fab'; fab.setAttribute('aria-label', 'Настройки');
    fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.500L6.600 11a7.7 7.7 0 0 0 0 2l-2.1 1.600 2 3.500 2.500-1a7.300 7.300 0 0 0 1.700 1l.400 2.600h4l.400-2.600a7.300 7.300 0 0 0 1.700-1l2.500 1 2-3.500zM13 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7z"/></svg>';
    box.className = 'sheet'; box.hidden = true;
    box.innerHTML = '<div class="panel" role="dialog" aria-label="Настройки"><div class="sh"><h2>Настройки</h2><button type="button" class="btn is-tonal small" data-a="close">Закрыть</button></div>' +
      '<h3>Уведомления</h3><label class="sw"><span>Сообщать о новых версиях</span><input type="checkbox" id="nOn"></label><p class="note" id="nState"></p>' +
      '<div class="row"><button type="button" class="btn small" data-a="check">Проверить сейчас</button><button type="button" class="btn is-tonal small" data-a="test">Пробное уведомление</button><button type="button" class="btn is-line small" data-a="system">Настройки телефона</button></div>' +
      '<h3>Обновление приложения</h3><p class="note" id="uState"></p><div class="row"><button type="button" class="btn small" data-a="ucheck">Проверить обновление</button><button type="button" class="btn small" data-a="install" id="uGo" hidden>Установить</button></div></div>';
    document.body.appendChild(box); document.body.appendChild(fab);
    document.body.classList.add('in-app');
    function read(f) { try { return JSON.parse(A[f]()) || {}; } catch (e) { return {}; } }
    window.msRefresh = function () {
      var n = read('notifyStatus'), u = read('updateStatus');
      $('#nOn').checked = !!n.on;
      $('#nState').textContent = (n.allowed ? 'Разрешены в системе.' : 'Выключены в настройках телефона.') + (n.last ? ' Последняя проверка: ' + n.last + '.' : '');
      $('#uState').textContent = 'Установлена версия ' + (u.installed || '—') + '. ' + (u.text || '');
      $('#uGo').hidden = !u.available;
      $('#uGo').textContent = 'Установить ' + (u.available || '');
    };
    fab.addEventListener('click', function () { box.hidden = false; window.msRefresh(); });
    $('#nOn').addEventListener('change', function () { A.notifySet(this.checked); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'), a = b && b.getAttribute('data-a');
      if (e.target === box || a === 'close') box.hidden = true;
      else if (a === 'check') { $('#nState').textContent = 'Проверяю…'; A.notifyCheck(); }
      else if (a === 'test') A.notifyTest();
      else if (a === 'system') A.notifySettings();
      else if (a === 'ucheck') { $('#uState').textContent = 'Проверяю…'; A.updateCheck(); }
      else if (a === 'install') A.updateInstall();
    });
  }
  appSettings();
  window.Hub = { renderSection: renderSection, renderIndex: renderIndex, renderProgram: renderProgram };
})();
