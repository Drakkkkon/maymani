'use strict';
/* С 1.4.0: чтение статьи целиком, перевод, стоп-слова, повторы, «Главное», размер шрифта, свайпы. */

/* ---------- стоп-слова ---------- */
const isStopped = i => !!set.stop && FeedLite.stopped({title: i.title, text: plain(i.html)}, set.stop);

/* ---------- повторы ---------- */
const keyWords = new WeakMap();
function titleKey(it) {
  let k = keyWords.get(it);
  if (!k || k.title !== it.title) {
    let t = it.title;
    if (isGNews(it)) t = t.replace(/\s+[-–—]\s+[^-–—]+$/, ''); // «Заголовок - Издание»
    // первые буквы слова: «тенге» и «теңге» не склеятся, а окончания не мешают
    const set_ = new Set((t.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 2 || /\d/.test(w)).map(w => /\d/.test(w) ? w : w.slice(0, 5)));
    keyWords.set(it, k = {title: it.title, words: set_, nums: [...set_].filter(w => /\d/.test(w)).sort().join()});
  }
  return k;
}
function sameStory(a, b) {
  if (a.feed === b.feed && !isGNews(a)) return false;
  if (a.link && a.link === b.link) return true;
  if (Math.abs(a.date - b.date) > 48 * 3600000) return false;
  const x = titleKey(a), y = titleKey(b);
  // разные цифры — разные новости (версии, номера выпусков, курсы)
  if (x.nums !== y.nums || x.words.size < 4 || y.words.size < 4) return false;
  let n = 0;
  for (const w of x.words) if (y.words.has(w)) n++;
  return n / (x.words.size + y.words.size - n) >= 0.6;
}
let dups = new Map();
function groupStories(list) {
  dups = new Map();
  if (!set.dedup) return list;
  const out = [], byWord = new Map();
  for (const it of list) {
    const words = [...titleKey(it).words];
    const near = new Set(words.flatMap(w => byWord.get(w) || []));
    const head = [...near].find(h => sameStory(h, it));
    if (head) { if (!dups.has(head)) dups.set(head, []); dups.get(head).push(it); continue; }
    out.push(it);
    for (const w of words) { if (!byWord.has(w)) byWord.set(w, []); byWord.get(w).push(it); }
  }
  return out;
}
function markRead(it, value = true) { for (const i of [it, ...(dups.get(it) || [])]) i.read = value; }
function dupsHtml(it) {
  const list = dups.get(it);
  if (!list) return '';
  const name = i => feeds.find(f => f.url === i.feed)?.title || hostOf(i.feed);
  return `<details class="dups"><summary>Ещё об этом: ${list.length}</summary><ul>${list.map(i => `<li><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a> <span class="meta">${esc(name(i))}</span></li>`).join('')}</ul></details>`;
}

/* ---------- главное за день ---------- */
function topStories(list) {
  const day = Date.now() - 24 * 3600000;
  const score = i => (isHit(i) ? 100 : 0) + (dups.get(i)?.length || 0) * 20 + (i.date - day) / 3600000;
  const perFeed = {};
  return list.filter(i => i.date > day && (!i.read || open.has(i)) && i.feed !== HUB_FEED)
    .sort((a, b) => score(b) - score(a))
    .filter(i => (perFeed[i.feed] = (perFeed[i.feed] || 0) + 1) <= 3).slice(0, 15);
}

