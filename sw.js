const CACHE_PREFIX = `tuner-${self.registration.scope}-`;
// Bump this version whenever any cached file changes.
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./pitch.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(ASSETS.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" })))
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.href.startsWith(self.registration.scope)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Home-screen launches may include query parameters; they use the same page.
    const isHome = event.request.mode === "navigate" &&
      (url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL("index.html", self.registration.scope).pathname);
    const cached = await cache.match(isHome ? self.registration.scope : event.request);
    return cached || fetch(event.request);
  })());
});
