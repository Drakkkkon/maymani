'use strict';
/* Поиск источников, страница «Мое_Сайты» и общий аккаунт (с 1.1.0). */
const HUB_URL = 'https://drakkkkon.github.io/maymani/';
const HUB_FEED = 'hub:sites';
const REPOS = ['maymani','my-money','ilife','geometriya-polki','topsecret','Moe_korovy','Moe_nakleyki','My-memes','MiniRSS'];

/* ---------- поиск источников ---------- */
const KINDS = {all: 'Везде', sites: 'Сайты', youtube: 'YouTube', podcasts: 'Подкасты', github: 'GitHub', news: 'Новости'};
let found = {q: '', kind: 'all', list: [], note: '', busy: false};

async function searchJson(url) {
  return JSON.parse(await fetchText(url, t => t.trim().startsWith('{')));
}
// YouTube отдаёт страницу поиска в двух разных видах — разбираем оба.
function ytChannels(html) {
  const out = [], str = '("(?:[^"\\\\]|\\\\.)*")';
  for (const m of html.matchAll(new RegExp('"channelRenderer":\\{"channelId":"(UC[\\w-]{22})","title":\\{"simpleText":' + str, 'g'))) out.push([m[1], JSON.parse(m[2])]);
  if (out.length) return out;
  const name = new RegExp('"lockupMetadataViewModel":\\{"title":\\{"content":' + str);
  let from = 0;
  for (const m of html.matchAll(/"contentId":"(UC[\w-]{22})","contentType":"LOCKUP_CONTENT_TYPE_CHANNEL"/g)) {
    const t = html.slice(from, m.index).match(name);
    if (t) out.push([m[1], JSON.parse(t[1])]);
    from = m.index + m[0].length;
  }
  return out;
}
const SEARCH = {
  async youtube(q) {
    const html = await fetchText('https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=' + encodeURIComponent(q), t => ytChannels(t).length > 0);
    return ytChannels(html).slice(0, 12).map(([id, title]) => ({url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id, title, info: 'Канал YouTube', site: 'https://www.youtube.com/channel/' + id, cat: 'YouTube', kind: 'YouTube'}));
  },
  async sites(q) {
    const d = await searchJson('https://cloud.feedly.com/v3/search/feeds?count=15&query=' + encodeURIComponent(q));
    return (d.results || []).map(r => ({url: safeUrl(String(r.feedId || '').replace(/^feed\//, '')), title: r.title, info: r.description || r.website || '', site: r.website, cat: 'Блоги', kind: 'Сайт'}));
  },
  async podcasts(q) {
    const d = await searchJson('https://itunes.apple.com/search?media=podcast&limit=12&term=' + encodeURIComponent(q));
    return (d.results || []).map(r => ({url: safeUrl(r.feedUrl), title: r.collectionName, info: r.artistName || '', site: r.collectionViewUrl, cat: 'Подкасты', kind: 'Подкаст'}));
  },
  async github(q) {
    const d = await searchJson('https://api.github.com/search/repositories?per_page=10&q=' + encodeURIComponent(q));
    return (d.items || []).map(r => ({url: gh(r.full_name), title: r.full_name + ' — релизы', info: r.description || '', site: r.html_url, cat: 'Программы', kind: 'GitHub'}));
  },
  async news(q) {
    return [{url: gnews(q), title: 'Поиск: ' + q, info: 'Новости по этим словам из Google Новостей', cat: 'Новости', kind: 'Новости'}];
  }
};
async function findSources(q, kind) {
  found = {q, kind, list: [], note: '', busy: true};
  const mine = found;
  render();
  const keys = kind === 'all' ? Object.keys(SEARCH) : [kind];
  const res = await Promise.allSettled(keys.map(k => SEARCH[k](q)));
  if (found !== mine) return;
  const bad = keys.filter((k, i) => res[i].status === 'rejected').map(k => KINDS[k]);
  // при поиске «Везде» берём понемногу из каждого вида
  const seen = new Set();
  // одинаковые источники из разных каталогов показываем один раз
  const once = x => { const keys = [x.url, x.kind + '|' + x.title + '|' + x.info]; if (!x.url || keys.some(k => seen.has(k))) return false; keys.forEach(k => seen.add(k)); return true; };
  found.list = res.flatMap(r => r.status === 'fulfilled' ? r.value.filter(once).slice(0, kind === 'all' ? 5 : 15) : []);
  found.note = bad.length ? 'Сейчас не отвечает: ' + bad.join(', ') + '.' : '';
  found.busy = false;
  if (page === 'subs') render();
}
function searchBlock() {
  const yt = found.q ? `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(found.q)}" target="_blank" rel="noopener">Искать на самом YouTube</a> и вставить ссылку на канал ниже.` : '';
  return `<h2>Найти источник</h2><form id="find"><div class="row"><input id="fq" type="search" placeholder="Например: книги, технологии, история" value="${esc(found.q)}" required aria-label="Ключевое слово">
<select id="fkind" aria-label="Где искать">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === found.kind ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="main">Найти</button></div></form>` +
    (found.busy ? '<p class="meta">Ищу…</p>' : '') + (found.note ? `<p class="err">${esc(found.note)} ${yt}</p>` : '') +
    found.list.map((r, n) => `<div class="card" data-r="${n}"><div class="meta">${r.kind}</div><b>${esc(r.title)}</b><div class="meta">${esc(String(r.info).slice(0, 160))}</div><div class="row acts">
${feeds.some(f => f.url === r.url) ? '<button disabled>✓ Добавлено</button>' : '<button class="main" data-act="addfound">+ В ленту</button>'}
${safeUrl(r.site) ? `<a class="btn" href="${esc(safeUrl(r.site))}" target="_blank" rel="noopener noreferrer">Посмотреть ↗</a>` : ''}</div></div>`).join('') +
    (!found.busy && found.q && !found.list.length ? `<p class="meta">Ничего не нашлось. ${yt}</p>` : '');
}

/* ---------- Мое_Сайты ---------- */
let hubPromise = null;
function loadHub(force) {
  if (hubPromise && !force) return hubPromise;
  hubPromise = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '../js/data.js?t=' + Math.floor(Date.now() / 300000);
    s.onload = () => { s.remove(); window.HUB ? ok(window.HUB) : fail(new Error('нет данных')); };
    s.onerror = () => { s.remove(); hubPromise = null; fail(new Error('не загрузился список версий')); };
    document.head.append(s);
  });
  return hubPromise;
}
async function hubFeed() {
  const hub = await loadHub(true);
  const list = hub.programs.flatMap(p => p.versions.map(v => ({
    id: p.id + '@' + v.v + '@' + v.date, link: HUB_URL + p.page, title: p.name + ' ' + v.v + (v.name ? ' — ' + v.name : ''),
    date: Date.parse(v.date + 'T' + (v.time || '12:00') + ':00+05:00') || 0,
    html: '<ul>' + (v.items || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>', img: '', audio: ''
  })));
  return {title: 'Мои сайты — обновления', items: list.sort((a, b) => b.date - a.date).slice(0, 40)};
}
let hubData = null, hubError = '', hubSeen = load('seen', null);
function pageSites() {
  if (!hubData) {
    if (!hubError) loadHub().then(h => { hubData = h; if (page === 'sites') render(); }, e => { hubError = e.message; if (page === 'sites') render(); });
    return '<h2>Мое_Сайты</h2>' + (hubError ? `<p class="err">${esc(hubError)}</p><button data-act="hubretry">Повторить</button>` : '<p class="meta">Загружаю версии…</p>');
  }
  const seen = hubSeen || {};
  const day = d => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
  const log = v => '<ul>' + (v.items || []).map(t => `<li>${esc(t)}</li>`).join('') + '</ul>';
  const progs = [...hubData.programs].filter(p => p.versions.length).sort((a, b) => b.versions[0].date.localeCompare(a.versions[0].date));
  let h = '<h2>Мое_Сайты</h2>' + (feeds.some(f => f.url === HUB_FEED) ? '<p class="meta">Новые версии приходят и в «Ленту», раздел «Мои сайты».</p>' : '<button data-act="followhub">Следить за обновлениями в «Ленте»</button>');
  h += progs.map(p => {
    const v = p.versions[0], fresh = hubSeen && seen[p.id] !== v.v;
    return `<div class="card"><b>${esc(p.name)}</b> ${fresh ? '<span class="badge">новое</span>' : ''}<div class="meta">Версия ${esc(v.v)} · ${day(v.date)}</div>
<details><summary>Что нового</summary>${log(v)}</details>
${p.versions.length > 1 ? `<details><summary>Прежние версии (${p.versions.length - 1})</summary>${p.versions.slice(1, 11).map(o => `<b>${esc(o.v)}</b> <span class="meta">${day(o.date)}</span>${log(o)}`).join('')}</details>` : ''}
<div class="row acts">${safeUrl(p.site) ? `<a class="btn" href="${esc(safeUrl(p.site))}" target="_blank" rel="noopener">Открыть сайт ↗</a>` : ''}<a class="btn" href="${esc(HUB_URL + p.page)}" target="_blank" rel="noopener">Все версии и скачивание ↗</a></div></div>`;
  }).join('');
  const link = (u, t) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`;
  h += '<h2>Ссылки</h2><div class="card"><b>Сайты</b><ul>' + link(HUB_URL, 'Мое_Сайты (все версии)') + progs.filter(p => safeUrl(p.site)).map(p => link(safeUrl(p.site), p.name)).join('') +
    '</ul><b>GitHub</b><ul>' + REPOS.map(r => link('https://github.com/Drakkkkon/' + r, r)).join('') + '</ul></div>';
  // отметки «новое» держатся до перезагрузки; при первом открытии всё считается виденным
  save('seen', Object.fromEntries(progs.map(p => [p.id, p.versions[0].v])));
  return h;
}
function followHub() {
  const f = addFeed(HUB_FEED, 'Мои сайты', 'Мои сайты — обновления');
  if (f) refresh([f]);
}

/* ---------- общий аккаунт ---------- */
// Для каждой записи храним время изменения; удаление — отметка d. Побеждает более поздняя правка.
// Токен Telegram, ID чата и свой посредник в облако не отправляются.
const stable = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);
function parts() {
  const out = {};
  for (const f of feeds) out['f:' + f.url] = {title: f.title || '', cat: f.cat};
  for (const i of items) if (i.fav) out['v:' + i.feed + '|' + i.id] = {feed: i.feed, id: i.id, link: i.link, title: i.title, date: i.date, html: i.html.slice(0, 1500), img: i.img, audio: i.audio};
  out.set = {theme: set.theme, words: set.words, every: set.every};
  // новые настройки добавляем, только если их меняли: иначе значения по умолчанию затрут облачные
  for (const [k, d] of Object.entries(EXTRA)) if (set[k] !== d) out.set[k] = set[k];
  out.mine = mine;
  return out;
}
const EXTRA = {stop: '', font: 1, dedup: true, swipe: true};
const DEFAULTS = {set: stable({theme: 'auto', words: '', every: 30}), mine: stable({title: '', link: '', desc: '', entries: []})};
function snapshot() {
  const state = load('sync', {}), now = parts(), time = Date.now();
  for (const [id, v] of Object.entries(now)) {
    const old = state[id];
    if (old && !old.d && (id[0] === 'v' || stable(old.v) === stable(v))) continue;
    // нетронутые настройки нового устройства и стандартная подписка не должны затирать облачные
    const untouched = !old && (DEFAULTS[id] === stable(v) || id === 'f:' + HUB_FEED);
    state[id] = {v, t: untouched ? 0 : time};
  }
  for (const id of Object.keys(state)) if (!(id in now) && !state[id].d) state[id] = {d: 1, t: time};
  save('sync', state);
  return state;
}
function merge(local, remote) {
  const out = {...local};
  for (const [id, r] of Object.entries(remote || {})) if (!out[id] || r.t > out[id].t) out[id] = r;
  return out;
}
function applySnapshot(state) {
  const live = Object.entries(state).filter(([, e]) => !e.d);
  const subs = new Map(live.filter(([id]) => id.startsWith('f:')).map(([id, e]) => [id.slice(2), e.v]));
  feeds = feeds.filter(f => subs.has(f.url));
  for (const [url, v] of subs) {
    if (url !== HUB_FEED && !safeUrl(url)) continue;
    const f = feeds.find(x => x.url === url), data = {title: String(v.title || ''), cat: CATS.includes(v.cat) ? v.cat : 'Другое'};
    f ? Object.assign(f, data) : feeds.push({url, ...data});
  }
  const favs = new Map(live.filter(([id]) => id.startsWith('v:')).map(([id, e]) => [id.slice(2), e.v]));
  for (const i of items) { const key = i.feed + '|' + i.id; i.fav = favs.has(key); favs.delete(key); }
  for (const v of favs.values()) items.push({feed: String(v.feed), id: String(v.id), link: safeUrl(v.link), title: String(v.title), date: +v.date || 0, html: String(v.html || ''), img: safeUrl(v.img), audio: safeUrl(v.audio), fav: true, read: true});
  items = items.filter(i => i.fav || subs.has(i.feed));
  const s = state.set?.v;
  if (s) Object.assign(set, {theme: String(s.theme), words: String(s.words), every: +s.every || 0, stop: String(s.stop || ''), font: +s.font || 1, dedup: s.dedup !== false, swipe: s.swipe !== false});
  if (Array.isArray(state.mine?.v?.entries)) mine = state.mine.v;
  save('sync', state); save('set', set); save('mine', mine); store(); theme(); applyFont(); render();
  const waiting = feeds.filter(f => !f.loaded);
  if (waiting.length) refresh(waiting);
}
if (window.MMAccount) {
  MMAccount.setup({app: 'lenta', title: 'Мое_лента', toast, note: 'Токен Telegram и адрес посредника остаются только на этом устройстве.',
    snapshot: {get: snapshot, merge, apply: async s => applySnapshot(s), key: stable}});
}
