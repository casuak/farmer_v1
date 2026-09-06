import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Obstacle } from "./world";
import { BOUNDS,BUILDINGS,DOCK,groundHeight,surfaceKind } from "./geography";
import { Voxels,voxelMaterial } from "./voxel";

export const STREET_LIGHTS=[
  {id:"town-west",x:1.5,z:19.9},{id:"town-square",x:14.8,z:9},
  {id:"town-shop",x:3.2,z:21.6},{id:"town-coast",x:25.1,z:21},
  {id:"farm-crossing",x:-18,z:-21.9},{id:"farm-south",x:-18,z:-32},
  {id:"farmhouse",x:-22,z:-16.5},{id:"central-crossing",x:1.8,z:-1.9},
  {id:"river-bridge",x:1.8,z:-21.9},{id:"forest-crossing",x:-17.7,z:2.8},
  {id:"forest-path",x:-22,z:21.8},{id:"beach-south",x:10.2,z:-32},
  {id:"pier",x:DOCK.x,z:DOCK.z+.9},{id:"beach-north",x:10.2,z:-7},
] as const;
export const ACTIVE_STREET_LIGHTS=4;
const POOL_RADIUS=4.8;
const smooth=(a:number,b:number,n:number)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};
export function streetLightPower(hour:number){
  const h=((hour%24)+24)%24;
  return h>=12?smooth(17,18.25,h):1-smooth(5.5,7,h);
}

