"use strict";

const TILE_NAMES = [
  "一万","二万","三万","四万","五万","六万","七万","八万","九万",
  "一筒","二筒","三筒","四筒","五筒","六筒","七筒","八筒","九筒",
  "一条","二条","三条","四条","五条","六条","七条","八条","九条",
  "东风","南风","西风","北风","红中","发财","白板"
];
const WINDS = ["东","南","西","北"];
const NAMES = ["你","阿岚","小满","老陈"];
// The four array indexes are the bottom, right, top and left seats on screen.
const SEAT_DIRECTIONS = ["south","east","north","west"];
const TILE_FILES = [
  ...Array.from({length:9},(_,i)=>`Man${i+1}`),
  ...Array.from({length:9},(_,i)=>`Pin${i+1}`),
  ...Array.from({length:9},(_,i)=>`Sou${i+1}`),
  "Ton","Nan","Shaa","Pei","Chun","Hatsu","Haku"
];
const SOUND_FILES={draw:"draw.wav",discard:"discard.wav",peng:"peng.wav",gang:"gang.wav",win:"win.wav",drawgame:"drawgame.wav"};
const soundCache={};

const state = {
  wall: [], hands: [[],[],[],[]], melds: [[],[],[],[]], discards: [],
  dealer: 0, current: 0, phase: "idle", lastDiscard: null, drawnIndex: null,
  selectedTile: null, selectedIndex: null,
  // round doubles as a generation token: callbacks from an older hand must never
  // change a newer hand after the user starts over.
  round: 0, sound: true, volume: .55, timers: new Set(), pending: null,
  tenpaiSignature: null, tenpaiTiles: new Set(),
  // 长春麻将状态。听牌信息只保存普通数组，既方便渲染，也避免 Set 在
  // 调试序列化时丢失内容。
  ting: [null,null,null,null], lastDrawn: [null,null,null,null],
  baopai: null, baopaiRevealed: [false,false,false,false], baopaiCandidates: [], baopaiPending: false,
  eggs: [[],[],[],[]], eggDrawn: [[],[],[],[]],
  scores: [0,0,0,0], pendingDraw: null,
  firstDrawDone: [false,false,false,false], firstDiscardDone: [false,false,false,false],
  baoViewReady: [false,false,false,false]
};

const $ = (id) => document.getElementById(id);
const tileCount = (hand, id) => hand.filter(t => t === id).length;
const sortHand = hand => hand.sort((a,b) => a-b);
const isSuit = tile => tile >= 0 && tile < 27;
const isTerminalOrHonor = tile => tile >= 27 || (tile >= 0 && tile % 9 !== 4 && (tile % 9 === 0 || tile % 9 === 8));
const isSelfDraw = method => method === "自摸" || method === "self";
const meldTiles = melds => melds.flatMap(m => m.tiles);
const isWildcardChick = egg => egg.tiles.includes(18)&&egg.type!=="big";
// Starting eggs leave the hand. They occupy a completed group for hand-shape
// checks, while standard kongs are already represented in state.melds.
function shapeMelds(player) {
  return [...state.melds[player],...state.eggs[player]
    .filter(egg=>!egg.standardGang)
    .map(egg=>({type:"egg",eggType:egg.type,tiles:isWildcardChick(egg)?egg.tiles.filter(tile=>tile!==18):egg.tiles}))];
}

function tileInHandWithoutWin(hand, tile) {
  const copy=[...hand], index=copy.lastIndexOf(tile);
  if(index >= 0) copy.splice(index,1);
  return copy;
}

function hasAllThreeSuits(hand, melds=[]) {
  const suits=new Set([...hand,...meldTiles(melds)].filter(isSuit).map(tile=>Math.floor(tile/9)));
  return suits.size===3;
}

function hasYaoJiu(hand, melds=[]) {
  return [...hand,...meldTiles(melds)].some(isTerminalOrHonor);
}

function hasDragon(hand, melds=[]) {
  return [...hand,...meldTiles(melds)].some(tile=>tile >= 31);
}

function hasKong(melds=[]) { return melds.some(m=>m.type === "gang"); }

function playerHasNineEgg(player) {
  return state.eggs[player]?.some(egg=>egg.type === "nine");
}

function later(callback, delay) {
  const id=setTimeout(()=>{
    state.timers.delete(id);
    callback();
  },delay);
  state.timers.add(id);
  return id;
}

function clearGameTimers() {
  state.timers.forEach(clearTimeout);
  state.timers.clear();
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
  if (opts.back) return `<span class="tile back${small}"><img src="assets/tiles/Back.svg" alt="牌背" draggable="false"></span>`;
  return `<span class="tile${small}${opts.latest?" latest":""}${related}" data-tile="${id}" title="${TILE_NAMES[id]}"><img src="assets/tiles/${TILE_FILES[id]}.svg" alt="${TILE_NAMES[id]}" draggable="false"></span>`;
}

function tileButtonHTML(id, index, drawn=false) {
  const disabled=state.phase!=="discard"||state.current!==0||state.hands[0].length%3!==2;
  const classes=`tile${drawn?" drawn":""}${disabled?" disabled":""}`;
  const hint=disabled?"当前不是你的回合，请等待":"点击选中，再点一次打出";
  return `<button class="${classes}" data-tile="${id}" data-index="${index}" title="${hint}${disabled?"":TILE_NAMES[id]}" aria-label="${hint}${disabled?"":TILE_NAMES[id]}" ${disabled?"disabled":""}><img src="assets/tiles/${TILE_FILES[id]}.svg" alt="${TILE_NAMES[id]}" draggable="false"></button>`;
}

function startGame() {
  clearGameTimers();
  state.round++;
  state.wall=makeWall(); state.hands=[[],[],[],[]]; state.melds=[[],[],[],[]]; state.discards=[];
  state.dealer = state.round===1 ? 0 : Math.floor(Math.random()*4);
  state.current=state.dealer; state.phase="dealing"; state.lastDiscard=null; state.drawnIndex=null; state.selectedTile=null; state.selectedIndex=null; state.pending=null;
  state.ting=[null,null,null,null]; state.lastDrawn=[null,null,null,null]; state.baopai=null;
  state.baopaiRevealed=[false,false,false,false]; state.baopaiCandidates=[]; state.baopaiPending=false;
  state.eggs=[[],[],[],[]]; state.eggDrawn=[[],[],[],[]]; state.pendingDraw=null;
  state.firstDrawDone=[false,false,false,false]; state.firstDiscardDone=[false,false,false,false];
  state.baoViewReady=[false,false,false,false];
  state.tenpaiSignature=null; state.tenpaiTiles=new Set();
  $("resultDialog").close();
  $("scoreboardDialog").close();
  // Traditional packet order: four tiles at a time for three rounds, then one each.
  for (let packet=0; packet<3; packet++) for (let offset=0; offset<4; offset++) {
    const p=(state.dealer+offset)%4;
    for(let n=0;n<4;n++) state.hands[p].push(state.wall.shift());
  }
  for (let offset=0; offset<4; offset++) state.hands[(state.dealer+offset)%4].push(state.wall.shift());
  state.hands.forEach(sortHand);
  const dealerDraw=state.wall.shift();
  state.hands[state.dealer].push(dealerDraw);
  state.lastDrawn[state.dealer]=dealerDraw;
  state.firstDrawDone[state.dealer]=true;
  if(state.dealer===0) state.drawnIndex=state.hands[0].length-1;
  state.phase="discard";
  setStatus(`${NAMES[state.dealer]}坐庄，庄家先出牌`);
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
    wind.textContent=WINDS[(p-state.dealer+4)%4];
    wind.dataset.player=String(p);
    wind.classList.toggle("active",state.current===p&&state.phase!=="gameover");
    wind.classList.toggle("dealer-seat",p===state.dealer);
    wind.classList.toggle("self-wind",p===0);
  }
  for(let p=0;p<4;p++) renderPlayer(p);
  for(let p=0;p<4;p++) renderRiver(p);
  renderBaoPanel();
  refreshTileHighlights();
}

