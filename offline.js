/* Cache local game files when the browser supports service workers. The game
   remains usable without this feature, including when opened as a local file. */
(()=>{
  "use strict";
  if(!("serviceWorker" in navigator)||!/^https?:$/.test(location.protocol))return;

  const registration=navigator.serviceWorker.register("./sw.js").catch(()=>null);
  window.MahjongCacheTheme=theme=>{
    if(!["a","b","c"].includes(theme))return;
    registration.then(async reg=>{
      if(!reg)return;
      const ready=await navigator.serviceWorker.ready;
      (navigator.serviceWorker.controller||ready.active||reg.active)?.postMessage({type:"cache-theme",theme});
    }).catch(()=>{});
  };

  // Give the visible hand priority on a slow connection, then warm the rest of
  // the selected tile set in the background for later rounds and visits.
  setTimeout(()=>window.MahjongCacheTheme(document.body?.dataset.tileTheme||"c"),2000);
})();
