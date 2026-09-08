import assert from "node:assert/strict";
import { MiningHold } from "../components/game/miningInput";
import { MiningModel,ORES,type MiningImpact } from "../components/game/mining";
import { MINING_SWING_DURATION } from "../components/game/miningMotion";

function rig(kind:"copper"|"iron"|"crystal"="copper"){
  const model=new MiningModel(()=>true,[{id:"ore",x:0,z:0,size:1,kind},{id:"other",x:1,z:2,size:1,kind}]),hold=new MiningHold(),player={x:1,z:0};
  const hits:number[]=[],breaks:number[]=[],receipts:MiningImpact[]=[];let seconds=0;
  const start=(source:string)=>{const node=model.get("ore")!;if(!model.active)assert(model.begin(node.id,player,"pickaxe").ok);hold.press(source,node.id);};
  const tick=(dt:number)=>{seconds+=dt;const event=model.update(dt,player,"pickaxe");if(event?.ok){hits.push(seconds);receipts.push(event);if(event.broken){breaks.push(seconds);hold.clear();}}const next=hold.next(model,player,"pickaxe");if(next)assert(model.begin(next.id,player,"pickaxe").ok);return event;};
  const run=(seconds:number)=>{for(let i=0;i<Math.ceil(seconds/.01);i++)tick(.01);};
  return {model,hold,player,hits,breaks,receipts,start,tick,run};
}
for(const kind of ["copper","iron","crystal"] as const){
  const r=rig(kind);r.start("pointer:1");r.run(6);assert.equal(r.hits.length,ORES[kind].health);assert.equal(r.breaks.length,1);assert(!r.hold.active);assert(!r.model.active);
  const mineral=ORES[kind].loot.find(s=>s.id!=="stone")!,total:Record<string,number>={};
  for(const [index,receipt] of r.receipts.entries()){
    assert.deepEqual(receipt.loot,[{id:mineral.id,count:1},...(index===ORES[kind].health-1?ORES[kind].loot.filter(s=>s.id==="stone"):[])],"Each held hit emits one ore, with stone only on the final hit");
    for(const stack of receipt.loot)total[stack.id]=(total[stack.id]??0)+stack.count;
  }
  assert.deepEqual(total,Object.fromEntries(ORES[kind].loot.map(s=>[s.id,s.count])),"Held mining conserves the total deposit yield");
  for(let i=1;i<r.hits.length;i++)assert(r.hits[i]-r.hits[i-1]>=MINING_SWING_DURATION-.001,"Every held stroke completes the recovery");
  assert.equal(r.model.get("other")!.health,ORES[kind].health,"Holding the button cannot jump to another node or auto-collect loot");
}
{
  const r=rig();r.start("keyboard");r.run(.08);r.hold.release("keyboard");r.run(3);assert.equal(r.hits.length,1,"Tap/release finishes only its already-started swing");assert.equal(r.breaks.length,0);
}
{
  const r=rig("crystal");r.start("keyboard");r.hold.press("interact-key","other");assert.equal(r.hold.targetId,"ore");r.run(.9);r.hold.release("keyboard");assert(r.hold.active);r.run(.5);r.hold.release("interact-key");r.run(3);assert.equal(r.hits.length,2,"Releasing one source does not clear a separate held source");
}
{
  const r=rig();r.start("pointer:4");assert(!r.hold.press("pointer:4","ore"));r.run(.1);r.hold.clear();r.model.cancel();r.run(3);assert.equal(r.hits.length,0,"Pause/blur/Escape clears latch and uncommitted hit");
  assert.equal(r.hold.next(r.model,r.player,"pickaxe"),null,"Returning focus never resumes a stale press");
}
{
  const r=rig();r.start("ui");r.run(.4);r.player.x=6;r.run(3);assert(!r.hold.active);assert.equal(r.hits.length,1,"Moving out of range terminates repeat without teleporting");
  const s=rig();s.start("ui");assert.equal(s.hold.next(s.model,s.player,"sword"),null);assert(!s.hold.active);s.model.update(.1,s.player,"sword");s.run(3);assert.equal(s.hits.length,0);
}
console.log("Mining hold passed: mouse/Space/E/touch sources, 3/4/5 consecutive strokes, same-target lock, full recovery, tap/hold release, no duplicate break, overlapping source release, pause/blur/Escape/tool/range cancellation.");
