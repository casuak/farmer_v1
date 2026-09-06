import { InventoryModel } from "./inventory";
/** One metre, equal-sized square tiles shared by rendering, inspection and tools. */
export const TILE_SIZE=1;
export const MAP_WIDTH=96;
export const MAP_DEPTH=80;
export const GROWTH_SECONDS=24;
export const TOOLS=["hoe","seeds","water","scythe"] as const;
export type ToolId=typeof TOOLS[number];
export type TileKind="grass"|"dirt"|"path"|"bank"|"water"|"bridge"|"building"|"tree"|"rock"|"fence"|"decoration"|"sand"|"sea"|"dock"|"floor";
export type Point={x:number;z:number};
export type TileSeed=Point&{kind:TileKind};
export type Crop={age:number;stage:number};
export type FarmTile=TileSeed&{tilled:boolean;watered:boolean;crop:Crop|null;revision:number};
export type Inventory={seeds:number;turnips:number};
export type ActionResult={ok:boolean;message:string;tile:FarmTile|null;tool:ToolId};
export type TileInfo={x:number;z:number;kind:TileKind;label:string;tilled:boolean;watered:boolean;stage:number|null;stageName:string|null;progress:number;remaining:number;reachable:boolean;actionable:boolean;hint:string};
export const KIND_LABELS:Record<TileKind,string>={grass:"草地",dirt:"泥土",path:"小径",bank:"河岸",water:"河水",bridge:"木桥",building:"建筑",tree:"树木",rock:"岩石",fence:"围栏",decoration:"农场设施",sand:"沙滩",sea:"大海",dock:"码头",floor:"室内地板"};
export const TOOL_LABELS:Record<ToolId,string>={hoe:"锄头",seeds:"萝卜种子",water:"浇水壶",scythe:"镰刀"};
export const STAGES=["播种","发芽","幼苗","茂盛","成熟"];
export const tileKey=(x:number,z:number)=>`${x},${z}`;
export const worldToTile=(p:Point):Point=>({x:Math.floor(p.x/TILE_SIZE),z:Math.floor(p.z/TILE_SIZE)});
export const tileCenter=(p:Point):Point=>({x:(p.x+.5)*TILE_SIZE,z:(p.z+.5)*TILE_SIZE});
export const inReach=(player:Point,target:Point)=>{
  const p=worldToTile(player);
  return Math.abs(target.x-p.x)<=1&&Math.abs(target.z-p.z)<=1;
};

