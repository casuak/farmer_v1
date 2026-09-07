import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { groundDropPose,type GroundDropFlight } from "./groundDropMotion";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Point } from "./farming";
import { ITEMS,inventoryGains,type Stack,type InventoryModel,type InventoryGain } from "./inventory";
import { Voxels,voxelMaterial } from "./voxel";
import { groundHeight,isSea,onDock,seaHeight } from "./geography";

export type GroundItem={id:number;stack:Stack;position:Point;flight?:GroundDropFlight};
export type GroundPickupResult={ok:false;message:string}|{ok:true;message:string;gains:InventoryGain[]};
export class GroundItems {
  items:GroundItem[]=[];private nextId=1;
  add(stack:Stack,position:Point){
    const existing=this.items.find(i=>!i.flight&&i.stack.id===stack.id&&i.stack.count+stack.count<=ITEMS[stack.id].max&&Math.hypot(i.position.x-position.x,i.position.z-position.z)<.7);
    if(existing){existing.stack.count+=stack.count;return existing;}
    const item={id:this.nextId++,stack:{...stack},position:{x:position.x,z:position.z}};this.items.push(item);return item;
  }
  eject(stacks:readonly Stack[],origin:Point&{y:number},player:Point,canWalk:(x:number,z:number,r?:number)=>boolean,clearReach:(a:Point,b:Point)=>boolean):GroundItem[]{
    const angle=Math.atan2(player.z-origin.z,player.x-origin.x),created:GroundItem[]=[];
    for(const [index,stack] of stacks.entries()){
      // Search the player's side, never across a trunk, cliff or another live deposit.
      const candidates:Point[]=[];
      for(const radius of [1.0,1.3,.75,1.55])for(const shift of [0,.35,-.35,.7,-.7,1.1,-1.1]){
        const a=angle+(index%2?-.40:.40)+shift;candidates.push({x:origin.x+Math.cos(a)*radius,z:origin.z+Math.sin(a)*radius});
      }
      for(const radius of [.5,.8,1.1])for(let i=0;i<12;i++){const a=i*Math.PI/6;candidates.push({x:player.x+Math.cos(a)*radius,z:player.z+Math.sin(a)*radius});}
      const safe=candidates.filter(p=>Math.hypot(p.x-player.x,p.z-player.z)<=1.6&&canWalk(p.x,p.z,.24)&&clearReach(player,p));
      const landing=safe.find(p=>created.every(item=>Math.hypot(p.x-item.position.x,p.z-item.position.z)>.58))??safe[0]??{x:player.x,z:player.z};
      const item:GroundItem={id:this.nextId++,stack:{...stack},position:{...landing},flight:{elapsed:0,duration:.84+index*.06,from:{x:origin.x,y:origin.y,z:origin.z}}};
      // Airborne piles are independent; merging them now would teleport or hide the pop.
      this.items.push(item);created.push(item);
    }
    return created;
  }
  update(dt:number){
    if(!Number.isFinite(dt)||dt<=0)return 0;let landed=0;
    for(const item of this.items)if(item.flight){item.flight.elapsed=Math.min(item.flight.duration,item.flight.elapsed+Math.min(dt,.1));if(item.flight.elapsed>=item.flight.duration){delete item.flight;landed++;}}
    return landed;
  }
  nearest(p:Point){return this.items.filter(i=>!i.flight&&Math.hypot(i.position.x-p.x,i.position.z-p.z)<1.8).sort((a,b)=>Math.hypot(a.position.x-p.x,a.position.z-p.z)-Math.hypot(b.position.x-p.x,b.position.z-p.z))[0]??null;}
  pickup(id:number,bag:InventoryModel):GroundPickupResult{
    const item=this.items.find(i=>i.id===id);if(!item)return {ok:false,message:"这里已经没有物品了"};
    if(item.flight)return {ok:false,message:"矿物正在落地 · 稍等片刻再拾取"};
    const before=bag.snapshot().slots;
    if(!bag.add([item.stack]))return {ok:false,message:"物品栏已满 · 先腾出位置"};
    this.items=this.items.filter(i=>i.id!==id);
    return {ok:true,message:`拾取${ITEMS[item.stack.id].name} ×${item.stack.count}`,gains:inventoryGains(before,bag.slots)};
  }
}

