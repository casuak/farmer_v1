import type { Point } from "./farming";
import { BOAT_START,canSail,seaHeight } from "./geography";
import { moveWithCollisions } from "./movement";

export const BOAT_SPEED=10.5;
export const BOAT_SEAT_HEIGHT=.10;
export class BoatModel {
  position={...BOAT_START};aboard=false;yaw=0;moving=false;
  board(player:Point){if(this.aboard||Math.hypot(player.x-this.position.x,player.z-this.position.z)>2.9)return false;this.aboard=true;return true;}
  landing(canWalk:(x:number,z:number)=>boolean):Point|null {
    for(const r of [1.5,2,2.5,2.9])for(let i=0;i<32;i++){const a=i*Math.PI/16,p={x:this.position.x+Math.cos(a)*r,z:this.position.z+Math.sin(a)*r};if(canWalk(p.x,p.z))return p;}return null;
  }
  disembark(canWalk:(x:number,z:number)=>boolean){if(!this.aboard)return null;const p=this.landing(canWalk);if(p){this.aboard=false;this.moving=false;}return p;}
  move(dx:number,dz:number,dt:number){
    this.moving=false;if(!this.aboard)return false;
    const length=Math.hypot(dx,dz);if(length<.001)return false;
    this.yaw=Math.atan2(-dx,-dz);this.moving=moveWithCollisions(this.position,dx/length*BOAT_SPEED*dt,dz/length*BOAT_SPEED*dt,canSail);return this.moving;
  }
  height(time:number){return seaHeight(this.position.x,this.position.z,time);}
  reset(){this.position={...BOAT_START};this.aboard=false;this.moving=false;this.yaw=0;}
}
