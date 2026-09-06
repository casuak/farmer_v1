"use client";
import { MapPin } from "lucide-react";
import { shoreX,riverCenter,BUILDINGS } from "./geography";
import { MAP_TRANSFORM,projectMapPoint } from "./mapProjection";

const coast=Array.from({length:41},(_,i)=>{const z=40-i*2;return `${shoreX(z)+48},${40-z}`;}).join(" ");
const river=Array.from({length:41},(_,i)=>{const z=40-i*2;return `${riverCenter(z)+48},${40-z}`;}).join(" ");
const labels=[{name:"青苔森林",x:-34,z:10},{name:"松溪小镇",x:-2,z:35},{name:"农场菜圃",x:-6,z:-17},{name:"贝壳沙滩",x:26,z:-16},{name:"大海",x:40,z:19}];
export default function WorldMap({x,z,aboard,compact=false}:{x:number;z:number;aboard:boolean;compact?:boolean}){
  const player=projectMapPoint(x,z);
  return <div className={`world-map ${compact?"is-compact":""}`}>
    <svg viewBox="-69 -51 138 102" role="img" aria-label={`45 度斜向区域地图，北方在右上，玩家位于横坐标 ${Math.round(x+48)}，纵坐标 ${Math.round(z+40)}`}>
      <defs><clipPath id={compact?"mini-map-clip":"world-map-clip"}><rect width="96" height="80" rx="4"/></clipPath></defs>
      <g transform="translate(0 2)"><rect transform={MAP_TRANSFORM} width="96" height="80" rx="4" fill="#8c9c7a"/></g>
      <g transform={MAP_TRANSFORM} clipPath={`url(#${compact?"mini-map-clip":"world-map-clip"})`}>
        <rect width="96" height="80" fill="#bfcb95"/><rect width="30" height="80" fill="#80a681"/><rect x="32" y="6" width="43" height="18" rx="5" fill="#d4ccad"/>
        <polyline points="20,80 20,0" stroke="#bec293" strokeWidth="2"/>
        <path d="M0 40 H84 M46.5 80 V0 M32 20 H77 M42 20 V15 M69 20 V15" stroke="#e7d8aa" strokeWidth="1.5" fill="none"/>
        <polyline points={river} fill="none" stroke="#78b8b0" strokeWidth="3.4"/>
        <polyline points={coast} fill="none" stroke="#eedfb8" strokeWidth="10"/>
        <polygon points={`96,0 ${coast} 96,80`} fill="#70acba"/>
        <path d="M54 40 H60 M54 20 H60 M76 40 H86" stroke="#b58c61" strokeWidth="1.8"/>
        <rect x="38" y="42" width="6" height="5" fill="#ad8964"/>
        {BUILDINGS.map(b=><rect key={b.id} x={b.x+48-b.w/2} y={40-b.z-b.d/2} width={b.w} height={b.d} rx=".6" fill={b.roof} stroke="#f0e2bc" strokeWidth=".5"/>)}
      </g>
      {!compact&&<g className="map-region-labels" fill="#345d51" fontSize="4.6" textAnchor="middle" fontWeight="600">{labels.map(label=>{const p=projectMapPoint(label.x,label.z);return <text key={label.name} x={p.x} y={p.y}>{label.name}</text>;})}</g>}
      <circle cx={player.x} cy={player.y} r={compact?2.5:2} fill="#fff7d0" stroke="#527064" strokeWidth=".7"/><circle cx={player.x} cy={player.y} r=".8" fill={aboard?"#6193a5":"#b98659"}/>
      <g transform="translate(49 -35)" fill="#536d60"><path d="M-4 4 4-4 M-1-4 H4 V1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><text x="7" y="-6" fontSize="4.5">北</text></g>
    </svg>
    <div className="map-caption"><span><MapPin size={12}/>你的位置</span><small>北 ↗ · 45°</small></div>
    {!compact&&<div className="map-directions"><p><strong>森林 ↖</strong>沿农场小径向西，拾取落木。</p><p><strong>小镇 ↗</strong>沿中间小径向北，绿屋顶是杂货店。</p><p><strong>海岸 ↘</strong>向东过木桥，沿路到码头登船。</p><p className="map-orientation">96 × 80 格 · 地图方向与场景一致。</p></div>}
  </div>;
}
