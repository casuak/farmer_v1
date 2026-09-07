import type { Point } from "./farming";
import type { HandItem } from "./inventory";
import type { MiningModel,OreNode } from "./mining";

/** A held gesture stays on its original deposit; it never becomes auto-pickup or attacks another target. */
export class MiningHold{
  private sources=new Set<string>();
  targetId:string|null=null;
  get active(){return this.sources.size>0;}
  press(source:string,targetId:string){
    if(this.sources.has(source))return false;
    if(!this.active)this.targetId=targetId;
    this.sources.add(source);return true;
  }
  release(source:string){this.sources.delete(source);if(!this.active)this.targetId=null;}
  clear(){this.sources.clear();this.targetId=null;}
  /** Called only after the current .72 s swing has recovered. Never skips the recovery. */
  next(model:MiningModel,player:Point,hand:HandItem|null):OreNode|null{
    if(!this.active)return null;
    const node=model.get(this.targetId);
    if(!node||model.reason(node,player,hand)){this.clear();return null;}
    return model.active?null:node;
  }
}
