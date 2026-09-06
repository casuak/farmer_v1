import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { BoatModel } from "./boat";
import { BOUNDS,isSea,onDock,seaHeight } from "./geography";
import { Voxels,voxelMaterial } from "./voxel";
import { INITIAL_SUN,type SolarState } from "./dayNight";
import "@babylonjs/core/Shaders/ShadersInclude/helperFunctions";
import "@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions";

// Every wildlife model has its head at local -Z. Positive pitch raises its nose.
function faceTravel(node:TransformNode,vx:number,vy:number,vz:number){
  node.rotation.y=Math.atan2(-vx,-vz);
  node.rotation.x=Math.atan2(vy,Math.hypot(vx,vz));
}
const LEAP_DURATION=1.3,LEAP_HEIGHT=1.3,LEAP_DISTANCE=1.5;

const vertexSource=`precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; uniform float time;
varying vec3 vWorld; varying vec3 vNormal;
void main(){
 vec3 p=position; float a=p.x*.72+p.z*.25-time*1.1,b=p.z*1.05-p.x*.2-time*.85;
 p.y=-.23+sin(a)*.105+sin(b)*.05;
 vNormal=normalize(vec3(-cos(a)*.0756+cos(b)*.01,1.,-cos(a)*.02625-cos(b)*.0525));
 vWorld=p; gl_Position=worldViewProjection*vec4(p,1.);
}`;
const fragmentSource=`precision highp float;
#include<helperFunctions>
uniform float time; uniform float linearOutput; uniform float exposureLinear; uniform float contrast;
uniform vec3 cameraPosition; uniform vec3 sunDirection;
uniform float daylight; uniform float sunStrength;
varying vec3 vWorld; varying vec3 vNormal;
#include<imageProcessingFunctions>
void main(){
 float shore=31.+sin(vWorld.z*.12)*1.25+sin(vWorld.z*.31)*.35;
 float depth=smoothstep(0.,13.,vWorld.x-shore);
 vec3 c=mix(vec3(.34,.74,.72),vec3(.16,.46,.62),depth);
 float band=sin(vWorld.x*1.6+vWorld.z*.34-time*1.4);
 float foam=pow(max(0.,band),28.)*(1.-smoothstep(.6,4.3,vWorld.x-shore));
 float shimmer=pow(max(0.,sin(vWorld.x*8.+vWorld.z*9.3+time*.7)),24.);
 vec3 view=normalize(cameraPosition-vWorld);
 float sparkle=pow(max(0.,dot(vNormal,normalize(sunDirection+view))),100.);
 float fresnel=pow(1.-max(0.,dot(vNormal,view)),3.);
 c=mix(c,vec3(.75,.89,.88),fresnel*.38);
 c+=vec3(.035,.07,.075)*sin(vWorld.x*.72+vWorld.z*.25-time*1.1);
 c=mix(c,vec3(.89,.96,.84),foam*.64);
 c+=vec3(1.15,1.09,.82)*sparkle*(.55+shimmer*.8)*sunStrength;
 c*=mix(vec3(.34,.46,.68),vec3(1.),daylight);
 vec4 linearColor=vec4(toLinearSpace(max(c,vec3(0.))),1.);
 gl_FragColor=linearOutput>.5?linearColor:applyImageProcessing(linearColor);
}`;

