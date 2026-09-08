import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Occluder } from "./world";

/** Reach exact 0/1: tiny residual visibility still puts a thick voxel mesh in the alpha pass. */
export function cutawayVisibility(current:number,target:number,dt:number){
  const next=current+(target-current)*(1-Math.exp(-9*Math.max(0,Number.isFinite(dt)?dt:0)));
  return Math.abs(next-target)<.001?target:next;
}

/** Camera cutaways must not cast invisible SUN shadows into the occupied room.
 * Do not remove casters or disable meshes: the flashlight still needs physical walls.
 */
export function createRoomCutawayShadows(shadow:ShadowGenerator,occluders:readonly Occluder[]){
  const byRoom=new Map<string,Set<AbstractMesh>>();
  for(const occluder of occluders){
    if(!occluder.room||occluder.insideOpacity!==0)continue;
    let meshes=byRoom.get(occluder.room);
    if(!meshes){meshes=new Set();byRoom.set(occluder.room,meshes);}
    meshes.add(occluder.mesh);
  }
  let excluded:ReadonlySet<AbstractMesh>|undefined;
  const previous=shadow.customAllowRendering;
  const filter:typeof shadow.customAllowRendering=subMesh=>!excluded?.has(subMesh.getRenderingMesh())&&(!previous||previous(subMesh));
  shadow.customAllowRendering=filter;
  return {
    update(roomId:string|null){excluded=roomId?byRoom.get(roomId):undefined;},
    dispose(){if(shadow.customAllowRendering===filter)shadow.customAllowRendering=previous;excluded=undefined;},
  };
}
