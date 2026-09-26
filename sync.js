// Вход с Microsoft (MSAL.js) и синхронизация с OneDrive (Microsoft Graph, само папката на приложението).
import { CONFIG, REDIRECT_URI } from "./config.js";
import { db, mergeRecords, photosOf } from "./db.js";
import { makeThumb } from "./image.js";

const GRAPH = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const COLLECTIONS = [{ store: "candles", file: "data.json" }, { store: "cal", file: "calendar.json" }];
const PHOTO_DIR = "photos";

// MSAL се зарежда първо от папка lib/ (ако сте я качили), иначе от jsDelivr.
const MSAL_SOURCES = [
  "./lib/msal-browser.min.js",
  "https://cdn.jsdelivr.net/npm/@azure/msal-browser@4/lib/msal-browser.min.js",
  "https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js",
];

let pca = null;
let account = null;
let initPromise = null;
const listeners = new Set();
const state = { status: "idle", message: "", lastSync: null, busy: false };

export const syncState = state;
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(patch) { Object.assign(state, patch); listeners.forEach(fn => fn(state)); }

export const isConfigured = () => CONFIG.clientId && !CONFIG.clientId.startsWith("ПОСТАВЕТЕ");

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous";
    s.onload = () => (window.msal ? res() : rej(new Error("no msal")));
    s.onerror = () => { s.remove(); rej(new Error("load failed " + src)); };
    document.head.appendChild(s);
  });
}

async function loadMsal() {
  if (window.msal) return;
  for (const src of MSAL_SOURCES) {
    try { await loadScript(src); return; } catch { /* опитай следващия */ }
  }
  throw new Error("Библиотеката за вход не се зареди. Проверете интернет връзката.");
}

export function initAuth() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    state.lastSync = await db.meta("lastSync");
    if (!isConfigured()) { emit({ status: "unconfigured" }); return; }
    await loadMsal();
    pca = new window.msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: CONFIG.authority,
        redirectUri: REDIRECT_URI,
        postLogoutRedirectUri: REDIRECT_URI,
        navigateToLoginRequestUrl: true,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await pca.initialize();
    const result = await pca.handleRedirectPromise();
    if (result && result.account) account = result.account;
    if (!account) account = pca.getAllAccounts()[0] || null;
    if (account) pca.setActiveAccount(account);
    emit({ status: account ? "signed-in" : "signed-out" });
  })().catch(err => {
    initPromise = null;
    emit({ status: "error", message: err.message });
  });
  return initPromise;
}

export const accountName = () => account ? (account.name || account.username) : null;
export const accountEmail = () => account ? account.username : null;

export async function signIn() {
  await initAuth();
  if (!pca) throw new Error(state.message || "Входът не е настроен.");
  await pca.loginRedirect({ scopes: CONFIG.scopes, prompt: "select_account" });
}

export async function signOut() {
  await initAuth();
  if (!pca || !account) return;
  await pca.logoutRedirect({ account, postLogoutRedirectUri: REDIRECT_URI });
}

class NeedLogin extends Error {}

async function getToken(interactive) {
  await initAuth();
  if (!pca || !account) throw new NeedLogin("Не сте влезли с Microsoft акаунт.");
  try {
    const r = await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account });
    return r.accessToken;
  } catch (err) {
    if (interactive) { await pca.acquireTokenRedirect({ scopes: CONFIG.scopes, account }); return new Promise(() => {}); }
    throw new NeedLogin("Сесията изтече. Натиснете „Влез отново“.");
  }
}

async function graph(token, path, opts = {}) {
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  return res;
}

async function ensureOk(res, what) {
  if (res.ok) return res;
  let detail = "";
  try { detail = (await res.json()).error?.message || ""; } catch {}
  const err = new Error(`${what}: ${res.status} ${detail}`.trim());
  err.status = res.status;
  throw err;
}

async function readRemote(token, file) {
  const meta = await graph(token, `:/${file}`);
  if (meta.status === 404) return { items: [], eTag: null };
  await ensureOk(meta, "Четене на данните от OneDrive");
  const info = await meta.json();
  const res = await fetch(info["@microsoft.graph.downloadUrl"]);
  await ensureOk(res, "Сваляне на данните");
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.candles) ? data.candles : [];
  return { items, eTag: info.eTag };
}

async function writeRemote(token, file, items, eTag) {
  const body = JSON.stringify({ app: "svesti", version: 2, savedAt: new Date().toISOString(), items });
  const headers = { "Content-Type": "application/json" };
  if (eTag) headers["If-Match"] = eTag;
  const res = await graph(token, `:/${file}:/content`, { method: "PUT", headers, body });
  if (res.status === 412) { const e = new Error("conflict"); e.conflict = true; throw e; }
  await ensureOk(res, "Запис на данните в OneDrive");
}

