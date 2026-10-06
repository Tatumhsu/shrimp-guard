import * as THREE from 'three';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {createStore,RULES} from './store-sim.mjs';
import {fitCamera,loadScene,createConfirmation} from './view-state.mjs';
const $=id=>document.getElementById(id),store=createStore();
const storage={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
const loaded=store.load(storage);let storageWarning=!loaded.ok,ready=false,renderer,model,last=0,saveTime=0,stepTime=0,raf,disposed=false;
const scene=new THREE.Scene();scene.background=new THREE.Color('#efe9d8');
const camera=new THREE.OrthographicCamera(-6,6,6,-6,.1,80);camera.position.set(10,13,14);camera.lookAt(0,1.3,0.25);
const bounds=new THREE.Box3(new THREE.Vector3(-3.82,-.22,-3.85),new THREE.Vector3(3.82,3.6,4.38));
const actors=new Map(),goods=[],templates=[],ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),confirmation=createConfirmation();
let previousFocus=null,pulse=0,lastStock=store.getState().stock;
const toast=message=>{$('toast').textContent=message;};
function persist(){const r=store.save(storage);storageWarning=!r.ok;$('save-status').textContent=r.message;return r;}
function update(){
  const s=store.getState();for(const k of ['day','stock','queue'])$(k).textContent=s[k];$('cash').textContent='$'+s.cash;$('earned').textContent='$'+s.earned;
  $('paused').hidden=!s.paused;$('pause').textContent=s.paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',s.paused?'繼續營業':'暫停營業');
  $('flow').textContent=`今日 ${s.arrivals}/${RULES.visitorsPerDay} 位來客 · 已服務 ${s.sales} 位`;
  $('scene-status').textContent=s.paused?'暫停中':s.stock===0?'缺貨中，請補货':s.queue?`${s.queue} 位顧客等待結帳`:s.arrivals===RULES.visitorsPerDay&&!s.customers.length?'今天的客人都離開了，可結束今日':'顧客正在選購';
  $('view').setAttribute('aria-label',`小店內 ${s.customers.length} 位顧客，${s.queue} 位排隊，架上 ${s.stock} 件商品。點货架補貨，點櫃台結帳。`);
  for(const b of ['restock','checkout','end','pause'])$(b).disabled=!ready;
  if(s.stock!==lastStock){pulse=1;lastStock=s.stock;}
  if(model){goods.forEach((g,i)=>{g.visible=i<s.stock;});$('view').dataset.visibleGoods=String(goods.filter(g=>g.visible).length);}
}
function feedback(text){$('feedback').textContent=text;$('feedback').classList.remove('burst');void $('feedback').offsetWidth;$('feedback').classList.add('burst');}
function act(fn){if(!ready||confirmation.pending)return;const r=fn();toast(r.message);if(r.ok){persist();if(r.code==='RESTOCKED')feedback('+6');if(r.code==='CHECKOUT')feedback('+$'+r.income);}update();return r;}
function closeDialog(){confirmation.cancel();$('confirm').hidden=true;$('game-ui').inert=false;previousFocus?.focus();}
function ask(title,message,fn){if(confirmation.pending)return;previousFocus=document.activeElement;confirmation.open(fn);$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('game-ui').inert=true;$('confirm').hidden=false;$('confirm-cancel').focus();}
$('confirm-cancel').onclick=closeDialog;
$('confirm-ok').onclick=()=>{const had=confirmation.pending;$('confirm').hidden=true;$('game-ui').inert=false;if(had)confirmation.confirm();previousFocus?.focus();};
$('confirm').onclick=e=>{if(e.target===$('confirm'))closeDialog();};
document.addEventListener('keydown',e=>{if(!confirmation.pending)return;if(e.key==='Escape'){e.preventDefault();closeDialog();}if(e.key==='Tab'){const cancel=$('confirm-cancel'),ok=$('confirm-ok');if(e.shiftKey&&document.activeElement===cancel){e.preventDefault();ok.focus();}else if(!e.shiftKey&&document.activeElement===ok){e.preventDefault();cancel.focus();}}});
$('restock').onclick=()=>act(()=>store.restock());$('checkout').onclick=()=>act(()=>store.checkout());$('pause').onclick=()=>act(()=>store.togglePause());
$('end').onclick=()=>{if(store.getState().paused){toast('先繼續營業，再結束今日');return;}const s=store.getState();ask(`第 ${s.day} 天結算`, `售出 ${s.sales} 件 · 營收 $${s.earned}\n補貨支出 $${s.spent} · 營業損益 $${s.earned-s.spent}\n結束後客人離店，明日開店補助 $10，庫存至少 4 件。`,()=>{const r=store.endDay();toast(r.message);if(r.ok){clearActors();persist();}update();});};
$('reset').onclick=()=>ask('重新開始？','這會清除此裝置的小店進度，回到第 1 天。\n此操作無法復原。',()=>{const r=store.reset(storage);toast(r.message);if(r.ok){clearActors();storageWarning=false;$('save-status').textContent='已清除舊進度，重新開始';}else{$('save-status').textContent=r.message;storageWarning=true;}update();});
$('retry').onclick=()=>location.reload();
function clearActors(){for(const a of actors.values())scene.remove(a.root);actors.clear();}
function targetFor(c,s){
  const lane=c.id%2;
  if(c.phase==='enter')return new THREE.Vector3(1.14,0,.6);
  if(c.phase==='shop')return new THREE.Vector3(lane?.75:-2.7,0,.6);
  if(c.phase==='queue'){const i=s.customers.filter(a=>a.phase==='queue').findIndex(a=>a.id===c.id);return new THREE.Vector3(2.12,0,-.35+i*.88);}
  return new THREE.Vector3(3.32,0,4.2);
}
function syncScene(dt){
  if(!model)return;const s=store.getState(),ids=new Set(s.customers.map(c=>c.id));
  for(const [id,a]of actors)if(!ids.has(id)){scene.remove(a.root);actors.delete(id);}
  for(const c of s.customers){
    let a=actors.get(c.id);if(!a){const root=templates[c.id%4].clone(true);root.visible=true;root.position.set(.65,0,3.85);scene.add(root);a={root,phase:c.phase};actors.set(c.id,a);}
    const goal=targetFor(c,s),distance=a.root.position.distanceTo(goal);
    if(dt>0){a.root.position.lerp(goal,1-Math.exp(-dt*5));a.root.rotation.y=c.phase==='leave'?-.4:0;}
    a.root.position.y=distance>.15&&dt>0?.025*Math.sin(performance.now()/95+c.id):0;
    a.root.userData.action='checkout';
  }
  $('view').dataset.activeCustomers=String(actors.size);
  pulse=Math.max(0,pulse-dt*2);goods.forEach(g=>g.scale.setScalar(1+.1*Math.sin(pulse*Math.PI)));
}
function resize(){if(!renderer)return;const w=$('stage').clientWidth,h=$('stage').clientHeight;fitCamera(THREE,camera,bounds,w/h);renderer.setSize(w,h,false);}
let down=null;
$('view').addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,id:e.pointerId};});
$('view').addEventListener('pointercancel',()=>{down=null;});
$('view').addEventListener('pointerup',e=>{const p=down;down=null;if(!p||p.id!==e.pointerId||Math.hypot(e.clientX-p.x,e.clientY-p.y)>8||!ready||confirmation.pending)return;const r=$('view').getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hits=ray.intersectObjects([model,...Array.from(actors.values(),a=>a.root)],true).filter(h=>{for(let o=h.object;o;o=o.parent)if(!o.visible)return false;return true;});for(const h of hits){let action=null;for(let o=h.object;o;o=o.parent){if(o.userData.action){action=o.userData.action;break;}if(/^(Shelf_|Stock_|Freezer_)/.test(o.name)){action='restock';break;}if(o.name==='Counter'){action='checkout';break;}}if(action){act(()=>store[action]());break;}}});
function frame(now){if(disposed)return;const dt=last?Math.min(1000,now-last):0;last=now;const active=ready&&!document.hidden&&!confirmation.pending&&!store.getState().paused;
  if(active){stepTime+=dt;saveTime+=dt;while(stepTime>=50){const r=store.tick(50);stepTime-=50;if(r.events.includes('impatient'))toast('等太久的顧客離開了，記得幫大家結帳');}if(saveTime>=1000){saveTime=0;persist();}update();}
  syncScene(active?dt/1000:0);renderer?.render(scene,camera);raf=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{last=0;down=null;if(document.hidden&&ready)persist();});
