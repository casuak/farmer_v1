"use client";
import { useEffect,useRef,useState } from "react";
import { Sprout,Sun,Moon,Sunrise,Sunset,Settings2,CircleHelp,Maximize,Minimize,Plus,MapPin,MousePointer2,ScanLine,ChevronUp,ChevronDown,ChevronLeft,ChevronRight,RotateCcw,Footprints,Check,Info,Coins,Map,Ship,Wind,Gauge,MessageCircle } from "lucide-react";
import { Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import type { GameApi,GameSettings,GameStatus } from "./engine";
import type { TileInfo } from "./farming";
import { InventoryModel } from "./inventory";
import InventoryUI from "./InventoryUI";
import TileInspector from "./TileInspector";
import MiningInspector from "./MiningInspector";
import ShopPanel from "./ShopPanel";
import WorldMap from "./WorldMap";
import TimeControls,{QuickTime} from "./TimeControls";
import { DayNightClock,formatClock,timeOfDay } from "./dayNight";
import { FARM_SPAWN } from "./geography";
import FishingOverlay from "./FishingOverlay";
import { FishingModel } from "./fishing";
import { MUSIC_TRACK } from "./music";
import { BOSS } from "./beachBoss";
import BossHud from "./BossHud";
import DodgeButton from "./DodgeButton";
import { DodgeModel } from "./dodge";
import { springSceneFilter } from "./colorGrading";
import DialogueOverlay from "./DialogueOverlay";
import { DialogueModel } from "./dialogue";

type Panel="help"|"settings"|"shop"|"map"|null;
const MIN_ZOOM=75,MAX_ZOOM=160;
export default function FarmGame(){
  const canvas=useRef<HTMLCanvasElement>(null),api=useRef<GameApi|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(""),[panel,setPanel]=useState<Panel>(null),[full,setFull]=useState(false);
  const [colorGrading,setColorGrading]=useState(true);
  const [settings,setSettings]=useState<GameSettings>({zoom:140,shadows:true,motion:true,occlusion:true,grid:true,bloom:true,timeScale:1,sound:true,volume:.55,music:true,musicVolume:.22});
  const [status,setStatus]=useState<GameStatus>(()=>({...FARM_SPAWN,location:"松溪农场",moving:false,running:true,aboard:false,fps:0,bag:new InventoryModel().snapshot(),interaction:null,dialogueActive:false,talkTarget:null,clock:new DayNightClock().snapshot(),bloomAvailable:true,fishing:new FishingModel().snapshot(),mining:{active:false,progress:0,target:null},boss:{visible:false,name:BOSS.name,hp:BOSS.maxHp,maxHp:BOSS.maxHp,phase:"idle",telegraphProgress:0,playerHp:5,playerMaxHp:5,playerInvulnerable:false},dodge:new DodgeModel().snapshot()}));
  const [tileInfo,setTileInfo]=useState<TileInfo|null>(null);
  const [dialogue,setDialogue]=useState(()=>new DialogueModel().snapshot());
  const latest=useRef(settings);latest.current=settings;
  const resumeTimeScale=useRef(1);
  const changeTimeScale=(timeScale:number)=>{if(timeScale>0)resumeTimeScale.current=timeScale;setSettings(s=>({...s,timeScale}));};
  useEffect(()=>{
    let cancelled=false;
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)setSettings(s=>({...s,motion:false}));
    import("./engine").then(({createGame})=>{
      if(cancelled||!canvas.current)return;
      try{
        api.current=createGame(canvas.current,()=>{if(!cancelled)setReady(true);},s=>{if(!cancelled)setStatus(s);},setError,{
          hover:info=>{if(!cancelled)setTileInfo(info);},
          action:result=>{if(!cancelled)toast(result.message,{id:"farm-action",duration:result.message.length>35?4500:2300,icon:result.ok?<Check size={17}/>:<Info size={17}/>,className:"farm-action-toast"});},
          shop:()=>{if(!cancelled)setPanel("shop");},
          dialogue:snapshot=>{if(!cancelled)setDialogue(snapshot);},
        });api.current.settings(latest.current);
      }catch(e){console.error(e);setError("暂时无法打开 3D 画面。请启用浏览器硬件加速后重试。");}
    }).catch(e=>{console.error(e);if(!cancelled)setError("农场加载失败，请刷新页面重试。");});
    const onFull=()=>setFull(!!document.fullscreenElement);document.addEventListener("fullscreenchange",onFull);
    return()=>{cancelled=true;api.current?.dispose();api.current=null;document.removeEventListener("fullscreenchange",onFull);};
  },[]);
  useEffect(()=>{api.current?.settings(settings);},[settings]);
  useEffect(()=>{api.current?.pause(panel!==null);},[panel]);
  useEffect(()=>{
    const surface=canvas.current;if(!surface||!ready||error||panel)return;
    const wheel=(e:WheelEvent)=>{
      if(e.ctrlKey||e.metaKey||!Number.isFinite(e.deltaY)||e.deltaY===0||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
      e.preventDefault();
      // Keep high-resolution trackpad deltas; normalize line/page-based mouse wheels.
      const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?surface.clientHeight:1);
      const delta=Math.max(-120,Math.min(120,pixels))*.1;
      setSettings(s=>{const next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,s.zoom-delta));return next===s.zoom?s:{...s,zoom:next};});
    };
    surface.addEventListener("wheel",wheel,{passive:false});
    return()=>surface.removeEventListener("wheel",wheel);
  },[ready,error,panel]);
  const zoom=(n:number)=>setSettings(s=>({...s,zoom:Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Math.round(n)))}));
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setPanel("settings");}}
  const reset=()=>{api.current?.reset();zoom(140);setPanel(null);};
  const touch=(k:string)=>({onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);api.current?.key(k,true);},onPointerUp:()=>api.current?.key(k,false),onPointerCancel:()=>api.current?.key(k,false),onLostPointerCapture:()=>api.current?.key(k,false)});
  const titles={help:"在松溪，慢慢生活",settings:"让画面更合心意",shop:"松果杂货店",map:"松溪四区"};
  const descriptions={help:"种一片菜圃，走过森林，再乘小船去看海。",settings:"保持清晰的固定视角，调整适合你的画面。",shop:"欢迎光临。收成可以换成金币，也可以添置新的背包。",map:"从农场出发，穿过林道与木桥，走进小镇和海滩。"};
  const period=timeOfDay(status.clock.minutes/60),ClockIcon=period==="夜晚"?Moon:period==="黄昏"?Sunset:period==="清晨"?Sunrise:Sun;
  const fishingActive=status.fishing.phase!=="idle",fishingFight=status.fishing.phase==="reeling"||status.fishing.phase==="catching";
  return <main className={`farm phase-three ${period==="夜晚"?"is-night":""} ${fishingActive?"is-fishing":""} ${status.boss.visible?"has-boss":""} ${status.bag.backpack?"has-backpack":""} ${dialogue.active?"is-dialogue":""}`} aria-label="松溪农场，3D 体素游戏">
    <canvas className="game-canvas" ref={canvas} style={{filter:springSceneFilter(status.clock.minutes/60,colorGrading)}} tabIndex={0} aria-label="游戏场景。WASD 移动，Shift 切换 3 倍跑步，空格翻滚（2.2 秒冷却），F 使用工具，E 互动，滚轮缩放，1 至 9 选物品。左键操作高亮地块或朝鼠标攻击，5 为手枪，6 为长剑，7 为钓鱼竿，8 为矿镐；靠近森林彩色矿石，按住左键或F连续敲击，也可按住 E 自动装备矿镐开采；矿物弹出落地后按 E 拾取。按住F或水面蓄力，松开甩竿；力度越大甩得越远。水面出现激烈水花和叹号时按F提竿，按住左键或F控制绿条，Esc 收竿。"/>
    <div className="vignette"/>
    {ready&&!error&&<BossHud state={status.boss}/>}

    <div className="hud calendar glass"><ClockIcon className="weather-icon"/><button className="calendar-clock" onClick={()=>setPanel("settings")} title="调整昼夜与时间流速" aria-label={`春 ${status.clock.day} 日 ${formatClock(status.clock.minutes)}，${period}。打开时间设置`}><time>{formatClock(status.clock.minutes)}</time><small>春 · {String(status.clock.day).padStart(2,"0")} 日 · {period}</small></button><div className="gold-wallet" aria-label={`${status.bag.gold} 金币`}><Coins/><strong>{status.bag.gold.toLocaleString()}<small>G</small></strong></div><div className="fps-chip" title="实时帧率" aria-label={`画面帧率：${status.fps} 帧每秒`}><Gauge/><strong>{status.fps}</strong><small>FPS</small></div></div>
    <QuickTime clock={status.clock} paused={settings.timeScale===0} onPause={()=>changeTimeScale(settings.timeScale===0?resumeTimeScale.current:0)} onTime={hour=>api.current?.setTime(hour)}/>
    <button className="hud mini-map-card glass" onClick={()=>setPanel("map")} title="打开区域地图" aria-label="打开区域地图"><div className="mini-map-title"><Map size={14}/><span>松溪四区</span><Plus size={12}/></div><WorldMap x={status.x} z={status.z} aboard={status.aboard} compact/></button>
    <div className="movement-corner">
    <div className="hud place"><MapPin/><strong>{status.location}</strong></div>
    <div className="hud movement-help glass" aria-label="移动操作提示">
      <div className="keyboard-move"><kbd>WASD</kbd><span>/ 方向键移动</span></div>
      <div className="keyboard-move"><kbd>Shift</kbd><span>切换步行 / 跑步</span></div>
      <div className="keyboard-move"><kbd>Space</kbd><span>方向翻滚 · 冷却 2.2 秒</span></div>
      <div className="touch-move">方向按钮移动<br/>点击步跑按钮切换</div>
    </div>
    {ready&&!error&&<DodgeButton state={status.dodge} disabled={panel!==null||status.aboard||status.fishing.phase==="catching"} onRoll={()=>api.current?.dodge()}/>}
    </div>
    {ready&&!error&&fishingFight&&<FishingOverlay state={status.fishing} readState={()=>api.current?.fishingState()??status.fishing} onPress={()=>api.current?.fishingPress()} onRelease={()=>api.current?.fishingRelease()} onCancel={()=>api.current?.cancelFishing()} paused={panel!==null}/>}
    <InventoryUI bag={status.bag} locked={fishingActive||status.mining.active} lockKind={status.mining.active?"mining":"fishing"} inspector={status.mining.target||status.bag.slots[status.bag.selected]?.id==="pickaxe"?<MiningInspector state={status.mining}/>:<TileInspector tile={tileInfo}/>} onSelect={i=>api.current?.selectSlot(i)} onMove={(a,b)=>api.current?.moveItem(a,b)} onDrop={i=>api.current?.dropItem(i)}/>
    <div className="hud adventure-actions run-control">
      <button className="movement-toggle glass" aria-pressed={status.running} disabled={status.aboard||fishingActive} onClick={()=>api.current?.toggleRun()} title="按一下 Shift 切换，不需要一直按住">{status.aboard?<Ship size={16}/>:status.running?<Wind size={16}/>:<Footprints size={16}/>}<span>{status.aboard?"驾船中":status.running?"跑步 · 3×":"步行 · 2×"}</span><kbd>Shift</kbd></button>
    </div>
    {ready&&!error&&!panel&&!dialogue.active&&status.talkTarget&&<button className="talk-prompt glass" onClick={()=>api.current?.talkNearby()}><MessageCircle size={17}/><span>和{status.talkTarget.name}交谈</span></button>}
    {ready&&!error&&!panel&&<DialogueOverlay state={dialogue} onAdvance={()=>api.current?.dialogueAdvance()} onChoose={id=>api.current?.dialogueChoose(id)} onClose={()=>api.current?.dialogueClose()}/>}
    <Toaster theme="light" position="top-center" offset={{top:status.boss.visible?220:112,left:16,right:16}} mobileOffset={{top:status.boss.visible?245:96,left:16,right:16}} visibleToasts={1} toastOptions={{className:"farm-action-toast"}}/>
    <div className="hud camera-tag"><ScanLine/>45° 固定视角 · 滚轮缩放</div>
    <div className="hud controls">
      <button className="round-button glass map-control" title="区域地图" aria-label="区域地图" onClick={()=>setPanel("map")}><Map/></button>
      <button className="round-button glass" title="操作说明" aria-label="操作说明" onClick={()=>setPanel("help")}><CircleHelp/></button>
      <button className="round-button glass" title="画面设置" aria-label="画面设置" onClick={()=>setPanel("settings")}><Settings2/></button>
      <button className="round-button glass fullscreen-control" title={full?"退出全屏":"全屏游玩"} aria-label={full?"退出全屏":"全屏游玩"} onClick={fullscreen}>{full?<Minimize/>:<Maximize/>}</button>
    </div>
    <div className="touch-pad" aria-label="触屏方向控制"><span/><button aria-label="向上走" {...touch("w")}><ChevronUp/></button><span/><button aria-label="向左走" {...touch("a")}><ChevronLeft/></button><span className="touch-center"><Footprints size={17}/></span><button aria-label="向右走" {...touch("d")}><ChevronRight/></button><span/><button aria-label="向下走" {...touch("s")}><ChevronDown/></button><span/></div>
    {!ready&&!error&&<div className="loading-screen" role="status"><Sprout/><h2>松溪农场</h2><p>樱花开了，海风正好…</p><div className="loading-track"><span/></div></div>}
    {error&&<div className="loading-screen" role="alert"><Sprout/><h2>稍等一下</h2><p>{error}</p><button className="dialog-action" style={{maxWidth:220}} onClick={()=>window.location.reload()}>重新进入农场</button></div>}
    <Dialog open={panel!==null} onOpenChange={open=>{if(!open)setPanel(null);}}>
      <DialogContent className={`farm-dialog ${panel==="shop"?"shop-dialog":""}`}>
        <div><p className="dialog-eyebrow">{panel==="shop"?"PINECONE GENERAL STORE":"PINEBROOK · A LITTLE SPRING"}</p><DialogTitle>{titles[panel??"settings"]}</DialogTitle><DialogDescription>{descriptions[panel??"settings"]}</DialogDescription></div>
        {panel==="shop"?<ShopPanel bag={status.bag} onSelect={i=>api.current?.selectSlot(i)} onBuy={id=>api.current?.buyItem(id)} onSell={(i,all)=>api.current?.sellItem(i,all)} onBackpack={()=>api.current?.buyBackpack()}/>:panel==="map"?<WorldMap x={status.x} z={status.z} aboard={status.aboard}/>:panel==="help"?<div>
          <div className="help-rows">
            <div className="help-row">移动<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 方向键</span></div>
            <div className="help-row">步行 2× / 跑步 3×<span><kbd>Shift</kbd>按一下切换</span></div>
            <div className="help-row">方向翻滚 · 冷却 2.2 秒<span><kbd>WASD</kbd>＋<kbd>Space</kbd></span></div>
            <div className="help-row">登船、下船、拾取、交谈<span><kbd>E</kbd> / 点击互动按钮</span></div>
            <div className="help-row">和镇民聊天<span>靠近交谈 · 点击补全 / 下一段 · 选项回答</span></div>
            <div className="help-row">选择物品<span><kbd>1</kbd>–<kbd>9</kbd>或点击物品格</span></div>
            <div className="help-row">工具 / 朝鼠标攻击<span><MousePointer2 size={16}/>左键 / <kbd>F</kbd></span></div>
            <div className="help-row">初始武器位置<span><kbd>5</kbd>手枪 · <kbd>6</kbd>长剑</span></div>
            <div className="help-row">手电照明<span><kbd>9</kbd>手持常亮 · 切换工具收起</span></div>
            <div className="help-row">长按连续采矿<span><kbd>8</kbd>矿镐 · 左键 / <kbd>F</kbd></span></div>
            <div className="help-row">选择钓竿 / 收竿<span><kbd>7</kbd>钓鱼竿 · <kbd>Esc</kbd>取消</span></div>
            <div className="help-row">蓄力甩竿<span>按住F · 力度往返 · 松开甩出</span></div>
            <div className="help-row">水花 + 叹号时提竿<span><kbd>F</kbd>进入搏斗</span></div>
            <div className="help-row">钓鱼条上浮 / 下沉<span>按住左键或F / 松开</span></div>
            <div className="help-row">缩放视角<span>滚轮向上拉近 / 向下拉远</span></div>
            <div className="help-row">整理和丢下<span>拖到另一格 / 拖到场景</span></div>
          </div>
          <div className="phase-note"><strong>种下你的第一份收成</strong>锄头开垦 → 放种子 → 浇水 → 约 24 秒后用镰刀收获。鼠标指向远处时，操作会吸附到身边最近的地块；镰刀朝鼠标方向收割高亮的一排三格，成熟后可获得白萝卜和新种子。</div>
          <div className="phase-note"><strong>把春天钓进物品栏</strong>初始第 7 格已有竹钓竿。走近河岸或码头，面向水面按住F蓄力（也可按住鼠标指向的水面）。角色头顶的细力度条会从小到大再往回波动，松开甩竿，力度越大落点越远，水面圆圈会预示落点。等待时不显示提示板，请盯住浮漂；出现激烈水花和叹号时立即按F或点水面提竿，才会打开搏斗面板。按住让绿色条上浮，松开下沉，包住鱼直到进度满格。鱼会跃出水面，再飞入物品栏！河里有鲤鱼、河鲈，海里有沙丁鱼、红鲷，都可出售。触屏同样长按水面蓄力、松开甩竿，叹号出现后点水面提竿，再长按面板按钮控鱼。Esc 收竿；打开面板或失去焦点会取消尚未甩出的蓄力，已落水的钓线会暂停。</div>
          <div className="phase-note"><strong>听见矿石里的回声</strong>初始第 8 格已有矿镐。沿农场北侧林道进入青苔森林，地图上的彩色菱形标出 12 处矿点：橙色铜矿敲 3 次、银蓝铁矿敲 4 次、紫色晶簇敲 5 次。走近后按住左键点矿石，或面向矿石按住F；按住 E 也会自动装备矿镐连续开采，触屏可选中矿镐后长按矿石。松开后收完当前一镐，Esc 或切工具立即停止。每次抬镐、下砸、回弹，命中时矿石开裂并飞溅火星。每一镐命中都会弹出 1 颗对应矿石，沿弧线落地并轻轻弹跳；最后一镐额外掉落碎石，落稳后靠近按 E 拾取，再飞入物品栏；满包不会丢失地面矿物。矿物可在杂货店出售，矿镐丢失也能买回。矿脉约 2 分钟后恢复，离开矿点再来看看。</div>
          <div className="phase-note"><strong>整装去森林</strong>物品栏最右边是头、身、背装备栏。拖入对应装备即可穿戴；背包清空后才能卸下。农场北侧的森林空地里有史莱姆。手枪可以边移动边射击，枪口火光与亮色尾迹帮助辨认弹道；长剑可以近身挥斩。命中后会变红、击退并飘出伤害数字。镇民也会被击中：他们受了伤就会吓一跳，双手向前一扑，转身逃跑，过一阵才慢慢回到日常路线。</div>
          <div className="phase-note"><strong>沙滩上的潮角犀王</strong>沿海岸木栈道向东，在码头北侧的沙地能遇到独角铠甲巨兽。靠近时顶部显示名字、血条和你的 5 格体力。它只追击玩家，不攻击镇民。犀王生命提高到 72，追击更快、冲锋更远，被正面撞中会损失 2 格体力。低头刨沙时橙色路线锁定方向；近身时会抬起前蹄，圆形范围预警后震地。半血进入狂怒，重新预警后连续冲锋两次，第一冲结束不要急着反击！按方向键＋空格翻滚（冷却 2.2 秒），起身前有短暂无敌；翻滚不穿墙。没有方向输入时向角色面朝方向翻滚。攻击仍用左键或 F；翻滚会取消未完成的攻击、开采或钓鱼。抓住连冲后的喘息，用第 5 格手枪或第 6 格长剑反击。被撞中有短暂无敌；体力耗尽会回到农场，物品和金币不会丢失。离开沙滩或登船后它会停止追击、回到领地恢复；击败获得 100 G 和 6 枚贝壳，本次试玩不再刷新。</div>
          <div className="phase-note"><strong>小镇的绿屋顶商店</strong>穿过河上的木桥，沿小镇主街找到广场旁的松果杂货店，进门后按 E。白萝卜每个卖 18 G，贝壳 8 G，木材 6 G；120 G 的帆布背包在右侧增加 8 格。所有房屋都可以直接走进去。</div>
          <p className="session-note">丢下的物品会留在脚边，按 E / 点击互动按钮可以拾回。采矿物品先弹出落地；拾取和收获的物品会飞入对应物品格，格子亮起表示收好；满包时地面物品不会消失。出海后靠近岸边或码头才能下船。打开面板会暂停游戏。当前为试玩版本，刷新会重置本次进度。</p>
        </div>:<div>
          <TimeControls clock={status.clock} scale={settings.timeScale} resumeScale={resumeTimeScale.current} onScale={changeTimeScale} onTime={hour=>api.current?.setTime(hour)}/>
          <div className="settings-row"><div><strong>场景缩放</strong><small>{Math.round(settings.zoom)}% · 固定 45° 视角</small></div><div className="setting-zoom"><Slider min={MIN_ZOOM} max={MAX_ZOOM} step={5} value={[settings.zoom]} onValueChange={v=>zoom(v[0])} aria-label="场景缩放"/></div></div>
          <div className="settings-row"><div><strong>背景音乐</strong><small>{MUSIC_TRACK.title} · 舒缓循环</small></div><Switch checked={settings.music} onCheckedChange={v=>setSettings(s=>({...s,music:v}))} aria-label="背景音乐"/></div>
          <div className="settings-row"><div><strong>音乐音量</strong><small>{Math.round(settings.musicVolume*100)}% · 独立于游戏音效</small></div><div className="setting-zoom"><Slider min={0} max={100} step={1} value={[settings.musicVolume*100]} onValueChange={v=>setSettings(s=>({...s,musicVolume:v[0]/100}))} aria-label="背景音乐音量" disabled={!settings.music}/></div></div>
          <p className="session-note music-credit">♪ <a href={MUSIC_TRACK.sourceUrl} target="_blank" rel="noreferrer">{MUSIC_TRACK.title}</a> — {MUSIC_TRACK.artist}（incompetech.com）<br/><a href={MUSIC_TRACK.licenseUrl} target="_blank" rel="noreferrer">{MUSIC_TRACK.license}</a> · 原曲未修改<br/>首次点击游戏后播放 · 切到后台自动暂停</p>
          <div className="settings-row"><div><strong>游戏音效</strong><small>脚步、耕种、挖矿、拾取与划船</small></div><Switch checked={settings.sound} onCheckedChange={v=>setSettings(s=>({...s,sound:v}))} aria-label="游戏音效"/></div>
          <div className="settings-row"><div><strong>音量</strong><small>{Math.round(settings.volume*100)}%</small></div><div className="setting-zoom"><Slider min={0} max={100} step={5} value={[settings.volume*100]} onValueChange={v=>setSettings(s=>({...s,volume:v[0]/100}))} aria-label="音效音量" disabled={!settings.sound}/></div></div>
          <div className="settings-row"><div><strong>春日色彩滤镜</strong><small>草木更鲜明、明暗更通透 · 夜间自动柔化</small></div><Switch checked={colorGrading} onCheckedChange={setColorGrading} aria-label="春日色彩滤镜"/></div>
          <div className="settings-row"><div><strong>柔和阴影</strong><small>树荫与建筑更有层次</small></div><Switch checked={settings.shadows} onCheckedChange={v=>setSettings(s=>({...s,shadows:v}))} aria-label="柔和阴影"/></div>
          <div className="settings-row"><div><strong>高光柔晕</strong><small>{status.bloomAvailable?"水面反光、浅色花朵与夜间灯光的柔光":"当前设备已关闭此效果"}</small></div><Switch checked={settings.bloom&&status.bloomAvailable} disabled={!status.bloomAvailable} onCheckedChange={v=>setSettings(s=>({...s,bloom:v}))} aria-label="高光柔晕"/></div>
          <div className="settings-row"><div><strong>春日动态</strong><small>樱花、微风、波浪与河海生灵</small></div><Switch checked={settings.motion} onCheckedChange={v=>setSettings(s=>({...s,motion:v}))} aria-label="春日动态"/></div>
          <div className="settings-row"><div><strong>遮挡时淡出</strong><small>树冠淡出；进屋始终显示内部</small></div><Switch checked={settings.occlusion} onCheckedChange={v=>setSettings(s=>({...s,occlusion:v}))} aria-label="遮挡时淡出"/></div>
          <div className="settings-row"><div><strong>地块网格</strong><small>一格一格，清楚地种下春天</small></div><Switch checked={settings.grid} onCheckedChange={v=>setSettings(s=>({...s,grid:v}))} aria-label="地块网格"/></div>
          <button className="return-home" onClick={reset}><RotateCcw size={15}/>回到菜圃旁</button>
        </div>}
        <DialogClose asChild><button className="dialog-action">{panel==="shop"?"收好东西，继续逛逛":"回到松溪"}</button></DialogClose>
      </DialogContent>
    </Dialog>
  </main>;
}