export function createOcean(scene:Scene,shadow:ShadowGenerator) {
  const positions:number[]=[],indices:number[]=[];
  for(let x=25;x<BOUNDS.x;x++)for(let z=-BOUNDS.z;z<BOUNDS.z;z++)if(isSea(x+.5,z+.5)){
    for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      const px=x+a*.5,pz=z+b*.5,i=positions.length/3;
      positions.push(px,-.23,pz,px,-.23,pz+.5,px+.5,-.23,pz+.5,px+.5,-.23,pz);
      indices.push(i,i+2,i+1,i,i+3,i+2);
    }
  }
  // Low-detail distant water continues beyond the navigable map, so the sea has no visible pool edge.
  for(let x=28;x<136;x+=2)for(let z=-112;z<112;z+=2){
    if(x<BOUNDS.x&&z>=-BOUNDS.z&&z<BOUNDS.z)continue;
    if(!isSea(x+1,z+1))continue;
    const i=positions.length/3;positions.push(x,-.23,z,x,-.23,z+2,x+2,-.23,z+2,x+2,-.23,z);indices.push(i,i+2,i+1,i,i+3,i+2);
  }
  const mesh=new Mesh("ocean-wave-surface",scene),data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);
  mesh.isPickable=true;mesh.metadata={tileKind:"sea"};mesh.alwaysSelectAsActiveMesh=true;
  const ocean=new ShaderMaterial("tidal-waves-and-sunlight",scene,{vertexSource,fragmentSource},{attributes:["position"],uniforms:["worldViewProjection","time","linearOutput","exposureLinear","contrast","cameraPosition","sunDirection","daylight","sunStrength"],defines:["#define TONEMAPPING 2","#define EXPOSURE","#define CONTRAST"]});
  const sunDirection=Vector3.Zero();mesh.material=ocean;
  const mat=voxelMaterial(scene,"coastal-wildlife");
  const gulls=Array.from({length:7},(_,i)=>{
    const root=new TransformNode("seagull-"+i,scene);
    const body=new Voxels().box(0,0,0,.16,.17,.42,"#f8f1d6").box(0,.09,-.22,.15,.14,.16,"#fff9e5").box(0,.06,-.34,.08,.07,.14,"#e4b770").box(0,.02,.25,.21,.045,.21,"#bfcac4").build("gull-body",scene,mat);body.parent=root;
    const wings=[-1,1].map(s=>{
      const wing=new TransformNode("gull-wing",scene);wing.parent=root;wing.position.x=s*.06;
      const m=new Voxels().box(s*.26,0,.015,.54,.055,.23,"#f4f2df").box(s*.57,-.035,.07,.22,.045,.15,"#8c9da0").build("gull-feathers",scene,mat);m.parent=wing;return wing;
    });
    return {root,wings,phase:i*1.77};
  });
  const silhouetteMat=new StandardMaterial("fish-below-the-surface",scene);silhouetteMat.disableLighting=true;silhouetteMat.emissiveColor=Color3.FromHexString("#285e61");silhouetteMat.alpha=.25;
  const fishShadows=Array.from({length:18},(_,i)=>{
    const v=new Voxels().box(0,0,0,.18,.008,.63,"#ffffff").box(0,0,-.19,.23,.008,.24,"#ffffff").box(0,0,.41,.31,.008,.12,"#ffffff");
    const m=v.build("swimming-fish-shadow",scene,silhouetteMat);m.receiveShadows=false;return {mesh:m,i};
  });
  const splashMat=new StandardMaterial("sea-spray",scene);splashMat.disableLighting=true;splashMat.emissiveColor=Color3.FromHexString("#dfefe0");splashMat.alpha=.58;
  const jumpers=Array.from({length:5},(_,i)=>{
    const fish=new Voxels().box(0,0,0,.20,.21,.60,"#a2c5bb").box(0,.02,-.27,.20,.17,.20,"#c5ded0").box(0,0,.39,.31,.08,.17,"#729fa2").box(0,.18,.06,.05,.20,.18,"#87a8a4").build("leaping-silver-fish",scene,mat);shadow.addShadowCaster(fish);
    const ring=MeshBuilder.CreateTorus("fish-landing-ripple",{diameter:.8,thickness:.035,tessellation:24},scene);ring.material=splashMat;ring.isPickable=false;
    return {fish,ring,x:34.5+(i%3)*3.8,z:-7+i*9.3,period:11+i*1.7,phase:i*3.9};
  });
  function update(time:number,motion:boolean,solar:SolarState=INITIAL_SUN) {
    const t=motion?time:0;ocean.setFloat("time",t);
    ocean.setVector3("sunDirection",sunDirection.set(solar.toSun.x,solar.toSun.y,solar.toSun.z));
    ocean.setFloat("daylight",solar.daylight);ocean.setFloat("sunStrength",solar.sunlight/1.2);
    splashMat.alpha=.28+.30*solar.daylight;
    ocean.setVector3("cameraPosition",scene.activeCamera?.globalPosition??new Vector3(30,46,-30));
    ocean.setFloat("linearOutput",scene.imageProcessingConfiguration.applyByPostProcess?1:0);ocean.setFloat("exposureLinear",scene.imageProcessingConfiguration.exposure);ocean.setFloat("contrast",scene.imageProcessingConfiguration.contrast);
    for(const g of gulls){
      const speed=.12,a=t*speed+g.phase,radius=4+g.phase*.18;
      g.root.position.set(36+Math.cos(a)*radius,5.8+Math.sin(a*2)*.6,-24+g.phase*5+Math.sin(a)*6);
      faceTravel(g.root,-Math.sin(a)*radius*speed,Math.cos(a*2)*1.2*speed,Math.cos(a)*6*speed);
      g.root.rotation.z=Math.sin(a)*.12;
      for(let j=0;j<2;j++)g.wings[j].rotation.z=(j?1:-1)*(Math.sin(t*3.4+g.phase)*.48+.06);
    }
    for(const f of fishShadows){
      const a=t*(.16+(f.i%3)*.02)+f.i*2.39,x=36+(f.i%3)*2.4+Math.sin(a)*2.1,z=-32+f.i*3.8+Math.cos(a*.7)*2.5;
      f.mesh.position.set(x,seaHeight(x,z,t)+.025,z);faceTravel(f.mesh,Math.cos(a)*2.1,0,-Math.sin(a*.7)*1.75);
      f.mesh.visibility=(.18+Math.pow(Math.max(0,Math.sin(t*.38+f.i)),2)*.70)*(onDock(x,z)?0:1);
    }
    for(const j of jumpers){
      const p=(t+j.phase)%j.period,leap=p<LEAP_DURATION&&motion,land=p>=LEAP_DURATION&&p<LEAP_DURATION+.85&&motion;
      j.fish.setEnabled(leap);j.ring.setEnabled(land);
      if(leap){
        const f=p/LEAP_DURATION,z=j.z-f*LEAP_DISTANCE,vz=-LEAP_DISTANCE/LEAP_DURATION;
        j.fish.position.set(j.x,seaHeight(j.x,z,t)+Math.sin(f*Math.PI)*LEAP_HEIGHT,z);
        // Include the moving wave under the fish without duplicating the wave formula.
        const epsilon=.001,waveRise=(seaHeight(j.x,z+vz*epsilon,t+epsilon)-seaHeight(j.x,z-vz*epsilon,t-epsilon))/(2*epsilon);
        faceTravel(j.fish,0,Math.cos(f*Math.PI)*Math.PI*LEAP_HEIGHT/LEAP_DURATION+waveRise,vz);
      }
      if(land){const f=(p-LEAP_DURATION)/.85;j.ring.position.set(j.x,seaHeight(j.x,j.z-LEAP_DISTANCE,t)+.03,j.z-LEAP_DISTANCE);j.ring.scaling.setAll(.3+f*2.5);j.ring.visibility=1-f;}
    }
  }
  update(0,true);return {update};
}

