"use client";
import { useEffect,useRef } from "react";
import { MessageCircle,X,ChevronDown,CornerDownLeft } from "lucide-react";
import type { DialogueSnapshot } from "./dialogue";
import "./dialogue.css";

type Props={state:DialogueSnapshot;onAdvance:()=>void;onChoose:(id:string)=>void;onClose:()=>void};
/** One click completes OR advances a line, never both. Choices never bubble into advance. */
export default function DialogueOverlay({state,onAdvance,onChoose,onClose}:Props){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!state.active)return;
    const previous=document.activeElement as HTMLElement|null;
    root.current?.focus({preventScroll:true});
    return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[state.active]);
  useEffect(()=>{
    const bubble=root.current?.querySelector<HTMLElement>("[data-dialogue-bubble]");
    if(bubble)bubble.scrollTop=0;
    // A selected option unmounts on the new page; keep keyboard focus in the conversation.
    if(root.current&&!root.current.contains(document.activeElement))root.current.focus({preventScroll:true});
  },[state.serial]);
  if(!state.active||!state.speaker)return null;
  const hasChoices=state.choices.length>0;
  return <div ref={root} className="dialogue-overlay" role="dialog" aria-modal="true" aria-labelledby="dialogue-speaker" aria-describedby="dialogue-instructions" tabIndex={-1}
    data-dialogue-node={state.nodeId} data-dialogue-line={state.lineIndex} data-dialogue-serial={state.serial} data-typing={state.typing}
    onClick={onAdvance} onContextMenu={e=>e.preventDefault()}
    onKeyDown={e=>{
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();onClose();return;}
      if(e.key==="Tab"){
        const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]);
        if(!buttons.length){e.preventDefault();return;}
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=e.shiftKey?(index<=0?buttons.length-1:index-1):(index+1)%buttons.length;
        e.preventDefault();e.stopPropagation();buttons[next].focus();return;
      }
      if(["Enter"," ","e","E"].includes(e.key)){
        e.stopPropagation();
        if(e.repeat){e.preventDefault();return;}
        if(e.target instanceof HTMLElement&&e.target.closest("button")&&e.key!=="e"&&e.key!=="E")return;
        e.preventDefault();if(!e.repeat)onAdvance();
      }else e.stopPropagation();
    }}>
    <section className="dialogue-bubble" data-dialogue-bubble="true">
      <header className="dialogue-heading">
        <span className="dialogue-avatar" style={{background:state.speaker.color}} aria-hidden="true"><MessageCircle size={25}/></span>
        <div><span className="dialogue-eyebrow">松溪 · 邻里闲谈</span><h2 id="dialogue-speaker">{state.speaker.name}</h2></div>
        <button className="dialogue-close" aria-label="结束对话" title="结束对话 · Esc" onClick={e=>{e.stopPropagation();onClose();}}><X size={19}/></button>
      </header>
      <div className="dialogue-page" key={state.serial}>
        <p className="dialogue-text" aria-hidden="true">{state.visibleText}<span className="dialogue-caret" data-active={state.typing}/></p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{state.typing?"":state.text}</p>
      </div>
      {hasChoices&&<div className="dialogue-choices" role="group" aria-label="选择你的回答" onClick={e=>e.stopPropagation()}>
        {state.choices.map((choice,index)=><button key={`${state.serial}-${choice.id}`} className="dialogue-choice" onClick={()=>onChoose(choice.id)}><span className="dialogue-choice-number" aria-hidden="true">{index+1}</span><span>{choice.label}</span><CornerDownLeft size={15}/></button>)}
      </div>}
      <footer id="dialogue-instructions" className="dialogue-footer"><span>{state.typing?"点击任意处 · 立即显示整段":hasChoices?"选择一个回答，继续聊天":"点击继续 · 下一段 / 结束"}</span>{!state.typing&&!hasChoices&&<ChevronDown size={17}/>}<small>Esc 结束</small></footer>
    </section>
  </div>;
}
