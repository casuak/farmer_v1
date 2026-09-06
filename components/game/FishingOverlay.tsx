"use client";
import { useEffect,useRef,useState,type PointerEvent } from "react";
import { Fish,MousePointer2,Waves,X,Check,Anchor } from "lucide-react";
import { FISHING,type FishingSnapshot } from "./fishing";
import { ItemIcon } from "./InventoryUI";
import { ITEMS } from "./inventory";

type Props={state:FishingSnapshot;readState:()=>FishingSnapshot;onPress:()=>void;onRelease:()=>void;onCancel:()=>void;paused:boolean};
const titles={idle:"在水边，等一份惊喜",casting:"抛出一条春天的弧线",waiting:"浮漂轻轻晃着…",bite:"咬钩了！快提竿",reeling:"稳住，让鱼留在绿条里",catching:"钓到啦！",escaped:"鱼溜走了，再试一次"};
export default function FishingOverlay({state,readState,onPress,onRelease,onCancel,paused}:Props){
  const [live,setLive]=useState(state),reader=useRef(readState);
  useEffect(()=>{reader.current=readState;},[readState]);
  const active=state.phase!=="idle";
  useEffect(()=>{
    let frame=0,last=0;
    const tick=(time:number)=>{if(time-last>30){last=time;setLive(reader.current());}frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[]);
  const s=active||live.phase!=="idle"?live:state,{phase}=s,reeling=phase==="reeling",caught=phase==="catching",bite=phase==="bite";
  function down(e:PointerEvent<HTMLButtonElement>){if(e.button!==0||paused)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onPress();}
  function up(e:PointerEvent<HTMLButtonElement>){onRelease();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
  return <section className={`fishing-panel glass ${reeling?"is-reeling":""} ${caught?"is-caught":""}`} data-fishing-phase={phase} data-paused={paused} aria-label="钓鱼玩法" aria-describedby="fishing-instructions">
    <header><span className="fishing-eyebrow"><Waves size={14}/>{s.spot?.kind==="sea"?"海风渔记":"松溪渔记"}<small>FISHING</small></span>{phase!=="idle"&&!caught&&<button className="fishing-cancel" onClick={onCancel} aria-label="收竿，取消钓鱼" title="Esc 收竿"><X size={15}/></button>}</header>
    <h2 aria-live="polite">{paused?"钓鱼已暂停":titles[phase]}</h2>
    {reeling?<div className="fishing-game" data-in-bar={s.inBar}>
      <div className="fishing-meter-wrap">
        <span className="fishing-depth">水面</span>
        <div className="fishing-lane" role="img" aria-label={`鱼在 ${Math.round(s.fishPosition*100)}% 高度，绿色条在 ${Math.round(s.barPosition*100)}% 高度`}>
          <div className="fishing-lane-rules"/>
          <div className="fishing-green-bar" style={{bottom:`${(s.barPosition-s.barSize/2)*100}%`,height:`${s.barSize*100}%`}}><span/><span/><span/></div>
          <div className="fishing-fish-marker" style={{bottom:`${s.fishPosition*100}%`}}>{s.fish?<ItemIcon id={s.fish.id}/>:<Fish size={28}/>}</div>
        </div><span className="fishing-depth">水底</span>
      </div>
      <div className="fishing-reel-copy"><span className={`fishing-contact ${s.inBar?"is-in":""}`}>{s.inBar?<Check size={15}/>:<Fish size={15}/>} {s.inBar?"跟住了！":"追上它"}</span><p>按住上浮<br/>松开下沉</p><small>让绿色条包住鱼<br/>进度满格即可钓获</small>
        <div className="fishing-progress-heading"><span>钓获进度</span><strong>{Math.round(s.progress*100)}%</strong></div>
        <div className="fishing-progress" role="progressbar" aria-label="钓获进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress*100)}><span style={{width:`${s.progress*100}%`}}/></div>
        <span className="fishing-perfect">{s.perfect?"✦ 完美跟随中":"慢慢来，稳住节奏"}</span>
      </div>
    </div>:caught&&s.fish?<div className="fishing-catch-card"><ItemIcon id={s.fish.id}/><div><strong>{ITEMS[s.fish.id].name}<span> ×1</span></strong><p>{s.fish.length} cm · {ITEMS[s.fish.id].sell} G{s.fish.perfect?" · 完美！":""}</p><small>跃出水面，收进物品栏…</small></div></div>:<div className={`fishing-quiet ${bite?"has-bite":""}`}>
      {bite?<span className="fishing-exclamation">!</span>:phase==="idle"?<Anchor size={26}/>:<span className="fishing-float-icon"><i/></span>}
      <p>{phase==="idle"?s.canCast?"水面已选好 · 可以抛竿":"走近河岸或码头，朝向开阔水面":s.message}</p>
    </div>}
    {bite&&<div className="fishing-bite-timer" aria-hidden="true"><span style={{width:`${Math.max(0,1-s.phaseTime/FISHING.biteSeconds)*100}%`}}/></div>}
    {!caught&&phase!=="escaped"&&<button type="button" className="fishing-hold" data-held={s.held} disabled={paused||phase==="casting"||phase==="waiting"||(phase==="idle"&&!s.canCast)} onPointerDown={down} onPointerUp={up} onPointerCancel={onRelease} onLostPointerCapture={onRelease} onKeyDown={e=>{if(e.code==="Space"||e.key==="Enter"){e.preventDefault();e.stopPropagation();if(!e.repeat)onPress();}}} onKeyUp={e=>{if(e.code==="Space"||e.key==="Enter"){e.preventDefault();e.stopPropagation();onRelease();}}} onBlur={onRelease} onClick={e=>{if(e.detail===0){onPress();onRelease();}}}>
      <MousePointer2 size={16}/>{reeling?s.held?"正在上浮 · 松开下沉":"按住上浮":bite?"立即提竿！":phase==="idle"?"朝水面抛竿":"静候咬钩"}<kbd>Space</kbd>
    </button>}
    <p className="fishing-instructions" id="fishing-instructions">{reeling?"长按鼠标左键 / 空格 / 上方按钮控制":caught?"鱼已钓获 · 正在收入物品栏":phase==="escaped"?"别着急，下一条鱼在等你":phase==="idle"?"左键点击近处水面 · 空格朝面前抛竿":"咬钩时点击 / 按空格提竿"}{phase!=="idle"&&!caught&&<span>Esc 收竿</span>}</p>
  </section>;
}
