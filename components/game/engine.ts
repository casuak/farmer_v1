import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3,Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import { buildWorld } from "./world";
import { FarmModel,worldToTile,sweepTiles,type TileInfo,type TileKind,type Point } from "./farming";
import { createFarmView,createHeldTools } from "./farmView";
import { WALK_SPEED,SPRINT_SPEED,MovementMode,moveWithCollisions,movementVector } from "./movement";
import { createSpringLighting } from "./lighting";
import { createFarmer } from "./character";
import { InventoryModel,ITEMS,type ItemId,type InventorySnapshot,type InventoryResult } from "./inventory";
import { BoatModel,BOAT_SEAT_HEIGHT } from "./boat";
import { createBoatView } from "./ocean";
import { GroundItems,createGroundItemView } from "./droppedItems";
import { regionName,FARM_SPAWN,GARDEN } from "./geography";
import { RenderGuard } from "./renderGuard";
import { DayNightClock,type ClockSnapshot } from "./dayNight";
import { GameAudio } from "./audio";
import { createActionEffects } from "./actionEffects";
import { createCombat,type Hittable } from "./combat";
import { createGunfire } from "./gunfire";
import { FishingModel,FISH,FISHING,findFishingSpot,inventoryCatchSlot,type FishingSnapshot } from "./fishing";
import { createFishingView } from "./fishingView";

export type GameSettings={zoom:number;shadows:boolean;motion:boolean;occlusion:boolean;grid:boolean;bloom:boolean;timeScale:number;sound:boolean;volume:number};
export type Interaction={kind:"pickup"|"boat"|"shop"|"talk";label:string};
export type GameStatus={x:number;z:number;location:string;moving:boolean;running:boolean;aboard:boolean;fps:number;bag:InventorySnapshot;interaction:Interaction|null;clock:ClockSnapshot;bloomAvailable:boolean;fishing:FishingSnapshot};
export const SPAWN=FARM_SPAWN;
export type GameApi={dispose:()=>void;settings:(s:GameSettings)=>void;pause:(p:boolean)=>void;reset:()=>void;key:(k:string,down:boolean)=>void;toggleRun:()=>void;interact:()=>void;selectSlot:(index:number)=>void;moveItem:(from:number,to:number)=>void;dropItem:(index:number)=>void;buyItem:(id:ItemId)=>void;sellItem:(index:number,all:boolean)=>void;buyBackpack:()=>void;setTime:(hour:number)=>void;fishingPress:()=>void;fishingRelease:()=>void;cancelFishing:()=>void;fishingState:()=>FishingSnapshot};

export function createFarmCamera(scene:Scene) {
  const camera=new ArcRotateCamera("fixed-45-orthographic",-Math.PI/4,Math.PI/4,65,new Vector3(SPAWN.x,0,SPAWN.z+1.4),scene);
  camera.mode=Camera.ORTHOGRAPHIC_CAMERA;camera.minZ=.1;camera.maxZ=180;
  camera.lowerBetaLimit=camera.upperBetaLimit=Math.PI/4;camera.lowerAlphaLimit=camera.upperAlphaLimit=-Math.PI/4;
  camera.overrideCloneAlphaBetaRadius=true;camera.inputs.clear();scene.activeCamera=camera;return camera;
}

