/* Same-origin cache for the GitHub Pages/web build. Shell files refresh during
   install; keep the asset cache when only application code and styles change. */
const CACHE_NAME="changchun-mahjong-20260930-1";
const CACHE_PREFIX="changchun-mahjong-";
const ROOT=new URL(self.registration.scope);
const SHELL=["./","./index.html","./styles.css","./game.js","./online.js","./offline.js","./manifest.webmanifest","./assets/vendor/peerjs.min.js"];
const CLASSIC_FILES=[
  ...["Man","Pin","Sou"].flatMap(suit=>Array.from({length:9},(_,i)=>`${suit}${i+1}`)),
  "Ton","Nan","Shaa","Pei","Chun","Hatsu","Haku"
];
const FLAT_FILES=[
  ...["m","p","s"].flatMap(suit=>Array.from({length:9},(_,i)=>`${i+1}${suit}`)),
  ...Array.from({length:7},(_,i)=>`z${i+1}`)
];

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    // A single missing optional file must not prevent the worker installing.
    await Promise.allSettled(SHELL.map(file=>cache.add(file)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cachedAsset(request){
  const cache=await caches.open(CACHE_NAME);
  const saved=await cache.match(request);
  if(saved)return saved;
  try{
    const response=await fetch(request);
    if(response.ok)try{await cache.put(request,response.clone());}catch{}
    return response;
  }catch{return Response.error();}
}

async function cachedShell(event){
  const request=event.request,cache=await caches.open(CACHE_NAME);
  const saved=await cache.match(request);
  const update=fetch(request).then(async response=>{
    if(response.ok)try{await cache.put(request,response.clone());}catch{}
    return response;
  });
  // Show already downloaded code immediately; fetch an updated copy for the
  // next opening without delaying this one on a slow mobile connection.
  if(saved){event.waitUntil(update.catch(()=>{}));return saved;}
  try{return await update;}
  catch{
    if(request.mode==="navigate")return await cache.match("./index.html")||Response.error();
    return Response.error();
  }
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
  const relative=url.pathname.slice(ROOT.pathname.length);
  if(relative==="sw.js")return;
  if(relative.startsWith("assets/"))event.respondWith(cachedAsset(request));
  else if(request.mode==="navigate"||relative===""||/\.(?:html|js|css|webmanifest)$/.test(relative))event.respondWith(cachedShell(event));
});

function themeUrls(theme){
  const flat=theme==="c",folder=flat?"flat/":theme==="b"?"black/":"";
  const extension=flat?"png":"svg",files=flat?FLAT_FILES:CLASSIC_FILES;
  return ["Back",...files].map(file=>new URL(`assets/tiles/${folder}${file}.${extension}`,ROOT).href);
}

async function cacheTheme(theme){
  const urls=themeUrls(theme),cache=await caches.open(CACHE_NAME);
  let next=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(next<urls.length){
      const url=urls[next++];
      if(await cache.match(url))continue;
      try{
        const response=await fetch(url,{cache:"force-cache"});
        if(response.ok)await cache.put(url,response);
      }catch{}
    }
  }));
}

self.addEventListener("message",event=>{
  if(event.data?.type==="cache-theme"&&["a","b","c"].includes(event.data.theme))
    event.waitUntil(cacheTheme(event.data.theme));
});
