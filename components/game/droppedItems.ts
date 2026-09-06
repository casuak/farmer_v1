import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Point } from "./farming";
import { ITEMS,type Stack,type InventoryModel } from "./inventory";
import { Voxels,voxelMaterial } from "./voxel";
import { groundHeight,isSea,onDock,seaHeight } from "./geography";

export type GroundItem={id:number;stack:Stack;position:Point};
export class GroundItems {
  items:GroundItem[]=[];private nextId=1;
  add(stack:Stack,position:Point){
    const existing=this.items.find(i=>i.stack.id===stack.id&&i.stack.count+stack.count<=ITEMS[stack.id].max&&Math.hypot(i.position.x-position.x,i.position.z-position.z)<.7);
    if(existing){existing.stack.count+=stack.count;return existing;}
    const item={id:this.nextId++,stack:{...stack},position:{...position}};this.items.push(item);return item;
  }
  nearest(p:Point){return this.items.filter(i=>Math.hypot(i.position.x-p.x,i.position.z-p.z)<1.8).sort((a,b)=>Math.hypot(a.position.x-p.x,a.position.z-p.z)-Math.hypot(b.position.x-p.x,b.position.z-p.z))[0]??null;}
  pickup(id:number,bag:InventoryModel){const item=this.items.find(i=>i.id===id);if(!item)return {ok:false,message:"这里已经没有物品了"};if(!bag.add([item.stack]))return {ok:false,message:"物品栏已满 · 先腾出位置"};this.items=this.items.filter(i=>i.id!==id);return {ok:true,message:`拾取${ITEMS[item.stack.id].name} ×${item.stack.count}`};}
}

export function createGroundItemView(scene:Scene,model:GroundItems,heightAt:(x:number,z:number)=>number=groundHeight){
  const mat=voxelMaterial(scene,"ground-pickups"),haloMat=new StandardMaterial("pickup-halo",scene);haloMat.disableLighting=true;haloMat.emissiveColor=Color3.FromHexString("#ffefb1");haloMat.alpha=.45;
  const meshes=new Map<number,{item:Mesh;halo:Mesh;groundOffset:number}>();
  function update(time:number,motion:boolean){
    for(const [id,m] of meshes)if(!model.items.some(i=>i.id===id)){m.item.dispose();m.halo.dispose();meshes.delete(id);}
    for(const item of model.items){
      let view=meshes.get(item.id);
      if(!view){
        const v=new Voxels(),s=item.stack;
        if(s.id==="shell")v.box(0,0,0,.32,.14,.25,"#edbdad").box(0,.09,-.02,.23,.08,.20,"#ffe0c9").box(0,-.01,.16,.13,.06,.10,"#dca995");
        else if(s.id==="wood")v.box(0,0,0,.35,.18,.52,"#a27b51").box(0,0,-.265,.29,.15,.025,"#e1be87").box(.06,.16,.05,.21,.14,.45,"#b58b5a");
        else if(s.id==="turnip")v.box(0,0,0,.31,.26,.29,"#f0e6ca").box(0,.23,0,.07,.22,.07,"#86a55b").box(.08,.27,0,.22,.07,.13,"#a2bd70");
        else v.box(0,0,0,.33,.33,.28,ITEMS[s.id].color).box(0,.02,0,.055,.37,.32,"#ead8a8").box(0,.20,0,.16,.08,.12,"#c4a679");
        const mesh=v.build("dropped-"+s.id,scene,mat);mesh.isPickable=false;
        const halo=MeshBuilder.CreateTorus("pickup-ring",{diameter:.60,thickness:.024,tessellation:20},scene);halo.material=haloMat;halo.isPickable=false;
        view={item:mesh,halo,groundOffset:-mesh.getBoundingInfo().boundingBox.minimum.y+.008};meshes.set(item.id,view);
      }
      const p=item.position,base=isSea(p.x,p.z)&&!onDock(p.x,p.z)?seaHeight(p.x,p.z,motion?time:0):heightAt(p.x,p.z);
      // The mesh's bottom rests on the real floor; only its pickup ring pulses.
      view.item.position.set(p.x,base+view.groundOffset,p.z);view.item.rotation.y=item.id;view.halo.position.set(p.x,base+.028,p.z);view.halo.visibility=.4+(motion?Math.sin(time*2+item.id)*.12:0);
    }
  }
  return {update};
}
