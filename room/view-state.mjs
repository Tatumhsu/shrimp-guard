export function presentation(s){return {stock:s.stock,customers:s.customers.map(c=>({id:c.id,phase:c.phase,paid:c.paid})),queue:s.queue};}
export function fitCamera(THREE,camera,bounds,aspect){
  camera.updateMatrixWorld(true);
  const pts=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])pts.push(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
  const extentX=Math.max(...pts.map(p=>Math.abs(p.x)))*1.09,extentY=Math.max(...pts.map(p=>Math.abs(p.y)))*1.09;
  const h=Math.max(extentY,extentX/aspect);camera.left=-h*aspect;camera.right=h*aspect;camera.top=h;camera.bottom=-h;camera.updateProjectionMatrix();
}
export function loadScene(loader,url){return new Promise((resolve,reject)=>loader.load(url,resolve,undefined,reject));}
export function createConfirmation(){let action=null;return {open(fn){if(action)return false;action=fn;return true;},cancel(){action=null;},confirm(){const fn=action;action=null;if(!fn)return false;fn();return true;},get pending(){return !!action;}};}
