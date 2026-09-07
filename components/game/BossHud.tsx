"use client";
import { Heart } from "lucide-react";
import type { BossSnapshot } from "./beachBoss";
import "./boss.css";

type Props = { state: BossSnapshot };

const PHASE_HINT: Record<BossSnapshot["phase"], string> = {
  idle: "巡视领地",
  alert: "发现入侵者",
  chase: "追击中",
  windup: "冲锋蓄力 · 离开橙色范围",
  charge: "直线冲锋 · 横向躲避",
  recover: "喘息破绽 · 趁机反击",
  stompWindup: "震地蓄力 · 退开或翻滚",
  stomp: "震地结束 · 反击机会",
  return: "返回领地",
  defeated: "已击败",
};

export default function BossHud({ state }: Props) {
  if (!state.visible) return null;
  const name = state.name?.trim() || "潮角犀王";
  const maxHp = Math.max(1, Math.round(state.maxHp) || 1);
  const hp = Math.max(0, Math.min(maxHp, Math.round(state.hp) || 0));
  const hpPct = (hp / maxHp) * 100;
  const playerMax = Math.max(0, Math.round(state.playerMaxHp) || 0);
  const playerHp = Math.max(0, Math.min(playerMax, Math.round(state.playerHp) || 0));
  const telegraph = Math.max(0, Math.min(1, state.telegraphProgress || 0));
  const defeated = state.phase === "defeated";
  const danger = state.phase === "windup" || state.phase === "charge" || state.phase === "stompWindup";
  const hint=state.enraged&&state.phase==="recover"&&state.comboIndex===1?"连冲未完 · 准备再次闪避":state.enraged&&(state.phase==="windup"||state.phase==="charge")?`狂怒连冲 ${state.comboIndex??1} / 2 · 空格翻滚`:PHASE_HINT[state.phase];
  return (
    <section
      className={`boss-hud ${defeated ? "is-defeated" : ""} ${danger ? "is-danger" : ""}`}
      role="region"
      aria-label={`${name} · 贝壳沙滩领地守卫`}
      data-boss-health={String(hp)}
      data-boss-max-health={String(maxHp)}
      data-boss-phase={state.phase}
      data-boss-enraged={!!state.enraged}
      data-player-health={String(playerHp)}
      data-player-max-health={String(playerMax)}
    >
      <header className="boss-hud-head">
        <div className="boss-title">
          <strong className="boss-name">{name}</strong>
          <span className="boss-sub">{state.enraged?"狂怒阶段 · 双重冲锋":"贝壳沙滩 · 领地守卫"}</span>
        </div>
        <strong className="boss-hp-num">
          <b>{hp}</b>
          <small>/ {maxHp}</small>
        </strong>
      </header>
      <div
        className="boss-hp"
        role="progressbar"
        aria-label={`${name} 生命值`}
        aria-valuemin={0}
        aria-valuemax={maxHp}
        aria-valuenow={hp}
        aria-valuetext={`${hp} / ${maxHp}`}
      >
        <div className="boss-hp-track">
          <span className="boss-hp-fill" style={{ width: `${hpPct}%` }} />
        </div>
      </div>
      <div className="boss-meta">
        {telegraph > 0 && !defeated && (
          <div className="boss-telegraph" aria-hidden="true" title="冲锋预警范围">
            <span style={{ width: `${telegraph * 100}%` }} />
          </div>
        )}
        <span className="boss-phase" data-phase={state.phase}>
          {hint}
        </span>
      </div>
      <div className="boss-player">
        <span className="boss-player-label">玩家</span>
        <span className="boss-hearts" role="img" aria-label={`玩家生命 ${playerHp} / ${playerMax}`}>
          {Array.from({ length: playerMax }, (_, i) => (
            <Heart key={i} className={`boss-heart ${i < playerHp ? "is-full" : "is-empty"}`} aria-hidden="true" />
          ))}
        </span>
        {state.playerInvulnerable && <span className="boss-invuln">短暂无敌</span>}
      </div>
    </section>
  );
}
