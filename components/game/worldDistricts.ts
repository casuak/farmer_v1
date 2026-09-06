import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Voxels } from "./voxel";
import type { Obstacle,Occluder } from "./world";
import type { Point,TileKind } from "./farming";
import { buildRooms } from "./buildings";
import { createStreetLights } from "./streetLights";
import { BUILDINGS,BRIDGES,DOCK,GARDEN,FARM_OFFSET,FOREST_CLEARINGS,nearRoad,shoreX } from "./geography";

type Builders={scene:Scene;shadow:ShadowGenerator;mat:StandardMaterial;roofMat:StandardMaterial;obstacles:Obstacle[];occluders:Occluder[];props:Voxels;details:Voxels;random:()=>number;pick:<T>(a:T[])=>T;tree:(x:number,z:number,s?:number,type?:"oak"|"pine"|"pink")=>void;rock:(x:number,z:number,s?:number)=>void;flower:(x:number,z:number,c:string,h?:number)=>void};

export function buildDistricts({scene,shadow,mat,roofMat,obstacles,occluders,props,details,random,pick,tree,rock,flower}:Builders){
  const addObstacle=(x:number,z:number,w:number,d:number,kind:TileKind="decoration")=>obstacles.push({x,z,w,d,kind});
  const rooms=buildRooms(scene,shadow,mat,roofMat,obstacles,occluders),roomAt=(p:Point)=>rooms.find(r=>r.inside(p))??null;
  const {x:hx,z:hz}=BUILDINGS[0];
  function fence(x:number,z:number,length:number,axis:"x"|"z"){
    const n=Math.max(1,Math.round(length/1.4));
    for(let i=0;i<=n;i++){const a=length*i/n,px=x+(axis==="x"?a:0),pz=z+(axis==="z"?a:0);props.box(px,.47,pz,.19,.94,.19,"#c9ac76");props.box(px,.97,pz,.23,.11,.23,"#ead1a0");}
    for(const y of [.37,.75])props.box(x+(axis==="x"?length/2:0),y,z+(axis==="z"?length/2:0),axis==="x"?length:.10,.12,axis==="z"?length:.10,"#dfc18a");
    addObstacle(x+(axis==="x"?length/2:0),z+(axis==="z"?length/2:0),axis==="x"?length:.16,axis==="z"?length:.16,"fence");
  }
  function bench(x:number,z:number){
    for(const side of [-1,1])props.box(x+side*.67,.28,z,.14,.56,.62,"#8f7955");props.box(x,.61,z,1.8,.13,.73,"#c5a775");props.box(x,1.02,z+.3,1.8,.50,.12,"#d5b782");addObstacle(x,z,1.8,.74);
  }
  function planter(x:number,z:number,c="#e8b8b5"){
    props.box(x,.25,z,.68,.50,.68,"#bb9870");props.box(x,.63,z,.80,.38,.75,"#8dac70");for(let j=0;j<3;j++)props.box(x-.22+j*.22,.88,z,.16,.16,.18,j%2?"#f2d58b":c);addObstacle(x,z,.68,.68);
  }
  function marker(x:number,z:number,kind:"farm"|"forest"|"town"|"beach"){
    const color={farm:"#98b86a",forest:"#62927b",town:"#c58e70",beach:"#6faeb6"}[kind];
    props.box(x,.73,z,.16,1.46,.16,"#92764f");props.box(x,1.47,z,1.28,.76,.18,"#d4b883");props.box(x,1.48,z-.104,1.06,.56,.035,color);
    if(kind==="forest")for(let j=0;j<3;j++)props.box(x,1.32+j*.12,z-.13,.62-j*.17,.15,.045,"#e9efd0");
    else if(kind==="town"){props.box(x,1.4,z-.13,.45,.28,.045,"#fff0d1");for(let j=0;j<3;j++)props.box(x,1.55+j*.07,z-.13,.66-j*.19,.08,.045,"#fff0d1");}
    else if(kind==="farm"){props.box(x,1.43,z-.13,.06,.37,.045,"#fff0d1");props.box(x-.16,1.54,z-.13,.27,.13,.045,"#fff0d1");props.box(x+.14,1.62,z-.13,.24,.13,.045,"#fff0d1");}
    else for(let j=0;j<3;j++)props.box(x-.3+j*.3,1.44+(j%2)*.09,z-.13,.31,.09,.045,"#fff0d1");
    addObstacle(x,z,.28,.28);
  }

  // Farm: a large kitchen garden, orchard, open meadow and the familiar home.
  const fb=(x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>props.box(x+FARM_OFFSET.x,y,z+FARM_OFFSET.z,w,h,d,c);
  const fo=(x:number,z:number,w:number,d:number)=>addObstacle(x+FARM_OFFSET.x,z+FARM_OFFSET.z,w,d);
  for(const [x,z,s] of [[-16,12,1],[-12.8,13.1,.92],[-3,13.2,.92],[1,12.8,.88],[-13.1,1.8,1.02],[-16,-10,.85],[-4.7,11.8,.74]])tree(x+FARM_OFFSET.x,z+FARM_OFFSET.z,s,z>10?"pink":"oak");
  for(const x of [-43,-38])for(const z of [-13,-7])tree(x,z,.72,"pink");
  fb(-8,.04,4.14,2.5,.08,1.14,"#c9b894");fb(-8,.02,3.46,1.65,.04,.47,"#d6c49f");for(let j=0;j<4;j++)fb(-8+(j%2)*.13,.045,1.1+j*.62,.79,.09,.45,"#b9bda5");
  fence(GARDEN.x-.6,GARDEN.z-.6,GARDEN.w+1.2,"x");fence(GARDEN.x-.6,GARDEN.z-.6,GARDEN.d+1.2,"z");fence(GARDEN.x+GARDEN.w+.6,GARDEN.z-.6,GARDEN.d+1.2,"z");
  fence(GARDEN.x-.6,GARDEN.z+GARDEN.d+.6,6.1,"x");fence(-27.5,GARDEN.z+GARDEN.d+.6,4.1,"x");
  fb(-4.4,.29,-2,.5,.58,.44,"#718e88");fb(-4.4,.62,-2,.33,.09,.30,"#91a79a");fb(-4.08,.44,-2,.33,.1,.12,"#a1b7a6");fb(-10,.3,-.7,.7,.6,.65,"#c4a373");fb(-10,.62,-.7,.55,.08,.50,"#dfc78f");
  const wx=-16.1,wz=-15.1;
  for(const [dx,dz,w,d] of [[0,-.57,1.5,.3],[0,.57,1.5,.3],[-.6,0,.3,.9],[.6,0,.3,.9]])props.box(wx+dx,.47,wz+dz,w,.94,d,pick(["#b8b9a3","#adb19c","#c3c4af"]));
  props.box(wx,.43,wz,.9,.04,.9,"#5b8179");for(const x of [-.78,.78])props.box(wx+x,1.18,wz,.14,2.35,.14,"#95734c");props.box(wx,1.56,wz,1.73,.14,.14,"#a98656");props.box(wx,1.18,wz,.04,.75,.04,"#d5be87");
  for(let j=0;j<4;j++)for(const side of [-1,1])props.box(wx,2.06+j*.15,wz+side*(.66-j*.2),2,.19,.35,pick(["#bb8359","#c88f5f","#d39c69"]));addObstacle(wx,wz,1.7,1.7);
  fb(-4.5,.64,2.8,.13,1.28,.13,"#a28556");fb(-4.5,1.3,2.8,.58,.43,.41,"#769191");fb(-4.5,1.55,2.8,.48,.09,.44,"#8ba2a0");fb(-4.5,1.32,2.575,.43,.045,.025,"#3f6769");fb(-4.17,1.62,2.8,.07,.40,.06,"#d8ae65");fb(-4.06,1.76,2.8,.23,.13,.06,"#dd9169");fo(-4.5,2.8,.45,.5);
  for(let j=0;j<2;j++)for(let i=0;i<4-j;i++){fb(-12+i*.40,.17+j*.33,6.6,.34,.33,1.2,"#9a734b");fb(-12+i*.40,.17+j*.33,5.985,.29,.28,.02,"#d8b780");}fo(-11.4,6.6,1.9,1.2);
  fb(-12.2,.24,4.6,.85,.48,.75,"#987747");fb(-12.2,.5,4.6,.88,.08,.78,"#d2b27a");fb(-12.2,.546,4.6,.54,.012,.49,"#b99860");fo(-12.2,4.6,.8,.7);
  bench(-13,-8);fence(-45,-2.5,22,"x");fence(-17,-2.5,8,"x");marker(-22.4,-3.7,"farm");
  for(const [x,z,s] of [[-43,-31,.7],[-40,-36,.6],[-12,-29,.7],[-10,-9,.6]])rock(x,z,s);

  // Forest: dense groves around wide trails and three unobstructed combat glades.
  for(let x=-44;x<-10;x+=4.2)for(let z=4;z<38;z+=4.5){
    const px=x+(random()-.5)*1.2,pz=z+(random()-.5)*1.4;
    if(nearRoad(px,pz,1.0)||FOREST_CLEARINGS.some(c=>Math.hypot(c.x-px,c.z-pz)<c.r))continue;
    tree(px,pz,.83+random()*.23,random()>.7?"oak":"pine");if(random()>.65){flower(px+.8,pz-.8,"#e2c4cf",.24);rock(px-.85,pz+.75,.32);}
  }
  for(const c of FOREST_CLEARINGS)for(let i=0;i<10;i++){const a=i*Math.PI/5,x=c.x+Math.cos(a)*(c.r+.4),z=c.z+Math.sin(a)*(c.r+.4);if(!nearRoad(x,z,.4))flower(x,z,i%3?"#dac5cb":"#fff0be",.22);}
  for(const [x,z] of [[-41,10],[-39,27],[-12,32]]){props.box(x,.235,z,2.2,.46,.55,"#8f704c");props.box(x+1.12,.235,z,.05,.37,.47,"#d4b786");addObstacle(x,z,2.3,.55,"tree");for(let i=0;i<3;i++){details.box(x-.3+i*.24,.13,z+.55,.055,.26,.055,"#d7c8a2");details.box(x-.3+i*.24,.28,z+.55,.19,.07,.18,"#bc8571");}}
  marker(-16,4,"forest");bench(-25,5);

  // Three wide plank bridges connect both banks; collision rails leave generous openings.
  for(const bridge of BRIDGES){
    const left=bridge.x-bridge.w/2;
    for(let x=left+.18;x<left+bridge.w;x+=.37)props.box(x,.08,bridge.z,.35,.20,bridge.d,pick(["#bd955e","#c49d66","#d0a872","#c9a06a"]));
    for(const z of [bridge.z-bridge.d/2-.14,bridge.z+bridge.d/2+.14]){for(let x=left+.1;x<left+bridge.w;x+=2)props.box(x,.48,z,.18,1,.18,"#ad8b5e");props.box(bridge.x,.81,z,bridge.w,.13,.14,"#d9bb86");props.box(bridge.x,.36,z,bridge.w,.10,.12,"#b18b59");addObstacle(bridge.x,z,bridge.w,.16,"fence");}
  }

  // Town: a paved square, clustered buildings, cherry trees and a produce stand.
  for(let x=3;x<14;x++)for(let z=5;z<16;z++)details.box(x+.5,.013,z+.5,.94,.026,.94,(x+z)%2?"#c7cbbb":"#d8d7c1");
  const fx=8.5,fz=11.5;
  props.box(fx,.19,fz,2.5,.38,2.5,"#adb9ab");props.box(fx,.43,fz,2.2,.12,2.2,"#dedcc5");props.box(fx,.51,fz,1.85,.025,1.85,"#8bbdbb");props.box(fx,.91,fz,.44,.90,.44,"#c0c9b3");props.box(fx,1.43,fz,.95,.18,.95,"#d8debf");addObstacle(fx,fz,2.55,2.55);
  for(const [x,z] of [[4.4,14.8],[12.5,14.8],[16,25],[26,3]])bench(x,z);
  for(const [x,z] of [[3.5,5.2],[13.4,5.2],[17,18.9],[27,18.9]])planter(x,z);
  for(const [x,z,s] of [[1,7,.82],[1,29,.9],[16,33,.92],[29,34,.85],[17,6,.85]])tree(x,z,s,"pink");
  for(const room of rooms)if(room.id!=="home"){const door=room.z-room.d/2;for(let z=door-2;z<door;z+=.5)details.box(room.x,.025,z,1.3,.05,.43,"#e0d5b5");for(const side of [-1,1])planter(room.x+side*(room.w/2+.45),door-.1);}
  for(const x of [15,18])for(const z of [21,23])props.box(x,1.05,z,.13,2.1,.13,"#9c7e54");for(let i=0;i<7;i++)props.box(14.8+i*.55,2.1,22,.55,.17,2.65,i%2?"#eee0bd":"#a3b397");
  props.box(16.5,.65,22,3.2,.18,.9,"#ba9766");addObstacle(16.5,22,3.2,.9);for(let i=0;i<8;i++)props.box(15.2+i*.36,.9,22,.25,.28,.29,i%2?"#dab16b":"#a5b66a");marker(2.1,3.8,"town");

  // Beach: wide sand, low dunes, umbrellas and a timber promenade to the pier.
  for(let z=-35;z<-2;z+=.38)props.box(8,.009,z,2.35,.018,.33,z<-20?"#c7b387":"#cfbd94");for(let x=9.3;x<27.4;x+=.38)props.box(x,.009,DOCK.z,.33,.018,2.35,"#cdb88c");
  for(let i=0;i<29;i++)props.box(27.5+i*.37,.10,DOCK.z,.35,.16,2.32,i%3?"#bc9c71":"#d0b183");
  for(const x of [28.2,30.8,33.4,36,37.8])for(const z of [DOCK.z-1.12,DOCK.z+1.12]){props.box(x,-.20,z,.19,.70,.19,"#7d7460");props.box(x,.37,z,.19,.39,.19,"#bdab85");}
  for(const x of [28.7,29.6]){props.box(x,.37,DOCK.z+.72,.62,.38,.62,"#ac8556");props.box(x,.6,DOCK.z+.72,.57,.08,.58,"#d7b27b");addObstacle(x,DOCK.z+.72,.62,.62);}
  for(const [x,z] of [[17,-10],[23,-30],[15,-32],[25,-7]]){props.box(x,1.1,z,.09,2.2,.09,"#b39669");for(let j=0;j<4;j++)props.box(x,2.05+j*.13,z,2.7-j*.56,.15,2.7-j*.56,j%2?"#f6e3be":"#99b7b1");addObstacle(x,z,.35,.35);props.box(x-1,.25,z-.6,.62,.24,1.7,"#d9b185");props.box(x-1,.43,z+.12,.63,.38,.25,"#e4c499");addObstacle(x-1,z-.6,.65,1.7);}
  for(const [x,z] of [[2,-9],[2,-30],[13,-27],[22,-14],[26,-35]]){details.box(x,.035,z,2.8,.07,2.1,"#e9d4a2");details.box(x+.25,.10,z,1.8,.11,1.2,"#efdeb4");for(let j=0;j<7;j++)details.box(x+(j%3)*.17,.20+(j%2)*.04,z+Math.floor(j/3)*.12,.05,.40+(j%2)*.08,.05,"#a8af73");}
  for(let i=0;i<36;i++){const z=-35+i*1.93,x=shoreX(z)-3.3+(i%3)*.45;if(nearRoad(x,z,.7))continue;if(i%7===0){rock(x,z,.38);continue;}for(let j=0;j<3;j++)details.box(x+j*.12,.14+j*.035,z,.055,.28+j*.07,.055,"#b4b879");if(i%3===0)details.box(x+.58,.055,z+.31,.23,.11,.19,"#eed9c2");}
  props.box(21,.20,-26,2.4,.40,.48,"#b9a380");props.box(22.21,.20,-26,.04,.31,.38,"#e0c69c");addObstacle(21,-26,2.4,.48,"tree");marker(5.8,-4.3,"beach");bench(12,-16);
  const streetLights=createStreetLights(scene,shadow,obstacles);
  return {rooms,roomAt,hx,hz,streetLights};
}