window.addEventListener('pagehide',()=>{if(ready)persist();});
window.addEventListener('pageshow',()=>{last=0;});
$('view').addEventListener('webglcontextlost',e=>{e.preventDefault();fail(new Error('WebGL context lost'));});
function fail(error){console.error('Store scene failed:',error);ready=false;$('load-error').hidden=false;toast('3D 載入失敗，進度未清除');update();}
const observer=new ResizeObserver(resize);observer.observe($('stage'));
$('save-status').textContent=loaded.ok?'進度會儲存在此裝置':loaded.message;
if(!loaded.ok)toast(loaded.message);
try{
  renderer=new THREE.WebGLRenderer({canvas:$('view'),antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  // Baked contact pads plus unshadowed lights avoid low-resolution shadow acne.
  scene.add(new THREE.HemisphereLight(0xfffbeb,0xb2c2b5,2.5));const sun=new THREE.DirectionalLight(0xfff0d5,2.6);sun.position.set(-4,8,6);scene.add(sun);resize();
  const gltf=await loadScene(new GLTFLoader(),'./assets/mini-store.glb');model=gltf.scene;
  for(let i=0;i<4;i++){const t=model.getObjectByName('Customer_'+i);if(!t)throw Error('Missing customer template');t.visible=false;templates.push(t);}
  for(let i=0;i<36;i++){const g=model.getObjectByName('Stock_'+String(i).padStart(2,'0'));if(!g)throw Error('Missing stock mesh');goods.push(g);}
  scene.add(model);ready=true;toast(!loaded.ok?loaded.message:'小店開門了！等顧客選好商品，再點櫃台結帳');update();syncScene(0);raf=requestAnimationFrame(frame);
}catch(error){fail(error);}
