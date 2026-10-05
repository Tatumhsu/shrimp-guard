// Runtime-only, transform-only pivots over the existing character meshes (no geometry change).
// Takes THREE as an argument so the viewer and the Node tests share the same code.
// GLTFLoader sanitizes Blender duplicate suffixes: Ear.001 becomes Ear001.
const norm=n=>n.replace(/[\s_]+/g,' ').replace(/\.?\d{3}$/,'').trim();
const HEAD=new Set(['Adult head','Hair back','Hair crown','Hair side','Ear','Eye','Eyebrow','Nose','Small neutral smile']);
const BODY=new Set(['Sage shirt torso','Neck']);
const ARM=/^(Shirt sleeve|Forearm|Hand)( joint)?$/;

export function createGreetingRig(THREE,model,adult,arm){
  model.updateMatrixWorld(true);
  const head=[],body=[],parts=adult.children.filter(o=>o!==arm&&o.isMesh);
  for(const o of parts){const n=norm(o.name);if(HEAD.has(n))head.push(o);else if(BODY.has(n)||ARM.test(n))body.push(o);}
  const torso=body.find(o=>norm(o.name)==='Sage shirt torso'), skull=head.find(o=>norm(o.name)==='Adult head');
  if(!torso||!skull||head.length!==12||body.length!==7)throw new Error('Character parts not found for greeting pivots');
  const chestWorld=torso.getWorldPosition(new THREE.Vector3());chestWorld.y-=.16;   // top of the hips
  const headWorld=skull.getWorldPosition(new THREE.Vector3());headWorld.y-=.10;     // top of the neck
  const chest=new THREE.Object3D();chest.name='UpperBodyPivot';
  adult.add(chest);chest.position.copy(adult.worldToLocal(chestWorld));chest.updateMatrixWorld(true);
  const neck=new THREE.Object3D();neck.name='HeadPivot';
  chest.add(neck);neck.position.copy(chest.worldToLocal(headWorld));neck.updateMatrixWorld(true);
  for(const o of body)chest.attach(o);
  chest.attach(arm);
  for(const o of head)neck.attach(o);
  const baseAdult=adult.quaternion.clone(),baseArm=arm.quaternion.clone();
  const UP=new THREE.Vector3(0,1,0),RIGHT=new THREE.Vector3(1,0,0),FORWARD=new THREE.Vector3(0,0,1);
  const qYaw=new THREE.Quaternion(),qBow=new THREE.Quaternion(),qArm=new THREE.Quaternion(),qWiggle=new THREE.Quaternion();
  return {chest,neck,adult,arm,head,body,
    // Constant-time, allocation-free pose application.
    apply(pose){
      qYaw.setFromAxisAngle(UP,pose.yaw);adult.quaternion.copy(qYaw).multiply(baseAdult);
      qYaw.setFromAxisAngle(UP,pose.chestYaw);qBow.setFromAxisAngle(RIGHT,pose.bow);
      chest.quaternion.copy(qYaw).multiply(qBow);
      neck.quaternion.setFromAxisAngle(UP,pose.headYaw);
      qArm.setFromAxisAngle(RIGHT,pose.armX);qWiggle.setFromAxisAngle(FORWARD,pose.armZ);
      arm.quaternion.copy(baseArm).multiply(qArm).multiply(qWiggle);
    }};
}
