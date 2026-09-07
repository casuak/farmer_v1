import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial } from "./voxel";
import { ORES,oreRadius,type MiningModel,type MiningImpact,type OreInfo } from "./mining";
import { MINING_IMPACT_TIME } from "./miningMotion";

/** Deposits are separate meshes, not baked scenery: cracks, collision and depletion agree. */
export function createMiningView(scene:Scene,shadow:ShadowGenerator,model:MiningModel){
  const rubbleMat=voxelMaterial(scene,"ore-bedrock"),veinMats=new Map(Object.entries(ORES).map(([kind,def])=>{
    const mat=voxelMaterial(scene,`ore-vein-${kind}`);mat.specularColor=Color3.FromHexString(def.light).scale(.35);mat.specularPower=48;mat.emissiveColor=Color3.FromHexString(def.color).scale(kind==="crystal"?.18:.045);return [kind,mat];
  }));
  const views=new Map(model.nodes.map(node=>{
    const def=ORES[node.kind],s=node.size,root=new TransformNode(`ore-root-${node.id}`,scene);root.position.set(node.x,0,node.z);root.scaling.setAll(s);
    const rockMat=voxelMaterial(scene,`ore-stone-${node.id}`);
    const rock=new Voxels().box(0,.19,0,1.25,.38,1.15,"#697a78").box(-.13,.48,.04,.98,.38,.90,"#83908b").box(-.10,.76,.06,.70,.20,.68,"#a1aaa0").box(-.16,.885,.06,.49,.05,.49,"#b9beb0")
      .box(.45,.34,-.16,.38,.34,.56,"#8b9690").box(-.49,.25,-.29,.33,.30,.36,"#74867d").box(.10,.38,-.47,.74,.14,.12,"#9aa69a")
      .box(-.45,.394,.30,.30,.02,.32,"#81905a").box(.41,.515,.08,.18,.025,.24,"#8b9b64").box(-.23,.687,.38,.32,.025,.13,"#96a671").build(`ore-rock-${node.id}`,scene,rockMat);
    rock.parent=root;shadow.addShadowCaster(rock);
    const v=new Voxels();
    if(node.kind==="crystal"){
      for(const [x,y,z,w,h] of [[.05,1.02,-.12,.24,.60],[.33,.70,-.34,.19,.56],[-.32,.93,.13,.20,.58],[-.29,.45,-.51,.14,.25]]){
        v.box(x,y,z,w,h,w,def.color).box(x-w*.24,y+.06,z-w*.12,w*.35,h*.91,w*.82,def.light).box(x,y+h*.5+.045,z,w*.57,.09,w*.57,"#dfd6f5");
      }
    }else{
      // Mineral seams wrap across the upper ledges and both camera-facing sides.
      for(const [x,y,z,w,h,d] of [[-.14,.885,.02,.35,.08,.19],[.12,.884,-.12,.16,.07,.29],[.27,.69,-.19,.13,.19,.12],[-.26,.50,-.421,.21,.18,.045],[-.03,.40,-.542,.14,.13,.04],[.23,.49,-.461,.22,.14,.05],[.649,.35,-.18,.045,.20,.21],[.381,.67,.13,.045,.13,.22]]){
        v.box(x,y,z,w,h,d,def.color).box(x-.018,y+h*.32,z-.014,w*.70,Math.max(.025,h*.20),d*1.04,def.light);
      }
      if(node.kind==="copper")v.box(.06,.522,-.461,.065,.11,.05,"#79a392").box(.382,.55,.02,.04,.10,.14,"#70a58f");
    }
    const veins=v.build(`ore-veins-${node.id}`,scene,veinMats.get(node.kind)!);veins.parent=root;shadow.addShadowCaster(veins);
    const cracks=Array.from({length:def.health-1},(_,i)=>{
      const x=-.30+i*.15;
      const mesh=new Voxels().box(x,.899,.01,.025,.017,.43,"#364747").box(x+.055,.899,-.18,.135,.018,.024,"#364747").box(x,.56,-.448,.027,.23,.022,"#354545").box(x+.048,.43,-.572,.12,.028,.019,"#354545").box(.657,.36,-.28+i*.12,.019,.23,.024,"#364747").build(`ore-crack-${node.id}-${i}`,scene,rubbleMat);mesh.parent=root;mesh.setEnabled(false);return mesh;
    });
    const bed=new Voxels().box(0,.025,0,1.48,.05,1.38,"#798773").box(-.42,.072,-.29,.28,.095,.24,"#929b8d").box(.40,.08,.15,.34,.12,.28,"#a0a698").box(.05,.064,-.45,.26,.08,.19,"#a2a598").build(`ore-bed-${node.id}`,scene,rubbleMat);bed.position.set(node.x,0,node.z);bed.scaling.setAll(s);
    for(const mesh of [rock,veins,bed]){mesh.isPickable=true;mesh.metadata={oreId:node.id,tileKind:"rock"};}
    const view={root,rock,rockMat,veins,cracks,bed,flash:0};return [node.id,view] as const;
  }));
  const ringMat=new StandardMaterial("mining-target-color",scene);ringMat.disableLighting=true;ringMat.emissiveColor=Color3.FromHexString("#ffe2a5");ringMat.alpha=.88;
  const ring=MeshBuilder.CreateTorus("mining-target-ring",{diameter:1.85,thickness:.038,tessellation:40},scene);ring.material=ringMat;ring.isPickable=false;ring.setEnabled(false);
  const sparkMat=new StandardMaterial("mining-spark-glow",scene);sparkMat.disableLighting=true;sparkMat.emissiveColor=Color3.FromHexString("#ffe4a3");
  const chipMat=voxelMaterial(scene,"mining-stone-chips");chipMat.diffuseColor=Color3.FromHexString("#a2aca2");
  const dustMat=voxelMaterial(scene,"mining-dust");dustMat.diffuseColor=Color3.FromHexString("#b6b8a4");dustMat.alpha=.45;
  // Fixed pool: repeated swings and regenerated deposits never grow the scene.
  const bits=Array.from({length:64},(_,i)=>{
    const mesh=MeshBuilder.CreateBox(`mining-debris-${i}`,{size:1},scene);mesh.isPickable=false;mesh.setEnabled(false);
    return {mesh,life:0,total:0,vx:0,vy:0,vz:0,spin:0,size:0,dust:false};
  });let nextBit=0;
  const trail=new Mesh("pickaxe-swing-trail",scene),trailData=new VertexData(),count=12;
  const positions=new Float32Array(count*6),colors=new Float32Array(count*8),normals=new Float32Array(count*6),indices:number[]=[];
  for(let i=0;i<count;i++){normals[i*6+1]=normals[i*6+4]=1;if(i<count-1){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  trailData.positions=positions;trailData.normals=normals;trailData.colors=colors;trailData.indices=indices;trailData.applyToMesh(trail,true);
  const trailMat=new StandardMaterial("pickaxe-trail-light",scene);trailMat.disableLighting=true;trailMat.emissiveColor=Color3.FromHexString("#e5f5fa");trailMat.backFaceCulling=false;trailMat.disableDepthWrite=true;trailMat.alpha=.72;trail.material=trailMat;trail.hasVertexAlpha=true;trail.isPickable=false;trail.setEnabled(false);
  const history:Vector3[]=[];let previousElapsed=Infinity;
  function hit(impact:MiningImpact,motion:boolean){
    if(!impact.ok)return;const view=views.get(impact.node.id)!;view.flash=.24;
    const number=motion?(impact.broken?44:19):6,def=ORES[impact.node.kind];
    for(let i=0;i<number;i++){
      const b=bits[nextBit++%bits.length],angle=i*2.399+impact.node.health*.7,spark=i%5===0;b.dust=i%4===0;
      b.total=b.life=(b.dust?.52:.38)+(i%4)*.12;b.size=b.dust?.14:spark?.035:.07+(i%3)*.025;
      b.mesh.material=b.dust?dustMat:spark?sparkMat:i%3===0?veinMats.get(impact.node.kind)!:chipMat;
      const speed=motion?(impact.broken?1.1: .65)+i%4*.34:.12;
      b.mesh.position.set(impact.broken?impact.node.x:impact.point.x,.62*impact.node.size,impact.broken?impact.node.z:impact.point.z);
      b.vx=Math.cos(angle)*speed;b.vz=Math.sin(angle)*speed;b.vy=motion?1.1+(i%5)*.38:.2;b.spin=motion?(i%2?1:-1)*(3+i%4):0;
      b.mesh.scaling.set(b.size,b.size*(spark?2.7:1),b.size);b.mesh.visibility=1;b.mesh.setEnabled(true);
    }
    sparkMat.emissiveColor=Color3.FromHexString(impact.node.kind==="crystal"?def.light:"#ffe4a3");
  }
  function update(time:number,dt:number,motion:boolean,target:OreInfo|null,tip:TransformNode){
    for(const node of model.nodes){
      const view=views.get(node.id)!,alive=node.health>0;view.root.setEnabled(alive);view.flash=Math.max(0,view.flash-dt);
      view.cracks.forEach((crack,i)=>crack.setEnabled(alive&&i<ORES[node.kind].health-node.health));
      view.rockMat.emissiveColor.setAll(view.flash*.85);
      view.root.rotation.z=motion?Math.sin(view.flash*72)*view.flash*.13:0;
      view.root.rotation.x=motion?Math.cos(view.flash*64)*view.flash*.07:0;
    }
    const selected=model.get(target?.id);ring.setEnabled(!!selected);
    if(selected){ring.position.set(selected.x,.075,selected.z);ring.scaling.setAll(oreRadius(selected)/.66);ring.visibility=motion?.74+Math.sin(time*4)*.10:.8;ringMat.emissiveColor=Color3.FromHexString(target?.health===0?"#b0b6aa":target?.reachable&&target.equipped?"#ffe0a0":"#e59c84");}
    for(const b of bits)if(b.life>0){
      b.life=Math.max(0,b.life-dt);b.vy-=dt*(b.dust?1.8:7);b.mesh.position.x+=b.vx*dt;b.mesh.position.z+=b.vz*dt;b.mesh.position.y+=b.vy*dt;
      if(b.mesh.position.y<b.size*.5){b.mesh.position.y=b.size*.5;b.vy=Math.abs(b.vy)*.25;b.vx*=.75;b.vz*=.75;}
      b.mesh.rotation.x+=b.spin*dt;b.mesh.rotation.z+=b.spin*.7*dt;b.mesh.visibility=Math.min(1,b.life/.24);
      if(b.dust)b.mesh.scaling.setAll(b.size*(1+(1-b.life/b.total)*2.8));
      if(b.life===0)b.mesh.setEnabled(false);
    }
    const elapsed=model.swing?.elapsed??Infinity,showTrail=motion&&elapsed>.19&&elapsed<MINING_IMPACT_TIME+.12;
    if(elapsed<previousElapsed||!showTrail)history.length=0;previousElapsed=elapsed;
    if(showTrail&&dt>0){tip.computeWorldMatrix(true);history.unshift(tip.getAbsolutePosition().clone());if(history.length>count)history.pop();}
    trail.setEnabled(showTrail&&history.length>2);
    if(trail.isEnabled()){
      for(let i=0;i<count;i++){
        const p=history[Math.min(i,history.length-1)],width=.047*(1-i/count);
        for(let side=0;side<2;side++){const a=i*6+side*3,c=i*8+side*4,sign=side===0?-1:1;positions[a]=p.x+width*sign;positions[a+1]=p.y;positions[a+2]=p.z+width*sign;colors[c]=.87;colors[c+1]=.96;colors[c+2]=1;colors[c+3]=(1-i/count)*.62;}
      }
      trail.updateVerticesData("position",positions,true);trail.updateVerticesData("color",colors);
    }
  }
  return {hit,update,views,ring,bits,trail};
}
