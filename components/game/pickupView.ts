import { Matrix,Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { ITEMS,type InventoryGain } from "./inventory";
import { PICKUP_POOL_SIZE,PICKUP_SLOT_SHINE_SECONDS,pickupFlightPose,type ScreenPoint } from "./pickupMotion";

type Flight={node:HTMLDivElement;art:HTMLDivElement;count:HTMLSpanElement;sparks:HTMLElement[];gain:InventoryGain|null;from:ScreenPoint;age:number;serial:number};
type WorldPoint={x:number;y:number;z:number};

/** Cosmetic receipts only: inventory is committed atomically BEFORE an animation starts. */
export function createPickupView(scene:Scene,camera:Camera,canvas:HTMLCanvasElement,resolveSlot:(gain:InventoryGain)=>number|null=g=>g.slot){
  const host=canvas.parentElement,layer=document.createElement("div");layer.className="pickup-layer";layer.setAttribute("aria-hidden","true");host?.appendChild(layer);
  const pool:Flight[]=Array.from({length:PICKUP_POOL_SIZE},()=>{
    const node=document.createElement("div");node.className="pickup-flight";node.hidden=true;
    const art=document.createElement("div");art.className="pickup-flight-art";
    const count=document.createElement("span");count.className="pickup-flight-count";
    const sparks=Array.from({length:3},()=>{const spark=document.createElement("i");spark.className="pickup-flight-spark";node.appendChild(spark);return spark;});
    node.appendChild(art);node.appendChild(count);layer.appendChild(node);
    return {node,art,count,sparks,gain:null,from:{x:0,y:0},age:0,serial:0};
  });
  const shining=new Map<HTMLElement,{time:number;id:string}>();let serial=0,disposed=false;
  layer.dataset.total="0";layer.dataset.active="0";
  const slotElement=(gain:InventoryGain)=>{
    const slot=resolveSlot(gain);return slot===null?null:host?.querySelector<HTMLElement>(`[data-inventory-slot="${slot}"]`)??null;
  };
  function land(f:Flight){
    if(!f.gain)return;
    const slot=slotElement(f.gain);
    if(slot){slot.dataset.pickupReceived="true";shining.set(slot,{time:PICKUP_SLOT_SHINE_SECONDS,id:f.gain.id});}
    f.gain=null;f.node.hidden=true;
  }
  function receive(gains:readonly InventoryGain[],origin:WorldPoint,motion=true){
    if(disposed||!gains.length)return;
    const b=canvas.getBoundingClientRect();if(b.width<=0||b.height<=0)return;
    const p=Vector3.Project(new Vector3(origin.x,origin.y,origin.z),Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(b.width,b.height));
    if(!Number.isFinite(p.x+p.y+p.z))return;
    gains.forEach((gain,i)=>{
      if(!ITEMS[gain.id]||gain.count<=0)return;
      const f=pool.find(f=>!f.gain)??pool.reduce((a,b)=>a.serial<b.serial?a:b);
      // Recycle the oldest cosmetic at extreme input rates, never a gameplay item.
      if(f.gain)land(f);
      f.gain={...gain};f.from={x:p.x/b.width,y:p.y/b.height};f.age=-Math.min(i*.055,.22);f.serial=++serial;
      f.node.dataset.itemId=gain.id;f.node.dataset.count=String(gain.count);f.node.dataset.slot=String(gain.slot);f.node.dataset.serial=String(serial);
      f.art.replaceChildren();
      const icon=host?.querySelector(`[data-pickup-icon="${gain.id}"] .pickup-source-art`);
      if(icon){const clone=icon.cloneNode(true) as Element;clone.setAttribute("class","item-art pickup-item-art");f.art.appendChild(clone);}
      else{f.art.textContent=ITEMS[gain.id].name.slice(0,1);f.art.style.color=ITEMS[gain.id].color;}
      f.count.textContent=`+${gain.count}`;f.count.hidden=gain.count===1;
    });
    layer.dataset.total=String(serial);update(0,motion);
  }
  function update(dt:number,motion:boolean){
    if(disposed)return;
    const step=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    layer.dataset.motion=String(motion);
    for(const [slot,shine] of shining){
      shine.time-=step;
      if(shine.time<=0||slot.dataset.itemId!==shine.id){delete slot.dataset.pickupReceived;shining.delete(slot);}
    }
    if(!pool.some(f=>f.gain)){layer.dataset.active="0";return;}
    const b=canvas.getBoundingClientRect(),h=host?.getBoundingClientRect()??b;
    const point=(r:DOMRect)=>({x:r.left+r.width/2-h.left,y:r.top+r.height/2-h.top});
    for(const f of pool){
      if(!f.gain)continue;
      f.age+=step;if(f.age<0){f.node.hidden=true;continue;}
      const slot=slotElement(f.gain),rect=slot?.getBoundingClientRect(),dock=host?.querySelector<HTMLElement>(".inventory-dock");
      const fallback=dock?.getBoundingClientRect();
      const to=rect&&rect.width>0&&rect.height>0?point(rect):fallback?point(fallback):{x:b.left-h.left+b.width/2,y:b.top-h.top+b.height-65};
      const from={x:b.left-h.left+f.from.x*b.width,y:b.top-h.top+f.from.y*b.height};
      const p=pickupFlightPose(from,to,f.age,motion);
      f.node.hidden=false;f.node.dataset.stage=p.stage;f.node.dataset.progress=p.progress.toFixed(3);
      f.node.dataset.targetX=to.x.toFixed(2);f.node.dataset.targetY=to.y.toFixed(2);
      f.node.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%) scale(${p.scale}) rotate(${p.rotation}deg)`;
      f.node.style.opacity=String(p.opacity);
      f.sparks.forEach((spark,i)=>{
        const angle=i*2.399+f.serial*.6,spread=13+Math.min(f.age/.25,1)*16;
        spark.style.transform=`translate(${Math.cos(angle)*spread}px,${Math.sin(angle)*spread}px) rotate(45deg)`;
        spark.style.opacity=motion?String(Math.max(0,1-f.age/.48)*.85):"0";
      });
      if(p.done)land(f);
    }
    layer.dataset.active=String(pool.filter(f=>f.gain).length);
  }
  function clear(){
    pool.forEach(f=>{f.gain=null;f.node.hidden=true;});
    for(const slot of shining.keys())delete slot.dataset.pickupReceived;shining.clear();layer.dataset.active="0";
  }
  return {receive,update,clear,layer,dispose(){if(disposed)return;clear();disposed=true;layer.remove();}};
}
