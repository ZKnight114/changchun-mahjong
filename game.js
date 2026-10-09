"use strict";

const TILE_NAMES = [
  "一万","二万","三万","四万","五万","六万","七万","八万","九万",
  "一筒","二筒","三筒","四筒","五筒","六筒","七筒","八筒","九筒",
  "一条","二条","三条","四条","五条","六条","七条","八条","九条",
  "东风","南风","西风","北风","红中","发财","白板"
];
const WINDS = ["东","南","西","北"];
let NAMES = ["你","阿岚","小满","老陈"];
// The four array indexes are the bottom, right, top and left seats on screen.
const SEAT_DIRECTIONS = ["south","east","north","west"];
const TILE_FILES = [
  ...Array.from({length:9},(_,i)=>`Man${i+1}`),
  ...Array.from({length:9},(_,i)=>`Pin${i+1}`),
  ...Array.from({length:9},(_,i)=>`Sou${i+1}`),
  "Ton","Nan","Shaa","Pei","Chun","Hatsu","Haku"
];
const FLAT_TILE_FILES = [
  ...["m","p","s"].flatMap(suit=>Array.from({length:9},(_,i)=>`${i+1}${suit}`)),
  ...Array.from({length:7},(_,i)=>`z${i+1}`)
];
const TILE_THEMES = new Set(["a","b","c"]);
function loadTileTheme() {
  try {
    const saved=window.localStorage?.getItem("mahjongTileTheme");
    return TILE_THEMES.has(saved)?saved:"c";
  } catch { return "c"; }
}
function tileImagePath(id,back=false) {
  if(state.tileTheme==="c") return `assets/tiles/flat/${back?"Back":FLAT_TILE_FILES[id]}.png`;
  const folder=state.tileTheme==="b"?"assets/tiles/black":"assets/tiles";
  return `${folder}/${back?"Back":TILE_FILES[id]}.svg`;
}
function setTileTheme(theme) {
  if(!TILE_THEMES.has(theme)) return false;
  state.tileTheme=theme;
  try { window.localStorage?.setItem("mahjongTileTheme",theme); } catch {}
  if(document.body) document.body.dataset.tileTheme=theme;
  const selector=$("tileThemeSelect");
  if(selector) selector.value=theme;
  render();
  // Result and action buttons are outside the normal board render.
  for(const container of ["winningHand","resultBao","baoRevealCard","actionOptions"]) {
    $(container)?.querySelectorAll("img[data-tile-image]").forEach(img=>{
      const value=img.dataset.tileImage;
      img.src=tileImagePath(value==="back"?0:Number(value),value==="back");
    });
  }
  window.MahjongCacheTheme?.(theme);
  return true;
}
const SOUND_FILES={draw:"draw.wav",discard:"discard-a1.wav",chi:"chi-a2.wav",peng:"peng-a3.wav",gang:"gang-a4.wav",win:"win-h2.wav",drawgame:"drawgame.wav"};
const ACTION_SOUNDS={chi:"chi",peng:"peng",gang:"gang",egg:"gang",hu:"win"};
const soundCache={};
let activeSound=null,soundSequence=0,latestSoundEvent=null,guestSoundCursor=null;

const state = {
  wall: [], hands: [[],[],[],[]], melds: [[],[],[],[]], discards: [],
  dealer: 0, current: 0, phase: "idle", lastDiscard: null, drawnIndex: null,
  selectedTile: null, selectedIndex: null,
  // round doubles as a generation token: callbacks from an older hand must never
  // change a newer hand after the user starts over.
  round: 0, sound: true, volume: .55, tileTheme: loadTileTheme(), timers: new Set(), pending: null, actionCue: null,
  match: {eastSeat:0,dealerAdvances:0,nextDealerAdvances:0,handNumber:0,complete:false},
  onlineRole: "solo", onlinePaused:false, aiDifficulty: "simple",
  tenpaiSignature: null, tenpaiTiles: new Set(),
  // 长春麻将状态。听牌信息只保存普通数组，既方便渲染，也避免 Set 在
  // 调试序列化时丢失内容。
  ting: [null,null,null,null], lastDrawn: [null,null,null,null],
  baopai: null, baopaiWallIndex: null, baopaiRevealed: [false,false,false,false], baopaiCandidates: [], baopaiPending: false,
  eggs: [[],[],[],[]], eggDrawn: [[],[],[],[]],
  scores: [0,0,0,0], pendingDraw: null,
  firstDrawDone: [false,false,false,false], firstDiscardDone: [false,false,false,false],
  baoViewReady: [false,false,false,false]
};

