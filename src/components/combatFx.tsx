/**
 * 战斗演出的公共零件（v1.28 抽出）。
 *
 * 这些函数原先在 CombatView 与 LabView 里各有一份逐字相同的副本。
 * 多单位战斗要新增"某个敌人正在挨打""是哪个敌人在出手"这类判定，
 * 再复制一份必然发散，所以统一到此处：两个视图只负责"把哪些事件喂进来"。
 */
import { charLabel, fmtNum, type CombatEvent } from '../game/engine'
import { ROLE_COLOR, ATK_STYLE_COLOR } from '../game/data'

// 演出时间窗（ms）：事件 time 已到且在窗口内才播放对应动画
export const HIT_MS = 380
export const DASH_MS = 420
export const IMPACT_MS = 450
export const KILL_MS = 500
/** 命中延迟：出手冲刺约 200ms 后才接触目标，受击反应（抖动/特效/数字）统一延后这么多 */
export const IMPACT_DELAY = 200

/** 事件是否处于"正在演出"窗口内（time 已到、且未过期） */
export function active(e: CombatEvent, now: number, windowMs: number): boolean {
  return e.time <= now && now - e.time < windowMs
}

/** 把事件时间平移到"命中时刻"（冲刺到位的瞬间） */
export function atImpact(e: CombatEvent): CombatEvent {
  return { ...e, time: e.time + IMPACT_DELAY }
}

/**
 * 事件配色：治疗绿、敌方出手按招式类型、我方出手按自身流派。
 * 招式类型取自事件自带的 atkStyle（v1.28：每个敌人各有一套招式，不再是全场统一一个风格）。
 */
function eventColor(e: CombatEvent): string {
  if (e.type === 'heal') return '#4ade80'
  if (e.type === 'monsterDmg') return ATK_STYLE_COLOR[e.atkStyle ?? 'melee']
  const role = e.who ? charLabel(e.who)?.role : undefined
  return role ? ROLE_COLOR[role] : '#ffd27a'
}

export function FloatingNumbers({ events, refMax, now }: { events: CombatEvent[]; refMax: number; now: number }) {
  return (
    <>
      {events.filter(e => e.time <= now).map((e, i) => {
        const isHeal = e.type === 'heal'
        const color = eventColor(e)
        const pct = refMax > 0 ? e.value / refMax : 0
        const fontSize = pct >= 0.25 ? '22px' : pct >= 0.12 ? '17px' : '13px'
        const slot = Math.round(e.time / 97) % 3 // 稳定伪随机横向偏移，避免数字重叠
        return (
          <span key={`${e.time}-${e.type}-${e.who ?? ''}-${i}`}
            className={`dq-floating-num ${isHeal ? 'heal' : ''}`}
            style={{ left: `calc(50% + ${(slot - 1) * 16}px)`, color, fontSize }}>
            {isHeal ? '+' : '-'}{fmtNum(e.value)}
          </span>
        )
      })}
    </>
  )
}

/** 命中特效：叠在目标身上的特效图，随事件窗口触发 */
export function ImpactFx({ src, rotate }: { src?: string; rotate?: number }) {
  if (!src) return null
  return <img src={src} alt="" className="dq-impact-fx" style={rotate ? ({ '--fx-rot': `${rotate}deg` } as React.CSSProperties) : undefined} />
}

/**
 * 「压制」徽章（v1.28.7）：`control` 的攻/防双减益是**看不见的数值变化**——
 * 不加标记的话，玩家只会发现"这波怪打人变软/变硬了"，却不知道是自己哪个角色的功劳
 * （反过来，我方队员身上出现它，就是对面那个控制角色在起作用）。
 *
 * 具体降了多少**不写在徽章上**：战斗卡只有 14~24 宽，塞不下数字。
 * 数值写在角色详情的打法说明与定位图例里，徽章只负责"现在有这回事"。
 */
export function DebuffBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`absolute rounded bg-violet-600 px-1 text-[9px] leading-4 text-white ${className}`}
      title="被控制减益压制：攻击 -20%、防御 -25%">
      压制
    </span>
  )
}