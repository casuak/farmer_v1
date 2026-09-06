export type FishId="carp"|"perch"|"sardine"|"redSnapper";
export type ItemId="hoe"|"seeds"|"water"|"scythe"|"turnip"|"wood"|"shell"|"hat"|"shirt"|"backpack"|"pistol"|"sword"|"fishingRod"|FishId;
export type HandItem="hoe"|"seeds"|"water"|"scythe"|"pistol"|"sword"|"fishingRod";
export type Stack={id:ItemId;count:number};
export type InventorySnapshot={slots:(Stack|null)[];selected:number;gold:number;backpack:boolean};
export const MAIN_SLOTS=12,BASE_SLOTS=15,BACKPACK_SLOTS=8,BACKPACK_PRICE=120;
export const EQUIPMENT=[{index:12,label:"头",item:"hat"},{index:13,label:"身",item:"shirt"},{index:14,label:"背",item:"backpack"}] as const;
export const isEquipmentSlot=(index:number)=>index>=MAIN_SLOTS&&index<BASE_SLOTS;
const accepts=(index:number,id:ItemId)=>!isEquipmentSlot(index)||EQUIPMENT[index-MAIN_SLOTS].item===id;
export const ITEMS:Record<ItemId,{name:string;description:string;max:number;sell:number;buy:number;color:string}>={
  hoe:{name:"锄头",description:"开垦身边的草地和泥土",max:1,sell:15,buy:45,color:"#9b997b"},
  seeds:{name:"萝卜种子",description:"种在空耕地里，浇水后约 24 秒成熟",max:99,sell:1,buy:5,color:"#9ab467"},
  water:{name:"浇水壶",description:"让耕地湿润，唤醒种子",max:1,sell:15,buy:45,color:"#84b5b1"},
  scythe:{name:"镰刀",description:"朝鼠标方向挥扫，收获面前三格成熟作物",max:1,sell:15,buy:45,color:"#adc4b9"},
  turnip:{name:"白萝卜",description:"新鲜的春日收成，可在杂货店售卖",max:20,sell:18,buy:0,color:"#e3dcb9"},
  wood:{name:"木材",description:"森林里拾到的木材，可出售",max:30,sell:6,buy:0,color:"#b48656"},
  shell:{name:"贝壳",description:"海潮送来的小礼物，可出售",max:20,sell:8,buy:0,color:"#e8b6aa"},
  hat:{name:"草帽",description:"头部装备 · 拖到“头”栏穿戴",max:1,sell:8,buy:20,color:"#c7a45f"},
  shirt:{name:"农夫衬衫",description:"身体装备 · 拖到“身”栏穿戴",max:1,sell:8,buy:20,color:"#88aab0"},
  backpack:{name:"帆布背包",description:"背部装备 · 增加 8 格，清空后可卸下",max:1,sell:60,buy:120,color:"#91a46b"},
  pistol:{name:"手枪",description:"朝鼠标方向射击 · 无需补充弹药",max:1,sell:40,buy:90,color:"#8b9ca7"},
  sword:{name:"长剑",description:"朝鼠标方向挥斩 · 攻击身前的史莱姆",max:1,sell:30,buy:75,color:"#c3d0cf"},
  fishingRod:{name:"竹钓竿",description:"到河边甩竿垂钓 · 钓上鲜鱼后可出售",max:1,sell:22,buy:60,color:"#a98a54"},
  carp:{name:"鲤鱼",description:"一身金鳞的池塘常客 · 可出售",max:20,sell:22,buy:0,color:"#cf9346"},
  perch:{name:"河鲈",description:"带深色条纹的河鱼 · 可出售",max:20,sell:18,buy:0,color:"#8faa4f"},
  sardine:{name:"沙丁鱼",description:"银亮亮的洄游小鱼 · 可出售",max:20,sell:12,buy:0,color:"#a8c8da"},
  redSnapper:{name:"红鲷",description:"通体红艳的深海风味 · 可出售",max:20,sell:30,buy:0,color:"#e06a4a"},
};
export type InventoryResult={ok:boolean;message:string};
const clone=(slots:(Stack|null)[])=>slots.map(s=>s?{...s}:null);