export function createStreetLights(scene:Scene,shadow:ShadowGenerator,obstacles:Obstacle[]){
  const fixtures=STREET_LIGHTS.map(lamp=>({...lamp,ground:groundHeight(lamp.x,lamp.z)}));
  const posts=new Voxels(),glass=new Voxels();
  for(const {x,z,ground:y} of fixtures){
    posts.box(x,y+.08,z,.46,.16,.46,"#a0a28a");
    posts.box(x,y+.23,z,.26,.20,.26,"#687665");
    posts.box(x,y+1.35,z,.13,2.20,.13,"#647767");
    posts.box(x,y+2.45,z,.50,.11,.50,"#b49764");
    // Open corner posts leave the glass visible instead of burying it inside
    // an opaque solid housing.
    for(const sx of [-1,1])for(const sz of [-1,1])posts.box(x+sx*.20,y+2.70,z+sz*.20,.055,.48,.055,"#77836b");
    posts.box(x,y+2.98,z,.56,.12,.56,"#788773");
    posts.box(x,y+3.06,z,.40,.06,.40,"#93a086");
    posts.box(x,y+2.70,z,.34,.40,.34,"#cfc6a5");
    glass.box(x,y+2.70,z,.355,.415,.355,"#ffffff");
    obstacles.push({x,z,w:.46,d:.46,kind:"decoration"});
  }
  const postMesh=posts.build("street-light-posts",scene,voxelMaterial(scene,"street-light-metal"));
  postMesh.isPickable=true;postMesh.metadata={tileKind:"decoration"};postMesh.freezeWorldMatrix();shadow.addShadowCaster(postMesh);
  const glowMat=new StandardMaterial("street-light-glass",scene);glowMat.disableLighting=true;glowMat.emissiveColor=Color3.FromHexString("#ffcf8d");glowMat.disableDepthWrite=true;
  const glow=glass.build("town-evening-lanterns",scene,glowMat);glow.receiveShadows=false;glow.freezeWorldMatrix();glow.setEnabled(false);

  // One shared falloff and one ground batch keep every visible lamp's pool
  // present. Quads stop at water and rooms, and follow the raised pier/bridges.
  const size=64,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1),falloff=Math.max(0,1-r*r),i=(y*size+x)*4;
    pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.round(falloff*falloff*255);
  }
  const texture=RawTexture.CreateRGBATexture(pixels,size,size,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
  texture.name="street-light-falloff";texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  const poolMat=new StandardMaterial("warm-street-light-pools",scene);poolMat.disableLighting=true;
  poolMat.diffuseTexture=texture;poolMat.useAlphaFromDiffuseTexture=true;poolMat.emissiveColor=Color3.FromHexString("#ffc578");
  poolMat.alphaMode=Constants.ALPHA_ADD;poolMat.disableDepthWrite=true;poolMat.alpha=0;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const lamp of fixtures)for(let x=Math.floor(lamp.x-POOL_RADIUS);x<Math.ceil(lamp.x+POOL_RADIUS);x++)for(let z=Math.floor(lamp.z-POOL_RADIUS);z<Math.ceil(lamp.z+POOL_RADIUS);z++){
    const kind=surfaceKind(x+.5,z+.5);
    if(Math.abs(x+.5)>=BOUNDS.x||Math.abs(z+.5)>=BOUNDS.z||kind==="water"||kind==="sea")continue;
    if(BUILDINGS.some(b=>Math.abs(x+.5-b.x)<b.w/2+.5&&Math.abs(z+.5-b.z)<b.d/2+.5))continue;
    const y=groundHeight(x+.5,z+.5)+.036,base=positions.length/3;
    for(const [dx,dz] of [[0,0],[0,1],[1,1],[1,0]]){
      positions.push(x+dx,y,z+dz);normals.push(0,1,0);
      uvs.push((x+dx-lamp.x)/POOL_RADIUS/2+.5,(z+dz-lamp.z)/POOL_RADIUS/2+.5);
    }
    indices.push(base,base+2,base+1,base,base+3,base+2);
  }
  const pools=new Mesh("street-light-ground-pools",scene),data=new VertexData();data.positions=positions;data.normals=normals;data.uvs=uvs;data.indices=indices;data.applyToMesh(pools);
  pools.material=poolMat;pools.isPickable=false;pools.freezeWorldMatrix();pools.setEnabled(false);

  type Fixture=typeof fixtures[number];
  const interiorMeshes=scene.meshes.filter(m=>m.name.endsWith("-interior")||m.name.endsWith("-floor"));
  const slots=Array.from({length:ACTIVE_STREET_LIGHTS},(_,i)=>{
    const light=new PointLight("street-light-local-"+i,Vector3.Zero(),scene);
    light.diffuse=Color3.FromHexString("#ffcf8e");light.specular=Color3.Black();light.range=6.5;light.intensity=0;
    light.shadowEnabled=false;light.excludedMeshes=[...interiorMeshes,glow,pools];light.setEnabled(false);
    return {light,fixture:null as Fixture|null,weight:0};
  });
  function update(hour:number,dt:number,focus:{x:number;z:number}){
    const power=streetLightPower(hour),enabled=power>.001;
    glow.setEnabled(enabled);glow.visibility=power;pools.setEnabled(enabled);poolMat.alpha=.24*power;
    const assigned=new Set(slots.map(s=>s.fixture?.id));
    const score=(f:Fixture)=>(f.x-focus.x)**2+(f.z-focus.z)**2-(assigned.has(f.id)?9:0);
    const wanted=fixtures.slice().sort((a,b)=>score(a)-score(b)).slice(0,ACTIVE_STREET_LIGHTS);
    const desired=new Set(wanted.map(f=>f.id)),fade=dt>0?Math.min(1,dt*4):1;
    for(const slot of slots){
      if(slot.fixture&&!desired.has(slot.fixture.id)){
        slot.weight=Math.max(0,slot.weight-fade);
        if(slot.weight===0)slot.fixture=null;
      }
    }
    for(const slot of slots){
      if(!slot.fixture){
        slot.fixture=wanted.find(f=>!slots.some(s=>s.fixture?.id===f.id))??null;
        if(slot.fixture)slot.light.position.set(slot.fixture.x,slot.fixture.ground+2.68,slot.fixture.z);
      }
      if(slot.fixture&&desired.has(slot.fixture.id))slot.weight=Math.min(1,slot.weight+fade);
      slot.light.intensity=power*slot.weight*.92;
      slot.light.setEnabled(enabled&&!!slot.fixture&&slot.weight>0);
    }
  }
  update(8,0,{x:-3.5,z:-3.5});
  return {fixtures,slots,glow,pools,postMesh,update};
}
