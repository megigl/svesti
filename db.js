// Локално хранилище в IndexedDB: рецепти, календар, снимки и настройки.
const DB_NAME = "svesti-db";
const DB_VERSION = 2;
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, key] of [["candles", "id"], ["photos", "id"], ["meta", "key"], ["cal", "id"]]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  getAll: store => tx(store, "readonly", s => wrap(s.getAll())),
  get: (store, id) => tx(store, "readonly", s => wrap(s.get(id))),
  put: (store, obj) => tx(store, "readwrite", s => { s.put(obj); }),
  putMany: (store, arr) => tx(store, "readwrite", s => { arr.forEach(o => s.put(o)); }),
  del: (store, id) => tx(store, "readwrite", s => { s.delete(id); }),
  async meta(key, fallback = null) {
    const r = await this.get("meta", key);
    return r ? r.value : fallback;
  },
  setMeta: (key, value) => tx("meta", "readwrite", s => { s.put({ key, value }); }),
};

export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageInfo() {
  const info = { persisted: false, usage: 0, quota: 0 };
  if (navigator.storage) {
    if (navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage.estimate) Object.assign(info, await navigator.storage.estimate());
  }
  return info;
}

// Снимките, към които сочи един запис (рецепта или пост от календара).
export function photosOf(rec) {
  if (!rec || rec.deleted) return [];
  return rec.photos || (rec.local && rec.local.photos) || [];
}

// Сливане на два списъка: за всеки запис печели по-новият (updatedAt).
export function mergeRecords(localList, remoteList) {
  const map = new Map();
  for (const c of localList) map.set(c.id, c);
  const changedLocal = [];
  for (const r of remoteList) {
    const l = map.get(r.id);
    if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) {
      map.set(r.id, r);
      changedLocal.push({ incoming: r, previous: l || null });
    }
  }
  const remoteMap = new Map(remoteList.map(r => [r.id, r]));
  const remoteNeedsUpdate = [...map.values()].some(c => {
    const r = remoteMap.get(c.id);
    return !r || (c.updatedAt || 0) > (r.updatedAt || 0);
  });
  return { merged: [...map.values()], changedLocal, remoteNeedsUpdate };
}

// Настройки (пазят се само на този телефон).
export const DEFAULT_SETTINGS = {
  season: "auto",       // auto | autumn | christmas | valentine | spring | occasions
  aromaMethod: "total", // total = % от теглото на свещта; wax = % от восъка
  maxAroma: 10,         // % от восъка
  maxDye: 0.4,          // % от восъка
  graceDays: 7,         // дни след публикуване, след които снимките на поста се трият
};
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await db.meta("settings", {})) };
}
export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await db.setMeta("settings", s);
  return s;
}