export class InventoryModel {
  slots:(Stack|null)[]=Array.from({length:BASE_SLOTS},()=>null);
  selected=0;gold=200;
  constructor(){this.slots[0]={id:"hoe",count:1};this.slots[1]={id:"seeds",count:24};this.slots[2]={id:"water",count:1};this.slots[3]={id:"scythe",count:1};this.slots[4]={id:"pistol",count:1};this.slots[5]={id:"sword",count:1};this.slots[6]={id:"fishingRod",count:1};this.slots[12]={id:"hat",count:1};this.slots[13]={id:"shirt",count:1};}
  get backpack(){return this.slots[14]?.id==="backpack";}
  get hand():HandItem|null{const id=this.slots[this.selected]?.id;return id&&["hoe","seeds","water","scythe","pistol","sword","fishingRod"].includes(id)?id as HandItem:null;}
  get backpackOccupied(){return this.slots.slice(BASE_SLOTS).some(Boolean);}
  private resize(){const length=BASE_SLOTS+(this.backpack?BACKPACK_SLOTS:0);while(this.slots.length<length)this.slots.push(null);this.slots.length=length;if(this.selected>=length)this.selected=0;}
  snapshot():InventorySnapshot{return {slots:clone(this.slots),selected:this.selected,gold:this.gold,backpack:this.backpack};}
  count(id:ItemId){return this.slots.reduce((n,s)=>n+(s?.id===id?s.count:0),0);}
  get tool(){const id=this.slots[this.selected]?.id;return id==="hoe"||id==="seeds"||id==="water"||id==="scythe"?id:null;}
  select(index:number){if(Number.isInteger(index)&&index>=0&&index<this.slots.length)this.selected=index;}
  private packed(items:Stack[]) {
    const slots=clone(this.slots);
    for(const item of items){
      if(!ITEMS[item.id]||!Number.isInteger(item.count)||item.count<1)return null;
      let left=item.count;
      for(let i=0;i<slots.length;i++){const s=slots[i];if(!isEquipmentSlot(i)&&s?.id===item.id){const n=Math.min(ITEMS[item.id].max-s.count,left);s.count+=n;left-=n;}}
      for(let i=0;i<slots.length&&left>0;i++)if(!isEquipmentSlot(i)&&!slots[i]){const n=Math.min(ITEMS[item.id].max,left);slots[i]={id:item.id,count:n};left-=n;}
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
    if(!accepts(to,a.id)||(b&&!accepts(from,b.id)))return {ok:false,message:"装备类型不匹配 · 头戴草帽、身穿衬衫、背部放背包"};
    if((from===14||to===14)&&this.backpack&&this.backpackOccupied)return {ok:false,message:"请先清空背包，再卸下或更换"};
    if(from===14&&to>=BASE_SLOTS)return {ok:false,message:"背包不能放进自己的储物空间"};
    if(b?.id===a.id&&ITEMS[a.id].max>1){
      const n=Math.min(a.count,ITEMS[a.id].max-b.count);if(!n)return {ok:false,message:"这一格已经装满了"};
      b.count+=n;a.count-=n;if(!a.count){this.slots[from]=null;if(this.selected===from)this.selected=to;}
    }else{this.slots[to]=a;this.slots[from]=b;if(this.selected===from)this.selected=to;else if(this.selected===to)this.selected=from;}
    this.resize();return {ok:true,message:isEquipmentSlot(to)?"装备已穿戴":"物品已整理"};
  }
  drop(index:number):Stack|null {
    if(!Number.isInteger(index)||index<0||index>=this.slots.length)return null;
    const item=this.slots[index];if(!item||index===14&&this.backpackOccupied)return null;this.slots[index]=null;this.resize();return {...item};
  }
  buy(id:ItemId):InventoryResult {
    const item=ITEMS[id];if(!item||item.buy<=0)return {ok:false,message:"店里没有出售这件物品"};
    if(this.gold<item.buy)return {ok:false,message:"金币不够了"};
    if(!this.add([{id,count:1}]))return {ok:false,message:"物品栏已满 · 请先腾出空间"};
    this.gold-=item.buy;return {ok:true,message:`购买${item.name} · −${item.buy} G`};
  }
  sell(index:number,all=false):InventoryResult {
    const s=Number.isInteger(index)?this.slots[index]:null;if(!s)return {ok:false,message:"这一格没有物品"};
    if(index===14&&this.backpackOccupied)return {ok:false,message:"请先清空背包，再出售"};
    const count=all?s.count:1,value=ITEMS[s.id].sell*count,name=ITEMS[s.id].name;
    s.count-=count;if(!s.count)this.slots[index]=null;this.gold+=value;this.resize();
    return {ok:true,message:`售出${name} ×${count} · +${value} G`};
  }
  buyBackpack():InventoryResult {
    if(this.backpack)return {ok:false,message:"已经装备了帆布背包"};
    if(this.gold<BACKPACK_PRICE)return {ok:false,message:"金币不够购买背包"};
    this.gold-=BACKPACK_PRICE;this.slots[14]={id:"backpack",count:1};this.resize();
    return {ok:true,message:"帆布背包已装备 · 右侧新增 8 格储物空间"};
  }
}
