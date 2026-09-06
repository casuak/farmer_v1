import { BOUNDS } from "./geography";

// Ground-plane projection of the fixed alpha=-45°, beta=45° camera.
// +Z (north) moves up-right; +X (east) moves down-right.
export function projectMapPoint(x:number,z:number){
  return {x:(x+z)*Math.SQRT1_2,y:(x-z)*.5};
}
export const MAP_TRANSFORM=`matrix(${Math.SQRT1_2} .5 ${-Math.SQRT1_2} .5 ${(BOUNDS.z-BOUNDS.x)*Math.SQRT1_2} ${-(BOUNDS.x+BOUNDS.z)*.5})`;
