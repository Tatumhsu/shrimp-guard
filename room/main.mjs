import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TapGuard,Greeting} from './interaction.mjs';
import {createGreetingRig} from './rig.mjs';

const canvas=document.querySelector('#view'), stage=document.querySelector('.viewport');
const status=document.querySelector('#status'), greet=document.querySelector('#greet'), reset=document.querySelector('#reset');
const response=new Greeting(), tap=new TapGuard(), reduced=matchMedia('(prefers-reduced-motion: reduce)');
let renderer, controls, model, adult, arm, rig, raf=0, disposed=false;
let pose={phase:'loading',busy:false}, homePosition, homeTarget, resizeObserver;
const scene=new THREE.Scene();scene.background=new THREE.Color('#ded5c9');
const camera=new THREE.OrthographicCamera(-4,4,3,-3,.1,80);
camera.position.set(6.8,6.8,9.3);camera.lookAt(0,1.05,-.1);
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(), point=new THREE.Vector3();
let baseY=0;
function isCharacter(obj){for(let o=obj;o;o=o.parent)if(o===adult)return true;return false;}
function resize(){
  if(!renderer)return;
  const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight),aspect=w/h;
  const viewHeight=Math.max(5.7,6.65/aspect);
  camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;
  camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
}
function beginGreeting(){
  if(!adult||disposed)return false;
  adult.getWorldPosition(point);
  const yaw=Math.atan2(camera.position.x-point.x,camera.position.z-point.z);
  const accepted=response.start(performance.now(),yaw,reduced.matches);
  if(accepted){status.textContent='嗨，看到你了。';greet.disabled=true;}
  return accepted;
}
function resetView(){
  if(!controls)return;
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
  controls.reset();controls.enableDamping=damping;tap.clear();
}
function tick(now){
  raf=0;if(disposed||document.hidden)return;
  controls.update();pose=response.sample(now);
  rig.apply(pose);
  adult.position.y=baseY+(!pose.busy&&!reduced.matches?.003*Math.sin(now/900):0);
  if(!pose.busy&&greet.disabled){greet.disabled=false;status.textContent='房間裡，一切剛剛好。';}
  renderer.render(scene,camera);raf=requestAnimationFrame(tick);
}
function startLoop(){if(!raf&&!disposed&&adult&&!document.hidden)raf=requestAnimationFrame(tick);}
canvas.addEventListener('pointerdown',e=>{if(e.button===0)tap.down(e);});
canvas.addEventListener('pointermove',e=>tap.move(e));
canvas.addEventListener('pointercancel',e=>tap.cancel(e.pointerId));
canvas.addEventListener('lostpointercapture',e=>tap.cancel(e.pointerId));
window.addEventListener('blur',()=>tap.clear());
canvas.addEventListener('pointerup',e=>{
  if(!tap.up(e)||!adult)return;
  const rect=canvas.getBoundingClientRect();
  pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObject(model,true)[0];
  if(hit&&isCharacter(hit.object))beginGreeting();
});
greet.addEventListener('click',beginGreeting);reset.addEventListener('click',resetView);
document.addEventListener('visibilitychange',()=>{
  tap.clear();if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;}else startLoop();
});
canvas.addEventListener('webglcontextlost',e=>{
  e.preventDefault();if(raf)cancelAnimationFrame(raf);raf=0;disposed=true;
  status.textContent='3D 顯示已中斷；重新載入頁面可重試。';greet.disabled=true;reset.disabled=true;
});
window.addEventListener('pagehide',e=>{
  if(e.persisted){if(raf)cancelAnimationFrame(raf);raf=0;tap.clear();return;}
  disposed=true;if(raf)cancelAnimationFrame(raf);raf=0;tap.clear();resizeObserver?.disconnect();controls?.dispose();
  model?.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.dispose();}});
  renderer?.dispose();
});
Object.defineProperty(window,'roomDebug',{value:Object.freeze({getState:()=>({
  loaded:!!adult,phase:pose.phase,busy:pose.busy,greetings:response.count,
  activePointers:tap.points.size,loopRunning:!!raf,zoom:camera.zoom,
  source:'room-prototype.blend',reducedMotion:reduced.matches,
  renderer:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}:null
})}),writable:false});

try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.15;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene.add(new THREE.HemisphereLight(0xfff7e6,0x9b8061,2.2));
  const key=new THREE.DirectionalLight(0xffe4c3,3.2);key.position.set(-3,6,5);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});
  key.shadow.bias=-.00035;key.shadow.normalBias=.025;scene.add(key);
  const fill=new THREE.DirectionalLight(0xd6e4ff,.8);fill.position.set(4,4,1);scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0xded5c9,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.315;ground.receiveShadow=true;scene.add(ground);
  controls=new OrbitControls(camera,canvas);controls.target.set(0,1.05,-.1);
  controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;
  controls.minZoom=.7;controls.maxZoom=2.4;controls.minPolarAngle=.35;controls.maxPolarAngle=1.35;
  controls.minAzimuthAngle=-1.15;controls.maxAzimuthAngle=1.45;
  controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
  controls.update();controls.saveState();homePosition=camera.position.clone();homeTarget=controls.target.clone();
  const gltf=await new GLTFLoader().loadAsync('./assets/room.glb');
  if(disposed)throw new Error('Page closed during model loading');
  model=gltf.scene;adult=model.getObjectByName('AdultRoot');arm=model.getObjectByName('GreetingArmPivot');
  if(!adult||!arm)throw new Error('Expected approved character pivots not found');
  rig=createGreetingRig(THREE,model,adult,arm);baseY=adult.position.y;
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(model);
  resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);resize();
  document.querySelector('#poster').hidden=true;canvas.classList.add('ready');greet.disabled=false;reset.disabled=false;
  status.textContent='房間裡，一切剛剛好。';pose=response.sample(performance.now());startLoop();
}catch(error){
  console.error('Room viewer failed',error);disposed=true;controls?.dispose();renderer?.dispose();
  document.querySelector('#poster').hidden=false;greet.disabled=true;reset.disabled=true;
  status.textContent='目前顯示核准渲染圖，尚未啟用互動。';
  const alert=document.querySelector('#error');alert.hidden=false;
  alert.textContent='3D 載入未完成。請確認透過本機 HTTP 預覽開啟，且瀏覽器支援 WebGL2。';
}
