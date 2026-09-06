"use client";
import { Grid2X2,Sprout,Droplets,House,Trees,Waves,Mountain,Fence,MousePointer2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { STAGES,MAP_WIDTH,MAP_DEPTH,type TileInfo } from "./farming";

export default function TileInspector({tile}:{tile:TileInfo|null}) {
  const Icon=!tile?Grid2X2:tile.kind==="building"||tile.kind==="floor"?House:tile.kind==="tree"?Trees:tile.kind==="water"||tile.kind==="sea"||tile.kind==="dock"?Waves:tile.kind==="rock"?Mountain:tile.kind==="fence"?Fence:tile.stage!==null?Sprout:Grid2X2;
  const farmable=tile&&(tile.kind==="grass"||tile.kind==="dirt");
  return <aside className="hud tile-inspector glass" aria-label="当前地块信息" data-tile-type={tile?.kind??"none"}>
    <div className="inspector-eyebrow"><span>当前地块</span>{tile?<span>X {tile.x+MAP_WIDTH/2} · Y {tile.z+MAP_DEPTH/2}</span>:<Grid2X2 size={14}/>}</div>
    <div className="inspector-title"><div className={`tile-type-icon ${tile?.watered?"is-wet":""}`}><Icon size={23}/></div><div><strong>{tile?.label??"看看脚下的土地"}</strong><small>{tile?"1 × 1 方格":"鼠标指向地块查看信息"}</small></div></div>
    {tile&&<>
      {farmable&&<div className="soil-state"><span>{tile.tilled?"已开垦":"未开垦"}</span><span><Droplets size={13}/>{tile.watered?"湿润":tile.tilled?"等待浇水":"干燥"}</span></div>}
      {tile.stage!==null&&<div className="crop-state">
        <div><strong>{tile.stageName}</strong><span>{tile.stage===4?"可以收获了":!tile.watered?"浇水后开始生长":`约 ${tile.remaining} 秒后成熟`}</span></div>
        <Progress value={tile.progress} aria-label="萝卜生长进度" className="crop-progress"/>
        <ol className="growth-stages">{STAGES.map((stage,i)=><li key={stage} data-active={i===tile.stage} data-done={i<=tile.stage!}>{stage}</li>)}</ol>
      </div>}
      <div className="tile-action-hint" data-actionable={tile.actionable}><MousePointer2 size={13}/><span>{tile.hint}</span></div>
    </>}
  </aside>;
}
