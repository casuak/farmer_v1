import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix,Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Point } from "./farming";
import type { FishId } from "./inventory";
import { FISHING,type FishingSnapshot,type FishingSpot } from "./fishing";
import { createFishPixels,FISH_SPRITES } from "./fishSprites";
import { seaHeight } from "./geography";
import { Voxels,voxelMaterial } from "./voxel";

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const u=clamp(n);return u*u*(3-2*u);};
export function catchJumpPosition(spot:Point,player:Point,progress:number,reducedMotion=false){
  const u=clamp(progress),height=reducedMotion?1.25*u:2.75*Math.sin(u*Math.PI*.72);
  return new Vector3(spot.x+(player.x-spot.x)*u*.12,-.34+height,spot.z+(player.z-spot.z)*u*.12);
}
export function catchFlyPosition(from:{x:number;y:number},to:{x:number;y:number},progress:number,reducedMotion=false){
  const u=clamp(progress),ease=u*u*(2-u);
  return {x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease-(reducedMotion?0:Math.sin(u*Math.PI)*62),scale:1-ease*.82,opacity:1-smooth((u-.88)/.12)};
}

/** World-space jump hands its exact projected sprite to a screen-space inventory flight. */
export function createFishingView(scene:Scene,camera:Camera,canvas:HTMLCanvasElement,rodTip:TransformNode){
  const floatMaterial=voxelMaterial(scene,"fishing-float");
  const bobber=new Voxels().box(0,0,0,.15,.15,.15,"#fff2cc").box(0,.09,0,.14,.10,.14,"#de7256").box(0,.19,0,.025,.15,.025,"#fce4a0").build("fishing-bobber",scene,floatMaterial);
  bobber.isPickable=false;bobber.setEnabled(false);
  const points=Array.from({length:19},()=>new Vector3());
  const line=MeshBuilder.CreateLines("fishing-line",{points,updatable:true},scene);line.color=Color3.FromHexString("#fff2c9");line.alpha=.82;line.isPickable=false;line.setEnabled(false);
  const rippleMaterial=new StandardMaterial("fishing-ripple",scene);rippleMaterial.disableLighting=true;rippleMaterial.emissiveColor=Color3.FromHexString("#e6f9db");rippleMaterial.alpha=.65;
  const rings=Array.from({length:3},(_,i)=>{const m=MeshBuilder.CreateTorus("fishing-ripple-"+i,{diameter:1,thickness:.027,tessellation:32},scene);m.material=rippleMaterial;m.isPickable=false;m.setEnabled(false);return m;});
  const target=MeshBuilder.CreateTorus("fishing-cast-target",{diameter:.65,thickness:.045,tessellation:32},scene);target.material=rippleMaterial;target.isPickable=false;target.setEnabled(false);
  const splashMaterial=new StandardMaterial("fishing-splash",scene);splashMaterial.disableLighting=true;splashMaterial.emissiveColor=Color3.FromHexString("#d3f4ee");
  const droplets=Array.from({length:24},(_,i)=>{const m=MeshBuilder.CreateBox("fishing-droplet-"+i,{size:.065},scene);m.material=splashMaterial;m.isPickable=false;m.setEnabled(false);return m;});
  const materials=new Map<FishId,StandardMaterial>();
  for(const id of Object.keys(FISH_SPRITES) as FishId[]){
    const pixels=createFishPixels(id),texture=RawTexture.CreateRGBATexture(pixels.data,pixels.width,pixels.height,scene,false,true,Texture.NEAREST_SAMPLINGMODE);
    texture.name="caught-fish-texture-"+id;texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;
    const material=new StandardMaterial("caught-fish-material-"+id,scene);material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
    material.disableLighting=true;material.emissiveColor=Color3.White();material.specularColor=Color3.Black();material.backFaceCulling=false;material.transparencyMode=StandardMaterial.MATERIAL_ALPHATEST;
    materials.set(id,material);
  }
  const fish=MeshBuilder.CreatePlane("caught-fish-sprite",{width:1.38,height:.92},scene);fish.billboardMode=Mesh.BILLBOARDMODE_ALL;fish.isPickable=false;fish.setEnabled(false);
  const flight=document.createElement("img");flight.className="fishing-catch-flight";flight.alt="";flight.setAttribute("aria-hidden","true");flight.draggable=false;flight.hidden=true;canvas.parentElement?.appendChild(flight);
  // Small world-anchored signals, not an opaque panel over the water.
  const charge=document.createElement("div");charge.className="fishing-charge";charge.hidden=true;
  charge.setAttribute("role","meter");charge.setAttribute("aria-label","甩竿力度，松开F甩出");charge.setAttribute("aria-valuemin","0");charge.setAttribute("aria-valuemax","100");
  const chargeTrack=document.createElement("div");chargeTrack.className="fishing-charge-track";
  const chargeFill=document.createElement("span");chargeFill.className="fishing-charge-fill";
  const chargeNeedle=document.createElement("i");chargeNeedle.className="fishing-charge-needle";
  chargeTrack.appendChild(chargeFill);chargeTrack.appendChild(chargeNeedle);charge.appendChild(chargeTrack);
  const chargeLabel=document.createElement("small");chargeLabel.textContent="松开甩竿";charge.appendChild(chargeLabel);canvas.parentElement?.appendChild(charge);
  const biteSignal=document.createElement("div");biteSignal.className="fishing-water-bite";biteSignal.hidden=true;biteSignal.setAttribute("aria-hidden","true");
  const exclamation=document.createElement("strong");exclamation.textContent="!";biteSignal.appendChild(exclamation);
  const biteKey=document.createElement("small");biteKey.textContent="F / 点击";biteSignal.appendChild(biteKey);canvas.parentElement?.appendChild(biteSignal);
  const announcement=document.createElement("span");announcement.className="sr-only";announcement.setAttribute("role","status");announcement.setAttribute("aria-live","assertive");canvas.parentElement?.appendChild(announcement);
  let lastPhase: FishingSnapshot["phase"]="idle",splashTime=9,splashSpot:Point={x:0,z:0},flightSlot:number|null=null;
  let shining:HTMLElement|null=null,shineTime=0;
  function project(p:Vector3){const b=canvas.getBoundingClientRect();return Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(b.width,b.height));}
  function clear(){bobber.setEnabled(false);line.setEnabled(false);target.setEnabled(false);fish.setEnabled(false);rings.forEach(m=>m.setEnabled(false));droplets.forEach(m=>m.setEnabled(false));flight.hidden=charge.hidden=biteSignal.hidden=true;announcement.textContent="";flightSlot=null;lastPhase="idle";splashTime=9;}
  function land(slot:number|null){if(shining)delete shining.dataset.fishReceived;shining=slot===null?null:canvas.parentElement?.querySelector<HTMLElement>(`[data-inventory-slot="${slot}"]`)??null;if(shining){shining.dataset.fishReceived="true";shineTime=.65;}}
  function update(state:FishingSnapshot,player:Point,time:number,dt:number,motion:boolean,preview:FishingSpot|null,slot:number|null){
    if(shining){shineTime-=dt;if(shineTime<=0){delete shining.dataset.fishReceived;shining=null;}}
    const {phase,spot}=state,charging=phase==="charging",biting=phase==="bite",active=phase!=="idle"&&phase!=="escaped"&&!charging;
    charge.hidden=!charging;
    if(charging){
      const p=project(new Vector3(player.x,2.45,player.z)),b=canvas.getBoundingClientRect(),percent=Math.round(state.castPower*100);
      charge.style.left=`${Math.max(75,Math.min(b.width-75,p.x))}px`;charge.style.top=`${Math.max(10,p.y)}px`;
      chargeFill.style.width=`${state.castPower*100}%`;chargeNeedle.style.left=`${state.castPower*100}%`;
      charge.setAttribute("aria-valuenow",String(percent));charge.dataset.power=state.castPower.toFixed(3);charge.dataset.max=String(state.castPower>.94);
      chargeLabel.textContent=state.castPower>.94?"MAX · 松开甩竿":"松开甩竿";
    }
    biteSignal.hidden=!biting;
    if(biting&&spot){
      const p=project(new Vector3(spot.x,.9,spot.z)),b=canvas.getBoundingClientRect();
      biteSignal.style.left=`${Math.max(34,Math.min(b.width-34,p.x))}px`;biteSignal.style.top=`${Math.max(42,p.y+(motion?Math.sin(state.phaseTime*11)*3:0))}px`;
    }
    target.setEnabled(!!preview&&(phase==="idle"||charging));if(preview)target.position.set(preview.x,preview.kind==="sea"?seaHeight(preview.x,preview.z,motion?time:0)+.06:-.16,preview.z);
    if(phase!==lastPhase){
      if((phase==="waiting"||phase==="bite"||phase==="catching")&&spot){splashTime=0;splashSpot={...spot};}
      if(phase==="catching"){flightSlot=slot;if(state.fish)flight.src=FISH_SPRITES[state.fish.id];}
      announcement.textContent=biting?"咬钩了！水面出现激烈水花和叹号，按F或点击水面提竿。":phase==="escaped"?"鱼溜走了，可以重新蓄力甩竿。":"";
      lastPhase=phase;
    }
    splashTime+=dt;
    droplets.forEach((m,i)=>{
      const alive=biting||(motion&&splashTime<.55);m.setEnabled(alive);if(!alive)return;
      // Staggered, repeating bursts keep the entire bite window visibly turbulent.
      const age=biting?(motion?(state.phaseTime+i*.023)%.52:.15+(i%4)*.07):splashTime,a=i*2.399;
      const r=age*(biting?1.7+i%3*.45:.8+i%3*.3),base=spot?.kind==="sea"?seaHeight(splashSpot.x,splashSpot.z,motion?time:0):-.16;
      m.position.set(splashSpot.x+Math.cos(a)*r,base+age*(biting?3.8+i%4*.23:2.2+i%4*.25)-6*age*age,splashSpot.z+Math.sin(a)*r);
      m.scaling.set(biting?1.25:1,biting?1.8:1,biting?1.25:1);m.visibility=biting?.95-age*.9:1-age/.55;
    });
    const floating=active&&phase!=="catching";bobber.setEnabled(floating);line.setEnabled(floating);fish.setEnabled(phase==="catching"&&state.phaseTime<FISHING.jumpSeconds&&!!state.fish);flight.hidden=true;
    rings.forEach((m,i)=>{m.setEnabled(!!spot&&active&&phase!=="casting");if(!spot)return;const pulse=motion?((time*(biting?3.4:.75)+i/3)%1):(i+.5)/3,scale=.38+pulse*(biting?1.6:.8);m.position.set(spot.x,spot.kind==="sea"?seaHeight(spot.x,spot.z,motion?time:0)+.055:-.155,spot.z);m.scaling.set(scale,biting?2:1,scale);m.visibility=(1-pulse)*(biting?1:.7);});
    if(!spot)return;
    if(floating){
      const waterY=spot.kind==="sea"?seaHeight(spot.x,spot.z,motion?time:0):-.17;
      rodTip.computeWorldMatrix(true);const tip=rodTip.getAbsolutePosition();
      if(phase==="casting"){const u=clamp(state.phaseTime/FISHING.castSeconds);Vector3.LerpToRef(tip,new Vector3(spot.x,waterY,spot.z),u,bobber.position);bobber.position.y+=Math.sin(u*Math.PI)*(motion?1.6:.3);}
      else bobber.position.set(spot.x,waterY+(phase==="bite"?-.06+(motion?Math.sin(state.phaseTime*28)*.12:0):motion?Math.sin(time*3.5)*.035:0),spot.z);
      for(let i=0;i<points.length;i++){const u=i/(points.length-1);Vector3.LerpToRef(tip,bobber.position,u,points[i]);points[i].y-=Math.sin(Math.PI*u)*(phase==="reeling"?.08:.23);}
      MeshBuilder.CreateLines("fishing-line",{points,instance:line},scene);
    }
    if(phase==="catching"&&state.fish){
      fish.material=materials.get(state.fish.id)!;
      fish.position.copyFrom(catchJumpPosition(spot,player,state.phaseTime/FISHING.jumpSeconds,!motion));
      if(state.phaseTime>=FISHING.jumpSeconds){
        const jumpEnd=catchJumpPosition(spot,player,1,!motion),from=project(jumpEnd),top=project(jumpEnd.add(camera.getDirection(Vector3.Up()).scale(.46)));
        const b=canvas.getBoundingClientRect(),slotElement=flightSlot===null?null:canvas.parentElement?.querySelector<HTMLElement>(`[data-inventory-slot="${flightSlot}"]`),rect=slotElement?.getBoundingClientRect();
        const to=rect?{x:rect.left+rect.width/2-b.left,y:rect.top+rect.height/2-b.top}:{x:b.width/2,y:b.height-65};
        const u=clamp((state.phaseTime-FISHING.jumpSeconds)/FISHING.flySeconds),p=catchFlyPosition(from,to,u,!motion),height=Math.max(20,Math.abs(top.y-from.y)*2);
        flight.hidden=false;flight.style.width=`${height*1.5}px`;flight.style.height=`${height}px`;flight.style.left=`${p.x}px`;flight.style.top=`${p.y}px`;
        flight.style.opacity=String(p.opacity);flight.style.transform=`translate(-50%,-50%) scale(${p.scale}) rotate(${motion?-Math.sin(u*Math.PI)*22:0}deg)`;
      }
    }
  }
  return {update,clear,land,fish,bobber,line,target,droplets,charge,biteSignal,dispose(){clear();if(shining)delete shining.dataset.fishReceived;flight.remove();charge.remove();biteSignal.remove();announcement.remove();}};
}
