import { Color3,Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SolidParticleSystem } from "@babylonjs/core/Particles/solidParticleSystem";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Voxels,voxelMaterial,seededRandom } from "./voxel";
import { tileKey,type TileSeed } from "./farming";
import { createCherryBlossoms } from "./cherryBlossoms";
import { createRiverFish } from "./riverFish";
import { INITIAL_SUN,type SolarState } from "./dayNight";
import "@babylonjs/core/Shaders/ShadersInclude/helperFunctions";
import "@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions";

const vertexSource=`precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec4 color;
uniform mat4 worldViewProjection; uniform mat4 world;
varying vec3 vWorld; varying vec3 vNormal; varying vec4 vColor;
void main(){vWorld=(world*vec4(position,1.0)).xyz;vNormal=normal;vColor=color;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource=`precision highp float;
#include<helperFunctions>
uniform float time; uniform float linearOutput; uniform float exposureLinear; uniform float contrast;
uniform vec3 cameraPosition; uniform vec3 sunDirection;
uniform float daylight; uniform float sunStrength;
varying vec3 vWorld; varying vec3 vNormal; varying vec4 vColor;
#include<imageProcessingFunctions>
void main(){
  float flow=vWorld.z+time*0.52;
  float lanes=sin(vWorld.x*8.0+sin(flow*0.65)*1.2);
  float softWave=sin(flow*4.4+lanes)*0.5+0.5;
  float glimmer=pow(max(0.0,sin(flow*11.0+sin(vWorld.x*13.0)*1.8)),22.0);
  float broken=smoothstep(0.1,0.8,sin(vWorld.x*19.0+flow*0.4));
  float shore=smoothstep(0.55,2.0,abs(vWorld.x-(9.0+sin(vWorld.z*0.29)*1.55)));
  vec3 c=mix(vec3(0.24,0.56,0.59),vec3(0.47,0.75,0.66),shore*0.65+softWave*0.15);
  c+=(vColor.rgb-vec3(0.39,0.72,0.70))*0.12;
  float caustic=pow(max(0.0,sin(vWorld.x*7.0+sin(flow*2.0))*cos(flow*5.0+sin(vWorld.x*3.0))),6.0);
  c+=vec3(0.08,0.12,0.075)*caustic;
  vec3 n=normalize(vec3(sin(flow*3.1+vWorld.x)*0.10,1.0,cos(flow*4.2+lanes)*0.30));
  vec3 view=normalize(cameraPosition-vWorld);
  float reflection=pow(max(0.0,dot(n,normalize(sunDirection+view))),48.0);
  float fresnel=pow(1.0-max(0.0,dot(n,view)),4.0);
  c=mix(c,vec3(0.77,0.88,0.87),fresnel*0.55);
  c+=vec3(1.10,1.02,0.79)*reflection*1.80*sunStrength;
  c=mix(c,vec3(0.85,0.95,0.88),glimmer*broken*0.22);
  c*=vNormal.y>0.5?1.0:0.70;
  c*=mix(vec3(.34,.46,.68),vec3(1.0),daylight);
  // StandardMaterial also writes linear color before the shared image-processing pass.
  vec4 linearColor=vec4(toLinearSpace(max(c,vec3(0.0))),1.0);
  gl_FragColor=linearOutput>0.5?linearColor:applyImageProcessing(linearColor);
}`;

export function createAmbience(scene:Scene,water:Mesh,tiles:TileSeed[],riverCenter:(z:number)=>number,isWater:(x:number,z:number)=>boolean) {
  const random=seededRandom(98114);
  const river=new ShaderMaterial("flowing-spring-water",scene,{vertexSource,fragmentSource},{attributes:["position","normal","color"],uniforms:["world","worldViewProjection","time","linearOutput","exposureLinear","contrast","cameraPosition","sunDirection","daylight","sunStrength"],defines:["#define TONEMAPPING 2","#define EXPOSURE","#define CONTRAST"]});
  const sunDirection=Vector3.Zero();water.material=river;river.setFloat("time",0);
  const fallbackEye=new Vector3(30,46,-30);

  // Batched particles keep flowing highlights and tumbling petals inexpensive.
  const foamShape=MeshBuilder.CreateBox("foam-template",{size:1},scene);
  const foam=new SolidParticleSystem("river-current",scene,{updatable:true,isPickable:false,computeBoundingBox:true});
  foam.addShape(foamShape,64);const foamMesh=foam.buildMesh();foamShape.dispose();
  const foamMat=new StandardMaterial("current-highlights",scene);foamMat.disableLighting=true;foamMat.emissiveColor=Color3.FromHexString("#c3e7d9");foamMat.alpha=.68;
  const foamColor=foamMat.emissiveColor.clone();
  foamMesh.material=foamMat;foamMesh.isPickable=false;foamMesh.hasVertexAlpha=true;
  const currents=foam.particles.map((p,i)=>{
    p.scaling.set(.2+random()*.5,.014,.025+random()*.045);p.color=new Color4(1,1,1,.5);
    return {z:i/64*80-40,lane:(random()-.5)*2.6,phase:random()*6.28};
  });
  foam.computeParticleTexture=false;

  const blossoms=createCherryBlossoms(scene);
  const riverFish=createRiverFish(scene);

  const tuftMaterial=voxelMaterial(scene,"wind-grass");
  const grassTiles=tiles.filter(t=>t.kind==="grass"&&(t.x<-10||t.x>11||t.z<-8));
  const tufts=Array.from({length:42},()=>{
    const tile=grassTiles[Math.floor(random()*grassTiles.length)],x=tile.x+.3+random()*.4,z=tile.z+.3+random()*.4;
    const v=new Voxels();
    for(let j=0;j<5;j++)v.box((j-2)*.065,.13+random()*.04,(random()-.5)*.18,.045,.25+random()*.16,.045,j%2?"#7f9f50":"#91ad5d");
    const mesh=v.build("breeze-grass",scene,tuftMaterial);mesh.position.set(x,0,z);
    return {mesh,x,z,key:tileKey(tile.x,tile.z),phase:random()*6.28};
  });
  function update(time:number,motion:boolean,solar:SolarState=INITIAL_SUN) {
    const t=motion?time:0;river.setFloat("time",t);
    river.setVector3("sunDirection",sunDirection.set(solar.toSun.x,solar.toSun.y,solar.toSun.z));
    river.setFloat("daylight",solar.daylight);river.setFloat("sunStrength",solar.sunlight/1.2);
    foamColor.scaleToRef(.32+.68*solar.daylight,foamMat.emissiveColor);
    for(let i=0;i<foam.particles.length;i++) {
      const p=foam.particles[i],f=currents[i];
      const z=(((f.z-t*.56+40)%80+80)%80)-40,x=riverCenter(z)+f.lane;
      p.position.set(x,-.19+Math.sin(t*2+f.phase)*.006,z);
      p.isVisible=isWater(x,z)&&Math.abs(z)>1.4&&Math.abs(z-20)>1.4;
      p.color!.a=.20+(Math.sin(t*1.5+f.phase)+1)*.22;
    }
    foam.setParticles();
    blossoms.update(time,motion);
    riverFish.update(time,motion,solar.daylight);
    river.setVector3("cameraPosition",scene.activeCamera?.globalPosition??fallbackEye);
    river.setFloat("linearOutput",scene.imageProcessingConfiguration.applyByPostProcess?1:0);
    river.setFloat("exposureLinear",scene.imageProcessingConfiguration.exposure);
    river.setFloat("contrast",scene.imageProcessingConfiguration.contrast);
    for(const g of tufts){g.mesh.rotation.z=motion?Math.sin(t*1.8+g.phase+g.x*.3)*.10:0;g.mesh.rotation.x=motion?Math.sin(t*1.2+g.z*.2)*.055:0;}
  }
  update(0,true);
  return {update,clearTile(x:number,z:number){const key=tileKey(x,z);for(const tuft of tufts)if(tuft.key===key)tuft.mesh.setEnabled(false);}};
}
