// Service worker: приложението работи без интернет.
// При промяна на файловете увеличете VERSION, за да се обнови кешът по-бързо.
const VERSION = "v5";
const CACHE = "svesti-" + VERSION;
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./db.js", "./calc.js", "./image.js", "./sync.js", "./config.js",
  "./ui.js", "./recipes.js", "./calc-ui.js", "./calendar.js", "./cal-ui.js", "./finance.js", "./fin-ui.js", "./arrangements.js", "./cost-ui.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png",
];
const RUNTIME_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("svesti-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Навигация (отваряне на приложението, връщане от вход с Microsoft) -> index.html от кеша
  if (req.mode === "navigate" && url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Файлове на приложението: веднага от кеша, обновяване във фон
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    }));
    return;
  }

  // Шрифтове и библиотеката за вход: от кеша, ако ги има
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }));
  }
  // Всичко останало (Microsoft вход, OneDrive) минава директно през мрежата.
});
