import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Obstacle } from "./world";

type Stamp={x:number;z:number;width:number;depth:number;opacity:number};

/** One shared soft occlusion texture and one batch for all static ground contacts. */
export function createContactShadows(scene:Scene,obstacles:Obstacle[]) {
  const size=64,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const radius=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1);
    const edge=Math.max(0,1-radius*radius),i=(y*size+x)*4;
    pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.round(edge*edge*255);
  }
  const texture=RawTexture.CreateRGBATexture(pixels,size,size,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
  texture.name="soft-ground-contact";texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  const material=new StandardMaterial("ground-contact-shading",scene);
  material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
  material.diffuseColor=Color3.Black();material.emissiveColor=Color3.FromHexString("#26392f");
  material.specularColor=Color3.Black();material.disableLighting=true;material.backFaceCulling=true;

  function batch(name:string,stamps:Stamp[]) {
    const positions:number[]=[],normals:number[]=[],uvs:number[]=[],colors:number[]=[],indices:number[]=[];
    for(const s of stamps) {
      const base=positions.length/3;
      for(const [x,z,u,v] of [[-1,-1,0,0],[-1,1,0,1],[1,1,1,1],[1,-1,1,0]]) {
        positions.push(s.x+x*s.width/2,0,s.z+z*s.depth/2);normals.push(0,1,0);uvs.push(u,v);colors.push(1,1,1,s.opacity);
      }
      indices.push(base,base+2,base+1,base,base+3,base+2);
    }
    const mesh=new Mesh(name,scene),data=new VertexData();
    data.positions=positions;data.normals=normals;data.uvs=uvs;data.colors=colors;data.indices=indices;
    data.applyToMesh(mesh);mesh.material=material;mesh.hasVertexAlpha=true;mesh.isPickable=false;
    mesh.position.y=.024;return mesh;
  }
  const stamps=obstacles.filter(o=>o.kind!=="fence").map(o=>({
    x:o.x,z:o.z,width:o.w+(o.kind==="building"?1.9:1.0),depth:o.d+(o.kind==="building"?1.9:1.0),opacity:o.kind==="tree"?.40:o.kind==="building"?.34:.27,
  }));
  const ground=batch("soft-object-contact-shadows",stamps);ground.freezeWorldMatrix();
  const player=batch("farmer-contact-shadow",[{x:0,z:0,width:1.02,depth:.78,opacity:.44}]);player.setEnabled(false);
  return {
    update(position:{x:number;y:number;z:number}|undefined,enabled:boolean) {
      ground.setEnabled(enabled);player.setEnabled(enabled&&!!position);
      if(position)player.position.set(position.x,position.y+.027,position.z);
    },
  };
}
