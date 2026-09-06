import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial } from "./voxel";
import { TOOLS,tileKey,tileCenter,worldToTile,type FarmTile,type TileInfo,type ToolId,type Point,type TileSeed } from "./farming";
import type { HandItem } from "./inventory";

function border(v:Voxels,x:number,z:number,size:number,y:number,color:string,thickness=.025) {
  for(const side of [-1,1]){
    v.box(x+side*size/2,y,z,thickness,.018,size,color);
    v.box(x,y,z+side*size/2,size,.018,thickness,color);
  }
}

export function createFarmView(scene:Scene,shadow:ShadowGenerator,tiles:TileSeed[],clearClutter:(x:number,z:number)=>void) {
  const mat=voxelMaterial(scene,"farm-soil-crops");
  const plots=new Map<string,{soil:Mesh;plant:Mesh|null;pop:number;mature:boolean}>();
  const gridData=new Voxels();
  for(const t of tiles)if(["grass","dirt","path","bank","sand"].includes(t.kind))border(gridData,t.x+.5,t.z+.5,1,.013,"#74864d",.009);
  const gridMat=voxelMaterial(scene,"tile-grid");gridMat.alpha=.12;
  const grid=gridData.build("equal-one-metre-tile-grid",scene,gridMat);grid.receiveShadows=false;grid.freezeWorldMatrix();
  const rangeData=new Voxels();for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)border(rangeData,x,z,.98,.16,"#7be4dd",.035);
  const rangeMat=new StandardMaterial("tool-reach",scene);rangeMat.disableLighting=true;rangeMat.emissiveColor=Color3.White();rangeMat.alpha=.67;
  const range=rangeData.build("nearby-three-by-three",scene,rangeMat);range.receiveShadows=false;
  const highlightData=new Voxels();border(highlightData,0,0,.94,0,"#ffffff",.072);
  const highlightMat=new StandardMaterial("hover-color",scene);highlightMat.disableLighting=true;
  const highlight=highlightData.build("hovered-tile",scene,highlightMat);highlight.receiveShadows=false;highlight.setEnabled(false);
  const fill=MeshBuilder.CreateGround("hovered-tile-fill",{width:.90,height:.90},scene);
  const fillMat=new StandardMaterial("hover-fill",scene);fillMat.disableLighting=true;fillMat.alpha=.19;fill.material=fillMat;fill.isPickable=false;fill.setEnabled(false);
  const markers=[{outline:highlight,fill,edgeMat:highlightMat,fillMat},...Array.from({length:2},(_,i)=>{
    const outline=highlight.clone("sweep-tile-"+i)!,plane=fill.clone("sweep-fill-"+i)!;
    const edgeMat=highlightMat.clone("sweep-edge-"+i),shade=fillMat.clone("sweep-shade-"+i);
    outline.material=edgeMat;plane.material=shade;return {outline,fill:plane,edgeMat,fillMat:shade};
  })];

  function updateTile(t:FarmTile) {
    if(!t.tilled)return;
    const key=tileKey(t.x,t.z),old=plots.get(key);
    if(old){shadow.removeShadowCaster(old.soil);old.soil.dispose();if(old.plant){shadow.removeShadowCaster(old.plant);old.plant.dispose();}}
    clearClutter(t.x,t.z);
    const center=tileCenter(t),v=new Voxels();
    v.box(0,.055,0,.96,.11,.96,t.watered?"#816345":"#a78150");
    for(let i=0;i<4;i++)v.box(-.33+i*.22,.123,0,.125,.04,.83,t.watered?"#98734c":"#bd935b");
    if(t.watered)for(let i=0;i<3;i++)v.box(-.28+i*.25,.111,.25-(i%2)*.40,.12,.012,.15,"#655e44");
    const soil=v.build("tilled-tile-"+key,scene,mat);soil.position.set(center.x,0,center.z);soil.freezeWorldMatrix();
    soil.isPickable=true;soil.metadata={tileCoord:{x:t.x,z:t.z}};
    let plant:Mesh|null=null;
    if(t.crop) {
      const c=new Voxels(),s=t.crop.stage;
      if(s===0)for(const [x,z] of [[-.22,-.2],[.2,.20],[0,-.04]])c.box(x,.16,z,.085,.075,.09,"#dbb581");
      if(s>=1) {
        const height=[0,.20,.33,.48,.57][s];
        c.box(0,.14+height/2,0,.065,height,.065,"#6f9849");
        const width=[0,.18,.28,.36,.43][s];
        c.box(-width*.35,.19+height*.5,0,width,.07,.16,"#7faa50");
        c.box(width*.35,.23+height*.7,.01,width,.075,.15,"#9abb63");
        c.box(.02,.21+height,-.035,.13,.16,.14,"#afca76");
        if(s>=2){c.box(.02,.16+height*.67,.14,.15,.075,width*.80,"#80a548");c.box(-.02,.15+height*.9,-.12,.14,.08,width*.72,"#95ba59");}
        if(s>=3) {
          const size=s===4?.43:.23;
          c.box(0,.15+size*.35,0,size,size*.7,size*.92,s===4?"#f6ebce":"#dddcb0");
          c.box(0,.13,0,size*.45,.14,size*.48,"#d8cc9e");
          c.box(-size*.1,.16+size*.73,-size*.07,size*.78,.09,size*.70,"#fff3d5");
        }
      }
      plant=c.build("turnip-stage-"+s+"-"+key,scene,mat);plant.position.set(center.x,0,center.z);shadow.addShadowCaster(plant);
      plant.isPickable=true;plant.metadata={tileCoord:{x:t.x,z:t.z}};
    }
    plots.set(key,{soil,plant,pop:.78,mature:t.crop?.stage===4});
  }
  // Reused dust, droplets and harvest flecks. No meshes are allocated per click.
  const particleMat=new StandardMaterial("tool-particles",scene);particleMat.diffuseColor=Color3.White();particleMat.specularColor=Color3.Black();
  const bits=Array.from({length:20},()=>{
    const mesh=MeshBuilder.CreateBox("tool-action-bit",{size:.075},scene);mesh.material=particleMat;mesh.isPickable=false;mesh.setEnabled(false);
    return {mesh,life:0,vx:0,vy:0,vz:0};
  });
  function effect(t:Point,tool:ToolId,targets:Point[]=[t]) {
    particleMat.diffuseColor=Color3.FromHexString(tool==="water"?"#84c5d0":tool==="scythe"?"#f1d282":tool==="seeds"?"#d6b476":"#b18b56");
    bits.forEach((b,i)=>{
      const a=i*2.399,p=tileCenter(targets[i%targets.length]);
      b.life=.5+(i%4)*.055;b.mesh.position.set(p.x+Math.cos(a)*.25,tool==="water"?.65:.20,p.z+Math.sin(a)*.25);
      b.vx=Math.cos(a)*(.35+i%3*.2);b.vz=Math.sin(a)*(.35+i%3*.2);b.vy=tool==="water"?-1.4:1.0+i%4*.23;
      b.mesh.scaling.set(1,tool==="water"?2:1,1);b.mesh.visibility=1;b.mesh.setEnabled(true);
    });
  }
  function hover(info:TileInfo|null,area?:TileInfo[]) {
    const infos=area??(info?[info]:[]);
    markers.forEach((marker,i)=>{
      const target=infos[i];marker.outline.setEnabled(!!target);marker.fill.setEnabled(!!target);if(!target)return;
      const c=Color3.FromHexString(target.actionable?"#ffe364":"#ff8977");marker.edgeMat.emissiveColor=c;marker.fillMat.emissiveColor=c;
      const y=target.kind==="water"||target.kind==="sea"?-.065:target.kind==="bridge"||target.kind==="dock"?.225:target.kind==="floor"?.15:target.tilled?.175:.07;
      marker.outline.position.set(target.x+.5,y,target.z+.5);marker.fill.position.set(target.x+.5,y-.01,target.z+.5);
    });
  }
  function update(time:number,dt:number,motion:boolean,player:Point,showGrid:boolean,showRange:boolean) {
    grid.setEnabled(showGrid);range.setEnabled(showRange);
    const p=worldToTile(player);range.position.set(p.x+.5,.01,p.z+.5);
    for(const plot of plots.values())if(plot.plant){
      plot.pop=Math.min(1,plot.pop+dt*1.8);plot.plant.scaling.setAll(motion?plot.pop:1);
      plot.plant.rotation.z=motion?Math.sin(time*1.3+plot.plant.position.x*.7+plot.plant.position.z)*.024:0;
    }
    for(const b of bits)if(b.life>0){b.life-=dt;b.vy-=dt*3.5;b.mesh.position.x+=b.vx*dt;b.mesh.position.y+=b.vy*dt;b.mesh.position.z+=b.vz*dt;b.mesh.visibility=Math.min(1,b.life*3);if(b.life<=0)b.mesh.setEnabled(false);}
  }
  return {updateTile,hover,effect,update};
}

