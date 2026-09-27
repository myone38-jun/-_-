(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DAYC=["#F26B2E","#0FA39A","#7C4DDB","#D6337F"];
const WD=["일","월","화","수","목","금","토"];
const won=n=>Math.round(n/10000).toLocaleString("ko-KR")+"만 원";
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

const S={c:store.get("c","hk"),tab:store.get("tab","glance"),day:-1,time:13*60,planDay:0,
  date:{hk:store.get("date_hk","d1210"),tw:store.get("date_tw","d1210")}, fx:{hk:true,tw:false}};
if(!PLAN[S.c])S.c="hk";
const P=()=>PLAN[S.c];
const toMin=s=>{if(!s)return null;const [h,m]=s.split(":").map(Number);return h*60+m;};
const fmtT=m=>{m=Math.round(m);const h=Math.floor(m/60)%24,mm=m%60;return String(h).padStart(2,"0")+":"+String(mm).padStart(2,"0");};
function dateOf(dayIdx,c){c=c||S.c;const d=PLAN[c].dates.find(x=>x.id===S.date[c])||PLAN[c].dates[1];const [y,mo,da]=d.start.split("-").map(Number);return new Date(Date.UTC(y,mo-1,da+dayIdx));}
function dateLabel(i,c){const d=dateOf(i,c);return (d.getUTCMonth()+1)+"/"+d.getUTCDate()+"("+WD[d.getUTCDay()]+")";}

/* ---------------- sun ---------------- */
const RAD=Math.PI/180;
function sunPos(ms,lat,lon){const d=ms/86400000+2440587.5-2451545.0;const g=(357.529+0.98560028*d)*RAD;const q=280.459+0.98564736*d;
  const L=(q+1.915*Math.sin(g)+0.020*Math.sin(2*g))*RAD;const e=(23.439-0.00000036*d)*RAD;
  const ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L));const dec=Math.asin(Math.sin(e)*Math.sin(L));
  const gmst=((18.697374558+24.06570982441908*d)%24+24)%24;const H=(gmst*15+lon)*RAD-ra;const la=lat*RAD;
  const alt=Math.asin(Math.sin(la)*Math.sin(dec)+Math.cos(la)*Math.cos(dec)*Math.cos(H));
  const az=Math.atan2(-Math.sin(H),Math.tan(dec)*Math.cos(la)-Math.sin(la)*Math.cos(H));return{alt,az};}
function sunAt(min,dayIdx){const p=P();const d=dateOf(Math.max(0,dayIdx));const ms=d.getTime()+(min-p.tz*60)*60000;return sunPos(ms,p.sunLL[1],p.sunLL[0]);}
function sunTimes(dayIdx){let rise=null,set=null,prev=null;for(let m=240;m<=1260;m+=2){const a=sunAt(m,dayIdx).alt/RAD+0.833;if(prev!==null){if(prev<0&&a>=0&&rise===null)rise=m;if(prev>=0&&a<0)set=m;}prev=a;}return{rise,set};}

/* ---------------- data decode ---------------- */
const DATA={};
function b64(s){const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
function decode(c){
  if(DATA[c])return DATA[c];
  const el=document.getElementById("d_"+c);const meta=JSON.parse(document.getElementById("m_"+c).textContent);
  const raw=fflate.unzlibSync(b64(el.textContent.trim()));
  let o=0;const blobs=[];for(let i=0;i<4;i++){const n=raw[o]|raw[o+1]<<8|raw[o+2]<<16|raw[o+3]<<24;o+=4;blobs.push(raw.subarray(o,o+n));o+=n;}
  const D={meta,region:feats(blobs[0]),detail:feats(blobs[1]),bld:feats(blobs[2])};
  const db=blobs[3];const dem=new Int16Array(db.byteLength/2);const dv=new DataView(db.buffer,db.byteOffset,db.byteLength);
  for(let i=0;i<dem.length;i++)dem[i]=dv.getInt16(i*2,true);
  D.dem=dem;D.N=meta.dem.n;DATA[c]=D;return D;
}
function feats(u){let p=0;const vu=()=>{let r=0,s=1,b;do{b=u[p++];r+=(b&127)*s;s*=128;}while(b&128);return r;};const zz=n=>(n%2)?-(n+1)/2:n/2;
  const n=vu(),out=new Array(n);
  for(let i=0;i<n;i++){const k=vu(),a=vu(),np=vu();const parts=[];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(let j=0;j<np;j++){const m=vu();const arr=new Float32Array(m*2);let x=0,y=0;
      for(let q=0;q<m;q++){x+=zz(vu());y+=zz(vu());const X=x/2,Y=y/2;arr[q*2]=X;arr[q*2+1]=Y;if(X<x0)x0=X;if(X>x1)x1=X;if(Y<y0)y0=Y;if(Y>y1)y1=Y;}
      parts.push(arr);}
    out[i]={k,a,parts,bb:[x0,y0,x1,y1]};}
  return out;}

/* ---------------- 3D ---------------- */
let R=null; // renderer bundle
let W=null; // world of current country
const cam={tx:0,tz:0,dist:60000,yaw:0,pitch:0.6};
let dirty=true;
function initGL(){
  const canvas=$("#gl");
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,logarithmicDepthBuffer:true,powerPreference:"high-performance"});}
  catch(e){showMapErr("이 기기에서 3D 지도를 열 수 없어요(WebGL 미지원). 아래 여행 계획은 그대로 볼 수 있습니다.");return false;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(50,1,1,500000);
  const hemi=new THREE.HemisphereLight(0xffffff,0x445566,0.8);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffffff,1.0);scene.add(sun);scene.add(sun.target);
  scene.fog=new THREE.Fog(0xbfd6ea,50000,300000);
  const maxTex=renderer.capabilities.maxTextureSize||4096;
  R={renderer,scene,camera,hemi,sun,maxTex,canvas};
  window.addEventListener("resize",resize);resize();
  canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();showMapErr("지도 그래픽이 잠시 중단됐어요. 페이지를 새로고침해 주세요.");});
  setupControls();
  requestAnimationFrame(loop);
  return true;
}
function showMapErr(t){const e=$("#mapErr");e.textContent=t;e.hidden=false;$("#loading").hidden=true;}
function resize(){if(!R||$("#mapWrap").hidden)return;const w=$("#mapWrap").clientWidth,h=$("#mapWrap").clientHeight;R.renderer.setSize(w,h,false);R.camera.aspect=w/h;R.camera.updateProjectionMatrix();dirty=true;}

