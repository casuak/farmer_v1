export type ItemId="hoe"|"seeds"|"water"|"scythe"|"turnip"|"wood"|"shell";
export type Stack={id:ItemId;count:number};
export type InventorySnapshot={slots:(Stack|null)[];selected:number;gold:number;backpack:boolean};
export const MAIN_SLOTS=15,BACKPACK_SLOTS=8,BACKPACK_PRICE=120;
export const ITEMS:Record<ItemId,{name:string;description:string;max:number;sell:number;buy:number;color:string}>={
  hoe:{name:"锄头",description:"开垦身边的草地和泥土",max:1,sell:15,buy:45,color:"#9b997b"},
  seeds:{name:"萝卜种子",description:"种在空耕地里，浇水后约 24 秒成熟",max:99,sell:1,buy:5,color:"#9ab467"},
  water:{name:"浇水壶",description:"让耕地湿润，唤醒种子",max:1,sell:15,buy:45,color:"#84b5b1"},
  scythe:{name:"镰刀",description:"收获成熟的白萝卜",max:1,sell:15,buy:45,color:"#c1b780"},
  turnip:{name:"白萝卜",description:"新鲜的春日收成，可在杂货店售卖",max:20,sell:18,buy:0,color:"#e3dcb9"},
  wood:{name:"木材",description:"森林里拾到的木材，可出售",max:30,sell:6,buy:0,color:"#b48656"},
  shell:{name:"贝壳",description:"海潮送来的小礼物，可出售",max:20,sell:8,buy:0,color:"#e8b6aa"},
};
export type InventoryResult={ok:boolean;message:string};
const clone=(slots:(Stack|null)[])=>slots.map(s=>s?{...s}:null);

export class InventoryModel {
  slots:(Stack|null)[]=Array.from({length:MAIN_SLOTS},()=>null);
  selected=0;gold=200;backpack=false;
  constructor(){this.slots[0]={id:"hoe",count:1};this.slots[1]={id:"seeds",count:24};this.slots[2]={id:"water",count:1};this.slots[3]={id:"scythe",count:1};}
  snapshot():InventorySnapshot{return {slots:clone(this.slots),selected:this.selected,gold:this.gold,backpack:this.backpack};}
  count(id:ItemId){return this.slots.reduce((n,s)=>n+(s?.id===id?s.count:0),0);}
  get tool(){const id=this.slots[this.selected]?.id;return id==="hoe"||id==="seeds"||id==="water"||id==="scythe"?id:null;}
  select(index:number){if(Number.isInteger(index)&&index>=0&&index<this.slots.length)this.selected=index;}
  private packed(items:Stack[]) {
    const slots=clone(this.slots);
    for(const item of items){
      if(!ITEMS[item.id]||!Number.isInteger(item.count)||item.count<1)return null;
      let left=item.count;
      for(const s of slots)if(s?.id===item.id){const n=Math.min(ITEMS[item.id].max-s.count,left);s.count+=n;left-=n;}
      for(let i=0;i<slots.length&&left>0;i++)if(!slots[i]){const n=Math.min(ITEMS[item.id].max,left);slots[i]={id:item.id,count:n};left-=n;}
      if(left>0)return null;
    }
    return slots;
  }
  canAdd(items:Stack[]){return this.packed(items)!==null;}
  add(items:Stack[]){const next=this.packed(items);if(!next)return false;this.slots=next;return true;}
  remove(id:ItemId,count:number){
    if(!Number.isInteger(count)||count<1||this.count(id)<count)return false;
    const order=[this.selected,...this.slots.map((_,i)=>i).filter(i=>i!==this.selected)];
    let left=count;for(const i of order){if(left===0)break;const s=this.slots[i];if(s?.id!==id)continue;const n=Math.min(left,s.count);s.count-=n;left-=n;if(!s.count)this.slots[i]=null;}return true;
  }
  move(from:number,to:number):InventoryResult {
    if(![from,to].every(i=>Number.isInteger(i)&&i>=0&&i<this.slots.length)||!this.slots[from])return {ok:false,message:"请选择有效的物品格"};
    if(from===to)return {ok:true,message:"物品位置未改变"};
    const a=this.slots[from]!,b=this.slots[to];
    if(b?.id===a.id&&ITEMS[a.id].max>1){
      const n=Math.min(a.count,ITEMS[a.id].max-b.count);if(!n)return {ok:false,message:"这一格已经装满了"};
      b.count+=n;a.count-=n;if(!a.count){this.slots[from]=null;if(this.selected===from)this.selected=to;}
    }else{this.slots[to]=a;this.slots[from]=b;if(this.selected===from)this.selected=to;else if(this.selected===to)this.selected=from;}
    return {ok:true,message:"物品已整理"};
  }
  drop(index:number):Stack|null {
    if(!Number.isInteger(index)||index<0||index>=this.slots.length)return null;
    const item=this.slots[index];if(!item)return null;this.slots[index]=null;return {...item};
  }
  buy(id:ItemId):InventoryResult {
    const item=ITEMS[id];if(!item||item.buy<=0)return {ok:false,message:"店里没有出售这件物品"};
    if(this.gold<item.buy)return {ok:false,message:"金币不够了"};
    if(!this.add([{id,count:1}]))return {ok:false,message:"物品栏已满 · 请先腾出空间"};
    this.gold-=item.buy;return {ok:true,message:`购买${item.name} · −${item.buy} G`};
  }
  sell(index:number,all=false):InventoryResult {
    const s=Number.isInteger(index)?this.slots[index]:null;if(!s)return {ok:false,message:"这一格没有物品"};
    const count=all?s.count:1,value=ITEMS[s.id].sell*count,name=ITEMS[s.id].name;
    s.count-=count;if(!s.count)this.slots[index]=null;this.gold+=value;
    return {ok:true,message:`售出${name} ×${count} · +${value} G`};
  }
  buyBackpack():InventoryResult {
    if(this.backpack)return {ok:false,message:"已经装备了帆布背包"};
    if(this.gold<BACKPACK_PRICE)return {ok:false,message:"金币不够购买背包"};
    this.gold-=BACKPACK_PRICE;this.backpack=true;this.slots.push(...Array.from({length:BACKPACK_SLOTS},()=>null));
    return {ok:true,message:"帆布背包已装备 · 右侧新增 8 格储物空间"};
  }
}