/* ---------- перевод ---------- */
const isForeign = text => { const lat = (text.match(/[a-z]/gi) || []).length, cyr = (text.match(/[а-яёәіңғүұқөһ]/gi) || []).length; return lat > 15 && lat > cyr * 2; };
function pieces(text, max) {
  const out = [''];
  for (let s of text.split(/(?<=[.!?…\n])/)) {
    while (s.length > max) { let at = s.lastIndexOf(' ', max); if (at < max / 2) at = max; out.push(s.slice(0, at)); s = s.slice(at); }
    if (out.at(-1).length + s.length > max) out.push('');
    out[out.length - 1] += s;
  }
  return out.filter(s => s.trim());
}
async function viaGoogle(text) {
  const out = [];
  for (const p of pieces(text, 1500)) {
    const j = JSON.parse(await get('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=' + encodeURIComponent(p)));
    out.push(j[0].map(x => x[0]).join(''));
  }
  return out.join(' ');
}
async function viaMyMemory(text) {
  const out = [];
  for (const p of pieces(text, 450)) {
    const j = JSON.parse(await get('https://api.mymemory.translated.net/get?langpair=en|ru&q=' + encodeURIComponent(p)));
    if (+j.responseStatus !== 200 || /MYMEMORY WARNING/.test(j.responseData.translatedText)) throw new Error('лимит');
    out.push(j.responseData.translatedText);
  }
  return out.join(' ');
}
async function translate(text) {
  try { return await viaGoogle(text); }
  catch {
    if (text.length > 3000) throw new Error('переводчик сейчас не отвечает, попробуйте позже');
    try { return await viaMyMemory(text); } catch { throw new Error('переводчики сейчас не отвечают, попробуйте позже'); }
  }
}
// абзацы переводим пачкой, чтобы не потерять разбивку
const paragraphs = html => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,pre').forEach(x => x.remove());
  doc.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr,blockquote').forEach(x => x.append('\n'));
  return (doc.body.textContent || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
};
const translations = new WeakMap();
const trHtml = tr => `<div class="tr"><div class="meta">Перевод</div><p><b>${esc(tr.title)}</b></p>${tr.body.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
async function translateItem(it, html, button) {
  button.disabled = true; button.textContent = 'Перевожу…';
  try {
    const body = paragraphs(html).join('\n').slice(0, 9000);
    const text = await translate(it.title + '\n' + body);
    const [title, ...rest] = text.split('\n').filter(s => s.trim());
    return {title, body: rest};
  } catch (e) { toast('Не получилось перевести: ' + e.message); button.disabled = false; button.textContent = '🌐 Перевести'; return null; }
}

/* ---------- статья целиком ---------- */
const articles = new Map();
let reading = null;
async function loadArticle(it) {
  if (articles.has(it.link)) return articles.get(it.link);
  if (isGNews(it)) throw new Error('Google Новости прячут адрес статьи. Нажмите «Открыть на сайте».');
  const html = await fetchText(it.link, t => /<(p|article)[\s>]/i.test(t));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // картинки с отложенной загрузкой
  doc.querySelectorAll('img[data-src]').forEach(i => i.setAttribute('src', i.getAttribute('data-src')));
  // короткие адреса считаем от страницы статьи: Readability отсчитал бы их от нашего сайта
  const base = safeUrl(doc.querySelector('base[href]')?.getAttribute('href'), it.link) || it.link;
  for (const name of ['src', 'href']) doc.querySelectorAll(`img[${name}], a[${name}]`).forEach(el => {
    const url = safeUrl(el.getAttribute(name), base);
    url ? el.setAttribute(name, url) : el.removeAttribute(name);
  });
  doc.querySelectorAll('img[srcset], source[srcset]').forEach(el => el.removeAttribute('srcset'));
  const found = new Readability(doc).parse();
  if (!found || found.textContent.trim().length < 300) throw new Error('не получилось выделить текст статьи. Нажмите «Открыть на сайте».');
  const body = clean(found.content, it.link);
  articles.set(it.link, body);
  return body;
}
const readerText = () => reading.full || clean(reading.it.html, reading.it.link || reading.it.feed);
function drawReader() {
  const {it, status, tr} = reading, text = readerText(), el = $('#reader');
  el.innerHTML = `<div class="rbar"><button data-r="back">← Назад</button><button data-r="speak">🔊 Озвучить</button>${isForeign(it.title + ' ' + plain(text)) && !tr ? '<button data-r="tr">🌐 Перевести</button>' : ''}<button data-r="fav" aria-label="В избранное">${it.fav ? '★' : '☆'}</button></div>
