import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ItemId } from "./inventory";
import { ITEM_SPRITES } from "./itemSprites";

/** Cache per scene; all instances of an item share a single texture/material. */
export function itemSpriteMaterial(scene:Scene,id:ItemId){
  const name="item-sprite-"+id,existing=scene.getMaterialByName(name);
  if(existing)return existing as StandardMaterial;
  const texture=new Texture(ITEM_SPRITES[id],scene,true,true,Texture.NEAREST_SAMPLINGMODE);
  texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  const material=new StandardMaterial(name,scene);
  material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
  material.transparencyMode=Material.MATERIAL_ALPHATEST;material.alphaCutOff=.4;
  material.disableLighting=true;material.emissiveColor=Color3.White();
  material.specularColor=Color3.Black();material.backFaceCulling=false;
  return material;
}
