/**
 * 敌方小队（v1.28）：一关可能是 1~6 个敌人，各有职责与站位。
 *
 * 原先主线与天梯塔各画一只大怪物、共用一条血条。多单位后这段渲染要重写，
 * 与其复制两份（这次改动的教训就是"复制必然发散"），不如两个视图共用这一套。
 *
 * 布局与我方**镜像**：敌方的前排贴近中间的 ⚔，后排退到最外侧。
 * 于是"谁能打到谁"在画面上一眼可辨 —— 两边的前排都在中间，两边的后排都在外侧。
 */
import { charLabel, fmtNum, type CombatEvent } from '../game/engine'
import { DUTY_COLOR, DUTY_LABEL, type EnemyUnit } from '../game/data'
import { impactFxForRole } from '../game/fx'
import { active, atImpact, DASH_MS, HIT_MS, DebuffBadge, ImpactFx, FloatingNumbers } from './combatFx'

export function EnemyCard({ enemy, now, events, sprite, small = false }: {
  enemy: EnemyUnit
  now: number
  /** 该来源（main / lab）的全量战斗事件，组件自己过滤出落在这个敌人身上的那些 */
  events: CombatEvent[]
  sprite: string | undefined
  small?: boolean
}) {
  const hp = Math.max(0, enemy.hp)
  const alive = hp > 0
  const hits = events.filter(e => (e.type === 'dmg' || e.type === 'heal') && e.target === enemy.uid).map(atImpact)
  const hitting = hits.filter(e => active(e, now, HIT_MS) && e.type === 'dmg')
  const hitterRole = hitting.length > 0 ? charLabel(hitting[hitting.length - 1].who!)?.role : undefined
  // 是这个敌人在出手吗？——多单位后"谁在打我"必须能指认，否则玩家看不懂血是怎么掉的
  const isAttacking = events.some(e => e.type === 'monsterDmg' && e.from === enemy.uid && active(e, now, DASH_MS))

  const box = small ? 'h-14 w-14 sm:h-16 sm:w-16' : 'h-20 w-20 sm:h-24 sm:w-24'
  const wrap = small ? 'w-14 sm:w-16' : 'w-20 sm:w-24'
  const pct = enemy.maxHp > 0 ? (hp / enemy.maxHp) * 100 : 0

  return (
    <div className={`relative flex shrink-0 flex-col items-center gap-0.5 ${wrap}`}>
      <div className={`relative overflow-visible rounded border-2 bg-black/30 ${box} ${enemy.duty === 'tank' ? 'border-dq-fire' : 'border-dq-border'} ${isAttacking ? 'dq-monster-lunge' : ''}`}>
        <div className={`h-full w-full overflow-hidden rounded ${hitting.length > 0 ? 'dq-hit-shake' : ''}`}>
          {sprite ? (
            <img src={sprite} alt={enemy.name}
              className={`h-full w-full object-contain [transform:scaleX(-1)] ${alive && !isAttacking ? 'dq-idle-bob-flip' : ''} ${!alive ? 'dq-death-fade' : ''}`} />
          ) : (
            <div className="flex h-full items-center justify-center text-2xl">{enemy.duty === 'tank' ? '🛡' : enemy.duty === 'healer' ? '💚' : '👹'}</div>
          )}
        </div>
        {hitting.length > 0 && <ImpactFx src={impactFxForRole(hitterRole ?? 'melee')} rotate={hitting.length % 2 === 0 ? -18 : 12} />}
        <FloatingNumbers events={hits} refMax={enemy.maxHp} now={now} />
        {/* 职责徽章：敌方也分坦克/战斗/医师（30 关起会出现敌方的医师），
            开战前就能看清对面谁扛谁奶 —— 这正是决定"先啃哪块骨头"的情报 */}
        <span className="absolute -left-1 -top-1 rounded px-1 text-[9px] leading-4 text-black"
          style={{ background: DUTY_COLOR[enemy.duty] }}>
          {DUTY_LABEL[enemy.duty]}
        </span>
        {/* 我方控制减益打上去的标记：让"我这几个角色到底在干嘛"看得见 */}
        {enemy.debuff && <DebuffBadge className="-right-1 -top-1" />}
      </div>
      <div className="w-full truncate text-center text-[9px] text-[#a89478] sm:text-[10px]">{enemy.name}</div>
      <div className="h-1.5 w-full rounded bg-black/40">
        <div className="h-1.5 rounded bg-dq-fire transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function EnemySquad({ enemies, now, events, sprite, small = false }: {
  enemies: EnemyUnit[]
  now: number
  events: CombatEvent[]
  sprite: string | undefined
  small?: boolean
}) {
  const front = enemies.filter(e => e.position === 'front')
  const back = enemies.filter(e => e.position === 'back')
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <div className="flex flex-col justify-center gap-1 sm:gap-1.5">
        {front.map(e => <EnemyCard key={e.uid} enemy={e} now={now} events={events} sprite={sprite} small={small} />)}
      </div>
      <div className="flex flex-col justify-center gap-1 sm:gap-1.5">
        {back.map(e => <EnemyCard key={e.uid} enemy={e} now={now} events={events} sprite={sprite} small={small} />)}
      </div>
    </div>
  )
}

/**
 * 敌方总体血条。多单位后光看每个人身上的小血条很难判断"这一波还剩多少"，
 * 补一条总量条兜底；顺便报出剩余人数，让"先切谁"的收益立刻可见。
 */
export function EnemyTotalBar({ enemies }: { enemies: EnemyUnit[] }) {
  const hp = enemies.reduce((s, e) => s + Math.max(0, e.hp), 0)
  const max = enemies.reduce((s, e) => s + e.maxHp, 0)
  const alive = enemies.filter(e => e.hp > 0).length
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-[10px] text-[#a89478]">
        <span>敌方 {alive}/{enemies.length}</span>
        <span>{fmtNum(hp)} / {fmtNum(max)}</span>
      </div>
      <div className="h-3 rounded bg-black/40">
        <div className="h-3 rounded bg-dq-fire transition-[width] duration-300 ease-out"
          style={{ width: `${max > 0 ? (hp / max) * 100 : 0}%` }} />
      </div>
    </div>
  )
}