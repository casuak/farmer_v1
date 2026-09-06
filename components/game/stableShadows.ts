import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export const SHADOW_MAP_SIZE=4096;
export const SHADOW_HALF_EXTENT=50;
export const SHADOW_DISTANCE=70;

/** Keep the directional shadow raster anchored to whole texels in light space. */
export function createShadowAnchor(mapSize=SHADOW_MAP_SIZE){
  const right=Vector3.Zero(),up=Vector3.Zero(),center=Vector3.Zero();
  const worldUp=Vector3.Up();
  return (target:{x:number;z:number},direction:Vector3,position:Vector3)=>{
    Vector3.CrossToRef(worldUp,direction,right);right.normalize();
    Vector3.CrossToRef(direction,right,up);up.normalize();
    const texel=SHADOW_HALF_EXTENT*2/mapSize;
    const x=Math.round((target.x*right.x+target.z*right.z)/texel)*texel;
    const y=Math.round((target.x*up.x+target.z*up.z)/texel)*texel;
    // Depth is snapped too, preventing tiny changes in depth precision when the
    // camera eases to rest. Sun direction stays continuous across the day.
    const z=Math.round((target.x*direction.x+target.z*direction.z)/texel)*texel;
    center.set(right.x*x+up.x*y+direction.x*z,right.y*x+up.y*y+direction.y*z,right.z*x+up.z*y+direction.z*z);
    position.set(center.x-direction.x*SHADOW_DISTANCE,center.y-direction.y*SHADOW_DISTANCE,center.z-direction.z*SHADOW_DISTANCE);
  };
}
