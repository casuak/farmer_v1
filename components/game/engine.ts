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
import { InventoryModel,ITEMS,inventoryGains,type ItemId,type InventorySnapshot,type InventoryResult } from "./inventory";
import { createPickupView } from "./pickupView";
import { BoatModel,BOAT_SEAT_HEIGHT } from "./boat";
import { createBoatView } from "./ocean";
import { GroundItems,createGroundItemView } from "./droppedItems";
import { regionName,FARM_SPAWN,GARDEN } from "./geography";
import { RenderGuard } from "./renderGuard";
import { DayNightClock,type ClockSnapshot } from "./dayNight";
import { GameAudio } from "./audio";
import { BackgroundMusic } from "./music";
import { createActionEffects } from "./actionEffects";
import { createCombat,type Hittable } from "./combat";
import { createGunfire } from "./gunfire";
import { FishingModel,FISH,FISHING,findFishingSpot,inventoryCatchSlot,type FishingSnapshot } from "./fishing";
import { createFishingView } from "./fishingView";
import { createMiningView } from "./miningView";
import { MINING_SWING_DURATION } from "./miningMotion";
import { ORES,type MiningSnapshot,type OreNode } from "./mining";
import { MiningHold } from "./miningInput";
import { BeachBossModel,PlayerHealth,type BossSnapshot } from "./beachBoss";
import { createBeachBossView } from "./beachBossView";
import { createPlayerHitView } from "./playerHitView";
import { SWORD,SwordSwing } from "./swordMotion";
import { createSwordTrail } from "./swordTrail";
import { DodgeModel,type DodgeSnapshot } from "./dodge";