/* palette */
function pal(c,night){
  if(c==="hk")return night?{sea:"#0A1826",land:"#1A222D",urban:"#232C38",forest:"#17202A",park:"#1B2630",water:"#0E2436",sand:"#2A2A2A",ped:"#2A3340",inst:"#26303C",
      road:["#FFC56E","#FFB54D","#F7A84A","#E8A04E","#C98B48","#9E7446","#6E5840","#5A4A3A","#4E4238"],rail:"#7F95B5",river:"#16324A"}
    :{sea:"#8FB3CC",land:"#EEF1F4",urban:"#E3E5E9",forest:"#D0DAD6",park:"#E1E9E6",water:"#9DC0D8",sand:"#E9E4D8",ped:"#E6E3DD",inst:"#E6E0E4",
      road:["#E09B3D","#E7B35C","#B7C1CC","#C2CAD3","#C7CED6","#CDD3DA","#D5DADF","#DCE0E4","#D2D7DC"],rail:"#6A7482",river:"#9DC0D8"};
  return night?{sea:"#081725",land:"#1B211C",urban:"#262A2E",forest:"#141C16",park:"#18241A",water:"#0B2334",sand:"#2C2A24",ped:"#2D3033",inst:"#2A2A30",
      road:["#FFC56E","#FFB54D","#F7A84A","#E8A04E","#C98B48","#9E7446","#6E5840","#5A4A3A","#4E4238"],rail:"#8C98AA",river:"#123047"}
    :{sea:"#78AFCB",land:"#E3E8D9",urban:"#E8E2D8",forest:"#B8CFA3",park:"#C9DDB3",water:"#8CC1D9",sand:"#EDE3C8",ped:"#EEE6DA",inst:"#EBDCD8",
      road:["#F0A14A","#F5BD62","#FFE3A0","#FFFFFF","#FFFFFF","#FFFFFF","#FAFAF7","#F4F2EC","#F2F0EA"],rail:"#6C6A75",river:"#8CC1D9"};
}
// road kind -> [palette index, width m, min px]
const RW={10:[0,16,2.2],11:[1,14,1.9],12:[2,12,1.6],13:[3,10,1.3],14:[4,8,1.0],15:[5,6,.8],16:[6,4,.6],17:[7,2,.5],18:[8,2.2,.5]};
function drawMap(ctx,bx,Wp,Hp,night,isDetail){
  const D=W.D,pl=pal(S.c,night);const sc=Wp/(bx[2]-bx[0]);
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=pl.sea;ctx.fillRect(0,0,Wp,Hp);
  ctx.setTransform(sc,0,0,sc,-bx[0]*sc,-bx[1]*sc);
  const inb=f=>!(f.bb[2]<bx[0]||f.bb[0]>bx[2]||f.bb[3]<bx[1]||f.bb[1]>bx[3]);
  const poly=(list,k,col)=>{ctx.fillStyle=col;ctx.beginPath();let any=false;for(const f of list){if(f.k!==k||!inb(f))continue;any=true;for(const r of f.parts){ctx.moveTo(r[0],r[1]);for(let i=2;i<r.length;i+=2)ctx.lineTo(r[i],r[i+1]);ctx.closePath();}}if(any)ctx.fill("evenodd");};
  const line=(list,k,col,wm,minpx,dash)=>{ctx.strokeStyle=col;ctx.lineWidth=Math.max(wm,minpx/sc);ctx.setLineDash(dash?dash.map(d=>d/sc):[]);ctx.beginPath();let any=false;
    for(const f of list){if(f.k!==k||!inb(f))continue;any=true;for(const r of f.parts){ctx.moveTo(r[0],r[1]);for(let i=2;i<r.length;i+=2)ctx.lineTo(r[i],r[i+1]);}}if(any)ctx.stroke();};
  ctx.lineCap="round";ctx.lineJoin="round";
  const rg=D.region,dt=D.detail;
  poly(rg,1,pl.land);
  if(!isDetail){poly(rg,5,pl.urban);poly(rg,3,pl.forest);poly(rg,4,pl.park);}
  else{poly(rg,5,pl.urban);poly(dt,3,pl.forest);poly(dt,4,pl.park);poly(dt,7,pl.sand);poly(dt,8,pl.inst);poly(dt,6,pl.ped);}
  // hillshade
  if(W.hs){const g=W.g;const sx=(bx[0]-g.x0)/(g.x1-g.x0)*W.hs.width,sy=(bx[1]-g.z0)/(g.z1-g.z0)*W.hs.height,sw=(bx[2]-bx[0])/(g.x1-g.x0)*W.hs.width,sh=(bx[3]-bx[1])/(g.z1-g.z0)*W.hs.height;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=night?0.5:0.9;ctx.globalCompositeOperation="multiply";ctx.imageSmoothingEnabled=true;
    try{ctx.drawImage(W.hs,sx,sy,sw,sh,0,0,Wp,Hp);}catch(e){}ctx.restore();}
  if(!isDetail){poly(rg,2,pl.water);line(rg,19,pl.river,20,1.2);}
  else{poly(rg,2,pl.water);poly(dt,2,pl.water);line(dt,19,pl.river,8,1.2);line(dt,20,pl.river,3,.8);}
  const list=isDetail?dt:rg;
  for(const k of [18,17,16,15,14,13,12,11,10]){const r=RW[k];if(!isDetail&&k>13)continue;line(list,k,pl.road[r[0]],isDetail?r[1]:r[1]*1.3,isDetail?r[2]:r[2]*1.1,k===18?[3,3]:null);}
  line(list,21,pl.rail,isDetail?3.2:6,isDetail?1.4:1.3,null);
  line(list,21,night?"#1B232D":"#FFFFFF",isDetail?1.4:2.4,isDetail?.6:.5,[10,10]);
  line(list,23,pl.rail,2,1,null);
  ctx.setLineDash([]);
}
function canvasFor(bx,maxPx,maxSide){const w=bx[2]-bx[0],h=bx[3]-bx[1];let s=Math.sqrt(maxPx/(w*h));let Wp=Math.round(w*s),Hp=Math.round(h*s);
  const m=Math.max(Wp,Hp);if(m>maxSide){Wp=Math.round(Wp*maxSide/m);Hp=Math.round(Hp*maxSide/m);}const c=document.createElement("canvas");c.width=Wp;c.height=Hp;return c;}

function buildWorld(c){
  const D=decode(c);const m=D.meta;const N=D.N;
  const g={x0:m.region[0],z0:m.region[1],x1:m.region[2],z1:m.region[3],N};
  const h=new Float32Array(N*N);for(let i=0;i<h.length;i++)h[i]=D.dem[i];
  W={c,D,g,h,objs:[],pins:[],night:null};
  // land mask
  const mc=document.createElement("canvas");mc.width=N;mc.height=N;const mx=mc.getContext("2d");
  const sx=(N-1)/(g.x1-g.x0),sz=(N-1)/(g.z1-g.z0);
  mx.setTransform(sx,0,0,sz,-g.x0*sx+0.5,-g.z0*sz+0.5);mx.fillStyle="#fff";mx.beginPath();
  for(const f of D.region){if(f.k!==1)continue;for(const r of f.parts){mx.moveTo(r[0],r[1]);for(let i=2;i<r.length;i+=2)mx.lineTo(r[i],r[i+1]);mx.closePath();}}
  mx.fill("evenodd");const md=mx.getImageData(0,0,N,N).data;
  for(let i=0;i<N*N;i++){if(md[i*4+3]<128)h[i]=-6;else h[i]=Math.max(h[i],0.8);}
  // hillshade
  const hs=document.createElement("canvas");hs.width=N;hs.height=N;const hx=hs.getContext("2d");const id=hx.createImageData(N,N);
  const cx=(g.x1-g.x0)/(N-1),cz=(g.z1-g.z0)/(N-1);const L=[-0.55,0.62,-0.55];const ln=Math.hypot(...L);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const i0=Math.max(0,i-1),i1=Math.min(N-1,i+1),j0=Math.max(0,j-1),j1=Math.min(N-1,j+1);
    const dx=(h[j*N+i1]-h[j*N+i0])/((i1-i0)*cx),dz=(h[j1*N+i]-h[j0*N+i])/((j1-j0)*cz);
    const nx=-dx*1.6,ny=1,nz=-dz*1.6;const nl=Math.hypot(nx,ny,nz);let d=(nx*L[0]+ny*L[1]+nz*L[2])/(nl*ln);d=Math.max(0,Math.min(1,d/0.75));
    const v=Math.round(255*(0.74+0.26*d));const o=(j*N+i)*4;id.data[o]=v;id.data[o+1]=v;id.data[o+2]=v;id.data[o+3]=255;}
  hx.putImageData(id,0,0);W.hs=hs;
  // terrain mesh
  const pos=new Float32Array(N*N*3),uv=new Float32Array(N*N*2);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i;pos[k*3]=g.x0+i*cx;pos[k*3+1]=h[k];pos[k*3+2]=g.z0+j*cz;uv[k*2]=i/(N-1);uv[k*2+1]=1-j/(N-1);}
  const idx=new Uint32Array((N-1)*(N-1)*6);let q=0;
  for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++){const a=j*N+i,b=(j+1)*N+i,cc=(j+1)*N+i+1,d=j*N+i+1;idx[q++]=a;idx[q++]=b;idx[q++]=d;idx[q++]=b;idx[q++]=cc;idx[q++]=d;}
  const tg=new THREE.BufferGeometry();tg.setAttribute("position",new THREE.BufferAttribute(pos,3));tg.setAttribute("uv",new THREE.BufferAttribute(uv,2));tg.setIndex(new THREE.BufferAttribute(idx,1));tg.computeVertexNormals();
  const regBx=[g.x0,g.z0,g.x1,g.z1];
  const rc=canvasFor(regBx,9.5e6,Math.min(R.maxTex,3584));
  const rtex=new THREE.CanvasTexture(rc);rtex.anisotropy=Math.min(8,R.renderer.capabilities.getMaxAnisotropy());rtex.colorSpace=THREE.SRGBColorSpace;
  const tmat=new THREE.MeshLambertMaterial({map:rtex,emissiveMap:rtex,emissive:0xffffff,emissiveIntensity:0});
  const terr=new THREE.Mesh(tg,tmat);add(terr);
  W.tex=[{canvas:rc,tex:rtex,bx:regBx,detail:false}];W.tmat=[tmat];
  // outer sea
  const seaM=new THREE.MeshBasicMaterial({color:0x78afcb});const sea=new THREE.Mesh(new THREE.PlaneGeometry(900000,900000),seaM);sea.rotation.x=-Math.PI/2;sea.position.set((g.x0+g.x1)/2,-8,(g.z0+g.z1)/2);add(sea);W.seaM=seaM;
  // detail patches
  W.patches=[];
  for(const [id,bx] of Object.entries(m.details)){
    const w=bx[2]-bx[0],hh=bx[3]-bx[1];const area=w*hh;const maxPx=Math.min(3.2e6,area/(1.4*1.4));
    const cv=canvasFor(bx,maxPx,Math.min(R.maxTex,2560));
    const tx=new THREE.CanvasTexture(cv);tx.anisotropy=rtex.anisotropy;tx.colorSpace=THREE.SRGBColorSpace;
    const nx=Math.max(8,Math.min(160,Math.round(w/25))),nz=Math.max(8,Math.min(160,Math.round(hh/25)));
    const pp=new Float32Array((nx+1)*(nz+1)*3),pu=new Float32Array((nx+1)*(nz+1)*2);const pi=[];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const k=j*(nx+1)+i;const x=bx[0]+w*i/nx,z=bx[1]+hh*j/nz;pp[k*3]=x;pp[k*3+1]=Hh(x,z)+1.6;pp[k*3+2]=z;pu[k*2]=i/nx;pu[k*2+1]=1-j/nz;}
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=(j+1)*(nx+1)+i,cc=b+1,d=a+1;pi.push(a,b,d,b,cc,d);}
    const pg=new THREE.BufferGeometry();pg.setAttribute("position",new THREE.BufferAttribute(pp,3));pg.setAttribute("uv",new THREE.BufferAttribute(pu,2));pg.setIndex(pi);pg.computeVertexNormals();
    const pm=new THREE.MeshLambertMaterial({map:tx,emissiveMap:tx,emissive:0xffffff,emissiveIntensity:0});
    const mesh=new THREE.Mesh(pg,pm);mesh.renderOrder=1;add(mesh);
    W.patches.push({id,bx,mesh});W.tex.push({canvas:cv,tex:tx,bx,detail:true});W.tmat.push(pm);
  }
  buildBuildings();
  buildRoutes();
  buildPins();
  buildFx();
}
function add(o){R.scene.add(o);W.objs.push(o);}
function Hh(x,z){const g=W.g,N=g.N,h=W.h;let gx=(x-g.x0)/(g.x1-g.x0)*(N-1),gz=(z-g.z0)/(g.z1-g.z0)*(N-1);
  gx=Math.max(0,Math.min(N-1.0001,gx));gz=Math.max(0,Math.min(N-1.0001,gz));const i=Math.floor(gx),j=Math.floor(gz),fx=gx-i,fz=gz-j;
  const a=h[j*N+i],b=h[(j+1)*N+i],c=h[(j+1)*N+i+1],d=h[j*N+i+1];
  return (fx+fz<=1)?a+(d-a)*fx+(b-a)*fz:c+(b-c)*(1-fx)+(d-c)*(1-fz);}
