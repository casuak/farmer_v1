import type { Point } from "./farming";
import { ITEMS,type HandItem,type InventoryResult,type Stack } from "./inventory";
import { MINING_IMPACT_TIME,MINING_SWING_DURATION } from "./miningMotion";

export type OreKind="copper"|"iron"|"crystal";
export const ORES:Record<OreKind,{name:string;color:string;light:string;health:number;loot:readonly Stack[]}>= {
  copper:{name:"铜矿脉",color:"#d99458",light:"#ffd398",health:3,loot:[{id:"copperOre",count:3},{id:"stone",count:2}]},
  iron:{name:"铁矿脉",color:"#a7c6d6",light:"#e1f3ff",health:4,loot:[{id:"ironOre",count:3},{id:"stone",count:3}]},
  crystal:{name:"晶石矿簇",color:"#b39be5",light:"#efe1ff",health:5,loot:[{id:"crystal",count:2},{id:"stone",count:2}]},
};
export type OreSeed=Point&{id:string;kind:OreKind;size:number};
// Fixed, discoverable deposits beside forest trails, never on a road or combat spawn.
// World generation reserves these pockets BEFORE placing trees or ground clutter.
export const FOREST_ORES:readonly OreSeed[]=[
  {id:"copper-trail",kind:"copper",x:-23.3,z:8,size:1},
  {id:"copper-gate",kind:"copper",x:-29.2,z:5.5,size:.9},
  {id:"iron-east",kind:"iron",x:-16.7,z:13,size:1.05},
  {id:"copper-glade",kind:"copper",x:-28,z:10,size:.95},
  {id:"iron-west",kind:"iron",x:-37.8,z:13,size:1.1},
  {id:"crystal-hollow",kind:"crystal",x:-40,z:21.5,size:1},
  {id:"copper-crossing",kind:"copper",x:-26.8,z:21.3,size:1},
  {id:"iron-grove",kind:"iron",x:-29.5,z:27.8,size:1},
  {id:"crystal-deep",kind:"crystal",x:-37.8,z:34,size:1.05},
  {id:"iron-north",kind:"iron",x:-23.5,z:33,size:1.1},
  {id:"crystal-east",kind:"crystal",x:-13.2,z:23,size:.95},
  {id:"copper-north",kind:"copper",x:-13.2,z:34.5,size:.9},
];
export const MINING_REACH=2.15,ORE_RESPAWN_SECONDS=120;
export const oreRadius=(node:OreSeed)=>node.size*.66;
export const reservedForOre=(x:number,z:number,margin=0)=>FOREST_ORES.some(n=>Math.hypot(x-n.x,z-n.z)<oreRadius(n)+margin);
export type OreNode=OreSeed&{health:number;respawn:number};
export type OreInfo={id:string;kind:OreKind;name:string;color:string;health:number;maxHealth:number;respawn:number;reachable:boolean;equipped:boolean;hint:string;loot:string};
export type MiningSnapshot={active:boolean;progress:number;target:OreInfo|null;holding?:boolean};
export type MiningImpact=InventoryResult&{node:OreNode;broken:boolean;loot:Stack[];point:Point};
export type MiningSwing={nodeId:string;elapsed:number;impacted:boolean};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);

