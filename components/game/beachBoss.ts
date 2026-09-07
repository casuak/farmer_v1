import type { Point } from "./farming";
import { BOUNDS,isBeach,isWater,onBridge,onDock } from "./geography";
import type { Weapon,EnemyTarget } from "./combat";

export const BOSS={name:"潮角犀王",maxHp:72,home:{x:22,z:-16},bodyRadius:1.65,hitRadius:1.05,noticeRadius:16,aggroRadius:12,leashRadius:20,windupSeconds:.82,chargeSpeed:21,chargeLength:11.4,chargeWidth:3.0,recoverSeconds:.95,walkSpeed:2.6,chaseSpeed:7.2,enrageThreshold:.5,enragedWindup:.66,enragedChargeSpeed:25,comboWindup:.62,comboGap:.26,comboRecover:1.15,stompRadius:3.25,stompWindup:.62,stompRecover:.85,chargeDamage:2,stompDamage:1} as const;
export type BossPhase="idle"|"alert"|"chase"|"windup"|"charge"|"recover"|"stompWindup"|"stomp"|"return"|"defeated";
export type BossTelegraph={start:Point;end:Point;width:number;progress:number};
export type BossPlayer=Point&{aboard?:boolean;alive?:boolean};
export type BossStomp={center:Point;radius:number;progress:number};
export type BossSnapshot={visible:boolean;name:string;hp:number;maxHp:number;phase:BossPhase;telegraphProgress:number;playerHp:number;playerMaxHp:number;playerInvulnerable:boolean;enraged?:boolean;comboIndex?:number};
export type BossEvent={type:"alert"|"windup"|"charge"|"impact"|"hurt"|"defeat"|"playerHit"|"stompWindup"|"stomp"|"enrage";position:Point;damage?:number;direction?:Point};
const point=(p:Point):Point=>({x:p.x,z:p.z});
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
const key=(x:number,z:number)=>`${x},${z}`;
export function onBossBeach(x:number,z:number,r=0){
  if(!Number.isFinite(x+z)||Math.abs(x)+r>BOUNDS.x-.5||Math.abs(z)+r>BOUNDS.z-.5)return false;
  for(const [dx,dz] of [[0,0],[-r,0],[r,0],[0,-r],[0,r],[-r,-r],[-r,r],[r,-r],[r,r]]){
    if(!isBeach(x+dx,z+dz)||isWater(x+dx,z+dz)||onBridge(x+dx,z+dz)||onDock(x+dx,z+dz))return false;
  }
  return true;
}
export function segmentDistance(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/Math.max(.000001,dx*dx+dz*dz)));
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}

class BossWeaponTarget implements EnemyTarget {
  readonly id="beach-rhino";readonly radius=BOSS.hitRadius;
  constructor(private boss:BeachBossModel){}
  get position(){return this.boss.position;}
  get alive(){return this.boss.alive;}
  hurt(damage:number,source:Point,weapon:Weapon){return this.boss.hurt(damage,source,weapon);}
}

