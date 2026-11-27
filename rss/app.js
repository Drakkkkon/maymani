'use strict';
const VERSION = '1.2.0';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gnews = q => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ru&gl=KZ&ceid=KZ:ru';
const gh = r => 'https://api.github.com/repos/' + r + '/releases?per_page=20';

const CATS = ['Новости','Блоги','YouTube','Подкасты','Программы','Комиксы','Скидки','Бизнес','Мои сайты','Другое'];
const PRESETS = [
 ['Новости','Новости Казахстана',gnews('Казахстан')],['Новости','Новости Алматы',gnews('Алматы')],
 ['Новости','BBC — Русская служба','https://feeds.bbci.co.uk/russian/rss.xml'],['Новости','DW — Русский','https://rss.dw.com/rdf/rss-ru-top'],
 ['Блоги','Хабр — лучшее','https://habr.com/ru/rss/articles/top/daily/?fl=ru'],['Блоги','Hacker News','https://news.ycombinator.com/rss'],
 ['Подкасты','NASA: Houston We Have a Podcast','https://www.nasa.gov/feeds/podcasts/houston-we-have-a-podcast'],
 ['Программы','MiniRSS — релизы',gh('Drakkkkon/MiniRSS')],
 ['Комиксы','xkcd','https://xkcd.com/atom.xml'],
 ['Скидки','Скидки на книги (поиск)',gnews('скидки на книги Казахстан')],
 ['Бизнес','Книжные издательства (поиск)',gnews('книжное издательство')],['Бизнес','Книжные магазины Казахстана (поиск)',gnews('книжный магазин Казахстан')]
];

function load(k, d) { try { return JSON.parse(localStorage.getItem('ml_' + k)) ?? d; } catch { return d; } }
function save(k, v) { if (['feeds','set','mine'].includes(k)) window.MMAccount?.changed(); try { localStorage.setItem('ml_' + k, JSON.stringify(v)); return true; } catch { toast('Память браузера заполнена'); return false; } }
let feeds = load('feeds', []), items = load('items', []), mine = load('mine', {title:'',link:'',desc:'',entries:[]});
let set = Object.assign({theme:'auto',words:'',proxy:'',every:30,tgToken:'',tgChat:'',tgOn:false}, load('set', {}));
let page = 'feed', cat = 'Все', mode = 'all', query = '', limit = 50, busy = false;
const open = new Set();

