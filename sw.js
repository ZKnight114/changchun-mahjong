/* Same-origin cache for the GitHub Pages/web build. Shell files refresh during
   install; keep the asset cache when only application code and styles change. */
importScripts("./rules.js");
const APP_VERSION=globalThis.MahjongRules.config.appVersion;
const CACHE_NAME=`changchun-mahjong-shell-${APP_VERSION}`;
const ASSET_CACHE="changchun-mahjong-assets-v1";
const CACHE_PREFIX="changchun-mahjong-";
const ROOT=new URL(self.registration.scope);
const SOUND_SHELL_FILES=["assets/sounds/discard-a1.wav","assets/sounds/chi-a2.wav","assets/sounds/peng-a3.wav","assets/sounds/gang-a4.wav","assets/sounds/win-h2.wav","assets/sounds/ting.wav","assets/sounds/draw.wav","assets/sounds/drawgame.wav"];
const SHELL=["./","./index.html","./styles.css","./table-layout.css","./table-layout.js","./rules.js","./game.js","./online.js","./install.js","./offline.js","./manifest.webmanifest","./assets/vendor/peerjs.min.js",...SOUND_SHELL_FILES.map(file=>`./${file}`)];
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
    await cache.addAll(SHELL.map(file=>new Request(new URL(file,ROOT),{cache:"reload"})));
    const metadata=await cache.match(new URL("./rules.js",ROOT).href);
    const downloadedVersion=(await metadata.text()).match(/appVersion\s*:\s*["']([^"']+)["']/)?.[1];
    if(downloadedVersion!==APP_VERSION)throw Error("Published version metadata changed during installation");
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    const assets=await caches.open(ASSET_CACHE);
    // Migrate the old combined caches before deleting their shell files.
    for(const name of names.filter(olderCache)) {
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

function olderCache(name){
  if(!name.startsWith(CACHE_PREFIX)||name===CACHE_NAME||name===ASSET_CACHE)return false;
  const version=name.match(/^changchun-mahjong-(?:shell-)?(\d{8})-(\d+)$/);
  const current=APP_VERSION.match(/^(\d{8})-(\d+)$/);
  return !!version&&!!current&&(version[1]<current[1]||(version[1]===current[1]&&+version[2]<+current[2]));
}

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
  if(relative==="assets/vendor/peerjs.min.js"||SOUND_SHELL_FILES.includes(relative))event.respondWith(cachedShell(event));
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

const inScope=client=>client?.type==="window"&&new URL(client.url).origin===ROOT.origin&&new URL(client.url).pathname.startsWith(ROOT.pathname);
async function gameClients(){return (await self.clients.matchAll({type:"window",includeUncontrolled:true})).filter(inScope);}
function probe(client,token){
  return new Promise(resolve=>{
    const channel=new MessageChannel();let finished=false;
    const done=safe=>{if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(safe);};
    const timer=setTimeout(()=>done(false),2500);
    channel.port1.onmessage=event=>done(event.data?.type==="mahjong-update-status"&&event.data.token===token&&event.data.safe===true);
    try{client.postMessage({type:"mahjong-update-status",version:APP_VERSION,token},[channel.port2]);}catch{done(false);}
  });
}
let activation=null,activationSerial=0;
async function activateUpdate(requester){
  const token=`${APP_VERSION}:${Date.now()}:${++activationSerial}`;
  let pages=[];
  try{
    const cache=await caches.open(CACHE_NAME);
    if(!(await Promise.all(SHELL.map(file=>cache.match(new URL(file,ROOT).href)))).every(Boolean))
      return {accepted:false,reason:"incomplete"};
    pages=await gameClients();
    if(!pages.some(client=>client.id===requester))return {accepted:false,reason:"invalid"};
    const replies=await Promise.all(pages.map(client=>probe(client,token)));
    const latest=await gameClients();
    // Recheck the client list: a new page may have opened during the handshake.
    if(replies.every(Boolean)&&latest.every(client=>pages.some(page=>page.id===client.id))){
      await self.skipWaiting();return {accepted:true,token,version:APP_VERSION};
    }
  }catch{}
  for(const client of pages)try{client.postMessage({type:"mahjong-update-cancelled",token});}catch{}
  return {accepted:false,reason:"busy",token};
}
self.addEventListener("message",event=>{
  if(event.data?.type==="cache-theme"&&["a","b","c"].includes(event.data.theme))
    event.waitUntil(cacheTheme(event.data.theme));
  else if(event.data?.type==="mahjong-get-version")
    event.ports?.[0]?.postMessage({type:"mahjong-version",version:APP_VERSION});
  else if(event.data?.type==="mahjong-activate-update"){
    event.waitUntil((async()=>{
      const reply=event.ports?.[0];
      if(!inScope(event.source)||event.data.version!==APP_VERSION){reply?.postMessage({accepted:false,reason:"invalid"});return;}
      // Concurrent home screens share one handshake, not competing leases.
      if(!activation)activation=activateUpdate(event.source.id).finally(()=>{activation=null;});
      reply?.postMessage(await activation);
    })());
  }
});
