'use strict';
/* Разбор лент без DOMParser: нужен фоновой части сайта и сервису push-уведомлений. */
(function (root) {
  const ent = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
  const decode = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, c) => {
    if (c[0] !== '#') return ent[c] ?? m;
    const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1);
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  const text = s => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const tag = (block, name) => (block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i')) || [])[1] || '';
  const isGitHub = url => url.startsWith('https://api.github.com/');

  function parse(body, url) {
    if (url === 'hub:sites') {
      const hub = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
      return hub.programs.flatMap(p => p.versions.map(v => ({id: p.id + '@' + v.v + '@' + v.date, title: p.name + ' ' + v.v,
        text: (v.items || []).join(' '), link: 'https://drakkkkon.github.io/maymani/' + p.page, date: Date.parse(v.date) || 0})))
        .sort((a, b) => b.date - a.date).slice(0, 40);
    }
    if (isGitHub(url)) return JSON.parse(body).map(r => ({id: r.html_url, title: r.name || r.tag_name, text: r.body || '', link: r.html_url}));
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 3000))) throw new Error('не лента');
    return (body.match(/<(item|entry)(\s[^>]*)?>[\s\S]*?<\/\1>/gi) || []).slice(0, 60).map(b => {
      const links = b.match(/<link\s[^>]*>/gi) || [];
      const alt = links.find(l => /rel=["']alternate["']/i.test(l)) || links.find(l => !/rel=/i.test(l));
      const link = text(tag(b, 'link')) || decode((alt && alt.match(/href=["']([^"']+)["']/i) || [])[1]);
      const title = text(tag(b, 'title')) || 'Новая запись';
      // тот же идентификатор, что и на странице: guid или id, затем ссылка, затем заголовок
      const id = decode(tag(b, 'guid').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || tag(b, 'id')).trim() || link || title;
      return {id, title, link, text: text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 2000)};
    });
  }

  const matches = (item, words) => {
    const list = String(words || '').toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
    const hay = (item.title + ' ' + item.text).toLowerCase();
    return !list.length || list.some(w => hay.includes(w));
  };

  const stopped = (item, stop) => {
    const list = String(stop || '').toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
    const hay = (item.title + ' ' + item.text).toLowerCase();
    return list.some(w => hay.includes(w));
  };

  // Возвращает новые записи и обновляет seen. Первая проверка ленты только запоминает то, что уже есть.
  function pick(seen, key, list, words, stop) {
    const old = seen[key];
    const known = new Set(old || []);
    const fresh = old ? list.filter(i => !known.has(i.id) && matches(i, words) && !stopped(i, stop)) : [];
    seen[key] = [...new Set([...list.map(i => i.id), ...known])].slice(0, 150);
    return fresh;
  }

  const api = {parse, pick, matches, stopped, isGitHub};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FeedLite = api;
})(typeof self === 'object' ? self : globalThis);
