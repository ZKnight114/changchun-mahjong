/* Four-player PeerJS rooms. The room creator owns the authoritative game state;
   guests receive seat-specific snapshots and send only player intentions. */
(()=>{
  "use strict";
  const $=id=>document.getElementById(id);
  const game=window.MahjongLive;
  const winds=["东","南","西","北"];
  let peer=null,connection=null,role=null,roomId="",guestSeat=null,guestToken="",ownPlayerName="";
  let started=false,lastResult=null,guestRoster=[null,null,null,null];
  let reconnectTimer=null,reconnectWarningTimer=null,peerScript=null,guestJoined=false;
  let hostPresenceTimer=null,guestHeartbeatTimer=null;
  const hostSlots=[null,null,null,null];

  function safeName(value) {
    return String(value||"").normalize("NFKC")
      .replace(/[<>&"'`\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gi,"")
      .replace(/\s+/gu," ").trim();
  }
  function validName(name){const length=Array.from(name).length;return length>=2&&length<=20;}
  function nameKey(name){return safeName(name).toLocaleLowerCase("zh-CN");}
  function ownName() {
    const name=safeName($("onlineName").value);
    if(!validName(name)){
      setSetupStatus("昵称须为 2–20 个字符，请修改后再创建或加入房间");
      $("onlineName").focus();return null;
    }
    $("onlineName").value=name;
    try{localStorage.setItem("mahjongOnlineName",name);}catch{}
    return name;
  }
  function randomToken() {
    if(globalThis.crypto?.getRandomValues) {
      const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
      return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
    }
    return Array.from({length:16},()=>Math.floor(Math.random()*256).toString(16).padStart(2,"0")).join("");
  }
  function randomRoomId(){
    const value=new Uint32Array(1);
    if(globalThis.crypto?.getRandomValues) crypto.getRandomValues(value);
    else value[0]=Math.floor(Math.random()*0x100000000);
    return `ccmj-${Math.floor(value[0]*1000000/0x100000000).toString().padStart(6,"0")}`;
  }
  function inviteUrl() {
    const url=new URL(location.href);
    url.hash=`room=${encodeURIComponent(roomId)}`;
    return url.href;
  }
  function roomFromInput(value) {
    const code=String(value||"").trim().toLowerCase();
    if(/^[0-9]{6}$/.test(code)) return `ccmj-${code}`;
    return /^ccmj-[0-9]{6}$/.test(code)?code:null;
  }
  function roomFromInvite() {
    if(typeof location==="undefined"||!location.hash.startsWith("#room=")) return null;
    return roomFromInput(new URLSearchParams(location.hash.slice(1)).get("room"));
  }
  function setSetupStatus(message){$("onlineSetupStatus").textContent=message;}
  function setLobbyStatus(message){$("onlineStatus").textContent=message;}
  function badge(message,warn=false) {
    const element=$("onlineConnectionBadge");element.hidden=false;element.textContent=message;
    element.classList.toggle("warn",warn);
  }
  function send(conn,message){if(conn?.open) try{conn.send(message);return true;}catch{}return false;}
  function rejectJoin(conn,message){send(conn,{type:"error",message});setTimeout(()=>conn.close(),500);}
  function loadPeerJS() {
    if(window.Peer) return Promise.resolve();
    if(peerScript) return peerScript;
    peerScript=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="assets/vendor/peerjs.min.js";
      script.onload=()=>window.Peer?resolve():reject(new Error("PeerJS 没有正确加载"));
      script.onerror=()=>reject(new Error("PeerJS 文件加载失败"));
      document.head.append(script);
    }).catch(error=>{peerScript=null;throw error;});
    return peerScript;
  }
  function hostRoster(){return hostSlots.map(slot=>slot?{name:slot.name,connected:slot.connected}:null);}
  function hostNames(){return hostSlots.map((slot,index)=>slot?.name||`玩家${index+1}`);}
  function connectedCount(){return hostSlots.filter(slot=>slot?.connected).length;}
  function releaseHostSeat(seat,conn) {
    const slot=hostSlots[seat];
    if(!slot||slot.conn!==conn||!slot.connected)return;
    if(started) slot.connected=false;
    else hostSlots[seat]=null;
    broadcastRoster();
    setLobbyStatus(started?`${winds[seat]}风暂时离线，等待重连`:`${winds[seat]}风已离开，等待新玩家加入`);
  }
  function startHostPresence() {
    if(hostPresenceTimer)clearInterval(hostPresenceTimer);
    hostPresenceTimer=setInterval(()=>{
      if(role!=="host"||document.hidden)return;
      for(let seat=1;seat<4;seat++) {
        const slot=hostSlots[seat];
        if(slot?.connected&&Date.now()-slot.lastSeen>9000) {
          releaseHostSeat(seat,slot.conn);
          slot.conn?.close();
        }
      }
    },2000);
  }
  function startGuestHeartbeat() {
    if(guestHeartbeatTimer)return;
    guestHeartbeatTimer=setInterval(()=>{
      if(role==="guest")send(connection,{type:"ping"});
    },2000);
  }
  function renderLobby(roster,amHost) {
    $("onlineSetup").hidden=true;$("onlineLobby").hidden=false;
    $("onlineRoomCode").textContent=`房间码 ${roomId.slice(5)}`;
    $("onlineInviteLink").value=inviteUrl();
    $("onlineSeats").replaceChildren(...winds.map((wind,index)=>{
      const slot=roster[index],item=document.createElement("div");
      item.className=`online-seat${slot&&!slot.connected?" offline":""}`;
      const label=document.createElement("b");label.textContent=`${wind}风${index===0?" · 房主":""}`;
      const name=document.createElement("span");name.textContent=slot?`${slot.name}${slot.connected?"":"（离线）"}`:"等待加入";
      item.append(label,name);return item;
    }));
    $("onlineStartBtn").hidden=!amHost;
    $("onlineStartBtn").disabled=!amHost||roster.some(slot=>!slot?.connected);
    $("onlineStartBtn").textContent=$("onlineStartBtn").disabled?"四人到齐后开始":"开始四人对局";
    $("copyInviteBtn").hidden=!amHost;
    $("copyRoomCodeBtn").hidden=false;
    badge(`组局 ${roster.filter(slot=>slot?.connected).length}/4`,roster.some(slot=>!slot?.connected));
  }
  function broadcastRoster() {
    const roster=hostRoster();
    renderLobby(roster,true);
    for(let seat=1;seat<4;seat++) send(hostSlots[seat]?.conn,{type:"roster",roster});
    if(started) {
      badge(`组局 ${connectedCount()}/4`,connectedCount()<4);
      setLobbyStatus(connectedCount()===4?"四人已重连，可以继续对局":"有玩家离线，等待原玩家重连");
      game.setNames(hostNames());
    }
  }
  function publishHostState() {
    if(role!=="host"||!started) return;
    if(game.info().phase!=="gameover") lastResult=null;
    for(let seat=1;seat<4;seat++) {
      const slot=hostSlots[seat];
      if(slot?.connected) send(slot.conn,{type:"snapshot",snapshot:game.snapshotFor(seat)});
    }
  }
  const hostController={
    publish:publishHostState,
    publishResult(result){
      if(role!=="host"||!started)return;
      lastResult=result;
      for(let seat=1;seat<4;seat++) send(hostSlots[seat]?.conn,{type:"result",result});
    }
  };
  const guestController={
    sendDiscard(index){send(connection,{type:"input",kind:"discard",index});},
    sendAction(version,index){send(connection,{type:"input",kind:"action",version,index});}
  };

  function handleHostConnection(conn) {
    let seat=null;
    conn.on("data",message=>{
      if(!message||typeof message!=="object") return;
      if(message.type==="join"&&seat===null) {
        const token=String(message.token||"").slice(0,80);
        if(!/^[a-f0-9]{32}$/.test(token)) {rejectJoin(conn,"无效的加入凭证");return;}
        const joiningName=safeName(message.name);
        if(!validName(joiningName)){rejectJoin(conn,"昵称须为 2–20 个字符");return;}
        const returning=hostSlots.findIndex((slot,index)=>index>0&&slot?.token===token);
        if(returning<1&&hostSlots.some(slot=>slot&&nameKey(slot.name)===nameKey(joiningName))) {
          rejectJoin(conn,"房间里已有同名玩家，请换一个昵称");return;
        }
        seat=returning>0?returning:hostSlots.findIndex((slot,index)=>index>0&&!slot);
        if(seat<1||started&&returning<1) {
          rejectJoin(conn,started?"本局已开始，不能中途加入":"房间已满");seat=null;return;
        }
        if(returning>0) hostSlots[seat]?.conn?.close();
        hostSlots[seat]={name:returning>0?hostSlots[seat].name:joiningName,token,conn,connected:true,lastSeen:Date.now()};
        send(conn,{type:"welcome",seat,roomId,started,roster:hostRoster()});
        broadcastRoster();
        if(started){send(conn,{type:"snapshot",snapshot:game.snapshotFor(seat)});if(lastResult)send(conn,{type:"result",result:lastResult});}
        return;
      }
      if(seat!==null&&hostSlots[seat]?.conn===conn)hostSlots[seat].lastSeen=Date.now();
      if(message.type==="leave"&&seat!==null&&hostSlots[seat]?.conn===conn) {
        releaseHostSeat(seat,conn);conn.close();return;
      }
      if(message.type==="input"&&started&&seat!==null&&hostSlots[seat]?.conn===conn)
        game.receiveInput(seat,message);
    });
    conn.on("close",()=>{if(seat!==null)releaseHostSeat(seat,conn);});
    conn.on("error",()=>{if(seat!==null&&hostSlots[seat]?.conn===conn)badge(`组局 ${connectedCount()-1}/4`,true);});
  }

  function resetSession() {
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    if(reconnectWarningTimer){clearTimeout(reconnectWarningTimer);reconnectWarningTimer=null;}
    if(hostPresenceTimer){clearInterval(hostPresenceTimer);hostPresenceTimer=null;}
    if(guestHeartbeatTimer){clearInterval(guestHeartbeatTimer);guestHeartbeatTimer=null;}
    try{connection?.close();peer?.destroy();}catch{}
    peer=null;connection=null;role=null;roomId="";guestSeat=null;started=false;lastResult=null;ownPlayerName="";guestJoined=false;
    hostSlots.fill(null);guestRoster=[null,null,null,null];
    game.setController("solo",null);
    $("onlineConnectionBadge").hidden=true;
    $("onlineSetup").hidden=false;$("onlineLobby").hidden=true;
    $("createRoomBtn").disabled=false;$("joinRoomBtn").disabled=false;
    $("newGameBtn").disabled=false;$("playAgainBtn").disabled=false;
  }
  function finishLeaveRoom() {
    resetSession();
    if($("onlineDialog").open) $("onlineDialog").close();
    if(!$("modeDialog").open) $("modeDialog").showModal();
  }
  function leaveRoom() {
    if(role==="guest"&&connection?.open) {
      const leaving=connection;
      send(leaving,{type:"leave"});
      setTimeout(()=>{if(connection===leaving)finishLeaveRoom();},180);
      return;
    }
    finishLeaveRoom();
  }
  function startHosting() {
    const name=ownName();if(!name)return;
    resetSession();role="host";ownPlayerName=name;
    setSetupStatus("正在连接 PeerJS 公共信令…");
    $("createRoomBtn").disabled=true;
    loadPeerJS().then(()=>{
      if(role!=="host")return;
      openHostPeer(name);
    }).catch(error=>{setSetupStatus(error.message);$("createRoomBtn").disabled=false;});
  }
  function openHostPeer(name,attempt=0) {
    if(role!=="host")return;
    const hostPeer=new Peer(randomRoomId());peer=hostPeer;
    hostPeer.on("open",id=>{
      if(role!=="host"||peer!==hostPeer)return;
      if(roomId===id){badge(`组局 ${connectedCount()}/4`);return;}
      roomId=id;hostSlots[0]={name,connected:true,token:null,conn:null};
      startHostPresence();
      game.setController("host",hostController);game.setNames(hostNames());
      renderLobby(hostRoster(),true);
      setLobbyStatus("房间已创建，等待三位朋友加入");
      if(location.protocol==="file:") setLobbyStatus("本地文件链接不能发给手机；发布到网页后再分享邀请链接");
    });
    hostPeer.on("connection",conn=>{if(role==="host"&&peer===hostPeer)handleHostConnection(conn);else conn.close();});
    hostPeer.on("disconnected",()=>{if(peer!==hostPeer)return;badge(`组局 ${connectedCount()}/4 · 信令重连中`,true);try{hostPeer.reconnect();}catch{}});
    hostPeer.on("error",error=>{
      if(role!=="host"||peer!==hostPeer)return;
      if(error.type==="unavailable-id"&&attempt<8) {
        peer=null;hostPeer.destroy();openHostPeer(name,attempt+1);return;
      }
      setSetupStatus(`连接失败：${error.message||error.type}`);badge("信令连接失败",true);$("createRoomBtn").disabled=false;
    });
  }

  function scheduleGuestReconnect() {
    if(role!=="guest"||reconnectTimer)return;
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectGuest();},2500);
  }
  function noteGuestDisconnect() {
    guestJoined=false;
    badge("与房主断开 · 重连中",true);
    if(started&&!$("onlineDialog").open) $("onlineDialog").showModal();
    const message="正在自动重连；也可在原浏览器重新打开网页，输入同一房间码回到原座位";
    setSetupStatus(message);setLobbyStatus(message);
    if(!reconnectWarningTimer) reconnectWarningTimer=setTimeout(()=>{
      reconnectWarningTimer=null;
      if(role!=="guest"||guestJoined)return;
      const warning="房主仍未恢复。若房主页面已关闭或刷新，原牌局无法继续，需要重新建房。";
      setSetupStatus(warning);setLobbyStatus(warning);
    },15000);
  }
  function connectGuest() {
    if(role!=="guest"||!peer||connection?.open)return;
    if(peer.disconnected){try{peer.reconnect();}catch{}scheduleGuestReconnect();return;}
    const conn=peer.connect(roomId,{reliable:true});connection=conn;
    conn.on("open",()=>send(conn,{type:"join",name:ownPlayerName,token:guestToken}));
    conn.on("data",message=>{
      if(connection!==conn||!message||typeof message!=="object")return;
      if(message.type==="welcome") {
        guestJoined=true;
        if(reconnectWarningTimer){clearTimeout(reconnectWarningTimer);reconnectWarningTimer=null;}
        guestSeat=message.seat;started=!!message.started;guestRoster=message.roster;
        ownPlayerName=guestRoster[guestSeat]?.name||ownPlayerName;
        $("onlineName").value=ownPlayerName;
        try{localStorage.setItem("mahjongOnlineName",ownPlayerName);}catch{}
        game.setController("guest",guestController);
        startGuestHeartbeat();
        renderLobby(guestRoster,false);
        setLobbyStatus(started?"已重新连接，正在同步牌局":"已入座，等待房主开始");
        badge(`组局 ${guestRoster.filter(slot=>slot?.connected).length}/4`);
      } else if(message.type==="roster") {
        guestRoster=message.roster;renderLobby(guestRoster,false);
        setLobbyStatus("等待房主开始对局");
      } else if(message.type==="snapshot") {
        started=true;game.applySnapshot(message.snapshot);
        if($("onlineDialog").open) $("onlineDialog").close();
        $("newGameBtn").disabled=true;
        badge(`组局 ${guestRoster.filter(slot=>slot?.connected).length}/4`,guestRoster.some(slot=>!slot?.connected));
      } else if(message.type==="result") {
        game.applyResult(message.result);
      } else if(message.type==="error") {
        const reason=message.message||"无法加入房间";
        resetSession();setSetupStatus(reason);
      }
    });
    conn.on("close",()=>{
      if(connection!==conn||role!=="guest")return;
      noteGuestDisconnect();
      scheduleGuestReconnect();
    });
    conn.on("error",()=>{if(connection===conn){noteGuestDisconnect();scheduleGuestReconnect();}});
  }
  function startJoining(inviteCode=null) {
    const name=ownName();if(!name)return;
    const code=inviteCode||roomFromInput($("roomCodeInput").value);
    if(!code){setSetupStatus("请输入有效的 6 位数字房间码；邀请链接请直接在浏览器打开");return;}
    resetSession();role="guest";roomId=code;ownPlayerName=name;
    const key=`mahjong-seat:${roomId}`;
    try{guestToken=localStorage.getItem(key)||sessionStorage.getItem(key)||randomToken();}
    catch{try{guestToken=sessionStorage.getItem(key)||randomToken();}catch{guestToken=randomToken();}}
    if(!/^[a-f0-9]{32}$/.test(guestToken)) guestToken=randomToken();
    try{localStorage.setItem(key,guestToken);}catch{}
    try{sessionStorage.setItem(key,guestToken);}catch{}
    $("joinRoomBtn").disabled=true;setSetupStatus("正在连接房间…");
    loadPeerJS().then(()=>{
      if(role!=="guest")return;
      peer=new Peer();
      peer.on("open",connectGuest);
      peer.on("disconnected",()=>{badge("信令重连中",true);try{peer.reconnect();}catch{}});
      peer.on("error",error=>{setSetupStatus(`连接失败：${error.message||error.type}`);scheduleGuestReconnect();});
    }).catch(error=>{setSetupStatus(error.message);$("joinRoomBtn").disabled=false;});
  }

  $("modeGroupBtn").onclick=()=>{
    $("modeDialog").close();$("onlineDialog").showModal();
    const invite=roomFromInvite();
    $("onlineEntry").hidden=!!invite;$("inviteEntry").hidden=!invite;
    if(invite) $("inviteRoomCode").textContent=invite.slice(5);
    try{$("onlineName").value=localStorage.getItem("mahjongOnlineName")||"";}catch{}
    setSetupStatus("");
  };
  $("createRoomBtn").onclick=startHosting;
  $("joinRoomBtn").onclick=()=>startJoining();
  $("inviteJoinBtn").onclick=()=>startJoining(roomFromInvite());
  $("onlineCloseBtn").onclick=leaveRoom;
  $("onlineDialog").addEventListener("cancel",event=>{event.preventDefault();leaveRoom();});
  $("onlineStartBtn").onclick=()=>{
    if(role!=="host"||connectedCount()!==4||started)return;
    game.setNames(hostNames());started=true;lastResult=null;
    $("onlineDialog").close();badge("组局 4/4");
    $("newGameBtn").disabled=true;
    game.startMatch();
  };
  $("copyInviteBtn").onclick=async()=>{
    const link=inviteUrl();
    try{await navigator.clipboard.writeText(link);setLobbyStatus("邀请链接已复制");}
    catch{const field=$("onlineInviteLink");field.focus();field.select();setLobbyStatus("请手动复制上方邀请链接");}
  };
  $("copyRoomCodeBtn").onclick=async()=>{
    const code=roomId.slice(5);
    try{await navigator.clipboard.writeText(code);setLobbyStatus(`房间码 ${code} 已复制`);}
    catch{
      const range=document.createRange();range.selectNodeContents($("onlineRoomCode"));
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      setLobbyStatus("复制失败，已选中房间码，请手动复制");
    }
  };
  window.addEventListener?.("pagehide",()=>{
    try{
      if(role==="guest")send(connection,{type:"leave"});
      connection?.close();
      for(const slot of hostSlots) slot?.conn?.close();
      peer?.destroy();
    }catch{}
  });
  document.addEventListener?.("visibilitychange",()=>{
    if(role==="host"&&!document.hidden)
      for(const slot of hostSlots)if(slot?.connected)slot.lastSeen=Date.now();
  });
  if(roomFromInvite()) $("modeGroupBtn").click();
})();
