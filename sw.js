const CACHE='alpine-yuki-v22-20261001-115058-612';
const ASSETS=['./app-update.js?v=20261001-115058-612','./','./index.html','./app.js?v=20261001-115058-612','./premium-background.js','./device-stats-config.js','./device-stats.js','./jsQR.js','./ssr-holo.webp','./ultra-premium.png','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('alpine-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/saj-data.json')||url.pathname.endsWith('/version.json'))return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)))}return r}).catch(()=>caches.match(e.request)));
});





