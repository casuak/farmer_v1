import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PlayerHealth } from "./beachBoss";

/** Local avatar feedback only: never tint the entire scene or flicker the camera. */
export function createPlayerHitView(scene:Scene,avatar:TransformNode,health:PlayerHealth){
  const flash=new StandardMaterial("farmer-boss-hit",scene);flash.disableLighting=true;flash.emissiveColor=Color3.FromHexString("#f48d73");
  const meshes=avatar.getChildMeshes().filter(m=>m.name.startsWith("farmer-")),original=meshes.map(mesh=>({mesh,material:mesh.material,vertexColors:mesh.useVertexColors}));
  let tinted=false;
  function update(){
    const hit=health.flash>0;if(hit===tinted)return;tinted=hit;
    for(const {mesh,material,vertexColors} of original){mesh.material=hit?flash:material;mesh.useVertexColors=hit?false:vertexColors;}
  }
  return {update};
}