export function createGame(canvas:HTMLCanvasElement,onReady:()=>void,onStatus:(s:GameStatus)=>void,onError:(s:string)=>void,events:{hover:(info:TileInfo|null)=>void;action:(result:InventoryResult)=>void;shop:()=>void}):GameApi {
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true,powerPreference:"high-performance"},false);
  engine.setHardwareScalingLevel(1/Math.min(window.devicePixelRatio||1,1.6));
  const scene=new Scene(engine);scene.skipPointerMovePicking=true;scene.skipPointerDownPicking=true;scene.skipPointerUpPicking=true;
  const camera=createFarmCamera(scene),lighting=createSpringLighting(scene,camera),shadow=lighting.shadow;
  const world=buildWorld(scene,shadow),farmer=createFarmer(scene,shadow),avatar=farmer.root,body=farmer.body;
  const combat=createCombat(scene,shadow,world.canWalk,world.clearReach,world.residents.residents,villagerHurt),actionEffects=createActionEffects(scene);
  avatar.position.set(SPAWN.x,0,SPAWN.z);
  const bag=new InventoryModel(),farm=new FarmModel(world.tiles,world.clearReach,bag),mode=new MovementMode(),boat=new BoatModel(),clock=new DayNightClock();
  const boatView=createBoatView(scene,shadow,boat),groundItems=new GroundItems(),groundView=createGroundItemView(scene,groundItems,world.heightAt);
  for(const [x,z] of [[14,-7],[19,-12],[12,-24],[27,-19],[28,-28],[20,-34],[26,-3],[29,-15]])if(world.canWalk(x,z))groundItems.add({id:"shell",count:2},{x,z});
  for(const [x,z] of [[-30,10],[-32,14],[-21,12],[-34,32],[-28,23],[-17,25]])if(world.canWalk(x,z))groundItems.add({id:"wood",count:3},{x,z});
  for(const [dx,dz,age] of [[3,7,0],[4,7,12],[3,5,24],[4,5,6]])farm.seedExample(GARDEN.x+dx,GARDEN.z+dz,age);
  const farmView=createFarmView(scene,shadow,world.tiles,world.clearTile);for(const tile of farm.tiles.values())if(tile.tilled)farmView.updateTile(tile);
  const heldTools=createHeldTools(scene,farmer.hand,shadow);heldTools.select(bag.hand);
  const gunfire=createGunfire(scene,heldTools.muzzle);
  const fishing=new FishingModel(),fishingView=createFishingView(scene,camera,canvas,heldTools.rodTip);
  let fishingSlot:number|null=null;
  const ringMat=new StandardMaterial("player-ring",scene);ringMat.diffuseColor=Color3.FromHexString("#f6ecd1");ringMat.emissiveColor=Color3.FromHexString("#f6ecd1").scale(.6);ringMat.specularColor=Color3.Black();
  const ring=MeshBuilder.CreateTorus("player-ground-ring",{diameter:.84,thickness:.037,tessellation:32},scene);ring.material=ringMat;ring.isPickable=false;
  const dustMat=new StandardMaterial("footstep-dust",scene);dustMat.diffuseColor=Color3.FromHexString("#dcc593");dustMat.specularColor=Color3.Black();dustMat.alpha=.45;
  const dust=Array.from({length:12},()=>{const m=MeshBuilder.CreateBox("dust",{size:.11},scene);m.material=dustMat;m.isPickable=false;m.setEnabled(false);return {m,life:0};});
  const keys=new Set<string>();let paused=false,disposed=false;
  const audio=new GameAudio();
  const renderGuard=new RenderGuard({
    isReady:()=>scene.isReady()&&camera.isReady(true),
    readFrame:()=>{
      const width=engine.getRenderWidth(true),height=engine.getRenderHeight(true);
      // Issue all reads synchronously in this frame; await only their results.
      return Promise.all([.2,.5,.8].flatMap(y=>[.2,.5,.8].map(x=>engine.readPixels(Math.floor((width-1)*x),Math.floor((height-1)*y),1,1).then(p=>new Uint8Array(p.buffer,p.byteOffset,p.byteLength)))));
    },
    recover:()=>{
      const recovered=lighting.recover();
      if(recovered){canvas.dataset.renderMode="compatible";console.warn("Pinebrook: switched to direct rendering after an invalid frame.");}
      return recovered;
    },
    onReady:()=>{canvas.dataset.renderStatus="ready";onReady();},
    onError:reason=>{clearInput();paused=true;engine.stopRenderLoop();canvas.dataset.renderStatus="error";onError(reason);},
  });
  canvas.dataset.renderMode="standard";canvas.dataset.renderStatus="loading";
  let settings:GameSettings={zoom:140,shadows:true,motion:!window.matchMedia("(prefers-reduced-motion: reduce)").matches,occlusion:true,grid:true,bloom:true,timeScale:1,sound:true,volume:.55};
  let renderedZoom=settings.zoom;
  let t=0,statusClock=0,stepClock=0,paddleClock=0,dustIndex=0,lastMoving=false,desiredYaw=-.7,movementYaw=-.7;
  let mouse:{x:number;y:number}|null=null,aimPoint:Point|null=null,hovered:{coord:Point;override?:TileKind}|null=null,actionCooldown=0,actionTime=0,hoverClock=0;
  const tracked=new Vector3(SPAWN.x,0,SPAWN.z+1.4),directionToCamera=new Vector3(.5,Math.SQRT1_2,-.5);
  const clearInput=()=>{keys.clear();mode.release();fishing.release();audio.stop();paddleClock=0;};
  function fishingTarget(useFacing=false){
    if(fishing.active||bag.hand!=="fishingRod"||boat.aboard||world.roomAt(avatar.position))return null;
    const aim=!useFacing&&aimPoint?aimPoint:{x:avatar.position.x-Math.sin(desiredYaw)*5.6,z:avatar.position.z-Math.cos(desiredYaw)*5.6};
    // A fishing line is a point, not a walking body: a radius would falsely
    // collide with the water from the final dry sample at some bank offsets.
    return findFishingSpot(avatar.position,aim,(x,z)=>world.canWalk(x,z,0));
  }
  function fishingState():FishingSnapshot {return {...fishing.snapshot(),canCast:!paused&&!fishing.active&&!!fishingTarget()};}
  const nearbyItem=()=>{const item=groundItems.nearest(avatar.position);return item&&(boat.aboard||world.clearReach(avatar.position,item.position))?item:null;};
  function interaction():Interaction|null {
    if(fishing.active)return null;
    const item=nearbyItem();if(item)return {kind:"pickup",label:`拾取${ITEMS[item.stack.id].name} ×${item.stack.count}`};
    if(boat.aboard)return {kind:"boat",label:boat.landing(world.canWalk)?"靠岸下船":"驶近岸边或码头下船"};
    if(Math.hypot(avatar.position.x-boat.position.x,avatar.position.z-boat.position.z)<2.9)return {kind:"boat",label:"登上小船"};
    if(world.roomAt(avatar.position)?.shop)return {kind:"shop",label:"松果杂货店 · 买卖物品"};
    const npc=world.residents.nearest(avatar.position);return npc?{kind:"talk",label:`和${npc.name}聊聊`}:null;
  }
  function publish(){
    const {x,z}=avatar.position;onStatus({x,z,location:boat.aboard?"蔚蓝海域 · 小船":world.roomAt(avatar.position)?.name??regionName(avatar.position),moving:lastMoving,running:mode.running,aboard:boat.aboard,fps:Math.round(engine.getFps()),bag:bag.snapshot(),interaction:interaction(),clock:clock.snapshot(),bloomAvailable:!lighting.compatible,fishing:fishingState()});
    canvas.dataset.playerX=x.toFixed(2);canvas.dataset.playerZ=z.toFixed(2);canvas.dataset.inputMode="tools";canvas.dataset.selectedTool=bag.tool??"none";
    canvas.dataset.movementMode=boat.aboard?"sailing":mode.running?"running":"walking";canvas.dataset.speed=String(mode.running?SPRINT_SPEED:WALK_SPEED);canvas.dataset.gold=String(bag.gold);canvas.dataset.inventorySlots=String(bag.slots.length);
    canvas.dataset.hoveredTile=hovered?`${hovered.coord.x},${hovered.coord.z}`:"";canvas.dataset.cameraElevation="45";canvas.dataset.cameraProjection="orthographic";
    canvas.dataset.gameHour=clock.hour.toFixed(2);canvas.dataset.timeScale=String(settings.timeScale);
    canvas.dataset.bloomEnabled=String(settings.bloom&&!lighting.compatible);
    canvas.dataset.fishingPhase=fishing.phase;canvas.dataset.fishingSlot=fishingSlot===null?"":String(fishingSlot);
    heldTools.select(boat.aboard?null:bag.hand);farmer.equip(bag.snapshot());statusClock=0;
  }
  const announce=(result:InventoryResult)=>{events.action(result);publish();};
  let lastCry=-10;
  function villagerHurt(v:Hittable){if(t-lastCry<1.2)return;lastCry=t;audio.play("startled",.85);announce({ok:false,message:`${v.name}：${v.cry()}`});}
  const selectSlot=(index:number)=>{if(fishing.active)return;const previous=bag.selected;bag.select(index);if(bag.selected!==previous)audio.play("select");hoverClock=.2;publish();};
  const toggleRun=()=>{if(paused||fishing.active)return;mode.toggle();publish();};
  const key=(k:string,down:boolean)=>{k=k.toLowerCase();if(down&&fishing.active)return;if(k==="shift"){if(!paused||!down){mode.shift(down);publish();}return;}if(down&&!paused)keys.add(k);else keys.delete(k);};
  function cancelFishing(){if(paused)return;if(fishing.cancel()){clearInput();fishingView.clear();fishingSlot=null;announce({ok:true,message:"收起钓竿 · 换一处水面再试试"});}}
  function fishingPress(useFacing=false){
    if(paused)return;
    if(fishing.active){const before=fishing.phase;fishing.press();if(before!==fishing.phase){audio.play("reel");publish();}return;}
    if(bag.hand!=="fishingRod")return;
    if(boat.aboard){announce({ok:false,message:"先靠岸下船，再站在河岸或码头抛竿"});return;}
    pickTile();const spot=fishingTarget(useFacing);
    if(!spot){announce({ok:false,message:"走近河岸或码头，点击前方 6 格内的开阔水面 · 木桥和陆地不能落钩"});return;}
    const pool=spot.kind==="river"?["carp","perch"] as const:["sardine","redSnapper"] as const;
    if(pool.some(id=>inventoryCatchSlot(bag,id)===null)){announce({ok:false,message:"物品栏放不下新的鱼了 · 先腾出一格，再来抛竿"});return;}
    if(fishing.cast(spot)){clearInput();fishingSlot=null;actionTime=0;lastMoving=false;desiredYaw=Math.atan2(avatar.position.x-spot.x,avatar.position.z-spot.z);body.rotation.y=desiredYaw;audio.play("cast");publish();}
  }
  const fishingRelease=()=>fishing.release();
  function finishCatch(){
    const caught=fishing.takeCatch();if(!caught)return;
    const slot=inventoryCatchSlot(bag,caught.id);fishingView.clear();
    if(bag.add([{id:caught.id,count:1}])){fishingView.land(slot);audio.play("pickup");announce({ok:true,message:`钓到${FISH[caught.id].name} ×1 · ${caught.length} cm${caught.perfect?" · 完美钓获！":""}`});}
    else{groundItems.add({id:caught.id,count:1},avatar.position);announce({ok:false,message:"物品栏已满 · 鱼留在脚边，按 E 拾取"});}
    fishingSlot=null;
  }
  function interact(){
    if(paused||fishing.active)return;
    const item=nearbyItem();if(item){const result=groundItems.pickup(item.id,bag);if(result.ok)audio.play("pickup");announce(result);return;}
    if(boat.aboard){
      const landing=boat.disembark(world.canWalk);if(!landing){announce({ok:false,message:"这里水太深 · 请把船开近海岸或码头"});return;}
      avatar.position.set(landing.x,world.heightAt(landing.x,landing.z),landing.z);audio.play("paddle");announce({ok:true,message:"已经上岸 · 小船会在原处等你"});return;
    }
    if(boat.board(avatar.position)){avatar.position.set(boat.position.x,boat.height(settings.motion?t:0)+BOAT_SEAT_HEIGHT,boat.position.z);clearInput();audio.play("paddle");announce({ok:true,message:"登船了 · WASD 驾船，靠岸后按 E 下船"});return;}
    if(world.roomAt(avatar.position)?.shop){clearInput();paused=true;events.shop();return;}
    const npc=world.residents.nearest(avatar.position);if(npc){announce({ok:true,message:`${npc.name}：${npc.lineNow()}`});return;}
    announce({ok:false,message:"靠近小船、地面物品或镇民时按 E；进入杂货店后可交易"});
  }
  function pickTile(){
    if(!mouse||paused||fishing.active){hovered=null;aimPoint=null;farmView.hover(null);events.hover(null);return;}
    const ray=scene.createPickingRay(mouse.x,mouse.y,Matrix.Identity(),camera,false),distance=-ray.origin.y/ray.direction.y;if(distance<0)return;
    const ground=ray.origin.add(ray.direction.scale(distance));
    if(bag.hand==="fishingRod"){
      const water=ray.origin.add(ray.direction.scale((-.2-ray.origin.y)/ray.direction.y));aimPoint={x:water.x,z:water.z};hovered=null;farmView.hover(null);events.hover(null);return;
    }
    const weapon=bag.hand==="pistol"||bag.hand==="sword";
    const aim=weapon?ray.origin.add(ray.direction.scale((.35-ray.origin.y)/ray.direction.y)):ground;aimPoint={x:aim.x,z:aim.z};
    let coord=worldToTile(ground),override:TileKind|undefined;
    const hit=scene.pickWithRay(ray,m=>m.isPickable&&m.visibility>.35&&!!m.metadata);
    if(hit?.hit&&hit.pickedPoint&&hit.pickedMesh){const meta=hit.pickedMesh.metadata as {tileKind?:TileKind;tileCoord?:Point;anchor?:Point};coord=meta.tileCoord??meta.anchor??worldToTile(hit.pickedPoint);override=meta.tileKind==="decoration"?world.propKind(hit.pickedPoint.x,hit.pickedPoint.z):meta.tileKind;}
    const info=farm.inspect(coord,avatar.position,bag.tool??"hoe",override),target=farm.resolveTarget(aimPoint,avatar.position);
    const targetOverride=target&&target.x===coord.x&&target.z===coord.z?override:undefined;
    hovered=target?{coord:target,override:targetOverride}:null;
    if(bag.tool&&!boat.aboard&&target){
      const targetInfo=farm.inspect(target,avatar.position,bag.tool,targetOverride);
      const area=bag.tool==="scythe"?sweepTiles(avatar.position,aimPoint).map(p=>farm.inspect(p,avatar.position,"scythe")).filter((t):t is TileInfo=>!!t):undefined;
      farmView.hover(targetInfo,area);
      if(info){info.actionable=area?area.some(t=>t.actionable):!!targetInfo?.actionable;info.hint=area?"左键朝鼠标挥扫 · 收获高亮的三格成熟作物":target.x!==coord.x||target.z!==coord.z?`左键操作身边的高亮地块 · ${targetInfo?.hint.replace("左键","")??""}`:targetInfo?.hint??info.hint;}
    }else{
      farmView.hover(null);
      if(info){info.actionable=weapon&&!boat.aboard;info.hint=boat.aboard?"WASD 驾船 · 靠岸按 E 下船":weapon?bag.hand==="pistol"?"左键朝鼠标射击 · 可同时 WASD 移动 / 跑步":"左键朝鼠标挥剑 · 森林中有徘徊的史莱姆":"先在物品栏选择农具或武器";}
    }
    events.hover(info);
  }
  function performAction(useFacing=false){
    if(paused)return;
    if(bag.hand==="fishingRod"||fishing.active){fishingPress(useFacing);return;}
    if(actionCooldown>0)return;
    if(boat.aboard){announce({ok:false,message:"先靠岸下船，再使用工具或武器"});return;}
    const hand=bag.hand;if(!hand){announce({ok:false,message:"先在物品栏选择农具或武器"});return;}
    pickTile();const aim=aimPoint??{x:avatar.position.x-Math.sin(desiredYaw),z:avatar.position.z-Math.cos(desiredYaw)};
    if(hand==="pistol"||hand==="sword"){
      let muzzle:Vector3|undefined;
      if(hand==="pistol"){
        desiredYaw=Math.atan2(avatar.position.x-aim.x,avatar.position.z-aim.z);body.rotation.y=desiredYaw;
        farmer.animate(t,0,lastMoving,mode.running,false,.22,settings.motion,"pistol",{movementYaw});
        heldTools.muzzle.computeWorldMatrix(true);muzzle=heldTools.muzzle.getAbsolutePosition();
      }
      const result=combat.model.attack(hand,avatar.position,aim,muzzle);if(!result.fired)return;
      desiredYaw=result.heading;body.rotation.y=desiredYaw;actionTime=hand==="pistol"?.22:.43;actionCooldown=hand==="pistol"?.32:.48;
      audio.play(hand);if(hand==="sword")actionEffects.swing(avatar.position,desiredYaw,"sword");else gunfire.fire();if(result.hits)audio.play("slime",.65);return;
    }
    const tool=hand;
    if(tool==="scythe"){
      desiredYaw=Math.atan2(-(aim.x-avatar.position.x),-(aim.z-avatar.position.z));body.rotation.y=desiredYaw;actionTime=.43;actionCooldown=.48;
      actionEffects.swing(avatar.position,desiredYaw,"scythe");audio.play("scythe");
      const result=farm.harvestArea(avatar.position,aim);for(const tile of result.tiles)farmView.updateTile(tile);
      if(result.tiles.length)farmView.effect(result.tiles[0],"scythe",result.tiles);announce(result);pickTile();return;
    }
    if(!hovered&&!useFacing){announce({ok:false,message:"请点击身边的地块"});return;}
    const target=hovered??{coord:worldToTile({x:avatar.position.x-Math.sin(desiredYaw),z:avatar.position.z-Math.cos(desiredYaw)})};
    const result=farm.use(tool,target.coord,avatar.position,target.override);announce(result);
    if(result.ok&&result.tile){audio.play(tool);farmView.updateTile(result.tile);farmView.effect(result.tile,tool);actionCooldown=.43;actionTime=.43;const dx=result.tile.x+.5-avatar.position.x,dz=result.tile.z+.5-avatar.position.z;if(Math.hypot(dx,dz)>.15)desiredYaw=Math.atan2(-dx,-dz);}
    pickTile();
  }
  function trade(action:()=>InventoryResult){if(boat.aboard||!world.roomAt(avatar.position)?.shop){announce({ok:false,message:"请先进入小镇的松果杂货店"});return;}const result=action();if(result.ok)audio.play("coin");announce(result);}
  const projectCamera=()=>{const aspect=engine.getRenderWidth()/Math.max(1,engine.getRenderHeight()),halfHeight=(aspect<.85?13:15.8)*100/renderedZoom;camera.orthoTop=halfHeight;camera.orthoBottom=-halfHeight;camera.orthoLeft=-halfHeight*aspect;camera.orthoRight=halfHeight*aspect;};
  const resize=()=>{engine.resize();projectCamera();renderGuard.watch();};
  resize();window.addEventListener("resize",resize);const observer=new ResizeObserver(resize);observer.observe(canvas);
  const keyDown=(e:KeyboardEvent)=>{
    if(paused||e.ctrlKey||e.metaKey||e.altKey)return;const el=e.target as HTMLElement;
    if(el?.closest?.('input,textarea,[role="dialog"],[contenteditable="true"]'))return;
    if(e.key.startsWith("Arrow")&&el?.closest?.('[role="radiogroup"],[role="slider"],[data-inventory-slot]'))return;
    if(e.key==="Escape"&&fishing.active){e.preventDefault();cancelFishing();return;}
    if(e.code==="Space"&&bag.hand==="fishingRod"&&(!el?.closest?.('button,[role="switch"],[role="radio"]')||!!el?.closest?.('[data-inventory-slot]'))){e.preventDefault();if(!e.repeat)fishingPress(true);return;}
    if(e.code==="Space"&&el?.closest?.('button,[role="switch"],[role="radio"]'))return;
    if(/^[1-9]$/.test(e.key)){e.preventDefault();selectSlot(Number(e.key)-1);return;}
    if(e.key.toLowerCase()==="e"){e.preventDefault();if(!e.repeat)interact();return;}
    if(e.code==="Space"){e.preventDefault();if(!e.repeat)performAction(true);return;}
    if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(e.key.toLowerCase())){e.preventDefault();if(e.key!=="Shift"||!e.repeat)key(e.key,true);}
  };
  const keyUp=(e:KeyboardEvent)=>{key(e.key,false);if(e.code==="Space")fishingRelease();},visibility=()=>{if(document.hidden)clearInput();else renderGuard.watch();};
  window.addEventListener("keydown",keyDown);window.addEventListener("keyup",keyUp);window.addEventListener("blur",clearInput);document.addEventListener("visibilitychange",visibility);
  const unlockAudio=(event:Event)=>{if(event.isTrusted)audio.unlock();};
  document.addEventListener("pointerdown",unlockAudio,true);document.addEventListener("keydown",unlockAudio,true);
  const movePointer=(e:PointerEvent)=>{const b=canvas.getBoundingClientRect();mouse={x:e.clientX-b.left,y:e.clientY-b.top};};
  const pointer=(e:PointerEvent)=>{if(paused||e.button!==0)return;canvas.focus({preventScroll:true});movePointer(e);if(bag.hand==="fishingRod")canvas.setPointerCapture(e.pointerId);performAction();};
  const pointerUp=(e:PointerEvent)=>{if(e.button===0){fishingRelease();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
  window.addEventListener("pointerup",pointerUp);window.addEventListener("pointercancel",fishingRelease);canvas.addEventListener("lostpointercapture",fishingRelease);
  const leavePointer=()=>{mouse=null;aimPoint=null;hovered=null;farmView.hover(null);events.hover(null);};
  canvas.addEventListener("pointerdown",pointer);canvas.addEventListener("pointermove",movePointer);canvas.addEventListener("pointerleave",leavePointer);
  const contextLost=()=>{clearInput();renderGuard.dispose();onError("画面连接已中断，请刷新页面重新进入农场。");};canvas.addEventListener("webglcontextlost",contextLost);
  const renderFrame=()=>{
    const simDt=Math.min(engine.getDeltaTime()/1000,.25),dt=Math.min(simDt,.045);
    if(renderedZoom!==settings.zoom){
      renderedZoom+= (settings.zoom-renderedZoom)*(1-Math.exp(-16*dt));
      if(Math.abs(settings.zoom-renderedZoom)<.01)renderedZoom=settings.zoom;
      projectCamera();
    }
    if(!paused){
      clock.update(simDt,settings.timeScale);
      t+=simDt;actionCooldown=Math.max(0,actionCooldown-simDt);actionTime=Math.max(0,actionTime-simDt);for(const tile of farm.update(simDt))farmView.updateTile(tile);
      const priorPhase=fishing.phase;fishing.update(simDt);
      if(priorPhase!==fishing.phase){
        if(fishing.phase==="waiting")audio.play("splash");
        else if(fishing.phase==="bite")audio.play("bite");
        else if(fishing.phase==="catching"){const caught=fishing.snapshot().fish;fishingSlot=caught?inventoryCatchSlot(bag,caught.id):null;audio.play("fishCatch");}
        else if(fishing.phase==="escaped")audio.play("fishEscape");
        publish();
      }
      finishCatch();
      const right=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft")),up=Number(keys.has("w")||keys.has("arrowup"))-Number(keys.has("s")||keys.has("arrowdown"));
      const {x:dx,z:dz}=movementVector(fishing.active?0:right,fishing.active?0:up,actionTime,bag.hand),aiming=bag.hand==="pistol"&&!boat.aboard&&(!!mouse||actionTime>0);
      let moved=false;
      if(boat.aboard){moved=boat.move(dx,dz,dt);avatar.position.set(boat.position.x,boat.height(settings.motion?t:0)+BOAT_SEAT_HEIGHT,boat.position.z);desiredYaw=boat.yaw;}
      else{
        const beforeX=avatar.position.x,beforeZ=avatar.position.z;
        if(dx||dz){const speed=mode.running?SPRINT_SPEED:WALK_SPEED;moved=moveWithCollisions(avatar.position,dx*speed*dt,dz*speed*dt,world.canWalk);if(!aiming)desiredYaw=Math.atan2(-dx,-dz);}
        if(moved)movementYaw=Math.atan2(beforeX-avatar.position.x,beforeZ-avatar.position.z);
        avatar.position.y=world.heightAt(avatar.position.x,avatar.position.z);
        if(aiming&&mouse){
          // Cheap plane intersection every frame: aiming cannot lag behind the tile hover timer.
          const ray=scene.createPickingRay(mouse.x,mouse.y,Matrix.Identity(),camera,false),distance=(.35-ray.origin.y)/ray.direction.y;
          if(distance>=0){const point=ray.origin.add(ray.direction.scale(distance));aimPoint={x:point.x,z:point.z};if(Math.hypot(point.x-avatar.position.x,point.z-avatar.position.z)>.05)desiredYaw=Math.atan2(avatar.position.x-point.x,avatar.position.z-point.z);}
        }
      }
      body.rotation.y+=Math.atan2(Math.sin(desiredYaw-body.rotation.y),Math.cos(desiredYaw-body.rotation.y))*(1-Math.exp(-14*dt));
      const footfall=farmer.animate(t,dt,moved,mode.running,boat.aboard,actionTime,settings.motion,bag.hand,aiming?{movementYaw}:null);
      if(fishing.active)farmer.fishPose(fishing.phase,fishing.snapshot().phaseTime,settings.motion);
      if(footfall){const tile=farm.get(Math.floor(avatar.position.x),Math.floor(avatar.position.z));audio.step(tile?.tilled?"dirt":tile?.kind??"grass",mode.running);}
      if(moved&&boat.aboard){paddleClock+=dt;if(paddleClock>Math.PI/5){paddleClock%=Math.PI/5;audio.play("paddle",.75);}}else paddleClock=0;
      if(moved&&!boat.aboard&&settings.motion){stepClock+=dt;if(stepClock>(mode.running?.09:.20)){stepClock=0;const p=dust[dustIndex++%dust.length];p.life=.4;p.m.setEnabled(true);p.m.position.set(avatar.position.x,avatar.position.y+.05,avatar.position.z);}}
      for(const p of dust)if(p.life>0){p.life-=dt;p.m.position.y+=dt*.3;p.m.scaling.setAll(.5+(1-p.life/.4)*1.5);p.m.visibility=Math.max(0,p.life/.4);if(p.life<=0)p.m.setEnabled(false);}
      lastMoving=moved;
    }
    ring.setEnabled(!boat.aboard);ring.position.set(avatar.position.x,avatar.position.y+.032,avatar.position.z);
    tracked.x+=(avatar.position.x-tracked.x)*(1-Math.exp(-3.8*dt));tracked.z+=(avatar.position.z+1.4-tracked.z)*(1-Math.exp(-3.8*dt));camera.setTarget(tracked);
    const solar=lighting.update(clock.hour,tracked);
    world.update(t,settings.motion,boat.aboard?undefined:avatar.position,settings.shadows,paused?0:dt,solar,tracked);boatView.update(t,settings.motion);groundView.update(t,settings.motion);
    if(combat.update(paused?0:simDt,settings.motion)>0)audio.play("slime",.65);
    gunfire.update(paused?0:simDt,settings.motion);
    actionEffects.update(paused?0:simDt,settings.motion);
    farmView.update(t,paused?0:simDt,settings.motion,avatar.position,settings.grid,!!mouse&&!paused&&!boat.aboard&&!!bag.tool);
    hoverClock+=dt;if(hoverClock>.09){hoverClock=0;pickTile();}
    const room=world.roomAt(avatar.position),sightRay=new Ray(avatar.position.add(new Vector3(0,1.15,0)),directionToCamera,60);
    for(const o of world.occluders){
      const box=o.mesh.getBoundingInfo().boundingBox,blocked=settings.occlusion&&sightRay.intersectsBoxMinMax(box.minimumWorld,box.maximumWorld);
      const opacity=o.room&&room?.id===o.room?(o.insideOpacity??.12):blocked?.19:1;o.mesh.visibility+=(opacity-o.mesh.visibility)*(1-Math.exp(-9*dt));
      if(o.phase!==0){const gust=.018+Math.sin(t*.36)*.009;o.mesh.rotation.z=settings.motion?Math.sin(t+o.phase+o.x*.22)*gust:0;o.mesh.rotation.x=settings.motion?Math.cos(t*.73+o.z*.26)*.01:0;}
    }
    camera.getViewMatrix();scene.updateTransformMatrix();
    fishingView.update(fishing.snapshot(),avatar.position,t,paused?0:simDt,settings.motion,paused?null:fishingTarget(),fishingSlot);
    statusClock+=dt;if(statusClock>.2)publish();scene.render();renderGuard.afterFrame(simDt);
  };
  const tick=()=>{
    if(disposed||document.hidden)return;
    try{renderFrame();}
    catch(error){console.error("Pinebrook render failed",error);renderGuard.fail("渲染发生异常，请重新进入农场。");}
  };
  publish();engine.runRenderLoop(tick);
  return {
    settings(s){settings=s;audio.settings(s.sound,s.volume);scene.shadowsEnabled=s.shadows;lighting.setBloom(s.bloom);renderGuard.watch();},pause(p){paused=p;clearInput();if(p){lastMoving=false;boat.moving=false;}},key,toggleRun,interact,selectSlot,fishingPress:()=>fishingPress(),fishingRelease,cancelFishing,fishingState,
    setTime(hour){clock.setHour(hour);renderGuard.watch();publish();},
    moveItem(from,to){if(fishing.active)return;const result=bag.move(from,to);if(result.ok)audio.play("select");announce(result);},
    dropItem(index){if(paused||fishing.active)return;if(index===14&&bag.backpackOccupied){announce({ok:false,message:"请先清空背包，再卸下或丢弃"});return;}const item=bag.drop(index);if(!item){announce({ok:false,message:"先选择要丢弃的物品"});return;}groundItems.add(item,avatar.position);audio.play("drop");announce({ok:true,message:`放下${ITEMS[item.id].name} ×${item.count} · 按 E 可重新拾取`});},
    buyItem(id){trade(()=>bag.buy(id));},sellItem(index,all){trade(()=>bag.sell(index,all));},buyBackpack(){trade(()=>bag.buyBackpack());},
    reset(){clearInput();if(fishing.phase==="catching"){fishing.update(FISHING.catchSeconds);finishCatch();}fishing.reset();fishingView.clear();fishingSlot=null;boat.reset();avatar.position.set(SPAWN.x,0,SPAWN.z);desiredYaw=movementYaw=-.7;tracked.set(SPAWN.x,0,SPAWN.z+1.4);publish();},
    dispose(){disposed=true;renderGuard.dispose();clearInput();fishing.reset();fishingView.dispose();window.removeEventListener("pointerup",pointerUp);window.removeEventListener("pointercancel",fishingRelease);canvas.removeEventListener("lostpointercapture",fishingRelease);audio.dispose();observer.disconnect();window.removeEventListener("resize",resize);window.removeEventListener("keydown",keyDown);window.removeEventListener("keyup",keyUp);window.removeEventListener("blur",clearInput);document.removeEventListener("visibilitychange",visibility);document.removeEventListener("pointerdown",unlockAudio,true);document.removeEventListener("keydown",unlockAudio,true);canvas.removeEventListener("pointerdown",pointer);canvas.removeEventListener("pointermove",movePointer);canvas.removeEventListener("pointerleave",leavePointer);canvas.removeEventListener("webglcontextlost",contextLost);engine.stopRenderLoop(tick);scene.dispose();engine.dispose();},
  };
}