function disposeWorld(){if(!W)return;for(const o of W.objs){R.scene.remove(o);o.traverse&&o.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){(Array.isArray(n.material)?n.material:[n.material]).forEach(mm=>{for(const k in mm){const v=mm[k];if(v&&v.isTexture)v.dispose();}mm.dispose();});}});}
  $("#labels").innerHTML="";W=null;}

/* buildings */
function winTex(lit){const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");
  x.fillStyle=lit?"#000":"#FFFFFF";x.fillRect(0,0,128,128);
  let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let j=0;j<4;j++)for(let i=0;i<4;i++){if(i===0&&j===0)continue;const on=rnd();
    if(lit){if(on<0.55){x.fillStyle=on<0.12?"#9FC4FF":"#FFD28A";x.fillRect(i*32+8,j*32+9,16,14);}}
    else{x.fillStyle="#B9C3CE";x.fillRect(i*32+8,j*32+9,16,14);}}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t;}
function buildBuildings(){
  const B=W.D.bld;let nv=0,ni=0;const rings=[];
  for(const f of B){const r=f.parts[0];let n=r.length/2;if(n<4)continue;if(r[0]===r[(n-1)*2]&&r[1]===r[(n-1)*2+1])n--;if(n<3)continue;rings.push([f,r,n]);nv+=n*4+n;ni+=n*6+(n-2)*3;}
  const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),uv=new Float32Array(nv*2),col=new Float32Array(nv*3);const idx=new Uint32Array(ni);
  let v=0,q=0;const tmp=new THREE.Color();
  for(const [f,r,n] of rings){
    let a2=0;for(let i=0;i<n;i++){const j=(i+1)%n;a2+=r[i*2]*r[j*2+1]-r[j*2]*r[i*2+1];}
    const X=[],Z=[];for(let i=0;i<n;i++){const s=a2>0?n-1-i:i;X.push(r[s*2]);Z.push(r[s*2+1]);}
    let cx=0,cz=0,mn=1e9;for(let i=0;i<n;i++){cx+=X[i];cz+=Z[i];const hh=Hh(X[i],Z[i]);if(hh<mn)mn=hh;}cx/=n;cz/=n;
    const base=mn-1.5,top=Math.max(Hh(cx,cz),mn)+f.a/10;
    const est=f.k===31;const hgt=f.a/10;const t=Math.min(1,hgt/120);
    tmp.setHSL(S.c==="hk"?0.58:0.08,est?0.06:0.1,0.86-t*0.2);
    let per=0;
    for(let i=0;i<n;i++){const j=(i+1)%n;const dx=X[j]-X[i],dz=Z[j]-Z[i];const L=Math.hypot(dx,dz)||1;const nx=-dz/L,nz=dx/L;
      const vs=[[X[i],base,Z[i],per,0],[X[j],base,Z[j],per+L,0],[X[j],top,Z[j],per+L,top-base],[X[i],top,Z[i],per,top-base]];
      for(const p of vs){pos[v*3]=p[0];pos[v*3+1]=p[1];pos[v*3+2]=p[2];nor[v*3]=nx;nor[v*3+1]=0;nor[v*3+2]=nz;uv[v*2]=p[3]/14+0.02;uv[v*2+1]=(p[4]/13.2)+0.02;col[v*3]=tmp.r;col[v*3+1]=tmp.g;col[v*3+2]=tmp.b;v++;}
      const o=v-4;idx[q++]=o;idx[q++]=o+1;idx[q++]=o+2;idx[q++]=o;idx[q++]=o+2;idx[q++]=o+3;per+=L;}
    const ro=v;const cont=[];for(let i=0;i<n;i++){pos[v*3]=X[i];pos[v*3+1]=top;pos[v*3+2]=Z[i];nor[v*3+1]=1;uv[v*2]=0.03;uv[v*2+1]=0.03;col[v*3]=tmp.r*0.93;col[v*3+1]=tmp.g*0.93;col[v*3+2]=tmp.b*0.93;v++;cont.push(new THREE.Vector2(X[i],Z[i]));}
    let tris=[];try{tris=THREE.ShapeUtils.triangulateShape(cont,[]);}catch(e){}
    for(let k=0;k<n-2;k++){const tr=tris[k];if(!tr){idx[q++]=ro;idx[q++]=ro;idx[q++]=ro;continue;}
      const [a,b,c]=tr;const cr=(X[b]-X[a])*(Z[c]-Z[a])-(Z[b]-Z[a])*(X[c]-X[a]);
      if(cr<0){idx[q++]=ro+a;idx[q++]=ro+b;idx[q++]=ro+c;}else{idx[q++]=ro+a;idx[q++]=ro+c;idx[q++]=ro+b;}}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));geo.setAttribute("normal",new THREE.BufferAttribute(nor,3));
  geo.setAttribute("uv",new THREE.BufferAttribute(uv,2));geo.setAttribute("color",new THREE.BufferAttribute(col,3));geo.setIndex(new THREE.BufferAttribute(idx,1));
  const mat=new THREE.MeshLambertMaterial({vertexColors:true,map:winTex(false),emissiveMap:winTex(true),emissive:0xffffff,emissiveIntensity:0});
  const mesh=new THREE.Mesh(geo,mat);mesh.renderOrder=2;add(mesh);W.bmat=mat;
}

/* routes */
const RV=`uniform float uW;uniform vec2 uRes;attribute vec3 tdir;attribute float side;attribute float dist;attribute float mode;varying float vDist;varying float vMode;varying float vSide;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){vec4 c=projectionMatrix*modelViewMatrix*vec4(position,1.0);vec4 c2=projectionMatrix*modelViewMatrix*vec4(position+tdir,1.0);
vec2 s1=c.xy/c.w,s2=c2.xy/c2.w;vec2 d=(s2-s1)*uRes;float l=length(d);d=l>1e-6?d/l:vec2(1.0,0.0);vec2 n=vec2(-d.y,d.x);
c.xy+=n*side*uW/uRes*c.w;gl_Position=c;vDist=dist;vMode=mode;vSide=side;
#include <logdepthbuf_vertex>
}`;
const RF=`uniform vec3 uCol;uniform float uOp;uniform float uDash;varying float vDist;varying float vMode;varying float vSide;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
#include <logdepthbuf_fragment>
float a=uOp;if(vMode>0.5&&vMode<1.5){if(mod(vDist/uDash,1.0)>0.62)a*=0.25;}else if(vMode>1.5){if(mod(vDist/(uDash*0.45),1.0)>0.55)discard;}
gl_FragColor=vec4(uCol,a);}`;
function routeGeom(legs){
  const P3=[],T=[],Sd=[],Ds=[],Md=[],I=[];let base=0;
  for(const leg of legs){const pts=densify(leg.pts,S.c==="hk"&&leg.len>20000?120:25);const md=leg.mode==="train"?1:leg.mode==="walk"?2:0;let dist=0;
    const n=pts.length;const Y=pts.map(p=>Hh(p[0],p[1])+(leg.mode==="train"?6:4));
    for(let i=0;i<n;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(n-1,i+1)];let tx=b[0]-a[0],tz=b[1]-a[1];const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;
      if(i>0)dist+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
      for(const s of[-1,1]){P3.push(pts[i][0],Y[i],pts[i][1]);T.push(tx*5,0,tz*5);Sd.push(s);Ds.push(dist);Md.push(md);}}
    for(let i=0;i<n-1;i++){const a=base+i*2;I.push(a,a+1,a+2,a+1,a+3,a+2);}base+=n*2;}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(P3,3));g.setAttribute("tdir",new THREE.Float32BufferAttribute(T,3));
  g.setAttribute("side",new THREE.Float32BufferAttribute(Sd,1));g.setAttribute("dist",new THREE.Float32BufferAttribute(Ds,1));g.setAttribute("mode",new THREE.Float32BufferAttribute(Md,1));g.setIndex(I);
  g.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e7);return g;}
