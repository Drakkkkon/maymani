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
  function bindVersions(prog) {
    document.addEventListener('click', function (e) {
      var m = e.target.closest('[data-more]');
      if (m) { var card = m.closest('.ver'), hid = card.querySelectorAll('li[data-x]'), open = m.getAttribute('data-open') === '1'; hid.forEach(function (li) { li.hidden = open; }); m.setAttribute('data-open', open ? '' : '1'); m.textContent = open ? 'Ещё ' + hid.length + ' ▾' : 'Свернуть ▴'; return; }
    });
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
    $('#app').innerHTML = '<header class="top"><h1>' + esc(H.title) + '</h1><p class="lead">Все версии моих программ: журнал изменений и кнопка «Скачать» в одной карточке. Архивы лежат на GitHub, кнопка «Скачать» работает сразу.</p></header>' +
      '<section><h2>Программы</h2><ul class="progs">' + list + '</ul></section>' +
      '<aside class="sites" aria-label="Мои сайты"><h2>Мои сайты</h2><ul>' + sites + '</ul></aside>' +
      '<footer>Страница «' + esc(H.title) + '» ' + esc(H.version) + ' · ' + esc(fmtDate(H.date)) + ' Архивы версий лежат на GitHub (<a href="' + esc(H.archives.tree) + '" target="_blank" rel="noopener">ветка archives</a>).</footer>';
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
    bindVersions(prog);
    $('#q').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase(), shown = 0;
      document.querySelectorAll('.ver').forEach(function (el) { var ok = !q || el.textContent.toLowerCase().indexOf(q) >= 0; el.hidden = !ok; if (ok) shown++; });
      document.querySelectorAll('details.grp').forEach(function (d) { d.open = q ? !!d.querySelector('.ver:not([hidden])') : d.hasAttribute('data-def'); });
      $('#none').hidden = shown > 0;
    });
  }
  window.Hub = { renderIndex: renderIndex, renderProgram: renderProgram };
})();