function renderBaoPanel() {
  const panel=$("baoPanel");
  if(!panel) return;
  const mode=state.baopai===null?"empty":state.baopaiRevealed[0]?`face:${state.baopai}`:"back";
  if(panel.dataset.mode===mode) return;
  panel.dataset.mode=mode;
  $("baoTile").innerHTML=mode==="empty"?'<span class="bao-placeholder" aria-label="尚未打宝"></span>'
    :mode==="back"?tileHTML(0,{back:true,small:true}):tileHTML(state.baopai,{small:true});
}

function renderRiver(p) {
  const el=$(`river${p}`), river=state.discards.filter(d=>d.player===p);
  const cache=el.__riverCache??={signature:null};
  el.__riverCache=cache;
  const signature=river.map(d=>`${d.player}:${d.tile}`).join(",");
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
  const tingLabel=ting?`<span class="ting-badge">已报听</span>`:"";
  const seenBao=state.baopai!==null&&state.baopaiRevealed[p];
  const baoLabel=seenBao?'<span class="seen-bao-badge" title="这家已看宝">已看宝</span>':"";
  const badgeMarkup=`<div class="player-badge ${current?"current":""}"><span class="avatar">${NAMES[p][0]}</span><span>${NAMES[p]}</span><span>${WINDS[(p-state.dealer+4)%4]}家</span>${p===state.dealer?'<span class="dealer">庄</span>':""}${tingLabel}${baoLabel}</div>`;
  if(slots.badgeMarkup!==badgeMarkup) {
    slots.badge.innerHTML=badgeMarkup;
    slots.badgeMarkup=badgeMarkup;
  }
  if(p===0) renderOwnWaits(slots,ting);

  const eggSignature=JSON.stringify([state.eggs[p],state.melds[p].filter(m=>m.type==="gang")]);
  if(slots.eggSignature!==eggSignature) {
    const eggNames={threeWinds:"三风蛋",joy:"喜蛋",ones:"幺蛋",nine:"9蛋",big:"大蛋",mingGang:"明杠",anGang:"暗杠"};
    const displayedEggs=[...state.eggs[p]];
    const recordedKongs=new Map();
    state.eggs[p].filter(egg=>egg.standardGang).forEach(egg=>recordedKongs.set(egg.tiles[0],(recordedKongs.get(egg.tiles[0])||0)+1));
    state.melds[p].filter(m=>m.type==="gang").forEach(m=>{
      const count=recordedKongs.get(m.tiles[0])||0;
      if(count) recordedKongs.set(m.tiles[0],count-1);
      else displayedEggs.push({type:"mingGang",tiles:m.tiles,standardGang:true});
    });
    slots.eggs.innerHTML=displayedEggs.length
      ? `<div class="egg-row" aria-label="${NAMES[p]}的蛋杠区">${displayedEggs.map(egg=>`<div class="egg-group ${egg.type}" data-label="${eggNames[egg.type]||"蛋"}">${egg.tiles.map(t=>tileHTML(t,{small:p!==0})).join("")}</div>`).join("")}</div>`
      : "";
    slots.eggSignature=eggSignature;
    slots.eggs.querySelectorAll(".tile").forEach(tile=>tile.addEventListener("click",()=>selectTile(+tile.dataset.tile)));
  }
  slots.eggs.classList.toggle("empty",state.eggs[p].length===0&&!state.melds[p].some(m=>m.type==="gang"));
  slots.eggs.querySelectorAll(".tile[data-tile]").forEach(tile=>tile.classList.toggle("related",+tile.dataset.tile===state.selectedTile));

  // The meld DOM is stable across unrelated turns. Recreating it on every discard
  // caused cached SVGs to blink, especially after a player had called chi or peng.
  const meldSignature=JSON.stringify(state.melds[p]);
  if(slots.meldSignature!==meldSignature) {
    const meldLabels={chi:"吃",peng:"碰",gang:"杠"};
    slots.melds.innerHTML=`<div class="meld-row" aria-label="${NAMES[p]}的吃碰区">${state.melds[p].filter(m=>m.type!=="gang").map(m=>`<div class="meld-group ${m.type}" data-label="${meldLabels[m.type]}">${m.tiles.map(t=>tileHTML(t,{small:p!==0})).join("")}</div>`).join("")}</div>`;
    slots.meldSignature=meldSignature;
    slots.melds.querySelectorAll(".tile").forEach(tile=>tile.addEventListener("click",()=>selectTile(+tile.dataset.tile)));
  }
  slots.melds.classList.toggle("empty",!state.melds[p].some(m=>m.type!=="gang"));
  slots.melds.querySelectorAll(".tile[data-tile]").forEach(tile=>tile.classList.toggle("related",+tile.dataset.tile===state.selectedTile));

  if(p===0) {
    const regular=state.hands[0].map((t,i)=>({t,i})).filter(x=>x.i!==state.drawnIndex).sort((a,b)=>a.t-b.t);
    const drawn=state.drawnIndex!==null&&state.hands[0][state.drawnIndex]!==undefined?tileButtonHTML(state.hands[0][state.drawnIndex],state.drawnIndex,true):"";
    const handMarkup=`<div class="hand-row">${regular.map(x=>tileButtonHTML(x.t,x.i)).join("")}${drawn}</div>`;
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
  const riverCount=state.discards.filter(discard=>discard.tile===tile).length;
  const meldCount=state.melds.flatMap(melds=>melds.flatMap(meld=>meld.tiles)).filter(value=>value===tile).length;
  // 标准杠已经在副露区计过一次，蛋区不能重复扣除。
  const eggCount=state.eggs.flatMap(eggs=>eggs.filter(egg=>!egg.standardGang).flatMap(egg=>egg.tiles)).filter(value=>value===tile).length;
  return riverCount+meldCount+eggCount;
}

function ownWaits() {
  if(!state.ting[0]) return [];
  return state.ting[0].waitTiles.map(tile=>({tile,remaining:Math.max(0,4-visibleTileCount(tile)-tileCount(state.hands[0],tile))}));
}

function renderOwnWaits(slots,ting) {
  const waits=ting?ownWaits():[];
  const markup=waits.length?`<div class="own-waits" aria-label="你的胡牌剩余张数"><span>听牌 · 按明牌估算</span>${waits.map(({tile,remaining})=>`<span>${shortName(tile)} <b>${remaining}张</b></span>`).join("")}</div>`:"";
  if(slots.waitMarkup!==markup) {
    slots.waits.innerHTML=markup;
    slots.waitMarkup=markup;
  }
}

function selectTile(tile) {
  state.selectedTile=state.selectedTile===tile?null:tile;
  state.selectedIndex=null;
  refreshTileHighlights();
}

function handleHandClick(tile,index) {
  if(state.phase!=="discard"||state.current!==0||state.hands[0].length%3!==2)return;
  if(state.selectedIndex===index)return humanDiscard(index);
  state.selectedTile=tile;state.selectedIndex=index;
  refreshTileHighlights();
  const tingCandidate=getSelectedTingCandidate(0);
  if(tingCandidate&&!tingCandidate.reportAllowed) setStatus("断幺九听：只能胡幺九，不能报听或看宝");
  updateActions();
}

function refreshTileHighlights() {
  const canDiscard=state.phase==="discard"&&state.current===0&&state.hands[0].length%3===2;
  const tenpaiTiles=canDiscard?getTenpaiTiles():new Set();
  document.querySelectorAll(".tile[data-tile]").forEach(el=>{
    const same=+el.dataset.tile===state.selectedTile;
    el.classList.toggle("related",same);
    if(el.tagName==="BUTTON") {
      el.classList.toggle("selected",+el.dataset.index===state.selectedIndex);
      el.classList.toggle("tenpai",tenpaiTiles.has(+el.dataset.tile));
    }
  });
}

function setStatus(text) { $("statusText").textContent=text; }
function renderScoreboard() {
  $("scoreboardRound").textContent=`第 ${state.round} 局 · 本局${NAMES[state.dealer]}坐庄 · 累计分`;
  $("scoreboardRows").innerHTML=state.scores.map((score,player)=>`<div class="scoreboard-row"><span>${NAMES[player]}${player===state.dealer?" · 庄":""}</span><strong class="${score>0?"gain":score<0?"loss":""}">${score>0?"+":""}${score}</strong></div>`).join("");
}
function setActions(actions=[]) {
  const pass=actions.find(a=>a.kind==="pass"), options=actions.filter(a=>a.kind!=="pass");
  $("actionBar").classList.toggle("empty",actions.length===0);
  $("actionOptions").innerHTML=options.map((a,i)=>`<button class="action-btn ${a.kind||""}" data-action="${i}">${a.label}</button>`).join("");
  $("actionOptions").querySelectorAll("button").forEach((b,i)=>b.onclick=options[i].run);
  $("passBtn").hidden=!pass;$("passBtn").onclick=pass?.run||null;
}

function updateActions() {
  if(state.phase!=="discard" || state.current!==0) return setActions();
  const actions=[];
  const canDiscard=state.hands[0].length%3===2;
  const analysis=canDiscard?evaluateChangchunWin(0,state.hands[0],state.lastDrawn[0],"自摸"):{legal:false};
  if(analysis.legal) actions.push({label:"胡",kind:"hu",run:()=>finishWin(0,"自摸",state.hands[0])});
  const reported=state.ting[0];
  if(!reported) {
    eggActions(0).forEach(egg=>actions.push({label:`下${egg.label}`,run:()=>executeEgg(0,egg.type,egg.tiles)}));
    eggSupplementOptions(0).forEach(({tile,eggIndex})=>actions.push({label:`补${eggTypeName(state.eggs[0][eggIndex].type)} ${shortName(tile)}`,run:()=>addEggTile(0,tile,eggIndex)}));
    if(canDiscard) {
      concealedKongs(0).forEach(id=>actions.push({label:`暗杠 ${shortName(id)}`,run:()=>selfKong(id,false)}));
      addedKongs(0).forEach(id=>actions.push({label:`补杠 ${shortName(id)}`,run:()=>selfKong(id,true)}));
    } else if(state.eggs[0].some(egg=>egg.type==="big")) {
      actions.push({label:"结束下蛋 · 本回合不出牌",run:()=>finishEggTurn(0)});
    }
  } else {
    if(state.baopai!==null&&state.baoViewReady[0]&&!state.baopaiRevealed[0]) actions.push({label:"看宝",run:()=>revealBaopai(0)});
  }
  setActions(actions);
}

function humanDiscard(index,reporting=false) {
  if(state.phase!=="discard" || state.current!==0) return;
  if(state.hands[0].length%3!==2) { setStatus("大蛋起手不补牌，本回合请先结束下蛋"); return; }
  if(index<0 || index>=state.hands[0].length) return;
  if(state.ting[0] && !reporting && index!==state.drawnIndex) {
    setStatus("报听后只能打出刚摸到的牌"); beep(180,.05); return;
  }
  const tile=state.hands[0].splice(index,1)[0];
  state.drawnIndex=null; state.lastDrawn[0]=null; state.selectedTile=null; state.selectedIndex=null; sortHand(state.hands[0]);
  performDiscard(0,tile);
}

function performDiscard(player,tile) {
  state.firstDiscardDone[player]=true;
  state.phase="claim"; state.lastDiscard={player,tile}; state.discards.push({player,tile});
  checkBaopaiReplace();
  setStatus(`${NAMES[player]}打出 ${TILE_NAMES[tile]}`); playSound("discard"); beep(240,.035); render(); triggerDiscardIndicator(player); setActions();
  if(player===0&&!state.ting[0]) {
    const waitTiles=getLegalWaits(0,state.hands[0]);
    if(waitTiles.length&&hasYaoJiu(state.hands[0],shapeMelds(0))) {
      const afterChoice=()=>resolveClaims(player,tile);
      state.pending={onPass:afterChoice};
      setActions([
        {label:`报听 · ${waitTiles.length}种`,kind:"ting",run:()=>{
          if(!state.pending||state.phase!=="claim") return;
          state.pending=null; declareTing(0,{waitTiles,reportAllowed:true,tile});
          setActions(); render(); afterChoice();
        }},
        {label:"暂不报听",kind:"pass",run:()=>{
          if(!state.pending||state.phase!=="claim") return;
          state.pending=null; setActions(); afterChoice();
        }}
      ]);
      setStatus(`打出${shortName(tile)}后已听牌，现在可以报听`);
      return;
    }
  }
  const round=state.round;
  later(()=>{
    if(state.round===round) resolveClaims(player,tile);
  },player===0?350:650);
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

function claimOptions(discarder,tile) {
  const options=[];
  for(let step=1;step<4;step++) {
    const p=(discarder+step)%4, test=sortHand([...state.hands[p],tile]);
    const unreportedWait=!state.ting[p]&&getLegalWaits(p,state.hands[p]).includes(tile);
    if(evaluateChangchunWin(p,test,tile,"点炮",{allowUnreportedWin:unreportedWait}).legal) options.push({p,type:"hu",priority:3,step});
    if(state.ting[p]) continue;
    const count=tileCount(state.hands[p],tile);
    if(count>=3) options.push({p,type:"gang",priority:2,step});
    if(count>=2) options.push({p,type:"peng",priority:2,step});
  }
  const next=(discarder+1)%4;
  if(!state.ting[next]) chiPatterns(state.hands[next],tile).forEach(pattern=>options.push({p:next,type:"chi",priority:1,step:1,pattern}));
  return options;
}

function resolveClaims(discarder,tile) {
  if(state.phase!=="claim") return;
  const options=claimOptions(discarder,tile);
  const human=options.filter(o=>o.p===0);
  const ai=options.filter(o=>o.p!==0);
  const aiHu=ai.filter(o=>o.type==="hu").sort((a,b)=>a.step-b.step)[0];
  const humanHu=human.find(o=>o.type==="hu");
  if(aiHu&&(!humanHu||aiHu.step<humanHu.step)) return finishWin(aiHu.p,"点炮",[...state.hands[aiHu.p],tile]);
  if(aiHu&&humanHu) {
    return promptClaims(human,()=>finishWin(aiHu.p,"点炮",[...state.hands[aiHu.p],tile]),{aiHu});
  }
  resolveNormalClaims(human,ai,discarder,tile);
}

function resolveNormalClaims(human,ai,discarder,tile) {
  // AI does not call every possible set: this keeps its hand reasonably flexible.
  const aiEligible=ai.filter(o=>o.type!=="hu" && (o.type==="gang" || (o.type==="peng"&&Math.random()<.7) || (o.type==="chi"&&Math.random()<.48)));
  aiEligible.sort((a,b)=>b.priority-a.priority||a.step-b.step);
  const aiBest=aiEligible[0];
  let shown=[...human];
  if(aiBest) shown=shown.filter(o=>o.type==="hu"||o.priority>aiBest.priority || (o.priority===aiBest.priority&&o.step<aiBest.step));
  // Avoid duplicate peng when gang is available; player may still choose the gang.
  const onPass=()=>aiBest?executeClaim(aiBest,discarder,tile):advanceAfterDiscard(discarder);
  if(shown.length) return promptClaims(shown,onPass);
  if(aiBest) return executeClaim(aiBest,discarder,tile);
  advanceAfterDiscard(discarder);
}

function promptClaims(options,onPass,context={}) {
  state.pending={options,onPass};
  const labels={hu:"胡",gang:"杠",peng:"碰",chi:"吃"};
  const actions=options.map(o=>({label:o.type==="chi"?`吃 ${o.pattern.map(shortName).join("")}`:labels[o.type],kind:o.type==="hu"?"hu":"",run:()=>{
    const discarded=state.lastDiscard, next=state.pending?.onPass;
    state.pending=null;
    if(o.type==="hu") finishWin(0,"点炮",[...state.hands[0],discarded.tile]);
    else if(context.aiHu) { setActions(); finishWin(context.aiHu.p,"点炮",[...state.hands[context.aiHu.p],discarded.tile]); }
    else executeClaim(o,discarded.player,discarded.tile);
  }}));
  actions.push({label:"过",kind:"pass",run:()=>{const cb=state.pending?.onPass;state.pending=null;setActions();cb?.();}});
  setActions(actions); setStatus(`可以${[...new Set(options.map(o=>labels[o.type]))].join(" / ")}`); beep(660,.06);
}

function executeClaim(option,discarder,tile) {
  if(state.phase!=="claim") return;
  const p=option.p; state.discards.pop(); state.current=p; state.lastDiscard=null; state.drawnIndex=null; state.selectedTile=null; state.selectedIndex=null;
  if(option.type==="chi") {
    const needed=[...option.pattern]; needed.splice(needed.indexOf(tile),1);
    needed.forEach(t=>removeTile(state.hands[p],t));
    state.melds[p].push({type:"chi",tiles:[...option.pattern]});
  } else {
    const n=option.type==="gang"?3:2;
    for(let i=0;i<n;i++) removeTile(state.hands[p],tile);
    state.melds[p].push({type:option.type,tiles:Array(n+1).fill(tile)});
    if(option.type==="gang") state.eggs[p].push({type:"mingGang",tiles:Array(4).fill(tile),standardGang:true});
  }
  sortHand(state.hands[p]); playSound(option.type==="gang"?"gang":"peng"); beep(option.type==="gang"?520:400,.08);
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
  if(!state.wall.length) return finishDraw();
  if(state.baopaiPending&&state.baopai===null) {
    determineBaopai();
    renderBaoPanel();
  }
  if(player===0&&state.ting[0]&&state.baopai!==null&&!state.baopaiRevealed[0]) {
    state.baoViewReady[0]=true;
    state.pendingDraw={player,kongReplacement,round:state.round};
    state.phase="baoReveal"; state.current=player;
    setStatus("轮到你摸牌：请先看宝，再继续摸牌");
    setActions([{label:"看宝并继续摸牌",kind:"ting",run:()=>revealBaopai(0)}]);
    render();
    return;
  }
  const tile=kongReplacement?state.wall.pop():state.wall.shift();
  state.hands[player].push(tile);
  state.firstDrawDone[player]=true;
  if(state.ting[player]) {
    state.baoViewReady[player]=true;
    if(player!==0&&state.baopai!==null&&!state.baopaiRevealed[player]) state.baopaiRevealed[player]=true;
  }
  if(player!==0) sortHand(state.hands[player]);
  state.current=player; state.lastDiscard=null;
  state.lastDrawn[player]=tile;
  state.drawnIndex=player===0?state.hands[0].length-1:null;
  // Set the actionable state before rendering. Otherwise human tiles are rendered
  // disabled during "drawing" and remain disabled until the next full render.
  state.phase="discard";
  setStatus(`${NAMES[player]}${kongReplacement?"杠后补牌":"摸牌"}`); playSound("draw"); render();
  if(evaluateChangchunWin(player,state.hands[player],tile,"自摸").legal) {
    if(player===0){updateActions();return;}
    const round=state.round, winningHand=[...state.hands[player]];
    return later(()=>{
      if(state.round===round&&state.phase==="discard"&&state.current===player) finishWin(player,"自摸",winningHand);
    },650);
  }
  if(player===0) updateActions(); else scheduleAI();
}

function scheduleAI() {
  if(state.phase!=="discard" || state.current===0) return;
  setActions();
  const round=state.round;
  later(()=>{
    if(state.round!==round||state.phase!=="discard" || state.current===0) return;
    const p=state.current;
    if(state.ting[p]) {
      const drawnIndex=state.hands[p].lastIndexOf(state.lastDrawn[p]);
      const tile=state.hands[p].splice(drawnIndex>=0?drawnIndex:state.hands[p].length-1,1)[0];
      state.lastDrawn[p]=null;
      return performDiscard(p,tile);
    }
    const egg=eggActions(p)[0];
    if(egg&&Math.random()<.18) return executeEgg(p,egg.type,egg.tiles);
    const supplement=eggSupplementOptions(p)[0];
    if(supplement&&Math.random()<.35) return addEggTile(p,supplement.tile,supplement.eggIndex);
    if(state.hands[p].length%3!==2) return finishEggTurn(p);
    const kongs=concealedKongs(p);
    if(kongs.length && Math.random()<.7) return selfKong(kongs[0],false);
    let index=chooseAIDiscard(state.hands[p]);
    const tingCandidate=getTingCandidates(p).find(candidate=>candidate.index===index&&candidate.reportAllowed)
      || getTingCandidates(p).find(candidate=>candidate.reportAllowed);
    if(tingCandidate&&Math.random()<.72) {
      index=tingCandidate.index;
      declareTing(p,tingCandidate);
    }
    const tile=state.hands[p].splice(index,1)[0]; performDiscard(p,tile);
  },700);
}

function chooseAIDiscard(hand) {
  let worst=0,worstScore=Infinity;
  hand.forEach((t,i)=>{
    let score=(tileCount(hand,t)-1)*4;
    if(t<27){const n=t%9; if(n>0&&hand.includes(t-1))score+=2;if(n<8&&hand.includes(t+1))score+=2;if(n>1&&hand.includes(t-2))score+=.7;if(n<7&&hand.includes(t+2))score+=.7;score+=(4-Math.abs(4-n))*.12;}
    else score-=.2;
    if(score<worstScore){worstScore=score;worst=i;}
  });
  return worst;
}

function concealedKongs(p){ return [...new Set(state.hands[p])].filter(t=>tileCount(state.hands[p],t)===4); }
function addedKongs(p){ return state.melds[p].filter(m=>m.type==="peng"&&state.hands[p].includes(m.tiles[0])).map(m=>m.tiles[0]); }
function selfKong(tile,added) {
  const p=state.current;if(state.phase!=="discard")return;
  if(state.ting[p]) { setStatus("报听后不能换牌或杠牌"); return; }
  // 补杠先给其余三家一次抢胡机会；没有人胡才真正落杠。
  if(added) return beginAddedKong(p,tile);
  for(let i=0;i<4;i++)removeTile(state.hands[p],tile);
  state.melds[p].push({type:"gang",tiles:[tile,tile,tile,tile]});
  state.eggs[p].push({type:"anGang",tiles:Array(4).fill(tile),standardGang:true});
  setStatus(`${NAMES[p]}暗杠 ${TILE_NAMES[tile]}`);playSound("gang");beep(520,.08);render();drawTile(p,true);
}

function beginAddedKong(player,tile) {
  state.phase="claim"; state.lastDiscard={player,tile,kong:true};
  const wins=[];
  for(let step=1;step<4;step++) {
    const claimant=(player+step)%4;
    if(state.ting[claimant]&&evaluateChangchunWin(claimant,[...state.hands[claimant],tile],tile,"点炮").legal) wins.push({p:claimant,step});
  }
  const human=wins.find(win=>win.p===0), ai=wins.find(win=>win.p!==0);
  const complete=()=>completeAddedKong(player,tile);
  if(human) {
    state.pending={onPass:()=>ai?finishWin(ai.p,"点炮",[...state.hands[ai.p],tile]):complete()};
    setActions([
      {label:"抢杠胡",kind:"hu",run:()=>{state.pending=null;finishWin(0,"点炮",[...state.hands[0],tile]);}},
      {label:"过",kind:"pass",run:()=>{const next=state.pending?.onPass;state.pending=null;setActions();next?.();}}
    ]);
    setStatus("可抢杠胡"); beep(660,.06); render(); return;
  }
  if(ai) return finishWin(ai.p,"点炮",[...state.hands[ai.p],tile]);
  complete();
}

function completeAddedKong(player,tile) {
  if(state.phase!=="claim") return;
  removeTile(state.hands[player],tile);
  const meld=state.melds[player].find(m=>m.type==="peng"&&m.tiles[0]===tile);
  if(!meld) return;
  meld.type="gang"; meld.tiles.push(tile);
  state.eggs[player].push({type:"mingGang",tiles:Array(4).fill(tile),standardGang:true});
  state.lastDiscard=null; state.phase="discard"; state.current=player;
  setStatus(`${NAMES[player]}补杠 ${TILE_NAMES[tile]}`);playSound("gang");beep(520,.08);render();drawTile(player,true);
}

function chiPatterns(hand,tile) {
  if(tile>=27)return[]; const n=tile%9, patterns=[];
  [[-2,-1],[-1,1],[1,2]].forEach(([a,b])=>{if(n+a>=0&&n+b<=8&&hand.includes(tile+a)&&hand.includes(tile+b))patterns.push([tile+a,tile,tile+b].sort((x,y)=>x-y));});
  return patterns;
}

function isWinning(hand,openMelds=0) {
  if((hand.length-2)%3!==0)return false;
  if(openMelds===0&&isQiDui(hand))return true;
  return isWinningStandard(hand,openMelds);
}

function isWinningStandard(hand,openMelds=0) {
  const need=4-openMelds;if(hand.length!==need*3+2)return false;
  const counts=Array(34).fill(0);hand.forEach(t=>counts[t]++);
  for(let pair=0;pair<34;pair++)if(counts[pair]>=2){counts[pair]-=2;if(canFormMelds(counts,need))return true;counts[pair]+=2;}
  return false;
}

function isQiDui(hand) {
  if(hand.length!==14) return false;
  const counts=Array(34).fill(0); hand.forEach(tile=>counts[tile]++);
  return counts.every(count=>count===0||count===2||count===4) && counts.reduce((sum,count)=>sum+count/2,0)===7;
}

function isHaoQiDui(hand) {
  if(!isQiDui(hand)) return false;
  return hand.some(tile=>tileCount(hand,tile)===4);
}

function isStanding(melds=[]) { return !melds.some(m=>m.type==="chi"||m.type==="peng"); }

function canWinWithPair(hand, openMelds, pair) {
  const need=4-openMelds, counts=Array(34).fill(0); hand.forEach(tile=>counts[tile]++);
  if(counts[pair]<2) return false;
  counts[pair]-=2;
  return canFormMelds(counts,need);
}

function canWinByCompletingPair(hand, openMelds, winTile) {
  const before=tileInHandWithoutWin(hand,winTile);
  return tileCount(before,winTile)===1&&canWinWithPair(hand,openMelds,winTile);
}

function canWinWithMiddleSequence(hand, openMelds, tile) {
  if(tile<1||tile>=26||tile%9===0||tile%9===8) return false;
  // The winning tile may be the second copy of this rank. What matters is
  // whether one copy can complete the middle of a valid sequence partition.
  const need=4-openMelds, counts=Array(34).fill(0); hand.forEach(id=>counts[id]++);
  if(need<1||!counts[tile-1]||!counts[tile]||!counts[tile+1]) return false;
  counts[tile-1]--; counts[tile]--; counts[tile+1]--;
  for(let pair=0;pair<34;pair++) if(counts[pair]>=2) {
    counts[pair]-=2;
    if(canFormMelds(counts,need-1)) { counts[pair]+=2; return true; }
    counts[pair]+=2;
  }
  return false;
}

function isJiaHu(hand, melds=[], winTile) {
  const before=[...tileInHandWithoutWin(hand,winTile),...meldTiles(melds)];
  // 断幺九时只能用幺九和牌，此情形按夹胡计算。
  if(!before.some(isTerminalOrHonor)&&isTerminalOrHonor(winTile)) return true;
  const openMelds=melds.length;
  return canWinByCompletingPair(hand,openMelds,winTile)||canWinWithMiddleSequence(hand,openMelds,winTile);
}

function allTripletPartition(hand, melds=[]) {
  if(melds.some(m=>m.type==="chi"||(m.type==="egg"&&m.eggType!=="big"))) return false;
  const need=4-melds.length, counts=Array(34).fill(0); hand.forEach(tile=>counts[tile]++);
  if(hand.length!==need*3+2) return false;
  for(let pair=0;pair<34;pair++) if(counts[pair]>=2) {
    counts[pair]-=2;
    const complete=counts.every(count=>count%3===0);
    counts[pair]+=2;
    if(complete) return true;
  }
  return false;
}

function isPiaoHu(hand, melds=[]) {
  return !(melds.length===0&&isQiDui(hand))&&allTripletPartition(hand,melds);
}

function isPiaoDing(hand, melds=[], winTile) {
  return hand.length===2&&isPiaoHu(hand,melds)&&canWinByCompletingPair(hand,melds.length,winTile);
}

function patternBase(type, standing) {
  const base={ping:0,jia:1,piao:2,piaoding:3,qidui:3,haoqidui:4};
  if(type==="qidui"||type==="haoqidui") return base[type];
  return base[type]+(standing?1:0);
}

function patternName(type) {
  return {ping:"平胡",jia:"夹胡",piao:"飘胡",piaoding:"飘顶",qidui:"七对",haoqidui:"豪华七对"}[type]||"平胡";
}

function detectPattern(hand, melds=[], winTile, method="自摸") {
  const standing=isStanding(melds);
  let type="ping";
  if(isSelfDraw(method)&&melds.length===0&&isHaoQiDui(hand)) type="haoqidui";
  else if(isSelfDraw(method)&&melds.length===0&&isQiDui(hand)) type="qidui";
  else if(isPiaoDing(hand,melds,winTile)) type="piaoding";
  else if(isPiaoHu(hand,melds)) type="piao";
  else if(isJiaHu(hand,melds,winTile)) type="jia";
  return {type,name:patternName(type),open:!standing,standing,baseFans:patternBase(type,standing),extra:[]};
}

function hasATriplet(hand,melds=[]) {
  if(melds.some(m=>m.type==="peng"||m.type==="gang")) return true;
  const need=4-melds.length, counts=Array(34).fill(0); hand.forEach(tile=>counts[tile]++);
  for(let pair=0;pair<34;pair++) if(counts[pair]>=2) {
    counts[pair]-=2;
    if(hasTripletMeld(counts,need)) { counts[pair]+=2; return true; }
    counts[pair]+=2;
  }
  return false;
}

function hasTripletMeld(counts,need) {
  if(need===0) return false;
  const tile=counts.findIndex(count=>count>0); if(tile<0) return false;
  if(counts[tile]>=3) {
    counts[tile]-=3;
    if(need===1||hasTripletMeld(counts,need-1)) { counts[tile]+=3; return true; }
    counts[tile]+=3;
  }
  if(tile<27&&tile%9<=6&&counts[tile+1]&&counts[tile+2]) {
    counts[tile]--;counts[tile+1]--;counts[tile+2]--;
    if(hasTripletMeld(counts,need-1)) { counts[tile]++;counts[tile+1]++;counts[tile+2]++;return true; }
    counts[tile]++;counts[tile+1]++;counts[tile+2]++;
  }
  return false;
}

function coreChangchunWin(player, hand, winTile, options={}) {
  const melds=shapeMelds(player);
  const eggs=state.eggs[player]||[];
  if(!isWinning(hand,melds.length)) return {legal:false};
  const qidui=melds.length===0&&isQiDui(hand);
  const standard=isWinningStandard(hand,melds.length);
  if(qidui&&!isSelfDraw(options.method)&&!standard) return {legal:false};
  const before=[...tileInHandWithoutWin(hand,winTile),...meldTiles(melds)];
  const silentYaoJiu=!before.some(isTerminalOrHonor);
  if(silentYaoJiu&&!isTerminalOrHonor(winTile)) return {legal:false};
  if(!playerHasNineEgg(player)&&!hasAllThreeSuits(hand,melds)) return {legal:false};
  if(!hasYaoJiu(hand,melds)) return {legal:false};
  if(standard&&!hasATriplet(hand,melds)&&!hasDragon(hand,melds)&&!hasKong(melds)&&eggs.length===0) return {legal:false};
  const ting=state.ting[player];
  if(!options.ignoreTing&&!options.forTenpai) {
    if(!ting&&!silentYaoJiu&&!options.allowUnreportedWin) return {legal:false};
    if(ting&&!ting.waitTiles.includes(winTile)) return {legal:false};
  }
  return {legal:true,hand,winTile,silentYaoJiu,moBao:false};
}

function evaluateChangchunWin(player, hand, winTile, method, options={}) {
  if(winTile===undefined||winTile===null) return {legal:false};
  const normal=coreChangchunWin(player,hand,winTile,{...options,method});
  if(normal.legal) return normal;
  // 摸到宝牌可把这张牌临时当作任意牌来检验胡型；点炮时不可摸宝。
  if(!options.disableBao&&isSelfDraw(method)&&state.ting[player]&&state.baopai===winTile) {
    const index=hand.lastIndexOf(winTile);
    for(let replacement=0;replacement<34;replacement++) {
      if(replacement===winTile) continue;
      const changed=[...hand]; changed[index]=replacement;
      const result=coreChangchunWin(player,changed,replacement,{...options,method,ignoreTing:true});
      if(result.legal) return {...result,moBao:true,actualWinTile:winTile};
    }
  }
  return {legal:false};
}

function canChangchunWin(player, hand, winTile, method, options={}) {
  return evaluateChangchunWin(player,hand,winTile,method,options).legal;
}

function getLegalWaits(player, hand) {
  const waits=[];
  for(let tile=0;tile<34;tile++) {
    if(tileCount(hand,tile)>=4) continue;
    // 七对仅限自摸，普通牌型可点炮或自摸，任一方式成立即为有效听牌。
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
  setStatus(`${NAMES[player]}报听，听${candidate.waitTiles.map(shortName).join("、")}`);
  return true;
}

function determineBaopai(roll=Math.floor(Math.random()*6)+1) {
  if(!state.wall.length) return null;
  const index=Math.max(0,state.wall.length-roll);
  state.baopai=state.wall[index];
  state.baopaiCandidates.push(state.baopai);
  state.baopaiPending=false;
  state.baopaiRevealed=[false,false,false,false];
  // 新宝对所有人先盖住；已报听者也要等自己的下一次摸牌回合。
  return state.baopai;
}

function revealBaopai(player) {
  if(!state.ting[player]||state.baopai===null||!state.baoViewReady[player]) return false;
  const allWithoutYao=[...state.hands[player],...meldTiles(shapeMelds(player))];
  if(!hasYaoJiu(allWithoutYao)) { setStatus("断幺九听牌不能看宝"); return false; }
  state.baopaiRevealed[player]=true;
  setStatus(`${NAMES[player]}已看宝牌`); render();
  const pendingDraw=state.pendingDraw;
  if(player===0&&pendingDraw) {
    state.pendingDraw=null;
    if(state.round===pendingDraw.round&&state.phase==="baoReveal") return drawTile(pendingDraw.player,pendingDraw.kongReplacement);
  }
  updateActions();
  return true;
}

function publicBaoCount() {
  if(state.baopai===null) return 0;
  return state.discards.filter(discard=>discard.tile===state.baopai).length
    + state.melds.flatMap(melds=>meldTiles(melds)).filter(tile=>tile===state.baopai).length
    + state.eggs.flatMap(eggs=>eggs.filter(egg=>!egg.standardGang).flatMap(egg=>egg.tiles)).filter(tile=>tile===state.baopai).length;
}

function checkBaopaiReplace() {
  if(state.baopai!==null&&publicBaoCount()>=3) determineBaopai();
}

function isDuiBao(winTile) { return state.baopai!==null&&state.baopai===winTile; }

function isMoBao(hand, winTile, player=state.current) {
  return evaluateChangchunWin(player,hand,winTile,"自摸").moBao===true;
}

function eggWildcardSet(hand, required) {
  const pool=[...hand], used=[];
  for(const tile of required) {
    let index=pool.indexOf(tile);
    if(index<0&&tile!==18) index=pool.indexOf(18);
    if(index<0) return null;
    used.push(pool.splice(index,1)[0]);
  }
  return used;
}

function detectStartEggs(hand) {
  const eggs=[];
  const winds=[27,28,29,30].filter(tile=>hand.includes(tile));
  // 幺鸡可替代三风蛋中任意缺风，最多用三张幺鸡组成一套。
  const windTiles=winds.slice(0,3), missing=3-windTiles.length;
  if(tileCount(hand,18)>=missing) eggs.push({type:"threeWinds",label:"三风蛋",tiles:[...windTiles,...Array(missing).fill(18)],concealed:true});
  const joy=eggWildcardSet(hand,[31,32,33]); if(joy) eggs.push({type:"joy",label:"喜蛋",tiles:joy,concealed:true});
  const ones=eggWildcardSet(hand,[0,9,18]); if(ones) eggs.push({type:"ones",label:"幺蛋",tiles:ones,concealed:true});
  const nines=eggWildcardSet(hand,[8,17,26]); if(nines) eggs.push({type:"nine",label:"9蛋",tiles:nines,concealed:true});
  [18,9,31,32,33].forEach(tile=>{
    if(tileCount(hand,tile)>=4) eggs.push({type:"big",label:"大蛋",tiles:Array(4).fill(tile),concealed:true});
  });
  return eggs;
}

function eggActions(player) {
  if(!state.firstDrawDone[player]||state.firstDiscardDone[player]) return [];
  const seen=new Set(state.eggs[player].map(egg=>`${egg.type}:${egg.tiles.join(",")}`));
  return detectStartEggs(state.hands[player]).filter(egg=>!seen.has(`${egg.type}:${egg.tiles.join(",")}`)&&state.melds[player].length+state.eggs[player].filter(item=>!item.standardGang).length<4);
}

function eggTypeName(type) {
  return {threeWinds:"三风蛋",joy:"喜蛋",ones:"幺蛋",nine:"9蛋",big:"大蛋"}[type]||"蛋";
}

function eggSupplementOptions(player) {
  const options=[];
  for(const tile of new Set(state.hands[player])) state.eggs[player].forEach((egg,eggIndex)=>{
    if(eggSupplementIndex(egg,tile)>=0) options.push({tile,eggIndex});
  });
  return options;
}

function canAddEgg(player,tile,eggIndex=null) {
  if(!state.hands[player].includes(tile)) return false;
  if(eggIndex!==null) return eggSupplementIndex(state.eggs[player][eggIndex],tile)>=0;
  return state.eggs[player].some(egg=>eggSupplementIndex(egg,tile)>=0);
}

function eggSupplementIndex(egg,tile) {
  if(!egg) return -1;
  const required={threeWinds:[27,28,29,30],joy:[31,32,33],ones:[0,9,18],nine:[8,17,26],big:[]}[egg.type];
  if(!required||!(tile===18||required.includes(tile))) return -1;
  // 补蛋追加实牌，不替换起手下蛋时亮出的牌。三风可补任意风，
  // 喜、幺、9 蛋可补本系列牌；幺鸡可补任何已下的蛋。
  return egg.tiles.length;
}

function drawEggReplacement(player) {
  if(!state.wall.length) return null;
  const tile=state.wall.pop();
  state.hands[player].push(tile); sortHand(state.hands[player]); state.lastDrawn[player]=tile;
  return tile;
}

function executeEgg(player,type,tiles) {
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
  setStatus(`${NAMES[player]}下${({threeWinds:"三风蛋",joy:"喜蛋",ones:"幺蛋",nine:"9蛋",big:"大蛋"}[type]||"蛋")}`);
  playSound("gang"); beep(520,.08); render();
  if(player===0) updateActions(); else scheduleAI();
  return true;
}

function addEggTile(player,tile,eggIndex=null) {
  if(state.phase!=="discard"||state.current!==player||state.ting[player]||!canAddEgg(player,tile,eggIndex)||!state.wall.length) return false;
  if(eggIndex===null) eggIndex=state.eggs[player].findIndex(egg=>eggSupplementIndex(egg,tile)>=0);
  state.selectedTile=null; state.selectedIndex=null;
  removeTile(state.hands[player],tile);
  const egg=state.eggs[player][eggIndex];
  const index=eggSupplementIndex(egg,tile);
  if(index===egg.tiles.length) egg.tiles.push(tile);
  else egg.tiles[index]=tile;
  state.eggDrawn[player].push(tile);
  const replacement=drawEggReplacement(player);
  if(replacement===null) return finishDraw();
  if(player===0) state.drawnIndex=state.hands[0].lastIndexOf(replacement);
  state.phase="discard"; state.current=player;
  setStatus(`${NAMES[player]}补${eggTypeName(egg.type)} ${shortName(tile)}，摸到 ${shortName(replacement)}，请打出一张手牌继续`);
  playSound("gang"); render();
  player===0?updateActions():scheduleAI();
  return true;
}

function canFormMelds(counts,need) {
  if(need===0)return counts.every(c=>c===0);
  const i=counts.findIndex(c=>c>0);if(i<0)return false;
  if(counts[i]>=3){counts[i]-=3;if(canFormMelds(counts,need-1)){counts[i]+=3;return true;}counts[i]+=3;}
  if(i<27&&i%9<=6&&counts[i+1]&&counts[i+2]){counts[i]--;counts[i+1]--;counts[i+2]--;if(canFormMelds(counts,need-1)){counts[i]++;counts[i+1]++;counts[i+2]++;return true;}counts[i]++;counts[i+1]++;counts[i+2]++;}
  return false;
}

function computeScore({winner, loser=null, method="自摸", pattern, selfDraw=isSelfDraw(method), zhuangHu, zhuangDian, duiBao=false, moBao=false, baoPao=false, dealer=state.dealer}) {
  const winnerIsDealer=zhuangHu??winner===dealer;
  const loserIsDealer=zhuangDian??(!selfDraw&&loser===dealer);
  const baseFans=pattern?.baseFans??0;
  const N=baseFans+(selfDraw?1:0)+(winnerIsDealer?1:0)+(!selfDraw&&loserIsDealer?1:0)+(duiBao?2:0)+(moBao?1:0);
  const unit=2**N, payments=[0,0,0,0];
  if(selfDraw) {
    for(let player=0;player<4;player++) if(player!==winner) {
      payments[player]=winnerIsDealer?unit:(player===dealer?unit*2:unit);
    }
  } else if(winnerIsDealer) {
    for(let player=0;player<4;player++) if(player!==winner) payments[player]=player===loser?unit*2:unit;
  } else if(loserIsDealer) {
    for(let player=0;player<4;player++) if(player!==winner) payments[player]=player===loser?unit*2:unit/2;
  } else {
    for(let player=0;player<4;player++) if(player!==winner) payments[player]=player===dealer||player===loser?unit*2:unit;
  }
  if(!selfDraw&&baoPao&&loser!==null) {
    const total=payments.reduce((sum,payment)=>sum+payment,0);
    payments.fill(0); payments[loser]=total;
  }
  const winnerGain=payments.reduce((sum,payment)=>sum+payment,0);
  const changes=payments.map((payment,player)=>player===winner?winnerGain:-payment);
  return {N,payments,winnerGain,changes,baseFans,selfDraw,winnerIsDealer,loserIsDealer,baoPao};
}

function renderResultScore(score) {
  const rows=score.changes.map((change,player)=>`<div class="score-row ${player===state.current?"winner":""}"><span>${NAMES[player]}${player===state.dealer?"（庄）":""}</span><strong class="${change>=0?"gain":"loss"}">${change>=0?"+":""}${change}</strong></div>`).join("");
  $("scoreTable").innerHTML=`<div class="score-title">总番数 N = ${score.N}</div>${rows}`;
}

function finishWin(player,method,hand) {
  const loser=method==="点炮"?state.lastDiscard?.player:null;
  const nominalWinTile=method==="点炮"?state.lastDiscard?.tile:state.lastDrawn[player];
  const unreportedWait=method==="点炮"&&!state.ting[player]&&getLegalWaits(player,state.hands[player]).includes(nominalWinTile);
  const analysis=evaluateChangchunWin(player,hand,nominalWinTile,method,{allowUnreportedWin:unreportedWait});
  // 所有正常入口都已判定。这里仍保留兜底，以便外部调试调用不会把无效牌型结算成胡。
  if(!analysis.legal) return;
  clearGameTimers(); state.phase="gameover";setActions();state.current=player;render();playSound("win");beep(player===0?784:180,.25);
  const detected=detectPattern(analysis.hand,shapeMelds(player),analysis.winTile,method);
  const pattern=detected;
  const selfDraw=isSelfDraw(method), duiBao=selfDraw&&!analysis.moBao&&isDuiBao(nominalWinTile), moBao=selfDraw&&analysis.moBao;
  const baoPao=!selfDraw&&loser!==null&&!state.baopaiRevealed[loser];
  const score=computeScore({winner:player,loser,method,pattern,selfDraw,zhuangHu:player===state.dealer,zhuangDian:loser===state.dealer,duiBao,moBao,baoPao,dealer:state.dealer});
  state.scores=state.scores.map((scoreValue,index)=>scoreValue+score.changes[index]);
  renderScoreboard();
  $("resultIcon").textContent=player===0?"胡":"惜";
  $("resultTitle").textContent=player===0?"恭喜，胡了！":`${NAMES[player]}胡牌`;
  const source=method==="点炮"&&loser!==null?` · ${NAMES[loser]}放铳`:"";
  $("resultDetail").textContent=`${method}${source}`;
  $("resultShape").textContent=`${pattern.name}${pattern.standing&&pattern.type!=="qidui"&&pattern.type!=="haoqidui"?" · 站立":" · 开门"}`;
  const extras=[`基础 ${pattern.baseFans}番`,selfDraw?"自摸 +1":"",player===state.dealer?"庄家胡 +1":"",!selfDraw&&loser===state.dealer?"庄家点炮 +1":"",duiBao?"对宝 +2":"",moBao?"摸宝 +1":""].filter(Boolean);
  $("patternList").innerHTML=extras.map(extra=>`<span>${extra}</span>`).join("");
  renderResultScore(score);
  const baoPaoNotice=$("baoPaoNotice");
  baoPaoNotice.hidden=!baoPao;
  baoPaoNotice.textContent=baoPao?`${NAMES[loser]}未看宝，包炮，承担全部 ${score.winnerGain} 分。`:"";
  const resultMelds=state.melds[player].map(m=>`<span class="result-meld" title="${{chi:"吃",peng:"碰",gang:"杠"}[m.type]}">${m.tiles.map(t=>tileHTML(t,{small:true})).join("")}</span>`).join("");
  $("winningHand").innerHTML=resultMelds+`<span class="result-concealed">${[...analysis.hand].sort((a,b)=>a-b).map(t=>tileHTML(t,{small:true})).join("")}</span>`;
  const round=state.round;
  later(()=>{if(state.round===round&&state.phase==="gameover") $("resultDialog").showModal();},400);
}

function finishDraw(){clearGameTimers();state.phase="gameover";setActions();setStatus("牌墙已空，本局荒庄");$("resultIcon").textContent="和";$("resultTitle").textContent="本局荒庄";$("resultDetail").textContent="牌墙摸完，无人胡牌";$("resultShape").textContent="";$("patternList").innerHTML="";$("scoreTable").innerHTML="";$("baoPaoNotice").hidden=true;$("winningHand").innerHTML="";playSound("drawgame");render();const round=state.round;later(()=>{if(state.round===round&&state.phase==="gameover") $("resultDialog").showModal();},300);}
function shortName(id){return id<27?`${id%9+1}${["万","筒","条"][Math.floor(id/9)]}`:["东","南","西","北","中","发","白"][id-27];}

let audioContext;
function unlockAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==="suspended")audioContext.resume();}catch{}}
function beep(freq,duration){if(!state.sound)return;try{unlockAudio();const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=freq;o.type="triangle";g.gain.setValueAtTime(.055*state.volume,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration);}catch{}}
function playSound(name){
  if(!state.sound||!SOUND_FILES[name])return;
  try{
    const audio=soundCache[name]??=new Audio(`assets/sounds/${SOUND_FILES[name]}`);
    const instance=audio.cloneNode();
    instance.volume=state.volume;
    instance.play().catch(()=>{});
  }catch{}
}

