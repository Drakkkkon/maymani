'use strict';
/* Проверяет ленты из секрета LENTA_PUSH и шлёт push на телефон.
   Репозиторий и журналы открыты всем, поэтому адреса лент и ключи в журнал не выводятся. */
const fs = require('fs');
const crypto = require('crypto');
const FeedLite = require('../../rss/feedlite.js');
const STATE = process.env.STATE_FILE || 'lenta-state.json';
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);

async function load(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {'user-agent': 'Mozilla/5.0 (compatible; MoeLenta/1.2)'}});
  if (!r.ok) throw new Error('HTTP');
  return r.text();
}

async function run(config, send, test) {
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* первый запуск */ }
  const fresh = [];
  let failed = 0;
  for (const f of config.feeds) {
    if (f.url !== 'hub:sites' && !/^https?:\/\//i.test(f.url)) continue;
    try {
      const body = f.url === 'hub:sites' ? fs.readFileSync(__dirname + '/../../js/data.js', 'utf8') : await load(f.url);
      // в сохраняемом состоянии только отпечатки, без адресов и заголовков
      const list = FeedLite.parse(body, f.url).map(i => ({...i, id: hash(i.id)}));
      fresh.push(...FeedLite.pick(seen, hash(f.url), list, config.words).map(i => ({...i, feed: f.title})));
    } catch { failed++; }
  }
  const messages = fresh.slice(0, 5).map(i => ({title: String(i.feed || 'Мое_лента').slice(0, 100), body: i.title.slice(0, 300), url: String(i.link || '').slice(0, 1000)}));
  if (fresh.length > 5) messages.push({title: 'Мое_лента', body: 'И ещё новых записей: ' + (fresh.length - 5), url: ''});
  if (test) messages.unshift({title: 'Мое_лента', body: 'Push-уведомления работают ✅', url: ''});
  for (const m of messages) await send(m);
  fs.writeFileSync(STATE, JSON.stringify(seen));
  console.log(`Лент: ${config.feeds.length}, не загрузилось: ${failed}, новых записей: ${fresh.length}, отправлено: ${messages.length}`);
}

if (require.main === module) {
  if (!process.env.LENTA_PUSH) { console.log('Секрет LENTA_PUSH не задан, делать нечего.'); process.exit(0); }
  (async () => {
    const config = JSON.parse(process.env.LENTA_PUSH);
    const webpush = require('web-push');
    webpush.setVapidDetails('https://drakkkkon.github.io/maymani/', config.publicKey, config.privateKey);
    await run(config, m => webpush.sendNotification(config.sub, JSON.stringify(m), {TTL: 86400}), process.env.TEST_PUSH === 'true');
  })().catch(e => {
    console.error(e.statusCode === 404 || e.statusCode === 410 ? 'Подписка телефона устарела: включите push на сайте заново и обновите секрет.' : 'Не получилось отправить (' + (e.statusCode || e.name) + '). Проверьте секрет LENTA_PUSH.');
    process.exit(1);
  });
}
module.exports = {run};
