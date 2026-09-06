import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels, seededRandom, voxelMaterial } from "./voxel";
import { MAP_WIDTH,MAP_DEPTH,tileKey,type TileSeed,type TileKind,type Point } from "./farming";
import { createAmbience } from "./ambience";
import { createContactShadows } from "./contactShadows";
import { buildRooms } from "./buildings";
import { createOcean } from "./ocean";
import { createResidents } from "./npcs";
import { INITIAL_SUN,type SolarState } from "./dayNight";
import { createStreetLights } from "./streetLights";
import { BOUNDS,riverCenter,isRiver,isSea,isWater,onBridge,onDock,isBeach,isPath,isGarden,surfaceKind,groundHeight } from "./geography";
export { BOUNDS,riverCenter,isWater,onBridge,isPath,isGarden } from "./geography";

export interface Obstacle { x:number; z:number; w:number; d:number; kind:TileKind }
export interface Occluder { mesh:Mesh; x:number; z:number; radius:number; bottom:number; top:number; phase:number; room?:string; insideOpacity?:number }

export function buildWorld(scene:Scene,shadow:ShadowGenerator) {
  const random=seededRandom(52718);
  const pick=<T,>(a:T[])=>a[Math.floor(random()*a.length)];
  const mat=voxelMaterial(scene);
  const foliageMat=voxelMaterial(scene,"soft-waxy-leaves");foliageMat.specularColor=Color3.FromHexString("#d2e5b1").scale(.07);foliageMat.specularPower=32;
  const roofMat=voxelMaterial(scene,"sunlit-terracotta");roofMat.specularColor=Color3.FromHexString("#ffe6bb").scale(.05);roofMat.specularPower=48;
  const terrain=new Voxels(),details=new Voxels(),props=new Voxels(),water=new Voxels();
  const obstacles:Obstacle[]=[];
  const occluders:Occluder[]=[];
  const tiles:TileSeed[]=[];
  const clutter=new Map<string,{from:number;to:number}[]>();
  const shades={grass:["#9dc567","#a3c970","#a0c76b","#a6ca70","#a3c86b","#9ac166"],path:["#dfca97","#dfc993","#e5cf9d","#e2cb95"],wood:["#aa7548","#b98350","#b7804c"]};
  const addObstacle=(x:number,z:number,w:number,d:number,kind:TileKind="decoration")=>obstacles.push({x,z,w,d,kind});
  // Every biome uses the same one-metre square tile coordinates.
  terrain.box(0,-1.22,0,MAP_WIDTH,1.55,MAP_DEPTH,"#847663");
  terrain.box(0,-.88,0,MAP_WIDTH+.1,.35,MAP_DEPTH+.1,"#a38c66");
  for(let x=-BOUNDS.x;x<BOUNDS.x;x++) for(let z=-BOUNDS.z;z<BOUNDS.z;z++) {
    const px=x+.5,pz=z+.5,kind=surfaceKind(px,pz);
    tiles.push({x,z,kind});
    if(isSea(px,pz)) {
      terrain.box(px,-.61,pz,1,.13,1,"#83b0a0");
    } else if(isRiver(px,pz)) {
      terrain.box(px,-.48,pz,1,.34,1,"#b3b890");
      water.box(px,-.26,pz,1.005,.10,1.005,pick(["#65b8b4","#68b9b5","#6cbdba","#63b5b1"]));
    } else {
      const c=kind==="sand"||isBeach(px,pz)?pick(["#eddaac","#e6d2a1","#eddbb4","#e8d5aa"]):kind==="path"||kind==="dock"?pick(shades.path):kind==="dirt"?pick(["#bea16e","#c4a674","#bea171"]):kind==="bank"?pick(["#cdd2a0","#d2d4a4","#c5c997"]):px<-18?pick(["#89b174","#91b97b","#96ba7c","#8eb576"]):pick(shades.grass);
      terrain.box(px,-.20,pz,1,.4,1,c);
      if((x===-BOUNDS.x||x===BOUNDS.x-1||z===-BOUNDS.z||z===BOUNDS.z-1)&&random()>.45)terrain.box(px,-.56,pz,1,.3,1,"#b09a6b");
      if(kind==="path"&&random()>.65) details.box(px+(random()-.5)*.6,.008,pz+(random()-.5)*.6,.12+random()*.26,.018,.07+random()*.15,"#c1ab7d");
    }
  }

  function rock(x:number,z:number,s=1) {
    props.box(x,.25*s,z,.9*s,.5*s,.75*s,pick(["#a8aaa0","#afb2a3","#bbbcb0"]));
    props.box(x-.1*s,.55*s,z+.02*s,.6*s,.18*s,.55*s,"#c7c9b6");
    props.box(x+.3*s,.1*s,z-.22*s,.38*s,.2*s,.3*s,"#979e8b");
    addObstacle(x,z,s*.8,s*.65,"rock");
  }
  function flower(x:number,z:number,c:string,h=.34) {
    details.box(x,h*.5,z,.055,h,.055,"#608447");
    details.box(x-.11,h*.4,z,.22,.06,.10,"#789848");
    details.box(x+.09,h*.65,z,.18,.07,.10,"#829b4c");
    details.box(x,h,z,.19,.12,.19,c);
    details.box(x,h+.03,z,.07,.14,.07,"#f8db82");
  }
  function tree(x:number,z:number,s=1,type:"oak"|"pine"|"pink"="oak") {
    const trunk=new Voxels();
    trunk.box(x,.95*s,z,.40*s,1.9*s,.4*s,"#886548");
    trunk.box(x+.18*s,1.45*s,z,.35*s,.35*s,.3*s,"#96744d");
    trunk.box(x-.24*s,.1,z+.1,.4*s,.2,.34*s,"#977a49");
    trunk.box(x+.22*s,.1,z-.12,.35*s,.2,.32*s,"#977a49");
    const tm=trunk.build("tree-trunk",scene,mat);shadow.addShadowCaster(tm);
    tm.isPickable=true;tm.metadata={tileKind:"tree",anchor:{x:Math.floor(x),z:Math.floor(z)}};
    const leaves=new Voxels();
    const palette=type==="pink"?["#e8acac","#efb9b5","#e3a5aa","#f3c6b9","#d999a2"]:["#79a65b","#83b461","#90bb67","#97c571","#709a53"];
    let top=4.4*s;
    if(type==="pine") {
      const greens=["#527e57","#65935d","#77a56b","#80ae71"];
      for(let j=0;j<5;j++) {
        const w=(3.2-j*.52)*s,y=(1.85+j*.64)*s;
        leaves.box(0,y,0,w,.76*s,w,greens[Math.min(j,3)]);
        leaves.box(-w*.1,y+.12*s,-w*.1,w*.78,.78*s,w*.78,greens[Math.min(j+1,3)]);
      }
      leaves.box(0,4.95*s,0,.38*s,.65*s,.38*s,"#91b778");top=5.3*s;
    } else {
      // Chunked, asymmetric crowns with small voxel steps, no rounded primitives.
      leaves.box(0,2.9*s,0,2.65*s,1.65*s,2.45*s,palette[0]);
      leaves.box(-.64*s,2.7*s,-.16*s,1.72*s,1.4*s,2.3*s,palette[1]);
      leaves.box(.68*s,3.03*s,.13*s,1.8*s,1.7*s,1.94*s,palette[2]);
      leaves.box(-.16*s,3.9*s,.16*s,1.9*s,.76*s,1.78*s,palette[3]);
      leaves.box(.30*s,4.24*s,.28*s,1.15*s,.33*s,1.06*s,palette[1]);
      for(let k=0;k<9;k++) {
        const dx=(random()-.5)*2.8*s,dz=(random()-.5)*2.5*s;
        leaves.box(dx,(2.55+random()*1.0)*s,dz,(.48+random()*.47)*s,.5*s,(.46+random()*.5)*s,pick(palette));
      }
      if(type==="oak"&&random()>.55)for(let k=0;k<4;k++)
        leaves.box((random()-.5)*2*s,(2.55+random()*.6)*s,-1.2*s,.19*s,.2*s,.2*s,"#d69562");
    }
    const crown=leaves.build(type+"-canopy",scene,foliageMat);
    crown.position.set(x,0,z);shadow.addShadowCaster(crown);
    crown.isPickable=true;crown.metadata={tileKind:"tree",anchor:{x:Math.floor(x),z:Math.floor(z)}};
    occluders.push({mesh:crown,x,z,radius:1.7*s,bottom:1.6*s,top,phase:random()*6.28});
    addObstacle(x,z,.65*s,.65*s,"tree");
  }
  // Tall plants frame the north and west; the southern meadow stays open.
  for(const [x,z,s] of [[-16,12,1],[-12.8,13.1,.92],[-3,13.2,1.03],[1,12.8,.94],[4.8,13.6,1.07],[15.5,12.5,.96],[17,8,1.03],[-16.2,7.5,.85],[-17,3,.9]])
    tree(x,z,s,"pine");
  tree(-13.1,1.8,1.06,"pink");tree(-15.5,-5.2,.84);tree(-12.9,-10.4,.92);
  tree(3.0,8.3,.97);tree(14.3,5.7,.9);tree(15.7,-7.1,.94);tree(3.4,-11.7,.8);tree(-4.7,11.8,.74,"pink");

  // Hollow houses remain in this scene; only wall segments and furniture collide.
  const hx=-8,hz=7;
  const rooms=buildRooms(scene,shadow,mat,roofMat,obstacles,occluders);
  const roomAt=(p:Point)=>rooms.find(r=>r.inside(p))??null;
  // Porch and welcoming stepping stones.
  props.box(hx,.04,hz-2.86,2.5,.08,1.14,"#c9b894");
  props.box(hx,.02,hz-3.54,1.65,.04,.47,"#d6c49f");
  for(let j=0;j<4;j++)details.box(hx+(j%2)*.13,.045,1.1+j*.62,.79,.09,.45,"#b9bda5");

  function fence(x:number,z:number,length:number,axis:"x"|"z",collision=true) {
    const n=Math.round(length/1.4);
    for(let i=0;i<=n;i++) {
      const a=length*i/n;
      props.box(x+(axis==="x"?a:0),.47,z+(axis==="z"?a:0),.19,.94,.19,"#c9ac76");
      props.box(x+(axis==="x"?a:0),.97,z+(axis==="z"?a:0),.23,.11,.23,"#ead1a0");
    }
    for(const y of [.37,.75])props.box(x+(axis==="x"?length/2:0),y,z+(axis==="z"?length/2:0),axis==="x"?length:.10,.12,axis==="z"?length:.10,"#dfc18a");
    if(collision)addObstacle(x+(axis==="x"?length/2:0),z+(axis==="z"?length/2:0),axis==="x"?length:.16,axis==="z"?length:.16,"fence");
  }
  // A real tile-based kitchen garden is rendered by the farming simulation.
  fence(-10.6,-8.0,6.4,"x");fence(-10.6,-8.0,6.7,"z");
  fence(-10.6,-1.3,2.7,"x");fence(-6.3,-1.3,2.1,"x");fence(-4.2,-8,3.3,"z");
  // Watering can and a seed crate, decorative only in this milestone.
  props.box(-4.4,.29,-2,.5,.58,.44,"#718e88");props.box(-4.4,.62,-2,.33,.09,.30,"#91a79a");
  props.box(-4.08,.44,-2,.33,.1,.12,"#a1b7a6");
  props.box(-10.0,.3,-.7,.7,.6,.65,"#c4a373");props.box(-10.0,.62,-.7,.55,.08,.50,"#dfc78f");

  // Bridge runs seamlessly across the collision river, with a two-metre opening.
  for(let i=0;i<16;i++)props.box(6.1+i*.38,.07,0,.36,.23,2.35,pick(["#bd955e","#c49d66","#d0a872","#c9a06a"]));
  for(const z of [-1.18,1.18]) {
    for(const x of [6.18,8.1,10.0,11.8]) {
      props.box(x,.47,z,.18,1.0,.18,"#9e7e54");props.box(x,1.01,z,.23,.12,.23,"#d6b47d");
    }
    props.box(9,.72,z,5.7,.15,.14,"#d5b782");
    props.box(9,.32,z,5.7,.12,.13,"#b79460");
    addObstacle(9,z,5.9,.16,"fence");
  }

  // Stone well with a small shingled roof.
  const wx=1.9,wz=4.9;
  for(const [dx,dz,w,d] of [[0,-.57,1.5,.3],[0,.57,1.5,.3],[-.6,0,.3,.9],[.6,0,.3,.9]])
    props.box(wx+dx,.47,wz+dz,w,.94,d,pick(["#b8b9a3","#adb19c","#c3c4af"]));
  props.box(wx,.43,wz,.9,.04,.9,"#5b8179");
  for(const x of [-.78,.78])props.box(wx+x,1.18,wz,.14,2.35,.14,"#95734c");
  props.box(wx,1.56,wz,1.73,.14,.14,"#a98656");
  props.box(wx,1.18,wz,.04,.75,.04,"#d5be87");
  for(let j=0;j<4;j++)for(const s of [-1,1])
    props.box(wx,2.06+j*.15,wz+s*(.66-j*.2),2.0,.19,.35,pick(["#bb8359","#c88f5f","#d39c69"]));
  addObstacle(wx,wz,1.7,1.7);

  // Mailbox on the way home.
  props.box(-4.5,.64,2.8,.13,1.28,.13,"#a28556");
  props.box(-4.5,1.3,2.8,.58,.43,.41,"#769191");
  props.box(-4.5,1.55,2.8,.48,.09,.44,"#8ba2a0");
  props.box(-4.5,1.32,2.575,.43,.045,.025,"#3f6769");
  props.box(-4.17,1.62,2.8,.07,.40,.06,"#d8ae65");
  props.box(-4.06,1.76,2.8,.23,.13,.06,"#dd9169");
  addObstacle(-4.5,2.8,.45,.5);
  // Stack of firewood, stump and a bench.
  for(let j=0;j<2;j++)for(let i=0;i<4-j;i++) {
    props.box(-12+i*.40,.17+j*.33,6.6,.34,.33,1.2,"#9a734b");
    props.box(-12+i*.40,.17+j*.33,5.985,.29,.28,.02,"#d8b780");
  }
  addObstacle(-11.4,6.6,1.9,1.2);
  props.box(-12.2,.24,4.6,.85,.48,.75,"#987747");props.box(-12.2,.5,4.6,.88,.08,.78,"#d2b27a");
  props.box(-12.2,.546,4.6,.54,.012,.49,"#b99860");addObstacle(-12.2,4.6,.8,.7);
  for(const x of [12.8,14.3])props.box(x,.33,-4.1,.15,.66,.72,"#8b7753");
  for(let j=0;j<3;j++)props.box(13.55,.69,-4.35+j*.25,2.0,.14,.20,"#cfac76");
  props.box(13.55,1.12,-3.92,2,.47,.14,"#d2ae77");addObstacle(13.55,-4.1,2.0,.8);

  // A few fence segments at the farm perimeter form a quiet frame.
  fence(-17.5,-12,5.2,"x");fence(-10.1,-12,5.9,"x");
  fence(12.5,11,4.9,"x");
  for(const [x,z,s] of [[6.2,6.9,.9],[5.8,7.8,.65],[11.8,-9,.7],[12.6,-10,.9],[-16,-1,.6],[-14,-7.5,.5],[-3,10.5,.6],[16.4,1.9,.6]])rock(x,z,s);

  // Forest groves leave a broad, continuous trail and open pockets for exploring.
  for(let x=-43;x<=-20;x+=4.8)for(let z=-34;z<=35;z+=5.0){
    const px=x+(random()-.5)*1.6,pz=z+(random()-.5)*1.8;
    if(Math.abs(pz)<2.8||Math.abs(px+28+Math.sin(pz*.12)*1.3)<2.6)continue;
    tree(px,pz,.86+random()*.22,random()>.62?"oak":"pine");
    if(random()>.68){flower(px+.85,pz-.85,"#e2c4cf",.24);rock(px-1.0,pz+.75,.34);}
  }
  for(const [x,z] of [[-35,-25],[-39,16],[-22,30],[-21,-20]]){
    props.box(x,.235,z,2.2,.46,.55,"#8f704c");props.box(x+1.12,.235,z,.05,.37,.47,"#d4b786");addObstacle(x,z,2.3,.55,"tree");
    for(let i=0;i<3;i++){details.box(x-.3+i*.24,.13,z+.55,.055,.26,.055,"#d7c8a2");details.box(x-.3+i*.24,.28,z+.55,.19,.07,.18,"#bc8571");}
  }
  for(const [x,z,s] of [[-14,32,.95],[-17,23,1],[-13,17,.80],[.5,35,.94],[15,32,1],[25,32,.9],[23,13,.9],[21,-19,1],[-5,-27,.9],[-15,-33,1],[2,-36,.95],[16,-31,1]])tree(x,z,s,z>16?"pink":"oak");
  // A second bridge connects the town to the coast.
  for(let i=0;i<16;i++)props.box(6.1+i*.38,.07,20,.36,.23,2.35,pick(shades.wood));
  for(const z of [18.82,21.18]){
    for(const x of [6.18,8.1,10,11.8])props.box(x,.48,z,.18,1,.18,"#b59261");
    props.box(9,.82,z,5.8,.13,.13,"#d6b582");addObstacle(9,z,5.9,.16,"fence");
  }
  // Long timber pier, open along its southern end for boarding.
  for(let i=0;i<29;i++)props.box(27.5+i*.37,.10,0,.35,.16,2.32,i%3?"#bc9c71":"#d0b183");
  for(const x of [28.2,30.8,33.4,36.0,37.8])for(const z of [-1.12,1.12]){
    props.box(x,-.20,z,.19,.70,.19,"#7d7460");props.box(x,.37,z,.19,.39,.19,"#bdab85");
  }
  props.box(37.7,.58,1.10,.30,.11,.30,"#e1cda1");
  for(const x of [28.7,29.6]){props.box(x,.37,.72,.62,.38,.62,"#ac8556");props.box(x,.60,.72,.57,.08,.58,"#d7b27b");addObstacle(x,.72,.62,.62);}
  // Shore details: driftwood, grasses, sun umbrellas and tide-worn stones.
  for(let i=0;i<36;i++){
    const z=-35+i*1.93,x=27.0+Math.sin(z*.12)*1.25+(i%3)*.65;
    if(Math.abs(z)<2.0||Math.abs(z-20)<2)continue;
    if(i%6===0){rock(x,z,.40);continue;}
    for(let j=0;j<3;j++)details.box(x+j*.12,.14+j*.035,z,.055,.28+j*.07,.055,"#b4b879");
    if(i%4===0)details.box(x+.58,.055,z+.31,.23,.11,.19,"#eed9c2");
  }
  for(const z of [-12,11]){
    const x=27.6;props.box(x,1.1,z,.09,2.2,.09,"#b39669");
    for(let j=0;j<4;j++)props.box(x,2.05+j*.13,z,2.5-j*.52,.15,2.5-j*.52,j%2?"#f3dfb6":"#a0b6a4");addObstacle(x,z,.35,.35);
    props.box(x-1.0,.25,z-.6,.62,.24,1.7,"#d9b185");props.box(x-1.0,.43,z+.12,.63,.38,.25,"#e4c499");addObstacle(x-1,z-.6,.65,1.7);
  }
  // Town plaza: paving, a low fountain, benches, planters and lamp posts.
  for(let x=-15;x<-10;x++)for(let z=22;z<28;z++)details.box(x+.5,.012,z+.5,.94,.024,.94,(x+z)%2?"#cbd0b1":"#d7d7b9");
  props.box(-13,.19,25,1.9,.38,1.9,"#b5bcac");props.box(-13,.42,25,1.65,.12,1.65,"#d8d7bb");props.box(-13,.50,25,1.34,.025,1.34,"#91bebb");props.box(-13,.86,25,.38,.85,.38,"#c0c9b3");props.box(-13,1.34,25,.76,.18,.76,"#d8debf");addObstacle(-13,25,1.95,1.95);
  const streetLights=createStreetLights(scene,shadow,obstacles);
  for(const [x,z] of [[-.6,29],[-11,31],[17,22.8]]){
    for(const side of [-1,1])props.box(x+side*.67,.28,z,.14,.56,.62,"#8f7955");props.box(x,.61,z,1.8,.13,.73,"#c5a775");props.box(x,1.02,z+.3,1.8,.50,.12,"#d5b782");addObstacle(x,z,1.8,.74);
  }
  for(const room of rooms)if(room.id!=="home"){
    for(let z=20.3;z<room.z-room.d/2;z+=.55)details.box(room.x,.02,z,1.28,.04,.48,"#d5c9a3");
    for(const side of [-1,1]){
      const x=room.x+side*(room.w/2+.40),z=room.z-room.d/2-.1;
      props.box(x,.25,z,.64,.50,.64,"#bb9870");props.box(x,.66,z,.75,.50,.70,"#8dac70");for(let j=0;j<3;j++)props.box(x-.22+j*.21,.95,z,.15,.16,.16,j%2?"#f2d58b":"#e3b7b9");addObstacle(x,z,.65,.65);
    }
  }

  // Ground clutter has a controlled density and stays out of paths/buildings.
  for(let i=0;i<6600;i++) {
    const x=random()*(MAP_WIDTH-3)-BOUNDS.x+1.5,z=random()*(MAP_DEPTH-3)-BOUNDS.z+1.5;
    if(isWater(x,z)||isBeach(x,z)||isPath(x,z)||roomAt({x,z})||obstacles.some(o=>Math.abs(x-o.x)<o.w/2+.22&&Math.abs(z-o.z)<o.d/2+.22))continue;
    if(x>-11&&x<-3.8&&z>-8.5&&z<-1.0)continue;
    const from=details.vertexCount;
    const lush=(x<-10&&z<0)||(x>12)||(z>11);
    if(random()<(lush?.29:.045)) {
      flower(x,z,pick(["#fff2c2","#eee5bd","#edcd69","#d7b3c5","#d0bdce"]),.22+random()*.27);
    } else {
      const c=pick(["#90b45b","#8db05a","#b2ce79","#98bb61"]);
      details.box(x,.07,z,.05,.14,.06,c);
      if(random()>.4)details.box(x+.1,.09,z+.04,.045,.18,.055,c);
      if(random()>.7)details.box(x-.08,.04,z,.05,.09,.065,c);
      if(random()>.70)details.box(x,.006,z,.30,.012,.20,"#abd078");
    }
    const key=tileKey(Math.floor(x),Math.floor(z)),ranges=clutter.get(key)??[];
    ranges.push({from,to:details.vertexCount});clutter.set(key,ranges);
  }
  // Reeds and a few lily pads beside calm water.
  for(let z=-37;z<38;z+=2.1) {
    const x=riverCenter(z)-2.1;
    if(onBridge(x,z)||Math.abs(z)<2||Math.abs(z-20)<2)continue;
    for(let i=0;i<4;i++) {
      const dx=x+(random()-.5)*.5,dz=z+(random()-.5)*.5,h=.45+random()*.4;
      details.box(dx,h*.5,dz,.055,h,.055,"#719451");
      details.box(dx,h,dz,.10,.20,.10,"#b29860");
    }
  }
  for(let i=0;i<11;i++) {
    const z=-12+random()*25,x=riverCenter(z)+(random()-.5)*1.9;
    if(Math.abs(z)<2||!isWater(x,z))continue;
    details.box(x,-.194,z,.35,.035,.33,"#7d9f68");
    details.box(x+.1,-.17,z,.21,.02,.23,"#99b774");
    if(i%3===0)details.box(x,-.08,z,.12,.15,.12,"#f3d7c6");
  }
  const terrainMesh=terrain.build("voxel-ground",scene,mat);
  const detailMesh=details.build("flowers-crops-grasses",scene,mat,true);shadow.addShadowCaster(detailMesh);
  const propMesh=props.build("farm-props",scene,mat);shadow.addShadowCaster(propMesh);
  propMesh.isPickable=true;propMesh.metadata={tileKind:"decoration"};
  const waterMat=voxelMaterial(scene,"water");waterMat.specularColor=Color3.FromHexString("#c5e6db").scale(.3);waterMat.specularPower=64;
  const waterMesh=water.build("stream",scene,waterMat);
  for(const tile of tiles) {
    const x=tile.x+.5,z=tile.z+.5;
    const o=obstacles.find(o=>Math.abs(x-o.x)<o.w/2+.14&&Math.abs(z-o.z)<o.d/2+.14);
    if(o)tile.kind=o.kind;
    if(!o&&roomAt({x,z}))tile.kind="floor";
    if(obstacles.some(o=>o.kind==="tree"&&Math.floor(o.x)===tile.x&&Math.floor(o.z)===tile.z))tile.kind="tree";
  }
  const ambience=createAmbience(scene,waterMesh,tiles,riverCenter,isRiver);
  const ocean=createOcean(scene,shadow);
  const residents=createResidents(scene,shadow,canWalk);
  const contacts=createContactShadows(scene,obstacles);
  const detailPositions=detailMesh.getVerticesData("position")!;
  const smokeMat=new StandardMaterial("smoke",scene);smokeMat.diffuseColor=Color3.FromHexString("#ede9d5");smokeMat.emissiveColor=Color3.FromHexString("#d5d6c9").scale(.15);smokeMat.alpha=.32;smokeMat.specularColor=Color3.Black();
  const smoke=Array.from({length:6},(_,i)=>{
    const mesh=MeshBuilder.CreateBox("chimney-smoke",{size:.39},scene);mesh.material=smokeMat;mesh.isPickable=false;
    return {mesh,phase:i/6};
  });
  // Distant backdrop and small stepping edge: the playable world remains bounded.
  const backdropMat=voxelMaterial(scene,"backdrop");backdropMat.diffuseColor=Color3.FromHexString("#9fbc91");
  const backdrop=MeshBuilder.CreateGround("backdrop",{width:400,height:400},scene);backdrop.position.y=-2.1;backdrop.material=backdropMat;backdrop.receiveShadows=true;backdrop.isPickable=false;
  terrainMesh.freezeWorldMatrix();detailMesh.freezeWorldMatrix();propMesh.freezeWorldMatrix();

  function canWalk(x:number,z:number,r=.27) {
    if(Math.abs(x)>BOUNDS.x-.5-r||Math.abs(z)>BOUNDS.z-.5-r)return false;
    for(const [dx,dz] of [[-r,-r],[r,-r],[-r,r],[r,r]])
      if(isWater(x+dx,z+dz)&&!onBridge(x+dx,z+dz)&&!onDock(x+dx,z+dz))return false;
    return !obstacles.some(o=>Math.abs(x-o.x)<o.w/2+r&&Math.abs(z-o.z)<o.d/2+r);
  }
  function update(time:number,motion:boolean,player?:{x:number;y:number;z:number},shadows=true,dt=0,solar:SolarState=INITIAL_SUN,focus:{x:number;z:number}=player??{x:-3.5,z:-3.5}) {
    ambience.update(time,motion,solar);ocean.update(time,motion,solar);residents.update(dt,time,motion);
    streetLights.update(solar.hour,dt,focus);
    contacts.update(player,shadows);
    for(const s of smoke) {
      const p=((motion?time*.075:0)+s.phase)%1;
      s.mesh.position.set(hx+1.83+p*.9,5.5+p*2.4,hz+.55+p*.26);
      s.mesh.scaling.setAll(.7+p*1.9);s.mesh.visibility=(1-p)*.75;
    }
  }
  function clearTile(x:number,z:number) {
    const key=tileKey(x,z),ranges=clutter.get(key);
    if(ranges){for(const range of ranges)for(let i=range.from;i<range.to;i++)detailPositions[i*3+1]=-3;detailMesh.updateVerticesData("position",detailPositions);clutter.delete(key);}
    ambience.clearTile(x,z);
  }
  function clearReach(player:Point,target:Point) {
    const length=Math.hypot(target.x-player.x,target.z-player.z),steps=Math.max(1,Math.ceil(length/.10));
    for(let i=0;i<=steps;i++){const f=i/steps;if(!canWalk(player.x+(target.x-player.x)*f,player.z+(target.z-player.z)*f,.04))return false;}
    return true;
  }
  function propKind(x:number,z:number):TileKind {
    return obstacles.find(o=>Math.abs(x-o.x)<o.w/2+.20&&Math.abs(z-o.z)<o.d/2+.20)?.kind??(onDock(x,z)?"dock":onBridge(x,z)?"bridge":roomAt({x,z})?"floor":"decoration");
  }
  return {canWalk,obstacles,occluders,tiles,clearReach,clearTile,propKind,update,rooms,roomAt,residents,streetLights,heightAt:(x:number,z:number)=>roomAt({x,z}) ? .08 : groundHeight(x,z)};
}
