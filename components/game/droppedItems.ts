import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { groundDropPose,INVENTORY_DROP,inventoryDropLanding,type GroundDropFlight } from "./groundDropMotion";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Point } from "./farming";
import { ITEMS,inventoryGains,type Stack,type InventoryModel,type InventoryGain } from "./inventory";
import { itemSpriteMaterial } from "./itemSpriteMaterial";
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
  /** Validate the landing before touching the bag, including equipment/backpack slots. */
  dropFromInventory(bag:InventoryModel,index:number,origin:Point&{y:number},yaw:number,canWalk:(x:number,z:number,r?:number)=>boolean,clearReach:(a:Point,b:Point)=>boolean):{ok:false;message:string}|{ok:true;message:string;item:GroundItem}{
    if(index===14&&bag.backpackOccupied)return {ok:false,message:"请先清空背包，再卸下或丢弃"};
    if(!Number.isInteger(index)||!bag.slots[index])return {ok:false,message:"先选择要丢弃的物品"};
    const landing=Number.isFinite(origin.y)?inventoryDropLanding(origin,yaw,canWalk,clearReach,this.items.map(item=>item.position)):null;
    if(!landing)return {ok:false,message:"附近没有安全落点 · 请先上岸或走到空地再丢弃"};
    const stack=bag.drop(index);if(!stack)return {ok:false,message:"先选择要丢弃的物品"};
    const item:GroundItem={id:this.nextId++,stack:{...stack},position:landing,flight:{elapsed:0,duration:INVENTORY_DROP.duration,from:{x:origin.x,y:origin.y,z:origin.z}}};
    // Never use add here: even repeated identical drops retain their own full flight.
    this.items.push(item);
    return {ok:true,message:`丢下${ITEMS[stack.id].name} ×${stack.count} · 落地后按 E 可重新拾取`,item};
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
      // Prefer free space around earlier strikes as well as this impact's piles.
      const landing=safe.find(p=>this.items.every(item=>Math.hypot(p.x-item.position.x,p.z-item.position.z)>.58))
        ??safe.find(p=>created.every(item=>Math.hypot(p.x-item.position.x,p.z-item.position.z)>.58))??safe[0]??{x:player.x,z:player.z};
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
    if(item.flight)return {ok:false,message:"物品正在落地 · 稍等片刻再拾取"};
    const before=bag.snapshot().slots;
    if(!bag.add([item.stack]))return {ok:false,message:"物品栏已满 · 先腾出位置"};
    this.items=this.items.filter(i=>i.id!==id);
    return {ok:true,message:`拾取${ITEMS[item.stack.id].name} ×${item.stack.count}`,gains:inventoryGains(before,bag.slots)};
  }
}

export function createGroundItemView(scene:Scene,model:GroundItems,heightAt:(x:number,z:number)=>number=groundHeight){
  const haloMat=new StandardMaterial("pickup-halo",scene);haloMat.disableLighting=true;haloMat.emissiveColor=Color3.FromHexString("#ffefb1");haloMat.alpha=.45;
  const meshes=new Map<number,{item:Mesh;halo:Mesh}>();
  function update(time:number,motion:boolean){
    for(const [id,m] of meshes)if(!model.items.some(i=>i.id===id)){m.item.dispose();m.halo.dispose();meshes.delete(id);}
    for(const item of model.items){
      let view=meshes.get(item.id);
      if(!view){
        const mesh=MeshBuilder.CreatePlane("dropped-"+item.stack.id,{size:.64},scene);
        mesh.material=itemSpriteMaterial(scene,item.stack.id);mesh.billboardMode=Mesh.BILLBOARDMODE_ALL;mesh.isPickable=false;
        mesh.metadata={itemId:item.stack.id,groundItemId:item.id};
        const halo=MeshBuilder.CreateTorus("pickup-ring",{diameter:.60,thickness:.024,tessellation:20},scene);halo.material=haloMat;halo.isPickable=false;
        view={item:mesh,halo};meshes.set(item.id,view);
      }
      const p=item.position,base=isSea(p.x,p.z)&&!onDock(p.x,p.z)?seaHeight(p.x,p.z,motion?time:0):heightAt(p.x,p.z);
      // Measure the camera-facing quad, so its lower edge rests on the floor at any zoom/angle.
      view.item.rotation.setAll(0);view.item.computeWorldMatrix(true);
      // Use only rotation coefficients, not translated Float32 bounds: repeated
      // paused updates must not feed tiny world-position rounding back into the arc.
      const matrix=view.item.getWorldMatrix().m,restOffset=.32*(Math.abs(matrix[1])+Math.abs(matrix[5]))+.008;
      if(item.flight){
        const pose=groundDropPose(item.flight,p,base+restOffset,motion);
        view.item.position.set(pose.x,pose.y,pose.z);view.item.rotation.z=pose.roll;
        view.item.computeWorldMatrix(true);const floor=heightAt(pose.x,pose.z),bottom=view.item.getBoundingInfo().boundingBox.minimumWorld.y;
        if(bottom<floor+.008)view.item.position.y+=floor+.008-bottom;
        const height=Math.max(0,pose.y-floor),scale=Math.max(.50,1-height*.22);
        view.halo.position.set(pose.x,floor+.028,pose.z);view.halo.scaling.setAll(scale);view.halo.visibility=Math.max(.10,.45-height*.15);
      }else{
        view.item.position.set(p.x,base+restOffset,p.z);view.halo.position.set(p.x,base+.028,p.z);view.halo.scaling.setAll(1);view.halo.visibility=.4+(motion?Math.sin(time*2+item.id)*.12:0);
      }
      view.item.metadata.airborne=!!item.flight;
    }
  }
  function center(id:number){
    const mesh=meshes.get(id)?.item;if(!mesh)return null;
    mesh.computeWorldMatrix(true);return mesh.getBoundingInfo().boundingBox.centerWorld.clone();
  }
  return {update,center};
}
