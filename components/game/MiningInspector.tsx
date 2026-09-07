"use client";
import { Pickaxe,Gem,MousePointer2 } from "lucide-react";
import type { MiningSnapshot } from "./mining";
import "./mining.css";

export default function MiningInspector({state}:{state:MiningSnapshot}){
  const ore=state.target;
  return <aside className="hud tile-inspector mining-inspector glass" aria-label="森林采矿信息" data-ore-id={ore?.id??""} data-ore-health={ore?.health??""}>
    <div className="inspector-eyebrow"><span>青苔森林 · 采矿</span><Pickaxe size={14}/></div>
    <div className="inspector-title"><div className="tile-type-icon" style={{color:ore?.color??"#849b9b"}}>{ore?.kind==="crystal"?<Gem size={23}/>:<Pickaxe size={23}/>}</div><div><strong>{ore?.name??"沿着林道找矿石"}</strong><small>{ore?ore.health===0?"矿脉暂时休眠":`${ore.health} / ${ore.maxHealth} · 剩余敲击次数`:"地图上的菱形标记是矿点"}</small></div></div>
    {ore&&<div className="mining-state">
      <div className="ore-durability" role="meter" aria-label="矿石剩余耐久" aria-valuemin={0} aria-valuemax={ore.maxHealth} aria-valuenow={ore.health}>{Array.from({length:ore.maxHealth},(_,i)=><i key={i} data-intact={i<ore.health} style={i<ore.health?{background:ore.color}:undefined}/>)}</div>
      <p className="ore-loot">{ore.health===0?ore.respawn>0?`约 ${ore.respawn} 秒后恢复 · 离开矿点后再来`:"走远一些，矿脉就会恢复":ore.loot}</p>
    </div>}
    <div className="tile-action-hint" data-actionable={!!ore?.reachable&&ore.equipped&&ore.health>0}><MousePointer2 size={13}/><span>{state.active?state.holding?"长按连续挥镐 · 松开后收完这一镐；Esc 停止":"抬镐 → 敲击 → 回弹 · 按住可连续开采":ore?.hint??"按 8 选矿镐 · 长按矿石 / F连续挥镐；也可长按 E 互动按钮。"}</span></div>
  </aside>;
}
