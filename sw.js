const CACHE='limperial-selection-shell-v87';
const FILES=['./','./index.html','./catalog-split.js','./brand-library.js','./central-catalog.js','./team-sync.js','./selection-costs.js','./pdf-access.js','./app.js','./style.css','./manifest.webmanifest','./favicon.ico','./favicon-32.png','./favicon-48.png','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('limperial-selection-shell-')&&key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(event.request)));
});