export function createHeldTools(scene:Scene,hand:TransformNode,shadow:ShadowGenerator) {
  const material=voxelMaterial(scene,"hand-tools"),root=new TransformNode("equipped-tool",scene);root.parent=hand;root.position.set(0,-.20,-.02);
  const muzzle=new TransformNode("pistol-muzzle",scene);muzzle.parent=root;muzzle.position.set(0,-.39,-.04);
  const tools=new Map<HandItem,Mesh>();
  for(const tool of [...TOOLS,"pistol","sword"] as HandItem[]){
    const v=new Voxels();
    if(tool==="hoe"){
      v.box(0,-.14,-.04,.07,.72,.07,"#bd925c");v.box(0,-.43,-.13,.31,.075,.26,"#839a93");v.box(0,-.47,-.23,.33,.10,.065,"#bad0bc");
    }else if(tool==="seeds"){
      v.box(0,-.05,-.13,.23,.28,.17,"#dbbb7d");v.box(0,.10,-.13,.25,.055,.18,"#f1d699");v.box(0,-.02,-.222,.11,.13,.025,"#709851");
    }else if(tool==="water"){
      v.box(0,-.08,-.14,.29,.30,.32,"#779e9c");v.box(0,.095,-.14,.29,.06,.33,"#a5c0ae");v.box(0,.15,-.14,.15,.09,.05,"#78958c");v.box(0,.05,-.42,.08,.10,.32,"#99b5a7");v.box(0,.05,-.58,.18,.06,.09,"#c5d4b9");
    }else if(tool==="scythe"){
      v.box(0,-.12,-.04,.07,.67,.07,"#b89160");v.box(-.16,-.40,-.04,.37,.07,.10,"#a2b8a7");v.box(-.36,-.36,-.04,.10,.12,.10,"#c5d4bb");v.box(-.41,-.27,-.04,.07,.11,.085,"#dce5cd");
    }else if(tool==="pistol"){
      v.box(0,-.15,-.04,.14,.38,.14,"#607078");v.box(0,-.18,-.12,.12,.32,.04,"#99aaa9");v.box(0,.03,.02,.12,.18,.18,"#967754");v.box(0,-.35,-.04,.08,.025,.07,"#35454b");
    }else{
      v.box(0,-.17,0,.075,.25,.08,"#8a6f4d");v.box(0,-.30,0,.36,.07,.10,"#d3bd78");v.box(0,-.63,0,.13,.64,.055,"#c6d9d9");v.box(-.045,-.63,-.005,.035,.62,.065,"#edf5e5");v.box(0,-.98,0,.07,.09,.045,"#e4eee1");
    }
    const mesh=v.build("equipped-"+tool,scene,material);mesh.parent=root;mesh.setEnabled(false);shadow.addShadowCaster(mesh);tools.set(tool,mesh);
  }
  return {muzzle,select(tool:HandItem|null){for(const [id,mesh] of tools)mesh.setEnabled(id===tool);muzzle.setEnabled(tool==="pistol");}};
}