async function uploadPhoto(token, photo) {
  const res = await graph(token, `:/${PHOTO_DIR}/${photo.id}.jpg:/content`, {
    method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: photo.blob,
  });
  await ensureOk(res, "Качване на снимка");
}

async function downloadPhoto(token, id) {
  const meta = await graph(token, `:/${PHOTO_DIR}/${id}.jpg`);
  if (meta.status === 404) return null;
  await ensureOk(meta, "Търсене на снимка");
  const info = await meta.json();
  const res = await fetch(info["@microsoft.graph.downloadUrl"]);
  await ensureOk(res, "Сваляне на снимка");
  const blob = await res.blob();
  const thumb = await makeThumb(blob, CONFIG);
  return { id, blob, thumb, uploaded: true, createdAt: Date.now() };
}

async function cleanRemotePhotos(token, referenced) {
  // Трие от OneDrive снимки, които вече не се ползват (по-стари от 1 ден – за сигурност).
  let url = `:/${PHOTO_DIR}:/children?$select=name,lastModifiedDateTime&$top=200`;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  let res = await graph(token, url);
  if (res.status === 404) return;
  await ensureOk(res, "Списък със снимки");
  let page = await res.json();
  for (;;) {
    for (const item of page.value || []) {
      const id = item.name.replace(/\.jpg$/i, "");
      if (!referenced.has(id) && Date.parse(item.lastModifiedDateTime) < dayAgo) {
        await graph(token, `:/${PHOTO_DIR}/${encodeURIComponent(item.name)}`, { method: "DELETE" });
      }
    }
    if (!page["@odata.nextLink"]) break;
    res = await fetch(page["@odata.nextLink"], { headers: { Authorization: "Bearer " + token } });
    await ensureOk(res, "Списък със снимки");
    page = await res.json();
  }
}

let running = null;

export function syncNow({ interactive = false } = {}) {
  if (running) return running;
  running = doSync(interactive, 0).finally(() => { running = null; });
  return running;
}

async function doSync(interactive, attempt) {
  if (!navigator.onLine) { emit({ status: "offline", message: "Няма интернет. Промените са запазени на телефона." }); return; }
  emit({ busy: true, message: "Синхронизиране…" });
  try {
    const token = await getToken(interactive);
    await ensureOk(await graph(token, ""), "Достъп до папката на приложението");

    let anyChanged = false;
    const pending = [];
    const referenced = new Set();
    for (const col of COLLECTIONS) {
      const local = await db.getAll(col.store);
      const remote = await readRemote(token, col.file);
      const { merged, changedLocal, remoteNeedsUpdate } = mergeRecords(local, remote.items);
      // 1) Обнови локалните записи, дошли от OneDrive
      if (changedLocal.length) {
        anyChanged = true;
        await db.putMany(col.store, changedLocal.map(c => c.incoming));
        for (const { incoming, previous } of changedLocal) {
          const keep = new Set(photosOf(incoming));
          for (const pid of photosOf(previous)) if (!keep.has(pid)) await db.del("photos", pid);
        }
      }
      merged.forEach(r => photosOf(r).forEach(p => referenced.add(p)));
      pending.push({ col, merged, remoteNeedsUpdate, eTag: remote.eTag });
    }

    // 2) Снимки: качи новите, свали липсващите
    const localPhotos = new Map((await db.getAll("photos")).map(p => [p.id, p]));
    let up = 0, down = 0;
    for (const id of referenced) {
      const p = localPhotos.get(id);
      if (p && !p.uploaded) {
        emit({ message: `Качване на снимки… (${++up})` });
        await uploadPhoto(token, p);
        await db.put("photos", { ...p, uploaded: true });
      } else if (!p) {
        emit({ message: `Сваляне на снимки… (${++down})` });
        const got = await downloadPhoto(token, id);
        if (got) await db.put("photos", got);
      }
    }

    // 3) Запиши обединените данни в OneDrive (само ако има нещо ново)
    for (const p of pending) if (p.remoteNeedsUpdate) await writeRemote(token, p.col.file, p.merged, p.eTag);

    // 4) Почисти неизползвани снимки в OneDrive
    try { await cleanRemotePhotos(token, referenced); } catch { /* не е критично */ }

    const now = Date.now();
    await db.setMeta("lastSync", now);
    emit({ status: "signed-in", busy: false, lastSync: now, message: "Синхронизирано", changed: anyChanged });
  } catch (err) {
    if (err.conflict && attempt < 2) return doSync(interactive, attempt + 1);
    if (err instanceof NeedLogin) emit({ status: "need-login", busy: false, message: err.message });
    else emit({ status: account ? "signed-in" : state.status, busy: false, message: "Грешка при синхронизация: " + err.message });
  }
}

// Автоматична синхронизация няколко секунди след промяна.
let timer = null;
export function scheduleSync(delay = 4000) {
  if (!isConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await initAuth();
    if (account) syncNow();
  }, delay);
}
