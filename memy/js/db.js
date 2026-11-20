// Мое_мемы — локальная база сайта (IndexedDB) + избранное (localStorage)
const DB = (() => {
  const NAME = 'moe_memy', VER = 1, STORE = 'saved';
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    put: (item) => tx('readwrite', st => st.put(item)),
    del: (id) => tx('readwrite', st => st.delete(id)),
    get: (id) => tx('readonly', st => st.get(id)),
    all: async () => {
      const list = await tx('readonly', st => st.getAll());
      return (list || []).sort((a, b) => b.created - a.created);
    }
  };
})();

const Favs = {
  KEY: 'mm_favs',
  list() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch (e) { return []; } },
  has(id) { return this.list().some(t => t.id === id); },
  toggle(t) {
    let l = this.list();
    if (l.some(x => x.id === t.id)) l = l.filter(x => x.id !== t.id);
    else l.unshift({ id: t.id, name: t.name, url: t.url });
    try { localStorage.setItem(this.KEY, JSON.stringify(l)); } catch (e) {}
    return l.some(x => x.id === t.id);
  }
};