/** One player-only encounter. No resident/enemy list is ever supplied to the AI. */
export class BeachBossModel {
  position:Point=point(BOSS.home);yaw=Math.PI/2;hp:number=BOSS.maxHp;
  phase:BossPhase="idle";phaseTime=0;flash=0;gait=0;
  telegraph:BossTelegraph|null=null;stomp:BossStomp|null=null;enraged=false;comboIndex=0;
  private windupDuration:number=BOSS.windupSeconds;private comboRemaining=0;private recoveringCombo=false;private stompCooldown=0;
  private target:BossPlayer|null=null;
  private events:BossEvent[]=[];
  private chargeHit=false;
  private idleGoal:Point=point(BOSS.home);
  private patrolIndex=0;
  private path:Point[]=[];
  private navigationClock=0;
  private pathGoal:Point|null=null;
  private chaseClock=0;
  private stuckClock=0;
  private reposition:Point|null=null;
  private breadcrumbs:Point[]=[point(BOSS.home)];
  private retreat:Point[]=[];
  private nodes=new Map<string,Point>();
  private graph=new Map<string,string[]>();
  readonly enemy:EnemyTarget;
  constructor(private canWalk:(x:number,z:number,r?:number)=>boolean,private clearLine:(a:Point,b:Point)=>boolean){
    if(!this.walkable(this.position.x,this.position.z))throw new Error("Boss home must be an unobstructed beach pocket");
    this.buildNavigation();
    this.enemy=new BossWeaponTarget(this);
  }
  get alive(){return this.hp>0;}
  get engaged(){return this.phase!=="idle"&&this.phase!=="return"&&this.phase!=="defeated";}
  private emit(type:BossEvent["type"],extra:Partial<BossEvent>={}){if(this.events.length<40)this.events.push({type,position:point(this.position),...extra});}
  takeEvents(){return this.events.splice(0);}
  setPlayer(player:BossPlayer){this.target={x:player.x,z:player.z,aboard:player.aboard,alive:player.alive};}
  private validPlayer(p:BossPlayer|null):p is BossPlayer{return !!p&&p.alive!==false&&!p.aboard&&onBossBeach(p.x,p.z);}
  walkable(x:number,z:number){return onBossBeach(x,z,BOSS.bodyRadius+.04)&&this.canWalk(x,z,BOSS.bodyRadius+.04);}
  blocks(x:number,z:number,r=.27){return this.alive&&Math.hypot(x-this.position.x,z-this.position.z)<BOSS.hitRadius+r;}
  private setPhase(phase:BossPhase){
    if(phase==="return")this.retreat=this.breadcrumbs.map(point).reverse();
    this.phase=phase;this.phaseTime=0;this.path=[];this.pathGoal=null;this.navigationClock=0;
    if(phase!=="windup"&&phase!=="charge")this.telegraph=null;
    if(phase!=="stompWindup"&&phase!=="stomp")this.stomp=null;
    if(phase==="return"||phase==="defeated"){this.comboRemaining=0;this.comboIndex=0;this.recoveringCombo=false;}
    if(phase==="alert"||phase==="windup"||phase==="charge"||phase==="stompWindup"||phase==="stomp")this.emit(phase);
    if(phase==="chase"){this.chaseClock=0;this.stuckClock=0;this.reposition=null;}
  }
  /** Every sampled step validates the entire rhino footprint, including shore + props. */
  private travelClear(a:Point,b:Point){
    const length=distance(a,b),steps=Math.max(1,Math.ceil(length/.16));
    for(let i=1;i<=steps;i++){const f=i/steps;if(!this.walkable(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f))return false;}
    return true;
  }
  private buildNavigation(){
    // Static, modest 1-metre beach graph; chase/return follow connected pockets around props.
    for(let x=-BOUNDS.x+1;x<BOUNDS.x;x++)for(let z=-BOUNDS.z+1;z<BOUNDS.z;z++)if(this.walkable(x,z))this.nodes.set(key(x,z),{x,z});
    for(const [id,p] of this.nodes){
      const neighbours:string[]=[];
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){const id2=key(p.x+dx,p.z+dz),n=this.nodes.get(id2);if(n&&this.travelClear(p,n))neighbours.push(id2);}
      this.graph.set(id,neighbours);
    }
  }
  private route(goal:Point){
    this.path=[];this.pathGoal=point(goal);this.navigationClock=.55;
    if(this.travelClear(this.position,goal)){this.path.push(point(goal));return;}
    const starts=[...this.nodes.entries()].filter(([,p])=>distance(p,this.position)<3.2&&this.travelClear(this.position,p)).sort((a,b)=>distance(a[1],this.position)-distance(b[1],this.position));
    if(!starts.length)return;
    // Attach to every visible nearby cell. The single nearest cell may sit in an
    // isolated triangle between a bench and umbrella, despite other exits nearby.
    const queue=starts.map(([id])=>id),parents=new Map<string,string|null>(queue.map(id=>[id,null]));let closest=starts[0][0],best=distance(starts[0][1],goal);
    for(let i=0;i<queue.length;i++){
      const id=queue[i],p=this.nodes.get(id)!,d=distance(p,goal);if(d<best){best=d;closest=id;}if(d<.3){closest=id;break;}
      for(const next of this.graph.get(id)??[])if(!parents.has(next)){parents.set(next,id);queue.push(next);}
    }
    const reversed:Point[]=[];let id:string|null=closest;
    while(id){reversed.push(point(this.nodes.get(id)!));id=parents.get(id)??null;}
    this.path=reversed.reverse();
  }
  private follow(goal:Point,speed:number,dt:number){
    this.navigationClock-=dt;
    if(this.navigationClock<=0||!this.pathGoal||distance(this.pathGoal,goal)>1.4)this.route(goal);
    while(this.path.length&&distance(this.position,this.path[0])<.13)this.path.shift();
    const dest=this.path[0];if(!dest)return false;
    const length=distance(this.position,dest),step=Math.min(length,speed*dt),dx=(dest.x-this.position.x)/Math.max(.001,length),dz=(dest.z-this.position.z)/Math.max(.001,length);
    const next={x:this.position.x+dx*step,z:this.position.z+dz*step};
    if(!this.travelClear(this.position,next)){this.path=[];this.navigationClock=0;return false;}
    this.position.x=next.x;this.position.z=next.z;this.yaw=Math.atan2(-dx,-dz);this.gait+=step*3.2;this.rememberPath();return step>0;
  }
  /** Return along a verified breadcrumb route if a narrow pocket has no grid cell.
   * Shortcut only through fully walkable segments, so history stays small and safe. */
  private rememberPath(){
    if(this.phase==="return")return;
    for(let i=0;i<this.breadcrumbs.length;i++)if(this.travelClear(this.breadcrumbs[i],this.position)){
      this.breadcrumbs.length=i+1;break;
    }
    const last=this.breadcrumbs[this.breadcrumbs.length-1];
    // Keep the exact current endpoint, even for a tiny step around a corner.
    // Distance-based thinning can accidentally cut through a collision corner.
    if(distance(last,this.position)>1e-8)this.breadcrumbs.push(point(this.position));
  }
  private retrace(dt:number){
    while(this.retreat.length&&distance(this.position,this.retreat[0])<.00001)this.retreat.shift();
    const goal=this.retreat[0]??BOSS.home;
    if(!this.travelClear(this.position,goal)){this.follow(BOSS.home,BOSS.walkSpeed,dt);return;}
    const d=distance(this.position,goal),s=Math.min(d,BOSS.walkSpeed*dt),dx=(goal.x-this.position.x)/Math.max(.001,d),dz=(goal.z-this.position.z)/Math.max(.001,d);
    const next={x:this.position.x+dx*s,z:this.position.z+dz*s};
    if(!this.travelClear(this.position,next)){this.follow(BOSS.home,BOSS.walkSpeed,dt);return;}
    this.position.x=next.x;this.position.z=next.z;this.yaw=Math.atan2(-dx,-dz);this.gait+=s*3.2;
  }
  private face(p:Point){if(distance(this.position,p)>.01)this.yaw=Math.atan2(this.position.x-p.x,this.position.z-p.z);}
  private planCharge(p:Point):BossTelegraph|null{
    const length=distance(this.position,p);if(length<.1)return null;
    const dx=(p.x-this.position.x)/length,dz=(p.z-this.position.z)/length,start=point(this.position);let safe=0;
    // The displayed endpoint is clipped at the FIRST impassable beach footprint.
    for(let s=.12;s<=BOSS.chargeLength+.001;s+=.12){if(!this.walkable(start.x+dx*s,start.z+dz*s))break;safe=s;}
    if(safe<.65)return null;
    return {start,end:{x:start.x+dx*safe,z:start.z+dz*safe},width:BOSS.chargeWidth,progress:0};
  }
  private beginCharge(p:Point,combo=false){
    const lane=this.planCharge(p);if(!lane)return false;
    this.face(p);this.windupDuration=combo?BOSS.comboWindup:this.enraged?BOSS.enragedWindup:BOSS.windupSeconds;
    if(!combo){this.comboRemaining=this.enraged?1:0;this.comboIndex=1;}else this.comboIndex++;
    this.setPhase("windup");this.telegraph=lane;return true;
  }
  private finishCharge(){this.recoveringCombo=this.comboRemaining>0;this.setPhase("recover");this.emit("impact");}
  hurt(damage:number,source:Point,weapon:Weapon):number{
    if(weapon!=="pistol"&&weapon!=="sword")return 0;
    if(!this.alive||this.phase==="return"||!Number.isFinite(damage)||damage<=0)return 0;
    // Source is always the player weapon's origin. Both the live player and source
    // must still be on the beach: no offshore sniping, NPC aggro, or cross-biome pulls.
    if(!this.validPlayer(this.target)||!onBossBeach(source.x,source.z)||distance(this.position,this.target)>BOSS.leashRadius||!this.clearLine(source,this.position))return 0;
    const dealt=Math.min(this.hp,damage);this.hp-=dealt;this.flash=.24;
    if(!this.enraged&&this.hp>0&&this.hp<=BOSS.maxHp*BOSS.enrageThreshold){this.enraged=true;this.emit("enrage");}
    this.emit("hurt",{damage:dealt});
    if(this.hp===0){this.setPhase("defeated");this.emit("defeat");}
    else if(this.phase==="idle"){this.face(this.target);this.setPhase("alert");}
    return dealt;
  }
  disengage(){if(this.alive&&this.phase!=="idle"&&this.phase!=="return")this.setPhase("return");}
  snapshot(player:BossPlayer,playerHp=5,playerMaxHp=5,playerInvulnerable=false):BossSnapshot{
    const visible=distance(player,this.position)<=BOSS.noticeRadius&&(this.alive||this.phaseTime<3);
    return {visible,name:BOSS.name,hp:this.hp,maxHp:BOSS.maxHp,phase:this.phase,telegraphProgress:this.telegraph?.progress??this.stomp?.progress??0,playerHp,playerMaxHp,playerInvulnerable,enraged:this.enraged,comboIndex:this.comboIndex};
  }
  update(dt:number,player:BossPlayer){
    this.setPlayer(player);
    if(!Number.isFinite(dt)||dt<=0)return;
    // Small AI steps prevent charge tunnelling and keep .25-s frames deterministic.
    let left=Math.min(dt,.25);while(left>1e-8){const step=Math.min(left,1/60);this.step(step);left-=step;}
  }
  private step(dt:number){
    this.flash=Math.max(0,this.flash-dt);this.stompCooldown=Math.max(0,this.stompCooldown-dt);this.phaseTime+=dt;
    if(!this.alive)return;
    const p=this.target;
    if(this.engaged&&(!this.validPlayer(p)||distance(this.position,p)>BOSS.leashRadius||distance(p,BOSS.home)>24))this.disengage();
    if(this.phase==="idle"){
      if(this.validPlayer(p)&&distance(this.position,p)<BOSS.aggroRadius&&this.clearLine(this.position,p)){this.face(p);this.setPhase("alert");return;}
      if(this.phaseTime>2.6){
        if(distance(this.position,this.idleGoal)<.25){
          const offsets=[[2,0],[0,-3],[-3,0],[0,3]];const o=offsets[this.patrolIndex++%offsets.length];this.idleGoal={x:BOSS.home.x+o[0],z:BOSS.home.z+o[1]};this.phaseTime=0;
        }else this.follow(this.idleGoal,.7,dt);
      }return;
    }
    if(this.phase==="return"){
      if(distance(this.position,BOSS.home)<.25){this.hp=BOSS.maxHp;this.enraged=false;this.stompCooldown=0;this.idleGoal=point(BOSS.home);this.breadcrumbs=[point(BOSS.home)];this.retreat=[];this.setPhase("idle");}
      else this.retrace(dt);return;
    }
    if(!this.validPlayer(p))return;
    if(this.phase==="alert"){this.face(p);if(this.phaseTime>=.6)this.setPhase("chase");return;}
    if(this.phase==="chase"){
      this.chaseClock+=dt;
      const range=distance(this.position,p);
      if(range<2.65&&this.stompCooldown<=0&&this.clearLine(this.position,p)){
        this.comboIndex=0;this.comboRemaining=0;this.face(p);this.setPhase("stompWindup");this.stomp={center:point(this.position),radius:BOSS.stompRadius,progress:0};return;
      }
      if(range<11.1&&this.clearLine(this.position,p)&&this.chaseClock>.16&&this.beginCharge(p))return;
      if(this.reposition&&distance(this.position,this.reposition)<.3)this.reposition=null;
      const moved=this.follow(this.reposition??p,BOSS.chaseSpeed*(this.enraged?1.16:1),dt);this.stuckClock=moved?0:this.stuckClock+dt;
      if(this.stuckClock>.7){
        // If a bench/tree blocks a short frontal charge, circle to a clear launch
        // pocket rather than staring at the player from the obstacle edge forever.
        this.reposition=[...this.nodes.values()].filter(n=>distance(n,p)>2.3&&distance(n,p)<7&&distance(n,this.position)>.9&&distance(n,this.position)<5&&this.travelClear(this.position,n)&&this.clearLine(n,p)).sort((a,b)=>distance(a,this.position)-distance(b,this.position))[0]??null;
        this.pathGoal=null;this.navigationClock=0;this.stuckClock=0;
      }return;
    }
    if(this.phase==="windup"){
      // Frozen aim for the WHOLE tell: it never turns onto a player who dodged.
      if(!this.telegraph){this.setPhase("recover");return;}
      this.telegraph.progress=Math.min(1,this.phaseTime/this.windupDuration);
      if(this.phaseTime>=this.windupDuration){this.chargeHit=false;this.setPhase("charge");}
      return;
    }
    if(this.phase==="charge"){
      const lane=this.telegraph;if(!lane){this.setPhase("recover");return;}
      const remaining=distance(this.position,lane.end),total=distance(lane.start,lane.end),dx=(lane.end.x-lane.start.x)/Math.max(.001,total),dz=(lane.end.z-lane.start.z)/Math.max(.001,total),s=Math.min(remaining,(this.enraged?BOSS.enragedChargeSpeed:BOSS.chargeSpeed)*dt),from=point(this.position),next={x:from.x+dx*s,z:from.z+dz*s};
      if(!this.travelClear(from,next)){this.comboRemaining=0;this.finishCharge();return;}
      this.position.x=next.x;this.position.z=next.z;this.gait+=s*3.6;this.rememberPath();
      if(!this.chargeHit&&segmentDistance(p,from,next)<=lane.width/2){this.chargeHit=true;this.emit("playerHit",{damage:BOSS.chargeDamage,direction:{x:dx,z:dz}});}
      if(remaining<=s+.01)this.finishCharge();return;
    }
    if(this.phase==="stompWindup"){
      if(!this.stomp){this.setPhase("chase");return;}
      this.stomp.progress=Math.min(1,this.phaseTime/BOSS.stompWindup);
      if(this.phaseTime>=BOSS.stompWindup){
        const area=this.stomp;this.setPhase("stomp");this.stompCooldown=this.enraged?2.8:3.8;
        if(distance(p,area.center)<=area.radius&&this.clearLine(area.center,p)){
          const d=Math.max(.001,distance(p,area.center));this.emit("playerHit",{damage:BOSS.stompDamage,direction:{x:(p.x-area.center.x)/d,z:(p.z-area.center.z)/d}});
        }
      }return;
    }
    if(this.phase==="stomp"){if(this.phaseTime>=BOSS.stompRecover)this.setPhase("chase");return;}
    if(this.phase==="recover"){
      if(this.recoveringCombo&&this.phaseTime>=BOSS.comboGap){
        this.recoveringCombo=false;this.comboRemaining=0;
        if(this.beginCharge(p,true))return;
      }
      if(this.phaseTime>=(this.comboIndex>1?BOSS.comboRecover:BOSS.recoverSeconds))this.setPhase("chase");
    }
  }
}

export type PlayerHealthSnapshot={hp:number;maxHp:number;invulnerable:boolean};
/** Encounter-only player life: short i-frames, recover outside battle, no lost inventory. */
export class PlayerHealth {
  hp=5;readonly maxHp=5;invulnerability=0;flash=0;private healClock=0;
  hurt(damage=1){if(this.invulnerability>0||this.hp===0||!Number.isFinite(damage)||damage<=0)return false;this.hp=Math.max(0,this.hp-damage);this.invulnerability=1.2;this.flash=.32;this.healClock=0;return true;}
  update(dt:number,inCombat:boolean){if(!Number.isFinite(dt)||dt<=0)return;this.invulnerability=Math.max(0,this.invulnerability-dt);this.flash=Math.max(0,this.flash-dt);if(inCombat)this.healClock=0;else if(this.hp>0&&this.hp<this.maxHp){this.healClock+=dt;if(this.healClock>=3){this.healClock-=3;this.hp++;}}}
  reset(){this.hp=this.maxHp;this.invulnerability=2;this.flash=0;this.healClock=0;}
  snapshot():PlayerHealthSnapshot{return {hp:this.hp,maxHp:this.maxHp,invulnerable:this.invulnerability>0};}
}
