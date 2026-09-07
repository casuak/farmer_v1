import type { Point } from "./farming";
export type GroundDropFlight={elapsed:number;duration:number;from:Point&{y:number}};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
/** Ballistic pop + a small settling bounce. y is the visible pile's center, not its pivot. */
export function groundDropPose(flight:GroundDropFlight,to:Point,restY:number,motion=true){
  const u=clamp(flight.elapsed/flight.duration),travel=clamp(u/.76),bounce=clamp((u-.76)/.24);
  const height=motion?.72:.16;
  const y=flight.from.y+(restY-flight.from.y)*travel+4*height*travel*(1-travel)+(u>.76?Math.sin(Math.PI*bounce)*(motion?.13:.025):0);
  const spin=motion?Math.sin(Math.PI*travel)*(1-travel*.3):0;
  return {x:flight.from.x+(to.x-flight.from.x)*travel,z:flight.from.z+(to.z-flight.from.z)*travel,y,roll:spin*.32,turn:spin*1.4,progress:u};
}