export type GameSettings={zoom:number;shadows:boolean;motion:boolean;occlusion:boolean;grid:boolean;bloom:boolean;timeScale:number;sound:boolean;volume:number;music:boolean;musicVolume:number};
export type Interaction={kind:"pickup"|"boat"|"shop"|"talk"|"mine";label:string};
export type GameStatus={x:number;z:number;location:string;moving:boolean;running:boolean;aboard:boolean;fps:number;bag:InventorySnapshot;interaction:Interaction|null;clock:ClockSnapshot;bloomAvailable:boolean;fishing:FishingSnapshot;mining:MiningSnapshot;boss:BossSnapshot;dodge:DodgeSnapshot};
export const SPAWN=FARM_SPAWN;
export type GameApi={dispose:()=>void;settings:(s:GameSettings)=>void;pause:(p:boolean)=>void;reset:()=>void;key:(k:string,down:boolean)=>void;toggleRun:()=>void;interact:()=>void;dodge:()=>void;miningPress:()=>boolean;miningRelease:()=>void;selectSlot:(index:number)=>void;moveItem:(from:number,to:number)=>void;dropItem:(index:number)=>void;buyItem:(id:ItemId)=>void;sellItem:(index:number,all:boolean)=>void;buyBackpack:()=>void;setTime:(hour:number)=>void;fishingPress:()=>void;fishingRelease:()=>void;cancelFishing:()=>void;fishingState:()=>FishingSnapshot};

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
  const mining=world.mining,miningView=createMiningView(scene,shadow,mining),miningHold=new MiningHold();
  let hoveredOre:string|null=null;
  const combat=createCombat(scene,shadow,world.canWalk,world.clearReach,world.residents.residents,villagerHurt),actionEffects=createActionEffects(scene);
  avatar.position.set(SPAWN.x,0,SPAWN.z);
  const boss=new BeachBossModel(world.canWalk,world.clearReach),bossView=createBeachBossView(scene,shadow,boss),playerHealth=new PlayerHealth(),dodge=new DodgeModel();
  const playerHitView=createPlayerHitView(scene,avatar,playerHealth);combat.model.setEnemies([boss.enemy]);
  const playerCanWalk=(x:number,z:number)=>world.canWalk(x,z)&&(!boss.blocks(x,z)||Math.hypot(x-boss.position.x,z-boss.position.z)>Math.hypot(avatar.position.x-boss.position.x,avatar.position.z-boss.position.z)+.0001);
  const bag=new InventoryModel(),farm=new FarmModel(world.tiles,world.clearReach,bag),mode=new MovementMode(),boat=new BoatModel(),clock=new DayNightClock();
  const boatView=createBoatView(scene,shadow,boat),groundItems=new GroundItems(),groundView=createGroundItemView(scene,groundItems,world.heightAt);
  const pickupView=createPickupView(scene,camera,canvas,gain=>{
    if(bag.slots[gain.slot]?.id===gain.id)return gain.slot;
    // Inventory may be rearranged while a cosmetic is in flight; follow the real item.
    const slot=bag.slots.findIndex(s=>s?.id===gain.id);return slot<0?null:slot;
  });
  for(const [x,z] of [[14,-7],[19,-12],[12,-24],[27,-19],[28,-28],[20,-34],[26,-3],[29,-15]])if(world.canWalk(x,z))groundItems.add({id:"shell",count:2},{x,z});
  for(const [x,z] of [[-30,10],[-32,14],[-21,12],[-34,32],[-28,23],[-17,25]])if(world.canWalk(x,z))groundItems.add({id:"wood",count:3},{x,z});
  for(const [dx,dz,age] of [[3,7,0],[4,7,12],[3,5,24],[4,5,6]])farm.seedExample(GARDEN.x+dx,GARDEN.z+dz,age);
  const farmView=createFarmView(scene,shadow,world.tiles,world.clearTile);for(const tile of farm.tiles.values())if(tile.tilled)farmView.updateTile(tile);
  const heldTools=createHeldTools(scene,farmer.hand,shadow);heldTools.select(bag.hand);
  const gunfire=createGunfire(scene,heldTools.muzzle),swordSwing=new SwordSwing(),swordTrail=createSwordTrail(scene,heldTools.swordBase,heldTools.swordTip);
  const fishing=new FishingModel(),fishingView=createFishingView(scene,camera,canvas,heldTools.rodTip);
  let fishingSlot:number|null=null,castAim:Point|null=null;
  const fishingInputs=new Set<string>();
  let chargingInput:string|null=null;
  const ringMat=new StandardMaterial("player-ring",scene);ringMat.diffuseColor=Color3.FromHexString("#f6ecd1");ringMat.emissiveColor=Color3.FromHexString("#f6ecd1").scale(.6);ringMat.specularColor=Color3.Black();
  const ring=MeshBuilder.CreateTorus("player-ground-ring",{diameter:.84,thickness:.037,tessellation:32},scene);ring.material=ringMat;ring.isPickable=false;
  const dustMat=new StandardMaterial("footstep-dust",scene);dustMat.diffuseColor=Color3.FromHexString("#dcc593");dustMat.specularColor=Color3.Black();dustMat.alpha=.45;
  const dust=Array.from({length:12},()=>{const m=MeshBuilder.CreateBox("dust",{size:.11},scene);m.material=dustMat;m.isPickable=false;m.setEnabled(false);return {m,life:0};});
  const keys=new Set<string>();let paused=false,disposed=false;
  const audio=new GameAudio(),music=new BackgroundMusic();music.setHidden(document.hidden);
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
  let settings:GameSettings={zoom:140,shadows:true,motion:!window.matchMedia("(prefers-reduced-motion: reduce)").matches,occlusion:true,grid:true,bloom:true,timeScale:1,sound:true,volume:.55,music:true,musicVolume:.22};
  let renderedZoom=settings.zoom;
  let t=0,statusClock=0,stepClock=0,paddleClock=0,dustIndex=0,lastMoving=false,desiredYaw=-.7,movementYaw=-.7;
  let mouse:{x:number;y:number}|null=null,aimPoint:Point|null=null,hovered:{coord:Point;override?:TileKind}|null=null,actionCooldown=0,actionTime=0,hoverClock=0;
  const tracked=new Vector3(SPAWN.x,0,SPAWN.z+1.4),directionToCamera=new Vector3(.5,Math.SQRT1_2,-.5);
  function clearFishingInput(){
    fishingInputs.clear();chargingInput=null;fishing.release();
    // Lost focus / pause is cancellation, never an accidental release-to-cast.
    if(fishing.phase==="charging"){fishing.cancel();castAim=null;fishingView.clear();}
  }
  function cancelSword(){if(swordSwing.active){swordSwing.cancel();swordTrail.clear();actionTime=0;}}
  function cancelMining(){miningHold.clear();if(mining.active){mining.cancel();actionTime=actionCooldown=0;}}
  const clearInput=()=>{keys.clear();mode.release();clearFishingInput();cancelSword();cancelMining();audio.stop();paddleClock=0;};
  function miningState():MiningSnapshot{return {...mining.snapshot(avatar.position,boat.aboard||fishing.active?null:bag.hand,boat.aboard||fishing.active?null:miningHold.targetId??hoveredOre),holding:miningHold.active};}
  function fishingTarget(useFacing=false,power=fishing.snapshot().castPower){
    if((fishing.active&&fishing.phase!=="charging")||bag.hand!=="fishingRod"||boat.aboard||world.roomAt(avatar.position))return null;
    const aim=castAim??(!useFacing&&aimPoint?aimPoint:{x:avatar.position.x-Math.sin(desiredYaw)*FISHING.maxRange,z:avatar.position.z-Math.cos(desiredYaw)*FISHING.maxRange});
    // A fishing line is a point, not a walking body; radius 0 clears the shoreline.
    return findFishingSpot(avatar.position,aim,(x,z)=>world.canWalk(x,z,0),power);
  }
  function fishingState():FishingSnapshot {return {...fishing.snapshot(),canCast:!paused&&!fishing.active&&!!fishingTarget(false,0)};}
  const nearbyItem=()=>{const item=groundItems.nearest(avatar.position);return item&&(boat.aboard||world.clearReach(avatar.position,item.position))?item:null;};
  function interaction():Interaction|null {
    if(fishing.active||dodge.active)return null;
    if(mining.active){const ore=mining.get(mining.swing?.nodeId);return ore&&ore.health>0?{kind:"mine",label:miningHold.active?"连续开采中 · 松开停止":"长按继续开采"}:null;}
    const item=nearbyItem();if(item)return {kind:"pickup",label:`拾取${ITEMS[item.stack.id].name} ×${item.stack.count}`};
    if(boat.aboard)return {kind:"boat",label:boat.landing(world.canWalk)?"靠岸下船":"驶近岸边或码头下船"};
    if(Math.hypot(avatar.position.x-boat.position.x,avatar.position.z-boat.position.z)<2.9)return {kind:"boat",label:"登上小船"};
    const ore=mining.nearest(avatar.position);if(ore)return {kind:"mine",label:`开采${ORES[ore.kind].name} · 剩 ${ore.health} 镐`};
    if(world.roomAt(avatar.position)?.shop)return {kind:"shop",label:"松果杂货店 · 买卖物品"};
    const npc=world.residents.nearest(avatar.position);return npc?{kind:"talk",label:`和${npc.name}聊聊`}:null;
  }
  function publish(){
    const {x,z}=avatar.position;onStatus({x,z,location:boat.aboard?"蔚蓝海域 · 小船":world.roomAt(avatar.position)?.name??regionName(avatar.position),moving:lastMoving,running:mode.running,aboard:boat.aboard,fps:Math.round(engine.getFps()),bag:bag.snapshot(),interaction:interaction(),clock:clock.snapshot(),bloomAvailable:!lighting.compatible,fishing:fishingState(),mining:miningState(),boss:bossState(),dodge:dodge.snapshot()});
    canvas.dataset.playerX=x.toFixed(2);canvas.dataset.playerZ=z.toFixed(2);canvas.dataset.inputMode="tools";canvas.dataset.selectedTool=bag.hand??"none";
    canvas.dataset.movementMode=boat.aboard?"sailing":mode.running?"running":"walking";canvas.dataset.speed=String(mode.running?SPRINT_SPEED:WALK_SPEED);canvas.dataset.gold=String(bag.gold);canvas.dataset.inventorySlots=String(bag.slots.length);
    canvas.dataset.hoveredTile=hovered?`${hovered.coord.x},${hovered.coord.z}`:"";canvas.dataset.cameraElevation="45";canvas.dataset.cameraProjection="orthographic";
    canvas.dataset.gameHour=clock.hour.toFixed(2);canvas.dataset.timeScale=String(settings.timeScale);
    canvas.dataset.bloomEnabled=String(settings.bloom&&!lighting.compatible);
    canvas.dataset.musicPlaying=String(music.isPlaying);canvas.dataset.musicEnabled=String(settings.music);canvas.dataset.musicVolume=String(settings.musicVolume);
    const fishingStatus=fishing.snapshot();
    canvas.dataset.fishingPhase=fishingStatus.phase;canvas.dataset.fishingSlot=fishingSlot===null?"":String(fishingSlot);
    canvas.dataset.fishingPower=fishingStatus.castPower.toFixed(3);
    canvas.dataset.fishingSpot=fishingStatus.spot?`${fishingStatus.spot.x.toFixed(3)},${fishingStatus.spot.z.toFixed(3)}`:"";
    const miningStatus=miningState();canvas.dataset.miningActive=String(miningStatus.active);canvas.dataset.miningTarget=miningStatus.target?.id??"";canvas.dataset.miningHealth=String(miningStatus.target?.health??"");
    canvas.dataset.miningNodes=JSON.stringify(mining.nodes.map(n=>({id:n.id,x:n.x,z:n.z,health:n.health})));
    canvas.dataset.miningHolding=String(miningHold.active);
    canvas.dataset.groundItems=JSON.stringify(groundItems.items.map(item=>{const p=groundView.center(item.id);return {id:item.id,item:item.stack.id,count:item.stack.count,x:item.position.x,z:item.position.z,airborne:!!item.flight,flightTime:item.flight?.elapsed??null,visual:p?{x:p.x,y:p.y,z:p.z}:null};}));
    const screen=canvas.getBoundingClientRect(),bossScreen=Vector3.Project(new Vector3(boss.position.x,1.05,boss.position.z),Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(screen.width,screen.height));canvas.dataset.bossScreen=JSON.stringify({x:bossScreen.x,y:bossScreen.y});
    const bs=bossState();canvas.dataset.bossPhase=boss.phase;canvas.dataset.bossHp=String(boss.hp);canvas.dataset.bossX=boss.position.x.toFixed(3);canvas.dataset.bossZ=boss.position.z.toFixed(3);canvas.dataset.bossVisible=String(bs.visible);canvas.dataset.bossTelegraph=JSON.stringify(boss.telegraph);canvas.dataset.playerHealth=String(playerHealth.hp);
    heldTools.select(boat.aboard||dodge.active?null:bag.hand);farmer.equip(bag.snapshot());statusClock=0;
  }
  const announce=(result:InventoryResult)=>{events.action(result);publish();};
  function bossPlayer(){return {x:avatar.position.x,z:avatar.position.z,aboard:boat.aboard,alive:playerHealth.hp>0};}
  function bossState(){return boss.snapshot(bossPlayer(),playerHealth.hp,playerHealth.maxHp,playerHealth.invulnerability>0||dodge.invulnerable);}
  function finishBossEvents(){
    for(const event of boss.takeEvents()){
      const distance=Math.hypot(avatar.position.x-event.position.x,avatar.position.z-event.position.z);
      const sound={alert:"bossAlert",windup:"bossWindup",charge:"bossCharge",impact:"bossImpact",hurt:"bossHurt",defeat:"bossDefeat",playerHit:"playerHurt",stompWindup:"bossWindup",stomp:"bossImpact",enrage:"bossAlert"} as const;
      if(event.type!=="playerHit"&&distance<20)audio.play(sound[event.type],Math.max(.25,1-distance/25)*.8);
      if(event.type==="alert"&&fishing.active){clearInput();fishing.reset();fishingView.clear();fishingSlot=null;announce({ok:false,message:"潮角犀王发现了你 · 收起钓竿，横向躲开橙色预警！"});}
      if(event.type==="enrage")announce({ok:false,message:"潮角犀王狂怒了！双重冲锋 · 第一冲结束别贪刀，留意第二条预警"});
      if(event.type==="playerHit"&&!dodge.invulnerable&&playerHealth.hurt(event.damage??1)){
        clearInput();dodge.cancel();actionTime=actionCooldown=0;audio.play("playerHurt",.8);
        if(playerHealth.hp===0){
          fishing.reset();fishingView.clear();fishingSlot=null;boat.reset();boss.disengage();playerHealth.reset();
          avatar.position.set(SPAWN.x,0,SPAWN.z);tracked.set(SPAWN.x,0,SPAWN.z+1.4);desiredYaw=movementYaw=-.7;boss.setPlayer(bossPlayer());
          announce({ok:false,message:"被犀王撞晕了 · 已回到农场休息，物品和金币不会丢失"});
        }else{
          const direction=event.direction??{x:1,z:0};moveWithCollisions(avatar.position,direction.x*1.5,direction.z*1.5,world.canWalk);
          announce({ok:false,message:`受到犀王攻击 · 体力 ${playerHealth.hp} / ${playerHealth.maxHp}，方向键＋空格翻滚躲避`});
        }
      }
      if(event.type==="defeat"){
        bag.gold+=100;const before=bag.snapshot().slots,reward={id:"shell",count:6} as const,stored=bag.add([reward]);
        if(stored)pickupView.receive(inventoryGains(before,bag.slots),{...event.position,y:world.heightAt(event.position.x,event.position.z)+.8},settings.motion);
        else groundItems.add(reward,avatar.position);
        announce({ok:true,message:`击败潮角犀王！金币 +100 · 贝壳 ×6${stored?"":"留在脚边，按 E 拾取"}`});
      }
    }
  }
  let lastCry=-10;
  function villagerHurt(v:Hittable){if(t-lastCry<1.2)return;lastCry=t;audio.play("startled",.85);announce({ok:false,message:`${v.name}：${v.cry()}`});}
  function startDodge(){
    if(paused||boat.aboard||playerHealth.hp<=0||fishing.phase==="catching")return;
    const right=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft")),up=Number(keys.has("w")||keys.has("arrowup"))-Number(keys.has("s")||keys.has("arrowdown"));
    if(!dodge.begin(movementVector(right,up,0,null),desiredYaw))return;
    cancelSword();cancelMining();clearFishingInput();
    if(fishing.active){fishing.reset();fishingView.clear();fishingSlot=null;castAim=null;}
    actionTime=0;desiredYaw=dodge.heading;body.rotation.y=desiredYaw;audio.play("dodge",.9);publish();
  }
  const selectSlot=(index:number)=>{if(fishing.active||dodge.active)return;const previous=bag.selected;bag.select(index);if(bag.hand!=="pickaxe")cancelMining();if(bag.hand!=="sword")cancelSword();if(bag.selected!==previous)audio.play("select");hoverClock=.2;publish();};
  const toggleRun=()=>{if(paused||fishing.active)return;mode.toggle();publish();};
  const key=(k:string,down:boolean)=>{k=k.toLowerCase();if(down&&fishing.active)return;if(k==="shift"){if(!paused||!down){mode.shift(down);publish();}return;}if(down&&!paused)keys.add(k);else keys.delete(k);};
  function cancelFishing(){if(paused)return;if(fishing.cancel()){clearInput();castAim=null;fishingView.clear();fishingSlot=null;announce({ok:true,message:"收起钓竿 · 换一处水面再试试"});}}
  function fishingPress(useFacing=false,source="ui"){
    if(paused||dodge.active||mining.active||fishingInputs.has(source))return;
    if(boss.engaged){announce({ok:false,message:"犀王正在追击你 · 先离开冲锋路线，脱战后再钓鱼"});return;}
    fishingInputs.add(source);
    if(fishing.active){const before=fishing.phase;fishing.press();if(before!==fishing.phase){audio.play("reel");publish();}return;}
    if(bag.hand!=="fishingRod")return;
    if(boat.aboard){announce({ok:false,message:"先靠岸下船，再站在河岸或码头甩竿"});return;}
    pickTile();const spot=fishingTarget(useFacing,0);
    if(!spot){announce({ok:false,message:"走近河岸或码头，朝向 6 格内的开阔水面，再按住 F 蓄力甩竿"});return;}
    const pool=spot.kind==="river"?["carp","perch"] as const:["sardine","redSnapper"] as const;
    if(pool.some(id=>inventoryCatchSlot(bag,id)===null)){announce({ok:false,message:"物品栏放不下新的鱼了 · 先腾出一格，再来甩竿"});return;}
    if(fishing.beginCharge()){
      // Freeze the aim, not the mouse position, for the whole charge/release gesture.
      castAim={x:spot.x,z:spot.z};chargingInput=source;keys.clear();mode.release();
      fishingSlot=null;actionTime=0;lastMoving=false;desiredYaw=Math.atan2(avatar.position.x-spot.x,avatar.position.z-spot.z);body.rotation.y=desiredYaw;publish();
    }
  }
  function fishingRelease(source="ui"){
    if(!fishingInputs.delete(source))return;
    if(source===chargingInput&&fishing.phase==="charging"){
      chargingInput=null;
      if(paused){clearFishingInput();return;}
      const spot=fishingTarget(false,fishing.snapshot().castPower);
      if(spot&&fishing.cast(spot)){castAim=null;fishingInputs.clear();audio.play("cast");publish();}
      else{fishing.cancel();castAim=null;fishingView.clear();announce({ok:false,message:"落点不在开阔水面，收回钓竿"});}
      return;
    }
    if(fishingInputs.size===0)fishing.release();
  }
  function finishCatch(){
    const caught=fishing.takeCatch();if(!caught)return;
    clearFishingInput();
    const slot=inventoryCatchSlot(bag,caught.id);fishingView.clear();
    if(bag.add([{id:caught.id,count:1}])){fishingView.land(slot);audio.play("pickup");announce({ok:true,message:`钓到${FISH[caught.id].name} ×1 · ${caught.length} cm${caught.perfect?" · 完美钓获！":""}`});}
    else{groundItems.add({id:caught.id,count:1},avatar.position);announce({ok:false,message:"物品栏已满 · 鱼留在脚边，按 E 拾取"});}
    fishingSlot=null;
  }
  function startMining(node:OreNode|null){
    if(actionCooldown>0||mining.active)return false;
    if(!node){announce({ok:false,message:"走近森林里带彩色矿脉的岩石 · 按住左键或 F 连续挥镐"});return false;}
    const result=mining.begin(node.id,avatar.position,bag.hand);if(!result.ok){announce(result);return false;}
    hoveredOre=node.id;desiredYaw=Math.atan2(avatar.position.x-node.x,avatar.position.z-node.z);body.rotation.y=desiredYaw;
    actionTime=actionCooldown=MINING_SWING_DURATION;lastMoving=false;audio.play("mineSwing");publish();return true;
  }
  function holdMining(node:OreNode|null,source:string){
    if(paused||dodge.active||fishing.active||boat.aboard)return false;
    if(mining.active){const active=mining.get(mining.swing?.nodeId);if(!active||active.health<=0)return false;miningHold.press(source,active.id);publish();return true;}
    if(!startMining(node))return false;
    miningHold.press(source,node!.id);publish();return true;
  }
  function pressMiningAction(useFacing:boolean,source:string){
    if(bag.hand!=="pickaxe"||paused||fishing.active||boat.aboard)return false;
    if(mining.active)return holdMining(null,source);
    pickTile();const aim=useFacing||!aimPoint?{x:avatar.position.x-Math.sin(desiredYaw)*2,z:avatar.position.z-Math.cos(desiredYaw)*2}:aimPoint;
    return holdMining(mining.target(avatar.position,aim,useFacing?null:hoveredOre),source);
  }
  function pressMiningInteraction(source:string){
    if(paused||dodge.active||fishing.active||boat.aboard)return false;
    if(mining.active)return holdMining(null,source);
    // Existing nearby pickup/boat interactions keep precedence and are never repeated.
    if(nearbyItem()||Math.hypot(avatar.position.x-boat.position.x,avatar.position.z-boat.position.z)<2.9)return false;
    const ore=mining.nearest(avatar.position);if(!ore)return false;
    const slot=bag.slots.findIndex(s=>s?.id==="pickaxe");if(slot<0)return false;
    selectSlot(slot);return holdMining(ore,source);
  }
  function releaseMining(source:string){const active=miningHold.active;miningHold.release(source);if(active)publish();}
  function interact(){
    if(paused||dodge.active||fishing.active||mining.active||actionCooldown>0)return;
    const item=nearbyItem();if(item){
      const origin=groundView.center(item.id)??new Vector3(item.position.x,world.heightAt(item.position.x,item.position.z)+.2,item.position.z);
      const result=groundItems.pickup(item.id,bag);
      if(result.ok){groundView.update(t,settings.motion);pickupView.receive(result.gains,origin,settings.motion);audio.play("pickup");}
      announce(result);return;
    }
    if(boat.aboard){
      const landing=boat.disembark(world.canWalk);if(!landing){announce({ok:false,message:"这里水太深 · 请把船开近海岸或码头"});return;}
      avatar.position.set(landing.x,world.heightAt(landing.x,landing.z),landing.z);audio.play("paddle");announce({ok:true,message:"已经上岸 · 小船会在原处等你"});return;
    }
    if(boat.board(avatar.position)){avatar.position.set(boat.position.x,boat.height(settings.motion?t:0)+BOAT_SEAT_HEIGHT,boat.position.z);clearInput();audio.play("paddle");announce({ok:true,message:"登船了 · WASD 驾船，靠岸后按 E 下船"});return;}
    const ore=mining.nearest(avatar.position);if(ore){
      const slot=bag.slots.findIndex(s=>s?.id==="pickaxe");if(slot<0){announce({ok:false,message:"需要一把矿镐 · 可到松果杂货店购买"});return;}
      selectSlot(slot);startMining(ore);return;
    }
    if(world.roomAt(avatar.position)?.shop){clearInput();paused=true;events.shop();return;}
    const npc=world.residents.nearest(avatar.position);if(npc){announce({ok:true,message:`${npc.name}：${npc.lineNow()}`});return;}
    announce({ok:false,message:"靠近小船、地面物品或镇民时按 E；进入杂货店后可交易"});
  }
  function pickTile(){
    hoveredOre=null;
    if(!mouse||paused||fishing.active){hovered=null;aimPoint=null;farmView.hover(null);events.hover(null);return;}
    const ray=scene.createPickingRay(mouse.x,mouse.y,Matrix.Identity(),camera,false),distance=-ray.origin.y/ray.direction.y;if(distance<0)return;
    const ground=ray.origin.add(ray.direction.scale(distance));
    if(bag.hand==="fishingRod"){
      const water=ray.origin.add(ray.direction.scale((-.2-ray.origin.y)/ray.direction.y));aimPoint={x:water.x,z:water.z};hovered=null;farmView.hover(null);events.hover(null);return;
    }
    const weapon=bag.hand==="pistol"||bag.hand==="sword";
    const aim=weapon?ray.origin.add(ray.direction.scale((.35-ray.origin.y)/ray.direction.y)):ground;aimPoint={x:aim.x,z:aim.z};
    let coord=worldToTile(ground),override:TileKind|undefined;
    const hit=scene.pickWithRay(ray,m=>m.isEnabled()&&m.isVisible&&m.isPickable&&m.visibility>.35&&!!m.metadata);
    if(hit?.hit&&hit.pickedPoint&&hit.pickedMesh){const meta=hit.pickedMesh.metadata as {tileKind?:TileKind;tileCoord?:Point;anchor?:Point;oreId?:string;boss?:boolean};if(meta.boss&&weapon)aimPoint={x:boss.position.x,z:boss.position.z};coord=meta.tileCoord??meta.anchor??worldToTile(hit.pickedPoint);override=meta.tileKind==="decoration"?world.propKind(hit.pickedPoint.x,hit.pickedPoint.z):meta.tileKind;hoveredOre=meta.oreId??null;}
    if(bag.hand==="pickaxe"&&!boat.aboard){
      const ore=mining.target(avatar.position,aimPoint,hoveredOre);hoveredOre=ore?.id??null;hovered=null;farmView.hover(null);events.hover(null);return;
    }
    if(hoveredOre&&!weapon&&!boat.aboard){hovered=null;farmView.hover(null);events.hover(null);return;}
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
    if(paused||dodge.active||mining.active)return;
    if(bag.hand==="fishingRod"||fishing.active){fishingPress(useFacing,useFacing?"keyboard":"pointer");return;}
    if(actionCooldown>0)return;
    if(boat.aboard){announce({ok:false,message:"先靠岸下船，再使用工具或武器"});return;}
    const hand=bag.hand;if(!hand){announce({ok:false,message:"先在物品栏选择农具或武器"});return;}
    pickTile();const aim=aimPoint??{x:avatar.position.x-Math.sin(desiredYaw),z:avatar.position.z-Math.cos(desiredYaw)};
    if(hand==="pickaxe"){
      const miningAim=useFacing?{x:avatar.position.x-Math.sin(desiredYaw)*2,z:avatar.position.z-Math.cos(desiredYaw)*2}:aim;
      startMining(mining.target(avatar.position,miningAim,useFacing?null:hoveredOre));return;
    }
    if(hand==="sword"){
      const swordAim=useFacing?{x:avatar.position.x-Math.sin(desiredYaw),z:avatar.position.z-Math.cos(desiredYaw)}:aim;
      const heading=Math.atan2(avatar.position.x-swordAim.x,avatar.position.z-swordAim.z);
      if(!swordSwing.begin(heading))return;
      swordTrail.clear();desiredYaw=heading;body.rotation.y=heading;
      actionTime=SWORD.duration;actionCooldown=SWORD.cooldown;lastMoving=false;
      farmer.animate(t,0,false,mode.running,false,actionTime,settings.motion,"sword");return;
    }
    if(hand==="pistol"){
      desiredYaw=Math.atan2(avatar.position.x-aim.x,avatar.position.z-aim.z);body.rotation.y=desiredYaw;
      farmer.animate(t,0,lastMoving,mode.running,false,.22,settings.motion,"pistol",{movementYaw});
      heldTools.muzzle.computeWorldMatrix(true);const muzzle=heldTools.muzzle.getAbsolutePosition();
      boss.setPlayer(bossPlayer());
      const result=combat.model.attack(hand,avatar.position,aim,muzzle);if(!result.fired)return;
      desiredYaw=result.heading;body.rotation.y=desiredYaw;actionTime=.22;actionCooldown=.32;
      audio.play(hand);gunfire.fire();if(result.hits)audio.play("slime",.65);return;
    }
    if(hoveredOre){announce({ok:false,message:"这是矿脉 · 按 8 选择矿镐，或靠近后按 E 开采"});return;}
    const tool=hand;
    if(tool==="scythe"){
      desiredYaw=Math.atan2(-(aim.x-avatar.position.x),-(aim.z-avatar.position.z));body.rotation.y=desiredYaw;actionTime=.43;actionCooldown=.48;
      actionEffects.swing(avatar.position,desiredYaw,"scythe");audio.play("scythe");
      const before=bag.snapshot().slots,result=farm.harvestArea(avatar.position,aim);for(const tile of result.tiles)farmView.updateTile(tile);
      if(result.tiles.length){
        farmView.effect(result.tiles[0],"scythe",result.tiles);
        const x=result.tiles.reduce((n,tile)=>n+tile.x+.5,0)/result.tiles.length,z=result.tiles.reduce((n,tile)=>n+tile.z+.5,0)/result.tiles.length;
        pickupView.receive(inventoryGains(before,bag.slots),{x,y:world.heightAt(x,z)+.45,z},settings.motion);
      }
      announce(result);pickTile();return;
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
    if(e.key==="Escape"&&(mining.active||miningHold.active)){e.preventDefault();cancelMining();publish();return;}
    if(e.key==="Escape"&&fishing.active){e.preventDefault();cancelFishing();return;}
    if(e.code==="Space"){
      if(el?.closest?.('button,[role="switch"],[role="radio"],[role="slider"]')&&!el.closest('[data-inventory-slot],.dodge-button,.fishing-hold'))return;
      e.preventDefault();if(!e.repeat)startDodge();return;
    }
    if(e.code==="KeyF"&&bag.hand==="fishingRod"){e.preventDefault();if(!e.repeat)fishingPress(true,"keyboard");return;}
    if(e.code==="KeyF"&&bag.hand==="pickaxe"){e.preventDefault();if(!e.repeat)pressMiningAction(true,"keyboard");return;}
    if(/^[1-9]$/.test(e.key)){e.preventDefault();selectSlot(Number(e.key)-1);return;}
    if(e.key.toLowerCase()==="e"){e.preventDefault();if(!e.repeat&&!pressMiningInteraction("interact-key"))interact();return;}
    if(e.code==="KeyF"){e.preventDefault();if(!e.repeat)performAction(true);return;}
    if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(e.key.toLowerCase())){e.preventDefault();if(e.key!=="Shift"||!e.repeat)key(e.key,true);}
  };
  const keyUp=(e:KeyboardEvent)=>{key(e.key,false);if(e.code==="KeyF"){fishingRelease("keyboard");releaseMining("keyboard");}if(e.key.toLowerCase()==="e")releaseMining("interact-key");},visibility=()=>{music.setHidden(document.hidden);if(document.hidden)clearInput();else renderGuard.watch();};
  window.addEventListener("keydown",keyDown);window.addEventListener("keyup",keyUp);window.addEventListener("blur",clearInput);document.addEventListener("visibilitychange",visibility);
  const unlockAudio=(event:Event)=>{if(event.isTrusted){audio.unlock();music.unlock();}};
  document.addEventListener("pointerdown",unlockAudio,true);document.addEventListener("keydown",unlockAudio,true);
  const movePointer=(e:PointerEvent)=>{const b=canvas.getBoundingClientRect();mouse={x:e.clientX-b.left,y:e.clientY-b.top};};
  const pointer=(e:PointerEvent)=>{
    if(paused||e.button!==0||!e.isPrimary)return;canvas.focus({preventScroll:true});movePointer(e);
    if(bag.hand==="pickaxe"){if(pressMiningAction(false,"pointer:"+e.pointerId))canvas.setPointerCapture(e.pointerId);return;}
    if(bag.hand==="fishingRod")canvas.setPointerCapture(e.pointerId);performAction();
  };
  const pointerUp=(e:PointerEvent)=>{if(e.button===0){fishingRelease("pointer");releaseMining("pointer:"+e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
  const cancelPointer=(e:PointerEvent)=>{
    releaseMining("pointer:"+e.pointerId);
    const charging=chargingInput==="pointer"&&fishing.phase==="charging";
    if(charging){clearFishingInput();publish();}else fishingRelease("pointer");
  };
  window.addEventListener("pointerup",pointerUp);window.addEventListener("pointercancel",cancelPointer);canvas.addEventListener("lostpointercapture",cancelPointer);
  const leavePointer=()=>{mouse=null;aimPoint=null;hovered=null;hoveredOre=null;farmView.hover(null);events.hover(null);};
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
      if(swordSwing.active){
        if(bag.hand!=="sword"||boat.aboard)cancelSword();
        else{
          const event=swordSwing.update(dt);actionTime=swordSwing.remaining;
          if(event.whoosh)audio.play("sword");
          if(event.impact){
            boss.setPlayer(bossPlayer());const heading=swordSwing.heading;
            const result=combat.model.attack("sword",avatar.position,{x:avatar.position.x-Math.sin(heading)*2,z:avatar.position.z-Math.cos(heading)*2});
            if(result.hits)audio.play("slime",.65);
          }
        }
      }
      const priorPhase=fishing.phase;fishing.update(simDt);
      if(priorPhase!==fishing.phase){
        if(fishing.phase==="waiting")audio.play("splash");
        else if(fishing.phase==="bite")audio.play("bite");
        else if(fishing.phase==="catching"){const caught=fishing.snapshot().fish;fishingSlot=caught?inventoryCatchSlot(bag,caught.id):null;audio.play("fishCatch");}
        else if(fishing.phase==="escaped")audio.play("fishEscape");
        publish();
      }
      finishCatch();
      const wasMining=mining.active,impact=mining.update(simDt,avatar.position,bag.hand);
      if(impact){
        if(impact.ok){
          miningView.hit(impact,settings.motion);audio.play(impact.node.kind==="crystal"?"crystalHit":"mineHit");
          if(impact.broken){
            audio.play("mineBreak",.8);
            miningHold.clear();
            groundItems.eject(impact.loot,{x:impact.node.x,y:world.heightAt(impact.node.x,impact.node.z)+.62*impact.node.size,z:impact.node.z},avatar.position,world.canWalk,world.clearReach);
            announce({ok:true,message:`矿脉敲碎 · ${impact.loot.map(stack=>`${ITEMS[stack.id].name} ×${stack.count}`).join(" · ")}弹出落地，靠近按 E 拾取`});
          }else publish();
        }else announce(impact);
      }
      if(impact&&!impact.ok)miningHold.clear();
      if(wasMining&&!mining.active){
        actionTime=actionCooldown=0;
        const next=miningHold.next(mining,avatar.position,bag.hand);
        if(next)startMining(next);else publish();
      }
      if(groundItems.update(simDt)>0)publish();
      const right=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft")),up=Number(keys.has("w")||keys.has("arrowup"))-Number(keys.has("s")||keys.has("arrowdown"));
      const {x:dx,z:dz}=movementVector(fishing.active?0:right,fishing.active?0:up,actionTime,bag.hand),aiming=bag.hand==="pistol"&&!boat.aboard&&(!!mouse||actionTime>0);
      const wasDodging=dodge.active,wasDodgeReady=dodge.cooldown<=0;
      let moved=dodge.update(dt,avatar.position,playerCanWalk);
      if(boat.aboard){moved=boat.move(dx,dz,dt);avatar.position.set(boat.position.x,boat.height(settings.motion?t:0)+BOAT_SEAT_HEIGHT,boat.position.z);desiredYaw=boat.yaw;}
      else{
        const beforeX=avatar.position.x,beforeZ=avatar.position.z;
        if(!wasDodging&&(dx||dz)){const speed=mode.running?SPRINT_SPEED:WALK_SPEED;moved=moveWithCollisions(avatar.position,dx*speed*dt,dz*speed*dt,playerCanWalk);if(!aiming)desiredYaw=Math.atan2(-dx,-dz);}
        if(moved)movementYaw=Math.atan2(beforeX-avatar.position.x,beforeZ-avatar.position.z);
        avatar.position.y=world.heightAt(avatar.position.x,avatar.position.z);
        if(aiming&&mouse&&!wasDodging){
          // Cheap plane intersection every frame: aiming cannot lag behind the tile hover timer.
          const ray=scene.createPickingRay(mouse.x,mouse.y,Matrix.Identity(),camera,false),distance=(.35-ray.origin.y)/ray.direction.y;
          if(distance>=0){const point=ray.origin.add(ray.direction.scale(distance));aimPoint={x:point.x,z:point.z};if(Math.hypot(point.x-avatar.position.x,point.z-avatar.position.z)>.05)desiredYaw=Math.atan2(avatar.position.x-point.x,avatar.position.z-point.z);}
        }
      }
      body.rotation.y+=Math.atan2(Math.sin(desiredYaw-body.rotation.y),Math.cos(desiredYaw-body.rotation.y))*(1-Math.exp(-14*dt));
      const footfall=farmer.animate(t,dt,moved&&!wasDodging,mode.running,boat.aboard,actionTime,settings.motion,dodge.active?null:bag.hand,aiming&&!wasDodging?{movementYaw}:null);
      if(dodge.active){heldTools.select(null);farmer.rollPose(dodge.progress,dodge.heading,settings.motion);}
      if(wasDodging&&!dodge.active){body.rotation.y=dodge.heading;heldTools.select(bag.hand);publish();}
      if(!wasDodgeReady&&dodge.cooldown<=0)publish();
      if(fishing.active)farmer.fishPose(fishing.phase,fishing.snapshot().phaseTime,settings.motion);
      if(footfall){const tile=farm.get(Math.floor(avatar.position.x),Math.floor(avatar.position.z));audio.step(tile?.tilled?"dirt":tile?.kind??"grass",mode.running);}
      if(moved&&boat.aboard){paddleClock+=dt;if(paddleClock>Math.PI/5){paddleClock%=Math.PI/5;audio.play("paddle",.75);}}else paddleClock=0;
      if(moved&&!boat.aboard&&settings.motion){stepClock+=dt;if(stepClock>(mode.running?.09:.20)){stepClock=0;const p=dust[dustIndex++%dust.length];p.life=.4;p.m.setEnabled(true);p.m.position.set(avatar.position.x,avatar.position.y+.05,avatar.position.z);}}
      for(const p of dust)if(p.life>0){p.life-=dt;p.m.position.y+=dt*.3;p.m.scaling.setAll(.5+(1-p.life/.4)*1.5);p.m.visibility=Math.max(0,p.life/.4);if(p.life<=0)p.m.setEnabled(false);}
      lastMoving=moved;
    }
    ringMat.emissiveColor=Color3.FromHexString(dodge.invulnerable?"#9ef5ed":"#f6ecd1").scale(dodge.invulnerable?.85:.6);
    canvas.dataset.dodgeActive=String(dodge.active);canvas.dataset.dodgeCooldown=dodge.cooldown.toFixed(3);canvas.dataset.dodgeProgress=dodge.progress.toFixed(3);canvas.dataset.dodgeInvulnerable=String(dodge.invulnerable);canvas.dataset.dodgeCount=String(dodge.rolls);
    canvas.dataset.bossEnraged=String(boss.enraged);canvas.dataset.bossCombo=String(boss.comboIndex);canvas.dataset.bossStomp=JSON.stringify(boss.stomp);
    ring.setEnabled(!boat.aboard);ring.position.set(avatar.position.x,avatar.position.y+.032,avatar.position.z);
    tracked.x+=(avatar.position.x-tracked.x)*(1-Math.exp(-3.8*dt));tracked.z+=(avatar.position.z+1.4-tracked.z)*(1-Math.exp(-3.8*dt));camera.setTarget(tracked);
    const solar=lighting.update(clock.hour,tracked);
    world.update(t,settings.motion,boat.aboard?undefined:avatar.position,settings.shadows,paused?0:dt,solar,tracked);boatView.update(t,settings.motion);groundView.update(t,settings.motion);
    const bossPhase=boss.phase;
    playerHealth.update(paused?0:simDt,boss.engaged);boss.update(paused?0:dt,bossPlayer());
    if(combat.update(paused?0:simDt,settings.motion)>0)audio.play("slime",.65);
    if(!paused){finishBossEvents();if(boss.phase!==bossPhase)publish();}
    bossView.update(t,paused?0:simDt,settings.motion,settings.shadows);playerHitView.update();
    gunfire.update(paused?0:simDt,settings.motion);
    actionEffects.update(paused?0:simDt,settings.motion);
    swordTrail.update(swordSwing.active?swordSwing.elapsed:null,paused?0:dt,settings.motion);
    canvas.dataset.swordPhase=swordSwing.active?swordSwing.elapsed<SWORD.windup?"windup":swordSwing.elapsed<SWORD.cutEnd?"cut":"recover":"idle";
    canvas.dataset.swordTime=swordSwing.elapsed.toFixed(3);
    if(bag.hand==="sword"){
      heldTools.swordBase.computeWorldMatrix(true);heldTools.swordTip.computeWorldMatrix(true);
      canvas.dataset.swordBlade=JSON.stringify({base:heldTools.swordBase.getAbsolutePosition().asArray(),tip:heldTools.swordTip.getAbsolutePosition().asArray(),torso:farmer.torsoTurn.rotation.y,trail:swordTrail.mesh.isEnabled()});
    }else delete canvas.dataset.swordBlade;
    miningView.update(t,paused?0:simDt,settings.motion,paused?null:miningState().target,heldTools.pickaxeTip);
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
    pickupView.update(paused?0:dt,settings.motion);
    statusClock+=dt;if(statusClock>.2)publish();scene.render();renderGuard.afterFrame(simDt);
  };
  const tick=()=>{
    if(disposed||document.hidden)return;
    try{renderFrame();}
    catch(error){console.error("Pinebrook render failed",error);renderGuard.fail("渲染发生异常，请重新进入农场。");}
  };
  publish();engine.runRenderLoop(tick);
  return {
    settings(s){settings=s;audio.settings(s.sound,s.volume);music.settings(s.music,s.musicVolume);scene.shadowsEnabled=s.shadows;lighting.setBloom(s.bloom);renderGuard.watch();},pause(p){paused=p;clearInput();if(p){lastMoving=false;boat.moving=false;}},key,toggleRun,interact,dodge:startDodge,miningPress:()=>pressMiningInteraction("ui"),miningRelease:()=>releaseMining("ui"),selectSlot,fishingPress:()=>fishingPress(false,"ui"),fishingRelease:()=>fishingRelease("ui"),cancelFishing,fishingState,
    setTime(hour){clock.setHour(hour);renderGuard.watch();publish();},
    moveItem(from,to){if(fishing.active||mining.active||dodge.active)return;const result=bag.move(from,to);if(result.ok)audio.play("select");announce(result);},
    dropItem(index){if(paused||dodge.active||fishing.active||mining.active)return;if(index===14&&bag.backpackOccupied){announce({ok:false,message:"请先清空背包，再卸下或丢弃"});return;}const item=bag.drop(index);if(!item){announce({ok:false,message:"先选择要丢弃的物品"});return;}groundItems.add(item,avatar.position);audio.play("drop");announce({ok:true,message:`放下${ITEMS[item.id].name} ×${item.count} · 按 E 可重新拾取`});},
    buyItem(id){trade(()=>bag.buy(id));},sellItem(index,all){trade(()=>bag.sell(index,all));},buyBackpack(){trade(()=>bag.buyBackpack());},
    reset(){clearInput();dodge.reset();pickupView.clear();playerHealth.reset();boss.disengage();if(fishing.phase==="catching"){fishing.update(FISHING.catchSeconds);finishCatch();}fishing.reset();fishingView.clear();fishingSlot=null;boat.reset();avatar.position.set(SPAWN.x,0,SPAWN.z);desiredYaw=movementYaw=-.7;tracked.set(SPAWN.x,0,SPAWN.z+1.4);publish();},
    dispose(){disposed=true;renderGuard.dispose();clearInput();fishing.reset();fishingView.dispose();pickupView.dispose();window.removeEventListener("pointerup",pointerUp);window.removeEventListener("pointercancel",cancelPointer);canvas.removeEventListener("lostpointercapture",cancelPointer);audio.dispose();music.dispose();observer.disconnect();window.removeEventListener("resize",resize);window.removeEventListener("keydown",keyDown);window.removeEventListener("keyup",keyUp);window.removeEventListener("blur",clearInput);document.removeEventListener("visibilitychange",visibility);document.removeEventListener("pointerdown",unlockAudio,true);document.removeEventListener("keydown",unlockAudio,true);canvas.removeEventListener("pointerdown",pointer);canvas.removeEventListener("pointermove",movePointer);canvas.removeEventListener("pointerleave",leavePointer);canvas.removeEventListener("webglcontextlost",contextLost);engine.stopRenderLoop(tick);scene.dispose();engine.dispose();},
  };
}
