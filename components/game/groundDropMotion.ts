import type { Point } from "./farming";
export type GroundDropFlight={elapsed:number;duration:number;from:Point&{y:number}};
export const INVENTORY_DROP={bodyHeight:.9,duration:.84,radius:.24,pathStep:.06} as const;
/** The farmer's face points down local -Z, exactly as engine tool aiming does. */
export function inventoryDropLanding(origin:Point,yaw:number,canWalk:(x:number,z:number,r?:number)=>boolean,clearReach:(a:Point,b:Point)=>boolean,occupied:readonly Point[]=[]):Point|null {
  if(![origin.x,origin.z,yaw].every(Number.isFinite))return null;
  // No unsafe unconditional fallback: e.g. a boat in open water keeps its inventory.
  if(!canWalk(origin.x,origin.z,INVENTORY_DROP.radius))return null;
  const safe=(p:Point)=>{
    if(!canWalk(p.x,p.z,INVENTORY_DROP.radius)||!clearReach(origin,p))return false;
    const distance=Math.hypot(p.x-origin.x,p.z-origin.z),steps=Math.max(1,Math.ceil(distance/INVENTORY_DROP.pathStep));
    // Inflate each sample by half a step so even a grazing corner between samples
    // is covered, rather than merely checking a thin ray or isolated footprints.
    const radius=INVENTORY_DROP.radius+distance/steps/2;
    for(let i=0;i<=steps;i++){const u=i/steps;if(!canWalk(origin.x+(p.x-origin.x)*u,origin.z+(p.z-origin.z)*u,radius))return false;}
    return true;
  };
  let fallback:Point|null=null;
  // Prefer a forward fan, shorten the throw, then try beside/behind the farmer.
  for(const shifts of [[0,.38,-.38,.76,-.76],[1.2,-1.2,Math.PI/2,-Math.PI/2,2.3,-2.3,Math.PI]]){
    for(const radius of [1.05,.8,.5,.28])for(const shift of shifts){
      const angle=yaw+shift,p={x:origin.x-Math.sin(angle)*radius,z:origin.z-Math.cos(angle)*radius};
      if(!safe(p))continue;
      fallback??=p;
      if(occupied.every(other=>Math.hypot(p.x-other.x,p.z-other.z)>.58))return p;
    }
    // Crowded forward space is preferable to throwing behind the visible facing.
    if(fallback)return fallback;
  }
  const feet={x:origin.x,z:origin.z};return safe(feet)?feet:null;
}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
/** Ballistic pop + a small settling bounce. y is the visible pile's center, not its pivot. */
export function groundDropPose(flight:GroundDropFlight,to:Point,restY:number,motion=true){
  const u=clamp(flight.elapsed/flight.duration),travel=clamp(u/.76),bounce=clamp((u-.76)/.24);
  const height=motion?.72:.16;
  const y=flight.from.y+(restY-flight.from.y)*travel+4*height*travel*(1-travel)+(u>.76?Math.sin(Math.PI*bounce)*(motion?.13:.025):0);
  const spin=motion?Math.sin(Math.PI*travel)*(1-travel*.3):0;
  return {x:flight.from.x+(to.x-flight.from.x)*travel,z:flight.from.z+(to.z-flight.from.z)*travel,y,roll:spin*.32,turn:spin*1.4,progress:u};
}