<article class="rbody"><h2>${esc(it.title)}</h2><p class="meta">${esc(feeds.find(f => f.url === it.feed)?.title || hostOf(it.feed))} · ${new Date(it.date).toLocaleString('ru-RU', {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'})}</p>
${status ? `<p class="meta" role="status">${esc(status)}</p>` : ''}${tr ? trHtml(tr) + '<hr>' : ''}${text}
${it.link ? `<p><a class="btn" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">Открыть на сайте ↗</a></p>` : ''}</article>`;
}
async function openReader(it) {
  reading = {it, full: '', status: 'Загружаю статью целиком… Пока показываю текст из ленты.', tr: null};
  markRead(it); store();
  const el = $('#reader'); el.hidden = false; document.body.classList.add('reading');
  drawReader(); el.scrollTop = 0;
  history.pushState({reader: 1}, '');
  const mine_ = reading;
  try { mine_.full = await loadArticle(it); mine_.status = ''; }
  catch (e) { mine_.status = 'Показан только текст из ленты: ' + e.message; }
  if (reading === mine_) drawReader();
}
function closeReader() {
  if (!reading) return;
  reading = null; $('#reader').hidden = true; document.body.classList.remove('reading'); render();
}
addEventListener('popstate', closeReader);
addEventListener('keydown', e => { if (e.key === 'Escape' && reading) history.back(); });

document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const r = t.closest('#reader') && t.dataset.r;
  if (r === 'back') return history.back();
  if (r === 'fav') { reading.it.fav = !reading.it.fav; store(); window.MMAccount?.changed(); return drawReader(); }
  if (r === 'speak') return speak([{...reading.it, link: '', html: reading.tr ? reading.tr.body.map(p => `<p>${esc(p)}</p>`).join('') : readerText(), title: reading.tr?.title || reading.it.title}]);
  if (r === 'tr') { const cur = reading, tr = await translateItem(cur.it, readerText(), t); if (tr && reading === cur) { cur.tr = tr; drawReader(); } return; }
  if (!['read', 'translate'].includes(t.dataset.act)) return;
  const it = shown[t.closest('[data-n]').dataset.n];
  if (t.dataset.act === 'read') return openReader(it);
  const tr = translations.get(it) || await translateItem(it, it.html, t);
  if (tr) { translations.set(it, tr); open.add(it); markRead(it); store(); render(); }
});

/* ---------- размер шрифта ---------- */
const applyFont = () => document.documentElement.style.setProperty('--fs', +set.font || 1);

/* ---------- свайпы ---------- */
let swipe = null;
document.addEventListener('touchstart', e => {
  const card = e.target.closest('article[data-n]');
  swipe = set.swipe && card && e.touches.length === 1 && !e.target.closest('pre,table,input,select') ? {card, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false} : null;
}, {passive: true});
document.addEventListener('touchmove', e => {
  if (!swipe) return;
  const dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 12) { swipe = null; return; }
    if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swipe.on = true;
  }
  swipe.dx = dx;
  swipe.card.style.transform = `translateX(${dx}px)`;
  swipe.card.dataset.swipe = Math.abs(dx) < 80 ? '' : dx > 0 ? 'fav' : 'read';
}, {passive: true});
function endSwipe(cancel) {
  const s = swipe; swipe = null;
  if (!s || !s.on) return;
  s.card.style.transform = ''; delete s.card.dataset.swipe;
  const it = shown[s.card.dataset.n];
  if (cancel || !it || Math.abs(s.dx) < 80) return;
  if (s.dx > 0) { it.fav = !it.fav; window.MMAccount?.changed(); toast(it.fav ? '★ В избранном' : 'Убрано из избранного'); }
  else { const read = !it.read; markRead(it, read); if (!read) open.delete(it); else if (mode === 'new') open.delete(it); toast(read ? 'Прочитано' : 'Снова непрочитано'); }
  store(); render();
}
document.addEventListener('touchend', () => endSwipe(false));
document.addEventListener('touchcancel', () => endSwipe(true));
