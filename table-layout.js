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
  function publicDepth(x,y,seat,kind){
    const depth=Math.round((3000-dot(subtract([x,y,0],eye),forward))*1000);
    // The right-hand own public lane has equal camera depth along the row.
    // Explicit ordering prevents a later DOM sibling covering the left tile.
    return depth-(seat===0&&kind==='open'?Math.round(x+500):0);
  }
  const polygonArea=points=>Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2);
  function countCorner(quad){
    const r=bounds(quad),w=Math.max(1,r.right-r.left),h=Math.max(1,r.bottom-r.top);
    return quad.slice().sort((a,b)=>Math.hypot((r.right-a[0])/w,(a[1]-r.top)/h)-Math.hypot((r.right-b[0])/w,(b[1]-r.top)/h))[0];
  }
  function rectangleOverlapArea(quad,x,y,size){
    const r=bounds(quad);
    if(r.right<=x||r.left>=x+size||r.bottom<=y||r.top>=y+size)return 0;
    return polygonArea(splitFace(splitFace(splitFace(splitFace(quad,0,x,true).back,0,x+size,false).back,1,y,true).back,1,y+size,false).back);
  }
  function attachedCounts(requests,faces,obstacles,width,height){
    const occupied=[],positions=[],blocked=obstacles.map(bounds),
      measuredFaces=faces.map(face=>({...face,area:Math.max(1,polygonArea(face.quad)),rect:bounds(face.quad)})),
      hits=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.01&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.01;
    for(const request of requests){
      const corner=countCorner(request.quad),area=polygonArea(request.quad);
      let best=null,bestCost=Infinity;
      for(let size=request.size;size>=(width<600?6:7);size--){
        const edges=[...occupied,...blocked],
          xs=[.35,.2,0,.5,.65,.8,1].map(f=>corner[0]-size*f),
          ys=[.8,1,.5,.2,0].map(f=>corner[1]-size*f);
        for(const edge of edges){xs.push(edge.right+.1,edge.left-size-.1);ys.push(edge.bottom+.1,edge.top-size-.1);}
        for(const x of xs.filter(x=>x>=corner[0]-size&&x<=corner[0]))for(const y of ys.filter(y=>y>=corner[1]-size&&y<=corner[1])){
          const fx=(corner[0]-x)/size,fy=(corner[1]-y)/size;
          if(x<1||y<1||x+size>width-1||y+size>height-1)continue;
          const rect={left:x,top:y,right:x+size,bottom:y+size};
          if(occupied.some(p=>hits(rect,p))||blocked.some(p=>hits(rect,p)))continue;
          let worst=rectangleOverlapArea(request.quad,x,y,size)/Math.max(1,area);
          for(const face of measuredFaces)if(face.box!==request.box&&hits(rect,face.rect))
            worst=Math.max(worst,rectangleOverlapArea(face.quad,x,y,size)/face.area);
          const cost=worst*100+(request.size-size)*.5+Math.hypot(fx-.35,fy-.8)*.1;
          if(cost<bestCost){bestCost=cost;best={left:x,top:y,size};}
        }
        if(best&&bestCost<5)break;
      }
      // Never detach a number from its tile. Extremely tight scenes may
      // overlap a tiny corner, but cannot create remote labels or leaders.
      if(!best)best={left:corner[0]-request.size*.35,top:corner[1]-request.size*.8,size:request.size};
      occupied.push({left:best.left,top:best.top,right:best.left+best.size,bottom:best.top+best.size});positions.push(best);
    }
    return positions;
  }
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
  const geometry={project,camera,vertices,matrix,bounds,plane,outerPlane,tableLift,packGroups,flatThickness,convexHull,roundedPath,faceAspect,splitFace,riverPlan,rectPolygon,polygonsOverlap,publicDepth,polygonArea,countCorner,rectangleOverlapArea,attachedCounts};
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
  const countMarkers=new Map(),groupMarkers=new Map();
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
    const activeCounts=new Set(),activeGroups=new Set(),countRequests=[],labelRequests=[],countObstacles=[],tileFaces=[];
    function updateCount(box,r,quad){
      const source=box.querySelector(":scope > .live-egg-count");if(!source)return;
      activeCounts.add(source);
      let marker=countMarkers.get(source);
      if(!marker){marker=document.createElement("sup");marker.className="table-count-badge";countLayer.append(marker);countMarkers.set(source,marker);}
      marker._countSource=source;
      if(marker.textContent!==source.textContent)marker.textContent=source.textContent;
      const face=bounds(quad),badgeSize=clamp(Math.min(face.right-face.left,face.bottom-face.top)*.5,8,11);
      countRequests.push({box,marker,size:Math.round(badgeSize),quad:quad.map(([x,y])=>[x+r.left,y+r.top])});
    }
    function decorate(box,tile,seat,kind){
      box.dataset.kind=kind;box.dataset.seat=String(seat);
      box.classList.toggle("raised",tile.classList.contains("selected"));
      box.classList.toggle("draw-highlight",tile.classList.contains("drawn"));
      box.classList.toggle("inactive-hand",seat===0&&kind==="hand"&&tile.classList.contains("disabled"));
      box.classList.toggle("latest-highlight",kind==="river"&&tile.classList.contains("latest"));
    }
    function card(tile,x,y,standing,seat,size=58,depth=84,kind="open"){
      const side=seat===1||seat===3;
      const v=vertices(x,y,standing?(side?22:size):(side&&kind!=="river"?depth:size),
        standing?(side?size:22):(side&&kind!=="river"?size:depth),standing?size*84/58:flatThickness(size));
      const screen=v.map(p),r=bounds(screen),box=frame(tile);
      const local=screen.map(point=>[point[0]-r.left,point[1]-r.top]),radius=clamp(size*.065,1.5,3.5);
      Object.assign(box.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`,
        zIndex:String(publicDepth(x,y,seat,kind)),clipPath:`path("${roundedPath(convexHull(local),radius)}")`});
      const main=standing?(seat===3?[6,5,1,2]:seat===1?[4,7,3,0]:[4,5,1,0])
        :kind!=="river"&&side?(seat===3?[6,5,4,7]:[4,7,6,5]):[7,6,5,4];
      const quad=main.map(i=>[screen[i][0]-r.left,screen[i][1]-r.top]);
      tileFaces.push({box,quad:main.map(i=>screen[i])});
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
      updateCount(box,r,quad);
      return r;
    }
    function frontCard(tile,left,top,size,aspect){
      const faceHeight=size*aspect,lip=Math.max(4,size*.16),box=frame(tile);
      const r={left,top,right:left+size,bottom:top+faceHeight+lip};
      Object.assign(box.style,{left:`${left}px`,top:`${top}px`,width:`${size}px`,height:`${faceHeight+lip}px`,zIndex:"1500",
        clipPath:`path("${roundedPath([[0,0],[size,0],[size,faceHeight+lip],[0,faceHeight+lip]],clamp(size*.11,2,5))}")`});
      const quad=[[0,lip],[size,lip],[size,faceHeight+lip],[0,faceHeight+lip]];
      tileFaces.push({box,quad:quad.map(([x,y])=>[x+left,y+top])});
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
      const r={left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right)),top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom))},
        countSpace=group.querySelector('.live-egg-count')?clamp(width*.009,8,11)+3:0;
      group.style.setProperty("--group-x",`${r.left}px`);group.style.setProperty("--group-y",`${Math.max(0,r.top-13-countSpace)}px`);
      const style=global.getComputedStyle(group,'::after');
      // Labels cannot live under the public tile's million-level depth order
      // or a sibling set. Reuse foreground text nodes, not the tile images.
      activeGroups.add(group);
      let marker=groupMarkers.get(group);
      if(!marker){marker=document.createElement('span');marker.className='table-group-label';marker._groupSource=group;countLayer.append(marker);groupMarkers.set(group,marker);}
      if(marker.textContent!==group.dataset.label)marker.textContent=group.dataset.label||'';
      group.setAttribute('aria-label',group.dataset.label||'');
      Object.assign(marker.style,{left:group.style.getPropertyValue('--group-x'),top:group.style.getPropertyValue('--group-y'),
        fontWeight:style.fontWeight,fontSize:style.fontSize,fontFamily:style.fontFamily});
      textMeasure.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const labelWidth=textMeasure.measureText(group.dataset.label||'').width;
      if(labelWidth)labelRequests.push({group,marker,rect:r,left:r.left,top:Math.max(0,r.top-13-countSpace),width:labelWidth+6,height:13});
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
      const centres=size=>{const step=Math.min(size+1.5,sideSpan/Math.max(1,tiles.length-1));return tiles.map((_,i)=>[seat===3?-375:375,(height<320?-40:-55)+(tiles.length-1)*step/2-i*step]);},
        size=opponentSize(seat,42,centres),positions=centres(size);
      tiles.forEach((tile,i)=>card(tile,...positions[i],true,seat,size,70,"hand"));
      // One fixed column per side, between its hand and the table rim.
      // Scale complete sets together if many eggs occupy the same column.
      const sets=groups(seat),plan=packGroups(sets.map(g=>groupTiles(g).length),620,1,28,4,50),startY=width<600?260:300;
      sets.forEach((group,index)=>{
        const slot=plan.groups[index],x=(seat===3?-1:1)*465;
        group.dataset.publicLane='single';
        groupLabel(group,groupTiles(group).map((tile,i)=>card(tile,x,startY-slot.start-plan.size/2-i*plan.step,false,seat,plan.size,plan.size*84/58)));
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
    for(const [source,marker] of groupMarkers)if(!activeGroups.has(source)){marker.remove();groupMarkers.delete(source);}
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
      const target=seat===0?[ownLeft,ownBandTop-bh-(height<320?9:11)]
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
    const statusWidth=Math.min(uiWidth,Math.max(48,width-2*uiLeft)),statusLeft=Math.max(uiLeft,width/2-statusWidth/2);
    status.style.width=`${statusWidth}px`;
    place(status,statusLeft,uiBottom-status.offsetHeight);
    for(let seat=0;seat<4;seat++){
      const cue=document.getElementById(`actionCue${seat}`);
      const anchor=p(seat===0?[0,-290,0]:seat===2?[0,350,0]:seat===3?[-270,-30,0]:[270,-30,0]);
      place(cue,anchor[0]-cue.offsetWidth/2,anchor[1]-cue.offsetHeight/2);
    }
    for(const element of [...document.querySelectorAll('.seat-badge-slot'),waits,action,status,ring]){
      if(element&&element.offsetWidth&&element.offsetHeight&&global.getComputedStyle(element).display!=='none'&&global.getComputedStyle(element).visibility!=='hidden')
        countObstacles.push(rectPolygon(parseFloat(element.style.left)||0,parseFloat(element.style.top)||0,element.offsetWidth,element.offsetHeight));
    }
    // Keep hands above everything, but move a group caption into a nearby
    // clear strip if the preferred caption position falls under a hand/UI.
    const labelBlocks=[...countObstacles.map(bounds),...tileFaces.filter(face=>face.box.dataset.kind==='hand').map(face=>({
      left:parseFloat(face.box.style.left),top:parseFloat(face.box.style.top),
      right:parseFloat(face.box.style.left)+parseFloat(face.box.style.width),
      bottom:parseFloat(face.box.style.top)+parseFloat(face.box.style.height)})),
      ...countRequests.map(request=>{const corner=countCorner(request.quad),size=request.size;
        return {left:corner[0]-size,top:corner[1]-size,right:corner[0]+size,bottom:corner[1]+size};})];
    for(const request of labelRequests){
      const w=request.width,h=request.height,
        xs=[request.left,request.rect.right-w,request.left+6,request.left-6,request.left+12,request.left-12,
          request.left+w+3,request.left-w-3],
        ys=[request.top,...Array.from({length:8},(_,i)=>request.top-(i+1)*(h+2)),request.rect.bottom+2,
          ...Array.from({length:4},(_,i)=>request.top+(i+1)*(h+2))];
      let best=null,bestCost=Infinity;
      for(const initialX of xs)for(const initialY of ys){
        const x=clamp(initialX,2,width-w-2),y=clamp(initialY,2,height-h-2),rect={left:x,top:y,right:x+w,bottom:y+h};
        if(labelBlocks.some(block=>Math.min(rect.right,block.right)-Math.max(rect.left,block.left)>-.5
          &&Math.min(rect.bottom,block.bottom)-Math.max(rect.top,block.top)>-.5))continue;
        const cost=Math.hypot(x-request.left,y-request.top);
        if(cost<bestCost){bestCost=cost;best=rect;}
      }
      const rect=best||{left:request.left,top:request.top,right:request.left+w,bottom:request.top+h};
      Object.assign(request.marker.style,{left:`${rect.left}px`,top:`${rect.top}px`});
      request.group.style.setProperty('--group-x',`${rect.left}px`);request.group.style.setProperty('--group-y',`${rect.top}px`);
      labelBlocks.push(rect);countObstacles.push(rectPolygon(rect.left,rect.top,w,h));
    }
    const positions=attachedCounts(countRequests,tileFaces,countObstacles,width,height);
    countRequests.forEach((request,i)=>{
      const {left,top,size}=positions[i];Object.assign(request.marker.style,{left:`${left}px`,top:`${top}px`,
        width:`${size}px`,minWidth:`${size}px`,height:`${size}px`,fontSize:`${clamp(size*.84,6,10)}px`});
    });
  }
  global.MahjongTable={requestLayout,layout,geometry};
  new global.ResizeObserver(requestLayout).observe(table);
  global.addEventListener("resize",requestLayout);
  // Observe only additions/replacements, not our style writes or highlights.
  new global.MutationObserver(requestLayout).observe(table,{childList:true,subtree:true});
  requestLayout();
})(typeof window!=="undefined"?window:globalThis);
