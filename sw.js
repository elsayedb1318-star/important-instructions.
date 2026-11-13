const CACHE_NAME = "important-instructions-shell-v50-no-date";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];
const EXTRA = ["./firebase-config.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
const ownMatch = req => caches.open(CACHE_NAME).then(c => c.match(req, { ignoreSearch: true }));
const store = (req, res) => { if(res && (res.ok || res.type === "opaque")){ const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); } return res; };
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all([
    ...ASSETS.map(u => fetch(new Request(u, { cache: "reload" })).then(r => r.ok && cache.put(u, r)).catch(() => {})),
    ...EXTRA.map(u => fetch(u, u.startsWith("http") ? { mode: "no-cors" } : { cache: "reload" }).then(r => (r.ok || r.type === "opaque") && cache.put(u, r)).catch(() => {}))
  ])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith("rasayeli-shell-") || k.startsWith("important-instructions-shell-")) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin){
    if(url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")){
      event.respondWith(ownMatch(req).then(cached => cached || fetch(req).then(res => store(req, res))));
    }
    return;
  }
  event.respondWith(ownMatch(req).then(cached => {
    const net = fetch(req).then(res => store(req, res)).catch(async () => {
      if(cached) return cached;
      if(req.mode === "navigate") return (await ownMatch("./index.html")) || (await ownMatch("./")) || Response.error();
      return Response.error();
    });
    return cached || net;
  }));
});
