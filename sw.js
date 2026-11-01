const CACHE_NAME = "rasayeli-shell-v7";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json"];
const EXTRA = ["./firebase-config.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
const ownMatch = req => caches.open(CACHE_NAME).then(c => c.match(req));
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all([
    cache.addAll(ASSETS),
    ...EXTRA.map(u => fetch(u, u.startsWith("http") ? { mode: "no-cors" } : undefined).then(r => (r.ok || r.type === "opaque") && cache.put(u, r)).catch(() => {}))
  ])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("rasayeli-shell-") && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin){
    if(url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")){
      event.respondWith(ownMatch(event.request).then(cached => cached || fetch(event.request).then(response => {
        if(response.ok || response.type === "opaque") caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      })));
    }
    return;
  }
  event.respondWith(ownMatch(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => ownMatch("./index.html"))));
});
