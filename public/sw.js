/* OCVMS v1.0.3 — cache only the public application shell.
   Sensitive /api data and auth endpoints are NEVER cached here. */
const SHELL='ocvms-shell-v1.0.3';
const FILES=['/','/index.html','/styles.css','/app.js','/offline.js','/favicon.svg','/manifest.webmanifest'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('ocvms-shell-')&&key!==SHELL)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname==='/sw.js')return;
 event.respondWith((async()=>{
  const cache=await caches.open(SHELL);
  try{
   const live=await fetch(r);
   if(live.ok && (r.mode==='navigate'||FILES.includes(u.pathname)))await cache.put(r,live.clone());
   return live;
  }catch(e){
   const cached=await cache.match(r,{ignoreSearch:r.mode==='navigate'});
   if(cached)return cached;
   if(r.mode==='navigate'){const page=await cache.match('/');if(page)return page;}
   throw e;
  }
 })());
});