/** Pure mining state: a click starts a swing; ore damage happens ONLY at contact. */
export class MiningModel {
  readonly nodes:OreNode[];
  swing:MiningSwing|null=null;
  constructor(private clearReach:(from:Point,to:Point)=>boolean=()=>true,seeds:readonly OreSeed[]=FOREST_ORES){
    this.nodes=seeds.map(n=>({...n,health:ORES[n.kind].health,respawn:0}));
  }
  get active(){return this.swing!==null;}
  get(id:string|null|undefined){return this.nodes.find(n=>n.id===id)??null;}
  blocks(x:number,z:number,r=.27){return this.nodes.some(n=>n.health>0&&Math.abs(x-n.x)<oreRadius(n)+r&&Math.abs(z-n.z)<oreRadius(n)+r);}
  /** Stop the reach ray just OUTSIDE this deposit's square collision footprint. */
  contact(node:OreNode,player:Point):Point{
    const dx=player.x-node.x,dz=player.z-node.z,extent=Math.max(Math.abs(dx),Math.abs(dz));
    const f=Math.min(1,(oreRadius(node)+.10)/Math.max(.001,extent));
    return {x:node.x+dx*f,z:node.z+dz*f};
  }
  reason(node:OreNode,player:Point,hand:HandItem|null):string|null{
    if(node.health<=0)return `矿脉已采空 · ${Math.max(1,Math.ceil(node.respawn))} 秒后恢复，先去其他矿点`;
    if(hand!=="pickaxe")return "选择矿镐（初始第 8 格）· 或靠近后按 E 开采";
    if(distance(player,node)>MINING_REACH)return "距离太远 · 走近矿石再敲击";
    if(!this.clearReach(player,this.contact(node,player)))return "前方有树木或障碍 · 绕到矿石旁边";
    return null;
  }
  nearest(player:Point,range=MINING_REACH,includeEmpty=false){
    return this.nodes.filter(n=>(includeEmpty||n.health>0)&&distance(player,n)<=range&&this.clearReach(player,this.contact(n,player))).sort((a,b)=>distance(player,a)-distance(player,b))[0]??null;
  }
  target(player:Point,aim:Point,explicitId?:string|null){
    if(explicitId)return this.get(explicitId);
    const direct=this.nodes.filter(n=>distance(n,aim)<oreRadius(n)+.35).sort((a,b)=>distance(a,aim)-distance(b,aim))[0];
    if(direct)return direct;
    const dx=aim.x-player.x,dz=aim.z-player.z,length=Math.hypot(dx,dz);
    if(length<.01)return this.nearest(player);
    // Keyboard / bare ground aim selects a nearby deposit in the forward cone only.
    return this.nodes.filter(n=>n.health>0&&distance(player,n)<=MINING_REACH&&((n.x-player.x)*dx+(n.z-player.z)*dz)/(distance(player,n)*length)>.60&&this.clearReach(player,this.contact(n,player))).sort((a,b)=>distance(player,a)-distance(player,b))[0]??null;
  }
  inspect(node:OreNode,player:Point,hand:HandItem|null):OreInfo{
    const def=ORES[node.kind];return {id:node.id,kind:node.kind,name:def.name,color:def.color,health:node.health,maxHealth:def.health,respawn:Math.ceil(node.respawn),reachable:distance(player,node)<=MINING_REACH&&this.clearReach(player,this.contact(node,player)),equipped:hand==="pickaxe",hint:this.reason(node,player,hand)??"按住左键 / F / E 连续开采 · 矿物弹出落地后拾取",loot:def.loot.map(s=>`${ITEMS[s.id].name} ×${s.count}`).join(" · ")};
  }
  snapshot(player:Point,hand:HandItem|null,targetId?:string|null):MiningSnapshot{
    const node=this.get(this.swing?.nodeId??targetId)??(hand==="pickaxe"?this.nearest(player,3,true):null);
    return {active:this.active,progress:this.swing?Math.min(1,this.swing.elapsed/MINING_SWING_DURATION):0,target:node?this.inspect(node,player,hand):null};
  }
  begin(id:string,player:Point,hand:HandItem|null):InventoryResult{
    if(this.active)return {ok:false,message:"等这一镐落下再继续"};
    const node=this.get(id);if(!node)return {ok:false,message:"走近森林里带彩色矿脉的岩石，再挥动矿镐"};
    const reason=this.reason(node,player,hand);if(reason)return {ok:false,message:reason};
    this.swing={nodeId:id,elapsed:0,impacted:false};return {ok:true,message:`开采${ORES[node.kind].name}`};
  }
  cancel(){this.swing=null;}
  update(dt:number,player:Point,hand:HandItem|null):MiningImpact|null{
    if(!Number.isFinite(dt)||dt<=0)return null;
    for(const node of this.nodes)if(node.health===0){
      node.respawn=Math.max(0,node.respawn-dt);
      // Never regenerate a collider underneath (or immediately against) the player.
      if(node.respawn===0&&distance(player,node)>MINING_REACH+.7)node.health=ORES[node.kind].health;
    }
    const swing=this.swing;if(!swing)return null;
    if(hand!=="pickaxe"){this.cancel();return null;}
    swing.elapsed+=dt;let impact:MiningImpact|null=null;
    if(!swing.impacted&&swing.elapsed>=MINING_IMPACT_TIME){
      swing.impacted=true;const node=this.get(swing.nodeId)!;const reason=this.reason(node,player,hand);
      if(reason)impact={ok:false,message:reason,node,broken:false,loot:[],point:this.contact(node,player)};
      else{
        node.health--;const broken=node.health===0;if(broken)node.respawn=ORE_RESPAWN_SECONDS;
        impact={ok:true,message:broken?`${ORES[node.kind].name}已敲碎`:`${ORES[node.kind].name} · 还需 ${node.health} 镐`,node,broken,loot:broken?ORES[node.kind].loot.map(s=>({...s})):[],point:this.contact(node,player)};
      }
    }
    if(swing.elapsed>=MINING_SWING_DURATION)this.swing=null;
    return impact;
  }
}
