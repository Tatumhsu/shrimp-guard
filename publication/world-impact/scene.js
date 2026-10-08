import * as THREE from 'three';
import {GLTFLoader} from './assets/GLTFLoader.js';
export async function start(container){
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-5.4,5.4,4.6,-4.6,.1,80);camera.position.set(8,10,12);camera.lookAt(0,.3,-.3);
 scene.add(new THREE.HemisphereLight(0xfff8e5,0x648373,3));const light=new THREE.DirectionalLight(0xffead0,4);light.position.set(1,8,5);scene.add(light);const fill=new THREE.DirectionalLight(0xffffff,2);fill.position.set(-5,4,-4);scene.add(fill);
 let model;try{const gltf=await new GLTFLoader().loadAsync('./assets/world.glb');model=gltf.scene;scene.add(model)}catch(e){renderer.dispose();throw e}
 container.append(renderer.domElement);container.classList.add('active');
 const render=()=>renderer.render(scene,camera);const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.left=-5.4;camera.right=5.4;camera.top=5.4*h/w;camera.bottom=-5.4*h/w;camera.updateProjectionMatrix();render()};const observer=new ResizeObserver(resize);observer.observe(container);resize();
 let last=null;const down=e=>{last=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};const move=e=>{if(last!==null){model.rotation.y+=(e.clientX-last)*.006;last=e.clientX;render()}};const up=()=>last=null;renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up);
 const lost=e=>{e.preventDefault();container.dispatchEvent(new Event('webgl-failed'));document.getElementById('poster').style.visibility='visible';document.getElementById('visual-status').textContent='3D連線中斷，已顯示靜態備援';};renderer.domElement.addEventListener('webglcontextlost',lost);
 return {dispose(){observer.disconnect();model.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()});renderer.dispose();renderer.domElement.remove();container.classList.remove('active')}};
}
