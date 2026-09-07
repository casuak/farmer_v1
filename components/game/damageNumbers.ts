import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { HitEvent } from "./combat";
import { Voxels } from "./voxel";

export const DAMAGE_NUMBER_LIFE=.85,DAMAGE_NUMBER_COUNT=24;
// Texture-free voxel glyphs stay crisp and avoid runtime font/canvas dependencies.
const glyphs={1:["010","110","010","010","111"],2:["111","001","111","100","111"]};
export function createDamageNumbers(scene:Scene){
  const material=new StandardMaterial("damage-number-ink",scene);material.disableLighting=true;material.emissiveColor=Color3.White();material.disableDepthWrite=true;
  const templates=[1,2].map(damage=>{
    const voxels=new Voxels(),cells=[[-3,2],[-2,2]];
    glyphs[damage as 1|2].forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell==="1")cells.push([x,y]);}));
    for(const [x,y] of cells){const px=(x+.5)*.112,py=(2-y)*.112;voxels.box(px,py,.014,.145,.145,.015,"#743933");}
    for(const [x,y] of cells)voxels.box((x+.5)*.112,(2-y)*.112,0,.106,.106,.018,damage===2?"#ffcf87":"#fff0bd");
    const mesh=voxels.build("damage-glyph-"+damage,scene,material);mesh.receiveShadows=false;mesh.setEnabled(false);return mesh;
  });
  const labels=Array.from({length:DAMAGE_NUMBER_COUNT},(_,i)=>{
    const root=new TransformNode("floating-damage-"+i,scene);root.billboardMode=TransformNode.BILLBOARDMODE_ALL;
    const digits=templates.map((template,j)=>{const mesh=template.clone(`damage-${i}-${j+1}`,root)!;mesh.isPickable=false;mesh.receiveShadows=false;mesh.setEnabled(false);return mesh;});
    root.setEnabled(false);return {root,digits,life:0,damage:0,x:0,z:0,lane:0,height:1.28};
  });
  let index=0;
  function show(hit:HitEvent){
    const label=labels[index%DAMAGE_NUMBER_COUNT];label.life=DAMAGE_NUMBER_LIFE;label.damage=hit.damage;label.x=hit.x;label.z=hit.z;label.height=hit.height??1.28;label.lane=(index++%3-1)*.12;
    label.root.position.set(hit.x,label.height,hit.z);label.root.scaling.setAll(1);label.root.setEnabled(true);
    label.digits.forEach((mesh,i)=>{mesh.setEnabled(i+1===hit.damage);mesh.visibility=1;mesh.position.x=label.lane;});
  }
  function update(dt:number,motion:boolean){
    for(const label of labels)if(label.life>0){
      label.life=Math.max(0,label.life-dt);const progress=1-label.life/DAMAGE_NUMBER_LIFE;
      label.root.position.set(label.x,label.height+(motion?progress*.65:0),label.z);
      label.root.scaling.setAll(motion?1+Math.sin(Math.min(1,progress*4)*Math.PI)*.20:1);
      const opacity=Math.min(1,label.life/.30);
      for(const mesh of label.digits){mesh.visibility=opacity;mesh.position.x=label.lane+(motion?label.lane*progress:0);}
      if(label.life===0)label.root.setEnabled(false);
    }
  }
  return {show,update,labels};
}
