// Watercolour sketch story: lines redraw, green and orange bleed separately on scroll
(() => {
const root=document.getElementById('story'); if(!root) return;
const SCENES=[
  {id:'tower', sky:1,  eyebrow:'20 storeys',      h:'Kudasan’s only 20-storey address.', p:'One tower, rising above the neighbourhood.'},
  {id:'arrival',eyebrow:'Arrival',         h:'Arrive like you’re expected.', p:'A drop-off that feels like a welcome with <em>Parking Manager</em> waiting for your arrival.'},
  {id:'foyer',  eyebrow:'Your floor',      h:'A foyer made for gathering.', p:'Open on all sides, with a julla and seating on every floor, and an additional <em>service entry</em> for each apartment.'},
  {id:'balcony', sky:1,eyebrow:'18-feet balcony', h:'An 18-feet balcony.', p:'A <em>cantilevered balcony</em> that comes out of the building. Your own piece of sky.'},
  {id:'club', sky:1,   eyebrow:'Shared spaces',   h:'Room for every generation.', p:'Shaded places to sit, talk and stay a while.'},
  {id:'terrace', sky:1,eyebrow:'Terrace garden',  h:'And at the top, a garden.', p:'Sky bridges lead to the Terrace Garden and The Sky Hall.'},
];
const N=SCENES.length;
root.style.height=(N*95+70)+'vh';
const caps=root.querySelector('.sk-caps'), dots=root.querySelector('.sk-dots');
// captions live in the HTML (crawlable); only the dots are added here
SCENES.forEach(()=>dots.insertAdjacentHTML('beforeend','<b></b>'));
const capEls=[...caps.children], dotEls=[...dots.children];
const cv=root.querySelector('canvas');
const gl=cv.getContext('webgl',{antialias:false,premultipliedAlpha:false});
if(!gl) return;
root.classList.remove('sk-fallback');
const VS=`attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0,1);}`;
const FS=`precision highp float;varying vec2 uv;
uniform sampler2D a0,b0,a1,b1,s0,s1;uniform vec2 sk;
uniform vec3 t0,t1;          // thresholds: ink, green, warm (0 hidden .. 1 fully shown)
uniform vec2 res;uniform float z0,z1;
const vec3 PAPER=vec3(246.,243.,238.)/255.;
const vec3 INK=vec3(110.,62.,46.)/255.;
const vec3 AS=vec3(0.5023,0.3577,0.6324);   // sage absorbance
const vec3 AT=vec3(0.1473,0.6397,0.9811);   // terracotta
const vec3 AB=vec3(0.4041,0.2156,0.0698);
const vec3 AU=vec3(0.8587,1.0533,1.1398);   // umber
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float show(float th,float o,float w){ // visible when o < th ; th scaled so 0 hides all, 1 shows all
  float t=th*(1.+w)-w; return smoothstep(o-w*.5,o+w*.5,t)*step(0.001,th);}
void layer(sampler2D A,sampler2D B,sampler2D S,vec3 th,float st,float z,inout float ink,inout vec3 dens){
  vec2 q=vec2(.5,.52)+(uv-vec2(.5,.52))/z;
  vec4 a=texture2D(A,q); vec4 b=texture2D(B,q); vec4 sv=texture2D(S,q);
  float n=vn(uv*vec2(160.,90.))*.06;
  ink=1.-(1.-ink)*(1.-a.r*show(th.x,a.g,.035));
  float sg=show(th.y,a.b+n,.09), sw=show(th.z,a.b+n,.09);
  // wet edge: pigment pools at the moving front
  float eg=sg*(1.-sg)*4., ew=sw*(1.-sw)*4.;
  float g=b.r*2.*(sg+.35*eg*step(sg,.999)), tt=b.g*2.*(sw+.35*ew), u=b.b*2.*sw;
  float sb=show(st,sv.g+n,.18);
  float wob=vn(q*vec2(9.,5.))*.07;
  sb*=smoothstep(.0,.11,min(q.x,1.-q.x)-wob+.02)*smoothstep(.0,.16,q.y-wob+.02);
  dens+=g*AS+tt*AT+u*AU+sv.r*sb*AB;
}
void main(){
  float ink=0.; vec3 dens=vec3(0);
  layer(a0,b0,s0,t0,sk.x,z0,ink,dens);
  layer(a1,b1,s1,t1,sk.y,z1,ink,dens);
  vec2 px=uv*res;
  float e=smoothstep(0.,.07,min(uv.x,1.-uv.x))*smoothstep(0.,.1,min(uv.y,1.-uv.y));
  float grain=((vn(px*.9)-.5)*.035+(vn(px*.06)-.5)*.03)*e;
  vec3 paper=PAPER*(1.+grain);
  vec3 col=paper*exp(-dens*(1.+grain*3.));
  col=mix(col,INK,ink*.96);
  gl_FragColor=vec4(col,1);
}`;
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);return o;}
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(pr);gl.useProgram(pr);
gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
const U=n=>gl.getUniformLocation(pr,n);
['a0','b0','a1','b1','s0','s1'].forEach((n,i)=>gl.uniform1i(U(n),i));
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
const tex={};
function mkTex(img){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);
  [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].forEach(k=>gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR));
  [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(k=>gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE));return t;}
