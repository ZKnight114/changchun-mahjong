/* Versioned, all-or-nothing web updates. Never reload an active match/room.
   Every open game page must agree before a waiting worker takes control. */
(()=>{
  "use strict";
  const VERSION=window.MahjongRules.config.appVersion;
  const $=id=>document.getElementById(id);
  $("appVersion").textContent=VERSION;
  $("appMenuVersion").textContent=VERSION;
  if(!("serviceWorker" in navigator)||!/^https?:$/.test(location.protocol)){
    for(const id of ["homeUpdateBtn","checkUpdateBtn"]){$(id).disabled=true;$(id).title="本地文件或当前浏览器不支持在线更新检查";}
    return;
  }
  const sw=navigator.serviceWorker;
  let reg=null,waiting=null,readyVersion="",activeVersion="",notice="";
  let checking=false,applying=false,reloadIssued=false,lastCheck=-Infinity;
  let hold=null,holdTimer=null;
  const watched=new WeakSet();
  const newer=version=>{
    const candidate=version?.match(/^(\d{8})-(\d+)$/),current=VERSION.match(/^(\d{8})-(\d+)$/);
    return !!candidate&&!!current&&(candidate[1]>current[1]||(candidate[1]===current[1]&&+candidate[2]>+current[2]));
  };
  const safe=()=>window.MahjongUpdatePolicy?.().safe===true;
  const visible=()=>!document.hidden;
  const busy=()=>applying||!!hold||reloadIssued;
  window.MahjongUpdateBusy=busy;

  function render(){
    const ready=newer(readyVersion)||newer(activeVersion);
    const message=busy()?"新版已下载完整，正在切换…":notice||(ready?"新版已就绪，返回主页后自动切换。":"");
    $("appUpdateMessage").textContent=message;
    $("appUpdateMessage").hidden=!message;
    $("appUpdateBadge").hidden=!ready;
    $("appUpdateBadge").title=message;
    $("menuToggle").dataset.updateReady=String(!!ready);
    document.body.dataset.updateSwitching=String(busy());
    for(const id of ["homeUpdateBtn","checkUpdateBtn"]){
      $(id).disabled=checking||busy();
      $(id).title=message||"联网检查新版，保留存档和牌面缓存";
    }
    $("homeUpdateBtn").textContent=checking?"检查中…":"检查更新";
    $("menuUpdateLabel").textContent=busy()?"切换中…":checking?"检查中…":ready?"新版就绪"
      :notice.includes("无法检查")?"检查失败":notice.includes("未发现")?"暂无新版"
      :notice.includes("正在下载")?"下载新版":"检查更新";
  }
  function ask(worker,data,timeout=4000){
    return new Promise(resolve=>{
      if(!worker){resolve(null);return;}
      const channel=new MessageChannel();let finished=false;
      const done=value=>{if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
      const timer=setTimeout(()=>done(null),timeout);
      channel.port1.onmessage=event=>done(event.data);
      try{worker.postMessage(data,[channel.port2]);}catch{done(null);}
    });
  }
  function releaseHold(token){
    if(token&&hold?.token!==token)return;
    clearTimeout(holdTimer);holdTimer=null;hold=null;render();
  }
  function prepare(worker,token){
    hold={worker,token};clearTimeout(holdTimer);
    holdTimer=setTimeout(()=>{
      releaseHold(token);applying=false;
      notice="切换暂未完成，旧版仍可使用；可再次检查更新。";render();
      inspectController();
    },15000);
    render();
  }
  function reloadOnce(){
    if(reloadIssued||!visible()||!safe())return;
    reloadIssued=true;render();location.reload();
  }
  async function inspectController(){
    const controller=sw.controller;
    const reply=await ask(controller,{type:"mahjong-get-version"});
    if(controller!==sw.controller||reply?.type!=="mahjong-version")return;
    activeVersion=reply.version;
    if(activeVersion===VERSION&&(!readyVersion||readyVersion===VERSION)&&notice==="正在下载新版，完成后再切换。")notice="";
    render();
    if(newer(activeVersion))reloadOnce();
    // Do not release a preparation lease when a focus event still sees the
    // old controller: other tabs may be completing the activation handshake.
  }
  async function applyReady(){
    if(busy()||!visible()||!safe())return;
    if(newer(activeVersion)){reloadOnce();return;}
    if(!waiting||!newer(readyVersion)||waiting.state!=="installed")return;
    applying=true;notice="";render();
    const worker=waiting,version=readyVersion;
    const reply=await ask(worker,{type:"mahjong-activate-update",version},8000);
    if(reloadIssued)return;
    if(reply?.accepted){
      // Keep inputs blocked through controllerchange, then reload exactly once.
      if(!hold)prepare(worker,reply.token);
      await inspectController();
    }else{
      releaseHold();applying=false;
      notice=reply?.reason==="busy"?"新版已就绪；其他麻将页面正对局或未响应，返回主页或关闭它们后再检查。"
        :"新版暂未完成切换，旧版仍可使用；可再次检查更新。";
      render();
    }
  }
  async function discover(worker){
    if(!worker||worker.state!=="installed")return;
    const reply=await ask(worker,{type:"mahjong-get-version"});
    if(reply?.type!=="mahjong-version"||worker.state!=="installed")return;
    waiting=worker;readyVersion=reply.version;
    notice="";render();
    if(newer(readyVersion))await applyReady();
  }
  function watch(worker){
    if(!worker||watched.has(worker))return;
    watched.add(worker);
    worker.addEventListener("statechange",()=>{
      if(worker.state==="installed")discover(worker);
      else if(worker.state==="redundant"){
        if(waiting===worker){waiting=null;readyVersion="";}
        notice="新版下载未完成，继续使用旧版，联网后可重试。";render();
      }
    });
  }
  let registering=null;
  async function register(){
    if(reg)return reg;
    if(!registering)registering=sw.register("./sw.js",{updateViaCache:"none"}).then(value=>{
      reg=value;
      reg.addEventListener("updatefound",()=>{watch(reg.installing);notice="正在下载新版，完成后再切换。";render();});
      watch(reg.installing);return reg;
    }).catch(()=>null).finally(()=>{registering=null;});
    return registering;
  }
  async function check(manual=false){
    if(busy()){
      // A hidden home page may already have the new controller and a lease
      // from another tab. On foreground, finish its reload without waiting
      // for that lease to expire.
      if(!reloadIssued&&visible())await inspectController();
      return;
    }
    if(checking)return;
    // An already downloaded update can be activated without a network request.
    if(reg?.waiting){
      await discover(reg.waiting);
      await inspectController();
      // Don't repeatedly probe other tabs or fetch the network while a
      // complete update is already waiting for them to leave their games.
      if(newer(readyVersion))return;
    }
    if(busy())return;
    if(!manual&&Date.now()-lastCheck<60000){await inspectController();return;}
    lastCheck=Date.now();checking=true;
    if(manual)notice="正在检查可用更新…";render();
    try{
      const registration=await register();
      if(!registration)throw Error("registration unavailable");
      await registration.update();watch(registration.installing);
      if(registration.waiting)await discover(registration.waiting);
      await inspectController();
      if(manual&&!readyVersion&&!registration.installing&&!busy())notice="未发现可用更新；发布后可能需要稍等再检查。";
    }catch{if(manual)notice="暂时无法检查更新，旧版仍可使用，请联网后重试。";}
    finally{checking=false;render();}
  }
  sw.addEventListener("message",event=>{
    const data=event.data,worker=event.source;
    if(data?.type==="mahjong-update-status"){
      // Only the waiting worker for our registration may reserve this page.
      if(!worker||(worker!==reg?.waiting&&worker!==waiting))return;
      const allowed=safe();
      if(allowed){readyVersion=data.version;prepare(worker,data.token);}
      event.ports?.[0]?.postMessage({type:"mahjong-update-status",safe:allowed,token:data.token});
    }else if(data?.type==="mahjong-update-cancelled"&&worker===hold?.worker){
      releaseHold(data.token);
    }
  });
  sw.addEventListener("controllerchange",inspectController);
  // Close the small race between a safe-home reply and someone starting a game.
  for(const type of ["click","keydown"])document.addEventListener(type,event=>{
    if(busy()){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  for(const type of ["pageshow","focus","online"])window.addEventListener(type,()=>{if(visible())check();});
  document.addEventListener("visibilitychange",()=>{if(visible())check();});
  for(const id of ["homeUpdateBtn","checkUpdateBtn"])$(id).onclick=()=>check(true);
  window.MahjongUpdateHome=()=>{applyReady();check();};

  window.MahjongCacheTheme=theme=>{
    if(!["a","b","c"].includes(theme))return;
    register().then(async registration=>{
      if(!registration)return;
      const ready=await sw.ready;
      (sw.controller||ready.active||registration.active)?.postMessage({type:"cache-theme",theme});
    }).catch(()=>{});
  };
  // Leave initial tile rendering first in the download queue.
  setTimeout(()=>window.MahjongCacheTheme(document.body?.dataset.tileTheme||"c"),2000);
  render();check();
})();
