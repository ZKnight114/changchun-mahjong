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
  const outerPlane=[[-518,478,0],[518,478,0],[518,-478,0],[-518,-478,0]];
  const tableLift=height=>Math.min(30,height*.077);
  function project(point){
    const relative=subtract(point,eye),depth=dot(relative,forward);
    return [1500*dot(relative,right)/depth,-1500*dot(relative,up)/depth];
  }
  function bounds(points){
    return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),
      top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
  }
  function flatThickness(size){return Math.max(4,size*.42);}
  function convexHull(points){
    const sorted=points.map(p=>p.slice()).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=items=>{const result=[];for(const point of items){while(result.length>1&&turn(result.at(-2),result.at(-1),point)<=0)result.pop();result.push(point);}return result;};
    return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
  }
  // Round the projected solid's silhouette, not just its bitmap front.
  // Radius is limited by the adjacent edges to preserve thin thickness faces.
  function roundedPath(points,radius){
    const corners=points.map((point,i)=>{
      const previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],
        a=Math.hypot(previous[0]-point[0],previous[1]-point[1]),b=Math.hypot(next[0]-point[0],next[1]-point[1]),
        inset=Math.min(radius,a*.3,b*.3);
      const towards=(end,length)=>point.map((value,j)=>value+(end[j]-value)*inset/Math.max(length,1e-9));
      return {point,enter:towards(previous,a),exit:towards(next,b)};
    });
    return `M${corners[0].enter.join(',')} `+corners.map((c,i)=>`${i?'L'+c.enter.join(',')+' ':''}Q${c.point.join(',')} ${c.exit.join(',')}`).join(' ')+' Z';
  }
  // Stable camera bounds, independent of hand/discard counts: no table jump
  // when a player reports ting, calls a set, draws or adds a new river row.
  const sceneBounds=bounds([...plane,...plane.map(([x,y])=>[x,y,84])].map(project));
  function camera(width,height){
    const compact=width<1000||height<500;
    const margin=compact&&width<700?56:24,top=compact?32:40,
      bottom=8+Math.max(0,320-height)*.75;
    const scale=Math.min((width-2*margin)/(sceneBounds.right-sceneBounds.left),
      (height-top-bottom)/(sceneBounds.bottom-sceneBounds.top));
    // Leave a small, stable headroom above north, not a large blank band on
    // a short phone. The outer gutters fit horizontal player profiles.
    // Very short browser viewports also reserve room for the flat hand and
    // its action strip, so the closest river row cannot cover the buttons.
    const cx=width/2,cy=(compact?top-scale*sceneBounds.top:height-bottom-scale*sceneBounds.bottom)-tableLift(height);
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
  const geometry={project,camera,vertices,matrix,bounds,plane,outerPlane,tableLift,packGroups,flatThickness,convexHull,roundedPath};
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
    if(tile.classList.contains("back")){
      const edge=document.createElementNS("http://www.w3.org/2000/svg","svg");
      edge.classList.add("tile-back-edges");edge.setAttribute("aria-hidden","true");
      edge.setAttribute("preserveAspectRatio","none");
      for(const name of ["back-edge","top-edge"]){const path=document.createElementNS(edge.namespaceURI,"path");path.setAttribute("class",name);edge.append(path);}
      box.append(edge);
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
    const tableDepth=document.getElementById("tableDepth");
    if(tableDepth)tableDepth.style.clipPath=`polygon(${convexHull(outerPlane.flatMap(([x,y])=>[p([x,y,8]),p([x,y,-26])])).map(point=>point.map(value=>`${value}px`).join(' ')).join(',')})`;
    const rim=document.getElementById('tableRim');
    if(rim){
      rim.setAttribute('viewBox',`0 0 ${width} ${height}`);
      const outline=points=>`M${points.map(point=>point.join(',')).join(' L')} Z`,
        outer=outerPlane.map(([x,y])=>p([x,y,8])),inner=plane.map(([x,y])=>p([x,y,8])),base=plane.map(p);
      rim.querySelector('.rim-top').setAttribute('d',outline(outer)+' '+outline(inner));
      rim.querySelector('.rim-bevel').setAttribute('d',inner.map((point,i)=>{const j=(i+1)%4;return outline([point,inner[j],base[j],base[i]]);}).join(' '));
      rim.querySelector('.rim-outline').setAttribute('d',outline(outer));
      rim.querySelector('.rim-inner-line').setAttribute('d',outline(inner));
    }
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
        standing?(side?size:22):(side&&kind!=="river"?size:depth),standing?size*84/58:flatThickness(size));
      const screen=v.map(p),r=bounds(screen),box=frame(tile);
      const local=screen.map(point=>[point[0]-r.left,point[1]-r.top]),radius=clamp(size*.065,1.5,3.5);
      Object.assign(box.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`,
        zIndex:String(Math.round(3000-dot(subtract([x,y,0],eye),forward))),clipPath:`path("${roundedPath(convexHull(local),radius)}")`});
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
      const edges=box.querySelector(".tile-back-edges");
      if(edges){
        edges.setAttribute("viewBox",`0 0 ${r.right-r.left} ${r.bottom-r.top}`);
        const contour=ids=>roundedPath(ids.map(j=>local[j]),radius);
        edges.querySelector(".back-edge").setAttribute("d",contour(main));
        edges.querySelector(".top-edge").setAttribute("d",contour(standing?[7,6,5,4]:main));
      }
      updateCount(box,r,quad);
      return r;
    }
    function frontCard(tile,left,top,size){
      const faceHeight=size*84/58,lip=Math.max(4,size*.16),box=frame(tile);
      const r={left,top,right:left+size,bottom:top+faceHeight+lip};
      Object.assign(box.style,{left:`${left}px`,top:`${top}px`,width:`${size}px`,height:`${faceHeight+lip}px`,zIndex:"1500",
        clipPath:`path("${roundedPath([[0,0],[size,0],[size,faceHeight+lip],[0,faceHeight+lip]],clamp(size*.11,2,5))}")`});
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
    const compact=table.dataset.compact==="true",ownLift=compact?Math.min(10,height*.025):0;
    // Anchor the first tile to the near-left table corner, not the screen.
    const ownLeft=p([-500,-460,0])[0]+4;
    const ownRight=p([215,-450,0])[0]-8;
    const ownGap=clamp(width*.002,1.5,3),ownSize=Math.min(height*.125,(ownRight-ownLeft-14*ownGap)/15);
    const ownTop=height-10-ownLift-ownSize*84/58-Math.max(4,ownSize*.16)-tableLift(height);
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
      // Keep a dedicated clear strip above the local profile. Extra sets
      // wrap into the second fixed lane rather than growing into that strip.
      const sets=groups(seat),plan=packGroups(sets.map(g=>groupTiles(g).length),390,2,28,4,22);
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],x=(seat===3?-1:1)*(465-slot.lane*45);
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,x,195-slot.start-plan.size/2-i*plan.step,false,seat,plan.size,plan.size*84/58)));
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
        const x=horizontal?-171+col*stepX:seat===3?-335+col*stepX:160+col*stepX;
        const y=seat===0?-110-row*cellY:seat===2?275+row*cellY:160-row*cellY;
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
      const northBadge=document.querySelector('#player2 .seat-badge-slot'),
        sideTop=Math.max((height-bh)/2-bh-tableLift(height),
          (parseFloat(northBadge?.style.top)||6)+(northBadge?.offsetHeight||0)+8);
      const target=seat===0?[ownLeft,ownTop-bh-11]
        :seat===2?[p([385,438,0])[0]+12,p([0,438,70])[1]]
        :seat===3?[6,sideTop]
        :[width-bw-6,sideTop];
      place(badge,...target);
      placed.push({left:parseFloat(badge.style.left),top:parseFloat(badge.style.top),
        right:parseFloat(badge.style.left)+bw,bottom:parseFloat(badge.style.top)+bh});
    }
    const center=p([0,90,8]),ring=document.getElementById("windRing");
    const diameter=clamp(width*.09,72,104),counterHeight=diameter*.74;
    ring.style.width=`${diameter}px`;ring.style.height=`${counterHeight}px`;
    ring.style.left=`${center[0]-diameter/2}px`;ring.style.top=`${center[1]-counterHeight/2}px`;
    const status=document.getElementById("statusText"),action=document.getElementById("actionBar");
    table.dataset.actions=String(!action.classList.contains("empty"));
    const waits=document.querySelector("#player0 .seat-waits-slot");
    const ownBadge=document.querySelector('#player0 .seat-badge-slot'),
      waitLeft=Math.max(ownLeft,(parseFloat(ownBadge?.style.left)||6)+(ownBadge?.offsetWidth||88)+8),
      narrowUI=height<320||ownRight-ownLeft<350,
      waitWidth=Math.max(narrowUI?60:90,(ownRight-waitLeft)*.30),uiLeft=waitLeft+waitWidth+12,
      uiWidth=Math.max(narrowUI?60:100,ownRight-uiLeft);
    if(waits){
      // The profile is now on the left. Waiting tiles and
      // actions retain their own bottom strip, independent of that profile.
      waits.style.width=`${waitWidth}px`;
      place(waits,waitLeft,ownTop-waits.offsetHeight-11);
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