const loadImg=src=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=src;});
let blank;
async function loadScene(id){const sc=SCENES.find(x=>x.id===id);const [a,b,s]=await Promise.all([loadImg(`assets/sketch/${id}-a.webp`),loadImg(`assets/sketch/${id}-b.webp`),sc.sky?loadImg(`assets/sketch/${id}-s.webp`):null]);
  if(!blank){blank=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,blank);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,255,0]));}
  tex[id]={a:mkTex(a),b:mkTex(b),s:s?mkTex(s):blank};last=-1;}
const ss=(e0,e1,x)=>{x=Math.min(1,Math.max(0,(x-e0)/(e1-e0)));return x*x*(3-2*x);};
const inT=p=>[ss(.30,.90,p),ss(.50,.85,p),ss(.62,1,p),ss(.78,1,p)];
const outT=p=>[1-ss(0,.50,p),1-ss(0,.35,p),1-ss(.12,.50,p),1-ss(.05,.45,p)];
const firstT=p=>[ss(.1,.75,p),ss(.45,.85,p),ss(.60,1,p),ss(.78,1,p)];
let last=-1, seen=new Set();
function progress(){const r=root.getBoundingClientRect(),vh=innerHeight;
  // start drawing while the section scrolls into view
  return Math.min(1,Math.max(0,(vh*0.55-r.top)/(r.height-vh*0.45)));}
function draw(){
  const pr0=progress(), u=pr0*(N+0.6);
  if(Math.abs(u-last)<1e-4) return;
  let A,B=null,tA,tB;
  if(u<1){A=0;tA=firstT(u/0.85);}
  else{const k=Math.floor(u),f=u-k;
    if(k>=N){A=N-1;tA=[1,1,1,1];}
    else{const p=Math.max(0,(f-.3)/.7);A=k-1;B=k;tA=outT(p);tB=inT(p);}}
  want((B!=null?B:A)+1);
  const ia=SCENES[A].id, ib=B!=null?SCENES[B].id:null;
  if(!tex[ia]||(ib&&!tex[ib])) return; last=u;
  gl.viewport(0,0,cv.width,cv.height);gl.uniform2f(U('res'),cv.width,cv.height);
  const tb=ib?tex[ib]:tex[ia];
  [[tex[ia].a],[tex[ia].b],[tb.a],[tb.b],[tex[ia].s],[tb.s]].forEach(([t],i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);});
  const zm=s=>(innerWidth<700&&s.zoomMobile)||1;gl.uniform1f(U('z0'),zm(SCENES[A]));gl.uniform1f(U('z1'),B!=null?zm(SCENES[B]):1);gl.uniform2f(U('sk'),tA[3],ib?tB[3]:0);gl.uniform3fv(U('t0'),tA.slice(0,3));gl.uniform3fv(U('t1'),ib?tB.slice(0,3):[0,0,0]);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  const cur=(B!=null&&tB[0]>.6)?B:A, on=B==null?tA[0]>.6:(tA[0]>.6||tB[0]>.6), end=u>=N+0.2;
  capEls.forEach((c,i)=>c.classList.toggle('on',end?i===N:(on&&i===cur)));
  dotEls.forEach((d,i)=>d.classList.toggle('on',i===cur));
  if(on&&!seen.has(cur)){seen.add(cur);window.dispatchEvent(new CustomEvent('sketch-scene',{detail:SCENES[cur].id}));}
}
function resize(){const d=Math.min(2,devicePixelRatio||1);cv.width=Math.min(1600,Math.round(cv.clientWidth*d));cv.height=Math.round(cv.width*9/16);last=-1;}
// rAF loop (works whichever element scrolls); only draws when progress changes
let inView=true;
function loop(){if(inView)draw();requestAnimationFrame(loop);}
if('IntersectionObserver' in window) new IntersectionObserver(es=>{inView=es[0].isIntersecting;},{rootMargin:'200px 0px'}).observe(root);
addEventListener('resize',resize);
let started=false;
// Load scenes just ahead of the reader (keeps the first page load light)
let queued=0, loading=Promise.resolve();
function want(upTo){upTo=Math.min(N-1,upTo);while(queued<upTo){const id=SCENES[++queued].id;loading=loading.then(()=>loadScene(id)).catch(()=>{});}}
const start=async()=>{if(started)return;started=true;
  await loadScene(SCENES[0].id);resize();loop();want(1);};
if('IntersectionObserver' in window) new IntersectionObserver((es,o)=>{if(es.some(e=>e.isIntersecting)){o.disconnect();start();}},{rootMargin:'800px 0px'}).observe(root);
else start();
})();
