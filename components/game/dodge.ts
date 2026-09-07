import type { Point } from "./farming";
import { moveWithCollisions } from "./movement";

export const DODGE={duration:.48,cooldown:2.2,distance:4.1,iframeStart:.025,iframeEnd:.32} as const;
export type DodgeSnapshot={active:boolean;progress:number;cooldown:number;ready:boolean;invulnerable:boolean};
const travel=(u:number)=>1-(1-Math.max(0,Math.min(1,u)))**2;

/** One deliberate roll per press. Displacement is integrated, never a teleport through geometry. */
export class DodgeModel{
  elapsed:number=DODGE.duration;cooldown=0;heading=0;direction:Point={x:0,z:-1};rolls=0;
  get active(){return this.elapsed<DODGE.duration;}
  get invulnerable(){return this.active&&this.elapsed>=DODGE.iframeStart&&this.elapsed<DODGE.iframeEnd;}
  get progress(){return Math.min(1,this.elapsed/DODGE.duration);}
  begin(direction:Point,facing:number){
    if(this.active||this.cooldown>0)return false;
    const length=Math.hypot(direction.x,direction.z);
    this.direction=Number.isFinite(length)&&length>.001?{x:direction.x/length,z:direction.z/length}:{x:-Math.sin(facing),z:-Math.cos(facing)};
    if(!Number.isFinite(this.direction.x+this.direction.z))return false;
    this.heading=Math.atan2(-this.direction.x,-this.direction.z);this.elapsed=0;this.cooldown=DODGE.cooldown;this.rolls++;return true;
  }
  update(dt:number,position:Point,canWalk:(x:number,z:number)=>boolean){
    if(!Number.isFinite(dt)||dt<=0)return false;
    const step=Math.min(dt,.045);this.cooldown=Math.max(0,this.cooldown-step);if(!this.active)return false;
    const before=this.progress;this.elapsed=Math.min(DODGE.duration,this.elapsed+step);
    const amount=(travel(this.progress)-travel(before))*DODGE.distance;
    return moveWithCollisions(position,this.direction.x*amount,this.direction.z*amount,canWalk);
  }
  cancel(){this.elapsed=DODGE.duration;}
  reset(){this.cancel();this.cooldown=0;}
  snapshot():DodgeSnapshot{return {active:this.active,progress:this.progress,cooldown:this.cooldown,ready:!this.active&&this.cooldown<=0,invulnerable:this.invulnerable};}
}

/** Smooth tuck, one forward rotation, then unroll; reduced motion keeps a crouched dash. */
export function dodgePose(progress:number,motion=true){
  const u=Math.max(0,Math.min(1,progress)),tuck=Math.sin(Math.PI*u)**.65;
  const turn=u*u*(3-2*u);
  return {pitch:motion?-Math.PI*2*turn:-.25*tuck,tuck,scaleY:1-.42*tuck,scaleXZ:1+.06*tuck,lift:motion?.25*tuck:.02*tuck};
}
