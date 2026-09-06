import { MAP_WIDTH,MAP_DEPTH,type Point,type TileKind } from "./farming";

export const BOUNDS={x:MAP_WIDTH/2,z:MAP_DEPTH/2};
export const FARM_OFFSET={x:-18,z:-20};
export const FARM_SPAWN={x:-21.5,z:-23.5};
export const GARDEN={x:-36,z:-33,w:12,d:9};
export const DOCK={x:37,z:-20};
export const BOAT_START={x:DOCK.x,z:DOCK.z-2.65};
export const BRIDGES=[{x:-4,z:-20,w:8.4,d:2.96},{x:-4,z:0,w:8.4,d:2.96},{x:-4,z:18,w:8.4,d:2.96}] as const;
export const FOREST_BOUNDS={left:-46,right:-10,bottom:3,top:37};
export const FOREST_CLEARINGS=[{x:-32,z:12,r:4.6},{x:-17,z:27,r:4.5},{x:-34,z:30,r:3.8}];
export const SLIME_SPAWNS=[[-33,10],[-30,13],[-34,15],[-17,25],[-15,28],[-19,30],[-34,28],[-32,32],[-37,31],[-28,24]] as const;
export const REGIONS=[
  {id:"farm",name:"松溪农场",label:"农场区块",x:-29,z:-17,color:"#bfd08c",description:"农舍、菜圃与果园，留出整片开阔耕地。"},
  {id:"town",name:"松溪小镇",label:"小镇区块",x:15,z:23,color:"#d7cdb1",description:"石板广场、杂货店与茶屋，镇民沿街散步。"},
  {id:"forest",name:"青苔森林",label:"森林区块",x:-28,z:22,color:"#82a782",description:"密林围绕宽阔林道，史莱姆栖息在林间空地。"},
  {id:"beach",name:"贝壳沙滩",label:"海滩区块",x:16,z:-23,color:"#ebd7a8",description:"沙丘、遮阳伞与长码头，乘小船驶向大海。"},
] as const;
export type RegionId=typeof REGIONS[number]["id"];
export type Road={width:number;points:readonly (readonly [number,number])[]};
export const ROADS:readonly Road[]=[
  {width:3,points:[[-43,0],[29,0]]},
  {width:2.6,points:[[-20,-36],[-20,36]]},
  {width:2.6,points:[[-39,-20],[DOCK.x,-20]]},
  {width:2.8,points:[[-38,18],[29,18]]},
  {width:2.6,points:[[8,-35],[8,18],[14,18],[14,35]]},
  {width:2.2,points:[[27.5,5],[27.5,35]]},
  {width:2.2,points:[[3,8],[27,8]]},
  {width:1.8,points:[[8,18],[8,23.3]]},
  {width:1.8,points:[[23,8],[23,9.5]]},
  {width:1.8,points:[[27.5,25.5],[23,25.5],[23,27.5]]},
  {width:1.8,points:[[-26,-20],[-26,-15]]},
  {width:1.8,points:[[-29,-20],[-29,-24]]},
  {width:1.9,points:[[-32,4],[-32,12],[-35,23],[-34,34]]},
] as const;
export const riverCenter=(z:number)=>-4+Math.sin(z*.29)*1.55;
export const shoreX=(z:number)=>31+Math.sin(z*.12)*1.25+Math.sin(z*.31)*.35;
export const isSea=(x:number,z:number)=>Math.floor(x)+.5>=shoreX(Math.floor(z)+.5);
export const isRiver=(x:number,z:number)=>Math.abs(Math.floor(x)+.5-riverCenter(Math.floor(z)+.5))<1.7;
export const isWater=(x:number,z:number)=>isSea(x,z)||isRiver(x,z);
export const onBridge=(x:number,z:number)=>BRIDGES.some(b=>Math.abs(x-b.x)<b.w/2&&Math.abs(z-b.z)<b.d/2);
export const onDock=(x:number,z:number)=>x>27.4&&x<38.2&&Math.abs(z-DOCK.z)<1.16;
export const isBeach=(x:number,z:number)=>!isSea(x,z)&&(x>shoreX(z)-5||(x>riverCenter(z)+2&&z<-2.2));
export const isGarden=(x:number,z:number)=>x>=GARDEN.x&&x<GARDEN.x+GARDEN.w&&z>=GARDEN.z&&z<GARDEN.z+GARDEN.d;
export const inForest=(x:number,z:number)=>x>FOREST_BOUNDS.left&&x<FOREST_BOUNDS.right&&z>FOREST_BOUNDS.bottom&&z<FOREST_BOUNDS.top;
export function nearRoad(x:number,z:number,margin=0){
  return ROADS.some(road=>road.points.some((b,i)=>{
    if(!i)return false;const a=road.points[i-1],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<road.width/2+margin;
  }));
}
export const isPath=(x:number,z:number)=>nearRoad(x,z);
export const isPlaza=(x:number,z:number)=>x>=3&&x<14&&z>=5&&z<16;
export function regionId(p:Point):RegionId{
  if(isSea(p.x,p.z)||isBeach(p.x,p.z))return "beach";
  return p.x<riverCenter(p.z)?p.z>=0?"forest":"farm":p.z>=0?"town":"beach";
}
export function surfaceKind(x:number,z:number):TileKind {
  if(onDock(x,z))return "dock";if(onBridge(x,z))return "bridge";if(isSea(x,z))return "sea";if(isRiver(x,z))return "water";
  if(isPath(x,z)||isPlaza(x,z))return "path";if(isBeach(x,z))return "sand";if(isGarden(x,z))return "dirt";
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
  if(onBridge(p.x,p.z))return "松溪木桥";if(isGarden(p.x,p.z))return "农场菜圃";
  return REGIONS.find(r=>r.id===regionId(p))!.name;
}

export const BUILDINGS=[
  {id:"home",name:"温暖的家",x:-26,z:-13,w:6,d:4.5,shop:false,roof:"#c77e57",wall:"#efdcb2"},
  {id:"shop",name:"松果杂货店",x:8,z:26,w:7.4,d:5.4,shop:true,roof:"#668d84",wall:"#f2dfb4"},
  {id:"cafe",name:"花间茶屋",x:23,z:30,w:6,d:5,shop:false,roof:"#b17d72",wall:"#ebdbbf"},
  {id:"cottage",name:"海风小屋",x:23,z:12,w:6,d:5,shop:false,roof:"#759eac",wall:"#f3e6cc"},
] as const;