function densify(pts,step){const out=[pts[0]];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];const d=Math.hypot(b[0]-a[0],b[1]-a[1]);const k=Math.ceil(d/step);for(let j=1;j<=k;j++)out.push([a[0]+(b[0]-a[0])*j/k,a[1]+(b[1]-a[1])*j/k]);}return out;}
function routeMat(col,w,order){return new THREE.ShaderMaterial({vertexShader:RV,fragmentShader:RF,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{uW:{value:w},uRes:{value:new THREE.Vector2(1,1)},uCol:{value:new THREE.Color(col)},uOp:{value:1},uDash:{value:100}}});}
function buildRoutes(){W.routes=[];const rs=W.D.meta.routes;
  rs.forEach((legs,d)=>{const g=routeGeom(legs);const under=new THREE.Mesh(g,routeMat("#ffffff",4.6));under.renderOrder=10;const top=new THREE.Mesh(g,routeMat(DAYC[d],2.6));top.renderOrder=11;
    under.frustumCulled=top.frustumCulled=false;add(under);add(top);W.routes.push({under,top});});}
function styleRoutes(){if(!W)return;const res=new THREE.Vector2();R.renderer.getDrawingBufferSize(res);res.multiplyScalar(0.5);const pr=R.renderer.getPixelRatio();
  W.routes.forEach((r,d)=>{const on=S.day<0||S.day===d;for(const m of[r.under,r.top]){m.visible=true;m.material.uniforms.uRes.value.copy(res);m.material.uniforms.uOp.value=on?1:0.22;m.material.uniforms.uDash.value=cam.dist*0.03;}
    r.top.material.uniforms.uW.value=(on?5:3)*pr/2;r.under.material.uniforms.uW.value=(on?8.5:5)*pr/2;r.under.material.uniforms.uOp.value=on?0.9:0.15;});}

/* pins & labels */
function buildPins(){const L=$("#labels");L.innerHTML="";W.pins=[];const m=W.D.meta;
  P().days.forEach((day,d)=>{day.stops.forEach((st,i)=>{const seen=W.pins.find(p=>p.id===st.id&&p.d===d);if(seen)return;
    const ll=m.stops[st.id];if(!ll)return;const el=document.createElement("div");el.className="pin";
    el.innerHTML=`<b style="background:${DAYC[d]}">${d+1}-${i+1}</b><span>${esc(st.name.replace(/^(저녁|점심): /,""))}</span>`;
    el.addEventListener("click",ev=>{ev.stopPropagation();openStop(d,i);});L.appendChild(el);
    W.pins.push({id:st.id,d,i,el,x:ll[0],z:ll[1],y:Hh(ll[0],ll[1])+8});});});
  for(const a of P().areas){const bx=m.details[a.id];if(!bx)continue;const el=document.createElement("div");el.className="alabel";el.textContent=a.label;L.appendChild(el);
    const x=(bx[0]+bx[2])/2,z=(bx[1]+bx[3])/2;W.pins.push({area:true,el,x,z,y:Hh(x,z)+50});}
  const me=document.createElement("div");me.className="me";me.textContent="👪";me.hidden=true;L.appendChild(me);W.me={el:me,x:0,z:0,y:0};}
const V3=typeof THREE!=="undefined"?new THREE.Vector3():null;
function placeLabels(){if(!W)return;const w=R.canvas.clientWidth,h=R.canvas.clientHeight;const far=cam.dist>25000;
  for(const p of W.pins){V3.set(p.x,p.y,p.z).project(R.camera);const vis=V3.z<1&&V3.x>-1.2&&V3.x<1.2&&V3.y>-1.2&&V3.y<1.2;
    if(!vis){p.el.style.display="none";continue;}
    if(p.area){p.el.style.display=cam.dist>6000?"":"none";}
    else{const on=S.day<0||S.day===p.d;p.el.style.display="";p.el.classList.toggle("dim",!on||far);p.el.classList.toggle("small",far&&!(S.day===p.d&&cam.dist<60000));p.el.style.zIndex=on?2:1;}
    const sx=(V3.x*0.5+0.5)*w,sy=(-V3.y*0.5+0.5)*h;p.sx=sx;p.sy=sy;
    p.el.style.transform=`translate(${sx}px,${sy}px) translate(-50%,${p.area?"-50%":"-100%"})`;}
  // hide overlapping name tags (selected day first)
  const boxes=[];const order=W.pins.filter(p=>!p.area&&p.el.style.display!=="none"&&!p.el.classList.contains("dim")).sort((a,b)=>(b.d===S.day)-(a.d===S.day)||a.i-b.i);
  for(const p of order){const tw=(p.tw||(p.tw=p.el.querySelector("span").textContent.length*11+14));const bx=[p.sx-tw/2,p.sy-2,p.sx+tw/2,p.sy+18];
    const hit=boxes.some(b=>!(bx[2]<b[0]||bx[0]>b[2]||bx[3]<b[1]||bx[1]>b[3]));p.el.classList.toggle("nolab",hit);if(!hit)boxes.push(bx);}
  const me=W.me;if(!me.el.hidden){V3.set(me.x,me.y,me.z).project(R.camera);me.el.style.transform=`translate(${(V3.x*0.5+0.5)*w}px,${(-V3.y*0.5+0.5)*h}px) translate(-50%,-50%)`;}}

/* weather fx */
function buildFx(){const n=1100;const g=new THREE.BufferGeometry();const p=new Float32Array(n*3);for(let i=0;i<n*3;i++)p[i]=Math.random();g.setAttribute("position",new THREE.BufferAttribute(p,3));
  const snow=P().weatherFx==="snow";
  const dc=document.createElement("canvas");dc.width=dc.height=32;const dx=dc.getContext("2d");
  if(snow){const gr=dx.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,"rgba(255,255,255,1)");gr.addColorStop(0.5,"rgba(255,255,255,.8)");gr.addColorStop(1,"rgba(255,255,255,0)");dx.fillStyle=gr;dx.fillRect(0,0,32,32);}
  else{dx.strokeStyle="rgba(200,220,240,.9)";dx.lineWidth=2;dx.beginPath();dx.moveTo(18,2);dx.lineTo(14,30);dx.stroke();}
  const m=new THREE.PointsMaterial({color:0xffffff,map:new THREE.CanvasTexture(dc),size:snow?(0.9+Math.random()*0)*window.devicePixelRatio*3:10,sizeAttenuation:false,transparent:true,opacity:snow?0.85:0.55,depthWrite:false});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.renderOrder=20;add(pts);W.fx={pts,base:p.slice(),t:0};}
function updFx(dt){if(!W||!W.fx)return false;const on=S.fx[S.c]&&cam.dist<9000;W.fx.pts.visible=on;if(!on)return false;
  const snow=P().weatherFx==="snow";W.fx.t+=dt*(snow?0.05:0.5);const a=W.fx.pts.geometry.attributes.position;const b=W.fx.base;const size=Math.min(cam.dist*1.6,5000);const hgt=size*0.6;
  const cy=Hh(cam.tx,cam.tz);
  for(let i=0;i<a.count;i++){const fx=b[i*3],fy=b[i*3+1],fz=b[i*3+2];let y=((fy-W.fx.t*(0.6+fy*0.4))%1+1)%1;
    const sw=snow?Math.sin(W.fx.t*6+i)*0.01:0;a.array[i*3]=cam.tx+(fx-0.5+sw)*size;a.array[i*3+1]=cy+y*hgt;a.array[i*3+2]=cam.tz+(fz-0.5)*size;}
  a.needsUpdate=true;return true;}

/* lighting & time */
let lastNight=null;
function applyTime(){if(!R)return;const di=S.day<0?0:S.day;const s=sunAt(S.time,di);const alt=s.alt,az=s.az;
  const f=Math.max(0,Math.min(1,(alt/RAD+6)/16));const night=alt/RAD<-4;
  const sky=new THREE.Color(S.c==="hk"?"#C4D7E8":"#A7CBE6");const dusk=new THREE.Color("#E9A27A");const nt=new THREE.Color("#0B1426");
  let col;if(f>=1)col=sky;else if(f>0.35)col=dusk.clone().lerp(sky,(f-0.35)/0.65);else col=nt.clone().lerp(dusk,f/0.35);
  R.scene.background=col;R.scene.fog.color.copy(col);
  R.sun.intensity=1.25*f;R.hemi.intensity=night?0.18:0.35+0.55*f;
  const dx=Math.sin(az)*Math.cos(alt),dy=Math.max(0.15,Math.sin(alt)),dz=-Math.cos(az)*Math.cos(alt);
  R.sun.position.set(cam.tx+dx*10000,dy*10000,cam.tz+dz*10000);R.sun.target.position.set(cam.tx,0,cam.tz);
  R.sun.color.set(f<0.6?"#FFC89A":"#FFFFFF");
  if(W){W.tmat.forEach(m=>m.emissiveIntensity=night?0.95:0);W.bmat.emissiveIntensity=night?1.1:0;W.bmat.color.set(night?"#3A4250":"#FFFFFF");
    W.seaM.color.set(pal(S.c,night).sea);
    if(night!==W.night){W.night=night;repaint();}}
  lastNight=night;
  $("#clock").textContent=fmtT(S.time);
  const st=sunTimes(di);$("#sunTxt").textContent=(S.day<0?"":dateLabel(di)+" ")+"해 뜸 "+(st.rise?fmtT(st.rise):"-")+" · 해 짐 "+(st.set?fmtT(st.set):"-");
  $("#bNight").textContent=night?"낮으로":"밤으로";dirty=true;}
