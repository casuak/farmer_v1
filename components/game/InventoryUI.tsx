"use client";
import { useRef,useState,type ReactNode,type PointerEvent } from "react";
import { Sprout,Carrot,Logs,Shell,Backpack,Shirt,Sword,Grip,ArrowDownToLine,ArrowLeftRight,MousePointer2 } from "lucide-react";
import { ITEMS,MAIN_SLOTS,BASE_SLOTS,EQUIPMENT,type InventorySnapshot,type ItemId,type Stack } from "./inventory";

const ICONS={seeds:Sprout,turnip:Carrot,wood:Logs,shell:Shell,backpack:Backpack,shirt:Shirt,sword:Sword};
export function ItemIcon({id,className=""}:{id:ItemId;className?:string}){
  const props={className:`item-art item-${id} ${className}`,"aria-hidden":true as const,style:{color:ITEMS[id].color}};
  if(id in ICONS){const Icon=ICONS[id as keyof typeof ICONS];return <Icon {...props}/>;}
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {id==="water"?<><path d="M4 10h10v10H4zM5 9V6a3 3 0 0 1 6 0v3M4 12H2v5h2M14 14l5-5 2 2-7 7M18 8l4 4"/><path d="m20 15 1 1m-3 1 1 1m2-5 1 1"/></>:id==="scythe"?<><path d="m6 22 7-17M10 13l3 1M12 6c3-4 8-3 10 3-4-2-7-1-11 2"/></>:id==="hoe"?<><path d="m7 22 6-16M5 4l13 4 3-2-13-4Z"/></>:id==="hat"?<><path d="M7 13 9 5h6l2 8M7 10h10"/><ellipse cx="12" cy="15" rx="10" ry="4"/></>:<><path d="M3 5h17v6h-9l-3 9H3l3-9H3ZM11 11v4h3l2-4M17 5V3M7 5V3"/></>}
  </svg>;
}
type Props={bag:InventorySnapshot;inspector:ReactNode;onSelect:(index:number)=>void;onMove:(from:number,to:number)=>void;onDrop:(index:number)=>void};
type Drag={index:number;item:Stack;x:number;y:number};
export default function InventoryUI({bag,inspector,onSelect,onMove,onDrop}:Props){
  const [drag,setDrag]=useState<Drag|null>(null),[moveFrom,setMoveFrom]=useState<number|null>(null),[over,setOver]=useState<number|null>(null);
  const gesture=useRef<{index:number;x:number;y:number;item:Stack;active:boolean}|null>(null),suppress=useRef(false);
  const current=bag.slots[bag.selected];
  function down(e:PointerEvent<HTMLButtonElement>,index:number){
    suppress.current=false;if(e.button!==0||!bag.slots[index]||moveFrom!==null)return;
    gesture.current={index,x:e.clientX,y:e.clientY,item:{...bag.slots[index]!},active:false};e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:PointerEvent<HTMLButtonElement>){
    const g=gesture.current;if(!g)return;
    if(!g.active&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<6)return;
    g.active=true;e.preventDefault();setDrag({index:g.index,item:g.item,x:e.clientX,y:e.clientY});
    const el=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>("[data-inventory-slot]");setOver(el?Number(el.dataset.inventorySlot):null);
  }
  function end(e:PointerEvent<HTMLButtonElement>){
    const g=gesture.current;gesture.current=null;setDrag(null);setOver(null);
    if(g?.active){
      suppress.current=true;const el=document.elementFromPoint(e.clientX,e.clientY),slot=el?.closest<HTMLElement>("[data-inventory-slot]");
      if(slot)onMove(g.index,Number(slot.dataset.inventorySlot));else if(el?.closest(".game-canvas,[data-drop-zone]"))onDrop(g.index);
    }
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function cancel(){gesture.current=null;setDrag(null);setOver(null);}
  function choose(index:number){
    if(suppress.current){suppress.current=false;return;}
    if(moveFrom!==null){onMove(moveFrom,index);setMoveFrom(null);}else onSelect(index);
  }
  function slot(index:number){
    const item=bag.slots[index],equipment=EQUIPMENT.find(e=>e.index===index),label=equipment?`${equipment.label}部装备`:`${index<MAIN_SLOTS?"随身":"背包"}第 ${index<MAIN_SLOTS?index+1:index-BASE_SLOTS+1} 格`;
    return <button key={index} type="button" className={`pack-slot ${equipment?"equipment-slot":""}`} data-inventory-slot={index} data-selected={bag.selected===index} data-over={over===index} data-dragged={drag?.index===index} aria-pressed={bag.selected===index} aria-label={`${label}：${item?`${ITEMS[item.id].name} ×${item.count}`:"空格"}`} title={item?`${label} · ${ITEMS[item.id].description}`:equipment?`${label} · 拖入${ITEMS[equipment.item].name}`:"空物品格 · 可以拖入物品"} onClick={()=>choose(index)} onPointerDown={e=>down(e,index)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={e=>{if(e.key==="Escape")setMoveFrom(null);}}>
      {index<9&&<span className="slot-key">{index+1}</span>}{equipment&&<span className="equipment-label">{equipment.label}</span>}{item?<><ItemIcon id={item.id}/>{item.count>1&&<span className="slot-count">{item.count}</span>}</>:equipment?<ItemIcon id={equipment.item} className="equipment-empty"/>:<span className="empty-slot-dot"/>}
    </button>;
  }
  return <>
    <div className="world-right-rail">
      {inspector}
    </div>
    {bag.backpack&&<aside className="hud side-backpack" aria-label="已装备的帆布背包，额外八格储物空间"><div className="pack-heading"><span><Backpack size={16}/>帆布背包</span><small>{bag.slots.slice(BASE_SLOTS).filter(Boolean).length} / 8</small></div><div className="backpack-grid">{bag.slots.slice(BASE_SLOTS).map((_,i)=>slot(i+BASE_SLOTS))}</div><p>清空后可从“背”栏卸下</p></aside>}
    <aside className="hud inventory-dock" aria-label="随身物品栏">
      <div className="selected-item-note"><MousePointer2 size={13}/><strong>{current?ITEMS[current.id].name:"空物品格"}</strong><span>{moveFrom!==null?"点击目标格移动物品 · Esc 取消":drag?"拖到另一格整理 · 拖到场景放下":current?ITEMS[current.id].description:"拖动整理 · 1–9 快捷选择"}</span></div>
      <div className="pack-frame">
        <div className="pack-heading"><span><Grip size={15}/>随身物品<small>{bag.slots.slice(0,MAIN_SLOTS).filter(Boolean).length} / {MAIN_SLOTS}</small></span><span className="pack-actions"><button disabled={!current} aria-pressed={moveFrom!==null} onClick={()=>setMoveFrom(moveFrom===null?bag.selected:null)} title="选择物品后点此，再点击目标格"><ArrowLeftRight size={13}/>{moveFrom===null?"移动":"取消"}</button><button data-drop-zone="true" disabled={!current&&!drag} onClick={()=>{setMoveFrom(null);onDrop(bag.selected);}} title="将整组物品放在脚下，按 E 可重新拾起"><ArrowDownToLine size={13}/>丢下整组</button></span></div>
        <div className="inventory-slot-row"><div className="main-pack-grid">{bag.slots.slice(0,MAIN_SLOTS).map((_,i)=>slot(i))}</div><div className="equipment-grid" role="group" aria-label="头、身、背装备栏">{EQUIPMENT.map(e=>slot(e.index))}</div></div>
      </div>
    </aside>
    {drag&&<div className="inventory-drag-ghost" style={{left:drag.x,top:drag.y}} aria-hidden="true"><ItemIcon id={drag.item.id}/><b>{drag.item.count}</b></div>}
  </>;
}
