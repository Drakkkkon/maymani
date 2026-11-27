// Оболочка сайта открывается без интернета; сначала всегда пробуем свежую версию.
importScripts('feedlite.js');
const CACHE = 'moe-lenta-1.4.1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'extra.js', 'media.js', 'more.js', 'android.js', 'readability.js', 'notify.js', 'feedlite.js', 'mm-account.js', 'icon.svg', 'icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('moe-lenta-') && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request, {ignoreSearch: true})));
});

/* ---------- уведомления ---------- */
const show = (title, body, url) => self.registration.showNotification(title, {body, icon: 'icon-192.png', data: {url}, tag: url || title});

// Настройки для фоновой проверки страница кладёт в отдельное хранилище.
async function readConfig() {
  const r = await (await caches.open('ml-notify')).match('config');
  return r ? r.json() : null;
}
async function load(url) {
  if (url === 'hub:sites') url = new URL('../js/data.js?t=' + Date.now(), location.href).href;
  const e = encodeURIComponent(url);
  const tries = url.startsWith('https://api.github.com/') ? [url] : [url, 'https://api.allorigins.win/raw?url=' + e, 'https://api.codetabs.com/v1/proxy/?quest=' + e];
  if (tries.length > 1) tries.splice(1, 0, 'https://r.jina.ai/' + url);
  for (const t of tries) {
    try {
      const jina = t.startsWith('https://r.jina.ai/');
      const r = await fetch(t, {signal: AbortSignal.timeout(jina ? 25000 : 10000), cache: 'no-store', headers: jina ? {'x-respond-with': 'html'} : {}});
      if (!r.ok) continue;
      let body = await r.text();
      // r.jina.ai оборачивает XML и JSON в страницу с <pre>
      const pre = jina && /^\s*<html/i.test(body) && body.match(/<pre[^>]*>([\s\S]*)<\/pre>/i);
      if (pre) body = pre[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      if (/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 3000)) || /^\s*[\[{]/.test(body) || url.includes('/js/data.js')) return body;
    } catch { /* следующий способ */ }
  }
  throw new Error('не загрузилось');
}
async function check() {
  const c = await readConfig();
  if (!c || c.mode !== 'simple') return;
  const fresh = [], queue = [...c.feeds];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        const list = FeedLite.parse(await load(f.url), f.url);
        fresh.push(...FeedLite.pick(c.seen, f.url, list, c.words, c.stop).map(i => ({...i, feed: f.title})));
      } catch { /* эту ленту проверим в другой раз */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await (await caches.open('ml-notify')).put('config', new Response(JSON.stringify(c)));
  for (const i of fresh.slice(0, 5)) await show(i.feed || 'Мое_лента', i.title, i.link);
  if (fresh.length > 5) await show('Мое_лента', 'И ещё новых записей: ' + (fresh.length - 5), '');
}
self.addEventListener('periodicsync', e => { if (e.tag === 'ml-check') e.waitUntil(check()); });
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { /* пустой сигнал */ }
  e.waitUntil(show(d.title || 'Мое_лента', d.body || 'Есть новые записи', d.url || ''));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url;
  e.waitUntil((async () => {
    if (/^https?:\/\//i.test(url || '')) return self.clients.openWindow(url);
    const [w] = await self.clients.matchAll({type: 'window'});
    return w ? w.focus() : self.clients.openWindow('./');
  })());
});