function repaint(){for(const t of W.tex){const x=t.canvas.getContext("2d");drawMap(x,t.bx,t.canvas.width,t.canvas.height,W.night,t.detail);t.tex.needsUpdate=true;}}

/* controls */
function camApply(){if(!R)return;const c=R.camera;const ty=W?Hh(cam.tx,cam.tz):0;
  cam.pitch=Math.max(0.05,Math.min(1.25,cam.pitch));cam.dist=Math.max(120,Math.min(170000,cam.dist));
  if(W){const g=W.g;cam.tx=Math.max(g.x0,Math.min(g.x1,cam.tx));cam.tz=Math.max(g.z0,Math.min(g.z1,cam.tz));}
  const sp=Math.sin(cam.pitch),cp=Math.cos(cam.pitch);const off=tour?cam.dist*0.35*sp:0;const lx=cam.tx+off*Math.sin(cam.yaw),lz=cam.tz+off*Math.cos(cam.yaw);let px=cam.tx+cam.dist*sp*Math.sin(cam.yaw),py=ty+cam.dist*cp,pz=cam.tz+cam.dist*sp*Math.cos(cam.yaw);
  if(W){const gh=Hh(px,pz)+40;if(py<gh)py=gh;}
  px+=lx-cam.tx;pz+=lz-cam.tz;if(W){const gh=Hh(px,pz)+40;if(py<gh)py=gh;}c.position.set(px,py,pz);c.lookAt(lx,W?Hh(lx,lz):0,lz);c.near=Math.max(1,cam.dist*0.01);c.far=Math.max(60000,cam.dist*12+80000);c.updateProjectionMatrix();
  R.scene.fog.near=cam.dist*2.5+2000;R.scene.fog.far=cam.dist*9+60000;
  if(W&&W.patches)for(const p of W.patches)p.mesh.visible=cam.dist<45000;
  styleRoutes();dirty=true;}
let anim=null;let tour=null;
function flyTo(t,dur,cb){const s={...cam};const T={tx:t.tx??cam.tx,tz:t.tz??cam.tz,dist:t.dist??cam.dist,yaw:t.yaw??cam.yaw,pitch:t.pitch??cam.pitch};
  let dy=T.yaw-s.yaw;while(dy>Math.PI)dy-=2*Math.PI;while(dy<-Math.PI)dy+=2*Math.PI;
  const reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;dur=reduce?0:(dur??1400);const t0=performance.now();
  anim={step(now){let k=dur?Math.min(1,(now-t0)/dur):1;const e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
    cam.tx=s.tx+(T.tx-s.tx)*e;cam.tz=s.tz+(T.tz-s.tz)*e;cam.dist=Math.exp(Math.log(s.dist)+(Math.log(T.dist)-Math.log(s.dist))*e);cam.yaw=s.yaw+dy*e;cam.pitch=s.pitch+(T.pitch-s.pitch)*e;
    camApply();if(k>=1){anim=null;cb&&cb();}}};}
function fitPts(pts,pitch,dur){if(!pts.length)return;let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;for(const p of pts){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
  const w=Math.max(300,x1-x0),h=Math.max(300,z1-z0);const asp=R?R.camera.aspect:0.8;const fv=Math.tan(25*RAD);
  const dist=Math.max(h/(2*fv),w/(2*fv*asp))*1.35+400;flyTo({tx:(x0+x1)/2,tz:(z0+z1)/2+h*0.08,dist,pitch:pitch??0.55,yaw:0},dur);}
function setupControls(){const el=$("#mapWrap");const pts=new Map();let last=null;
  const world=()=>cam.dist*2*Math.tan(25*RAD)/R.canvas.clientHeight;
  const pan=(dx,dy)=>{const k=world();const s=Math.sin(cam.yaw),c=Math.cos(cam.yaw);const ky=k/Math.max(0.35,Math.cos(cam.pitch)*0.8+0.2);
    cam.tx-=dx*k*c+dy*ky*s;cam.tz-=-dx*k*s+dy*ky*c;};
  const stop=()=>{anim=null;if(tour&&tour.playing)tourPause();};
  el.addEventListener("pointerdown",e=>{if(e.target.closest("button,input,.tour,.pin,.pcard"))return;el.setPointerCapture&&el.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});last=null;stop();});
  el.addEventListener("pointermove",e=>{if(!pts.has(e.pointerId))return;const p=pts.get(e.pointerId);const nx=e.clientX,ny=e.clientY;
    if(pts.size===1){const rot=e.buttons===2||e.shiftKey||e.ctrlKey;if(rot){cam.yaw-=(nx-p.x)*0.005;cam.pitch+=(ny-p.y)*0.005;}else pan(nx-p.x,ny-p.y);p.x=nx;p.y=ny;camApply();}
    else if(pts.size===2){p.x=nx;p.y=ny;const [a,b]=[...pts.values()];const d=Math.hypot(a.x-b.x,a.y-b.y),ang=Math.atan2(b.y-a.y,b.x-a.x),my=(a.y+b.y)/2,mx=(a.x+b.x)/2;
      if(last){cam.dist*=last.d/d;let da=ang-last.ang;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;cam.yaw-=da;cam.pitch+=(my-last.my)*0.004;pan(mx-last.mx,0);camApply();}
      last={d,ang,my,mx};}});
  const up=e=>{pts.delete(e.pointerId);last=null;};el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
  el.addEventListener("contextmenu",e=>e.preventDefault());
  el.addEventListener("wheel",e=>{e.preventDefault();stop();cam.dist*=Math.exp(e.deltaY*0.0012);camApply();},{passive:false});}

/* timeline */
function dayTimeline(d){const day=P().days[d];const legs=W?W.D.meta.routes[d]:null;const st=day.stops;const ev=[];
  for(let i=0;i<st.length;i++){const a=toMin(st[i].arr),b=toMin(st[i].dep);ev.push({type:"stop",i,t0:a??b,t1:b??a});
    if(i<st.length-1)ev.push({type:"leg",i,t0:b,t1:toMin(st[i+1].arr),leg:legs?legs[i]:null});}
  return ev;}
function posAt(d,t){if(!W)return null;const ev=dayTimeline(d);const stp=W.D.meta.stops;const s0=ev[0];
  if(t<=s0.t1){const p=stp[P().days[d].stops[0].id];return{x:p[0],z:p[1],label:P().days[d].stops[0].name};}
  for(const e of ev){if(t>=e.t0&&t<=e.t1){
    if(e.type==="stop"){const p=stp[P().days[d].stops[e.i].id];return{x:p[0],z:p[1],label:P().days[d].stops[e.i].name};}
    const k=(t-e.t0)/Math.max(1,e.t1-e.t0);const q=alongPath(e.leg.pts,k);return{x:q[0],z:q[1],label:modeKo(e.leg.mode)+" 이동 중 → "+P().days[d].stops[e.i+1].name};}}
  const last=P().days[d].stops[P().days[d].stops.length-1];const p=stp[last.id];return{x:p[0],z:p[1],label:last.name};}
function alongPath(pts,k){let L=0;const seg=[];for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);seg.push(d);L+=d;}
  let t=k*L;for(let i=0;i<seg.length;i++){if(t<=seg[i]){const f=seg[i]?t/seg[i]:0;return[pts[i][0]+(pts[i+1][0]-pts[i][0])*f,pts[i][1]+(pts[i+1][1]-pts[i][1])*f];}t-=seg[i];}return pts[pts.length-1];}
const modeKo=m=>({train:"기차",walk:"도보",taxi:"택시",van:"전용 밴",bus:"버스"}[m]||m);
function updMe(){if(!W)return;const me=W.me;if(S.day<0){me.el.hidden=true;$("#whereTxt").textContent="";return;}
  const p=posAt(S.day,S.time);if(!p){me.el.hidden=true;return;}me.x=p.x;me.z=p.z;me.y=Hh(p.x,p.z)+10;me.el.hidden=false;$("#whereTxt").textContent=p.label;dirty=true;}

/* loop */
let lt=performance.now();
function loop(now){requestAnimationFrame(loop);const dt=Math.min(0.1,(now-lt)/1000);lt=now;
  if(anim)anim.step(now);if(tour&&tour.playing)tourStep(now);
  const fx=updFx(dt);
  if(!dirty&&!fx&&!anim)return;dirty=false;
  if(!R||!W||$("#mapWrap").hidden)return;R.renderer.render(R.scene,R.camera);placeLabels();}

/* ---------------- tour ---------------- */
function startTour(d){if(!W){alertMap();return;}$("#pcard").hidden=true;S.day=d;syncDayUI();document.body.classList.add("touring");$("#tour").hidden=false;resize();
  const ev=dayTimeline(d);tour={d,ev,k:0,playing:true,phase:null};$("#tourBar").style.background=DAYC[d];tourGo(0);}
