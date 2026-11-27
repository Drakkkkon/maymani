'use strict';
/* Обложки записей и озвучка (с 1.3.0). */

/* ---------- обложки ---------- */
const isGNews = i => /^https:\/\/news\.google\.com\//.test(i.link);
function coverHtml(i, yt, f) {
  const box = (cls, inner, extra = '') => `<button class="cover ${cls}" data-act="open" tabindex="-1" aria-hidden="true"${extra}>${inner}</button>`;
  const img = u => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const src = i.img || (yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : '') || i.og;
  if (src) return box(yt ? 'video' : f?.cat === 'Комиксы' ? 'comic' : '', img(src.replace(/^http:/, 'https:')));
  // Google Новости не отдают фото статьи: показываем значок издания
  if (isGNews(i)) return i.from ? box('logo', img('https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(new URL(i.from).hostname))) : '';
  // нет картинки в ленте — возьмём со страницы статьи, когда запись появится на экране
  if (i.og === undefined && /^https?:/.test(i.link) && !/^https:\/\/(github\.com|drakkkkon\.github\.io|news\.ycombinator\.com)/.test(i.link)) return box('wait', '', ' data-og');
  return '';
}
const ogQueue = [], ogAsked = new Set();
let ogActive = 0;
async function ogNext() {
  if (ogActive >= 2 || !ogQueue.length) return;
  // не отнимаем у обновления лент очередь посредника
  if (busy || jinaLog.length >= 12) { setTimeout(ogNext, 5000); return; }
  const {it, el} = ogQueue.shift();
  ogActive++;
  try {
    const html = await fetchText(it.link, t => /<meta\s/i.test(t));
    const m = new DOMParser().parseFromString(html, 'text/html').querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]');
    it.og = m ? safeUrl(m.getAttribute('content'), it.link).replace(/^http:/, 'https:') : '';
    store();
    if (it.og && el.isConnected) { el.innerHTML = `<img src="${esc(it.og)}" alt="" referrerpolicy="no-referrer">`; el.className = 'cover'; el.removeAttribute('data-og'); }
  } catch { /* попробуем после перезагрузки */ }
  ogActive--; ogNext();
}
const watcher = new IntersectionObserver(list => {
  for (const e of list) {
    if (!e.isIntersecting) continue;
    watcher.unobserve(e.target);
    const it = shown[e.target.closest('[data-n]')?.dataset.n];
    if (!it || ogAsked.has(it.link)) continue;
    ogAsked.add(it.link); ogQueue.push({it, el: e.target}); ogNext();
  }
}, {rootMargin: '200px'});
function watchCovers() { watcher.disconnect(); document.querySelectorAll('.cover[data-og]').forEach(el => watcher.observe(el)); }
// картинка не загрузилась — убираем пустую рамку
document.addEventListener('error', e => { const box = e.target.tagName === 'IMG' && e.target.closest('.cover'); if (box) box.remove(); }, true);

/* ---------- озвучка ---------- */
const synth = window.speechSynthesis;
let talk = {list: [], n: 0, run: 0, utter: null, timer: 0};
function speechText(it) {
  const doc = new DOMParser().parseFromString(it.html || '', 'text/html');
  doc.querySelectorAll('script,style,figcaption,pre').forEach(x => x.remove());
  doc.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr').forEach(x => x.append('\n'));
  let body = (doc.body.textContent || '').replace(/https?:\/\/\S+/g, '').trim();
  const title = it.title.trim();
  // у Google Новостей вместо текста повторён заголовок
  if (isGNews(it)) body = '';
  else if (body.startsWith(title)) body = body.slice(title.length);
  return title + '.\n' + body;
}
// Длинный текст телефоны обрывают на полуслове, поэтому читаем короткими кусками.
function chunks(text) {
  const out = [];
  for (let s of text.split(/(?<=[.!?…])\s+|\n+/)) {
    s = s.trim();
    while (s.length > 180) { let at = s.lastIndexOf(' ', 180); if (at < 60) at = 180; out.push(s.slice(0, at)); s = s.slice(at).trim(); }
    if (/[\p{L}\p{N}]/u.test(s)) out.push(s);
  }
  return out;
}
function voiceFor(text) {
  const lang = (text.match(/[а-яё]/gi) || []).length > (text.match(/[a-z]/gi) || []).length ? 'ru' : 'en';
  const voice = synth.getVoices().find(v => v.lang.toLowerCase().startsWith(lang) && v.localService) || synth.getVoices().find(v => v.lang.toLowerCase().startsWith(lang));
  return {voice, lang: voice?.lang || (lang === 'ru' ? 'ru-RU' : 'en-US')};
}
const speakFail = () => { stopSpeak(); toast('Голос не запустился. Что проверить: «Настройки» → «Инструкции» → «Если не слышно озвучку».'); };
function stopSpeak() {
  talk.run++; clearTimeout(talk.timer); talk.list = [];
  synth?.cancel(); $('#tts').hidden = true;
}
function speakItem() {
  const run = ++talk.run, it = talk.list[talk.n];
  if (!it) return stopSpeak();
  const parts = chunks(speechText(it)), v = voiceFor(parts.join(' '));
  let i = 0;
  $('#ttitle').textContent = (talk.list.length > 1 ? `${talk.n + 1}/${talk.list.length} · ` : '') + it.title;
  const say = () => {
    if (run !== talk.run) return;
    if (i >= parts.length) { talk.n++; return speakItem(); }
    const u = talk.utter = new SpeechSynthesisUtterance(parts[i++]);
    u.lang = v.lang; if (v.voice) u.voice = v.voice;
    u.rate = +$('#trate').value;
    u.onstart = () => clearTimeout(talk.timer);
    u.onend = () => { clearTimeout(talk.timer); say(); };
    u.onerror = e => { if (run === talk.run && !['canceled', 'interrupted'].includes(e.error)) speakFail(); };
    clearTimeout(talk.timer);
    talk.timer = setTimeout(() => { if (run === talk.run) speakFail(); }, 8000);
    synth.speak(u);
  };
  if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(say, 150); } else say();
}
function speak(list) {
  if (!synth || !window.SpeechSynthesisUtterance) { toast('Этот браузер не умеет читать вслух. Откройте сайт в Chrome.'); return; }
  if (!list.length) return;
  $('#audio').pause(); $('#player').hidden = true;
  talk.list = list; talk.n = 0; $('#tts').hidden = false;
  speakItem();
}
synth?.getVoices(); // список голосов подгружается не сразу
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'tstop') return stopSpeak();
  if (t.id === 'tnext') { talk.n++; return speakItem(); }
  if (t.dataset.act === 'speak') { const it = shown[t.closest('[data-n]').dataset.n]; speak([it]); it.read = true; store(); }
  if (t.dataset.act === 'speakall') speak(shown.slice(0, 30));
});
addEventListener('pagehide', () => synth?.cancel());
watchCovers();
if (page === 'feed') render();
