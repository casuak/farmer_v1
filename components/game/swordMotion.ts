/** Shared sword animation and contact timings, in seconds. */
export const SWORD={duration:.60,windup:.13,impact:.22,cutEnd:.33,cooldown:.70} as const;
export const SWORD_BLADE_BASE={x:0,y:-.18,z:0} as const;
export const SWORD_BLADE_TIP={x:0,y:-.94,z:0} as const;
export type SwordPose={shoulderX:number;shoulderY:number;shoulderZ:number;elbowX:number;wristX:number;wristY:number;wristZ:number;supportX:number;supportZ:number;supportElbow:number;torsoYaw:number;torsoPitch:number;lean:number;weight:number};
export const SWORD_HOLD_POSE:SwordPose={shoulderX:.45,shoulderY:-.20,shoulderZ:.10,elbowX:.95,wristX:1.35,wristY:0,wristZ:.50,supportX:.08,supportZ:-.04,supportElbow:.18,torsoYaw:0,torsoPitch:0,lean:0,weight:0};
type Key={time:number;stop?:boolean;pose:SwordPose};
const key=(time:number,pose:Partial<SwordPose>,stop=false):Key=>({time,stop,pose:{...SWORD_HOLD_POSE,...pose}});
const KEYS:Key[]=[
  key(0,{},true),
  // Raise to the right shoulder, load the hips and keep the off-hand clear of the blade.
  key(SWORD.windup,{shoulderX:1.02,shoulderY:-.80,shoulderZ:.24,elbowX:1.05,wristX:.55,wristZ:-.18,supportX:.36,supportZ:-.15,supportElbow:.44,torsoYaw:-.30,torsoPitch:.025,lean:.035,weight:.014},true),
  // The elbow leads and the wrist unfolds through contact, without stopping at this key.
  key(SWORD.impact,{shoulderX:1.18,shoulderY:-.08,shoulderZ:.04,elbowX:.28,wristX:.06,wristZ:.03,supportX:.24,supportZ:-.25,supportElbow:.52,torsoYaw:.08,torsoPitch:-.035,lean:-.09,weight:-.025}),
  // Follow through across the front, not through the legs; shoulders brake the sword.
  key(SWORD.cutEnd,{shoulderX:.97,shoulderY:.75,shoulderZ:-.18,elbowX:.38,wristX:.12,wristZ:.16,supportX:.16,supportZ:-.19,supportElbow:.40,torsoYaw:.36,torsoPitch:-.025,lean:-.08,weight:-.018},true),
  key(.46,{shoulderX:.72,shoulderY:.30,shoulderZ:.02,elbowX:.82,wristX:.65,wristZ:.08,supportX:.10,supportZ:-.09,supportElbow:.24,torsoYaw:.16,torsoPitch:0,lean:-.025,weight:-.004}),
  key(SWORD.duration,{},true),
];
const fields=Object.keys(SWORD_HOLD_POSE) as (keyof SwordPose)[];
/** C1-continuous tracks: anticipation and recovery stop, the actual contact does not. */
export function swordPose(elapsed:number):SwordPose{
  const time=Math.max(0,Math.min(SWORD.duration,Number.isFinite(elapsed)?elapsed:0));
  let i=0;while(i<KEYS.length-2&&time>KEYS[i+1].time)i++;
  const a=KEYS[i],b=KEYS[i+1],span=b.time-a.time,u=(time-a.time)/span,u2=u*u,u3=u2*u;
  const tangent=(index:number,field:keyof SwordPose)=>{const k=KEYS[index];if(k.stop||index===0||index===KEYS.length-1)return 0;const p=KEYS[index-1],n=KEYS[index+1];return (n.pose[field]-p.pose[field])/(n.time-p.time);};
  const pose={...SWORD_HOLD_POSE};
  for(const field of fields)pose[field]=(2*u3-3*u2+1)*a.pose[field]+(u3-2*u2+u)*span*tangent(i,field)+(-2*u3+3*u2)*b.pose[field]+(u3-u2)*span*tangent(i+1,field);
  return pose;
}

/** A cosmetic swing owns exactly one delayed hit, canceled when interrupted or unequipped. */
export class SwordSwing{
  elapsed:number=SWORD.duration;heading=0;private impactSent=true;private whooshSent=true;
  get active(){return this.elapsed<SWORD.duration;}
  get remaining(){return Math.max(0,SWORD.duration-this.elapsed);}
  begin(heading:number){if(this.active||!Number.isFinite(heading))return false;this.heading=heading;this.elapsed=0;this.impactSent=this.whooshSent=false;return true;}
  update(dt:number){
    const event={impact:false,whoosh:false};if(!this.active||!Number.isFinite(dt)||dt<=0)return event;
    this.elapsed=Math.min(SWORD.duration,this.elapsed+Math.min(dt,.045));
    if(!this.whooshSent&&this.elapsed>=SWORD.windup){this.whooshSent=true;event.whoosh=true;}
    if(!this.impactSent&&this.elapsed>=SWORD.impact){this.impactSent=true;event.impact=true;}
    return event;
  }
  cancel(){this.elapsed=SWORD.duration;this.impactSent=this.whooshSent=true;}
}
