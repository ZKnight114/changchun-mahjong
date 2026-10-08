/* Same-origin cache for the GitHub Pages/web build. Shell files refresh during
   install; keep the asset cache when only application code and styles change. */
const CACHE_NAME="changchun-mahjong-shell-20261008-6";
const ASSET_CACHE="changchun-mahjong-assets-v1";
const CACHE_PREFIX="changchun-mahjong-";
const ROOT=new URL(self.registration.scope);
const SHELL=["./","./index.html","./styles.css","./rules.js","./game.js","./online.js","./offline.js","./manifest.webmanifest","./assets/vendor/peerjs.min.js"];
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
    // Commit a shell only after every required file downloaded successfully.
    // Existing tabs keep their worker until closed, avoiding mid-game changes.
    await cache.addAll(SHELL.map(file=>new Request(new URL(file,ROOT),{cache:"reload"})));
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    const assets=await caches.open(ASSET_CACHE);
    // Migrate the old combined caches before deleting their shell files.
    for(const name of names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME&&name!==ASSET_CACHE)) {
      const old=await caches.open(name);
      for(const request of await old.keys()) {
        const url=new URL(request.url);
        if(url.origin===ROOT.origin&&url.pathname.startsWith(new URL("assets/",ROOT).pathname)
          &&url.pathname!==new URL("assets/vendor/peerjs.min.js",ROOT).pathname
          &&!await assets.match(request)) {
          const response=await old.match(request);
          if(response)await assets.put(request,response);
        }
      }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function cachedAsset(request){
  const cache=await caches.open(ASSET_CACHE);
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
  const canonical=request.mode==="navigate"?new URL("./index.html",ROOT).href:new URL(new URL(request.url).pathname,ROOT).href;
  const saved=await cache.match(canonical);
  if(saved)return saved;
  try{return await fetch(request);}
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
  if(relative==="assets/vendor/peerjs.min.js")event.respondWith(cachedShell(event));
  else if(relative.startsWith("assets/"))event.respondWith(cachedAsset(request));
  else if(request.mode==="navigate"||relative===""||/\.(?:html|js|css|webmanifest)$/.test(relative))event.respondWith(cachedShell(event));
});

function themeUrls(theme){
  const flat=theme==="c",folder=flat?"flat/":theme==="b"?"black/":"";
  const extension=flat?"png":"svg",files=flat?FLAT_FILES:CLASSIC_FILES;
  return ["Back",...files].map(file=>new URL(`assets/tiles/${folder}${file}.${extension}`,ROOT).href);
}

async function cacheTheme(theme){
  const urls=themeUrls(theme),cache=await caches.open(ASSET_CACHE);
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