export function createGroundItemView(scene:Scene,model:GroundItems,heightAt:(x:number,z:number)=>number=groundHeight){
  const mat=voxelMaterial(scene,"ground-pickups"),haloMat=new StandardMaterial("pickup-halo",scene);haloMat.disableLighting=true;haloMat.emissiveColor=Color3.FromHexString("#ffefb1");haloMat.alpha=.45;
  const meshes=new Map<number,{item:Mesh;halo:Mesh;groundOffset:number;centerX:number;centerY:number;centerZ:number}>();
  function update(time:number,motion:boolean){
    for(const [id,m] of meshes)if(!model.items.some(i=>i.id===id)){m.item.dispose();m.halo.dispose();meshes.delete(id);}
    for(const item of model.items){
      let view=meshes.get(item.id);
      if(!view){
        const v=new Voxels(),s=item.stack;
        if(s.id==="shell")v.box(0,0,0,.32,.14,.25,"#edbdad").box(0,.09,-.02,.23,.08,.20,"#ffe0c9").box(0,-.01,.16,.13,.06,.10,"#dca995");
        else if(s.id==="wood")v.box(0,0,0,.35,.18,.52,"#a27b51").box(0,0,-.265,.29,.15,.025,"#e1be87").box(.06,.16,.05,.21,.14,.45,"#b58b5a");
        else if(s.id==="turnip")v.box(0,0,0,.31,.26,.29,"#f0e6ca").box(0,.23,0,.07,.22,.07,"#86a55b").box(.08,.27,0,.22,.07,.13,"#a2bd70");
        else if(s.id==="pickaxe")v.box(0,.09,-.03,.06,.09,.55,"#a97e47").box(0,.11,.28,.32,.10,.08,"#94a8ac").box(-.20,.11,.33,.05,.08,.14,"#e4efe0").box(.20,.11,.33,.05,.08,.14,"#e4efe0");
        else if(s.id==="stone")v.box(0,.06,0,.30,.18,.26,"#9aa0a6").box(-.14,.03,.12,.18,.12,.16,"#7c8288").box(.13,.04,-.10,.16,.13,.14,"#b7bdc4");
        else if(s.id==="copperOre")v.box(0,.07,0,.32,.22,.28,"#8a8f96").box(-.08,.12,-.05,.09,.08,.09,"#c07f52").box(.09,.09,.07,.08,.07,.08,"#d98b52").box(.02,.04,-.13,.07,.06,.07,"#b97745");
        else if(s.id==="ironOre")v.box(0,.07,0,.32,.22,.28,"#8a8f96").box(0,.12,0,.30,.06,.24,"#4a5b74").box(-.09,.02,.11,.06,.06,.16,"#5a6b84").box(.10,.10,-.08,.05,.05,.12,"#3f4f68");
        else if(s.id==="crystal")v.box(0,.11,-.02,.12,.22,.12,"#b39be5").box(-.11,.06,.08,.08,.13,.08,"#d3c2ef").box(.10,.05,-.08,.08,.11,.08,"#9478c4").box(.02,.16,.10,.06,.14,.06,"#efe1ff");
        else v.box(0,0,0,.33,.33,.28,ITEMS[s.id].color).box(0,.02,0,.055,.37,.32,"#ead8a8").box(0,.20,0,.16,.08,.12,"#c4a679");
        const mesh=v.build("dropped-"+s.id,scene,mat);mesh.isPickable=false;
        const halo=MeshBuilder.CreateTorus("pickup-ring",{diameter:.60,thickness:.024,tessellation:20},scene);halo.material=haloMat;halo.isPickable=false;
        const bounds=mesh.getBoundingInfo().boundingBox;mesh.setPivotPoint(bounds.center);
        view={item:mesh,halo,groundOffset:-bounds.minimum.y+.008,centerX:bounds.center.x,centerY:bounds.center.y,centerZ:bounds.center.z};meshes.set(item.id,view);
      }
      const p=item.position,base=isSea(p.x,p.z)&&!onDock(p.x,p.z)?seaHeight(p.x,p.z,motion?time:0):heightAt(p.x,p.z);
      if(item.flight){
        const pose=groundDropPose(item.flight,p,base+view.groundOffset+view.centerY,motion);
        view.item.position.set(pose.x-view.centerX,pose.y-view.centerY,pose.z-view.centerZ);view.item.rotation.set(pose.roll,item.id+pose.turn,pose.roll*.7);
        // Keep the rotated mesh's actual bottom above the local floor throughout the bounce.
        view.item.computeWorldMatrix(true);const floor=heightAt(pose.x,pose.z),bottom=view.item.getBoundingInfo().boundingBox.minimumWorld.y;
        if(bottom<floor+.008)view.item.position.y+=floor+.008-bottom;
        const height=Math.max(0,pose.y-floor),scale=Math.max(.50,1-height*.22);
        view.halo.position.set(pose.x,floor+.028,pose.z);view.halo.scaling.setAll(scale);view.halo.visibility=Math.max(.10,.45-height*.15);
      }else{
        // The mesh's bottom rests on the real floor; only its pickup ring pulses.
        view.item.position.set(p.x-view.centerX,base+view.groundOffset,p.z-view.centerZ);view.item.rotation.set(0,item.id,0);view.halo.position.set(p.x,base+.028,p.z);view.halo.scaling.setAll(1);view.halo.visibility=.4+(motion?Math.sin(time*2+item.id)*.12:0);
      }
    }
  }
  function center(id:number){
    const mesh=meshes.get(id)?.item;if(!mesh)return null;
    mesh.computeWorldMatrix(true);return mesh.getBoundingInfo().boundingBox.centerWorld.clone();
  }
  return {update,center};
}