export function createBoatView(scene:Scene,shadow:ShadowGenerator,boat:BoatModel) {
  const root=new TransformNode("sailable-wooden-skiff",scene),mat=voxelMaterial(scene,"boat-oak");
  const v=new Voxels();
  v.box(0,.14,0,1.05,.23,2.24,"#875e41");v.box(0,.26,0,1.10,.09,2.17,"#c3a06d");
  for(const s of [-1,1]){v.box(s*.63,.37,0,.16,.45,2.45,"#ae7e51");v.box(s*.66,.64,0,.20,.10,2.48,"#d9b885");v.box(s*.43,.39,-1.25,.34,.36,.32,"#b08757");}
  v.box(0,.44,-1.41,.66,.40,.26,"#b98b57");v.box(0,.46,1.19,1.22,.34,.17,"#b88d5b");
  for(const z of [-.66,.69])v.box(0,.55,z,1.14,.13,.34,"#dbb780");
  const hull=v.build("skiff-hull",scene,mat);hull.parent=root;hull.isPickable=true;hull.metadata={tileKind:"decoration"};shadow.addShadowCaster(hull);
  const oars=[-1,1].map(s=>{
    const pivot=new TransformNode("skiff-oar-pivot",scene);pivot.parent=root;pivot.position.set(s*.58,.57,.2);
    const oar=new Voxels().box(s*.32,0,0,1.48,.065,.07,"#d7b383").box(s*1.06,-.03,0,.48,.08,.24,"#b48657").build("skiff-oar",scene,mat);oar.parent=pivot;shadow.addShadowCaster(oar);return pivot;
  });
  const wakeMat=new StandardMaterial("boat-wake",scene);wakeMat.disableLighting=true;wakeMat.emissiveColor=Color3.FromHexString("#d4eee1");wakeMat.alpha=.42;
  const wake=new Voxels().box(-.63,.015,1.80,.07,.02,1.75,"#ffffff").box(.63,.015,1.80,.07,.02,1.75,"#ffffff").build("skiff-wake",scene,wakeMat);wake.parent=root;wake.receiveShadows=false;
  function update(time:number,motion:boolean){
    const t=motion?time:0,p=boat.position;root.position.set(p.x,seaHeight(p.x,p.z,t),p.z);
    root.rotation.y=boat.yaw;root.rotation.x=motion?(seaHeight(p.x,p.z-.8,t)-seaHeight(p.x,p.z+.8,t))*.24:0;root.rotation.z=motion?Math.sin(t*1.6)*.025:0;
    for(let i=0;i<oars.length;i++){const s=i?1:-1;oars[i].rotation.y=boat.moving?Math.sin(time*5)*.50*s:.12*s;oars[i].rotation.z=boat.moving?Math.cos(time*5)*.12*s:.16*s;}
    wake.setEnabled(boat.aboard&&boat.moving&&motion);wake.scaling.z=1+Math.sin(t*8)*.12;
  }
  update(0,true);return {root,update};
}
