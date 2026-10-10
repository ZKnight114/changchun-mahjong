/* Single source of truth for Changchun Mahjong metadata and pure rule helpers.
   No DOM, timers, network or hidden opponent state belongs in this module. */
(function(root){
  "use strict";
  const deepFreeze=value=>{Object.values(value).forEach(item=>{if(item&&typeof item==="object")deepFreeze(item);});return Object.freeze(value);};
  const config=deepFreeze({
    appVersion:"20261010-2",
    version:"changchun-20261010-1",saveCompatibleVersions:["changchun-20261009-1","changchun-20261008-2","changchun-20261008-3","changchun-20261008-4"],
    tileKinds:34,copies:4,circles:4,bao:{mustWin:true},
    patterns:{ping:{name:"平胡",fans:0},jia:{name:"夹胡",fans:1},piao:{name:"飘胡",fans:2},
      piaoding:{name:"飘顶",fans:3},qidui:{name:"七对",fans:3,sevenPairs:true},haoqidui:{name:"豪华七对",fans:4,sevenPairs:true}},
    eggs:{threeWinds:{name:"风蛋",required:[27,28,29,30],points:1},joy:{name:"喜蛋",required:[31,32,33],points:1},
      ones:{name:"幺蛋",required:[0,9,18],points:1},nine:{name:"9蛋",required:[8,17,26],points:1},
      threeChicks:{name:"3幺鸡",required:[18,18,18],points:1,allEggTiles:true},
      big:{name:"大蛋",required:[],open:2,concealed:4}},
    bigEggTiles:[18,9,31,32,33],chick:18,kong:{open:1,concealed:2,supplement:1},
    fans:{standing:1,selfDraw:1,dealerWin:1,dealerDiscard:1,duiBao:2,moBao:1}
  });
  const tileCount=(hand,id)=>hand.filter(tile=>tile===id).length;
  const isSuit=tile=>tile>=0&&tile<27;
  const isTerminalOrHonor=tile=>tile>=27||(tile>=0&&(tile%9===0||tile%9===8));
  const isSelfDraw=method=>method==="自摸"||method==="self";
  const meldTiles=groups=>groups.flatMap(group=>group.tiles);
  function tileInHandWithoutWin(hand,tile){const copy=[...hand],index=copy.lastIndexOf(tile);if(index>=0)copy.splice(index,1);return copy;}
  const isBigEggTile=tile=>config.bigEggTiles.includes(tile);
  const hasAllThreeSuits=(hand,melds=[])=>new Set([...hand,...meldTiles(melds)].filter(isSuit).map(tile=>Math.floor(tile/9))).size===3;
  const hasYaoJiu=(hand,melds=[])=>[...hand,...meldTiles(melds)].some(isTerminalOrHonor);
  const hasDragon=(hand,melds=[])=>[...hand,...meldTiles(melds)].some(tile=>tile>=31);
  const hasKong=(melds=[])=>melds.some(meld=>meld.type==="gang");
  const eggTypeName=type=>config.eggs[type]?.name||({anGang:"暗杠",mingGang:"明杠"}[type])||"蛋";
  const eggTiles=Object.freeze([...new Set([...Object.values(config.eggs).flatMap(egg=>egg.required),...config.bigEggTiles])].sort((a,b)=>a-b));
  function canSupplementEgg(egg,tile){
    if(!egg||egg.standardGang||!Number.isInteger(tile)||tile<0||tile>=config.tileKinds)return false;
    const rule=config.eggs[egg.type];
    return !!rule&&(rule.allEggTiles?eggTiles.includes(tile):tile===config.chick||rule.required.includes(tile));
  }
  function groupPoints(group){
    if(group.type==="gang"||group.standardGang){
      const hidden=group.concealed===true||group.type==="anGang";
      return isBigEggTile(group.tiles[0])?(hidden?config.eggs.big.concealed:config.eggs.big.open)
        :(hidden?config.kong.concealed:config.kong.open);
    }
    if(group.type==="big")return group.concealed?config.eggs.big.concealed:config.eggs.big.open;
    if(group.type==="anGang")return config.kong.concealed;
    if(group.type==="mingGang")return config.kong.open;
    return (config.eggs[group.type]?.points||0)+Math.max(0,group.tiles.length-3)*config.kong.supplement;
  }
  function computeGroupScore(groups){
    const points=groups.map(rows=>rows.reduce((sum,group)=>sum+groupPoints(group),0));
    const total=points.reduce((sum,point)=>sum+point,0);
    return {points,changes:points.map(point=>point*4-total)};
  }
function canFormMelds(counts,need) {
  if(need===0)return counts.every(c=>c===0);
  const i=counts.findIndex(c=>c>0);if(i<0)return false;
  if(counts[i]>=3){counts[i]-=3;if(canFormMelds(counts,need-1)){counts[i]+=3;return true;}counts[i]+=3;}
  if(i<27&&i%9<=6&&counts[i+1]&&counts[i+2]){counts[i]--;counts[i+1]--;counts[i+2]--;if(canFormMelds(counts,need-1)){counts[i]++;counts[i+1]++;counts[i+2]++;return true;}counts[i]++;counts[i+1]++;counts[i+2]++;}
  return false;
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

function canWinWithEdgeSequence(hand, openMelds, tile) {
  if(!isSuit(tile)||![2,6].includes(tile%9)) return false;
  const sequence=tile%9===2?[tile-2,tile-1,tile]:[tile,tile+1,tile+2];
  const need=4-openMelds,counts=Array(34).fill(0);
  hand.forEach(id=>counts[id]++);
  if(need<1||sequence.some(id=>!counts[id])) return false;
  sequence.forEach(id=>counts[id]--);
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
  return canWinByCompletingPair(hand,openMelds,winTile)
    ||canWinWithMiddleSequence(hand,openMelds,winTile)
    ||canWinWithEdgeSequence(hand,openMelds,winTile);
}

function allTripletPartition(hand, melds=[]) {
  // A laid egg is already a completed piao group, even when its three exposed
  // tiles are different (such as a three-winds or joy egg). Chi still breaks piao.
  if(melds.some(m=>m.type==="chi")) return false;
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
  const pattern=config.patterns[type]||config.patterns.ping;
  return pattern.fans+(!pattern.sevenPairs&&standing?config.fans.standing:0);
}

function patternName(type) {
  return (config.patterns[type]||config.patterns.ping).name;
}

function detectPattern(hand, melds=[], winTile, method="自摸") {
  const standing=isStanding(melds);
  let type="ping";
  if(melds.length===0&&isHaoQiDui(hand)) type="haoqidui";
  else if(melds.length===0&&isQiDui(hand)) type="qidui";
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
    // Once this group supplies the required triplet, the other groups may all
    // be sequences. Requiring a later triplet rejected valid early-triplet wins.
    if(canFormMelds(counts,need-1)) { counts[tile]+=3; return true; }
    counts[tile]+=3;
  }
  if(tile<27&&tile%9<=6&&counts[tile+1]&&counts[tile+2]) {
    counts[tile]--;counts[tile+1]--;counts[tile+2]--;
    if(hasTripletMeld(counts,need-1)) { counts[tile]++;counts[tile+1]++;counts[tile+2]++;return true; }
    counts[tile]++;counts[tile+1]++;counts[tile+2]++;
  }
  return false;
}


function coreWin({hand,winTile,melds=[],eggs=[],ting=null},options={}) {
  if(!isWinning(hand,melds.length))return {legal:false};
  const qidui=melds.length===0&&isQiDui(hand),standard=isWinningStandard(hand,melds.length);
  if(melds.length===4&&!isPiaoDing(hand,melds,winTile))return {legal:false};
  const before=[...tileInHandWithoutWin(hand,winTile),...meldTiles(melds)];
  const silentYaoJiu=!before.some(isTerminalOrHonor);
  if(silentYaoJiu&&!isTerminalOrHonor(winTile))return {legal:false};
  if(!eggs.some(egg=>egg.type==="nine")&&!hasAllThreeSuits(hand,melds))return {legal:false};
  if(!hasYaoJiu(hand,melds))return {legal:false};
  if(!qidui&&standard&&!hasATriplet(hand,melds)&&!hasDragon(hand,melds)&&!hasKong(melds)&&eggs.length===0)return {legal:false};
  if(!options.ignoreTing&&!options.forTenpai){
    // Reporting locks the hand and grants treasure access; it is not a
    // prerequisite for an ordinary self-drawn win while changing the hand.
    if(!ting&&!silentYaoJiu&&!isSelfDraw(options.method)&&!options.allowUnreportedWin)return {legal:false};
    if(ting&&!ting.waitTiles.includes(winTile))return {legal:false};
  }
  return {legal:true,hand,winTile,silentYaoJiu,moBao:false};
}

function computeScore({winner, loser=null, method="自摸", pattern, selfDraw=isSelfDraw(method), zhuangHu, zhuangDian, duiBao=false, moBao=false, baoPao=false, dealer=0}) {
  const winnerIsDealer=zhuangHu??winner===dealer;
  const loserIsDealer=zhuangDian??(!selfDraw&&loser===dealer);
  const baseFans=pattern?.baseFans??0;
  const fans=config.fans;
  const N=baseFans+(selfDraw?fans.selfDraw:0)+(winnerIsDealer?fans.dealerWin:0)
    +(!selfDraw&&loserIsDealer?fans.dealerDiscard:0)+(duiBao?fans.duiBao:0)+(moBao?fans.moBao:0);
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


  const api={config,tileCount,isSuit,isTerminalOrHonor,isSelfDraw,meldTiles,tileInHandWithoutWin,isBigEggTile,eggTypeName,eggTiles,canSupplementEgg,
    groupPoints,computeGroupScore,hasAllThreeSuits,hasYaoJiu,hasDragon,hasKong,coreWin};
  Object.assign(api,{chiPatterns,isWinning,isWinningStandard,isQiDui,isHaoQiDui,isStanding,canWinWithPair,canWinByCompletingPair,canWinWithMiddleSequence,canWinWithEdgeSequence,isJiaHu,allTripletPartition,isPiaoHu,isPiaoDing,patternBase,patternName,detectPattern,hasATriplet,hasTripletMeld,canFormMelds,computeScore});
  root.MahjongRules=Object.freeze(api);
  if(typeof module!=="undefined"&&module.exports)module.exports=root.MahjongRules;
})(typeof window!=="undefined"?window:globalThis);
