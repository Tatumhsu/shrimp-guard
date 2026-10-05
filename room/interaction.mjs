// Pure, bounded interaction logic shared by the viewer and Node tests.
export class TapGuard {
  constructor() { this.points = new Map(); }
  down(e) {
    if (this.points.size) for (const p of this.points.values()) p.cancelled = true;
    this.points.set(e.pointerId, {x:e.clientX,y:e.clientY,time:e.timeStamp,
      maxDistance:0,cancelled:this.points.size > 0});
  }
  move(e) {
    const p=this.points.get(e.pointerId);
    if(p) p.maxDistance=Math.max(p.maxDistance,Math.hypot(e.clientX-p.x,e.clientY-p.y));
  }
  up(e) {
    this.move(e); const p=this.points.get(e.pointerId); this.points.delete(e.pointerId);
    return !!p && !p.cancelled && p.maxDistance <= 8 && e.timeStamp-p.time <= 650 && !this.points.size;
  }
  cancel(id) { this.points.delete(id); }
  clear() { this.points.clear(); }
}

// Quintic ease: zero velocity and acceleration at both ends, so every segment joins smoothly.
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
const ramp=(t,[a,b])=>ease((t-a)/(b-a));
const pulse=(t,up,down)=>ramp(t,up)-ramp(t,down);
// Segment times in seconds on the normal 3.2 s timeline; reduced motion plays the same
// shape 1.6x faster (2 s). Head leads, chest follows, then hips/legs; arm rises after the head.
export const GREETING_TIMELINE=Object.freeze({
  duration:3.2, reducedSpeed:1.6, notice:.55, greetEnd:2.3,
  head:{up:[0,.55],down:[2.3,3.05]},
  chest:{up:[.1,.85],down:[2.4,3.1]},
  root:{up:[.2,1],down:[2.5,3.15]},
  bow:{up:[.2,.95],down:[2.45,3.15]},
  arm:{up:[.55,1.3],down:[2.4,3.1]},
  wave:[1.55,2.4]
});
const L=GREETING_TIMELINE, SHARE={root:.55,chest:.3};
const IDLE=Object.freeze({phase:'idle',busy:false,yaw:0,chestYaw:0,headYaw:0,armX:0,armZ:0,bow:0});
export class Greeting {
  constructor() { this.started=null; this.yaw=0; this.reduced=false; this.count=0; }
  start(now,yaw=0,reduced=false) {
    if(this.started!==null) return false;
    this.started=now; this.yaw=Math.max(-1.1,Math.min(1.1,yaw)); this.reduced=reduced; this.count++;
    return true;
  }
  sample(now) {
    if(this.started===null) return IDLE;
    const real=Math.max(0,(now-this.started)/1000);
    if(real>=(this.reduced?L.duration/L.reducedSpeed:L.duration)) {this.started=null;return IDLE;}
    const t=this.reduced?real*L.reducedSpeed:real, Y=this.yaw;
    const rootYaw=Y*SHARE.root*pulse(t,L.root.up,L.root.down);
    const chestYaw=Y*SHARE.chest*pulse(t,L.chest.up,L.chest.down);
    const headTotal=Y*pulse(t,L.head.up,L.head.down);
    // Restrained wave: sine inside a smooth 0..1..0 window, so it starts and ends at zero.
    const u=(t-L.wave[0])/(L.wave[1]-L.wave[0]), w=u>0&&u<1?ease(u)*(1-ease(u))*4:0;
    return {phase:t<L.notice?'notice':t<L.greetEnd?'greet':'return',busy:true,
      yaw:rootYaw,chestYaw,headYaw:headTotal-rootYaw-chestYaw,
      armX:(this.reduced?-.55:-1.02)*pulse(t,L.arm.up,L.arm.down),
      armZ:this.reduced?0:.07*Math.sin(u*3*Math.PI)*w,
      bow:(this.reduced?.025:.045)*pulse(t,L.bow.up,L.bow.down)};
  }
}
