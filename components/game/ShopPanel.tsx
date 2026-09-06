"use client";
import { Backpack,Coins,Check,ShoppingBasket,ArrowUpRight } from "lucide-react";
import { Tabs,TabsList,TabsTrigger,TabsContent } from "@/components/ui/tabs";
import { ITEMS,BACKPACK_PRICE,type InventorySnapshot,type ItemId } from "./inventory";
import { ItemIcon } from "./InventoryUI";

export default function ShopPanel({bag,onSelect,onBuy,onSell,onBackpack}:{bag:InventorySnapshot;onSelect:(index:number)=>void;onBuy:(id:ItemId)=>void;onSell:(index:number,all:boolean)=>void;onBackpack:()=>void}){
  const current=bag.slots[bag.selected];
  return <div className="shop-panel">
    <div className="shop-welcome"><div className="shop-emblem"><ShoppingBasket size={25}/></div><p>“带一点春天回家吧。”<small>莫里 · 种子、农具，也收购你的新鲜收成</small></p><strong><Coins size={17}/>{bag.gold} G</strong></div>
    <Tabs defaultValue="buy" className="shop-tabs"><TabsList className="shop-tab-list"><TabsTrigger value="buy">购买商品</TabsTrigger><TabsTrigger value="sell">出售物品</TabsTrigger></TabsList>
      <TabsContent value="buy">
        <div className="backpack-offer"><div className="backpack-art"><Backpack size={42}/></div><div><h3>帆布背包</h3><p>自动装备 · 右侧增加 8 格储物空间</p><small>收成、贝壳，还有路上的小发现。</small></div><button disabled={bag.backpack||bag.gold<BACKPACK_PRICE} onClick={onBackpack}>{bag.backpack?<><Check size={15}/>已装备</>:`${BACKPACK_PRICE} G · 购买`}</button></div>
        <div className="shop-products">{(["seeds","hoe","water","scythe","pistol","sword","hat","shirt","fishingRod"] as const).map(id=><div className="shop-product" key={id}><div className="shop-item-icon"><ItemIcon id={id}/></div><div><strong>{ITEMS[id].name}</strong><small>{id==="seeds"?"每份 1 颗 · 约 24 秒成熟":ITEMS[id].description}</small></div><button disabled={bag.gold<ITEMS[id].buy} onClick={()=>onBuy(id)} aria-label={`购买${ITEMS[id].name}，${ITEMS[id].buy} 金币`}>{ITEMS[id].buy} G <span>购买</span></button></div>)}</div>
      </TabsContent>
      <TabsContent value="sell">
        <p className="shop-section-note">选择要出售的一格物品。价格按件计算。</p>
        <div className="shop-sell-grid">{bag.slots.map((item,index)=>item?<button key={index} onClick={()=>onSelect(index)} data-selected={bag.selected===index} aria-pressed={bag.selected===index}><ItemIcon id={item.id}/><strong>{ITEMS[item.id].name}</strong><small>×{item.count} · {ITEMS[item.id].sell} G / 件</small></button>:null)}</div>
        {bag.slots.every(s=>!s)&&<p className="shop-empty">还没有可以出售的物品。去菜圃收获，或到沙滩拾贝壳吧。</p>}
        <div className="sell-summary"><div><strong>{current?ITEMS[current.id].name:"请选择一件物品"}</strong><small>{current?`整组价值 ${ITEMS[current.id].sell*current.count} G` : "点击上方物品格查看售价"}</small></div><button disabled={!current} onClick={()=>onSell(bag.selected,false)}>卖出 1 件 <ArrowUpRight size={14}/></button>{current&&current.count>1&&<button className="sell-all" onClick={()=>onSell(bag.selected,true)}>卖出整组</button>}</div>
      </TabsContent>
    </Tabs>
  </div>;
}