const $ = (id) => document.getElementById(id);
let onlineController=null;
let onlineOfferVersion=0;
const onlineOffers=new Map();
const ONLINE_PROTOCOL=2;
const onlineInputPermits=new Map();
let onlinePermitSerial=0,onlineSession="",guestInputToken=null;
function inputPermitFor(seat) {
  const key=JSON.stringify([state.round,state.phase,state.current,state.onlinePaused,state.hands[seat],
    state.lastDrawn[seat],onlineOffers.get(seat)?.version||0]);
  let permit=onlineInputPermits.get(seat);
  if(!permit||permit.key!==key){permit={key,token:`${onlineSession}:${++onlinePermitSerial}`};onlineInputPermits.set(seat,permit);}
  return permit.token;
}
function guestInput(kind,index,version=null) {
  if(!isOnlineGuest()||state.onlinePaused||!guestInputToken)return null;
  if(kind==="discard"&&mustWinWithBao(0))return null;
  return {kind,index,version,protocol:ONLINE_PROTOCOL,rulesVersion:RULES.version,round:state.round,
    inputToken:guestInputToken,...(kind==="discard"?{tile:state.hands[0][index]}:{})};
}
let onlineClaim=null;
let localActions=[];
let pendingRob=null;
let restoredContinuation=null;
let soloMatchActive=false,soloSaveQueued=false,soloSaveErrorShown=false;
const SOLO_SAVE_KEY="mahjong-solo-match-v1";
const gameTimerTasks=new Map();
const isOnlineHost=()=>state.onlineRole==="host";
const isOnlineGuest=()=>state.onlineRole==="guest";
function publishOnline() { if(isOnlineHost()) onlineController?.publish(); else queueSoloSave(); }
function clearOnlineOffers() { onlineOffers.clear(); publishOnline(); }
function offerActions(player,actions) {
  if(!isOnlineHost()||player===0) { setActions(actions); return; }
  const version=++onlineOfferVersion;
  onlineOffers.set(player,{version,round:state.round,phase:state.phase,actions});
  publishOnline();
}
function setOnlineNames(names) {
  if(!Array.isArray(names)||names.length!==4) return;
  NAMES=names.map((name,index)=>Array.from(String(name||`玩家${index+1}`).replace(/[<>&"'`]/g,"")).slice(0,20).join(""));
  if(state.phase!=="idle") render();
}
const RULES=window.MahjongRules.config;
const {hasAllThreeSuits,hasYaoJiu,hasDragon,hasKong}=window.MahjongRules;
const {tileCount,isSuit,isTerminalOrHonor,isSelfDraw,meldTiles,tileInHandWithoutWin,isBigEggTile,eggTypeName,
  chiPatterns,isWinning,isWinningStandard,isQiDui,isHaoQiDui,isStanding,canWinWithPair,canWinByCompletingPair,canWinWithMiddleSequence,canWinWithEdgeSequence,isJiaHu,allTripletPartition,isPiaoHu,isPiaoDing,patternBase,patternName,detectPattern,hasATriplet,hasTripletMeld,canFormMelds,computeGroupScore,groupPoints}=window.MahjongRules;
const sortHand = hand => hand.sort((a,b) => a-b);
function concealedGang(player,meld) {
  return meld.type==="gang"&&(meld.concealed===true||state.eggs[player].some(egg=>egg.standardGang
    &&(egg.concealed===true||egg.type==="anGang")&&egg.tiles[0]===meld.tiles[0]));
}
// Kongs live in melds, starting/supplemented eggs live in eggs. Old saves and
// diagnostic fixtures may still contain legacy kong mirrors: consume once.
function eggKongGroups(player) {
  const eggs=state.eggs[player].filter(egg=>!egg.standardGang);
  const kongs=state.melds[player].filter(meld=>meld.type==="gang");
  const legacy=state.eggs[player].filter(egg=>egg.standardGang);
  return [...eggs,...kongs.map(meld=>({...meld,standardGang:true,concealed:concealedGang(player,meld)})),
    ...legacy.filter(egg=>!kongs.some(meld=>meld.tiles[0]===egg.tiles[0]))];
}
function normalizeKongData() {
  for(let player=0;player<4;player++) {
    for(const egg of state.eggs[player].filter(egg=>egg.standardGang)) {
      let meld=state.melds[player].find(group=>group.type==="gang"&&group.tiles[0]===egg.tiles[0]);
      if(!meld){meld={type:"gang",tiles:[...egg.tiles]};state.melds[player].push(meld);}
      meld.concealed=meld.concealed===true||egg.concealed===true||egg.type==="anGang";
    }
    state.eggs[player]=state.eggs[player].filter(egg=>!egg.standardGang);
  }
}
const groupDisplayName=group=>group.type==="gang"||group.standardGang
  ?(group.concealed||group.type==="anGang"?"暗杠":"明杠"):eggTypeName(group.type);
function visibleMelds(player,viewer=null) {
  return state.melds[player].filter(meld=>player===viewer||!concealedGang(player,meld));
}
function knownTiles(viewer=null) {
  return [...state.discards.map(discard=>discard.tile),
    ...[0,1,2,3].flatMap(player=>meldTiles(visibleMelds(player,viewer))),
    ...state.eggs.flatMap(eggs=>eggs.filter(egg=>!egg.standardGang).flatMap(egg=>egg.tiles))];
}
function canDrawReplacement() { return state.wall.length>0; }
const isWildcardChick = egg => egg.tiles.includes(18)&&egg.type!=="big";
// Starting eggs leave the hand. They occupy a completed group for hand-shape
// checks, while standard kongs are already represented in state.melds.
function shapeMelds(player) {
  return [...state.melds[player],...state.eggs[player]
    .filter(egg=>!egg.standardGang)
    .map(egg=>({type:"egg",eggType:egg.type,tiles:isWildcardChick(egg)?egg.tiles.filter(tile=>tile!==18):egg.tiles}))];
}

function playerHasNineEgg(player) {
  return state.eggs[player]?.some(egg=>egg.type === "nine");
}

function later(callback, delay) {
  const task={callback,remaining:delay,due:Date.now()+delay,handle:null};
  const id=setTimeout(()=>{
    state.timers.delete(id);
    gameTimerTasks.delete(id);
    callback();
  },delay);
  task.handle=id;
  task.run=()=>{state.timers.delete(id);gameTimerTasks.delete(id);callback();};
  if(state.onlinePaused){clearTimeout(id);task.handle=null;}
  gameTimerTasks.set(id,task);
  state.timers.add(id);
  return id;
}
function cancelGameTimer(id) {
  const task=gameTimerTasks.get(id);
  if(task)clearTimeout(task.handle);
  gameTimerTasks.delete(id);state.timers.delete(id);
}

function clearGameTimers() {
  state.timers.forEach(cancelGameTimer);
  state.timers.clear();
}

function setOnlinePaused(paused) {
  if(!isOnlineHost()||state.onlinePaused===!!paused)return;
  state.onlinePaused=!!paused;
  // Invalidate pre-disconnect intentions even if no tiles changed while paused.
  onlineInputPermits.clear();
  for(const task of gameTimerTasks.values()) {
    if(paused){task.remaining=Math.max(0,task.due-Date.now());clearTimeout(task.handle);task.handle=null;}
    else {task.due=Date.now()+task.remaining;task.handle=setTimeout(task.run,task.remaining);}
  }
  setActions(localActions);render();
  if(!paused&&restoredContinuation)resumeRestoredGame();
}
function setGuestPaused() {
  if(!isOnlineGuest())return;
  stopGameSound();guestSoundCursor=null;
  state.onlinePaused=true;setActions(localActions);render();
}

function queueActionCue(player,type,commit,recovery=null) {
  if(state.actionCue||state.onlinePaused) return false;
  if(type!=="hu"&&mustWinWithBao(player))return false;
  onlineOffers.clear();
  const labels={chi:"吃",peng:"碰",gang:"杠",hu:"胡",egg:"蛋",ting:"听",bao:"宝"};
  const previousPhase=state.phase, round=state.round;
  const cue={player,type,round,previousPhase,recovery};
  state.actionCue=cue;
  state.phase="actionCue";
  setActions();
  const banner=$(`actionCue${player}`);
  if(banner) {
    banner.className=`action-cue cue-${SEAT_DIRECTIONS[player]} ${type}`;
    banner.textContent=labels[type];
    void banner.offsetWidth;
    banner.classList.add("show");
  }
  setStatus(type==="ting"?`${NAMES[player]}报听`:type==="bao"?`${NAMES[player]}看宝`:`${NAMES[player]}${labels[type]}！`);
  // One sound at the start of the visible action; commits never replay it.
  if(ACTION_SOUNDS[type])playSound(ACTION_SOUNDS[type]);
  else if(type==="ting"||type==="bao")beep(type==="ting"?740:690,.12);
  cue.timer=later(()=>{
    if(state.round!==round||state.actionCue!==cue) return;
    if(banner) banner.classList.remove("show");
    state.actionCue=null;
    state.phase=previousPhase;
    commit();
  },type==="bao"?1350:860);
  return true;
}

function cueWin(player,method,hand,forcedWinTile=null) {
  const finalHand=[...hand];
  return queueActionCue(player,"hu",()=>finishWin(player,method,finalHand,forcedWinTile),
    {kind:"win",player,method,hand:finalHand,forcedWinTile});
}

function cueClaim(option,discarder,tile) {
  return queueActionCue(option.p,option.type,()=>executeClaim(option,discarder,tile),
    {kind:"claim",option,discarder,tile});
}

function makeWall() {
  const wall = [];
  for (let id=0; id<34; id++) for (let copy=0; copy<4; copy++) wall.push(id);
  // Fisher–Yates: every permutation has equal probability when RNG is uniform.
  for (let i=wall.length-1; i>0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [wall[i],wall[j]] = [wall[j],wall[i]];
  }
  return wall;
}

function tileHTML(id, opts={}) {
  const small = opts.small ? " small" : "";
  const related = state.selectedTile===id ? " related" : "";
  if (opts.back) return `<span class="tile back${small}"><img src="${tileImagePath(0,true)}" data-tile-image="back" alt="牌背" draggable="false"></span>`;
  return `<span class="tile${small}${opts.latest?" latest":""}${related}" data-tile="${id}" title="${TILE_NAMES[id]}"><img src="${tileImagePath(id)}" data-tile-image="${id}" alt="${TILE_NAMES[id]}" draggable="false"></span>`;
}

function tileButtonHTML(id, index, drawn=false, winOnly=false) {
  const disabled=winOnly||state.onlinePaused||state.phase!=="discard"||state.current!==0||state.hands[0].length%3!==2;
  const classes=`tile${drawn?" drawn":""}${disabled?" disabled":""}`;
  const hint=winOnly?"已摸到宝牌，本回合必须胡牌":disabled?"当前不是你的回合，请等待":"点击选中，再点一次打出";
  return `<button class="${classes}" data-tile="${id}" data-index="${index}" title="${hint}${disabled?"":TILE_NAMES[id]}" aria-label="${hint}${disabled?"":TILE_NAMES[id]}" ${disabled?"disabled":""}><img src="${tileImagePath(id)}" data-tile-image="${id}" alt="${TILE_NAMES[id]}" draggable="false"></button>`;
}

function seatWind(player) { return WINDS[(player-state.match.eastSeat+4)%4]; }
function matchCircle() { return Math.min(RULES.circles,Math.floor(state.match.dealerAdvances/4)+1); }
function startMatch() {
  if(state.onlinePaused)return;
  state.match={eastSeat:0,dealerAdvances:0,nextDealerAdvances:0,handNumber:0,complete:false};
  state.scores=[0,0,0,0];
  startGame();
  finishLoading();
}
function nextHand() {
  if(state.onlinePaused||state.phase!=="gameover") return;
  if(state.match.complete) { startMatch(); return; }
  state.match.dealerAdvances=state.match.nextDealerAdvances;
  startGame();
}
function finishMatchHand(winner=null) {
  // A dealer win keeps the same seat; any other win or an exhausted wall
  // passes the deal to the next fixed seat. Four completed rotations end play.
  state.match.nextDealerAdvances=state.match.dealerAdvances+(winner===state.dealer?0:1);
  state.match.complete=state.match.nextDealerAdvances>=RULES.circles*4;
  const finish=$("matchFinish");
  finish.hidden=!state.match.complete;
  finish.innerHTML=state.match.complete
    ? `<strong>四圈结束 · 本场总分</strong><div>${state.scores.map((score,player)=>`<span>${seatWind(player)}风 ${NAMES[player]}：${score>0?"+":""}${score}</span>`).join("")}</div>`
    : "";
  $("playAgainBtn").textContent=state.match.complete?"新一场":"下一局";
}
function startGame() {
  clearGameTimers();
  stopGameSound();latestSoundEvent=null;
  onlineClaim=null;onlineOffers.clear();pendingRob=null;restoredContinuation=null;
  state.round++;
  state.match.handNumber++;
  $("matchCircleBadge").textContent=`第${matchCircle()}圈`;
  state.wall=makeWall(); state.hands=[[],[],[],[]]; state.melds=[[],[],[],[]]; state.discards=[];
  state.dealer=(state.match.eastSeat+state.match.dealerAdvances)%4;
  state.current=state.dealer; state.phase="dealing"; state.lastDiscard=null; state.drawnIndex=null; state.selectedTile=null; state.selectedIndex=null; state.pending=null;
  state.actionCue=null;
  for(let p=0;p<4;p++) {const banner=$(`actionCue${p}`);if(banner) banner.classList.remove("show","preview-hidden");}
  $("baoRevealOverlay")?.classList.remove("show");
  if($("baoRevealCard")) $("baoRevealCard").innerHTML="";
  state.ting=[null,null,null,null]; state.lastDrawn=[null,null,null,null]; state.baopai=null; state.baopaiWallIndex=null;
  state.baopaiRevealed=[false,false,false,false]; state.baopaiCandidates=[]; state.baopaiPending=false;
  state.eggs=[[],[],[],[]]; state.eggDrawn=[[],[],[],[]]; state.pendingDraw=null;
  state.firstDrawDone=[false,false,false,false]; state.firstDiscardDone=[false,false,false,false];
  state.baoViewReady=[false,false,false,false];
  state.tenpaiSignature=null; state.tenpaiTiles=new Set();
  $("matchFinish").hidden=true;
  $("resultDialog").close();
  $("scoreboardDialog").close();
  // Traditional packet order: four tiles at a time for three rounds, then one each.
  for (let packet=0; packet<3; packet++) for (let offset=0; offset<4; offset++) {
    const p=(state.dealer+offset)%4;
    for(let n=0;n<4;n++) state.hands[p].push(takeWallTile(0));
  }
  for (let offset=0; offset<4; offset++) state.hands[(state.dealer+offset)%4].push(takeWallTile(0));
  state.hands.forEach(sortHand);
  const dealerDraw=takeWallTile(0);
  state.hands[state.dealer].push(dealerDraw);
  state.lastDrawn[state.dealer]=dealerDraw;
  state.firstDrawDone[state.dealer]=true;
  if(state.dealer===0) state.drawnIndex=state.hands[0].length-1;
  state.phase="discard";
  setStatus(`第${matchCircle()}圈 · ${seatWind(state.dealer)}风${NAMES[state.dealer]}坐庄`);
  beep(440,.05);
  render();
  if (state.current!==0) scheduleAI(); else updateActions();
}

function render() {
  $("wallCount").textContent=state.wall.length;
  document.querySelectorAll(".wind").forEach(x=>x.classList.remove("active","dealer-seat","self-wind"));
  for(let p=0;p<4;p++) {
    const wind=document.querySelector(`.wind.${SEAT_DIRECTIONS[p]}`);
    if(!wind) continue;
    wind.textContent=seatWind(p);
    wind.dataset.player=String(p);
    wind.classList.toggle("active",state.current===p&&state.phase!=="gameover");
    wind.classList.toggle("dealer-seat",p===state.dealer);
    wind.classList.toggle("self-wind",p===0);
  }
  for(let p=0;p<4;p++) renderPlayer(p);
  for(let p=0;p<4;p++) renderRiver(p);
  renderBaoPanel();
  refreshTileHighlights();
  publishOnline();
}

function renderBaoPanel() {
  const panel=$("baoPanel");
  if(!panel) return;
  const mode=state.baopai===null?"empty":state.baopaiRevealed[0]?`face:${state.baopai}`:"back";
  const signature=`${state.tileTheme}:${mode}`;
  if(panel.dataset.mode===signature) return;
  panel.dataset.mode=signature;
  $("baoTile").innerHTML=mode==="empty"?'<span class="bao-placeholder" aria-label="尚未打宝"></span>'
    :mode==="back"?tileHTML(0,{back:true,small:true}):tileHTML(state.baopai,{small:true});
}

function renderRiver(p) {
  const el=$(`river${p}`), river=state.discards.filter(d=>d.player===p);
  if(p===0)el.dataset.rows=String(Math.ceil(river.length/10));
  const cache=el.__riverCache??={signature:null};
  el.__riverCache=cache;
  const signature=`${state.tileTheme}:${river.map(d=>`${d.player}:${d.tile}`).join(",")}`;
  // Keep old river tiles in place. Rebuilding all four rivers for each discard made
  // cards from players that had not played this turn visibly blink.
  if(cache.signature!==signature) {
    el.innerHTML=river.map(d=>tileHTML(d.tile,{small:true})).join("");
    cache.signature=signature;
    el.querySelectorAll(".tile").forEach(tile=>tile.addEventListener("click",()=>selectTile(+tile.dataset.tile)));
  }
  const isLatest=state.discards.at(-1)?.player===p;
  el.querySelectorAll(".tile[data-tile]").forEach((tile,index)=>{
    tile.classList.toggle("related",+tile.dataset.tile===state.selectedTile);
    tile.classList.toggle("latest",isLatest&&index===river.length-1);
  });
}

function getPlayerSlots(el) {
  if(el.__slots) return el.__slots;
  // Seat lanes follow chi/peng, concealed hand, then eggs and kongs.
  el.innerHTML=el.id==="player0"
    ? '<div class="seat-badge-slot"></div><div class="seat-waits-slot"></div><div class="seat-bottom-cards"><div class="seat-meld-slot"></div><div class="seat-hand-slot"></div><div class="seat-egg-slot"></div></div>'
    : '<div class="seat-badge-slot"></div><div class="seat-meld-slot"></div><div class="seat-hand-slot"></div><div class="seat-egg-slot"></div>';
  el.__slots={
    badge:el.querySelector(".seat-badge-slot"),
    waits:el.querySelector(".seat-waits-slot"),
    eggs:el.querySelector(".seat-egg-slot"),
    melds:el.querySelector(".seat-meld-slot"),
    hand:el.querySelector(".seat-hand-slot"),
    badgeMarkup:null, waitMarkup:null,
    eggSignature:null, meldSignature:null,
    handMarkup:null
  };
  return el.__slots;
}

function renderPlayer(p) {
  const el=$(`player${p}`), slots=getPlayerSlots(el), current=state.current===p && state.phase!=="gameover";
  const ting=state.ting[p];
  const tingLabel=ting?'<span class="ting-badge" title="已报听" aria-label="已报听">听</span>':"";
  const seenBao=state.baopai!==null&&state.baopaiRevealed[p];
  const baoLabel=seenBao?'<span class="seen-bao-badge" title="已看宝" aria-label="已看宝">宝</span>':"";
  const score=state.scores[p]||0;
  const badgeMarkup=`<div class="player-badge ${current?"current":""}" aria-label="${NAMES[p]}，${seatWind(p)}风，${score}分${current?'，当前回合':''}"><span class="avatar" aria-hidden="true">${Array.from(NAMES[p])[0]||""}</span><div class="player-profile-text"><div class="player-profile-name"><span class="player-name" title="${NAMES[p]}">${NAMES[p]}</span><span class="player-wind">${seatWind(p)}</span></div><div class="player-profile-score"><span class="player-points ${score<0?'loss':'gain'}">${score>0?'+':''}${score}分</span>${p===state.dealer?'<span class="dealer">庄</span>':""}${tingLabel}${baoLabel}</div></div></div>`;
  if(slots.badgeMarkup!==badgeMarkup) {
    slots.badge.innerHTML=badgeMarkup;
    slots.badgeMarkup=badgeMarkup;
  }
  if(p===0) renderOwnWaits(slots,ting);

    const eggSignature=JSON.stringify([state.tileTheme,state.eggs[p],state.melds[p].filter(m=>m.type==="gang")]);
  if(slots.eggSignature!==eggSignature) {
    const displayedEggs=eggKongGroups(p);
    slots.eggs.innerHTML=displayedEggs.length
      ? `<div class="egg-row" aria-label="${NAMES[p]}的蛋杠区">${displayedEggs.map(egg=>`<div class="egg-group ${egg.type}" data-label="${groupDisplayName(egg)}">${egg.standardGang
        ?egg.tiles.map(t=>tileHTML(t,{small:p!==0,back:p!==0&&(egg.concealed||egg.type==="anGang")})).join("")
        :liveEggTilesHTML(egg.tiles,p!==0)}</div>`).join("")}</div>`
      : "";
    slots.eggSignature=eggSignature;
    slots.eggs.querySelectorAll(".tile").forEach(tile=>tile.addEventListener("click",()=>selectTile(+tile.dataset.tile)));
  }
  slots.eggs.classList.toggle("empty",state.eggs[p].length===0&&!state.melds[p].some(m=>m.type==="gang"));
  slots.eggs.querySelectorAll(".tile[data-tile]").forEach(tile=>tile.classList.toggle("related",+tile.dataset.tile===state.selectedTile));

  // The meld DOM is stable across unrelated turns. Recreating it on every discard
  // caused cached SVGs to blink, especially after a player had called chi or peng.
  const meldSignature=JSON.stringify([state.tileTheme,state.melds[p]]);
  if(slots.meldSignature!==meldSignature) {
    const meldLabels={chi:"吃",peng:"碰",gang:"杠"};
    slots.melds.innerHTML=`<div class="meld-row" aria-label="${NAMES[p]}的吃碰区">${state.melds[p].filter(m=>m.type!=="gang").map(m=>`<div class="meld-group ${m.type}" data-label="${meldLabels[m.type]}">${m.tiles.map(t=>tileHTML(t,{small:p!==0})).join("")}</div>`).join("")}</div>`;
    slots.meldSignature=meldSignature;
    slots.melds.querySelectorAll(".tile").forEach(tile=>tile.addEventListener("click",()=>selectTile(+tile.dataset.tile)));
  }
  slots.melds.classList.toggle("empty",!state.melds[p].some(m=>m.type!=="gang"));
  slots.melds.querySelectorAll(".tile[data-tile]").forEach(tile=>tile.classList.toggle("related",+tile.dataset.tile===state.selectedTile));

  if(p===0) {
    const winOnly=mustWinWithBao(0);
    const regular=state.hands[0].map((t,i)=>({t,i})).filter(x=>x.i!==state.drawnIndex).sort((a,b)=>a.t-b.t);
    const drawn=state.drawnIndex!==null&&state.hands[0][state.drawnIndex]!==undefined?tileButtonHTML(state.hands[0][state.drawnIndex],state.drawnIndex,true,winOnly):"";
    const handMarkup=`<div class="hand-row">${regular.map(x=>tileButtonHTML(x.t,x.i,false,winOnly)).join("")}${drawn}</div>`;
    if(slots.handMarkup!==handMarkup) {
      slots.hand.innerHTML=handMarkup;
      slots.handMarkup=handMarkup;
      slots.hand.querySelectorAll("button.tile").forEach(btn=>btn.addEventListener("click",()=>handleHandClick(+btn.dataset.tile,+btn.dataset.index)));
    }
  } else {
    const vertical=p===1||p===3;
    const backs=Array.from({length:Math.min(state.hands[p].length,14)},()=>tileHTML(0,{back:true})).join("");
    const handMarkup=`<div class="concealed-row ${vertical?"vertical":""}">${backs}</div><div class="count-bubble">${state.hands[p].length} 张</div>`;
    if(slots.handMarkup!==handMarkup) {
      slots.hand.innerHTML=handMarkup;
      slots.handMarkup=handMarkup;
    }
  }
}

function visibleTileCount(tile) {
  return knownTiles().filter(value=>value===tile).length;
}

function ownWaits() {
  if(!state.ting[0]) return [];
  const known=[...state.hands[0],...knownTiles(0)];
  return state.ting[0].waitTiles.map(tile=>({tile,remaining:Math.max(0,4-tileCount(known,tile))}));
}

function renderOwnWaits(slots,ting) {
  const waits=ting?ownWaits():[];
  const markup=waits.length?`<div class="own-waits" aria-label="你的胡牌剩余张数"><span>听牌 · 按明牌估算</span>${waits.map(({tile,remaining})=>`<span>${shortName(tile)} <b>${remaining}张</b></span>`).join("")}</div>`:"";
  if(slots.waitMarkup!==markup) {
    slots.waits.innerHTML=markup;
    slots.waitMarkup=markup;
  }
  slots.waits.classList.toggle("empty",!waits.length);
}

function selectTile(tile) {
  state.selectedTile=state.selectedTile===tile?null:tile;
  state.selectedIndex=null;
  refreshTileHighlights();
}

function handleHandClick(tile,index) {
  if(state.onlinePaused||state.phase!=="discard"||state.current!==0||state.hands[0].length%3!==2)return;
  if(mustWinWithBao(0))return;
  if(state.selectedIndex===index)return humanDiscard(index);
  state.selectedTile=tile;state.selectedIndex=index;
  refreshTileHighlights();
  const tingCandidate=getSelectedTingCandidate(0);
  if(tingCandidate&&!tingCandidate.reportAllowed) setStatus("断幺九听：只能胡幺九，不能报听或看宝");
  if(!isOnlineGuest()) updateActions();
}

function refreshTileHighlights() {
  const canDiscard=state.phase==="discard"&&state.current===0&&state.hands[0].length%3===2&&!mustWinWithBao(0);
  const tenpaiTiles=canDiscard?getTenpaiTiles():new Set();
  document.querySelectorAll(".tile[data-tile]").forEach(el=>{
    const same=+el.dataset.tile===state.selectedTile;
    el.classList.toggle("related",same);
    if(el.tagName==="BUTTON") {
      el.classList.toggle("selected",+el.dataset.index===state.selectedIndex);
      el.classList.toggle("tenpai",tenpaiTiles.has(+el.dataset.tile));
    }
  });
  window.MahjongTable?.requestLayout();
}

function setStatus(text) { $("statusText").textContent=text; publishOnline(); }
function renderScoreboard() {
  $("scoreboardRound").textContent=`第 ${matchCircle()} 圈 · 第 ${state.match.handNumber} 手 · ${seatWind(state.dealer)}风${NAMES[state.dealer]}坐庄${state.match.complete?" · 本场结束":""} · 累计分`;
  $("scoreboardRows").innerHTML=state.scores.map((score,player)=>`<div class="scoreboard-row"><span>${NAMES[player]}${player===state.dealer?" · 庄":""}</span><strong class="${score>0?"gain":score<0?"loss":""}">${score>0?"+":""}${score}</strong></div>`).join("");
}
function setActions(actions=[]) {
  localActions=actions;
  const pass=actions.find(a=>a.kind==="pass"), options=actions.filter(a=>a.kind!=="pass");
  $("actionBar").classList.toggle("empty",actions.length===0);
  $("actionOptions").innerHTML=options.map((a,i)=>{
    const tiles=Array.isArray(a.tiles)&&a.tiles.length>=1&&a.tiles.length<=4
      &&a.tiles.every(tile=>Number.isInteger(tile)&&tile>=0&&tile<34)?a.tiles:[];
    const cards=tiles.length?`<span class="action-egg-tiles">${tiles.map(tile=>
      `<img src="${tileImagePath(tile)}" data-tile-image="${tile}" alt="${TILE_NAMES[tile]}" draggable="false">`).join("")}</span>`:"";
    return `<button class="action-btn ${a.kind||""}" data-action="${i}" ${state.onlinePaused?"disabled":""}>${a.label}${cards}</button>`;
  }).join("");
  $("actionOptions").querySelectorAll("button").forEach((b,i)=>b.onclick=()=>{if(!state.onlinePaused)options[i].run();});
  $("passBtn").hidden=!pass;$("passBtn").disabled=state.onlinePaused;$("passBtn").onclick=()=>{if(!state.onlinePaused)pass?.run();};
  window.MahjongTable?.requestLayout();
}

function updateActions() {
  return updatePlayerActions(0);
}

function updatePlayerActions(player) {
  if(state.phase!=="discard" || state.current!==player) {
    if(player===0) setActions();
    return;
  }
  const actions=[];
  const canDiscard=state.hands[player].length%3===2;
  const analysis=canDiscard?evaluateChangchunWin(player,state.hands[player],state.lastDrawn[player],"自摸"):{legal:false};
  if(analysis.legal) actions.push({label:"胡",kind:"hu",run:()=>cueWin(player,"自摸",state.hands[player])});
  if(mustWinWithBao(player,analysis))return offerActions(player,actions);
  const reported=state.ting[player];
  if(!reported) {
    eggActions(player).forEach(egg=>actions.push({label:`下${egg.label}：`,tiles:[...egg.tiles],kind:"egg",run:()=>queueActionCue(player,"egg",()=>executeEgg(player,egg.type,egg.tiles),
      {kind:"startEgg",player,type:egg.type,tiles:[...egg.tiles]})}));
    if(!canDiscard&&state.eggs[player].some(egg=>egg.type==="big")) {
      actions.push({label:"结束下蛋 · 本回合不出牌",run:()=>finishEggTurn(player)});
    }
  }
  eggSupplementOptions(player).forEach(({tile,eggIndex})=>actions.push({label:`补${eggTypeName(state.eggs[player][eggIndex].type)}：`,tiles:[tile],kind:"egg",run:()=>beginEggSupplement(player,tile,eggIndex)}));
  if(canDiscard&&canDrawReplacement()) {
    concealedKongs(player).filter(id=>canKeepTingAfterKong(player,id,"concealed")).forEach(id=>actions.push({label:`暗杠 ${shortName(id)}`,run:()=>queueActionCue(player,"gang",()=>selfKong(id,false),
      {kind:"concealed",player,tile:id})}));
    addedKongs(player).filter(id=>canKeepTingAfterKong(player,id,"added")).forEach(id=>actions.push({label:`补杠 ${shortName(id)}`,run:()=>selfKong(id,true)}));
  }
  if(reported&&state.baopai!==null&&state.baoViewReady[player]&&!state.baopaiRevealed[player]) actions.push({label:"看宝",run:()=>cueRevealBaopai(player)});
  offerActions(player,actions);
}

function humanDiscard(index,reporting=false) {
  if(mustWinWithBao(0)){setStatus("已摸到宝牌，本回合只能胡牌");return false;}
  if(isOnlineGuest()) { onlineController?.sendDiscard(index); return; }
  if(state.onlinePaused||state.phase!=="discard" || state.current!==0) return;
  if(state.hands[0].length%3!==2) { setStatus("大蛋起手不补牌，本回合请先结束下蛋"); return; }
  if(index<0 || index>=state.hands[0].length) return;
  if(state.ting[0] && !reporting && index!==state.drawnIndex) {
    setStatus("报听后只能打出刚摸到的牌"); beep(180,.05); return;
  }
  const tile=state.hands[0].splice(index,1)[0];
  state.drawnIndex=null; state.lastDrawn[0]=null; state.selectedTile=null; state.selectedIndex=null; sortHand(state.hands[0]);
  performDiscard(0,tile);
}

function remoteDiscard(player,index) {
  if(state.onlinePaused||!isOnlineHost()||player===0||state.phase!=="discard"||state.current!==player) return false;
  if(mustWinWithBao(player))return false;
  const hand=state.hands[player];
  if(hand.length%3!==2||!Number.isInteger(index)||index<0||index>=hand.length) return false;
  if(state.ting[player]&&(state.lastDrawn[player]===null||index!==hand.length-1)) return false;
  onlineOffers.delete(player);
  const tile=hand.splice(index,1)[0];
  state.lastDrawn[player]=null;
  sortHand(hand);
  performDiscard(player,tile);
  return true;
}

function performDiscard(player,tile) {
  if(mustWinWithBao(player))return false;
  onlineOffers.clear();
  state.firstDiscardDone[player]=true;
  state.phase="claim"; state.lastDiscard={player,tile}; state.discards.push({player,tile});
  checkBaopaiReplace();
  setStatus(`${NAMES[player]}打出 ${TILE_NAMES[tile]}`); playSound("discard"); render(); triggerDiscardIndicator(player); setActions();
  if(promptPostDiscardTing(player,tile))return;
  const round=state.round;
  later(()=>{
    if(state.round===round) resolveClaims(player,tile);
  },player===0?350:650);
}

function promptPostDiscardTing(player,tile) {
  if((player===0||isOnlineHost())&&!state.ting[player]) {
    const waitTiles=getLegalWaits(player,state.hands[player]);
    if(waitTiles.length&&hasYaoJiu(state.hands[player],shapeMelds(player))) {
      const afterChoice=()=>resolveClaims(player,tile);
      state.pending={kind:"reportTing",player,tile,onPass:afterChoice};
      offerActions(player,[
        {label:`报听 · ${waitTiles.length}种`,kind:"ting",run:()=>{
          if(!state.pending||state.phase!=="claim") return;
          state.pending=null;
          queueActionCue(player,"ting",()=>{
            declareTing(player,{waitTiles,reportAllowed:true,tile});
            render(); afterChoice();
          },{kind:"reportTing",player,tile,waitTiles});
        }},
        {label:"暂不报听",kind:"pass",run:()=>{
          if(!state.pending||state.phase!=="claim") return;
          state.pending=null; setActions(); afterChoice();
        }}
      ]);
      setStatus(`打出${shortName(tile)}后已听牌，现在可以报听`);
      return true;
    }
  }
  return false;
}

function triggerDiscardIndicator(player) {
  const wind=document.querySelector(`.wind.${SEAT_DIRECTIONS[player]}`);
  if(!wind) return;
  wind.classList.remove("discard-signal");
  // Force a new animation cycle when the same player discards again.
  void wind.offsetWidth;
  wind.classList.add("discard-signal");
  wind.addEventListener("animationend",()=>wind.classList.remove("discard-signal"),{once:true});
}

// A fourth exposed set leaves only one concealed tile after the next discard.
// That "handful of one" may listen only as Piao Ding: all four sets must be
// triplets/kongs, and the last tile must have a real, legal pair wait.
function canClaimMeld(player,type,tile,pattern=null,discarder=null) {
  const hand=state.hands[player], melds=shapeMelds(player);
  if(state.ting[player]||melds.length>=4) return false;
  if(type==="chi") {
    if(discarder!==null&&player!==(discarder+1)%4) return false;
    if(!pattern||!chiPatterns(hand,tile).some(candidate=>candidate.join(",")===pattern.join(","))) return false;
    return !(hand.length===4&&melds.length===3);
  }
  if(type!=="peng"||tileCount(hand,tile)<2) return false;
  if(hand.length!==4||melds.length!==3) return true;
  const futureMelds=[...melds,{type:"peng",tiles:[tile,tile,tile]}];
  if(futureMelds.some(m=>m.type==="chi")) return false;
  const remaining=[...hand];removeTile(remaining,tile);removeTile(remaining,tile);
  return [...new Set(remaining)].some(single=>{
    // A visible fourth copy cannot also be the unseen winning tile.
    if(tileCount([...remaining,...meldTiles(futureMelds)],single)>=4) return false;
    return coreChangchunWin(player,[single,single],single,
      {forTenpai:true,method:"点炮",melds:futureMelds}).legal;
  });
}

function claimOptions(discarder,tile) {
  const options=[];
  for(let step=1;step<4;step++) {
    const p=(discarder+step)%4, test=sortHand([...state.hands[p],tile]);
    const unreportedWait=!state.ting[p]&&getLegalWaits(p,state.hands[p]).includes(tile);
    if(evaluateChangchunWin(p,test,tile,"点炮",{allowUnreportedWin:unreportedWait}).legal) options.push({p,type:"hu",priority:3,step});
    const count=tileCount(state.hands[p],tile);
    if(canDrawReplacement()&&count>=3&&canKeepTingAfterKong(p,tile,"concealed","external")) options.push({p,type:"gang",priority:2,step});
    if(state.ting[p]) continue;
    if(canClaimMeld(p,"peng",tile)) options.push({p,type:"peng",priority:2,step});
  }
  const next=(discarder+1)%4;
  if(!state.ting[next]) chiPatterns(state.hands[next],tile).forEach(pattern=>{
    if(canClaimMeld(next,"chi",tile,pattern,discarder)) options.push({p:next,type:"chi",priority:1,step:1,pattern});
  });
  return options;
}

function startOnlineResponses(options,onResolved,robLabel="") {
  if(!options.length) return onResolved(null);
  const players=[...new Set(options.map(option=>option.p))];
  const claim={round:state.round,options,players,answers:new Map(),onResolved,timer:null};
  onlineClaim=claim;
  const labels={hu:robLabel||"胡",gang:"杠",peng:"碰",chi:"吃"};
  for(const player of players) {
    const choices=options.filter(option=>option.p===player);
    offerActions(player,[
      ...choices.map(option=>({
        label:option.type==="chi"?`吃 ${option.pattern.map(shortName).join("")}`:labels[option.type],
        kind:option.type==="hu"?"hu":"",
        run:()=>answerOnlineResponse(claim,player,option)
      })),
      {label:"过",kind:"pass",run:()=>answerOnlineResponse(claim,player,null)}
    ]);
  }
  claim.timer=later(()=>{
    if(onlineClaim!==claim||state.round!==claim.round) return;
    for(const player of players) if(!claim.answers.has(player)) claim.answers.set(player,null);
    finishOnlineResponses(claim);
  },20000);
  setStatus(robLabel?`等待${robLabel}${options.some(option=>option.type==="peng")?" / 碰":""}回应`:"等待其他玩家吃碰杠胡回应");
}

function answerOnlineResponse(claim,player,option) {
  if(state.onlinePaused||onlineClaim!==claim||state.round!==claim.round||state.phase!=="claim"||claim.answers.has(player)) return;
  claim.answers.set(player,option);
  onlineOffers.delete(player);
  if(player===0) setActions();
  if(claim.answers.size===claim.players.length) finishOnlineResponses(claim);
  else publishOnline();
}

function finishOnlineResponses(claim) {
  if(onlineClaim!==claim) return;
  onlineClaim=null;
  if(claim.timer!==null) cancelGameTimer(claim.timer);
  onlineOffers.clear();setActions();publishOnline();
  const best=[...claim.answers.values()].filter(Boolean)
    .sort((a,b)=>b.priority-a.priority||a.step-b.step)[0]||null;
  claim.onResolved(best);
}

function resolveOnlineClaims(discarder,tile) {
  const options=claimOptions(discarder,tile);
  startOnlineResponses(options,best=>{
    if(!best) return advanceAfterDiscard(discarder);
    if(best.type==="hu") return cueWin(best.p,"点炮",[...state.hands[best.p],tile]);
    return cueClaim(best,discarder,tile);
  });
}

function resolveClaims(discarder,tile) {
  if(state.phase!=="claim") return;
  if(isOnlineHost()) return resolveOnlineClaims(discarder,tile);
  const options=claimOptions(discarder,tile);
  const human=options.filter(o=>o.p===0);
  const ai=options.filter(o=>o.p!==0);
  const aiHu=ai.filter(o=>o.type==="hu").sort((a,b)=>a.step-b.step)[0];
  const humanHu=human.find(o=>o.type==="hu");
  if(aiHu&&(!humanHu||aiHu.step<humanHu.step)) return cueWin(aiHu.p,"点炮",[...state.hands[aiHu.p],tile]);
  if(aiHu&&humanHu) {
    return promptClaims(human,()=>cueWin(aiHu.p,"点炮",[...state.hands[aiHu.p],tile]),{aiHu});
  }
  resolveNormalClaims(human,ai,discarder,tile);
}

function aiDifficultyFor(player){return state.aiDifficulty;}
function selectAIClaims(ai,tile) {
  // Compare a claim followed by its best discard with keeping the concealed
  // hand. A legal chi is often strategically bad if it breaks a ready-made set.
  const passRouteCache=new Map();
  const evaluated=ai.filter(o=>o.type!=="hu")
    .map(option=>({option,gain:aiDifficultyFor(option.p)==="hard"
      ?hardClaimGain(option,tile,passRouteCache):option.type==="gang"?100:aiClaimGain(option,tile)}));
  let aiEligible=evaluated.filter(candidate=>aiDifficultyFor(candidate.option.p)!=="hard"&&candidate.gain>0);
  {
    const byPlayer=new Map();
    evaluated.filter(candidate=>aiDifficultyFor(candidate.option.p)==="hard").forEach(candidate=>{
      const seat=candidate.option.p;
      if(!byPlayer.has(seat)) byPlayer.set(seat,[]);
      byPlayer.get(seat).push(candidate);
    });
    for(const options of byPlayer.values()) {
      const gang=options.filter(candidate=>candidate.option.type==="gang"&&candidate.gain>0)
        .sort((a,b)=>b.gain-a.gain)[0];
      if(gang) {aiEligible.push(gang);continue;}
      const best=options.filter(candidate=>candidate.option.type==="chi"||candidate.option.type==="peng")
        .sort((a,b)=>b.gain-a.gain||b.option.priority-a.option.priority)[0];
      // One probability roll per robot response, even if several chi patterns
      // use the same discarded tile.
      if(best&&hardShouldClaim(best.gain)) aiEligible.push(best);
    }
  }
  aiEligible.sort((a,b)=>b.option.priority-a.option.priority||a.option.step-b.option.step||b.gain-a.gain);
  return aiEligible.map(candidate=>candidate.option);
}
function resolveNormalClaims(human,ai,discarder,tile) {
  const aiBest=selectAIClaims(ai,tile)[0];
  let shown=[...human];
  if(aiBest) shown=shown.filter(o=>o.type==="hu"||o.priority>aiBest.priority || (o.priority===aiBest.priority&&o.step<aiBest.step));
  // Avoid duplicate peng when gang is available; player may still choose the gang.
  const onPass=()=>aiBest?cueClaim(aiBest,discarder,tile):advanceAfterDiscard(discarder);
  if(shown.length) return promptClaims(shown,onPass,{aiBest});
  if(aiBest) return cueClaim(aiBest,discarder,tile);
  advanceAfterDiscard(discarder);
}

function promptClaims(options,onPass,context={}) {
  state.pending={options,onPass,context};
  const labels={hu:"胡",gang:"杠",peng:"碰",chi:"吃"};
  const actions=options.map(o=>({label:o.type==="chi"?`吃 ${o.pattern.map(shortName).join("")}`:labels[o.type],kind:o.type==="hu"?"hu":"",run:()=>{
    const discarded=state.lastDiscard, next=state.pending?.onPass;
    state.pending=null;
    if(o.type==="hu") cueWin(0,"点炮",[...state.hands[0],discarded.tile]);
    else if(context.aiHu) { setActions(); cueWin(context.aiHu.p,"点炮",[...state.hands[context.aiHu.p],discarded.tile]); }
    else cueClaim(o,discarded.player,discarded.tile);
  }}));
  actions.push({label:"过",kind:"pass",run:()=>{const cb=state.pending?.onPass;state.pending=null;setActions();cb?.();}});
  setActions(actions); setStatus(`可以${[...new Set(options.map(o=>labels[o.type]))].join(" / ")}`); beep(660,.06);
}

function executeClaim(option,discarder,tile) {
  if(state.onlinePaused||state.phase!=="claim") return;
  if(option.type==="gang"&&!canDrawReplacement())return false;
  if((option.type==="chi"||option.type==="peng")
    &&!canClaimMeld(option.p,option.type,tile,option.pattern,discarder)) {
    setStatus("这手牌不能再吃碰，只有飘顶可以手把一上听");
    advanceAfterDiscard(discarder);
    return false;
  }
  if(option.fromEgg) {
    // A supplemented egg is offered from the player's hand, not the river.
    // Claiming it cancels the supplement and its replacement draw.
    if(option.type!=="peng"||!state.lastDiscard?.egg||state.lastDiscard.player!==discarder
      ||state.lastDiscard.tile!==tile||!state.hands[discarder].includes(tile)) return false;
    removeTile(state.hands[discarder],tile);
    state.lastDrawn[discarder]=null;
    if(discarder===0) state.drawnIndex=null;
  } else state.discards.pop();
  const p=option.p; state.current=p; state.lastDiscard=null; state.drawnIndex=null; state.selectedTile=null; state.selectedIndex=null;
  if(option.type==="chi") {
    const needed=[...option.pattern]; needed.splice(needed.indexOf(tile),1);
    needed.forEach(t=>removeTile(state.hands[p],t));
    state.melds[p].push({type:"chi",tiles:[...option.pattern]});
  } else {
    const n=option.type==="gang"?3:2;
    for(let i=0;i<n;i++) removeTile(state.hands[p],tile);
    state.melds[p].push({type:option.type,tiles:Array(n+1).fill(tile)});
    // A kong is already represented in melds; never mirror it in eggs.
  }
  sortHand(state.hands[p]);
  setStatus(`${NAMES[p]}${{chi:"吃",peng:"碰",gang:"杠"}[option.type]}了 ${TILE_NAMES[tile]}`);
  if(option.type==="gang"){ render(); return drawTile(p,true); }
  // 吃/碰不摸牌，所以没有 drawTile 来切换阶段：必须先把状态切回 discard 再渲染。
  // 否则手牌会带着 disabled 渲染出来（点不动、也不高亮），表现为"吃牌后打不出手牌"。
  state.phase="discard";
  render();
  p===0?updateActions():scheduleAI();
}

function removeTile(hand,tile){ const i=hand.indexOf(tile); if(i>=0) hand.splice(i,1); }

function advanceAfterDiscard(discarder) {
  state.current=(discarder+1)%4; drawTile(state.current,false);
}

function finishEggTurn(player) {
  if(state.phase!=="discard"||state.current!==player||state.hands[player].length%3!==1||!state.eggs[player].some(egg=>egg.type==="big")) return false;
  state.firstDiscardDone[player]=true;
  state.drawnIndex=null; state.lastDrawn[player]=null;
  setStatus(`${NAMES[player]}起手下大蛋，本回合不出牌`);
  advanceAfterDiscard(player);
  return true;
}

function drawTile(player,kongReplacement) {
  if(state.onlinePaused)return false;
  if(mustWinWithBao(player))return false;
  if(!state.wall.length) return finishDraw();
  if(state.baopaiPending&&state.baopai===null) {
    determineBaopai();
    renderBaoPanel();
  }
  if(state.ting[player]&&state.baopai!==null&&!state.baopaiRevealed[player]) {
    state.baoViewReady[player]=true;
    state.pendingDraw={player,kongReplacement,round:state.round};
    state.phase="baoReveal"; state.current=player;
    setStatus(`${NAMES[player]}摸牌前先看宝`);
    const revealAction={label:"看宝并继续摸牌",kind:"ting",run:()=>cueRevealBaopai(player)};
    if(player===0||isOnlineHost()) offerActions(player,[revealAction]);
    else setActions();
    render();
    return player===0||isOnlineHost()?undefined:cueRevealBaopai(player);
  }
  const tile=takeWallTile(kongReplacement?state.wall.length-1:0);
  state.hands[player].push(tile);
  state.firstDrawDone[player]=true;
  if(state.ting[player]) state.baoViewReady[player]=true;
  if(player!==0&&!isOnlineHost()) sortHand(state.hands[player]);
  state.current=player; state.lastDiscard=null;
  state.lastDrawn[player]=tile;
  state.drawnIndex=player===0?state.hands[0].length-1:null;
  // Set the actionable state before rendering. Otherwise human tiles are rendered
  // disabled during "drawing" and remain disabled until the next full render.
  state.phase="discard";
  const analysis=evaluateChangchunWin(player,state.hands[player],tile,"自摸");
  setStatus(mustWinWithBao(player,analysis)?`${NAMES[player]}摸到宝牌，只能胡牌`:`${NAMES[player]}${kongReplacement?"杠后补牌":"摸牌"}`);
  // Changing seats calls this same draw; a kong replacement stays quiet.
  if(!kongReplacement)playSound("draw");
  render();
  if(analysis.legal) {
    if(player===0){updateActions();return;}
    if(isOnlineHost()){updatePlayerActions(player);return;}
    const round=state.round, winningHand=[...state.hands[player]];
    return later(()=>{
      if(state.round===round&&state.phase==="discard"&&state.current===player) cueWin(player,"自摸",winningHand);
    },650);
  }
  if(player===0) updateActions(); else scheduleAI();
}

function scheduleAI() {
  if(state.phase!=="discard" || state.current===0) return;
  if(isOnlineHost()) return updatePlayerActions(state.current);
  setActions();
  const round=state.round;
  later(()=>{
    if(state.round!==round||state.phase!=="discard" || state.current===0) return;
    runAIFor(state.current,state.aiDifficulty);
  },700);
}

// The simulator and the live game call the exact same decision entry point.
function runAIFor(p,difficulty=state.aiDifficulty) {
    if(state.onlinePaused||state.phase!=="discard"||state.current!==p)return false;
    if(evaluateChangchunWin(p,state.hands[p],state.lastDrawn[p],"自摸").legal)
      return cueWin(p,"自摸",state.hands[p]);
    if(difficulty==="hard") return runHardAI(p);
    if(state.ting[p]) {
      const supplement=eggSupplementOptions(p)[0];
      if(supplement) return beginEggSupplement(p,supplement.tile,supplement.eggIndex);
      const added=addedKongs(p).find(tile=>canKeepTingAfterKong(p,tile,"added"));
      if(added!==undefined) return selfKong(added,true);
      const concealed=concealedKongs(p).find(tile=>canKeepTingAfterKong(p,tile,"concealed"));
      if(concealed!==undefined) return queueActionCue(p,"gang",()=>selfKong(concealed,false),{kind:"concealed",player:p,tile:concealed});
      const drawnIndex=state.hands[p].lastIndexOf(state.lastDrawn[p]);
      const tile=state.hands[p].splice(drawnIndex>=0?drawnIndex:state.hands[p].length-1,1)[0];
      state.lastDrawn[p]=null;
      return performDiscard(p,tile);
    }
    const egg=eggActions(p)[0];
    if(egg&&Math.random()<.18) return queueActionCue(p,"egg",()=>executeEgg(p,egg.type,egg.tiles),
      {kind:"startEgg",player:p,type:egg.type,tiles:[...egg.tiles]});
    const supplement=eggSupplementOptions(p)[0];
    if(supplement&&Math.random()<.35) return beginEggSupplement(p,supplement.tile,supplement.eggIndex);
    if(state.hands[p].length%3!==2) return finishEggTurn(p);
    const kongs=canDrawReplacement()?concealedKongs(p):[];
    if(kongs.length && Math.random()<.7) return queueActionCue(p,"gang",()=>selfKong(kongs[0],false),
      {kind:"concealed",player:p,tile:kongs[0]});
    let index=chooseAIDiscard(state.hands[p],p);
    const tingCandidates=getTingCandidates(p).filter(candidate=>candidate.reportAllowed);
    const tingCandidate=tingCandidates.find(candidate=>candidate.index===index)
      || tingCandidates.sort((a,b)=>b.waitTiles.length-a.waitTiles.length)[0];
    if(tingCandidate&&Math.random()<.72) {
      return queueActionCue(p,"ting",()=>completeAIReportTing(p,tingCandidate),
        {kind:"aiReportTing",player:p,candidate:tingCandidate});
    }
    const tile=state.hands[p].splice(index,1)[0]; performDiscard(p,tile);
}

function completeAIReportTing(player,candidate) {
  declareTing(player,candidate);
  const tile=state.hands[player].splice(candidate.index,1)[0];
  performDiscard(player,tile);
}

function aiConcealedShapeScore(hand) {
  const counts=Array(34).fill(0),memo=new Map();
  hand.forEach(tile=>counts[tile]++);
  function search() {
    const first=counts.findIndex(count=>count>0);
    if(first<0)return 0;
    const key=counts.join("");
    if(memo.has(key))return memo.get(key);
    const use=(tiles,value)=>{
      tiles.forEach(tile=>counts[tile]--);
      const result=value+search();
      tiles.forEach(tile=>counts[tile]++);
      return result;
    };
    let best=use([first],-1);
    if(counts[first]>=2)best=Math.max(best,use([first,first],3.5));
    if(counts[first]>=3)best=Math.max(best,use([first,first,first],8.5));
    if(first<27&&first%9<=6&&counts[first+1]&&counts[first+2])
      best=Math.max(best,use([first,first+1,first+2],8));
    if(first<27&&first%9<=7&&counts[first+1])
      best=Math.max(best,use([first,first+1],2.7));
    if(first<27&&first%9<=6&&counts[first+2])
      best=Math.max(best,use([first,first+2],1.7));
    memo.set(key,best);
    return best;
  }
  return search();
}

function aiHandValue(hand,melds=[]) {
  const visible=[...hand,...meldTiles(melds)];
  const suits=new Set(visible.filter(isSuit).map(tile=>Math.floor(tile/9)));
  const threeSuitsRequired=!melds.some(m=>m.eggType==="nine");
  const counts=Array(34).fill(0);hand.forEach(tile=>counts[tile]++);
  const hasFork=melds.some(m=>m.type==="peng"||m.type==="gang"||m.type==="egg")
    ||counts.some(count=>count>=3)||visible.some(tile=>tile>=31);
  return aiConcealedShapeScore(hand)+melds.length*8
    +(threeSuitsRequired?suits.size*3+(suits.size===3?10:0):0)
    +(visible.some(isTerminalOrHonor)?8:-8)
    +(hasFork?3:-3)
    -(melds.some(m=>m.type==="chi"||m.type==="peng")?2:0);
}

function bestAIDiscard(hand,melds=[],preferredTile=null) {
  let best={index:0,value:-Infinity};
  hand.forEach((tile,index)=>{
    const after=hand.filter((_,i)=>i!==index);
    const value=aiHandValue(after,melds)+(tile===preferredTile?.5:0);
    if(value>best.value)best={index,value};
  });
  return best;
}

function chooseAIDiscard(hand,player=null) {
  return bestAIDiscard(hand,player===null?[]:shapeMelds(player),player===null?null:state.lastDrawn[player]).index;
}

// Difficult AI uses only its own tiles and exposed tiles. In particular it must
// not inspect another player's concealed hand or the order of the wall.
function hardPublicRemaining(player) {
  const remaining=Array(34).fill(4);
  const visible=[...state.hands[player],...knownTiles(player)];
  visible.forEach(tile=>{if(Number.isInteger(tile)&&tile>=0&&tile<34) remaining[tile]--;});
  return remaining.map(count=>Math.max(0,count));
}

function hardStrategicWeights(player) {
  const scores=state.scores||[0,0,0,0];
  const lead=scores[player]-Math.max(...scores.filter((_,seat)=>seat!==player));
  const progress=Math.min(1,(state.match?.dealerAdvances||0)/16);
  const lateWall=state.wall.length<36?1:0;
  const stakes=progress*.65+lateWall*.35;
  return {attack:Math.max(.75,Math.min(1.25,1-lead/120*stakes)),
    defense:Math.max(.7,Math.min(1.8,1+lead/55*stakes))};
}

function hardWinGain(player,hand,tile,method,moBao=false) {
  const result=evaluateChangchunWin(player,[...hand,tile],tile,method,
    {forTenpai:true,disableBao:true});
  if(!result.legal) return 0;
  const pattern=detectPattern(result.hand,shapeMelds(player),result.winTile,method);
  if(isSelfDraw(method)) return computeScore({winner:player,method,pattern,moBao}).winnerGain;
  let gain=0;
  for(let loser=0;loser<4;loser++) if(loser!==player)
    gain+=computeScore({winner:player,loser,method,pattern}).winnerGain/3;
  return gain;
}

function hardBaoBonus(player,hand,waitTiles,remaining,normalOutValue) {
  if(!waitTiles.length||state.wall.length<5) return 0;
  const total=remaining.reduce((sum,count)=>sum+count,0);
  if(!total) return 0;
  const known=state.baopaiRevealed[player]&&state.baopai!==null;
  // An unrevealed treasure is averaged over public unknown copies. Its actual
  // identity is never consulted until this player has looked at it.
  const bestSelf=Math.max(...waitTiles.map(tile=>hardWinGain(player,hand,tile,"自摸",true)));
  if(!bestSelf) return 0;
  const baoValue=bestSelf/4;
  let bonus=0;
  for(let tile=0;tile<34;tile++) {
    const copies=remaining[tile];
    if(!copies) continue;
    const probability=known?(tile===state.baopai?1:0):copies/total;
    if(!probability) continue;
    const normal=normalOutValue.get(tile)||0;
    bonus+=copies*probability*Math.max(0,baoValue-normal);
  }
  return bonus*.65; // The treasure can only be viewed from the next turn.
}

function hardWaitValue(player,hand,waitTiles,remaining) {
  let value=0;
  const normalOutValue=new Map();
  for(const tile of waitTiles) {
    const copies=remaining[tile];
    if(!copies) continue;
    const selfGain=hardWinGain(player,hand,tile,"自摸");
    const discardGain=hardWinGain(player,hand,tile,"点炮");
    if(!selfGain&&!discardGain) continue;
    const estimatedGain=selfGain&&discardGain?(selfGain+discardGain)/2:selfGain||discardGain;
    // Use expected settlement points per visible out. A one-fan increase
    // doubles this term, so high-fan narrow waits can compete with wide waits.
    const outValue=estimatedGain/4;
    normalOutValue.set(tile,outValue);
    value+=copies*outValue;
  }
  return value+hardBaoBonus(player,hand,waitTiles,remaining,normalOutValue);
}

function hardReadyPotential(player,hand,remaining,waitTiles=null) {
  if(!hasYaoJiu(hand,shapeMelds(player))) return 0;
  const waits=waitTiles||getLegalWaits(player,hand);
  return hardWaitValue(player,hand,waits,remaining)*hardStrategicWeights(player).attack;
}

function hardDiscardDanger(player,tile,remaining,baoViewed=state.baopaiRevealed[player]) {
  // A fourth copy in our hand can still complete an opponent's wait. Public
  // remaining is for draw odds, never for safety of a tile we are discarding.
  const threatened=[0,1,2,3].filter(opponent=>opponent!==player);
  const baoPao=!baoViewed;
  let danger=0;
  for(const opponent of threatened) {
    const open=shapeMelds(opponent).map(meld=>concealedGang(opponent,meld)?{...meld,tiles:[]}:meld),standing=isStanding(open);
    const reported=!!state.ting[opponent];
    // Estimate liability from public posture, never from the opponent's wait
    // list or concealed tiles. Bao-pao uses the same payment rule as settlement.
    const liability=computeScore({winner:opponent,loser:player,method:"点炮",
      pattern:{baseFans:patternBase("jia",standing)},baoPao}).payments[player];
    const theirDiscards=state.discards.filter(discard=>discard.player===opponent);
    const same=theirDiscards.filter(discard=>discard.tile===tile).length;
    const nearby=isSuit(tile)?theirDiscards.filter(discard=>isSuit(discard.tile)
      &&Math.floor(discard.tile/9)===Math.floor(tile/9)&&Math.abs(discard.tile-tile)<=2).length:0;
    const sameSuitOpen=isSuit(tile)&&open.some(meld=>meld.tiles.some(id=>isSuit(id)
      &&Math.floor(id/9)===Math.floor(tile/9)));
    const exposed=state.melds[opponent].length+state.eggs[opponent]
      .filter(egg=>!egg.standardGang).length;
    const tempo=Math.min(1,(state.discards.length+exposed*5)/42);
    const unreportedChance=.025+.035*tempo+.012*Math.min(3,exposed);
    const evidence=Math.max(.35,1-.24*same-.07*nearby)*(sameSuitOpen?1.12:1);
    danger+=liability*(reported?.1:unreportedChance)*evidence;
  }
  return danger*(state.wall.length<36?1.35:1)*hardStrategicWeights(player).defense;
}

function hardShapeValue(hand,melds) {
  // The base shape heuristic awards three-suit progress only while it is
  // required. A completed 9 蛋 satisfies that rule; losing the requirement
  // must not look like losing nineteen points of hand quality.
  return aiHandValue(hand,melds)+(melds.some(meld=>meld.eggType==="nine")?19:0);
}

function hardProjectedValue(player,hand,remaining,waitTiles=null) {
  return hardShapeValue(hand,shapeMelds(player))
    +3*Math.log1p(hardReadyPotential(player,hand,remaining,waitTiles));
}

function hardDiscardPlan(player,remaining) {
  const hand=state.hands[player],candidates=getTingCandidates(player);
  const byTile=new Map(candidates.map(candidate=>[candidate.tile,candidate]));
  let best={index:0,value:-Infinity},bestTing=null;
  const ranked=[];
  const checked=new Set();
  hand.forEach((tile,index)=>{
    if(checked.has(tile)) return;
    checked.add(tile);
    const after=hand.filter((_,i)=>i!==index),candidate=byTile.get(tile);
    const tingValue=candidate?.reportAllowed
      ?hardReadyPotential(player,after,remaining,candidate.waitTiles):0;
    const value=hardShapeValue(after,shapeMelds(player))+3*Math.log1p(tingValue)
      +(tile===state.lastDrawn[player]?.5:0)-hardDiscardDanger(player,tile,remaining);
    const entry={index,tile,value,tingValue,candidate,after};
    ranked.push(entry);
    if(value>best.value) best=entry;
    if(tingValue>0&&(!bestTing||value>bestTing.projected
      ||value===bestTing.projected&&tingValue>bestTing.value))
      bestTing={candidate,value:tingValue,projected:value};
  });
  return {best,bestTing,ranked};
}

function hardTrialValue(player,action,remaining) {
  const oldHand=state.hands[player],oldMelds=state.melds[player],oldEggs=state.eggs[player];
  const hand=[...oldHand],melds=oldMelds.map(meld=>({...meld,tiles:[...meld.tiles]}));
  const eggs=oldEggs.map(egg=>({...egg,tiles:[...egg.tiles]}));
  if(action.kind==="startEgg") {
    action.egg.tiles.forEach(tile=>removeTile(hand,tile));
    eggs.push({type:action.egg.type,tiles:[...action.egg.tiles],concealed:true});
  } else if(action.kind==="supplement") {
    removeTile(hand,action.tile);eggs[action.eggIndex].tiles.push(action.tile);
  } else if(action.kind==="concealed") {
    for(let i=0;i<4;i++) removeTile(hand,action.tile);
    melds.push({type:"gang",tiles:Array(4).fill(action.tile),concealed:true});
  } else if(action.kind==="added") {
    removeTile(hand,action.tile);
    const meld=melds.find(meld=>meld.type==="peng"&&meld.tiles[0]===action.tile);
    meld.type="gang";meld.tiles.push(action.tile);
  }
  state.hands[player]=hand;state.melds[player]=melds;state.eggs[player]=eggs;
  try {
    // A three-tile starting egg leaves a discard this turn; a four-tile big
    // egg does not. Compare both trials at the same post-discard stage.
    return hand.length%3===2?hardDiscardPlan(player,remaining).best.value
      :hardProjectedValue(player,hand,remaining);
  }
  finally {state.hands[player]=oldHand;state.melds[player]=oldMelds;state.eggs[player]=oldEggs;}
}

function hardExposureActions(player) {
  const actions=state.ting[player]?[]:eggActions(player).map(egg=>({kind:"startEgg",egg,points:groupPoints(egg)}));
  if(state.wall.length) {
    eggSupplementOptions(player).forEach(option=>actions.push({kind:"supplement",...option,points:RULES.kong.supplement}));
    if(state.hands[player].length%3===2) {
      concealedKongs(player).filter(tile=>canKeepTingAfterKong(player,tile,"concealed"))
        .forEach(tile=>actions.push({kind:"concealed",tile,points:groupPoints({type:"gang",tiles:[tile],concealed:true})}));
      addedKongs(player).filter(tile=>canKeepTingAfterKong(player,tile,"added"))
        .forEach(tile=>actions.push({kind:"added",tile,points:groupPoints({type:"gang",tiles:[tile],concealed:false})}));
    }
  }
  return actions;
}

function hardExpectedReplacementGain(hand,remaining) {
  let weighted=0,total=0;
  for(let tile=0;tile<34;tile++) {
    const copies=remaining[tile];
    if(!copies) continue;
    const count=tileCount(hand,tile);
    let fit=count===1?2:count===2?4:count===3?1:0;
    if(isSuit(tile)) {
      const rank=tile%9;
      const left=rank>0&&hand.includes(tile-1),right=rank<8&&hand.includes(tile+1);
      const farLeft=rank>1&&hand.includes(tile-2),farRight=rank<7&&hand.includes(tile+2);
      if(left&&right||left&&farLeft||right&&farRight) fit+=3;
      else if(left||right) fit+=1.5;
      else if(farLeft||farRight) fit+=.75;
    }
    weighted+=copies*fit;total+=copies;
  }
  // This is an expectation over unknown copies, not a peek at the wall tail.
  return total?weighted/total:0;
}

function hardUnknownTileAt(remaining,fraction) {
  const total=remaining.reduce((sum,count)=>sum+count,0);
  if(!total) return null;
  let position=Math.min(total-1,Math.floor(fraction*total));
  for(let tile=0;tile<34;tile++) {
    position-=remaining[tile];
    if(position<0) return tile;
  }
  return null;
}

function hardDrawSamples(remaining) {
  const samples=[];
  const sampleCount=16;
  // Stratified public-count samples give every candidate the same hypothetical
  // draws. The actual wall order and opponents' hidden tiles are never read.
  for(let index=0;index<sampleCount;index++) {
    const first=hardUnknownTileAt(remaining,(index+.5)/sampleCount);
    if(first===null) break;
    const after=[...remaining];after[first]--;
    const second=hardUnknownTileAt(after,((index*7)%sampleCount+.5)/sampleCount);
    samples.push([first,second]);
  }
  return samples;
}

function hardSimulatedDiscard(player,hand,remaining,baoViewed=null) {
  const melds=shapeMelds(player),checked=new Set();
  let best=null;
  hand.forEach((tile,index)=>{
    if(checked.has(tile)) return;
    checked.add(tile);
    const after=hand.filter((_,position)=>position!==index);
    const danger=hardDiscardDanger(player,tile,remaining,
      baoViewed===null?state.baopaiRevealed[player]:baoViewed);
    const value=hardShapeValue(after,melds)-danger;
    if(!best||value>best.value) best={hand:after,tile,value,danger};
  });
  return best;
}

function hardRolloutValue(player,hand,remaining,samples,baoViewed=null) {
  if(!samples.length) return hardProjectedValue(player,hand,remaining);
  let total=0;
  for(const [firstTile,secondTile] of samples) {
    const afterFirst=[...remaining];afterFirst[firstTile]--;
    const first=hardSimulatedDiscard(player,[...hand,firstTile],afterFirst,baoViewed);
    if(secondTile===null) {
      total+=first.value;continue;
    }
    const afterSecond=[...afterFirst];afterSecond[secondTile]--;
    const second=hardSimulatedDiscard(player,[...first.hand,secondTile],afterSecond,baoViewed);
    total+=.3*first.value+.7*(hardProjectedValue(player,second.hand,afterSecond)
      -second.danger)-.5*first.danger;
  }
  return total/samples.length;
}

function hardLegalRouteValue(player,hand,remaining) {
  if(hand.length%3!==1) return 0;
  const total=remaining.reduce((sum,count)=>sum+count,0);
  if(!total) return 0;
  const seen=new Set();
  let weighted=0,weight=0;
  // Only the best discard candidates reach this more expensive rules check.
  // A hypothetical draw is tested against actual Changchun legal waits, not
  // merely generic meld shape (which can miss 三门齐/幺九/刻子 requirements).
  for(let sample=0;sample<10;sample++) {
    const drawn=hardUnknownTileAt(remaining,(sample+.5)/10);
    if(drawn===null||seen.has(drawn)) continue;
    seen.add(drawn);
    const afterDraw=[...hand,drawn],afterRemaining=[...remaining];
    afterRemaining[drawn]--;
    const direct=evaluateChangchunWin(player,afterDraw,drawn,"自摸",
      {forTenpai:true,disableBao:true}).legal;
    let best=direct?7:0;
    const discarded=new Set();
    for(let index=0;index<afterDraw.length;index++) {
      const tile=afterDraw[index];
      if(discarded.has(tile)) continue;
      discarded.add(tile);
      const after=afterDraw.filter((_,position)=>position!==index);
      if(!hasYaoJiu(after,shapeMelds(player))) continue;
      const waits=getLegalWaits(player,after);
      if(!waits.length) continue;
      const live=hardWaitValue(player,after,waits,afterRemaining);
      best=Math.max(best,Math.log1p(live));
    }
    weighted+=remaining[drawn]*best;weight+=remaining[drawn];
  }
  return weight?weighted/weight:0;
}

function hardPassRouteValue(player,hand,remaining,withChance=false) {
  if(hand.length%3!==1) return withChance?{value:0,readyChance:0}:0;
  const total=remaining.reduce((sum,count)=>sum+count,0);
  if(!total) return withChance?{value:0,readyChance:0}:0;
  let expected=0,readyCopies=0;
  const melds=shapeMelds(player);
  // Passing a claim gives this player the next normal draw. Compare that
  // standing route with claiming now; use every publicly possible draw so a
  // rare high-fan wait is not missed by the stratified rollout samples.
  for(let drawn=0;drawn<34;drawn++) {
    const copies=remaining[drawn];
    if(!copies) continue;
    const afterDraw=[...hand,drawn],afterRemaining=[...remaining];
    afterRemaining[drawn]--;
    let best=0;
    const discarded=new Set();
    for(let index=0;index<afterDraw.length;index++) {
      const tile=afterDraw[index];
      if(discarded.has(tile)) continue;
      discarded.add(tile);
      const after=afterDraw.filter((_,position)=>position!==index);
      if(!hasYaoJiu(after,melds)) continue;
      const waits=getLegalWaits(player,after);
      if(waits.length) best=Math.max(best,hardWaitValue(player,after,waits,afterRemaining));
    }
    if(best>0) readyCopies+=copies;
    expected+=copies*Math.log1p(best);
  }
  return withChance?{value:expected/total,readyChance:readyCopies/total}:expected/total;
}

function hardBaoSafetyUrgency(player,hand,remaining,readyChance,claimTile) {
  if(state.baopaiRevealed[player]||state.wall.length<5) return 0;
  const dangers=[...new Set(hand)].map(tile=>hardDiscardDanger(player,tile,remaining))
    .sort((a,b)=>a-b);
  if(!dangers.length) return 0;
  const ordinary=dangers[Math.floor(dangers.length/2)],safest=dangers[0];
  const claimRisk=hardDiscardDanger(player,claimTile,remaining);
  const safeClaim=Math.max(0,1-claimRisk/Math.max(.5,ordinary));
  // A safe discard that reports ting reaches the next turn's Bao reveal with
  // no intervening discard. Passing may fail to reach ting and keep Bao-pao
  // liability alive; estimate part of that later exposure from public risk.
  // The fraction avoids charging a full extra discard on every failed draw.
  return (1-readyChance)*Math.max(0,ordinary-safest)*safeClaim*.45;
}

function hardRolloutDiscard(player,plan,remaining) {
  if(plan.ranked.length<2||!state.wall.length) return plan.best;
  const choices=[...plan.ranked].sort((a,b)=>b.value-a.value).slice(0,3);
  if(plan.bestTing) {
    const ready=plan.ranked.find(entry=>entry.index===plan.bestTing.candidate.index);
    if(ready&&!choices.includes(ready)) choices.push(ready);
  }
  const samples=hardDrawSamples(remaining);
  let best=null,bestValue=-Infinity;
  for(const entry of choices) {
    const future=hardRolloutValue(player,entry.after,remaining,samples);
    const route=hardLegalRouteValue(player,entry.after,remaining);
    const value=.65*entry.value+.35*future+route*.8*hardStrategicWeights(player).attack;
    if(value>bestValue) {best=entry;bestValue=value;}
  }
  return best||plan.best;
}

function hardChooseExposure(player,actions,baseline,remaining) {
  let bestAction=null,bestValue=baseline+.75;
  for(const action of actions) {
    let trial=hardTrialValue(player,action,remaining);
    if(action.kind!=="startEgg") {
      const remainingHand=[...state.hands[player]];
      if(action.kind==="concealed") for(let i=0;i<4;i++) removeTile(remainingHand,action.tile);
      else removeTile(remainingHand,action.tile);
      trial+=.6*hardExpectedReplacementGain(remainingHand,remaining);
    }
    // Each listed point is paid by three opponents; convert net points into
    // hand-shape units while still allowing a damaged ready hand to veto it.
    const eggPayment=action.points*3;
    const robbed=action.kind==="added"||action.kind==="supplement"
      ?hardDiscardDanger(player,action.tile,remaining)*.35:0;
    const value=trial+eggPayment*.5-robbed;
    if(value>bestValue) {bestAction=action;bestValue=value;}
  }
  return bestAction;
}

function runHardAI(player) {
  const hand=state.hands[player],remaining=hardPublicRemaining(player);
  const actions=hardExposureActions(player);
  if(state.ting[player]) {
    // The rule check already guarantees that the waits and best shapes survive.
    actions.sort((a,b)=>b.points-a.points);
    if(actions.length) return hardExecuteExposure(player,actions[0]);
    const drawnIndex=hand.lastIndexOf(state.lastDrawn[player]);
    const tile=hand.splice(drawnIndex>=0?drawnIndex:hand.length-1,1)[0];
    state.lastDrawn[player]=null;
    return performDiscard(player,tile);
  }
  const plan=hand.length%3===2?hardDiscardPlan(player,remaining):null;
  const baseline=plan?plan.best.value:hardProjectedValue(player,hand,remaining);
  const bestAction=hardChooseExposure(player,actions,baseline,remaining);
  if(bestAction) return hardExecuteExposure(player,bestAction);
  if(hand.length%3!==2) return finishEggTurn(player);
  const selected=hardRolloutDiscard(player,plan,remaining);
  if(selected.tingValue>0&&selected.candidate?.reportAllowed
    &&selected.value>=plan.best.value-1.5) {
    const {candidate}=selected;
    return queueActionCue(player,"ting",()=>completeAIReportTing(player,candidate),
      {kind:"aiReportTing",player,candidate});
  }
  const tile=hand.splice(selected.index,1)[0];
  return performDiscard(player,tile);
}

function hardExecuteExposure(player,action) {
  if(action.kind==="startEgg") return queueActionCue(player,"egg",()=>executeEgg(player,action.egg.type,action.egg.tiles),
    {kind:"startEgg",player,type:action.egg.type,tiles:[...action.egg.tiles]});
  if(action.kind==="supplement") return beginEggSupplement(player,action.tile,action.eggIndex);
  if(action.kind==="concealed") return queueActionCue(player,"gang",()=>selfKong(action.tile,false),
    {kind:"concealed",player,tile:action.tile});
  if(action.kind==="added") return selfKong(action.tile,true);
}

function aiClaimGain(option,discardedTile) {
  if(option.type!=="chi"&&option.type!=="peng")return -Infinity;
  const hand=state.hands[option.p],beforeMelds=shapeMelds(option.p);
  const needed=option.type==="chi"?[...option.pattern]:[discardedTile,discardedTile,discardedTile];
  needed.splice(needed.indexOf(discardedTile),1);
  const after=[...hand];
  for(const tile of needed) {
    const index=after.indexOf(tile);
    if(index<0)return -Infinity;
    after.splice(index,1);
  }
  const claimed={type:option.type,tiles:option.type==="chi"?[...option.pattern]:Array(3).fill(discardedTile)};
  const nextMelds=[...beforeMelds,claimed];
  const before=aiHandValue(hand,beforeMelds);
  const afterClaim=bestAIDiscard(after,nextMelds).value;
  const openingCost=beforeMelds.some(m=>m.type==="chi"||m.type==="peng")?0:2.5;
  return afterClaim-before-1.5-openingCost;
}

function hardClaimProbability(gain) {
  if(!Number.isFinite(gain)) return 0;
  // A one-point advantage is a 50/50 claim. Small negative gains remain
  // possible, while very harmful claims are vanishingly rare.
  return Math.min(.98,1/(1+Math.exp(-(gain-1)/1.2)));
}

function hardShouldClaim(gain,roll=null) {
  const probability=hardClaimProbability(gain);
  return probability>0&&(roll===null?Math.random():roll)<probability;
}

function hardClaimGain(option,discardedTile,passRouteCache=null) {
  if(!["chi","peng","gang"].includes(option.type)) return -Infinity;
  const player=option.p,hand=state.hands[player],beforeMelds=shapeMelds(player);
  const remaining=hardPublicRemaining(player);
  const before=hardProjectedValue(player,hand,remaining);
  let passRoute=0,passReadyChance=0;
  if(option.type!=="gang") {
    let passInfo=passRouteCache?.get(player);
    if(passInfo===undefined) {
      passInfo=hardPassRouteValue(player,hand,remaining,true);
      passRouteCache?.set(player,passInfo);
    }
    passRoute=typeof passInfo==="number"?passInfo:passInfo.value;
    passReadyChance=typeof passInfo==="number"?0:passInfo.readyChance;
  }
  const needed=option.type==="chi"?[...option.pattern]:Array(option.type==="gang"?4:3).fill(discardedTile);
  needed.splice(needed.indexOf(discardedTile),1);
  const trialHand=[...hand];
  for(const tile of needed) {
    if(!trialHand.includes(tile)) return -Infinity;
    removeTile(trialHand,tile);
  }
  const oldHand=state.hands[player],oldMelds=state.melds[player],oldEggs=state.eggs[player];
  const trialMelds=oldMelds.map(meld=>({...meld,tiles:[...meld.tiles]}));
  const trialEggs=oldEggs.map(egg=>({...egg,tiles:[...egg.tiles]}));
  trialMelds.push({type:option.type,tiles:option.type==="chi"?[...option.pattern]
    :Array(option.type==="gang"?4:3).fill(discardedTile)});
  state.hands[player]=trialHand;state.melds[player]=trialMelds;state.eggs[player]=trialEggs;
  try {
    const samples=hardDrawSamples(remaining);
    if(option.type==="gang") {
      const points=groupPoints({type:"gang",tiles:[discardedTile],concealed:false});
      const projected=hardProjectedValue(player,trialHand,remaining);
      const future=hardRolloutValue(player,trialHand,remaining,samples);
      return projected-before+points*1.5+.6*hardExpectedReplacementGain(trialHand,remaining)
        +.2*(future-projected);
    }
    const plan=hardDiscardPlan(player,remaining),after=plan.best.after;
    // After a safe reporting discard, Bao is viewed before the next draw.
    // Keep the rollout's shape forecast, but later simulated discards must
    // carry ordinary point-pao risk rather than the pre-view Bao-pao liability.
    const future=hardRolloutValue(player,after,remaining,samples,
      plan.best.tingValue>0?true:null);
    let gain=plan.best.value-before-1.5+.2*(future-plan.best.value)
      -3*passRoute;
    if(plan.best.tingValue>0) gain+=hardBaoSafetyUrgency(player,hand,remaining,
      passReadyChance,plan.best.tile);
    const afterMelds=shapeMelds(player);
    if(isStanding(beforeMelds)&&!isStanding(afterMelds)) {
      const standingGain=computeScore({winner:player,method:"自摸",
        pattern:{baseFans:patternBase("ping",true)}}).winnerGain;
      const openGain=computeScore({winner:player,method:"自摸",
        pattern:{baseFans:patternBase("ping",false)}}).winnerGain;
      gain-=2.5*Math.log2(standingGain/openGain);
    }
    const pairs=[...new Set(hand)].filter(tile=>tileCount(hand,tile)===2);
    if(pairs.length===1&&needed.includes(pairs[0])
      &&![...new Set(after)].some(tile=>tileCount(after,tile)>=2))
      gain-=plan.best.tingValue>0?3:11;
    if(hasYaoJiu(hand,beforeMelds)&&!hasYaoJiu(after,afterMelds)) gain-=9;
    if(!playerHasNineEgg(player)&&hasAllThreeSuits(hand,beforeMelds)
      &&!hasAllThreeSuits(after,afterMelds)) gain-=7;
    const triplets=[...new Set(hand)].filter(tile=>tileCount(hand,tile)>=3).length
      +beforeMelds.filter(meld=>meld.type==="peng"||meld.type==="gang"||meld.type==="egg").length;
    if(option.type==="chi"&&triplets>=2) gain-=3;
    return gain;
  } finally {
    state.hands[player]=oldHand;state.melds[player]=oldMelds;state.eggs[player]=oldEggs;
  }
}

function concealedKongs(p){ return [...new Set(state.hands[p])].filter(t=>tileCount(state.hands[p],t)===4); }
function addedKongs(p){ return state.melds[p].filter(m=>m.type==="peng"&&state.hands[p].includes(m.tiles[0])).map(m=>m.tiles[0]); }
function tenpaiShape(player,hand) {
  const waits=getLegalWaits(player,hand);
  return waits.map(tile=>{
    const pattern=detectPattern([...hand,tile],shapeMelds(player),tile,"自摸");
    return `${tile}:${pattern.type}`;
  });
}

// A reported hand may only expose a newly acquired tile if its waits and best
// scoring shapes are exactly the same afterwards. Trial changes never leak into
// the live state, including when the legality check runs during rendering.
function canKeepTingAfterKong(player,tile,kind,source="drawn",eggIndex=null) {
  if(!canDrawReplacement())return false;
  if(!state.ting[player]) return true;
  if(source==="drawn"&&state.lastDrawn[player]!==tile) return false;
  const hand=state.hands[player];
  const before=source==="drawn"?tileInHandWithoutWin(hand,tile):[...hand];
  const original=tenpaiShape(player,before);
  if(!original.length||original.map(item=>+item.split(":")[0]).join(",")!==state.ting[player].waitTiles.join(",")) return false;
  const trialHand=[...hand], oldMelds=state.melds[player], oldEggs=state.eggs[player];
  const trialMelds=oldMelds.map(m=>({...m,tiles:[...m.tiles]}));
  const trialEggs=oldEggs.map(egg=>({...egg,tiles:[...egg.tiles]}));
  const remove=kind==="concealed"?(source==="external"?3:4):source==="external"?0:1;
  if(tileCount(trialHand,tile)<remove) return false;
  for(let i=0;i<remove;i++) removeTile(trialHand,tile);
  if(kind==="concealed") trialMelds.push({type:"gang",tiles:Array(4).fill(tile)});
  else if(kind==="added") {
    const meld=trialMelds.find(m=>m.type==="peng"&&m.tiles[0]===tile);
    if(!meld) return false;
    meld.type="gang"; meld.tiles.push(tile);
  } else if(kind==="egg") {
    const egg=trialEggs[eggIndex];
    if(!egg||eggSupplementIndex(egg,tile)<0) return false;
    egg.tiles.push(tile);
  } else return false;
  state.melds[player]=trialMelds; state.eggs[player]=trialEggs;
  try { return tenpaiShape(player,trialHand).join("|")===original.join("|"); }
  finally { state.melds[player]=oldMelds; state.eggs[player]=oldEggs; }
}

function selfKong(tile,added) {
  const p=state.current;if(state.onlinePaused||state.phase!=="discard"||!canDrawReplacement())return false;
  if(mustWinWithBao(p))return false;
  if(added?!addedKongs(p).includes(tile):!concealedKongs(p).includes(tile)) return false;
  if(!canKeepTingAfterKong(p,tile,added?"added":"concealed")) { setStatus("杠后会改变听牌，不能开杠"); return false; }
  // 补杠先给其余三家一次抢胡机会；没有人胡才真正落杠。
  if(added) return beginAddedKong(p,tile);
  for(let i=0;i<4;i++)removeTile(state.hands[p],tile);
  state.melds[p].push({type:"gang",tiles:[tile,tile,tile,tile],concealed:true});
  setStatus(`${NAMES[p]}暗杠`);render();drawTile(p,true);
}

function beginAddedKong(player,tile) {
  if(!canDrawReplacement())return false;
  return offerRobWin(player,tile,"抢杠胡",()=>queueActionCue(player,"gang",()=>completeAddedKong(player,tile),
    {kind:"added",player,tile}),"kong");
}

function offerRobWin(player,tile,label,complete,kind,eggIndex=null) {
  pendingRob={player,tile,kind,eggIndex};
  state.phase="claim"; state.lastDiscard={player,tile,[kind]:true};
  const award=claimant=>{
    const winningHand=[...state.hands[claimant],tile];
    removeTile(state.hands[player],tile);
    state.lastDrawn[player]=null;
    if(player===0) state.drawnIndex=null;
    return cueWin(claimant,"点炮",winningHand);
  };
  const options=[];
  for(let step=1;step<4;step++) {
    const claimant=(player+step)%4;
    const unreportedWait=!state.ting[claimant]&&getLegalWaits(claimant,state.hands[claimant]).includes(tile);
    if(evaluateChangchunWin(claimant,[...state.hands[claimant],tile],tile,"点炮",{allowUnreportedWin:unreportedWait}).legal)
      options.push({p:claimant,step,type:"hu",priority:3});
    if(kind==="egg"&&canClaimMeld(claimant,"peng",tile))
      options.push({p:claimant,step,type:"peng",priority:2,fromEgg:true});
  }
  const resolve=option=>{
    pendingRob=null;
    return option?.type==="hu"?award(option.p)
      :option?.type==="peng"?cueClaim(option,player,tile):complete();
  };
  if(isOnlineHost()) return startOnlineResponses(
    options,
    resolve,
    label
  );
  const humanHu=options.find(option=>option.p===0&&option.type==="hu");
  const aiHu=options.filter(option=>option.p!==0&&option.type==="hu")
    .sort((a,b)=>a.step-b.step)[0];
  if(aiHu&&(!humanHu||aiHu.step<humanHu.step)) return resolve(aiHu);
  let aiPeng=null;
  if(!aiHu) {
    const passRouteCache=new Map();
    const eligible=options.filter(option=>option.p!==0&&option.type==="peng")
      .filter(option=>{
        const gain=state.aiDifficulty==="hard"
          ?hardClaimGain(option,tile,passRouteCache):aiClaimGain(option,tile);
        return state.aiDifficulty==="hard"?hardShouldClaim(gain):gain>0;
      });
    aiPeng=eligible.sort((a,b)=>a.step-b.step)[0]||null;
  }
  const aiBest=aiHu||aiPeng;
  const human=options.filter(option=>option.p===0&&(!aiBest
    ||option.priority>aiBest.priority
    ||option.priority===aiBest.priority&&option.step<aiBest.step));
  if(!human.length) return resolve(aiBest);
  const onPass=()=>resolve(aiBest);
  state.pending={options:human,onPass};
  setActions([
    ...human.map(option=>({label:option.type==="hu"?label:"碰",kind:option.type==="hu"?"hu":"",
      run:()=>{if(state.phase!=="claim"||!state.pending)return;state.pending=null;setActions();resolve(option);}})),
    {label:"过",kind:"pass",run:()=>{if(state.phase!=="claim"||!state.pending)return;state.pending=null;setActions();onPass();}}
  ]);
  setStatus(`可${human.map(option=>option.type==="hu"?label:"碰").join(" / ")}`);
  beep(660,.06); render();
}

function completeAddedKong(player,tile) {
  if(state.onlinePaused||state.phase!=="claim"||!canDrawReplacement()) return false;
  removeTile(state.hands[player],tile);
  const meld=state.melds[player].find(m=>m.type==="peng"&&m.tiles[0]===tile);
  if(!meld) return;
    meld.type="gang"; meld.tiles.push(tile);
  state.lastDiscard=null; state.phase="discard"; state.current=player;
  setStatus(`${NAMES[player]}补杠 ${TILE_NAMES[tile]}`);render();drawTile(player,true);
}

function coreChangchunWin(player, hand, winTile, options={}) {
  return window.MahjongRules.coreWin({hand,winTile,melds:options.melds||shapeMelds(player),
    eggs:state.eggs[player]||[],ting:state.ting[player]},options);
}

function evaluateChangchunWin(player, hand, winTile, method, options={}) {
  if(winTile===undefined||winTile===null) return {legal:false};
  const normal=coreChangchunWin(player,hand,winTile,{...options,method});
  let best=normal.legal?normal:null;
  let bestFans=normal.legal?detectPattern(normal.hand,shapeMelds(player),normal.winTile,method).baseFans:-1;
  // 摸到宝牌可把这张牌临时当作任意牌来检验胡型；点炮时不可摸宝。
  if(!options.disableBao&&isSelfDraw(method)&&state.ting[player]&&state.baopai===winTile) {
    const index=hand.lastIndexOf(winTile);
    for(let replacement=0;replacement<34;replacement++) {
      if(replacement===winTile) continue;
      const changed=[...hand]; changed[index]=replacement;
      const result=coreChangchunWin(player,changed,replacement,{...options,method,ignoreTing:true});
      if(!result.legal) continue;
      const fans=detectPattern(result.hand,shapeMelds(player),result.winTile,method).baseFans+RULES.fans.moBao;
      if(fans>bestFans) { best={...result,moBao:true,actualWinTile:winTile}; bestFans=fans; }
    }
  }
  return best||{legal:false};
}

// Derived from the real hand rather than a saved UI flag. It remains enforced
// after refresh/reconnect, and a host rejects a guest's attempted discard too.
// Dui-bao before drawing already goes straight into cueWin in revealBaopai.
function mustWinWithBao(player,analysis=null,restoring=false) {
  if(!RULES.bao.mustWin)return false;
  const actionable=restoring?["discard","claim","actionCue"].includes(state.phase):state.phase==="discard";
  if(!actionable||state.current!==player||!state.ting[player]||!state.baopaiRevealed[player]
    ||state.baopai===null||state.lastDrawn[player]!==state.baopai||state.hands[player].length%3!==2)return false;
  return (analysis||evaluateChangchunWin(player,state.hands[player],state.lastDrawn[player],"自摸")).legal;
}

function canChangchunWin(player, hand, winTile, method, options={}) {
  return evaluateChangchunWin(player,hand,winTile,method,options).legal;
}

function getLegalWaits(player, hand) {
  const waits=[];
  const visible=[...hand,...meldTiles(shapeMelds(player))];
  for(let tile=0;tile<34;tile++) {
    if(tileCount(visible,tile)>=4) continue;
    // 七对、豪华七对与普通牌型均可炮胡或自摸，取有效听张的并集。
    const full=[...hand,tile];
    if(evaluateChangchunWin(player,full,tile,"点炮",{forTenpai:true,disableBao:true}).legal
      || evaluateChangchunWin(player,full,tile,"自摸",{forTenpai:true,disableBao:true}).legal) waits.push(tile);
  }
  return waits;
}

function getTingCandidates(player) {
  const hand=state.hands[player];
  if(hand.length%3!==2) return [];
  const candidates=[];
  const checked=new Set();
  for(let index=0;index<hand.length;index++) {
    if(checked.has(hand[index])) continue;
    checked.add(hand[index]);
    const after=hand.filter((_,i)=>i!==index), waitTiles=getLegalWaits(player,after);
    if(!waitTiles.length) continue;
    const noYaoJiu=!hasYaoJiu(after,shapeMelds(player));
    const types=new Set(["ping"]);
    waitTiles.forEach(tile=>types.add(detectPattern([...after,tile],shapeMelds(player),tile).type));
    candidates.push({index,tile:hand[index],waitTiles,types:[...types],noYaoJiu,reportAllowed:!noYaoJiu});
  }
  return candidates;
}

function getSelectedTingCandidate(player) {
  const index=player===0?state.selectedIndex:null;
  if(index===null||index===undefined) return null;
  return getTingCandidates(player).find(candidate=>candidate.index===index)||null;
}

function discardLeavesTenpai(index) { return !!getTingCandidates(0).find(candidate=>candidate.index===index); }

function getTenpaiTiles() {
  const signature=`${state.hands[0].join(",")}|${JSON.stringify(state.melds[0])}|${JSON.stringify(state.eggs[0])}|${JSON.stringify(state.ting[0])}`;
  if(state.tenpaiSignature===signature) return state.tenpaiTiles;
  const tiles=new Set(getTingCandidates(0).map(candidate=>candidate.tile));
  state.tenpaiSignature=signature; state.tenpaiTiles=tiles;
  return tiles;
}

function declareTing(player, candidate) {
  if(!candidate?.reportAllowed) return false;
  state.ting[player]={waitTiles:[...candidate.waitTiles],discardTile:candidate.tile};
  state.baoViewReady[player]=false;
  if(state.baopai===null&&!state.baopaiPending) state.baopaiPending=true;
  state.tenpaiSignature=null;
  // 听张只给本人看；联机快照会把状态文字发给另外三家。
  setStatus(`${NAMES[player]}报听`);
  return true;
}

// Track the selected physical copy, not merely its rank. Every wall removal
// passes here so a head draw cannot leave a stale treasure position behind.
function takeWallTile(index) {
  if(!Number.isInteger(index)||index<0||index>=state.wall.length)return null;
  const [tile]=state.wall.splice(index,1);
  if(state.baopaiWallIndex===index)state.baopaiWallIndex=null;
  else if(state.baopaiWallIndex!==null&&index<state.baopaiWallIndex)state.baopaiWallIndex--;
  return tile;
}

function determineBaopai(roll=null) {
  if(!state.wall.length) return null;
  const available=Math.min(6,state.wall.length);
  const distance=roll===null?Math.floor(Math.random()*available)+1:roll;
  if(!Number.isInteger(distance)||distance<1||distance>available)return null;
  const index=state.wall.length-distance;
  state.baopaiWallIndex=index;
  state.baopai=state.wall[index];
  state.baopaiCandidates.push(state.baopai);
  state.baopaiPending=false;
  state.baopaiRevealed=[false,false,false,false];
  // 新宝对所有人先盖住；已报听者也要等自己的下一次摸牌回合。
  return state.baopai;
}

function cueRevealBaopai(player) {
  if(!state.ting[player]||state.baopai===null||!state.baoViewReady[player]) return false;
  const visibleHand=[...state.hands[player],...meldTiles(shapeMelds(player))];
  if(!hasYaoJiu(visibleHand)) {setStatus("断幺九听牌不能看宝");return false;}
  const queued=queueActionCue(player,"bao",()=>{
    $("baoRevealOverlay")?.classList.remove("show");
    $(`actionCue${player}`)?.classList.remove("preview-hidden");
    revealBaopai(player);
  },{kind:"revealBao",player});
  if(queued&&player===0) {
    $("actionCue0")?.classList.add("preview-hidden");
    $("baoRevealCard").innerHTML=tileHTML(state.baopai);
    $("baoRevealOverlay").classList.add("show");
  }
  return queued;
}

function revealBaopai(player) {
  if(!state.ting[player]||state.baopai===null||!state.baoViewReady[player]) return false;
  const allWithoutYao=[...state.hands[player],...meldTiles(shapeMelds(player))];
  if(!hasYaoJiu(allWithoutYao)) { setStatus("断幺九听牌不能看宝"); return false; }
  state.baopaiRevealed[player]=true;
  setStatus(`${NAMES[player]}已看宝牌`); render();
  const pendingDraw=state.pendingDraw;
  if(pendingDraw?.player===player&&state.round===pendingDraw.round&&state.phase==="baoReveal") {
    const bao=state.baopai;
    const winningHand=[...state.hands[player],bao];
    // 对宝只检查实际听张，不把尚未摸到的宝牌当万能牌使用。
    if(state.ting[player].waitTiles.includes(bao)
      &&evaluateChangchunWin(player,winningHand,bao,"自摸",{disableBao:true}).legal) {
      state.pendingDraw=null;
      cueWin(player,"自摸",winningHand,bao);
      return true;
    }
    if(getBaoKongOption(player,bao)) {
      queueActionCue(player,"gang",()=>completeBaoKong(player,bao),{kind:"baoKong",player,tile:bao});
      return true;
    }
    state.pendingDraw=null;
    return drawTile(player,pendingDraw.kongReplacement);
  }
  if(player===0) updateActions();
  else if(isOnlineHost()) updatePlayerActions(player);
  return true;
}

function completeBaoKong(player,bao) {
  if(!state.pendingDraw||!tryBaoKong(player,bao))return false;
  state.pendingDraw.kongReplacement=true;
  determineBaopai();
  setStatus(`${NAMES[player]}用宝牌开杠，重新看宝`);render();
  if(player===0||isOnlineHost())offerActions(player,[{label:"看新宝并继续摸牌",kind:"ting",run:()=>cueRevealBaopai(player)}]);
  else cueRevealBaopai(player);
  return true;
}

function getBaoKongOption(player,tile) {
  // The selected indicator itself must still be in the wall, not just another
  // copy of its rank. Draw its replacement only after the new bao is seen.
  if(state.wall.length<2)return null;
  const wallIndex=state.baopaiWallIndex;
  if(tile!==state.baopai||!Number.isInteger(wallIndex)||wallIndex<0
    ||wallIndex>=state.wall.length||state.wall[wallIndex]!==tile)return null;
  const eggIndex=state.eggs[player].findIndex((egg,index)=>!egg.standardGang
    &&eggSupplementIndex(egg,tile)>=0&&canKeepTingAfterKong(player,tile,"egg","external",index));
  const added=state.melds[player].find(m=>m.type==="peng"&&m.tiles[0]===tile);
  const canAdded=added&&canKeepTingAfterKong(player,tile,"added","external");
  const canConcealed=tileCount(state.hands[player],tile)===3
    &&canKeepTingAfterKong(player,tile,"concealed","external");
  if(eggIndex<0&&!canAdded&&!canConcealed) return null;
  return {wallIndex,eggIndex,added,canAdded,canConcealed};
}

function tryBaoKong(player,tile) {
  if(state.onlinePaused)return false;
  const option=getBaoKongOption(player,tile);
  if(!option) return false;
  const {wallIndex,eggIndex,added,canAdded}=option;
  takeWallTile(wallIndex);
  if(eggIndex>=0) {
    state.eggs[player][eggIndex].tiles.push(tile);
    state.eggDrawn[player].push(tile);
  } else if(canAdded) {
    // A previously exposed peng stays open when completed with the treasure.
    added.type="gang"; added.tiles.push(tile); added.concealed=false;
  } else {
    for(let i=0;i<3;i++) removeTile(state.hands[player],tile);
    // Three concealed hand tiles + the treasure form a concealed kong.
    state.melds[player].push({type:"gang",tiles:Array(4).fill(tile),concealed:true});
  }
  state.tenpaiSignature=null;
  return true;
}

function publicBaoCount() {
  if(state.baopai===null) return 0;
  return visibleTileCount(state.baopai);
}

function checkBaopaiReplace() {
  if(state.baopai!==null&&publicBaoCount()>=3) determineBaopai();
}

function isDuiBao(winTile) { return state.baopai!==null&&state.baopai===winTile; }

function isMoBao(hand, winTile, player=state.current) {
  return evaluateChangchunWin(player,hand,winTile,"自摸").moBao===true;
}

function eggWildcardSets(hand,required) {
  const found=new Map(),used=[];
  const choose=index=>{
    if(index===required.length) {
      const tiles=[...used];
      found.set([...tiles].sort((a,b)=>a-b).join(","),tiles);
      return;
    }
    const tile=required[index];
    for(const actual of tile===18?[18]:[tile,18]) {
      if(tileCount(hand,actual)<=tileCount(used,actual)) continue;
      used.push(actual);choose(index+1);used.pop();
    }
  };
  choose(0);
  return [...found.values()];
}

function detectStartEggs(hand) {
  const eggs=[];
  const winds=[27,28,29,30].filter(tile=>hand.includes(tile));
  // 每一种可用实牌组合都给玩家选择：四风取任意三风，幺鸡也可代缺风。
  for(let used=winds.length;used>=0;used--) {
    if(used>3||3-used>tileCount(hand,18)) continue;
    for(let mask=0;mask<1<<winds.length;mask++) {
      const chosen=winds.filter((_,index)=>mask&(1<<index));
      if(chosen.length!==used) continue;
      eggs.push({type:"threeWinds",label:"风蛋",tiles:[...chosen,...Array(3-used).fill(18)],concealed:true});
    }
  }
  for(const type of ["joy","ones","nine"])for(const tiles of eggWildcardSets(hand,RULES.eggs[type].required))
    eggs.push({type,label:eggTypeName(type),tiles,concealed:true});
  RULES.bigEggTiles.forEach(tile=>{
    if(tileCount(hand,tile)>=4) eggs.push({type:"big",label:"大蛋",tiles:Array(4).fill(tile),concealed:true});
  });
  return eggs;
}

function eggActions(player) {
  if(!state.firstDrawDone[player]||state.firstDiscardDone[player]) return [];
  const seen=new Set(state.eggs[player].map(egg=>`${egg.type}:${egg.tiles.join(",")}`));
  return detectStartEggs(state.hands[player]).filter(egg=>!seen.has(`${egg.type}:${egg.tiles.join(",")}`)&&state.melds[player].length+state.eggs[player].filter(item=>!item.standardGang).length<4);
}

function eggSupplementOptions(player) {
  const options=[];
  for(const tile of new Set(state.hands[player])) state.eggs[player].forEach((egg,eggIndex)=>{
    if(eggSupplementIndex(egg,tile)>=0&&canAddEgg(player,tile,eggIndex)) options.push({tile,eggIndex});
  });
  return options;
}

function canAddEgg(player,tile,eggIndex=null) {
  if(!state.hands[player].includes(tile)) return false;
  if(eggIndex!==null) return eggSupplementIndex(state.eggs[player][eggIndex],tile)>=0
    &&canKeepTingAfterKong(player,tile,"egg","drawn",eggIndex);
  return state.eggs[player].some((egg,index)=>eggSupplementIndex(egg,tile)>=0
    &&canKeepTingAfterKong(player,tile,"egg","drawn",index));
}

function eggSupplementIndex(egg,tile) {
  if(!egg||egg.standardGang) return -1;
  const required=RULES.eggs[egg.type]?.required;
  if(!required||!(tile===18||required.includes(tile))) return -1;
  // 补蛋追加实牌，不替换起手下蛋时亮出的牌。三风可补任意风，
  // 喜、幺、9 蛋可补本系列牌；幺鸡可补任何已下的蛋。
  return egg.tiles.length;
}

function executeEgg(player,type,tiles) {
  if(mustWinWithBao(player))return false;
  if(state.phase!=="discard"||state.current!==player||state.ting[player]||!state.firstDrawDone[player]||state.firstDiscardDone[player]) return false;
  if(state.melds[player].length+state.eggs[player].filter(egg=>!egg.standardGang).length>=4) return false;
  if(!detectStartEggs(state.hands[player]).some(egg=>egg.type===type&&egg.tiles.join(",")===tiles.join(","))) return false;
  if(!tiles.every(tile=>tileCount(state.hands[player],tile)>=tiles.filter(value=>value===tile).length)) return false;
  tiles.forEach(tile=>removeTile(state.hands[player],tile));
  state.eggs[player].push({type,tiles:[...tiles],concealed:true});
  state.eggDrawn[player].push(...tiles);
  // 起手下蛋不补牌：蛋作为已成的一组，手牌相应减少三张（大蛋四张）。
  // 把第四组亮完后仍须保留将牌；因此不给最后仅剩一组的手牌继续下蛋。
  if(player===0) {
    state.drawnIndex=null;
    state.lastDrawn[0]=null;
  }
  setStatus(`${NAMES[player]}下${eggTypeName(type)}`);
  render();
  if(player===0) updateActions(); else scheduleAI();
  return true;
}

function beginEggSupplement(player,tile,eggIndex=null) {
  if(mustWinWithBao(player))return false;
  if(state.onlinePaused||state.phase!=="discard"||state.current!==player||!canAddEgg(player,tile,eggIndex)||!state.wall.length) return false;
  if(eggIndex===null) eggIndex=state.eggs[player].findIndex(egg=>eggSupplementIndex(egg,tile)>=0);
  const complete=()=>queueActionCue(player,"egg",()=>{
    state.lastDiscard=null;
    state.phase="discard";
    addEggTile(player,tile,eggIndex);
  },{kind:"supplement",player,tile,eggIndex});
  return offerRobWin(player,tile,"抢蛋胡",complete,"egg",eggIndex);
}

function addEggTile(player,tile,eggIndex=null) {
  if(mustWinWithBao(player))return false;
  if(state.onlinePaused||state.phase!=="discard"||state.current!==player||!canAddEgg(player,tile,eggIndex)||!state.wall.length) return false;
  if(eggIndex===null) eggIndex=state.eggs[player].findIndex(egg=>eggSupplementIndex(egg,tile)>=0);
  state.selectedTile=null; state.selectedIndex=null;
  removeTile(state.hands[player],tile);
  const egg=state.eggs[player][eggIndex];
  const index=eggSupplementIndex(egg,tile);
  if(index===egg.tiles.length) egg.tiles.push(tile);
  else egg.tiles[index]=tile;
  state.eggDrawn[player].push(tile);
  state.drawnIndex=null;
  state.lastDrawn[player]=null;
  setStatus(`${NAMES[player]}补${eggTypeName(egg.type)} ${shortName(tile)}`);
  drawTile(player,true);
  return true;
}

function computeScore(options){return window.MahjongRules.computeScore({dealer:state.dealer,...options});}

function computeKongScore(groups=null) {
  return computeGroupScore(groups||[0,1,2,3].map(eggKongGroups));
}

function renderResultScore(score,kongScore=computeKongScore()) {
  const winChanges=score?.changes||[0,0,0,0];
  const rows=winChanges.map((winChange,player)=>{
    const kongChange=kongScore.changes[player], change=winChange+kongChange;
    return `<div class="score-row ${score&&player===state.current?"winner":""}"><span>${NAMES[player]}${player===state.dealer?"（庄）":""}</span><span>${winChange>=0?"+":""}${winChange}</span><span>${kongChange>=0?"+":""}${kongChange}</span><strong class="${change>=0?"gain":"loss"}">${change>=0?"+":""}${change}</strong></div>`;
  }).join("");
  $("scoreTable").innerHTML=`<div class="score-title">${score?`胡牌总番数 N = ${score.N}`:"荒庄"} · 蛋杠分另计</div><div class="score-head"><span>玩家</span><span>胡分</span><span>蛋杠分</span><span>总计</span></div>${rows}`;
}

function renderResultBao() {
  $("resultBao").innerHTML=state.baopai===null
    ? '<span class="result-bao-empty">本局未打宝</span>'
    : `<span class="result-bao-label">本局宝牌</span>${tileHTML(state.baopai,{small:true})}<span class="result-bao-name">${TILE_NAMES[state.baopai]}</span>`;
}

function resultEggTilesHTML(tiles) {
  const counts=new Map();
  tiles.forEach(tile=>counts.set(tile,(counts.get(tile)||0)+1));
  return [...counts].map(([tile,count])=>`<span class="result-egg-tile" title="${TILE_NAMES[tile]} × ${count}">${tileHTML(tile,{small:true})}${count>1?`<sup class="result-count-badge" aria-label="${count}张">${count}</sup>`:""}</span>`).join("");
}

function liveEggTilesHTML(tiles,small=false) {
  const counts=new Map();
  tiles.forEach(tile=>counts.set(tile,(counts.get(tile)||0)+1));
  return [...counts].map(([tile,count])=>`<span class="live-egg-tile" title="${TILE_NAMES[tile]} × ${count}">${tileHTML(tile,{small})}${count>1?`<sup class="live-egg-count" aria-label="${count}张">${count}</sup>`:""}</span>`).join("");
}

function resultGroupHTML(label,tiles,kind) {
  const cards=kind==="egg"?resultEggTilesHTML(tiles):tiles.map(tile=>tileHTML(tile,{small:true})).join("");
  return `<span class="result-meld result-${kind}" title="${label}" aria-label="${label}"><span class="result-group-label">${label}</span><span class="result-group-tiles">${cards}</span></span>`;
}

function renderResultHands(winner=null,winningHand=null,winTile=null) {
  const order=winner===null?[0,1,2,3]:[winner,...[0,1,2,3].filter(player=>player!==winner)];
  $("winningHand").innerHTML=order.map(player=>{
    const eggs=state.eggs[player].filter(egg=>!egg.standardGang)
      .map(egg=>resultGroupHTML(eggTypeName(egg.type),egg.tiles,"egg")).join("");
    const gangs=eggKongGroups(player).filter(group=>group.standardGang)
      .map(group=>resultGroupHTML(groupDisplayName(group),group.tiles,"gang")).join("");
    const calls=state.melds[player].filter(meld=>meld.type!=="gang")
      .map(meld=>resultGroupHTML({chi:"吃",peng:"碰"}[meld.type]||"副露",meld.tiles,"call")).join("");
    const concealed=(player===winner&&winningHand?winningHand:state.hands[player]).slice().sort((a,b)=>a-b);
    const winIndex=player===winner&&winTile!==null?concealed.lastIndexOf(winTile):-1;
    const cards=`<span class="result-concealed" aria-label="手牌">${concealed.map((tile,index)=>index===winIndex
      ?`<span class="result-win-tile" title="胡牌张：${TILE_NAMES[tile]}" aria-label="胡牌张：${TILE_NAMES[tile]}">${tileHTML(tile,{small:true})}<span class="result-win-badge">胡</span></span>`
      :tileHTML(tile,{small:true})).join("")}</span>`;
    return `<div class="result-player-row${player===winner?" winner":""}" data-player="${player}"><div class="result-player-info"><strong>${NAMES[player]}${player===winner?"胡牌":""}</strong><span>${player===state.dealer?"庄家 · ":""}${seatWind(player)}家</span></div><div class="result-player-tiles">${eggs}${gangs}${calls}${cards}</div></div>`;
  }).join("");
}

function finishWin(player,method,hand,forcedWinTile=null) {
  const loser=method==="点炮"?state.lastDiscard?.player:null;
  const nominalWinTile=forcedWinTile??(method==="点炮"?state.lastDiscard?.tile:state.lastDrawn[player]);
  const unreportedWait=method==="点炮"&&!state.ting[player]&&getLegalWaits(player,state.hands[player]).includes(nominalWinTile);
  const analysis=evaluateChangchunWin(player,hand,nominalWinTile,method,{allowUnreportedWin:unreportedWait,disableBao:forcedWinTile!==null});
  // 所有正常入口都已判定。这里仍保留兜底，以便外部调试调用不会把无效牌型结算成胡。
  if(!analysis.legal) return;
  clearGameTimers(); state.phase="gameover";setActions();state.current=player;render();
  const detected=detectPattern(analysis.hand,shapeMelds(player),analysis.winTile,method);
  const pattern=detected;
  const selfDraw=isSelfDraw(method), duiBao=selfDraw&&forcedWinTile!==null&&isDuiBao(nominalWinTile), moBao=selfDraw&&analysis.moBao;
  const baoPao=!selfDraw&&loser!==null&&!state.baopaiRevealed[loser];
  const score=computeScore({winner:player,loser,method,pattern,selfDraw,zhuangHu:player===state.dealer,zhuangDian:loser===state.dealer,duiBao,moBao,baoPao,dealer:state.dealer});
  const kongScore=computeKongScore();
  state.scores=state.scores.map((scoreValue,index)=>scoreValue+score.changes[index]+kongScore.changes[index]);
  finishMatchHand(player);
  renderScoreboard();
  $("resultTitle").textContent=`${NAMES[player]}胡牌`;
  const source=method==="点炮"&&loser!==null?` · ${NAMES[loser]}放铳`:"";
  const methodLabel=method==="点炮"&&state.lastDiscard?.egg?"抢蛋胡":method==="点炮"&&state.lastDiscard?.kong?"抢杠胡":method;
  $("resultDetail").textContent=`${methodLabel}${source}${duiBao?" · 对宝直接胡":moBao?" · 摸宝胡":""}`;
  const sevenPairs=pattern.type==="qidui"||pattern.type==="haoqidui";
  $("resultShape").textContent=`胡牌牌型：${pattern.name} · ${sevenPairs?"门清":pattern.standing?"站立":"开门"}`;
  const fans=RULES.fans;
  const extras=[`牌型：${pattern.name}`,sevenPairs?"门清（不另加站立番）":pattern.standing?"站立":"开门",`基础 ${pattern.baseFans}番`,
    selfDraw?`自摸 +${fans.selfDraw}`:"",player===state.dealer?`庄家胡 +${fans.dealerWin}`:"",
    !selfDraw&&loser===state.dealer?`庄家点炮 +${fans.dealerDiscard}`:"",duiBao?`对宝 +${fans.duiBao}`:"",moBao?`摸宝 +${fans.moBao}`:""].filter(Boolean);
  $("patternList").innerHTML=extras.map(extra=>`<span>${extra}</span>`).join("");
  renderResultBao();
  renderResultScore(score,kongScore);
  const baoPaoNotice=$("baoPaoNotice");
  baoPaoNotice.hidden=!baoPao;
  baoPaoNotice.textContent=baoPao?`${NAMES[loser]}未看宝，包炮，承担全部 ${score.winnerGain} 分。`:"";
  // Scoring may replace a drawn treasure virtually; the result must show the
  // physical tile that was actually drawn.
  renderResultHands(player,hand,nominalWinTile);
  publishOnlineResult();
  const round=state.round;
  later(()=>{if(state.round===round&&state.phase==="gameover") {const dialog=$("resultDialog");dialog.showModal();dialog.scrollTop=0;}},400);
}

function finishDraw(){clearGameTimers();state.phase="gameover";setActions();setStatus("牌墙已空，本局荒庄");const kongScore=computeKongScore();state.scores=state.scores.map((score,index)=>score+kongScore.changes[index]);finishMatchHand();renderScoreboard();$("resultTitle").textContent="本局荒庄";$("resultDetail").textContent="牌墙摸完，无人胡牌；蛋杠分照常结算";$("resultShape").textContent="";$("patternList").innerHTML="";renderResultBao();renderResultScore(null,kongScore);$("baoPaoNotice").hidden=true;renderResultHands();playSound("drawgame");render();publishOnlineResult();const round=state.round;later(()=>{if(state.round===round&&state.phase==="gameover") {const dialog=$("resultDialog");dialog.showModal();dialog.scrollTop=0;}},300);}

function onlineSnapshotFor(seat) {
  if(!isOnlineHost()||seat<1||seat>3) return null;
  const real=local=>(seat+local)%4,local=actual=>(actual-seat+4)%4;
  const offer=onlineOffers.get(seat);
  return {
    protocol:ONLINE_PROTOCOL,rulesVersion:RULES.version,inputToken:inputPermitFor(seat),
    round:state.round,seat,match:{...state.match,eastSeat:local(state.match.eastSeat)},
    dealer:local(state.dealer),current:local(state.current),phase:state.phase,
    wallCount:state.wall.length,
    hands:Array.from({length:4},(_,p)=>p===0?[...state.hands[seat]]:Array(state.hands[real(p)].length).fill(0)),
    melds:Array.from({length:4},(_,p)=>state.melds[real(p)].map(m=>({...m,
      concealed:concealedGang(real(p),m),tiles:p!==0&&concealedGang(real(p),m)?Array(m.tiles.length).fill(-1):[...m.tiles]}))),
    eggs:Array.from({length:4},(_,p)=>state.eggs[real(p)].map(e=>({...e,
      tiles:p!==0&&e.standardGang&&(e.concealed||e.type==="anGang")?Array(e.tiles.length).fill(-1):[...e.tiles]}))),
    paused:state.onlinePaused,
    discards:state.discards.map(d=>({...d,player:local(d.player)})),
    ting:Array.from({length:4},(_,p)=>{
      const value=state.ting[real(p)];return value?(p===0?{...value,waitTiles:[...value.waitTiles]}:{waitTiles:[]}):null;
    }),
    baopai:state.baopai===null?null:(state.baopaiRevealed[seat]?state.baopai:0),
    baopaiRevealed:Array.from({length:4},(_,p)=>state.baopaiRevealed[real(p)]),
    baopaiPending:state.baopaiPending,
    scores:Array.from({length:4},(_,p)=>state.scores[real(p)]),
    lastDrawn:state.lastDrawn[seat],
    drawnIndex:state.phase==="discard"&&state.current===seat&&state.lastDrawn[seat]!==null
      ?(seat===0?state.drawnIndex:state.hands[seat].length-1):null,
    lastDiscard:state.lastDiscard?{...state.lastDiscard,player:local(state.lastDiscard.player)}:null,
    names:Array.from({length:4},(_,p)=>NAMES[real(p)]),
    status:state.onlinePaused?"有玩家离线，牌局已暂停，等待重连":state.pending&&state.phase==="claim"&&seat!==state.current
      ? "等待出牌者确认操作":$("statusText").textContent,
    cue:state.actionCue?{player:local(state.actionCue.player),type:state.actionCue.type}:null,
    sound:{session:onlineSession,sequence:soundSequence,round:state.round,
      name:latestSoundEvent?.round===state.round?latestSoundEvent.name:null},
    offer:offer?{version:offer.version,actions:offer.actions.map(a=>({label:a.label,kind:a.kind||"",
      tiles:Array.isArray(a.tiles)?[...a.tiles]:undefined}))}:null
  };
}

function applyOnlineSound(sound) {
  if(!sound||typeof sound.session!=="string"||!Number.isSafeInteger(sound.sequence)||sound.sequence<0)return;
  const previous=guestSoundCursor;
  if(!previous||previous.session!==sound.session) {
    // First sync/reconnect establishes a baseline, not historical playback.
    guestSoundCursor={session:sound.session,sequence:sound.sequence};return;
  }
  if(sound.sequence<=previous.sequence)return;
  guestSoundCursor.sequence=sound.sequence;
  if(!state.onlinePaused&&sound.round===state.round&&Object.hasOwn(SOUND_FILES,sound.name))playSound(sound.name,false);
}

function applyOnlineSnapshot(snapshot) {
  if(!isOnlineGuest()||!snapshot||snapshot.protocol!==ONLINE_PROTOCOL||snapshot.rulesVersion!==RULES.version
    ||!Array.isArray(snapshot.hands)||snapshot.hands.length!==4) return false;
  guestInputToken=snapshot.inputToken;
  const sameHand=state.hands[0].join(",")===snapshot.hands[0].join(",");
  NAMES=snapshot.names.map(name=>Array.from(String(name).replace(/[<>&"'`]/g,"")).slice(0,20).join(""));
  state.round=snapshot.round;state.match=snapshot.match;state.onlinePaused=!!snapshot.paused;
  state.dealer=snapshot.dealer;state.current=snapshot.current;state.phase=snapshot.phase;
  state.wall=Array(snapshot.wallCount).fill(0);state.hands=snapshot.hands;
  state.melds=snapshot.melds;state.eggs=snapshot.eggs;state.discards=snapshot.discards;
  state.ting=snapshot.ting;state.baopai=snapshot.baopai;state.baopaiWallIndex=null;state.baopaiRevealed=snapshot.baopaiRevealed;
  state.baopaiPending=snapshot.baopaiPending;state.scores=snapshot.scores;
  state.lastDrawn=[snapshot.lastDrawn,null,null,null];state.drawnIndex=snapshot.drawnIndex;
  state.lastDiscard=snapshot.lastDiscard;
  applyOnlineSound(snapshot.sound);
  if(!sameHand||state.phase!=="discard"||state.current!==0){state.selectedTile=null;state.selectedIndex=null;}
  state.tenpaiSignature=null;
  $("statusText").textContent=snapshot.status;
  $("matchCircleBadge").textContent=`第${matchCircle()}圈`;
  if(state.phase!=="gameover"&&$("resultDialog").open) $("resultDialog").close();
  render();renderScoreboard();
  const cueLabels={chi:"吃",peng:"碰",gang:"杠",hu:"胡",egg:"蛋",ting:"听",bao:"宝"};
  for(let player=0;player<4;player++) {
    const banner=$(`actionCue${player}`);
    banner.classList.remove("show");
    if(snapshot.cue?.player===player) {
      banner.className=`action-cue cue-${SEAT_DIRECTIONS[player]} ${snapshot.cue.type}`;
      banner.textContent=cueLabels[snapshot.cue.type]||"";
      banner.classList.add("show");
    }
  }
  const offer=snapshot.offer;
  setActions(offer?offer.actions.map((action,index)=>({
    ...action,run:()=>onlineController?.sendAction(offer.version,index)
  })):[]);
  finishLoading();
  return true;
}

function onlineResultPayload() {
  return {
    title:$("resultTitle").textContent,detail:$("resultDetail").textContent,
    shape:$("resultShape").textContent,patterns:$("patternList").innerHTML,
    bao:$("resultBao").innerHTML,
    score:$("scoreTable").innerHTML,notice:$("baoPaoNotice").textContent,
    noticeHidden:$("baoPaoNotice").hidden,hands:$("winningHand").innerHTML,
    finish:$("matchFinish").innerHTML,finishHidden:$("matchFinish").hidden
  };
}
function safeOnlineResultMarkup(markup) {
  // 结算内容来自另一位玩家的浏览器。只保留本游戏用到的展示元素，
  // 防止恶意房主把事件属性、链接或脚本作为结算 HTML 发给客机。
  const source=document.createElement("template");
  source.innerHTML=String(markup||"");
  const output=document.createElement("div");
  const allowed=new Set(["DIV","SPAN","STRONG","B","SUP","IMG"]);
  const copy=(node,parent)=>{
    if(node.nodeType===3) {parent.append(document.createTextNode(node.textContent));return;}
    if(node.nodeType!==1||!allowed.has(node.tagName)) return;
    const safe=document.createElement(node.tagName.toLowerCase());
    for(const name of ["class","title","aria-label","data-player","data-tile","data-tile-image","alt","draggable"]) {
      const value=node.getAttribute(name);
      if(value!==null&&(name!=="class"||/^[\w\s-]{0,160}$/.test(value))) safe.setAttribute(name,value);
    }
    if(node.tagName==="IMG") {
      const src=node.getAttribute("src")||"";
      if(/^assets\/tiles\/(?:flat\/|black\/)?[A-Za-z0-9]+\.(?:png|svg)$/.test(src)) safe.setAttribute("src",src);
    }
    for(const child of node.childNodes) copy(child,safe);
    parent.append(safe);
  };
  for(const child of source.content.childNodes) copy(child,output);
  return output.innerHTML;
}
function applyOnlineResult(result) {
  if(!isOnlineGuest()||!result) return;
  $("resultTitle").textContent=result.title;$("resultDetail").textContent=result.detail;
  $("resultShape").textContent=result.shape;$("patternList").innerHTML=safeOnlineResultMarkup(result.patterns);
  $("resultBao").innerHTML=safeOnlineResultMarkup(result.bao);
  $("scoreTable").innerHTML=safeOnlineResultMarkup(result.score);$("baoPaoNotice").textContent=result.notice;
  $("baoPaoNotice").hidden=result.noticeHidden;$("winningHand").innerHTML=safeOnlineResultMarkup(result.hands);
  $("matchFinish").innerHTML=safeOnlineResultMarkup(result.finish);$("matchFinish").hidden=result.finishHidden;
  $("playAgainBtn").textContent="等待房主开始下一局";$("playAgainBtn").disabled=true;
  const dialog=$("resultDialog");if(!dialog.open) dialog.showModal();dialog.scrollTop=0;
}
function onlineReceiveInput(seat,message) {
  if(state.onlinePaused||!isOnlineHost()||!Number.isInteger(seat)||seat<1||seat>3||!message) return false;
  if(message.protocol!==ONLINE_PROTOCOL||message.rulesVersion!==RULES.version||message.round!==state.round
    ||message.inputToken!==inputPermitFor(seat))return false;
  if(message.kind==="discard") {
    if(mustWinWithBao(seat))return false;
    if(message.tile!==state.hands[seat][message.index])return false;
    // Consume before mutation: performDiscard may immediately publish a fresh
    // post-discard report-ting offer. Never invalidate that new offer afterward.
    onlineInputPermits.delete(seat);
    return remoteDiscard(seat,message.index);
  }
  if(message.kind!=="action") return false;
  const offer=onlineOffers.get(seat);
  if(!offer||offer.version!==message.version||offer.round!==state.round||offer.phase!==state.phase
    ||!Number.isInteger(message.index)||message.index<0||message.index>=offer.actions.length) return false;
  if(mustWinWithBao(seat)&&offer.actions[message.index].kind!=="hu")return false;
  onlineOffers.delete(seat);
  onlineInputPermits.delete(seat);
  offer.actions[message.index].run();
  publishOnline();
  return true;
}

const HOST_SAVE_FIELDS=["wall","hands","melds","eggs","discards","dealer","current","phase","round","match",
  "lastDiscard","drawnIndex","ting","lastDrawn","baopai","baopaiWallIndex","baopaiRevealed","baopaiCandidates","baopaiPending",
  "eggDrawn","scores","pendingDraw","firstDrawDone","firstDiscardDone","baoViewReady","aiDifficulty"];
function exportSavedGame() {
  if(state.phase==="idle")return null;
  const saved=Object.fromEntries(HOST_SAVE_FIELDS.map(key=>[key,state[key]]));
  let continuation=null;
  if(state.actionCue)continuation={kind:"cue",phase:state.actionCue.previousPhase,action:state.actionCue.recovery};
  else if(state.phase==="claim")continuation={kind:"response",rob:pendingRob,
    report:state.pending?.kind==="reportTing",answers:onlineClaim?[...onlineClaim.answers]:[],
    human:state.pending?.options?{options:state.pending.options,...state.pending.context}:null,
    remaining:onlineClaim?(()=>{const task=gameTimerTasks.get(onlineClaim.timer);return task?
      (state.onlinePaused?task.remaining:Math.max(0,task.due-Date.now())):20000;})():20000};
  return JSON.parse(JSON.stringify({schema:1,rulesVersion:RULES.version,state:saved,names:NAMES,status:$("statusText").textContent,
    continuation:restoredContinuation||continuation,result:state.phase==="gameover"?onlineResultPayload():null}));
}
function exportHostGame() { return isOnlineHost()?exportSavedGame():null; }
function validHostGame(saved) {
  const value=saved?.state,tile=id=>Number.isInteger(id)&&id>=0&&id<34;
  const four=array=>Array.isArray(array)&&array.length===4;
  if(saved?.schema!==1||saved.rulesVersion&&saved.rulesVersion!==RULES.version&&!RULES.saveCompatibleVersions.includes(saved.rulesVersion)
    ||!value||!four(saved.names)||!saved.names.every(name=>typeof name==="string")
    ||!Array.isArray(value.wall)||!value.wall.every(tile)||value.wall.length>136
    ||value.baopai!==null&&!tile(value.baopai)
    ||value.baopaiWallIndex===undefined&&saved.rulesVersion===RULES.version
    ||value.baopaiWallIndex!==undefined&&value.baopaiWallIndex!==null
      &&(!Number.isInteger(value.baopaiWallIndex)||value.baopaiWallIndex<0||value.baopaiWallIndex>=value.wall.length
        ||value.wall[value.baopaiWallIndex]!==value.baopai)
    ||!four(value.hands)||!value.hands.every(hand=>Array.isArray(hand)&&hand.length<=14&&hand.every(tile))
    ||!four(value.melds)||!four(value.eggs)||!four(value.ting)||!four(value.scores)
    ||!value.scores.every(Number.isFinite)||![0,1,2,3].includes(value.current)||![0,1,2,3].includes(value.dealer)
    ||!Number.isInteger(value.round)||!value.match||!Number.isInteger(value.match.dealerAdvances)
    ||!["discard","claim","baoReveal","actionCue","gameover"].includes(value.phase))return false;
  for(const rows of [value.melds,value.eggs])if(!rows.every(row=>Array.isArray(row)&&row.length<=8
    &&row.every(group=>Array.isArray(group.tiles)&&group.tiles.length<=136&&group.tiles.every(tile))))return false;
  return ["lastDrawn","baopaiRevealed","eggDrawn","firstDrawDone","firstDiscardDone","baoViewReady"].every(key=>four(value[key]))
    &&Array.isArray(value.discards)&&value.discards.every(discard=>tile(discard.tile)&&[0,1,2,3].includes(discard.player));
}
function importSavedGame(saved,paused) {
  if(!validHostGame(saved))return false;
  stopGameSound();latestSoundEvent=null;
  clearGameTimers();onlineOffers.clear();onlineClaim=null;pendingRob=null;
  const copy=JSON.parse(JSON.stringify(saved));
  for(const key of HOST_SAVE_FIELDS)if(copy.state[key]!==undefined)state[key]=copy.state[key];
  // Older saves kept only the rank. Recover a remaining copy nearest the tail
  // once; new saves retain the exact position (including null when drawn).
  if(copy.state.baopaiWallIndex===undefined) {
    const index=state.baopai===null?-1:state.wall.lastIndexOf(state.baopai);
    state.baopaiWallIndex=index<0?null:index;
  }
  normalizeKongData();
  state.round++;
  if(state.pendingDraw)state.pendingDraw.round=state.round;
  state.onlinePaused=paused;state.pending=null;state.actionCue=null;
  for(let p=0;p<4;p++)$(`actionCue${p}`)?.classList.remove("show","preview-hidden");
  $("baoRevealOverlay")?.classList.remove("show");
  state.selectedTile=null;state.selectedIndex=null;state.tenpaiSignature=null;
  NAMES=copy.names;restoredContinuation=copy.continuation||{kind:"resume"};
  $("statusText").textContent=copy.status||"已恢复牌局，等待原玩家重连";
  setActions();render();renderScoreboard();
  $("matchCircleBadge").textContent=`第${matchCircle()}圈`;
  $("playAgainBtn").disabled=paused;
  if(copy.result) {
    const result=copy.result;
    $("resultTitle").textContent=result.title;$("resultDetail").textContent=result.detail;$("resultShape").textContent=result.shape;
    for(const [id,key] of [["patternList","patterns"],["resultBao","bao"],["scoreTable","score"],["winningHand","hands"],["matchFinish","finish"]])
      $(id).innerHTML=safeOnlineResultMarkup(result[key]);
    $("baoPaoNotice").textContent=result.notice;$("baoPaoNotice").hidden=result.noticeHidden;$("matchFinish").hidden=result.finishHidden;
    $("playAgainBtn").textContent=state.match.complete?"新一场":"下一局";
    if(!$("resultDialog").open)$("resultDialog").showModal();
  }
  return true;
}
function importHostGame(saved) { return isOnlineHost()?importSavedGame(saved,true):false; }
function resumeRestoredGame() {
  const continuation=restoredContinuation;restoredContinuation=null;
  // A saved pre-fix optional gang/egg animation must not allow declining a
  // compulsory treasure win. Completed settlements and win cues stay intact.
  if(mustWinWithBao(state.current,null,true)&&continuation?.action?.kind!=="win") {
    state.phase="discard";state.pending=null;pendingRob=null;state.lastDiscard=null;
    render();
    return !isOnlineHost()&&state.current!==0?scheduleAI():updatePlayerActions(state.current);
  }
  if(continuation?.kind==="cue") {
    const action=continuation.action;
    state.phase=continuation.phase;
    if(action?.kind==="win")return finishWin(action.player,action.method,action.hand,action.forcedWinTile);
    if(action?.kind==="claim")return executeClaim(action.option,action.discarder,action.tile);
    if(action?.kind==="startEgg")return executeEgg(action.player,action.type,action.tiles);
    if(action?.kind==="concealed")return selfKong(action.tile,false);
    if(action?.kind==="added")return completeAddedKong(action.player,action.tile);
    if(action?.kind==="supplement") {state.lastDiscard=null;state.phase="discard";return addEggTile(action.player,action.tile,action.eggIndex);}
    if(action?.kind==="revealBao")return revealBaopai(action.player);
    if(action?.kind==="baoKong")return completeBaoKong(action.player,action.tile);
    if(action?.kind==="reportTing") {
      declareTing(action.player,{waitTiles:action.waitTiles,reportAllowed:true,tile:action.tile});
      render();return resolveClaims(action.player,action.tile);
    }
    if(action?.kind==="aiReportTing")return completeAIReportTing(action.player,action.candidate);
  }
  if(state.phase==="gameover")return publishOnlineResult();
  if(state.phase==="discard")return !isOnlineHost()&&state.current!==0?scheduleAI():updatePlayerActions(state.current);
  if(state.phase==="baoReveal")return !isOnlineHost()&&state.current!==0?cueRevealBaopai(state.current)
    :offerActions(state.current,[{label:"看宝并继续摸牌",kind:"ting",run:()=>cueRevealBaopai(state.current)}]);
  if(state.phase!=="claim"||!state.lastDiscard)return;
  const discard=state.lastDiscard,rob=continuation?.rob;
  if(rob?.kind==="kong")beginAddedKong(rob.player,rob.tile);
  else if(rob?.kind==="egg") {
    offerRobWin(rob.player,rob.tile,"抢蛋胡",()=>queueActionCue(rob.player,"egg",()=>{
      state.lastDiscard=null;state.phase="discard";addEggTile(rob.player,rob.tile,rob.eggIndex);
    },{kind:"supplement",player:rob.player,tile:rob.tile,eggIndex:rob.eggIndex}),"egg",rob.eggIndex);
  } else if(!isOnlineHost()&&continuation?.human?.options?.length) {
    const context=continuation.human,ai=context.aiHu||context.aiBest;
    return promptClaims(context.options,()=>ai?.type==="hu"?cueWin(ai.p,"点炮",[...state.hands[ai.p],discard.tile])
      :ai?cueClaim(ai,discard.player,discard.tile):advanceAfterDiscard(discard.player),context);
  } else if(continuation?.report&&promptPostDiscardTing(discard.player,discard.tile))return;
  else resolveClaims(discard.player,discard.tile);
  const claim=onlineClaim;
  if(claim&&continuation?.answers) {
    const task=gameTimerTasks.get(claim.timer);
    if(task&&Number.isFinite(continuation.remaining)) {
      clearTimeout(task.handle);task.remaining=Math.max(0,continuation.remaining);
      task.due=Date.now()+task.remaining;task.handle=setTimeout(task.run,task.remaining);
    }
    for(const [player,answer] of continuation.answers) {
      if(onlineClaim!==claim)break;
      const option=answer===null?null:claim.options.find(candidate=>candidate.p===player&&candidate.type===answer.type
        &&JSON.stringify(candidate.pattern)===JSON.stringify(answer.pattern));
      if(answer===null||option)answerOnlineResponse(claim,player,option);
    }
  }
  publishOnline();
}
function setOnlineController(role,controller) {
  if(role!=="host"&&role!=="guest"&&role!=="solo") return false;
  if(soloMatchActive){saveSoloNow();soloMatchActive=false;}
  clearGameTimers();onlineOffers.clear();onlineClaim=null;restoredContinuation=null;pendingRob=null;
  stopGameSound();latestSoundEvent=null;soundSequence=0;guestSoundCursor=null;
  state.onlineRole=role;state.onlinePaused=false;onlineController=controller;
  onlineInputPermits.clear();guestInputToken=null;
  onlineSession=window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if(role==="solo") NAMES=["你","阿岚","小满","老陈"];
  if($("returnHomeBtn"))$("returnHomeBtn").disabled=role!=="solo";
  return true;
}

function readSoloSave() {
  try {
    const saved=JSON.parse(window.localStorage?.getItem(SOLO_SAVE_KEY)||"null");
    const match=saved?.game?.state?.match;
    return saved?.schema===1&&saved.kind==="solo"&&validHostGame(saved.game)&&match&&!match.complete
      &&Number.isInteger(match.handNumber)&&match.handNumber>0&&match.dealerAdvances>=0&&match.dealerAdvances<16
      &&Number.isInteger(match.nextDealerAdvances)&&["simple","hard"].includes(saved.game.state.aiDifficulty)
      ?saved:null;
  } catch {return null;}
}
function refreshSoloResume() {
  const saved=readSoloSave(),button=$("resumeAiBtn");
  if(!button)return;
  button.hidden=!saved;
  $("modeSaveHint").hidden=!saved;
  if(saved) {
    const value=saved.game.state;
    const circle=Math.min(RULES.circles,Math.floor(value.match.dealerAdvances/4)+1);
    $("resumeAiSummary").textContent=`${value.aiDifficulty==="hard"?"困难":"简单"} · 第${circle}圈 · 第${value.match.handNumber}手${value.phase==="gameover"?" · 待下一局":""}`;
  }
}
function saveSoloNow() {
  if(!soloMatchActive||state.onlineRole!=="solo"||state.phase==="idle")return false;
  try {
    const storage=window.localStorage;
    if(!storage)throw Error("浏览器不支持本地存储");
    if(state.match.complete)storage.removeItem(SOLO_SAVE_KEY);
    else {
      const game=exportSavedGame();
      if(!game||!validHostGame(game))return false;
      storage.setItem(SOLO_SAVE_KEY,JSON.stringify({schema:1,kind:"solo",savedAt:Date.now(),game}));
    }
    soloSaveErrorShown=false;
    return true;
  } catch {
    if(!soloSaveErrorShown){showResourceError("本地对局保存失败，退出后可能无法恢复；请检查浏览器存储权限。 ");soloSaveErrorShown=true;}
    return false;
  }
}
function queueSoloSave() {
  if(!soloMatchActive||state.onlineRole!=="solo"||soloSaveQueued)return;
  soloSaveQueued=true;
  // Save once at the end of an action, never a halfway-mutated render/status.
  Promise.resolve().then(()=>{soloSaveQueued=false;saveSoloNow();});
}
function returnSoloHome() {
  if(state.onlineRole!=="solo")return false;
  if(soloMatchActive&&!saveSoloNow())return false;
  soloMatchActive=false;
  clearGameTimers();onlineOffers.clear();onlineClaim=null;pendingRob=null;restoredContinuation=null;
  state.actionCue=null;state.pending=null;state.phase="idle";
  for(let p=0;p<4;p++)$(`actionCue${p}`)?.classList.remove("show","preview-hidden");
  $("baoRevealOverlay")?.classList.remove("show");
  setActions();setMenuOpen(false);
  for(const id of ["resultDialog","scoreboardDialog","rulesDialog"])$(id).close();
  refreshSoloResume();
  if(!$("modeDialog").open)$("modeDialog").showModal();
  window.MahjongUpdateHome?.();
  return true;
}
function resumeSoloMatch() {
  if(window.MahjongUpdateBusy?.())return false;
  if(state.onlineRole!=="solo")return false;
  const saved=readSoloSave();
  if(!saved){refreshSoloResume();return false;}
  setOnlineController("solo",null);
  if(!importSavedGame(saved.game,false))return false;
  soloMatchActive=true;
  $("modeDialog").close();setMenuOpen(false);
  resumeRestoredGame();queueSoloSave();finishLoading();
  return true;
}
function publishOnlineResult() {
  if(!isOnlineHost()) {queueSoloSave();return;}
  publishOnline();onlineController?.publishResult(onlineResultPayload());
}
function shortName(id){return id<27?`${id%9+1}${["万","筒","条"][Math.floor(id/9)]}`:["东","南","西","北","中","发","白"][id-27];}

let audioContext;
function unlockAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==="suspended")audioContext.resume();}catch{}}
function beep(freq,duration){if(!state.sound)return;try{unlockAudio();const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=freq;o.type="triangle";g.gain.setValueAtTime(.055*state.volume,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration);}catch{}}
function stopGameSound(){
  if(activeSound)try{activeSound.pause();activeSound.currentTime=0;}catch{}
  activeSound=null;
}
function playSound(name,broadcast=true){
  if(!Object.hasOwn(SOUND_FILES,name))return;
  // Host mute is local: guests still receive the public sound event. Never
  // include a tile value; repeated snapshots share the same sequence number.
  if(broadcast&&isOnlineHost()) {
    latestSoundEvent={name,round:state.round};soundSequence++;publishOnline();
  }
  if(!state.sound||state.volume<=0)return;
  try{
    stopGameSound();
    const audio=soundCache[name]??=new Audio(`assets/sounds/${SOUND_FILES[name]}`);
    const instance=audio.cloneNode();
    instance.volume=state.volume;
    activeSound=instance;
    instance.addEventListener?.("ended",()=>{if(activeSound===instance)activeSound=null;},{once:true});
    instance.play().catch(()=>{if(activeSound===instance)activeSound=null;});
  }catch{}
}

let resourceErrorDismissed=false;
function showResourceError(message){
  if(resourceErrorDismissed)return;
  const banner=$("errorBanner"),label=$("errorBannerMessage");
  if(!banner||!label)return;
  label.textContent=message;banner.hidden=false;
}
let loadingOverlayHandled=false;
function finishLoading(){
  const overlay=$("loadingOverlay");if(loadingOverlayHandled||!overlay||!document.images)return;
  loadingOverlayHandled=true;
  const hide=()=>{
    if(overlay.classList.contains("hidden"))return;
    overlay.classList.add("hidden");setTimeout(()=>overlay.remove(),300);
  };
  // An image request can hang indefinitely in a mobile webview. Let the table
  // remain playable while slow images continue loading in the background.
  const timeout=setTimeout(hide,6000);
  // This is intentionally a startup snapshot: startGame has already rendered all
  // tile images needed for the board, and later turns reuse those same assets.
  const images=[...document.images];
  Promise.all(images.map(img=>img.complete?Promise.resolve({img,ok:img.naturalWidth>0}):new Promise(resolve=>{img.addEventListener("load",()=>resolve({img,ok:true}),{once:true});img.addEventListener("error",()=>resolve({img,ok:false}),{once:true});}))).then(results=>{
    clearTimeout(timeout);
    const missing=results.filter(result=>!result.ok).map(result=>result.img.getAttribute("src")||"未知资源");
    if(missing.length)showResourceError(`部分麻将牌资源加载失败：${missing.slice(0,3).join("、")}${missing.length>3?` 等 ${missing.length} 个`:""}`);
    hide();
  });
}

$("playAgainBtn").onclick=nextHand;
function setMenuOpen(open) {
  $("gameMenu").hidden=!open;
  $("menuToggle").setAttribute("aria-expanded",String(open));
  $("menuToggle").setAttribute("aria-label",open?"收起游戏菜单":"展开游戏菜单");
  $("menuToggleLabel").textContent=open?"收起":"菜单";
  window.MahjongTable?.requestLayout();
}
$("menuToggle").onclick=()=>setMenuOpen($("gameMenu").hidden);
setMenuOpen(false);
$("newGameBtn").onclick=()=>{setMenuOpen(false);state.onlineRole==="solo"?startAIMatch(state.aiDifficulty):startMatch();};
function startAIMatch(difficulty) {
  if(window.MahjongUpdateBusy?.())return;
  setOnlineController("solo",null);
  state.aiDifficulty=difficulty;
  soloMatchActive=true;
  $("modeDialog").close();
  try {startMatch();} catch(error) {showResourceError(`游戏初始化失败：${error.message}`);throw error;}
}
$("modeAiBtn").onclick=()=>startAIMatch("simple");
$("modeHardBtn").onclick=()=>startAIMatch("hard");
$("resumeAiBtn").onclick=resumeSoloMatch;
$("returnHomeBtn").onclick=returnSoloHome;
$("modeDialog").addEventListener("cancel",event=>event.preventDefault());
if(document.body) document.body.dataset.tileTheme=state.tileTheme;
$("tileThemeSelect").value=state.tileTheme;
$("tileThemeSelect").onchange=e=>setTileTheme(e.target.value);
$("scoreboardBtn").onclick=()=>{setMenuOpen(false);renderScoreboard();$("scoreboardDialog").showModal();};
$("scoreboardDialog").querySelector(".modal-close").onclick=()=>$("scoreboardDialog").close();
$("rulesBtn").onclick=()=>{setMenuOpen(false);$("rulesDialog").showModal();};
$("rulesDialog").querySelector(".modal-close").onclick=()=>$("rulesDialog").close();
$("soundBtn").onclick=()=>{state.sound=!state.sound;$("soundState").textContent=state.sound?"开":"关";$("soundBtn").setAttribute("aria-label",state.sound?"关闭声音":"开启声音");if(state.sound)beep(440,.05);else stopGameSound();};
$("errorBannerClose").onclick=()=>{resourceErrorDismissed=true;$("errorBanner").hidden=true;};
$("volumeSlider").oninput=e=>{state.volume=+e.target.value/100;if(activeSound)activeSound.volume=state.volume;else if(state.volume>0)beep(440,.035);};
document.addEventListener("pointerdown",unlockAudio,{once:true});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(state.pending&&!state.onlinePaused){const cb=state.pending.onPass;state.pending=null;setActions();cb();}else if(!$("gameMenu").hidden)setMenuOpen(false);});
window.addEventListener?.("error",event=>{if(event.target?.tagName==="IMG")showResourceError("麻将牌图片加载失败，请检查网络后刷新重试。");},true);
window.addEventListener?.("pagehide",saveSoloNow);
window.addEventListener?.("beforeunload",saveSoloNow);
document.addEventListener("visibilitychange",()=>{if(document.hidden)saveSoloNow();});

refreshSoloResume();
// Updates are allowed only at the home screen, never during a match, a
// settlement or a room setup/lobby (including disconnected online games).
window.MahjongUpdatePolicy=()=>({safe:state.onlineRole==="solo"&&!soloMatchActive
  &&$("modeDialog").open&&!$("onlineDialog").open});
try{$("modeDialog").showModal();}catch(error){showResourceError(`模式选择打开失败：${error.message}`);throw error;}

// Expose rule helpers for the lightweight test page / console diagnostics.
window.Mahjong={
  makeWall,isWinning,chiPatterns,isQiDui,isHaoQiDui,isStanding,isJiaHu,isPiaoHu,isPiaoDing,
  detectPattern,canChangchunWin,evaluateChangchunWin,getLegalWaits,detectStartEggs,canAddEgg,
  determineBaopai,isDuiBao,isMoBao,computeScore,patternBase,shortName
};
window.MahjongLive={
  protocolVersion:ONLINE_PROTOCOL,rulesVersion:RULES.version,guestInput,
  setController:setOnlineController,setNames:setOnlineNames,startMatch,nextHand,
  snapshotFor:onlineSnapshotFor,applySnapshot:applyOnlineSnapshot,
  resultPayload:onlineResultPayload,applyResult:applyOnlineResult,
  receiveInput:onlineReceiveInput,setPaused:setOnlinePaused,setGuestPaused,exportGame:exportHostGame,importGame:importHostGame,validSave:validHostGame,
  info:()=>({phase:state.phase,round:state.round,complete:state.match.complete,paused:state.onlinePaused})
};
