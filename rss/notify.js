'use strict';
/* Уведомления Android (с 1.2.0): простые (без сервера) и push через GitHub Actions. */
let ntf = load('notify', {mode: 'off'}), ntfStatus = '';
const REPO_SECRETS = 'https://github.com/Drakkkkon/maymani/settings/secrets/actions/new';
const REPO_RUN = 'https://github.com/Drakkkkon/maymani/actions/workflows/lenta-push.yml';
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function worker() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('этот браузер не умеет показывать уведомления');
  if (await Notification.requestPermission() !== 'granted') throw new Error('уведомления запрещены: разрешите их в настройках сайта в браузере');
  return navigator.serviceWorker.ready;
}
// Передаём фоновой части список лент и уже виденные записи.
async function syncNotify() {
  if (!('caches' in window)) return;
  const box = await caches.open('ml-notify');
  const old = await box.match('config').then(r => r ? r.json() : null);
  const seen = {};
  for (const f of feeds) {
    const ids = [...new Set([...items.filter(i => i.feed === f.url).map(i => i.id), ...(old?.seen?.[f.url] || [])])].slice(0, 150);
    if (ids.length) seen[f.url] = ids;
  }
  await box.put('config', new Response(JSON.stringify({mode: ntf.mode, words: set.words, feeds: feeds.map(f => ({url: f.url, title: f.title})), seen})));
}
// Пока сайт открыт, но свёрнут, новые записи показываем сразу.
async function notifyFresh(fresh) {
  if (ntf.mode === 'simple' && document.hidden && Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    for (const i of fresh.filter(i => FeedLite.matches({title: i.title, text: plain(i.html)}, set.words)).slice(0, 5))
      await reg.showNotification(feeds.find(f => f.url === i.feed)?.title || 'Мое_лента', {body: i.title, icon: 'icon-192.png', data: {url: i.link}, tag: i.link || i.title});
  }
  await syncNotify();
}
async function stopNotify() {
  const reg = await navigator.serviceWorker.ready;
  await reg.periodicSync?.unregister('ml-check').catch(() => {});
  await (await reg.pushManager?.getSubscription())?.unsubscribe();
  ntf = {mode: 'off'}; save('notify', ntf); await syncNotify(); ntfStatus = 'Уведомления выключены.';
}
async function startSimple() {
  const reg = await worker();
  await stopNotify();
  ntf = {mode: 'simple'}; save('notify', ntf); await syncNotify();
  try {
    await reg.periodicSync.register('ml-check', {minInterval: 60 * 60 * 1000});
    ntfStatus = 'Включено. Chrome сам решает, когда проверять ленты в фоне.';
  } catch {
    ntfStatus = 'Включено, но проверка в фоне пока недоступна. Установите сайт на главный экран через меню Chrome, откройте его оттуда и нажмите кнопку ещё раз.';
  }
  await reg.showNotification('Мое_лента', {body: 'Уведомления включены ✅', icon: 'icon-192.png'});
}
async function startPush() {
  const reg = await worker();
  if (!reg.pushManager) throw new Error('этот браузер не поддерживает push');
  await stopNotify();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: pub});
  ntf = {mode: 'push', publicKey: b64u(pub), privateKey: jwk.d, sub: sub.toJSON()};
  save('notify', ntf); await syncNotify();
  ntfStatus = 'Телефон готов. Теперь скопируйте настройки и вставьте их в GitHub (инструкция ниже).';
}
const pushConfig = () => JSON.stringify({publicKey: ntf.publicKey, privateKey: ntf.privateKey, sub: ntf.sub, words: set.words, feeds: feeds.map(f => ({url: f.url, title: f.title || ''}))});

function notifyBlock() {
  const state = {off: 'выключены', simple: 'простые', push: 'push через GitHub'}[ntf.mode];
  return `<h2>Уведомления на телефоне</h2><div class="card"><div>Сейчас: <b>${state}</b></div>
<div class="row"><button data-ntf="simple">Включить простые</button><button data-ntf="push">Включить push</button>${ntf.mode === 'off' ? '' : '<button data-ntf="off">Выключить</button>'}</div>
${ntf.mode === 'push' ? `<div class="row"><button class="main" data-ntf="copy">Скопировать настройки для GitHub</button></div><p class="meta">После изменения подписок или «моих слов» скопируйте и вставьте настройки заново.</p><textarea id="ntfcfg" rows="3" readonly hidden></textarea>` : ''}
<p class="meta" role="status">${esc(ntfStatus)}</p>
<p class="meta">Приходят новые записи; если заданы «мои слова», то только с ними.</p></div>
<details><summary>Простые уведомления: как работают</summary><p>Без сервера. Установите сайт на главный экран (меню Chrome → «Установить приложение» или «Добавить на главный экран»), откройте оттуда и нажмите «Включить простые». Как часто проверять ленты в фоне, решает Chrome: обычно не чаще раза в 12 часов.</p></details>
<details><summary>Push: настройка через GitHub, один раз</summary><ol><li>Нажмите «Включить push», затем «Скопировать настройки для GitHub».</li>
<li>Откройте <a href="${REPO_SECRETS}" target="_blank" rel="noopener">новый секрет в репозитории maymani</a> и войдите в GitHub.</li>
<li>В поле Name впишите <b>LENTA_PUSH</b>, в поле Secret вставьте скопированное, нажмите «Add secret».</li>
<li>Для проверки откройте <a href="${REPO_RUN}" target="_blank" rel="noopener">запуск Lenta push</a>, нажмите «Run workflow» и ещё раз «Run workflow». Через минуту-две придёт проверочное уведомление.</li></ol>
<p>Дальше ленты проверяются примерно раз в 30 минут, бывают задержки. Если секрет уже есть, обновите его через карандаш рядом с названием. Настройки никому не пересылайте. GitHub отключает расписание, если в репозитории 60 дней нет изменений. Push настраивается на одном устройстве.</p></details>`;
}
document.addEventListener('click', async e => {
  const act = e.target.closest('[data-ntf]')?.dataset.ntf; if (!act) return;
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(pushConfig()); toast('Скопировано'); }
    catch { const t = $('#ntfcfg'); t.hidden = false; t.value = pushConfig(); t.select(); toast('Скопируйте текст из поля вручную'); }
    return;
  }
  try { await {simple: startSimple, push: startPush, off: stopNotify}[act](); }
  catch (err) { ntfStatus = 'Не получилось: ' + err.message; }
  if (page === 'settings') render();
});
addEventListener('DOMContentLoaded', () => syncNotify().catch(() => {}));
