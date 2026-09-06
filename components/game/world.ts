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
import { buildDistricts } from "./worldDistricts";
import { createOcean } from "./ocean";
import { createResidents } from "./npcs";
import { INITIAL_SUN,type SolarState } from "./dayNight";
import { STREET_LIGHTS } from "./streetLights";
import { BOUNDS,BUILDINGS,BRIDGES,FARM_SPAWN,riverCenter,isRiver,isSea,isWater,onBridge,onDock,isBeach,isPath,isGarden,isPlaza,nearRoad,regionId,surfaceKind,groundHeight } from "./geography";
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
      const region=regionId({x:px,z:pz});
      const c=kind==="path"?region==="town"?pick(["#cecdb5","#d4d0b7","#c6cab2"]):pick(shades.path):kind==="sand"||isBeach(px,pz)?pick(["#eddaac","#e6d2a1","#eddbb4","#e8d5aa"]):kind==="dirt"?pick(["#bea16e","#c4a674","#bea171"]):kind==="bank"?pick(["#cdd2a0","#d2d4a4","#c5c997"]):region==="forest"?pick(["#83ab70","#8bb177","#93b87b","#80a874"]):pick(shades.grass);
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
    if(isWater(x,z)||nearRoad(x,z,.45)||isGarden(x,z)||BUILDINGS.some(b=>Math.abs(b.x-x)<b.w/2+1&&Math.abs(b.z-z)<b.d/2+1)||STREET_LIGHTS.some(l=>Math.hypot(l.x-x,l.z-z)<1.05))return;
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
  const {rooms,roomAt,hx,hz,streetLights}=buildDistricts({scene,shadow,mat,roofMat,obstacles,occluders,props,details,random,pick,tree,rock,flower});

  // Ground clutter has a controlled density and stays out of paths/buildings.
  for(let i=0;i<6600;i++) {
    const x=random()*(MAP_WIDTH-3)-BOUNDS.x+1.5,z=random()*(MAP_DEPTH-3)-BOUNDS.z+1.5;
    if(isWater(x,z)||isBeach(x,z)||isPath(x,z)||roomAt({x,z})||obstacles.some(o=>Math.abs(x-o.x)<o.w/2+.22&&Math.abs(z-o.z)<o.d/2+.22))continue;
    if(isGarden(x,z)||isPlaza(x,z))continue;
    const from=details.vertexCount;
    const lush=regionId({x,z})!=="farm";
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
    if(BRIDGES.some(b=>Math.abs(z-b.z)<2.3))continue;
    for(let i=0;i<4;i++) {
      const dx=x+(random()-.5)*.5,dz=z+(random()-.5)*.5,h=.45+random()*.4;
      details.box(dx,h*.5,dz,.055,h,.055,"#719451");
      details.box(dx,h,dz,.10,.20,.10,"#b29860");
    }
  }
  for(let i=0;i<11;i++) {
    const z=-12+random()*25,x=riverCenter(z)+(random()-.5)*1.9;
    if(BRIDGES.some(b=>Math.abs(z-b.z)<2.2)||!isWater(x,z))continue;
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
  function update(time:number,motion:boolean,player?:{x:number;y:number;z:number},shadows=true,dt=0,solar:SolarState=INITIAL_SUN,focus:{x:number;z:number}=player??FARM_SPAWN) {
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