function alertMap(){showMapErr("지도가 아직 준비되지 않았어요. 잠시 후 다시 눌러 주세요.");}
function tourGo(k,back){if(!tour)return;k=Math.max(0,Math.min(tour.ev.length-1,k));
  if(!tour.playing&&tour.ev[k].type==="leg"){k=back?k-1:k+1;k=Math.max(0,Math.min(tour.ev.length-1,k));}tour.k=k;const e=tour.ev[k];const d=tour.d;const day=P().days[d];const stp=W.D.meta.stops;
  $("#tPlay").textContent=tour.playing?"⏸":"▶";
  if(e.type==="stop"){const st=day.stops[e.i];const p=stp[st.id];S.time=e.t0;applyTime();updMe();syncTime();
    flyTo({tx:p[0],tz:p[1]+60,dist:st.food?520:700,pitch:0.95,yaw:(e.i%2?0.5:-0.4)},1800);tour.phase={type:"stop",until:performance.now()+1800+7000};renderTourCard(d,e.i,null);}
  else{const leg=e.leg;const len=leg.len;const dur=Math.max(3000,Math.min(9000,len/1000*1300+2500));
    const dist=Math.max(700,Math.min(26000,len*0.55));
    const p0=leg.pts[0];flyTo({tx:p0[0],tz:p0[1],dist,pitch:0.85},900,()=>{if(tour&&tour.ev[tour.k]===e){tour.phase={type:"leg",e,t0:performance.now(),dur,dist};}});
    tour.phase={type:"wait"};renderTourCard(d,e.i+1,e);}}
function tourStep(now){const ph=tour.phase;if(!ph)return;
  if(ph.type==="stop"){if(now>ph.until){if(tour.k>=tour.ev.length-1){tour.phase=null;tourPause();}else tourGo(tour.k+1);}}
  else if(ph.type==="leg"){const k=Math.min(1,(now-ph.t0)/ph.dur);const q=alongPath(ph.e.leg.pts,k);cam.tx=q[0];cam.tz=q[1];cam.dist=ph.dist;camApply();
    S.time=ph.e.t0+(ph.e.t1-ph.e.t0)*k;applyTime();updMe();syncTime();if(k>=1){tour.phase=null;tourGo(tour.k+1);}}}
function tourPause(){if(!tour)return;tour.playing=false;$("#tPlay").textContent="▶";}
function tourEnd(){tour=null;document.body.classList.remove("touring");$("#tour").hidden=true;resize();}
function renderTourCard(d,i,legEv){const day=P().days[d];const st=day.stops[i];const n=day.stops.length;
  $("#tourT").textContent=`${d+1}일차 ${dateLabel(d)} · ${i+1}/${n}`;
  let h="";
  if(legEv){h+=`<div class="note"><b>${({train:"기차로",walk:"걸어서",taxi:"택시로",van:"전용 밴으로",bus:"버스로"})[legEv.leg.mode]||""} 이동 중 · ${fmtT(legEv.t0)} → ${fmtT(legEv.t1)} · 약 ${(legEv.leg.len/1000).toFixed(legEv.leg.len<1000?2:1)}km</b></div>`;}
  h+=`<h3>${esc(st.name)}</h3>`+stopBody(d,i);$("#tourBody").innerHTML=h;$("#tourBody").scrollTop=0;}

/* ---------------- UI ---------------- */
const META={};function metaOf(c){return META[c]||(META[c]=JSON.parse(document.getElementById("m_"+c).textContent));}
const INFO=[["air","항공"],["hotel","숙소"],["sight","관광"],["move","이동"],["food","맛집"],["budget","예산"],["prep","준비"]];
let mapReady=false,mapStale=true,afterLoad=[];
function syncDayUI(){const p=P();
  $("#dayChips").innerHTML=`<button class="chip" data-d="-1" aria-pressed="${S.day<0}">전체</button>`+p.days.map((d,i)=>`<button class="chip" data-d="${i}" aria-pressed="${S.day===i}"><i style="background:${DAYC[i]}"></i>${i+1}일차</button>`).join("");
  $("#areaChips").innerHTML=p.areas.map(a=>`<button class="chip" data-a="${a.id}">${a.label}</button>`).join("");
  $("#bFx").textContent=p.weatherFx==="snow"?"눈 효과":"비 효과";$("#bFx").setAttribute("aria-pressed",S.fx[S.c]);
  styleRoutes();updMe();dirty=true;}
function syncTime(){$("#time").value=S.time;}
function stayTxt(st){const a=toMin(st.arr),b=toMin(st.dep);if(a==null||b==null||b<=a)return "";const m=b-a;return (m>=60?Math.floor(m/60)+"시간 ":"")+(m%60?m%60+"분":"");}
function stopBody(d,i){const st=P().days[d].stops[i];const p=P();const sg=st.sight&&p.sights[st.sight];
  const f=(lab,v,cls)=>v?`<div class="blk ${cls||""}"><b>${lab}</b>${esc(v)}</div>`:"";
  const tm=st.arr&&st.dep?`${st.arr} 도착 · ${st.dep} 출발 · 약 ${stayTxt(st)} 머묾`:st.arr?`${st.arr} 도착`:`${st.dep} 출발`;
  return `<div class="note">${tm}<br><span lang="${p.lang}">${esc(st.local)}</span></div>
    ${f("가는 법",st.how)}${f("도착하면",st.find)}${f("조심할 점",st.caution,"cau")}${f("부모님께",st.parents,"par")}
    ${sg?`<div class="story"><b>이야기 · ${esc(sg.name)}</b><br>${esc(sg.text)}</div>`:""}`;}
function openStop(d,i){if(tour){const k=tour.ev.findIndex(e=>e.type==="stop"&&e.i===i);if(tour.d===d&&k>=0){tourPause();tourGo(k);}return;}
  const st=P().days[d].stops[i];const pc=$("#pcard");
  pc.innerHTML=`<button class="x" id="pcX" aria-label="닫기">✕</button><div class="note" style="color:${DAYC[d]};font-weight:800">${d+1}일차 · ${st.arr||st.dep}</div><h3>${esc(st.name)}</h3>
    <div class="note">${esc(st.find||st.how||"")}</div><button class="btn pri wide" data-open="${d}:${i}">일정에서 자세히 보기</button>`;pc.hidden=false;}

