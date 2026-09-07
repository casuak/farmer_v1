"use client";
import { RotateCcw } from "lucide-react";
import { DODGE,type DodgeSnapshot } from "./dodge";
import "./dodge.css";

export default function DodgeButton({state,onRoll,disabled=false}:{state:DodgeSnapshot;onRoll:()=>void;disabled?:boolean}){
  const ready=state.ready&&!disabled,fill=Math.max(0,Math.min(1,1-state.cooldown/DODGE.cooldown));
  const label=disabled?"暂不可用":state.active?"翻滚中":state.cooldown>0?`${state.cooldown.toFixed(1)}s`:"就绪";
  return <button type="button" className="hud dodge-button glass" disabled={!ready} data-dodge-ready={ready} data-dodge-cooldown={state.cooldown.toFixed(2)} data-dodge-active={state.active} aria-label={`翻滚，空格键，${label}`} title="方向键 / WASD + 空格翻滚；无方向输入时向前。冷却 2.2 秒，起身前有短暂无敌。" onPointerDown={e=>{if(e.button===0){e.preventDefault();onRoll();}}} onClick={e=>{if(e.detail===0)onRoll();}}>
    <span className="dodge-icon"><RotateCcw size={23}/></span><span className="dodge-label"><strong>翻滚<kbd>Space</kbd></strong><small>{label}</small></span>
    <span className="dodge-recharge" aria-hidden="true"><i style={{width:`${fill*100}%`}}/></span>
  </button>;
}