function showResourceError(message){const banner=$("errorBanner");if(!banner)return;banner.hidden=false;banner.textContent=message;}
function finishLoading(){
  const overlay=$("loadingOverlay");if(!overlay||!document.images)return;
  // This is intentionally a startup snapshot: startGame has already rendered all
  // tile images needed for the board, and later turns reuse those same assets.
  const images=[...document.images];
  Promise.all(images.map(img=>img.complete?Promise.resolve({img,ok:img.naturalWidth>0}):new Promise(resolve=>{img.addEventListener("load",()=>resolve({img,ok:true}),{once:true});img.addEventListener("error",()=>resolve({img,ok:false}),{once:true});}))).then(results=>{
    const missing=results.filter(result=>!result.ok).map(result=>result.img.getAttribute("src")||"未知资源");
    if(missing.length)showResourceError(`部分麻将牌资源加载失败：${missing.slice(0,3).join("、")}${missing.length>3?` 等 ${missing.length} 个`:""}`);
    overlay.classList.add("hidden");setTimeout(()=>overlay.remove(),300);
  });
}

$("newGameBtn").onclick=startGame;$("playAgainBtn").onclick=startGame;
$("scoreboardBtn").onclick=()=>{renderScoreboard();$("scoreboardDialog").showModal();};
$("scoreboardDialog").querySelector(".modal-close").onclick=()=>$("scoreboardDialog").close();
$("rulesBtn").onclick=()=>$("rulesDialog").showModal();
$("rulesDialog").querySelector(".modal-close").onclick=()=>$("rulesDialog").close();
$("soundBtn").onclick=()=>{state.sound=!state.sound;$("soundBtn").textContent=`声音：${state.sound?"开":"关"}`;if(state.sound)beep(440,.05);};
$("volumeSlider").oninput=e=>{state.volume=+e.target.value/100;if(state.volume>0)beep(440,.035);};
document.addEventListener("pointerdown",unlockAudio,{once:true});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.pending){const cb=state.pending.onPass;state.pending=null;setActions();cb();}});
window.addEventListener?.("error",event=>{if(event.target?.tagName==="IMG")showResourceError("麻将牌图片加载失败，请检查 assets/tiles 资源目录。");});

try{startGame();finishLoading();}catch(error){showResourceError(`游戏初始化失败：${error.message}`);throw error;}

// Expose rule helpers for the lightweight test page / console diagnostics.
window.Mahjong={
  makeWall,isWinning,chiPatterns,isQiDui,isHaoQiDui,isStanding,isJiaHu,isPiaoHu,isPiaoDing,
  detectPattern,canChangchunWin,evaluateChangchunWin,getLegalWaits,detectStartEggs,canAddEgg,
  determineBaopai,isDuiBao,isMoBao,computeScore,patternBase,shortName
};
