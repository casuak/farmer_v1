import type { Point } from "./farming";

export const WALK_SPEED=3.0*2;
export const SPRINT_SPEED=3.0*4;

/** Key repeat never flips the mode a second time; key-up only releases the latch. */
export class MovementMode {
  running=true;private shiftDown=false;
  shift(down:boolean){if(down&&!this.shiftDown)this.running=!this.running;this.shiftDown=down;}
  release(){this.shiftDown=false;}
  toggle(){this.running=!this.running;}
}

export function locomotionPose(phase:number,amount:number,running:boolean,aboard=false){
  // Limbs extend down local -Y. Positive X bends them toward the face (-Z),
  // while the torso extends up +Y and needs negative X to lean forward.
  if(aboard)return {leftLeg:1.30,rightLeg:1.30,leftArm:.4,rightArm:.4,elbow:.7,bob:0,lean:-.06};
  const stride=Math.sin(phase)*amount;
  return {leftLeg:stride*(running?.94:.52),rightLeg:-stride*(running?.94:.52),leftArm:-stride*(running?.78:.42),rightArm:stride*(running?.78:.42),elbow:running?.95*amount+.10:.12,bob:Math.abs(Math.sin(phase))*(running?.15:.055)*amount,lean:running?-.19*amount:0};
}

/** Small collision steps prevent fast movement from tunnelling through fences. */
export function moveWithCollisions(position:Point,dx:number,dz:number,canWalk:(x:number,z:number)=>boolean) {
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.14));
  const mx=dx/steps,mz=dz/steps;let moved=false;
  for(let i=0;i<steps;i++) {
    if(Math.abs(mx)>.000001&&canWalk(position.x+mx,position.z)){position.x+=mx;moved=true;}
    if(Math.abs(mz)>.000001&&canWalk(position.x,position.z+mz)){position.z+=mz;moved=true;}
  }
  return moved;
}
