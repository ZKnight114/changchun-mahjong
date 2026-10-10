/* Home-screen installation, independent of game rules and update switching.
   Browsers control consent/availability. iOS has no programmable install API. */
(()=>{
  "use strict";
  const button=document.getElementById('installAppBtn'),dialog=document.getElementById('installHelpDialog');
  if(!button||!dialog)return;
  let deferredPrompt=null,prompting=false,installed=false;
  const standalone=window.matchMedia?.('(display-mode: standalone)');
  const isInstalled=()=>installed||standalone?.matches===true||navigator.standalone===true;
  function refresh(){
    button.hidden=isInstalled();button.disabled=prompting;
    button.title=deferredPrompt?'安装长春麻将到桌面':'添加到桌面 / 主屏幕';
  }
  function instructions(){
    const ua=navigator.userAgent||'';
    if(location.protocol==='file:')return '本地文件不能安装成网页应用。\n请先打开部署后的 HTTPS 游戏链接，再通过浏览器添加到桌面或主屏幕。';
    if(!window.isSecureContext)return '请通过 HTTPS 游戏链接打开。\n再使用浏览器菜单中的“安装应用”或“添加到主屏幕”。';
    if(/MicroMessenger/i.test(ua))return '微信内置浏览器不能直接弹出网页安装。\n请点右上角菜单，用 Safari、Chrome 或系统浏览器打开，再选择“添加到主屏幕”或“安装应用”。';
    if(/iPad|iPhone|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1))
      return '在 Safari 中点击“分享”按钮，选择“添加到主屏幕”，再点“添加”。\n若当前浏览器没有此选项，请用 Safari 打开游戏链接。';
    if(/Android/i.test(ua))return '点击 Chrome / Edge 或系统浏览器右上角菜单，选择“安装应用”或“添加到主屏幕”。\n若浏览器不支持安装，可添加网页快捷方式；具体菜单由浏览器决定。';
    return '使用 Chrome 或 Edge 打开游戏链接。\n点地址栏的安装图标，或浏览器菜单中的“安装应用 / 应用 → 将此站点安装为应用”。';
  }
  function showHelp(message=instructions()){
    document.getElementById('installHelpText').textContent=message;
    if(!dialog.open)dialog.showModal();
  }
  button.onclick=async()=>{
    if(prompting||isInstalled())return;
    if(window.MahjongUpdateBusy?.()){showHelp('网页正在准备更新，请等待更新完成后再添加到桌面。');return;}
    if(!deferredPrompt){showHelp();return;}
    const invitation=deferredPrompt;deferredPrompt=null;prompting=true;refresh();
    try{
      // Called only from this explicit click; the browser prompt is single use.
      await invitation.prompt();
      const choice=await invitation.userChoice;
      if(choice?.outcome!=='accepted')showHelp('已取消安装，没有创建桌面图标。\n需要时可再通过浏览器菜单添加。');
    }catch{
      showHelp(instructions());
    }finally{prompting=false;refresh();}
  };
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferredPrompt=event;refresh();
  });
  window.addEventListener('appinstalled',()=>{
    installed=true;deferredPrompt=null;refresh();
    if(dialog.open)dialog.close();
  });
  standalone?.addEventListener?.('change',refresh);
  document.getElementById('installHelpCloseBtn').onclick=()=>dialog.close();
  document.getElementById('installHelpDoneBtn').onclick=()=>dialog.close();
  refresh();
})();