export class FarmModel {
  readonly tiles=new Map<string,FarmTile>();
  get inventory():Inventory{return {seeds:this.bag.count("seeds"),turnips:this.bag.count("turnip")};}
  private growing=new Set<string>();
  constructor(tiles:TileSeed[],private clearReach:(player:Point,target:Point)=>boolean=()=>true,readonly bag=new InventoryModel()) {
    for(const t of tiles)this.tiles.set(tileKey(t.x,t.z),{...t,tilled:false,watered:false,crop:null,revision:0});
  }
  get(x:number,z:number){return this.tiles.get(tileKey(x,z))??null;}
  private rule(tool:ToolId,t:FarmTile,player:Point,override?:TileKind):string|null {
    if(this.bag.count(tool)===0)return "没有这件农具或种子 · 可以到杂货店补充";
    if(!inReach(player,t))return "距离太远 · 请走到地块旁一格内";
    const kind=override??t.kind;
    if(kind!=="grass"&&kind!=="dirt")return `${KIND_LABELS[kind]}无法耕种`;
    if(!this.clearReach(player,tileCenter(t)))return "有障碍物阻挡 · 请走到地块这一侧";
    if(tool==="hoe")return t.crop?"这里已经种下萝卜":t.tilled?"已开垦 · 可以播种":null;
    if(tool==="seeds")return !t.tilled?"先用锄头开垦":t.crop?"这里已经有作物":this.inventory.seeds<=0?"种子用完了 · 收获可获得新种子":null;
    if(tool==="water")return !t.tilled?"先开垦一块耕地":t.watered?"土壤已经湿润":t.crop?.stage===4?"萝卜已成熟 · 使用镰刀收获":null;
    return !t.crop?"这里还没有作物":t.crop.stage<4?"还未成熟 · 再等一会儿":!this.bag.canAdd([{id:"turnip",count:1},{id:"seeds",count:2}])?"物品栏已满 · 先腾出位置再收获":null;
  }
  inspect(coord:Point,player:Point,tool:ToolId,override?:TileKind):TileInfo|null {
    const t=this.get(coord.x,coord.z);if(!t)return null;
    const blocked=this.rule(tool,t,player,override),kind=override??t.kind;
    const hideCrop=kind!==t.kind;
    const crop=hideCrop?null:t.crop;
    const label=kind!==t.kind?KIND_LABELS[kind]:t.crop?"萝卜耕地":t.tilled?(t.watered?"湿润耕地":"已开垦耕地"):KIND_LABELS[kind];
    const verbs={hoe:"左键开垦",seeds:"左键播种",water:"左键浇水",scythe:"左键收获"};
    return {x:t.x,z:t.z,kind,label,tilled:!hideCrop&&t.tilled,watered:!hideCrop&&t.watered,stage:crop?.stage??null,stageName:crop?STAGES[crop.stage]:null,progress:crop?Math.min(100,crop.age/GROWTH_SECONDS*100):0,remaining:crop?Math.max(0,Math.ceil(GROWTH_SECONDS-crop.age)):0,reachable:inReach(player,t),actionable:blocked===null,hint:blocked??verbs[tool]};
  }
  use(tool:ToolId,coord:Point,player:Point,override?:TileKind):ActionResult {
    const t=this.get(coord.x,coord.z);
    if(!t)return {ok:false,message:"这里是农场边界",tile:null,tool};
    const reason=this.rule(tool,t,player,override);
    if(reason)return {ok:false,message:reason,tile:t,tool};
    let message="";
    if(tool==="hoe"){t.tilled=true;message="开垦完成 · 选择种子播种";}
    if(tool==="seeds"){
      t.crop={age:0,stage:0};this.bag.remove("seeds",1);this.growing.add(tileKey(t.x,t.z));
      message=t.watered?"播种成功 · 萝卜正在生长":"种子已种下 · 用浇水壶浇水";
    }
    if(tool==="water"){t.watered=true;message=t.crop?"土壤湿润了 · 约 24 秒后成熟":"耕地已浇水 · 可以播种";}
    if(tool==="scythe"){
      this.bag.add([{id:"turnip",count:1},{id:"seeds",count:2}]);t.crop=null;t.watered=false;this.growing.delete(tileKey(t.x,t.z));
      message="收获白萝卜 +1 · 种子 +2";
    }
    t.revision++;return {ok:true,message,tile:t,tool};
  }
  update(dt:number):FarmTile[] {
    const changed:FarmTile[]=[];
    if(!Number.isFinite(dt)||dt<=0)return changed;
    for(const key of this.growing) {
      const t=this.tiles.get(key)!;
      if(!t.crop||!t.watered)continue;
      t.crop.age=Math.min(GROWTH_SECONDS,t.crop.age+dt);
      const stage=Math.min(4,Math.floor(t.crop.age/6));
      if(stage!==t.crop.stage){t.crop.stage=stage;t.revision++;changed.push(t);}
      if(stage===4)this.growing.delete(key);
    }
    return changed;
  }
  /** A small, harvestable teaching plot replaces the old decorative crop meshes. */
  seedExample(x:number,z:number,age:number,watered=true) {
    const t=this.get(x,z);if(!t||t.kind!=="dirt")return;
    t.tilled=true;t.watered=watered;t.crop={age,stage:Math.min(4,Math.floor(age/6))};t.revision++;
    if(age<GROWTH_SECONDS)this.growing.add(tileKey(x,z));
  }
}