let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 4000); }
function safeUrl(u, base) { try { const x = new URL(String(u || '').trim(), base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }

/* ---------- загрузка ---------- */
async function get(url, headers, ms = 15000) {
  const r = await fetch(url, {headers, signal: AbortSignal.timeout(ms)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
// r.jina.ai без ключа принимает не больше 20 запросов в минуту: лишние ждут своей очереди.
const jinaLog = [];
async function jina(url) {
  for (;;) {
    while (jinaLog.length && Date.now() - jinaLog[0] > 60000) jinaLog.shift();
    if (jinaLog.length < 20) break;
    await new Promise(ok => setTimeout(ok, 60000 - (Date.now() - jinaLog[0]) + 100));
  }
  jinaLog.push(Date.now());
  const text = await get('https://r.jina.ai/' + url, {'x-respond-with': 'html'}, 30000);
  // ответы JSON и простой текст приходят обёрнутыми в страницу с <pre>
  if (!/^\s*<html[\s>]/i.test(text) || !text.slice(0, 600).includes('<pre')) return text;
  return new DOMParser().parseFromString(text, 'text/html').querySelector('body > pre')?.textContent ?? text;
}
// Большинство сайтов не разрешают браузеру читать их напрямую, поэтому пробуем по очереди посредников.
async function fetchText(url, valid) {
  const e = encodeURIComponent(url);
  const own = set.proxy ? [() => get(set.proxy.includes('{url}') ? set.proxy.replace('{url}', e) : set.proxy + e)] : [];
  const tries = url.startsWith('https://api.github.com/') ? [() => get(url)] : [...own, () => get(url), () => jina(url),
    () => get('https://api.allorigins.win/raw?url=' + e), () => get('https://api.codetabs.com/v1/proxy/?quest=' + e)];
  for (const t of tries) {
    try { const text = await t(); if (valid(text)) return text; } catch { /* следующий способ */ }
  }
  throw new Error('не удалось загрузить');
}
const looksFeed = t => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 3000));

const kids = (n, name) => [...n.children].filter(c => c.nodeName.toLowerCase() === name);
const first = (n, ...names) => { for (const nm of names) { const k = kids(n, nm)[0]; if (k) return k.textContent.trim(); } return ''; };
const plain = h => (new DOMParser().parseFromString(h || '', 'text/html').body.textContent || '').trim();

function parseFeed(text, url) {
  if (url.startsWith('https://api.github.com/')) {
    const list = JSON.parse(text), repo = url.split('/repos/')[1].split('/releases')[0];
    return {title: repo + ' — релизы', items: list.map(r => ({id: r.html_url, link: r.html_url, title: r.name || r.tag_name,
      date: Date.parse(r.published_at) || 0, html: esc(r.body || '').replace(/\n/g, '<br>'), img: '', audio: ''}))};
  }
  const doc = new DOMParser().parseFromString(text.trim(), 'text/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || !/^(rss|feed|rdf:rdf)$/i.test(root.nodeName)) throw new Error('это не RSS-лента');
  const channel = kids(root, 'channel')[0] || root;
  const nodes = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
  return {title: first(channel, 'title') || new URL(url).hostname, items: nodes.slice(0, 60).map(n => {
    const links = kids(n, 'link');
    const alt = links.find(l => (l.getAttribute('rel') || 'alternate') === 'alternate') || links[0];
    const link = safeUrl(alt && (alt.getAttribute('href') || alt.textContent), url);
    const group = kids(n, 'media:group')[0] || n;
    const html = first(n, 'content:encoded', 'content', 'description', 'summary') || esc(first(group, 'media:description')).replace(/\n/g, '<br>');
    const enc = [...kids(n, 'enclosure'), ...links.filter(l => l.getAttribute('rel') === 'enclosure'), ...kids(group, 'media:content')];
    const src = x => safeUrl(x && (x.getAttribute('url') || x.getAttribute('href')), url);
    const audio = src(enc.find(x => /^audio\//.test(x.getAttribute('type') || '')));
    let img = src(kids(group, 'media:thumbnail')[0]) || src(enc.find(x => /^image\//.test(x.getAttribute('type') || '')));
    if (!img) { const m = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]'); if (m) img = safeUrl(m.getAttribute('src'), link || url); }
    const title = plain(first(n, 'title')) || plain(html).slice(0, 90) || 'Без названия';
    return {id: first(n, 'guid', 'id') || link || title, link, title,
      date: Date.parse(first(n, 'pubdate', 'published', 'updated', 'dc:date') || first(n, 'pubDate')) || 0,
      html: html.slice(0, 6000), img, audio};
  })};
}

// Из обычной ссылки (сайт, канал YouTube, репозиторий GitHub, слова для поиска) получаем адрес ленты.
async function resolve(input) {
  let s = input.trim();
  if (!s) throw new Error('пустой адрес');
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[^\s]+\.[^\s]{2,}(\/\S*)?$/.test(s)) return gnews(s);
    s = 'https://' + s;
  }
  const u = new URL(s);
  if (u.hostname === 'github.com') {
    const [o, r] = u.pathname.split('/').filter(Boolean);
    if (o && r) return gh(o + '/' + r.replace(/\.git$/, ''));
  }
  const isYT = /(^|\.)youtube\.com$/.test(u.hostname);
  if (isYT) {
    const c = u.pathname.match(/\/channel\/(UC[\w-]{22})/);
    if (c) return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + c[1];
    if (u.pathname.startsWith('/feeds/')) return u.href;
  }
  const text = await fetchText(u.href, t => t.length > 100);
  if (looksFeed(text)) return u.href;
  if (isYT) {
    const m = text.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) || text.match(/"externalId":"(UC[\w-]{22})"/);
    if (m) return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + m[1];
    throw new Error('не нашёл канал YouTube');
  }
  const link = new DOMParser().parseFromString(text, 'text/html').querySelector('link[type="application/rss+xml"],link[type="application/atom+xml"]');
  const found = link && safeUrl(link.getAttribute('href'), u.href);
  if (!found) throw new Error('на этой странице не нашлась RSS-лента');
  return found;
}

const hostOf = u => { try { return new URL(u).hostname || 'Мои сайты'; } catch { return ''; } };
const words = () => set.words.toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
const isHit = it => { const t = (it.title + ' ' + plain(it.html)).toLowerCase(); return words().some(w => t.includes(w)); };

async function loadFeed(f) {
  try {
    const data = f.url === HUB_FEED ? await hubFeed()
      : parseFeed(await fetchText(f.url, f.url.startsWith('https://api.github.com/') ? t => t.trim().startsWith('[') : looksFeed), f.url);
    if (!feeds.includes(f)) return [];
    const known = new Map(items.filter(i => i.feed === f.url).map(i => [i.id, i]));
    const fresh = [];
    for (const n of data.items) {
      const old = known.get(n.id);
      if (old) Object.assign(old, n, {date: n.date || old.date});
      else { const it = {...n, date: n.date || Date.now(), feed: f.url, read: false, fav: false}; items.push(it); known.set(it.id, it); fresh.push(it); }
    }
    const first = !f.loaded; f.loaded = true; f.error = ''; f.title ||= data.title;
    return first ? [] : fresh;
  } catch (e) { f.error = e.message; return []; }
}
function store() {
  setTimeout(() => window.syncNotify?.().catch(() => {}));
  items.sort((a, b) => b.date - a.date);
  const count = {};
  items = items.filter(i => i.fav || (count[i.feed] = (count[i.feed] || 0) + 1) <= 40);
  save('feeds', feeds);
  try { localStorage.setItem('ml_items', JSON.stringify(items)); }
  catch { try { localStorage.setItem('ml_items', JSON.stringify(items.filter((i, n) => i.fav || n < 200).map(i => ({...i, html: i.html.slice(0, 800)})))); } catch { toast('Память браузера заполнена'); } }
}
async function refresh(list = feeds) {
  if (busy || !list.length) return;
  busy = true; $('#refresh').textContent = '…';
  const queue = [...list], fresh = [];
  const worker = async () => { while (queue.length) fresh.push(...await loadFeed(queue.shift())); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  store(); busy = false; $('#refresh').textContent = '↻';
  if (page === 'feed' || page === 'subs') render();
  const failed = list.filter(f => f.error).length;
  if (failed) toast('Не загрузились ленты: ' + failed + '. Подробности в «Подписках».');
  else if (fresh.length) toast('Новых записей: ' + fresh.length);
  if (set.tgOn) for (const it of fresh.filter(i => !words().length || isHit(i)).slice(0, 10)) await sendTg(it.title + '\n' + it.link);
  await window.notifyFresh?.(fresh)?.catch(() => {});
  // пока шла загрузка, могли добавить новые подписки
  const waiting = feeds.filter(f => !f.loaded && !f.error);
  if (waiting.length) refresh(waiting);
}
async function sendTg(text) {
  if (!set.tgToken || !set.tgChat) return false;
  try {
    const r = await fetch('https://api.telegram.org/bot' + set.tgToken + '/sendMessage', {method: 'POST', body: new URLSearchParams({chat_id: set.tgChat, text})});
    return r.ok;
  } catch { return false; }
}
function addFeed(url, category, title) {
  if (feeds.some(f => f.url === url)) { toast('Такая подписка уже есть'); return null; }
  const f = {url, cat: CATS.includes(category) ? category : 'Другое', title: title || ''};
  feeds.push(f); save('feeds', feeds); return f;
}

/* ---------- очистка HTML из лент ---------- */
const OK = new Set('P BR A B STRONG I EM U UL OL LI BLOCKQUOTE PRE CODE H2 H3 H4 IMG FIGURE FIGCAPTION TABLE TBODY TR TD TH HR DIV SPAN'.split(' '));
function clean(html, base) {
  const src = new DOMParser().parseFromString(html, 'text/html').body, out = document.createElement('div');
  (function walk(from, to) {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) { to.append(n.textContent); continue; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|TEMPLATE|NOSCRIPT)$/i.test(n.tagName)) continue;
      if (!OK.has(n.tagName)) { walk(n, to); continue; }
      const el = document.createElement(n.tagName);
      if (n.tagName === 'A') { const h = safeUrl(n.getAttribute('href'), base); if (h) { el.href = h; el.target = '_blank'; el.rel = 'noopener noreferrer'; } }
      if (n.tagName === 'IMG') { const s = safeUrl(n.getAttribute('src'), base); if (!s) continue; el.src = s; el.alt = n.getAttribute('alt') || ''; el.title = n.getAttribute('title') || ''; el.loading = 'lazy'; el.referrerPolicy = 'no-referrer'; }
      walk(n, el); to.append(el);
    }
  })(src, out);
  return out.innerHTML;
}

/* ---------- страницы ---------- */
function mark(text) {
  let out = esc(text);
  for (const w of words()) out = out.replace(new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<&]*[>;])', 'gi'), '<mark>$1</mark>');
  return out;
}
let shown = [];
function pageFeed() {
  const byUrl = new Map(feeds.map(f => [f.url, f]));
  shown = items.filter(i => {
    const f = byUrl.get(i.feed);
    if (mode === 'fav') { if (!i.fav) return false; } else if (!f) return false;
    if (cat !== 'Все' && f?.cat !== cat) return false;
    if (mode === 'new' && i.read && !open.has(i)) return false;
    if (mode === 'hit' && !isHit(i)) return false;
    return !query || (i.title + ' ' + plain(i.html)).toLowerCase().includes(query);
  });
  const chip = (key, val, cur, label) => `<button data-${key}="${val}" class="${val === cur ? 'on' : ''}">${label}</button>`;
  let h = '<div class="chips">' + chip('mode','all',mode,'Все') + chip('mode','new',mode,'Непрочитанные') + chip('mode','fav',mode,'★ Избранное') + chip('mode','hit',mode,'🔔 Мои слова') + '</div>';
  h += '<div class="chips">' + ['Все', ...CATS.filter(c => feeds.some(f => f.cat === c))].map(c => chip('cat', c, cat, c)).join('') + '</div>';
  if (!feeds.some(f => f.url !== HUB_FEED) && cat === 'Все' && mode !== 'fav') h += '<div class="card"><b>Лента пока пустая.</b><p>Добавьте свои сайты или начните с готового набора.</p><div class="row"><button class="main" data-act="starter">Добавить стартовый набор</button><button data-page="subs">Выбрать самому</button></div></div>';
  if (shown.length) h += '<div class="row acts"><button data-act="readall">✓ Прочитать всё показанное</button></div>';
  h += shown.slice(0, limit).map((i, n) => {
    const f = byUrl.get(i.feed), isOpen = open.has(i), yt = i.link.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
    const showImg = i.img && !isOpen && (yt || f?.cat === 'Комиксы');
    return `<article class="card ${i.read ? 'read' : ''} ${isHit(i) ? 'hit' : ''}" data-n="${n}">
<div class="meta">${esc(f?.title || hostOf(i.feed))} · ${new Date(i.date).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
<button class="title" data-act="open" aria-expanded="${isOpen}">${mark(i.title)}</button>
${showImg ? `<img class="thumb" src="${esc(i.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
${isOpen ? `<div class="body">${i.img && !/<img/i.test(i.html) ? `<img src="${esc(i.img)}" alt="" referrerpolicy="no-referrer">` : ''}${clean(i.html, i.link || i.feed)}</div>` : ''}
<div class="row acts">${i.audio ? '<button class="main" data-act="play">▶ Слушать</button>' : ''}
${i.link ? `<a class="btn" data-act="visit" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${yt ? 'Смотреть' : 'Открыть'} ↗</a>` : ''}
<button data-act="fav" aria-label="В избранное">${i.fav ? '★' : '☆'}</button><button data-act="share">Поделиться</button></div></article>`;
  }).join('');
  if (!shown.length && feeds.length) h += '<p class="meta">' + (busy ? 'Загружаю…' : mode === 'hit' && !words().length ? 'Впишите слова для отслеживания в «Настройках».' : 'Здесь пока ничего нет.') + '</p>';
  if (shown.length > limit) h += '<button data-act="more">Показать ещё</button>';
  return h;
}
const options = sel => CATS.map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
function pageSubs() {
  return searchBlock() + `<h2>Добавить по ссылке</h2><form id="add"><label for="url">Адрес сайта, ленты, канала YouTube, репозитория GitHub или слова для поиска новостей</label><input id="url" required>
<div class="row"><select id="acat" aria-label="Раздел">${options('Блоги')}</select><button class="main">Подписаться</button></div></form>
<h2>Мои подписки (${feeds.length})</h2>` +
  (feeds.map((f, n) => `<div class="card" data-f="${n}"><b>${esc(f.title || f.url)}</b><div class="meta">${esc(f.url)}</div>${f.error ? `<div class="err">Ошибка: ${esc(f.error)}</div>` : ''}
<div class="row acts"><select data-chg="cat" aria-label="Раздел">${options(f.cat)}</select><button data-act="retry">↻</button><button data-act="del">Удалить</button></div></div>`).join('') || '<p class="meta">Подписок пока нет.</p>') +
  '<h2>Готовые источники</h2>' + PRESETS.map((p, n) => feeds.some(f => f.url === p[2]) ? '' : `<div class="row"><span style="flex:1">${esc(p[1])} <span class="meta">· ${p[0]}</span></span><button data-preset="${n}">+</button></div>`).join('') +
  '<h2>Перенос подписок (OPML)</h2><div class="row"><button data-act="opmlout">Сохранить OPML</button><label class="btn">Загрузить OPML<input type="file" id="opml" accept=".opml,.xml,text/xml" hidden></label></div>';
}
function pageMine() {
  const field = (k, label) => `<label>${label}<input data-mine="${k}" value="${esc(mine[k])}"></label>`;
  return `<h2>Своя RSS-лента для вашего сайта</h2><p class="meta">Заполните, добавьте новости и скачайте файл feed.xml. Положите его в репозиторий сайта — люди смогут подписаться.</p>
${field('title','Название сайта')}${field('link','Адрес сайта (https://…)')}${field('desc','Короткое описание')}
<h2>Новая запись</h2><form id="entry"><label>Заголовок<input id="et" required></label><label>Ссылка (необязательно)<input id="el" type="url"></label><label>Текст<textarea id="ed" rows="3"></textarea></label><div class="row"><button class="main">Добавить запись</button></div></form>
${mine.entries.map((e, n) => `<div class="card" data-e="${n}"><b>${esc(e.title)}</b><div class="meta">${new Date(e.date).toLocaleDateString('ru-RU')}</div><div class="row acts"><button data-act="edel">Удалить</button></div></div>`).join('')}
<div class="row"><button class="main" data-act="xml">Скачать feed.xml</button><label class="btn">Открыть прежний feed.xml<input type="file" id="xmlin" accept=".xml,text/xml" hidden></label></div>`;
}
function pageSettings() {
  const inp = (k, label, type = 'text', extra = '') => `<label>${label}<input type="${type}" data-set="${k}" value="${esc(set[k])}" ${extra}></label>`;
  return `<h2>Общий аккаунт</h2><div id="account" class="card"></div>
<h2>Вид и обновление</h2><label>Тема<select data-set="theme"><option value="auto">Как в системе</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
<label>Обновлять, пока сайт открыт<select data-set="every"><option value="0">Только вручную</option><option value="15">Каждые 15 минут</option><option value="30">Каждые 30 минут</option><option value="60">Каждый час</option></select></label>
${notifyBlock()}
<h2>Мои слова</h2>${inp('words','Через запятую: записи с этими словами подсвечиваются (скидка, тираж, издательство)')}
<h2>Автоматизация: Telegram</h2>${inp('tgToken','Токен бота','password','autocomplete="off"')}${inp('tgChat','ID чата')}
<label><select data-set="tgOn"><option value="false">Не отправлять</option><option value="true">Отправлять новые записи (с «моими словами», если они заданы)</option></select></label>
<div class="row"><button data-act="tgtest">Проверить</button><a href="#help-tg" data-act="help">Инструкция</a></div>
<p class="meta">Работает, только пока сайт открыт.</p>
<h2>Свой посредник</h2>${inp('proxy','Необязательно: адрес с {url}')}<a href="#help-proxy" data-act="help">Инструкция</a>
<h2>Резервная копия</h2><div class="row"><button data-act="backup">Сохранить</button><label class="btn">Восстановить<input type="file" id="restore" accept=".json" hidden></label></div>
<h2>Инструкции</h2>
<details><summary>Как пользоваться: 10 идей</summary><ol>
<li><b>Личная газета:</b> «Лента» — всё по времени, разделы сверху.</li><li><b>Блоги:</b> вставьте адрес сайта в «Подписках».</li><li><b>YouTube:</b> вставьте ссылку на канал.</li><li><b>Подкасты:</b> кнопка «Слушать», место прослушивания запоминается.</li><li><b>Программы:</b> вставьте ссылку на репозиторий GitHub.</li><li><b>Комиксы:</b> раздел «Комиксы» показывает картинки сразу.</li><li><b>Скидки:</b> впишите «мои слова».</li><li><b>Бизнес:</b> введите слова вместо адреса — получится лента новостей по запросу.</li><li><b>Автоматизация:</b> отправка в Telegram.</li><li><b>Своя лента:</b> вкладка «Своя RSS».</li></ol>
<p><b>Поиск источников:</b> «Подписки» → «Найти источник». <b>Мои сайты:</b> версии и список изменений на отдельной вкладке. <b>Аккаунт:</b> вверху «Настроек», переносит подписки и избранное между устройствами.</p>
<p>На телефоне: меню браузера → «Добавить на главный экран».</p></details>
<details id="help-tg"><summary>Telegram: где взять токен и ID чата</summary><ol><li>Откройте <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>, отправьте /newbot и скопируйте токен.</li><li>Напишите своему новому боту любое сообщение.</li><li>Откройте <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a> — он покажет ваш ID.</li></ol><p>Токен хранится только в этом браузере и не попадает в резервную копию.</p></details>
<details id="help-proxy"><summary>Если ленты не загружаются</summary><p>Многие сайты не дают браузеру читать ленту напрямую, поэтому сайт использует бесплатных посредников (r.jina.ai, allorigins, codetabs). Они видят адреса ваших лент и иногда не работают. Не добавляйте сюда личные ссылки с ключами.</p><p>Надёжнее свой посредник, например на <a href="https://workers.cloudflare.com/" target="_blank" rel="noopener">Cloudflare Workers</a>. Впишите его адрес в виде https://…workers.dev/?url={url}</p></details>
<p class="meta">Мое_лента ${VERSION}. Данные хранятся только в этом браузере.</p>`;
}
function render() {
  const y = scrollY;
  $('#main').innerHTML = {feed: pageFeed, subs: pageSubs, sites: pageSites, mine: pageMine, settings: pageSettings}[page]();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  document.querySelectorAll('select[data-set]').forEach(s => s.value = String(set[s.dataset.set]));
  if (page === 'settings') window.MMAccount?.mount('#account');
  scrollTo(0, y);
}
function theme() {
  const dark = set.theme === 'dark' || (set.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/* ---------- файлы ---------- */
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const xml = s => esc(String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''));
function buildRss() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>${xml(mine.title)}</title>\n<link>${xml(mine.link)}</link>\n<description>${xml(mine.desc || mine.title)}</description>\n` +
    mine.entries.map(e => `<item>\n<title>${xml(e.title)}</title>\n${e.link ? `<link>${xml(e.link)}</link>\n` : ''}<guid isPermaLink="false">${xml(e.id)}</guid>\n<pubDate>${new Date(e.date).toUTCString()}</pubDate>\n<description>${xml(e.text)}</description>\n</item>\n`).join('') + '</channel>\n</rss>\n';
}
function buildOpml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Мое_лента</title></head><body>\n' +
    feeds.filter(f => f.url !== HUB_FEED).map(f => `<outline type="rss" text="${xml(f.title || f.url)}" category="${xml(f.cat)}" xmlUrl="${xml(f.url)}"/>\n`).join('') + '</body></opml>\n';
}

/* ---------- события ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button,a'); if (!t) return;
  const d = t.dataset;
  if (d.page) { page = d.page; render(); scrollTo(0, 0); return; }
  if (d.mode) { mode = d.mode; limit = 50; open.clear(); return render(); }
  if (d.cat) { cat = d.cat; limit = 50; return render(); }
  if (d.preset) { const p = PRESETS[d.preset], f = addFeed(p[2], p[0], p[1]); if (f) { render(); refresh([f]); } return; }
  const card = t.closest('[data-n]'), it = card && shown[card.dataset.n];
  const fcard = t.closest('[data-f]'), f = fcard && feeds[fcard.dataset.f];
  switch (d.act) {
    case 'starter': PRESETS.filter((p, n) => [0,1,5,7,8].includes(n)).forEach(p => addFeed(p[2], p[0], p[1])); render(); refresh(); break;
    case 'open': open.has(it) ? open.delete(it) : (open.add(it), it.read = true); store(); render(); break;
    case 'visit': it.read = true; card.classList.add('read'); store(); break;
    case 'fav': it.fav = !it.fav; store(); window.MMAccount?.changed(); render(); break;
    case 'share':
      if (navigator.share) navigator.share({title: it.title, url: it.link || undefined}).catch(() => {});
      else navigator.clipboard.writeText(it.title + '\n' + it.link).then(() => toast('Скопировано'), () => toast('Не удалось скопировать'));
      break;
    case 'play': {
      const a = $('#audio'); $('#player').hidden = false; $('#ptitle').textContent = it.title; a.src = it.audio;
      a.dataset.key = it.audio; const pos = load('pos', {})[it.audio]; if (pos) a.addEventListener('loadedmetadata', () => a.currentTime = pos, {once: true});
      a.playbackRate = a.defaultPlaybackRate = +$('#speed').value; a.play().catch(() => toast('Нажмите ▶ в плеере'));
      it.read = true; store(); break;
    }
    case 'addfound': {
      const r = found.list[t.closest('[data-r]').dataset.r], nf = addFeed(r.url, r.cat, r.title);
      if (nf) { render(); await loadFeed(nf); store(); toast(nf.error ? 'Добавлено, но не загрузилось: ' + nf.error : 'Добавлено в ленту'); if (page === 'subs') render(); }
      break;
    }
    case 'followhub': followHub(); render(); break;
    case 'hubretry': hubError = ''; render(); break;
    case 'readall': shown.forEach(i => i.read = true); store(); render(); break;
    case 'more': limit += 50; render(); break;
    case 'del': if (confirm('Удалить подписку «' + (f.title || f.url) + '»?')) { feeds.splice(feeds.indexOf(f), 1); items = items.filter(i => i.fav || i.feed !== f.url); cat = 'Все'; store(); render(); } break;
    case 'retry': await refresh([f]); break;
    case 'opmlout': download('moe_lenta.opml', buildOpml(), 'text/xml'); break;
    case 'edel': mine.entries.splice(t.closest('[data-e]').dataset.e, 1); save('mine', mine); render(); break;
    case 'xml': if (!mine.title || !safeUrl(mine.link)) toast('Заполните название и адрес сайта'); else download('feed.xml', buildRss(), 'application/rss+xml'); break;
    case 'tgtest': toast(await sendTg('Мое_лента: проверка связи ✅') ? 'Отправлено' : 'Не получилось: проверьте токен и ID чата'); break;
    case 'help': { e.preventDefault(); const el = $(t.getAttribute('href')); el.open = true; el.scrollIntoView(); break; }
    case 'backup': download('moe_lenta_backup.json', JSON.stringify({feeds, mine, set: {...set, tgToken: ''}, fav: items.filter(i => i.fav)}), 'application/json'); break;
  }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'find') return findSources($('#fq').value.trim(), $('#fkind').value);
  if (e.target.id === 'add') {
    const btn = e.target.querySelector('button'), input = $('#url').value, category = $('#acat').value;
    btn.disabled = true; btn.textContent = 'Ищу ленту…';
    try {
      const url = await resolve(input);
      const f = addFeed(url, category, url.startsWith('https://news.google.com/rss/search') && !/^https?:/i.test(input.trim()) ? 'Поиск: ' + input.trim() : '');
      if (f) { await loadFeed(f); store(); toast(f.error ? 'Добавлено, но не загрузилось: ' + f.error : 'Подписка добавлена'); }
    } catch (err) { toast('Не получилось: ' + err.message); }
    if (page === 'subs') render();
  }
  if (e.target.id === 'entry') {
    mine.entries.unshift({id: 'ml-' + Date.now(), title: $('#et').value.trim(), link: safeUrl($('#el').value), text: $('#ed').value.trim(), date: Date.now()});
    save('mine', mine); render();
  }
});
document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset;
  if (d.set) {
    set[d.set] = d.set === 'every' ? +t.value : d.set === 'tgOn' ? t.value === 'true' : t.value.trim(); save('set', set); theme(); window.syncNotify?.().catch(() => {}); return;
  }
  if (d.mine) { mine[d.mine] = t.value.trim(); save('mine', mine); return; }
  if (d.chg === 'cat') { feeds[t.closest('[data-f]').dataset.f].cat = t.value; save('feeds', feeds); return; }
  if (t.id === 'speed') { $('#audio').playbackRate = $('#audio').defaultPlaybackRate = +t.value; return; }
  const file = t.files && t.files[0]; if (!file) return;
  try {
    const text = await file.text();
    if (t.id === 'opml') {
      const doc = new DOMParser().parseFromString(text, 'text/xml'); let n = 0;
      doc.querySelectorAll('outline[xmlUrl]').forEach(o => { const u = safeUrl(o.getAttribute('xmlUrl')); if (u && !feeds.some(f => f.url === u) && addFeed(u, o.getAttribute('category'), o.getAttribute('text'))) n++; });
      toast('Добавлено подписок: ' + n); render(); refresh();
    }
    if (t.id === 'xmlin') {
      const doc = new DOMParser().parseFromString(text, 'text/xml'), ch = doc.querySelector('channel');
      if (!ch) throw new Error('нет channel');
      mine = {title: first(ch, 'title'), link: first(ch, 'link'), desc: first(ch, 'description'), entries: kids(ch, 'item').map(i => ({id: first(i, 'guid') || String(Math.random()), title: first(i, 'title'), link: safeUrl(first(i, 'link')), text: first(i, 'description'), date: Date.parse(first(i, 'pubdate', 'pubDate')) || Date.now()}))};
      save('mine', mine); render();
    }
    if (t.id === 'restore') {
      const b = JSON.parse(text);
      if (!Array.isArray(b.feeds)) throw new Error('не тот файл');
      feeds = b.feeds.filter(f => f.url === HUB_FEED || safeUrl(f.url)).map(f => ({url: f.url, title: String(f.title || ''), cat: CATS.includes(f.cat) ? f.cat : 'Другое'}));
      mine = b.mine && Array.isArray(b.mine.entries) ? b.mine : mine;
      // токен, чат, посредник и отправку из файла не берём: они остаются как были
      for (const k of ['theme', 'words', 'every']) if (b.set && k in b.set) set[k] = b.set[k];
      items = (b.fav || []).filter(i => i.feed === HUB_FEED || safeUrl(i.feed)).map(i => ({...i, link: safeUrl(i.link), img: safeUrl(i.img), audio: safeUrl(i.audio), title: String(i.title), html: String(i.html || ''), date: +i.date || 0, fav: true}));
      store(); save('mine', mine); save('set', set); theme(); toast('Восстановлено'); render(); refresh();
    }
  } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
});
$('#search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); page = 'feed'; limit = 50; render(); });
$('#refresh').addEventListener('click', () => feeds.length ? refresh() : toast('Сначала добавьте подписки'));
let lastPos = 0;
$('#audio').addEventListener('timeupdate', e => { const a = e.target; if (Date.now() - lastPos > 5000 && a.currentTime > 5) { lastPos = Date.now(); const p = load('pos', {}); p[a.dataset.key] = a.currentTime; save('pos', p); } });
$('#pclose').addEventListener('click', () => { $('#audio').pause(); $('#player').hidden = true; });

let lastAuto = Date.now();
setInterval(() => { if (set.every && Date.now() - lastAuto >= set.every * 60000) { lastAuto = Date.now(); refresh(); } }, 60000);
// extra.js подключён после этого файла, поэтому запуск — когда загружены оба
addEventListener('DOMContentLoaded', () => {
  if (!load('hubAdded', false)) { addFeed(HUB_FEED, 'Мои сайты', 'Мои сайты — обновления'); save('hubAdded', true); }
  theme(); render(); refresh();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
