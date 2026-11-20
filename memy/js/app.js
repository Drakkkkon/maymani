// Мое_мемы — главная логика
const VERSION = '0.1.0 альфа';
const App = (() => {
  const $ = id => document.getElementById(id);
  let catalog = { new: [], classic: [] };
  let sub = 'new';
  let viewing = null;

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function thumbUrl(u) {
    const m = /^https:\/\/i\.imgflip\.com\/([a-z0-9]+)\.\w+$/.exec(u);
    return m ? 'https://i.imgflip.com/4/' + m[1] + '.jpg' : u;
  }

  // ---------- навигация ----------
  function go(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    if (page === 'editor') Editor.render();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav').forEach(n => n.onclick = () => go(n.dataset.page));
  document.querySelectorAll('.subtab').forEach(b => b.onclick = () => {
    sub = b.dataset.sub;
    document.querySelectorAll('.subtab').forEach(x => x.classList.toggle('active', x === b));
    renderGrid();
  });
  $('search').addEventListener('input', () => renderGrid());

  // ---------- сетка ----------
  function card(t) {
    const d = document.createElement('div');
    d.className = 'card';
    const img = document.createElement('img');
    img.className = 'thumb'; img.loading = 'lazy'; img.alt = t.name;
    img.src = thumbUrl(t.url);
    img.onerror = () => { if (img.src !== t.url) img.src = t.url; };
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = t.name;
    const fv = document.createElement('button');
    fv.className = 'fav' + (Favs.has(t.id) ? ' on' : ''); fv.textContent = '♥'; fv.title = 'В избранное';
    fv.onclick = e => {
      e.stopPropagation();
      const on = Favs.toggle(t); fv.classList.toggle('on', on);
      toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
      if (sub === 'fav') renderGrid();
    };
    d.append(img, nm, fv);
    d.onclick = () => openTemplate(t);
    return d;
  }
  function filter(list) {
    const q = $('search').value.trim().toLowerCase();
    return q ? list.filter(t => t.name.toLowerCase().includes(q)) : list;
  }
  async function renderGrid() {
    const g = $('grid'); g.innerHTML = '';
    const empty = $('empty');
    $('saved-block').classList.toggle('hidden', sub !== 'fav');
    let list;
    if (sub === 'fav') {
      await renderSaved();
      list = filter(Favs.list());
    } else list = filter(catalog[sub] || []);
    list.forEach(t => g.appendChild(card(t)));
    $('count').textContent = sub === 'fav' ? '' : 'Шаблонов: ' + list.length;
    empty.classList.toggle('hidden', list.length > 0);
    empty.innerHTML = sub === 'fav'
      ? 'Избранных шаблонов пока нет.<br>Нажми ♥ на любой картинке в «Новые» или «Классика».'
      : 'Ничего не найдено. Названия мемов — на английском (например: drake, cat, dog).';
  }
  async function renderSaved() {
    const g = $('saved-grid'); g.innerHTML = '';
    let items = [];
    try { items = await DB.all(); } catch (e) {}
    const q = $('search').value.trim().toLowerCase();
    if (q) items = items.filter(i => (i.name || '').toLowerCase().includes(q));
    if (!items.length) {
      g.innerHTML = '<div class="hint" style="grid-column:1/-1">Здесь появятся мемы, которые ты сохранишь в редакторе.</div>';
      return;
    }
    items.forEach(it => {
      const d = document.createElement('div'); d.className = 'card';
      const img = document.createElement('img'); img.className = 'thumb'; img.src = it.thumb; img.alt = it.name;
      const nm = document.createElement('div'); nm.className = 'name';
      nm.textContent = (it.name || 'Мем') + ' · ' + new Date(it.created).toLocaleDateString('ru-RU');
      d.append(img, nm);
      d.onclick = () => openViewer(it);
      g.appendChild(d);
    });
  }

  // ---------- открыть в редакторе ----------
  function openTemplate(t) {
    go('editor');
    Editor.openSource({ type: 'url', url: t.url, name: t.name });
  }
  function onUpload(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    go('editor');
    Editor.openSource({ type: 'blob', blob: f, name: f.name.replace(/\.\w+$/, '') });
  }
  $('upload').onchange = onUpload;
  $('upload2').onchange = onUpload;
  $('new-btn').onclick = () => {
    if (Editor.hasContent() && !confirm('Начать новый пустой мем? Несохранённые изменения пропадут.')) return;
    Editor.blank();
  };

  // ---------- сохранение ----------
  function fileName() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return 'meme_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.jpg';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function getJpeg() {
    try { return await Editor.exportBlob(0.92); }
    catch (e) { toast('Не получилось сохранить картинку (защита сайта-источника).'); throw e; }
  }
  $('save-db').onclick = async () => {
    if (!Editor.hasContent()) { toast('Пустой холст'); return; }
    const blob = await getJpeg();
    const S = Editor.S;
    const item = {
      id: 'm' + Date.now(), created: Date.now(), name: Editor.name(),
      blob, thumb: await Editor.thumbFrom(blob), project: Editor.project(),
      src: S.src ? (S.src.type === 'url' ? { type: 'url', url: S.src.url, name: S.src.name } : { type: 'blob', blob: S.src.blob, name: S.src.name }) : null
    };
    try { await DB.put(item); toast('Сохранено на сайте → Мемы › Избранное'); }
    catch (e) { toast('Ошибка сохранения в базу'); }
  };
  $('save-jpg').onclick = async () => {
    if (!Editor.hasContent()) { toast('Пустой холст'); return; }
    const blob = await getJpeg();
    download(blob, fileName());
    toast('JPEG скачан в «Загрузки»');
  };
  if (navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/jpeg' })], 'a.jpg', { type: 'image/jpeg' })] })) {
    $('share-jpg').classList.remove('hidden');
    $('share-jpg').onclick = async () => {
      const blob = await getJpeg();
      const file = new File([blob], fileName(), { type: 'image/jpeg' });
      try { await navigator.share({ files: [file], title: 'Мем' }); } catch (e) {}
    };
  }

  // ---------- просмотр сохранённого ----------
  function openViewer(it) {
    viewing = it;
    const img = $('viewer-img');
    if (img._url) URL.revokeObjectURL(img._url);
    img._url = URL.createObjectURL(it.blob); img.src = img._url;
    $('viewer').classList.remove('hidden');
  }
  function closeViewer() { $('viewer').classList.add('hidden'); viewing = null; }
  $('v-close').onclick = closeViewer;
  $('viewer').onclick = e => { if (e.target.id === 'viewer') closeViewer(); };
  $('v-dl').onclick = () => { if (viewing) { download(viewing.blob, fileName()); toast('JPEG скачан'); } };
  $('v-del').onclick = async () => {
    if (!viewing || !confirm('Удалить этот мем из базы сайта?')) return;
    await DB.del(viewing.id); closeViewer(); renderGrid(); toast('Удалено');
  };
  $('v-edit').onclick = () => {
    if (!viewing) return;
    const it = viewing; closeViewer();
    if (!it.src) { toast('У этого мема нет исходной картинки'); return; }
    go('editor');
    Editor.openSource(Object.assign({}, it.src), it.project);
  };

  // ---------- старт ----------
  async function init() {
    $('ver').textContent = 'v' + VERSION;
    Editor.init();
    try {
      const r = await fetch('data/catalog.json?v=' + encodeURIComponent(VERSION));
      catalog = await r.json();
    } catch (e) { toast('Не удалось загрузить список мемов'); }
    renderGrid();
  }
  window.addEventListener('DOMContentLoaded', init);
  return { toast, go };
})();
