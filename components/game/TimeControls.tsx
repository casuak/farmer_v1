"use client";
import { Moon,Sun,Sunrise,Sunset,Pause,Play } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { DAY_SECONDS,TIME_SCALES,formatClock,timeOfDay,type ClockSnapshot } from "./dayNight";

export default function TimeControls({clock,scale,resumeScale,onScale,onTime}:{clock:ClockSnapshot;scale:number;resumeScale:number;onScale:(scale:number)=>void;onTime:(hour:number)=>void}){
  const chosenScale=scale||resumeScale,duration=DAY_SECONDS/chosenScale;
  return <section className="time-controls" aria-label="昼夜与时间">
    <div className="time-controls-heading"><div><strong>昼夜与时间</strong><span>春 · {String(clock.day).padStart(2,"0")} 日 · {timeOfDay(clock.minutes/60)}</span></div><output>{formatClock(clock.minutes)}</output></div>
    <div className="time-of-day-slider"><Slider min={0} max={1435} step={5} value={[Math.floor(clock.minutes/5)*5]} onValueChange={v=>onTime(v[0]/60)} aria-label="当前游戏时刻" aria-valuetext={formatClock(clock.minutes)}/></div>
    <div className="time-presets">{[{label:"清晨",hour:6.5,Icon:Sunrise},{label:"正午",hour:12,Icon:Sun},{label:"黄昏",hour:18,Icon:Sunset},{label:"夜晚",hour:22,Icon:Moon}].map(({label,hour,Icon})=><button key={label} onClick={()=>onTime(hour)} title={`查看 ${formatClock(hour*60)} 的光影`}><Icon size={16}/>{label}</button>)}</div>
    <div className="clock-rate-heading"><label>时间流速 <strong>{chosenScale}×</strong></label><button onClick={()=>onScale(scale===0?resumeScale:0)} aria-label={scale===0?"继续昼夜流逝":"暂停昼夜流逝"}>{scale===0?<Play size={14}/>:<Pause size={14}/>} {scale===0?"继续时间":"暂停时间"}</button></div>
    <Slider min={0} max={TIME_SCALES.length-1} step={1} value={[Math.max(0,TIME_SCALES.findIndex(s=>s===chosenScale))]} onValueChange={v=>onScale(TIME_SCALES[v[0]])} aria-label="昼夜时间流速" aria-valuetext={`${chosenScale} 倍`}/>
    <div className="clock-rate-caption"><span>0.25×</span><strong>{scale===0?"时间已暂停":`一天约 ${duration>=60?`${Number((duration/60).toFixed(2))} 分钟`:`${duration} 秒`}`}</strong><span>16×</span></div>
    <p>流速只影响昼夜。打开面板时游戏暂停，拖动时刻仍可预览光影。</p>
  </section>;
}
