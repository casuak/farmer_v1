import { MAP_WIDTH,MAP_DEPTH,type Point,type TileKind } from "./farming";

export const BOUNDS={x:MAP_WIDTH/2,z:MAP_DEPTH/2};
export const DOCK={x:37,z:0};
export const BOAT_START={x:37,z:-2.65};
export const riverCenter=(z:number)=>9+Math.sin(z*.29)*1.55;
export const shoreX=(z:number)=>31+Math.sin(z*.12)*1.25+Math.sin(z*.31)*.35;
export const isSea=(x:number,z:number)=>Math.floor(x)+.5>=shoreX(Math.floor(z)+.5);
export const isRiver=(x:number,z:number)=>Math.abs(Math.floor(x)+.5-riverCenter(Math.floor(z)+.5))<1.7;
export const isWater=(x:number,z:number)=>isSea(x,z)||isRiver(x,z);
export const onBridge=(x:number,z:number)=>x>6&&x<12&&(Math.abs(z)<1.15||Math.abs(z-20)<1.15);
export const onDock=(x:number,z:number)=>x>27.4&&x<38.2&&Math.abs(z)<1.16;
export const isBeach=(x:number,z:number)=>x>shoreX(z)-6&&!isSea(x,z);
export const isGarden=(x:number,z:number)=>x>=-10&&x<-4&&z>=-7&&z<-2;
export const isPath=(x:number,z:number)=>Math.abs(z)<1.12||Math.abs(x+1.5)<1.05||(Math.abs(x+8)<.95&&z>0&&z<5.1)||(z>17&&z<33&&x>-13&&x<6&&(Math.abs(z-20)<1.15||Math.abs(z-28)<.9||Math.abs(x-3)<.9))||(Math.abs(z-20)<1.15&&x>-14&&x<28)||(x<-18&&Math.abs(x+28+Math.sin(z*.12)*1.3)<1.15);
export function surfaceKind(x:number,z:number):TileKind {
  if(onDock(x,z))return "dock";if(onBridge(x,z))return "bridge";if(isSea(x,z))return "sea";if(isRiver(x,z))return "water";
  if(isBeach(x,z))return "sand";if(isPath(x,z))return "path";if(isGarden(x,z))return "dirt";
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>isRiver(x+dx,z+dz)))return "bank";
  return "grass";
}
export const groundHeight=(x:number,z:number)=>(onDock(x,z)||onBridge(x,z)) ? .18 : 0;
export function canSail(x:number,z:number) {
  if(x>BOUNDS.x-1.5||Math.abs(z)>BOUNDS.z-1.5)return false;
  for(const [dx,dz] of [[-.92,-.92],[.92,-.92],[-.92,.92],[.92,.92]])if(!isSea(x+dx,z+dz)||onDock(x+dx,z+dz))return false;
  return true;
}
export const seaHeight=(x:number,z:number,time:number)=>-.23+Math.sin(x*.72+z*.25-time*1.1)*.105+Math.sin(z*1.05-x*.2-time*.85)*.05;
export function regionName(p:Point) {
  if(onDock(p.x,p.z))return "潮汐码头";if(isSea(p.x,p.z))return "蔚蓝海域";if(isBeach(p.x,p.z))return "贝壳沙滩";
  if(p.z>16&&p.x>-16&&p.x<26)return "松溪小镇";if(p.x<-18)return "青苔森林";
  if(onBridge(p.x,p.z))return "松溪木桥";if(isGarden(p.x,p.z))return "农场菜圃";return "松溪农场";
}

export const BUILDINGS=[
  {id:"home",name:"温暖的家",x:-8,z:7,w:6,d:4.5,shop:false,roof:"#c77e57",wall:"#efdcb2"},
  {id:"shop",name:"松果杂货店",x:-6,z:25,w:7.4,d:5.4,shop:true,roof:"#668d84",wall:"#f2dfb4"},
  {id:"cafe",name:"花间茶屋",x:4,z:31,w:6,d:5,shop:false,roof:"#b17d72",wall:"#ebdbbf"},
  {id:"cottage",name:"海风小屋",x:21,z:25,w:6,d:5,shop:false,roof:"#759eac",wall:"#f3e6cc"},
] as const;