/* views */
function setView(v,opts){S.view=v;store.set("view",v);
  document.querySelectorAll(".bnav button").forEach(x=>{if(x.dataset.v===v)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current");});
  const isMap=v==="map";$("#mapWrap").hidden=!isMap;$("#view").hidden=isMap;
  if(isMap){ensureMap(()=>{resize();dirty=true;opts&&opts.then&&opts.then();});if(!store.get("hinted",false)){$("#hint").hidden=false;setTimeout(()=>{$("#hint").hidden=true;},3500);store.set("hinted",true);}}
  else{if(tour)tourEnd();renderView();window.scrollTo(0,0);}}
function ensureMap(cb){if(!R){try{if(typeof THREE==="undefined")throw new Error("3D 라이브러리를 불러오지 못했어요");if(!initGL())return;}catch(e){showMapErr("3D 지도를 시작하지 못했어요: "+e.message);return;}}
  resize();if(mapStale||!W){afterLoad.push(cb);if(afterLoad.length===1)loadWorld();}else cb&&cb();}
function loadWorld(){$("#loading").hidden=false;$("#loading").textContent=(S.c==="hk"?"홋카이도":"대만")+" 3D 지도를 그리는 중…";
  setTimeout(()=>{try{disposeWorld();buildWorld(S.c);W.night=null;S.time=13*60;applyTime();syncTime();syncDayUI();
    const m=W.D.meta;const all=[];m.routes.forEach(r=>r.forEach(l=>l.pts.forEach(p=>all.push(p))));
    const g=W.g;cam.tx=(g.x0+g.x1)/2;cam.tz=(g.z0+g.z1)/2;cam.dist=150000;cam.pitch=0.3;cam.yaw=0;camApply();fitPts(all,0.45,1200);
    mapStale=false;$("#loading").hidden=true;const q=afterLoad;afterLoad=[];q.forEach(f=>f&&f());}
    catch(e){console.error(e);afterLoad=[];showMapErr("지도를 그리는 중 문제가 생겼어요: "+e.message);}},40);}
function goMap(fn){setView("map",{then:fn});}
function showDay(d){S.day=d;syncDayUI();if(!W)return;const pts=[];W.D.meta.routes[d].forEach(l=>l.pts.forEach(p=>pts.push(p)));
  const tl=dayTimeline(d);S.time=tl[0].t1??tl[0].t0;applyTime();syncTime();updMe();fitPts(pts,0.6);}
function showAll(){S.day=-1;syncDayUI();if(!W)return;const pts=[];W.D.meta.routes.forEach(r=>r.forEach(l=>l.pts.forEach(p=>pts.push(p))));fitPts(pts,0.45);}
function todayIdx(){const now=new Date();const tz=P().tz;const loc=new Date(now.getTime()+tz*3600000);const t=Date.UTC(loc.getUTCFullYear(),loc.getUTCMonth(),loc.getUTCDate());
  for(let i=0;i<P().days.length;i++)if(dateOf(i).getTime()===t)return{d:i,m:loc.getUTCHours()*60+loc.getUTCMinutes()};return null;}
function flyLL(ll){const m=W.D.meta;flyTo({tx:(ll[0]-m.origin[0])*m.KX,tz:-(ll[1]-m.origin[1])*m.KY,dist:800,pitch:0.9});}
const total=c=>{const q=PLAN[c];return (q.dates.find(x=>x.id===S.date[c])||q.dates[1]).cost;};

function renderView(){const v=S.view;let h="";const p=P();
  if(v==="home"){const cost=total(S.c);const d0=p.dates.find(x=>x.id===S.date[S.c]);
    h+=`<section class="hero"><h2>${esc(p.name)} 3박4일</h2><p>${esc(p.tagline)}</p>
      <div class="kpis"><div class="kpi"><small>가족 5명 예상 비용</small><b>${won(cost)}</b></div><div class="kpi"><small>1인당</small><b>${won(cost/5)}</b></div>
      <div class="kpi"><small>출발일</small><b>${d0.label.split(" ~ ")[0]}</b></div><div class="kpi"><small>12월 날씨</small><b>${S.c==="hk"?"영하, 눈":"20°C 안팎, 비"}</b></div></div>
      <div class="btns"><button class="btn wide" data-v="plan">일정 보기</button><button class="btn wide" data-v="map">3D 지도 보기</button></div></section>`;
    const r=(c,k)=>({flight:c==="hk"?"인천→신치토세 2시간 45분":"김포→쑹산 2시간 30분",temp:PLAN[c].glance.temp,walk:c==="hk"?"하루 3~5천 보":"하루 4~7천 보",risk:c==="hk"?"빙판길, 오후 4시 일몰":"잦은 비, 지우펀 계단",cost:won(total(c))}[k]);
    const rows=[["예상 비용(5명)","cost"],["비행 시간","flight"],["12월 날씨","temp"],["걷는 양","walk"],["조심할 점","risk"]];
    h+=`<section class="sec"><h2>홋카이도와 대만 비교</h2>
      <div class="cmp"><div class="hd"><span class="${S.c==="hk"?"on":""}">홋카이도</span><span class="${S.c==="tw"?"on":""}">대만</span></div>
      ${rows.map(([l,k])=>`<div class="row"><span class="lab">${l}</span><div class="v"><span class="${S.c==="hk"?"on":""}">${esc(r("hk",k))}</span><span class="${S.c==="tw"?"on":""}">${esc(r("tw",k))}</span></div></div>`).join("")}</div>
      <p class="note">비용은 각 여행지에서 고른 출발일 기준이고, 예비비는 빠져 있어요. 위쪽 버튼으로 두 여행지를 바꿔 볼 수 있어요.</p></section>`;
    h+=`<section class="sec"><h2>언제 갈까? 출발일 후보</h2><p class="lead">모두 목요일에 가서 일요일에 와요. 누르면 그 날짜로 일정이 바뀌어요.</p>
      ${p.dates.map(d=>`<button class="card dc ${d.id===S.date[S.c]?"on":""}" data-date="${d.id}" aria-pressed="${d.id===S.date[S.c]}">
        <span class="dch"><b>${d.label}</b><span class="pill p-${d.tone}">${d.verdict}</span></span>
        <span class="dcs"><span><small>휴가</small>${d.leave}일</span><span><small>5명 예상</small>${won(d.cost)}</span></span>
        <span>${esc(d.weather)}</span><span class="note">${esc(d.note)}</span></button>`).join("")}</section>`;
    h+=`<section class="sec"><h2>좋은 점</h2><div class="card"><ul class="clean">${p.glance.good.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      <h2>조심할 점</h2><div class="card"><ul class="clean">${p.glance.watch.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div></section>`;
    h+=`<section class="sec"><h2>4일 동안 이렇게 다녀요</h2>${p.days.map((d,i)=>`<div class="card dayhead" style="border-left-color:${DAYC[i]}"><div class="note" style="color:${DAYC[i]};font-weight:800">${i+1}일차 · ${dateLabel(i)}</div><h2>${esc(d.title)}</h2>
      <div class="btns"><button class="btn" data-pd="${i}">일정 보기</button><button class="btn pri" data-tour="${i}">미리 체험</button></div></div>`).join("")}</section>`;}
  if(v==="plan"){const d=S.planDay;const day=p.days[d];const legs=metaOf(S.c).routes[d];const st=sunTimes(d);
    h+=`<div class="days">${p.days.map((x,i)=>`<button data-pd="${i}" aria-pressed="${i===d}">${i+1}일차<small>${dateLabel(i)}</small><i style="background:${DAYC[i]}"></i></button>`).join("")}</div>
      <section class="card dayhead" style="border-left-color:${DAYC[d]}"><h2>${esc(day.title)}</h2><p class="note">해 뜨는 시각 ${fmtT(st.rise)} · 해 지는 시각 ${fmtT(st.set)}</p>
      <div class="btns"><button class="btn pri" data-tour="${d}">이 날 미리 체험하기</button><button class="btn" data-day="${d}">지도에서 경로 보기</button></div></section>
      <p class="note">장소를 누르면 가는 법과 부모님 팁이 펼쳐져요.</p>
      <div class="stops">${day.stops.map((s,i)=>{const leg=i>0&&legs?legs[i-1]:null;
        return `${i>0?`<div class="leg"><span>${leg?modeKo(leg.mode)+" · "+(leg.len>=1000?(leg.len/1000).toFixed(1)+"km":leg.len+"m"):"이동"}</span></div>`:""}
        <details class="st" id="st-${d}-${i}" style="border-left:5px solid ${DAYC[d]}"><summary><span class="t">${s.arr||s.dep}</span><span class="n">${esc(s.name)}${stayTxt(s)?`<small>${stayTxt(s)} 머묾</small>`:""}</span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary>
        <div class="stb">${stopBody(d,i)}<button class="btn" data-go="${d}:${i}">지도에서 이 장소 보기</button></div></details>`;}).join("")}</div>`;}
  if(v==="info"){const t=S.info;
    h+=`<div class="sub">${INFO.map(([k,l])=>`<button data-i="${k}" aria-pressed="${k===t}">${l}</button>`).join("")}</div>`;
    if(t==="air")h+=`<section class="sec"><h2>항공편</h2><p class="lead">예약 전에 항공사 앱에서 편명과 시각을 꼭 다시 확인하세요. 겨울 시간표가 아직 다 나오지 않았어요.</p>
      ${p.flights.map(f=>`<div class="card"><div><span class="pill ${f.tag==="추천"?"p-best":"p-ok"}">${f.tag}</span> <b>${esc(f.air)}</b></div>
      <dl class="kv"><dt>가는 편</dt><dd>${esc(f.out)}</dd><dt>오는 편</dt><dd>${esc(f.back)}</dd><dt>운항</dt><dd>${esc(f.days)}</dd><dt>요금</dt><dd>${esc(f.fare)}</dd></dl><p class="note">${esc(f.note)}</p></div>`).join("")}
      <p class="note">2026년 9월 27일 검색 기준 추정 요금이에요.</p></section>`;
    if(t==="hotel")h+=`<section class="sec"><h2>숙소</h2><p class="lead">방 3개 기준이에요(부모님 · 동생 · 우리 부부).</p>
      ${p.hotels.map(x=>`<div class="card"><div><span class="pill ${x.tag.startsWith("추천")?"p-best":"p-ok"}">${esc(x.tag)}</span></div><h3>${esc(x.name)}</h3>
      <dl class="kv"><dt>요금</dt><dd>${esc(x.price)}</dd><dt>합계</dt><dd>${esc(x.total)}</dd><dt>위치</dt><dd>${esc(x.access)}</dd></dl><p>${esc(x.why)}</p>
      <button class="btn" data-ll="${x.ll.join(",")}">지도에서 보기</button></div>`).join("")}</section>`;
    if(t==="sight")h+=`<section class="sec"><h2>관광지 이야기</h2><p class="lead">부모님께 들려드릴 짧은 역사와 배경이에요.</p>
      ${Object.entries(p.sights).map(([k,s2])=>{let at=null;p.days.forEach((dd,di)=>dd.stops.forEach((x,si)=>{if(x.sight===k&&!at)at=[di,si];}));
      return `<div class="card"><h3>${esc(s2.name)}</h3>${s2.when?`<p class="note">${esc(s2.when)}</p>`:""}<p>${esc(s2.text)}</p>${at?`<button class="btn" data-go="${at[0]}:${at[1]}">지도에서 보기 (${at[0]+1}일차)</button>`:""}</div>`;}).join("")}</section>`;
    if(t==="move")h+=`<section class="sec"><h2>이동 방법</h2>${p.transport.map(x=>`<div class="card"><h3>${esc(x.name)}</h3><p>${esc(x.detail)}</p></div>`).join("")}
      <div class="card"><h3>지도의 선 모양</h3><p>실선은 택시·밴·버스, 긴 점선은 기차, 짧은 점선은 걷는 길이에요. 실제 도로와 철도를 따라 그렸어요.</p></div></section>`;
    if(t==="food")h+=`<section class="sec"><h2>맛집</h2><p class="lead">부모님이 앉아서 편하게 드실 수 있는 곳 위주예요.</p>
      ${p.food.map(x=>`<div class="card"><h3>${esc(x.name)}</h3><dl class="kv"><dt>메뉴</dt><dd>${esc(x.what)}</dd><dt>1인</dt><dd>${esc(x.price)}</dd><dt>위치</dt><dd>${esc(x.where)}</dd></dl><p class="note">${esc(x.note)}</p>
      <button class="btn" data-ll="${x.ll.join(",")}">지도에서 보기</button></div>`).join("")}</section>`;
    if(t==="budget"){const tot=p.budget.reduce((a,x)=>a+x.amt,0);const mx=Math.max(...p.budget.map(x=>x.amt));
      h+=`<section class="sec"><h2>예산</h2><p class="lead">12/10(목) 출발 기준이에요. ${esc(p.rateNote)}.</p>
      <div class="stats"><div class="card stat"><small>가족 5명</small><span class="big">${won(tot)}</span></div><div class="card stat"><small>1인당</small><span class="big">${won(tot/5)}</span></div></div>
      <div class="card stat"><small>1,000만 원에서 남는 돈(예비비)</small><span class="big" style="color:${tot<=1e7?"var(--good)":"var(--bad)"}">${won(1e7-tot)}</span></div>
      <div class="card bars">${p.budget.map(x=>`<div class="bar"><div class="top"><span>${esc(x.cat)}</span><b>${won(x.amt)}</b></div><div class="tr"><i style="width:${(x.amt/mx*100).toFixed(1)}%"></i></div><div class="note">${esc(x.note)}</div></div>`).join("")}</div>
      <div class="card"><h3>출발일에 따라 달라져요</h3>${p.dates.map(d=>`<div class="dch" style="font-size:15.5px"><span>${d.label}</span><span><b>${won(d.cost)}</b> <span class="pill p-${d.tone}">${d.verdict}</span></span></div>`).join("")}</div></section>`;}
    if(t==="prep"){const ck=store.get("ck_"+S.c,{});h+=`<section class="sec"><h2>준비물과 할 일</h2><p class="lead">체크 표시는 이 휴대폰에만 저장돼요.</p><div class="card">${p.prep.map((x,i)=>`<label class="check"><input type="checkbox" id="ck-${S.c}-${i}" data-ck="${i}" ${ck[i]?"checked":""}><span>${esc(x)}</span></label>`).join("")}</div></section>`;}}
  if(v==="talk"){h+=`<section class="sec"><h2>보여주기 카드</h2><p class="lead">택시 기사님이나 직원에게 화면을 보여 주세요. 누르면 크게 보여요.</p>
    ${p.phraseCards.map((x,i)=>`<button class="pc" data-card="${i}"><span class="k">${esc(x.ko)}</span><span class="l" lang="${p.lang}">${esc(x.local)}</span><span class="r">${esc(x.read)}</span></button>`).join("")}</section>
    <section class="sec"><h2>여행 중 쓸 표현</h2><div class="card">${p.phrases.map((x,i)=>`<div class="ph"><span class="k">${esc(x.ko)}</span><div class="row"><span class="l" lang="${p.lang}">${esc(x.local)}</span><button data-copy="${i}">복사</button></div><span class="r">${esc(x.read)}</span></div>`).join("")}</div></section>`;}
  h+=`<p class="note">지도 데이터 © OpenStreetMap contributors (ODbL), Overture Maps(2026-09) · 지형 AWS Terrain Tiles. 높이 정보가 없는 건물은 면적으로 높이를 추정했어요. 항공·숙소 정보는 2026-09-27 조사.</p>`;
  $("#view").innerHTML=h;}

function setCountry(c){if(tour)tourEnd();S.c=c;store.set("c",c);document.documentElement.setAttribute("data-c",c);
  $("#sw-hk").setAttribute("aria-pressed",c==="hk");$("#sw-tw").setAttribute("aria-pressed",c==="tw");$("#pcard").hidden=true;
  S.day=-1;S.planDay=0;mapStale=true;syncDayUI();if(S.view==="map")ensureMap(()=>{});else renderView();}

/* events */
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const ds=b.dataset;
  if(b.id==="sw-hk")return setCountry("hk");if(b.id==="sw-tw")return setCountry("tw");
  if(ds.v){setView(ds.v);return;}
  if(ds.i){S.info=ds.i;store.set("info",ds.i);renderView();return;}
  if(ds.pd!==undefined){S.planDay=+ds.pd;if(S.view!=="plan")setView("plan");else{renderView();}return;}
  if(ds.open){const [d,i]=ds.open.split(":").map(Number);$("#pcard").hidden=true;S.planDay=d;setView("plan");const el=document.getElementById(`st-${d}-${i}`);if(el){el.open=true;el.scrollIntoView({block:"center"});}return;}
  if(b.id==="pcX"){$("#pcard").hidden=true;return;}
  if(ds.d!==undefined){const d=+ds.d;if(d<0)showAll();else showDay(d);return;}
  if(ds.a){const bx=W&&W.D.meta.details[ds.a];if(bx){const w=Math.max(bx[2]-bx[0],bx[3]-bx[1]);flyTo({tx:(bx[0]+bx[2])/2,tz:(bx[1]+bx[3])/2,dist:w*0.9,pitch:0.8,yaw:0});}return;}
  if(ds.day!==undefined){const d=+ds.day;goMap(()=>showDay(d));return;}
  if(ds.tour!==undefined){const d=+ds.tour;goMap(()=>startTour(d));return;}
  if(ds.go){const [d,i]=ds.go.split(":").map(Number);goMap(()=>{S.day=d;syncDayUI();const p=W.D.meta.stops[P().days[d].stops[i].id];flyTo({tx:p[0],tz:p[1],dist:750,pitch:0.9});openStop(d,i);});return;}
  if(ds.ll){const ll=ds.ll.split(",").map(Number);goMap(()=>flyLL(ll));return;}
  if(ds.date){S.date[S.c]=ds.date;store.set("date_"+S.c,ds.date);syncDayUI();if(R)applyTime();renderView();return;}
  if(ds.card!==undefined){const x=P().phraseCards[+ds.card];const sc=$("#showCard");sc.innerHTML=`<div class="l" lang="${P().lang}">${esc(x.local)}</div><div class="k">${esc(x.ko)}</div><button id="scClose">닫기</button>`;sc.hidden=false;return;}
  if(b.id==="scClose"){$("#showCard").hidden=true;return;}
  if(ds.copy!==undefined){const x=P().phrases[+ds.copy];const done=()=>{b.textContent="복사됨";setTimeout(()=>b.textContent="복사",1500);};
    try{navigator.clipboard.writeText(x.local).then(done,()=>{b.textContent="길게 눌러 복사";});}catch(err){b.textContent="길게 눌러 복사";}return;}
  if(b.id==="bAll")return showAll();
  if(b.id==="bToday"){const t=todayIdx();if(t){showDay(t.d);S.time=Math.max(300,Math.min(1440,t.m));applyTime();syncTime();updMe();}else showDay(S.day<0?0:S.day);return;}
  if(b.id==="bNight"){const di=S.day<0?0:S.day;const st=sunTimes(di);const night=sunAt(S.time,di).alt/RAD<-4;S.time=night?12*60:Math.min(1380,(st.set||1020)+150);applyTime();syncTime();updMe();return;}
  if(b.id==="bFx"){S.fx[S.c]=!S.fx[S.c];b.setAttribute("aria-pressed",S.fx[S.c]);dirty=true;if(S.fx[S.c]&&cam.dist>9000&&W){const g=S.day<0?null:W.D.meta.stops[P().days[S.day].stops[0].id];flyTo({dist:2500,pitch:1.0,...(g?{tx:g[0],tz:g[1]}:{})});}return;}
  if(b.id==="tPlay"){if(!tour)return;tour.playing=!tour.playing;$("#tPlay").textContent=tour.playing?"⏸":"▶";if(tour.playing){if(!tour.phase||tour.phase.type==="stop")tourGo(tour.ev[tour.k].type==="stop"?tour.k+1:tour.k);}return;}
  if(b.id==="tNext"){if(tour){tour.playing=false;$("#tPlay").textContent="▶";tourGo(tour.k+1);}return;}
  if(b.id==="tPrev"){if(tour){tour.playing=false;$("#tPlay").textContent="▶";tourGo(tour.k-1,true);}return;}
  if(b.id==="tClose"){tourEnd();return;}
});
document.addEventListener("change",e=>{const i=e.target.closest("input[data-ck]");if(!i)return;const ck=store.get("ck_"+S.c,{});ck[i.dataset.ck]=i.checked;store.set("ck_"+S.c,ck);});
$("#time").addEventListener("input",e=>{S.time=+e.target.value;applyTime();updMe();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("#showCard").hidden)$("#showCard").hidden=true;else if(tour)tourEnd();}});

/* boot */
S.view=store.get("view","home");if(!["home","plan","map","info","talk"].includes(S.view))S.view="home";
S.info=store.get("info","air");if(!INFO.some(x=>x[0]===S.info))S.info="air";
document.documentElement.setAttribute("data-c",S.c);
$("#sw-hk").setAttribute("aria-pressed",S.c==="hk");$("#sw-tw").setAttribute("aria-pressed",S.c==="tw");
syncDayUI();setView(S.view);
})();
