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
  function riverPlan(seat,count){
    const horizontal=seat===0||seat===2,columns=horizontal?13:6,rows=Math.ceil(count/columns),
      cellY=seat===0?Math.min(50,120/Math.max(2,rows)):Math.min(52,(horizontal?160:220)/Math.max(horizontal?3:4,rows)),
      size=Math.min(34,(cellY-4)*58/84);
    return {horizontal,columns,rows,cellY,size,stepX:horizontal?size+1.25:35};
  }
  const faceAspect=theme=>theme==='c'?360/272:4/3;
  function splitFace(points,axis,cut,backPositive){
    const clip=positive=>{
      const result=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],inside=p=>positive?p[axis]>=cut:p[axis]<=cut;
        if(inside(a))result.push(a);
        if(inside(a)!==inside(b)){
          const t=(cut-a[axis])/(b[axis]-a[axis]);result.push(a.map((value,j)=>value+t*(b[j]-value)));
        }
      }
      return result;
    };
    return {back:clip(backPositive),face:clip(!backPositive)};
  }
  function convexHull(points){
    const sorted=points.map(p=>p.slice()).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=items=>{const result=[];for(const point of items){while(result.length>1&&turn(result.at(-2),result.at(-1),point)<=0)result.pop();result.push(point);}return result;};
    return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
  }
  const rectPolygon=(left,top,width,height)=>[[left,top],[left+width,top],[left+width,top+height],[left,top+height]];
  function polygonsOverlap(a,b){
    const aa=bounds(a),bb=bounds(b);
    if(aa.right<=bb.left||bb.right<=aa.left||aa.bottom<=bb.top||bb.bottom<=aa.top)return false;
    return [a,b].every(points=>points.every((point,i)=>{
      const next=points[(i+1)%points.length],axis=[next[1]-point[1],point[0]-next[0]],length=Math.hypot(...axis);
      if(length<1e-9)return true;
      const range=ps=>ps.map(p=>dot(p,axis)/length),x=range(a),y=range(b);
      return Math.min(Math.max(...x),Math.max(...y))-Math.max(Math.min(...x),Math.min(...y))>.01;
    }));
  }
  // Counts are annotations, not part of a tile texture. Resolve them only
  // after ALL tiles and UI have their final positions, including both lanes.
  function placeCounts(requests,obstacles,width,height){
    const occupied=obstacles.slice(),result=[];
    for(const request of requests){
      const {preferred,size}=request,valid=([x,y])=>x>=2&&y>=2&&x+size<=width-2&&y+size<=height-2
        &&!occupied.some(p=>polygonsOverlap(rectPolygon(x-1,y-1,size+2,size+2),p));
      let position=valid(preferred)?preferred:null;
      // Nearest free location wins; no changing tile size or masking digits.
      for(let radius=2;!position&&radius<=80;radius+=2){
        const candidates=[];
        for(let offset=-radius;offset<=radius;offset+=2){
          candidates.push([preferred[0]+offset,preferred[1]-radius],[preferred[0]+offset,preferred[1]+radius],
            [preferred[0]-radius,preferred[1]+offset],[preferred[0]+radius,preferred[1]+offset]);
        }
        candidates.sort((a,b)=>Math.hypot(a[0]-preferred[0],a[1]-preferred[1])-Math.hypot(b[0]-preferred[0],b[1]-preferred[1]));
        position=candidates.find(valid)||null;
      }
      if(!position){
        const candidates=[];
        for(let y=2;y+size<=height-2;y+=6)for(let x=2;x+size<=width-2;x+=6)candidates.push([x,y]);
        candidates.sort((a,b)=>Math.hypot(a[0]-preferred[0],a[1]-preferred[1])-Math.hypot(b[0]-preferred[0],b[1]-preferred[1]));
        position=candidates.find(valid);
      }
      if(!position)throw Error("No clear space for egg count annotation");
      occupied.push(rectPolygon(position[0],position[1],size,size));result.push(position);
    }
    return result;
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
    const margin=compact?(width<700?56:8):24,top=compact?32:40,
      bottom=(compact?-36:8)+Math.max(0,320-height)*.75;
    const scale=Math.min((width-2*margin)/(sceneBounds.right-sceneBounds.left),
      (height-top-bottom)/(sceneBounds.bottom-sceneBounds.top));
    // Leave a small, stable headroom above north, not a large blank band on
    // a short phone. The outer gutters fit horizontal player profiles.
    // On phones the near rim may extend past the viewport; never crop tiles.
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
  const geometry={project,camera,vertices,matrix,bounds,plane,outerPlane,tableLift,packGroups,flatThickness,convexHull,roundedPath,faceAspect,splitFace,riverPlan,rectPolygon,polygonsOverlap,placeCounts};
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
  const textMeasure=document.createElement('canvas').getContext('2d');
  function frame(tile){
    if(tile.parentElement.classList.contains("table-tile-box"))return tile.parentElement;
    let box=tile.parentElement;
    if(!box.classList.contains("live-egg-tile")){
      box=document.createElement("span");tile.before(box);box.append(tile);
    }
    box.classList.add("table-tile-box");
    for(let i=0;i<2;i++){
      const face=document.createElement("span");face.className=`tile-solid-face solid-${i}`;face.setAttribute("aria-hidden","true");tile.before(face);
      for(const name of ['face','back']){const layer=document.createElement('span');layer.className=`solid-layer ${name}-layer`;face.append(layer);}
    }
    const outline=document.createElementNS("http://www.w3.org/2000/svg","svg");
    outline.classList.add("tile-body-outline");outline.setAttribute("aria-hidden","true");outline.setAttribute("preserveAspectRatio","none");
    outline.append(document.createElementNS(outline.namespaceURI,"path"));box.append(outline);
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
    const activeCounts=new Set(),countRequests=[],countObstacles=[];
    function updateCount(box,r,quad,side=0){
      const source=box.querySelector(":scope > .live-egg-count");if(!source)return;
      activeCounts.add(source);
      let marker=countMarkers.get(source);
      if(!marker){marker=document.createElement("sup");marker.className="table-count-badge";countLayer.append(marker);countMarkers.set(source,marker);}
      if(marker.textContent!==source.textContent)marker.textContent=source.textContent;
      const badgeSize=clamp(width*.008,11,12),face=bounds(quad),
        countTop=(face.top+face.bottom-badgeSize)/2,
        band=side?bounds(splitFace(splitFace(quad,1,countTop,true).back,1,countTop+badgeSize,false).back):face;
      // Counts share one foreground layer; they cannot be occluded by the
      // stacking context of the next tile. Place them OUTSIDE the face:
      // above horizontal groups, outward from each vertical public lane.
      countRequests.push({marker,size:badgeSize,quad:quad.map(([x,y])=>[x+r.left,y+r.top]),
        preferred:[side<0?r.left+band.left-badgeSize-2:side>0?r.left+band.right+2:r.left+(face.left+face.right-badgeSize)/2,
          side?r.top+countTop:r.top-badgeSize-2]});
      Object.assign(marker.style,{
        width:`${badgeSize}px`,minWidth:`${badgeSize}px`,height:`${badgeSize}px`,fontSize:`${clamp(badgeSize*.78,10,11)}px`});
    }
    function decorate(box,tile,seat,kind){
      box.dataset.kind=kind;box.dataset.seat=String(seat);
      box.classList.toggle("raised",tile.classList.contains("selected"));
      box.classList.toggle("draw-highlight",tile.classList.contains("drawn"));
    }
    function card(tile,x,y,standing,seat,size=58,depth=84,kind="open",countSide=0){
      const side=seat===1||seat===3;
      const v=vertices(x,y,standing?(side?22:size):(side&&kind!=="river"?depth:size),
        standing?(side?size:22):(side&&kind!=="river"?size:depth),standing?size*84/58:flatThickness(size));
      const screen=v.map(p),r=bounds(screen),box=frame(tile);
      const local=screen.map(point=>[point[0]-r.left,point[1]-r.top]),radius=clamp(size*.065,1.5,3.5);
      countObstacles.push(convexHull(screen));
      Object.assign(box.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`,
        zIndex:String(Math.round(3000-dot(subtract([x,y,0],eye),forward))),clipPath:`path("${roundedPath(convexHull(local),radius)}")`});
      const main=standing?(seat===3?[6,5,1,2]:seat===1?[4,7,3,0]:[4,5,1,0])
        :kind!=="river"&&side?(seat===3?[6,5,4,7]:[4,7,6,5]):[7,6,5,4];
      const quad=main.map(i=>[screen[i][0]-r.left,screen[i][1]-r.top]);
      const outline=box.querySelector('.tile-body-outline');
      outline.setAttribute('viewBox',`0 0 ${r.right-r.left} ${r.bottom-r.top}`);
      outline.firstChild.setAttribute('d',roundedPath(convexHull(local),radius));
      tile.style.height='84px';
      tile.style.setProperty("transform",`matrix3d(${matrix(quad).join(",")})`,"important");
      decorate(box,tile,seat,kind);box.classList.remove("face-on");
      const sides=standing?[[7,6,5,4],seat===3?[4,5,1,0]:seat===1?[4,5,1,0]:x<0?[5,6,2,1]:[7,4,0,3]]
        :[[0,1,5,4],x<0?[1,2,6,5]:[3,0,4,7]];
      box.querySelectorAll(":scope > .tile-solid-face").forEach((face,i)=>{
        face.style.clipPath=`polygon(${sides[i].map(j=>`${screen[j][0]-r.left}px ${screen[j][1]-r.top}px`).join(",")})`;
        const axis=standing?(side?0:1):2,
          cut=standing?(seat===3?v[0][0]+(v[1][0]-v[0][0])*.60:seat===1?v[0][0]+(v[1][0]-v[0][0])*.40:v[0][1]+(v[3][1]-v[0][1])*.40):flatThickness(size)*.40,
          parts=splitFace(sides[i].map(j=>v[j]),axis,cut,standing&&seat===3);
        for(const name of ['face','back'])face.querySelector(`.${name}-layer`).style.clipPath=parts[name].length>=3
          ?`polygon(${parts[name].map(point=>p(point).map((value,j)=>`${value-(j?r.top:r.left)}px`).join(' ')).join(',')})`:'polygon(0 0,0 0,0 0)';
      });
      const edges=box.querySelector(".tile-back-edges");
      if(edges){
        edges.setAttribute("viewBox",`0 0 ${r.right-r.left} ${r.bottom-r.top}`);
        const contour=ids=>roundedPath(ids.map(j=>local[j]),radius);
        edges.querySelector(".back-edge").setAttribute("d",contour(main));
        edges.querySelector(".top-edge").setAttribute("d",contour(standing?[7,6,5,4]:main));
      }
      updateCount(box,r,quad,countSide);
      return r;
    }
    function frontCard(tile,left,top,size,aspect){
      const faceHeight=size*aspect,lip=Math.max(4,size*.16),box=frame(tile);
      const r={left,top,right:left+size,bottom:top+faceHeight+lip};
      countObstacles.push(rectPolygon(left,top,size,faceHeight+lip));
      Object.assign(box.style,{left:`${left}px`,top:`${top}px`,width:`${size}px`,height:`${faceHeight+lip}px`,zIndex:"1500",
        clipPath:`path("${roundedPath([[0,0],[size,0],[size,faceHeight+lip],[0,faceHeight+lip]],clamp(size*.11,2,5))}")`});
      const quad=[[0,lip],[size,lip],[size,faceHeight+lip],[0,faceHeight+lip]];
      const outline=box.querySelector('.tile-body-outline');
      outline.setAttribute('viewBox',`0 0 ${size} ${faceHeight+lip}`);
      outline.firstChild.setAttribute('d',roundedPath([[0,0],[size,0],[size,faceHeight+lip],[0,faceHeight+lip]],clamp(size*.11,2,5)));
      tile.style.height=`${58*aspect}px`;
      tile.style.setProperty("transform",`matrix3d(${matrix(quad,58,58*aspect).join(",")})`,"important");
      decorate(box,tile,0,"hand");box.classList.add("face-on");
      box.querySelector(".solid-0").style.clipPath=`polygon(0 0,100% 0,100% ${lip}px,0 ${lip}px)`;
      box.querySelector('.solid-0 .back-layer').style.clipPath=`polygon(0 0,100% 0,100% ${lip*.4}px,0 ${lip*.4}px)`;
      box.querySelector('.solid-0 .face-layer').style.clipPath=`polygon(0 ${lip*.4}px,100% ${lip*.4}px,100% ${lip}px,0 ${lip}px)`;
      return r;
    }
    const groups=seat=>[...document.querySelectorAll(`#player${seat} .meld-group,#player${seat} .egg-group`)];
    const groupTiles=group=>[...group.querySelectorAll(".tile")];
    function groupLabel(group,rects){
      if(!rects.length)return;
      const r={left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top))},
        horizontal=group.closest('.seat').id==='player0'||group.closest('.seat').id==='player2',
        countSpace=horizontal&&group.querySelector('.live-egg-count')?clamp(width*.009,11,14)+4:0;
      group.style.setProperty("--group-x",`${r.left}px`);group.style.setProperty("--group-y",`${Math.max(0,r.top-13-countSpace)}px`);
      const style=global.getComputedStyle(group,'::after');
      textMeasure.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const labelWidth=textMeasure.measureText(group.dataset.label||'').width;
      if(labelWidth)countObstacles.push(rectPolygon(r.left,Math.max(0,r.top-13-countSpace),labelWidth+6,13));
    }
    // One reserved flat-front lane. Neither the camera nor another player's
    // hand count changes its baseline, scale, badge or action area.
    const own=[...document.querySelectorAll("#player0 .seat-hand-slot .tile")];
    const aspect=faceAspect(document.body.dataset.tileTheme);
    const publicPlan=seat=>packGroups(groups(seat).map(g=>groupTiles(g).length),seat===0?600:560,1,36),
      ownPlan=publicPlan(0),northPlan=publicPlan(2),
      usedSpan=plan=>plan.groups.at(-1)?plan.groups.at(-1).start+plan.groups.at(-1).length:0,
      ownPublicY=-446+ownPlan.size*84/58/2,
      ownPublicLeft=usedSpan(ownPlan)?p([480-usedSpan(ownPlan),ownPublicY,0])[0]:width;
    // Anchor the first tile to the near-left table corner, not the screen.
    const ownLeft=p([-500,-460,0])[0]+4;
    const ownRight=p([215,-450,0])[0]-8;
    const ownGap=clamp(width*.002,1.5,3),ownSlots=Math.max(own.length+1,15-groups(0).length*3,2),
      ownBaseSize=Math.min(height*.125,(ownRight-ownLeft-14*ownGap)/15),
      ownSize=Math.min(ownBaseSize,
        (ownPublicLeft-ownLeft-10-(ownSlots-1)*ownGap)/ownSlots);
    const ownTop=height-2-ownSize*aspect-Math.max(4,ownSize*.16);
    const ownBandTop=height-2-ownBaseSize*aspect-Math.max(4,ownBaseSize*.16);
    let ownX=ownLeft;
    for(const tile of own){if(tile.classList.contains("drawn"))ownX+=ownSize+ownGap;frontCard(tile,ownX,ownTop,ownSize,aspect);ownX+=ownSize+ownGap;}
    function horizontalPublic(seat,edge,plan,frontY){
      const sets=groups(seat),used=usedSpan(plan),
        minX=seat===0?edge-used:edge;
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],y=frontY;
        group.dataset.publicLane='single';
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,minX+slot.start+plan.size/2+i*plan.step,y,false,seat,plan.size,plan.size*84/58)));
      });
      return used?p([minX,frontY,0])[0]:width;
    }
    const ownPublicStart=horizontalPublic(0,480,ownPlan,ownPublicY);
    const north=[...document.querySelectorAll("#player2 .seat-hand-slot .tile")];
    // Compare actual projected faces, not world sizes: near-side perspective
    // otherwise makes opponents look larger than the player's flat hand.
    const opponentLimit=ownSize*aspect*.82;
    function opponentSize(seat,start,centres){
      let size=start;
      for(let i=0;i<10;i++){
        const largest=Math.max(0,...centres(size).map(([x,y])=>{
          const side=seat===1||seat===3,v=vertices(x,y,side?22:size,side?size:22,size*84/58),
            main=seat===3?[6,5,1,2]:seat===1?[4,7,3,0]:[4,5,1,0],b=bounds(main.map(j=>p(v[j])));
          return Math.max(b.right-b.left,b.bottom-b.top);
        }));
        if(largest<=opponentLimit+.01)break;
        size*=opponentLimit/largest*.995;
      }
      return size;
    }
    const northCap=usedSpan(northPlan)?Math.min(42,(350-(-480+usedSpan(northPlan)+26))/Math.max(1,north.length-.5)):42,
      northSize=opponentSize(2,northCap,size=>north.map((_,i)=>[350-(north.length-1-i)*size,438])),
      northStart=350-Math.max(0,north.length-1)*northSize;
    north.forEach((tile,i)=>card(tile,northStart+i*northSize,438,true,2,northSize,70,"hand"));
    horizontalPublic(2,-480,northPlan,450-northPlan.size*84/58/2);
    for(const seat of [3,1]){
      const tiles=[...document.querySelectorAll(`#player${seat} .seat-hand-slot .tile`)];
      const sideSpan=height<320?350:410;
      const centres=size=>{const step=Math.min(size+1.5,sideSpan/Math.max(1,tiles.length-1));return tiles.map((_,i)=>[seat===3?-375:375,-55+(tiles.length-1)*step/2-i*step]);},
        size=opponentSize(seat,42,centres),positions=centres(size);
      tiles.forEach((tile,i)=>card(tile,...positions[i],true,seat,size,70,"hand"));
      // Keep a dedicated clear strip above the local profile. Extra sets
      // wrap into the second fixed lane rather than growing into that strip.
      const sets=groups(seat),plan=packGroups(sets.map(g=>groupTiles(g).length),390,2,28,4,22);
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],x=(seat===3?-1:1)*(465-slot.lane*45);
        const countSide=(seat===3?-1:1)*(slot.lane===0?1:-1);
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,x,195-slot.start-plan.size/2-i*plan.step,false,seat,plan.size,plan.size*84/58,"open",countSide)));
      });
    }
    // Four disjoint river rectangles, all sharing the table's projection.
    // First rows are fixed; growing a river cannot move its earlier tiles.
    // Only unusually full rivers tighten their cells to retain the history.
    const riverShift=-45;
    for(let seat=0;seat<4;seat++){
      const tiles=[...document.querySelectorAll(`#river${seat} .tile`)];
      const {horizontal,columns,cellY,size,stepX}=riverPlan(seat,tiles.length);
      document.getElementById(`river${seat}`).dataset.columns=String(columns);
      tiles.forEach((tile,i)=>{
        const col=i%columns,row=Math.floor(i/columns);
        const x=horizontal?(col-(columns-1)/2)*stepX:seat===3?-335+col*stepX:160+col*stepX;
        const y=(seat===0?-110-row*cellY:seat===2?275+row*cellY:160-row*cellY)+riverShift;
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
      const target=seat===0?[ownLeft,ownBandTop-bh-11]
        :seat===2?[p([385,438,0])[0]+12,p([0,438,70])[1]]
        :seat===3?[6,sideTop]
        :[width-bw-6,sideTop];
      place(badge,...target);
      placed.push({left:parseFloat(badge.style.left),top:parseFloat(badge.style.top),
        right:parseFloat(badge.style.left)+bw,bottom:parseFloat(badge.style.top)+bh});
    }
    const center=p([0,90+riverShift,8]),ring=document.getElementById("windRing");
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
      publicTop=usedSpan(ownPlan)?bounds(vertices(480-usedSpan(ownPlan)+ownPlan.size/2,ownPublicY,ownPlan.size,ownPlan.size*84/58,flatThickness(ownPlan.size)).map(p)).top:height,
      uiRight=Math.min(ownRight,publicTop<ownBandTop-9?ownPublicStart-8:width),
      uiWidth=Math.max(48,uiRight-uiLeft);
    if(waits){
      // The profile is now on the left. Waiting tiles and
      // actions retain their own bottom strip, independent of that profile.
      waits.style.width=`${waitWidth}px`;
      place(waits,waitLeft,ownBandTop-waits.offsetHeight-11);
    }
    const uiBottom=ownBandTop-11;
    action.style.maxWidth=`${uiWidth}px`;
    place(action,uiLeft+Math.max(0,(uiWidth-action.offsetWidth)/2),uiBottom-action.offsetHeight);
    status.style.width=`${uiWidth}px`;
    place(status,uiLeft,uiBottom-status.offsetHeight);
    for(let seat=0;seat<4;seat++){
      const cue=document.getElementById(`actionCue${seat}`);
      const anchor=p(seat===0?[0,-290,0]:seat===2?[0,350,0]:seat===3?[-270,-30,0]:[270,-30,0]);
      place(cue,anchor[0]-cue.offsetWidth/2,anchor[1]-cue.offsetHeight/2);
    }
    for(const element of [...document.querySelectorAll('.seat-badge-slot'),waits,action,status,ring]){
      if(element&&element.offsetWidth&&element.offsetHeight&&global.getComputedStyle(element).display!=='none')
        countObstacles.push(rectPolygon(parseFloat(element.style.left)||0,parseFloat(element.style.top)||0,element.offsetWidth,element.offsetHeight));
    }
    const positions=placeCounts(countRequests,countObstacles,width,height);
    countRequests.forEach((request,i)=>{
      const [left,top]=positions[i];Object.assign(request.marker.style,{left:`${left}px`,top:`${top}px`});
      // A short leader preserves the association if dense neighbouring sets
      // force the count away from its preferred edge.
      let leader=request.marker.querySelector('svg');
      if(Math.hypot(left-request.preferred[0],top-request.preferred[1])>6){
        if(!leader){leader=document.createElementNS('http://www.w3.org/2000/svg','svg');leader.classList.add('table-count-leader');leader.append(document.createElementNS(leader.namespaceURI,'path'));request.marker.append(leader);}
        const center=[left+request.size/2,top+request.size/2],points=request.quad,
          nearest=points.map((a,j)=>{const b=points[(j+1)%points.length],v=subtract(b,a),t=clamp(dot(subtract(center,a),v)/dot(v,v),0,1);return a.map((n,k)=>n+t*v[k]);})
            .sort((a,b)=>Math.hypot(...subtract(a,center))-Math.hypot(...subtract(b,center)))[0];
        leader.firstChild.setAttribute('d',`M${request.size/2},${request.size/2} L${nearest[0]-left},${nearest[1]-top}`);
      }else if(leader)leader.remove();
    });
  }
  global.MahjongTable={requestLayout,layout,geometry};
  new global.ResizeObserver(requestLayout).observe(table);
  global.addEventListener("resize",requestLayout);
  // Observe only additions/replacements, not our style writes or highlights.
  new global.MutationObserver(requestLayout).observe(table,{childList:true,subtree:true});
  requestLayout();
})(typeof window!=="undefined"?window:globalThis);
