/* Presentation only: one camera for the table/public tiles, flat own fronts.
   No game rules,
   random draws, saved-state changes or network messages belong in this file. */
(function(global){
  "use strict";
  const eye=[0,-1350,1100];
  const subtract=(a,b)=>a.map((value,i)=>value-b[i]);
  const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const normalize=a=>{const length=Math.hypot(...a);return a.map(value=>value/length);};
  const forward=normalize(subtract([0,0,0],eye)),right=normalize(cross(forward,[0,0,1])),up=cross(right,forward);
  const plane=[[-500,460,0],[500,460,0],[500,-460,0],[-500,-460,0]];
  function project(point){
    const relative=subtract(point,eye),depth=dot(relative,forward);
    return [1500*dot(relative,right)/depth,-1500*dot(relative,up)/depth];
  }
  function bounds(points){
    return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),
      top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
  }
  // Stable camera bounds, independent of hand/discard counts: no table jump
  // when a player reports ting, calls a set, draws or adds a new river row.
  const sceneBounds=bounds([...plane,...plane.map(([x,y])=>[x,y,84])].map(project));
  function camera(width,height){
    const margin=width<700?10:24,top=height<350?34:40,bottom=8;
    const scale=Math.min((width-2*margin)/(sceneBounds.right-sceneBounds.left),
      (height-top-bottom)/(sceneBounds.bottom-sceneBounds.top));
    const cx=width/2,cy=height-bottom-scale*sceneBounds.bottom;
    return point=>{const [x,y]=project(point);return [cx+x*scale,cy+y*scale];};
  }
  function vertices(x,y,width,depth,height){
    const x0=x-width/2,x1=x+width/2,y0=y-depth/2,y1=y+depth/2;
    return [[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0],
      [x0,y0,height],[x1,y0,height],[x1,y1,height],[x0,y1,height]];
  }
  // Project a real rectangle onto a quadrilateral. matrix3d preserves its
  // texture proportions and browser hit testing, unlike skewed screenshots.
  function matrix(quad,width=58,height=84){
    const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=quad;
    const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3;
    const dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
    const determinant=dx1*dy2-dx2*dy1;
    const g=Math.abs(determinant)<1e-9?0:(dx3*dy2-dx2*dy3)/determinant;
    const h=Math.abs(determinant)<1e-9?0:(dx1*dy3-dx3*dy1)/determinant;
    return [(x1-x0+g*x1)/width,(y1-y0+g*y1)/width,0,g/width,
      (x3-x0+h*x3)/height,(y3-y0+h*y3)/height,0,h/height,0,0,1,0,x0,y0,0,1];
  }
  // Pack complete sets, not individual tiles, into bounded lanes. The same
  // planner serves all four fixed public zones and never reads hand counts.
  function packGroups(counts,span,lanes=2,baseSize=36,tileGap=2,groupGap=18){
    let size=baseSize;
    for(let attempt=0;attempt<160;attempt++,size*=.96){
      const scale=size/baseSize,step=size+tileGap*scale,gap=groupGap*scale;
      const groups=[];let lane=0,cursor=0;
      for(const count of counts){
        const length=Math.max(0,count*step-tileGap*scale);
        if(cursor&&cursor+length>span){lane++;cursor=0;}
        groups.push({lane,start:cursor,count,length});cursor+=length+gap;
      }
      if(lane<lanes&&groups.every(g=>g.length<=span))return {size,step,gap,groups};
    }
    throw Error("Public sets exceed layout capacity");
  }
  const geometry={project,camera,vertices,matrix,bounds,plane,packGroups};
  if(typeof module!=="undefined"&&module.exports)module.exports=geometry;
  if(!global.document)return;
  const document=global.document,table=document.querySelector(".table");
  if(!table)return;
  let queued=false;
  function requestLayout(){
    if(queued)return;queued=true;
    global.requestAnimationFrame(()=>{queued=false;layout();});
  }
  const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
  const countMarkers=new Map();
  function frame(tile){
    if(tile.parentElement.classList.contains("table-tile-box"))return tile.parentElement;
    let box=tile.parentElement;
    if(!box.classList.contains("live-egg-tile")){
      box=document.createElement("span");tile.before(box);box.append(tile);
    }
    box.classList.add("table-tile-box");
    for(let i=0;i<2;i++){
      const face=document.createElement("span");face.className=`tile-solid-face solid-${i}`;face.setAttribute("aria-hidden","true");tile.before(face);
    }
    return box;
  }
  function layout(){
    const width=table.clientWidth,height=table.clientHeight;if(!width||!height)return;
    table.dataset.layout="perspective";
    table.dataset.compact=String(width<1000||height<500);
    const p=camera(width,height);
    const surface=document.getElementById("tableSurface");
    surface.style.clipPath=`polygon(${plane.map(point=>p(point).map(value=>`${value}px`).join(" ")).join(",")})`;
    let countLayer=document.getElementById("tableCountLayer");
    if(!countLayer){countLayer=document.createElement("div");countLayer.id="tableCountLayer";countLayer.className="table-count-layer";countLayer.setAttribute("aria-hidden","true");table.append(countLayer);}
    const activeCounts=new Set();
    function updateCount(box,r,quad){
      const source=box.querySelector(":scope > .live-egg-count");if(!source)return;
      activeCounts.add(source);
      let marker=countMarkers.get(source);
      if(!marker){marker=document.createElement("sup");marker.className="table-count-badge";countLayer.append(marker);countMarkers.set(source,marker);}
      if(marker.textContent!==source.textContent)marker.textContent=source.textContent;
      const badgeSize=clamp(width*.013,12,18),face=bounds(quad);
      // Counts share one foreground layer; they cannot be occluded by the
      // stacking context of the next tile, and remain inside their own face.
      Object.assign(marker.style,{left:`${r.left+Math.max(face.left,face.right-badgeSize)}px`,top:`${r.top+face.top+1}px`,
        minWidth:`${badgeSize}px`,height:`${badgeSize}px`,fontSize:`${clamp(badgeSize*.72,10,13)}px`});
    }
    function decorate(box,tile,seat,kind){
      box.dataset.kind=kind;box.dataset.seat=String(seat);
      box.classList.toggle("raised",tile.classList.contains("selected"));
      box.classList.toggle("draw-highlight",tile.classList.contains("drawn"));
    }
    function card(tile,x,y,standing,seat,size=58,depth=84,kind="open"){
      const side=seat===1||seat===3;
      const v=vertices(x,y,standing?(side?22:size):(side&&kind!=="river"?depth:size),
        standing?(side?size:22):(side&&kind!=="river"?size:depth),standing?size*84/58:10);
      const screen=v.map(p),r=bounds(screen),box=frame(tile);
      Object.assign(box.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`,
        zIndex:String(Math.round(3000-dot(subtract([x,y,0],eye),forward)))});
      const main=standing?(seat===3?[6,5,1,2]:seat===1?[4,7,3,0]:[4,5,1,0])
        :kind!=="river"&&side?(seat===3?[6,5,4,7]:[4,7,6,5]):[7,6,5,4];
      const quad=main.map(i=>[screen[i][0]-r.left,screen[i][1]-r.top]);
      tile.style.setProperty("transform",`matrix3d(${matrix(quad).join(",")})`,"important");
      decorate(box,tile,seat,kind);box.classList.remove("face-on");
      const sides=standing?[[7,6,5,4],seat===3?[4,5,1,0]:seat===1?[4,5,1,0]:x<0?[5,6,2,1]:[7,4,0,3]]
        :[[0,1,5,4],x<0?[1,2,6,5]:[3,0,4,7]];
      box.querySelectorAll(":scope > .tile-solid-face").forEach((face,i)=>{
        face.style.clipPath=`polygon(${sides[i].map(j=>`${screen[j][0]-r.left}px ${screen[j][1]-r.top}px`).join(",")})`;
      });
      updateCount(box,r,quad);
      return r;
    }
    function frontCard(tile,left,top,size){
      const faceHeight=size*84/58,lip=Math.max(3,size*.10),box=frame(tile);
      const r={left,top,right:left+size,bottom:top+faceHeight+lip};
      Object.assign(box.style,{left:`${left}px`,top:`${top}px`,width:`${size}px`,height:`${faceHeight+lip}px`,zIndex:"1500"});
      const quad=[[0,lip],[size,lip],[size,faceHeight+lip],[0,faceHeight+lip]];
      tile.style.setProperty("transform",`matrix3d(${matrix(quad).join(",")})`,"important");
      decorate(box,tile,0,"hand");box.classList.add("face-on");
      box.querySelector(".solid-0").style.clipPath=`polygon(0 0,100% 0,100% ${lip}px,0 ${lip}px)`;
      return r;
    }
    const groups=seat=>[...document.querySelectorAll(`#player${seat} .meld-group,#player${seat} .egg-group`)];
    const groupTiles=group=>[...group.querySelectorAll(".tile")];
    function groupLabel(group,rects){
      if(!rects.length)return;
      const r={left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top))};
      group.style.setProperty("--group-x",`${r.left}px`);group.style.setProperty("--group-y",`${r.top-16}px`);
    }
    // One reserved flat-front lane. Neither the camera nor another player's
    // hand count changes its baseline, scale, badge or action area.
    const own=[...document.querySelectorAll("#player0 .seat-hand-slot .tile")];
    const ownLeft=Math.max(8,Math.min(p([-480,-450,0])[0],width*.10));
    const ownRight=p([215,-450,0])[0]-8;
    const ownGap=clamp(width*.002,1.5,3),ownSize=Math.min(height*.125,(ownRight-ownLeft-14*ownGap)/15);
    const ownTop=height-10-ownSize*84/58-Math.max(3,ownSize*.10);
    let ownX=ownLeft;
    for(const tile of own){if(tile.classList.contains("drawn"))ownX+=ownSize+ownGap;frontCard(tile,ownX,ownTop,ownSize);ownX+=ownSize+ownGap;}
    function horizontalPublic(seat,minX,span,frontY,rowDirection){
      const sets=groups(seat),plan=packGroups(sets.map(g=>groupTiles(g).length),span,2,36);
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],y=frontY+rowDirection*slot.lane*90;
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,minX+slot.start+plan.size/2+i*plan.step,y,false,seat,plan.size,plan.size*84/58)));
      });
    }
    horizontalPublic(0,242,240,-434,1);
    const north=[...document.querySelectorAll("#player2 .seat-hand-slot .tile")];
    const northStart=350-Math.max(0,north.length-1)*48;
    north.forEach((tile,i)=>card(tile,northStart+i*48,438,true,2,48,70,"hand"));
    horizontalPublic(2,-478,224,430,-1);
    for(const seat of [3,1]){
      const tiles=[...document.querySelectorAll(`#player${seat} .seat-hand-slot .tile`)];
      const step=Math.min(50,410/Math.max(1,tiles.length-1)),handTop=-40+Math.max(0,tiles.length-1)*step/2;
      tiles.forEach((tile,i)=>card(tile,seat===3?-380:380,handTop-i*step,true,seat,48,70,"hand"));
      const sets=groups(seat),plan=packGroups(sets.map(g=>groupTiles(g).length),470,2,28,4,22);
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],x=(seat===3?-1:1)*(465-slot.lane*45);
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,x,135-slot.start-plan.size/2-i*plan.step,false,seat,plan.size,plan.size*84/58)));
      });
    }
    // Four disjoint river rectangles, all sharing the table's projection.
    // First rows are fixed; growing a river cannot move its earlier tiles.
    // Only unusually full rivers tighten their cells to retain the history.
    for(let seat=0;seat<4;seat++){
      const tiles=[...document.querySelectorAll(`#river${seat} .tile`)];
      const horizontal=seat===0||seat===2,columns=horizontal?10:6,rows=Math.ceil(tiles.length/columns);
      const cellY=seat===0?Math.min(50,120/Math.max(2,rows)):Math.min(52,(horizontal?160:220)/Math.max(horizontal?3:4,rows));
      const size=Math.min(34,(cellY-4)*58/84),stepX=horizontal?38:35;
      document.getElementById(`river${seat}`).dataset.columns=String(columns);
      tiles.forEach((tile,i)=>{
        const col=i%columns,row=Math.floor(i/columns);
        const x=horizontal?-171+col*stepX:seat===3?-310+col*stepX:135+col*stepX;
        const y=seat===0?-85-row*cellY:seat===2?240+row*cellY:160-row*cellY;
        card(tile,x,y,false,seat,size,size*84/58,"river");
      });
    }
    for(const [source,marker] of countMarkers)if(!activeCounts.has(source)){marker.remove();countMarkers.delete(source);}
    function place(element,left,top){
      if(!element)return;
      element.style.left=`${clamp(left,6,width-element.offsetWidth-6)}px`;
      element.style.top=`${clamp(top,6,height-element.offsetHeight-6)}px`;
    }
    // Fixed seats, with dedicated clear space rather than per-turn obstacle
    // avoidance. A neighbour losing tiles must never move your own profile.
    const placed=[];
    for(const seat of [0,2,3,1]){
      const badge=document.querySelector(`#player${seat} .seat-badge-slot`);if(!badge)continue;
      const bw=badge.offsetWidth,bh=badge.offsetHeight;
      const target=seat===0?[p([-315,-270,0])[0]+8,ownTop-bh-11]
        :seat===2?[p([385,438,0])[0]+12,Math.max(42,p([0,438,70])[1])]
        :seat===3?[p([-515,-180,0])[0]-bw-10,(height-bh)/2]
        :[p([515,-180,0])[0]+10,(height-bh)/2];
      place(badge,...target);
      placed.push({left:parseFloat(badge.style.left),top:parseFloat(badge.style.top),
        right:parseFloat(badge.style.left)+bw,bottom:parseFloat(badge.style.top)+bh});
    }
    const center=p([0,60,0]),ring=document.getElementById("windRing");
    const diameter=clamp(width*.073,44,82);
    ring.style.width=`${diameter}px`;ring.style.height=`${diameter}px`;
    ring.style.left=`${center[0]-diameter/2}px`;ring.style.top=`${center[1]-diameter/2}px`;
    const status=document.getElementById("statusText"),action=document.getElementById("actionBar");
    table.dataset.actions=String(!action.classList.contains("empty"));
    const waits=document.querySelector("#player0 .seat-waits-slot");
    const ownBadge=placed[0]||{left:ownLeft+100,right:ownLeft+180},uiLeft=ownBadge.right+12,uiWidth=Math.max(100,ownRight-uiLeft);
    if(waits){
      // Three non-overlapping parts of one bottom information strip: waits,
      // own profile, actions/status. Stacking these upwards reached the river
      // on short phones, especially when a horizontal scrollbar appeared.
      waits.style.width=`${Math.max(70,ownBadge.left-ownLeft-10)}px`;
      place(waits,ownLeft,ownTop-waits.offsetHeight-11);
    }
    const uiBottom=ownTop-11;
    action.style.maxWidth=`${uiWidth}px`;
    place(action,uiLeft+Math.max(0,(uiWidth-action.offsetWidth)/2),uiBottom-action.offsetHeight);
    status.style.width=`${uiWidth}px`;
    place(status,uiLeft,uiBottom-status.offsetHeight);
    for(let seat=0;seat<4;seat++){
      const cue=document.getElementById(`actionCue${seat}`);
      const anchor=p(seat===0?[0,-290,0]:seat===2?[0,350,0]:seat===3?[-270,-30,0]:[270,-30,0]);
      place(cue,anchor[0]-cue.offsetWidth/2,anchor[1]-cue.offsetHeight/2);
    }
  }
  global.MahjongTable={requestLayout,layout,geometry};
  new global.ResizeObserver(requestLayout).observe(table);
  global.addEventListener("resize",requestLayout);
  // Observe only additions/replacements, not our style writes or highlights.
  new global.MutationObserver(requestLayout).observe(table,{childList:true,subtree:true});
  requestLayout();
})(typeof window!=="undefined"?window:globalThis);
