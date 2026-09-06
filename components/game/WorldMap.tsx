"use client";
import { MapPin } from "lucide-react";
import { shoreX,riverCenter,BUILDINGS,BRIDGES,DOCK,GARDEN,REGIONS,ROADS,regionId } from "./geography";
import { MAP_TRANSFORM,projectMapPoint } from "./mapProjection";

const coast=Array.from({length:41},(_,i)=>{const z=40-i*2;return `${shoreX(z)+48},${40-z}`;}).join(" ");
const river=Array.from({length:81},(_,i)=>{const z=40-i;return `${riverCenter(z)+48},${40-z}`;}).join(" ");
export default function WorldMap({x,z,aboard,compact=false}:{x:number;z:number;aboard:boolean;compact?:boolean}){
  const player=projectMapPoint(x,z),current=regionId({x,z}),clip=compact?"mini-map-clip":"world-map-clip";
  return <div className={`world-map ${compact?"is-compact":""}`}>
    <svg viewBox="-69 -51 138 102" role="img" aria-label={`45 度斜向四区地图：农场、森林、小镇、海滩，北方在右上。当前位置：${REGIONS.find(r=>r.id===current)!.name}`}>
      <defs><clipPath id={clip}><rect width="96" height="80" rx="4"/></clipPath></defs>
      <g transform="translate(0 2)"><rect transform={MAP_TRANSFORM} width="96" height="80" rx="4" fill="#8c9c7a"/></g>
      <g transform={MAP_TRANSFORM} clipPath={`url(#${clip})`}>
        <rect width="44" height="40" fill="#82a782"/><rect x="44" width="52" height="40" fill="#c9ccaa"/>
        <rect y="40" width="44" height="40" fill="#bfd08c"/><rect x="44" y="40" width="52" height="40" fill="#ebd7a8"/>
        <rect x="51" y="24" width="11" height="11" rx="1" fill="#d7d4bf"/>
        {ROADS.map((road,i)=><polyline key={i} points={road.points.map(([px,pz])=>`${px+48},${40-pz}`).join(" ")} stroke="#e5d7b0" strokeWidth={road.width} strokeLinejoin="round" strokeLinecap="round" fill="none"/>)}
        <polyline points={river} fill="none" stroke="#c2cda4" strokeWidth="5.8"/><polyline points={river} fill="none" stroke="#70b1ac" strokeWidth="3.4"/>
        <polyline points={coast} fill="none" stroke="#eedfb8" strokeWidth="8"/>
        <polygon points={`96,0 ${coast} 96,80`} fill="#70acba"/>
        {BRIDGES.map(b=><rect key={b.z} x={b.x+48-b.w/2} y={40-b.z-b.d/2} width={b.w} height={b.d} fill="#b99569"/>)}
        <rect x="75.4" y={40-DOCK.z-1.16} width="10.8" height="2.32" fill="#b99569"/>
        <rect x={GARDEN.x+48} y={40-GARDEN.z-GARDEN.d} width={GARDEN.w} height={GARDEN.d} fill="#b69466" stroke="#e5d0a3" strokeWidth=".8"/>
        {[2,4,6].map(row=><path key={row} d={`M${GARDEN.x+49} ${40-GARDEN.z-row} h${GARDEN.w-2}`} stroke="#809b60" strokeWidth=".8"/>)}
        <circle cx="56.5" cy="28.5" r="1.6" fill="#88b9b3" stroke="#eee4cc" strokeWidth=".7"/>
        {BUILDINGS.map(b=><rect key={b.id} x={b.x+48-b.w/2} y={40-b.z-b.d/2} width={b.w} height={b.d} rx=".6" fill={b.roof} stroke="#f0e2bc" strokeWidth=".5"/>)}
        <path d={`M83.8 ${40-DOCK.z+2.6} h2.4 l-.5 1.3 h-1.4 Z`} fill="#815f43"/>
      </g>
      {!compact&&<g className="map-region-labels" fill="#345d51" fontSize="4.4" textAnchor="middle" fontWeight="600">{REGIONS.map(region=>{const p=projectMapPoint(region.x,region.z);return <text key={region.id} x={p.x} y={p.y}>{region.label}</text>;})}</g>}
      <circle cx={player.x} cy={player.y} r={compact?2.5:2} fill="#fff7d0" stroke="#527064" strokeWidth=".7"/><circle cx={player.x} cy={player.y} r=".8" fill={aboard?"#6193a5":"#b98659"}/>
      <g transform="translate(49 -35)" fill="#536d60"><path d="M-4 4 4-4 M-1-4 H4 V1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><text x="7" y="-6" fontSize="4.5">北</text></g>
    </svg>
    <div className="map-caption"><span><MapPin size={12}/>{REGIONS.find(r=>r.id===current)!.name}</span><small>北 ↗ · 45°</small></div>
    {!compact&&<div className="map-directions four-districts">{REGIONS.map(region=><p key={region.id} data-current={region.id===current}><strong><i style={{background:region.color}}/>{region.label}</strong><span>{region.description}</span></p>)}<p className="map-orientation">96 × 80 格 · 三座木桥连接四区 · 地图方向与场景一致。</p></div>}
  </div>;
}
