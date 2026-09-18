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
import { Shield, Heart, Skull } from 'lucide-react'
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

  // v1.44：立绘从 256² 像素画换成 512² 半写实插画，卡片跟着放大一档
  // （small 是爬塔页的紧凑档，那里一屏要放 4 层敌人）。
  const box = small ? 'h-16 w-16 sm:h-20 sm:w-20' : 'h-24 w-24 sm:h-28 sm:w-28'
  const wrap = small ? 'w-16 sm:w-20' : 'w-24 sm:w-28'
  const pct = enemy.maxHp > 0 ? (hp / enemy.maxHp) * 100 : 0
  const tint = DUTY_COLOR[enemy.duty]

  return (
    <div className={`relative flex shrink-0 flex-col items-center gap-1 ${wrap}`}>
      {/* 立绘底：职责色的余光从脚下往上打，再压一层暗角 ——
          纯色方块里贴一张抠好的立绘会"飘"，有地光才有立足点。 */}
      <div
        className={`relative overflow-visible rounded-md border ${box} ${isAttacking ? 'dq-monster-lunge' : ''}`}
        style={{
          borderColor: enemy.duty === 'tank' ? '#ff6a1a' : '#3a2a1a',
          backgroundImage: `radial-gradient(ellipse 90% 55% at 50% 100%, ${tint}44 0%, rgba(0,0,0,0) 72%), radial-gradient(120% 120% at 50% 0%, rgba(255,216,150,0.07) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #1c1410 0%, #0c0806 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,214,140,0.14), inset 0 0 0 1px rgba(8,5,4,0.9), 0 3px 10px rgba(0,0,0,0.55)${alive ? `, 0 0 12px -4px ${tint}66` : ''}`,
        }}>
        <div className={`h-full w-full overflow-hidden rounded-md ${hitting.length > 0 ? 'dq-hit-shake' : ''}`}>
          {sprite ? (
            /* ⚠️ **这里绝不能再加 `[transform:scaleX(-1)]`**。
               v1.44 起 32 张反派立绘的「朝左」是**烧进素材里**的（生图时就是严格左侧身），
               而 CSS 的静态 transform 会被任何一条动画的关键帧整条覆盖 ——
               原先 `dq-monster-lunge`（出手）与 `dq-death-fade`（死亡）的关键帧里
               都没有 `scaleX(-1)`，于是敌人每次出手、死亡的瞬间会当场翻回朝右。
               「定位交给外层、动画交给内层」是同一个坑的通用解，见 index.css 顶部第 3 条。 */
            <img src={sprite} alt={enemy.name}
              className={`h-full w-full object-contain ${alive && !isAttacking ? 'dq-idle-bob' : ''} ${!alive ? 'dq-death-fade' : ''}`} />
          ) : (
            <div className="flex h-full items-center justify-center" style={{ color: tint }}>
              {/* 兜底：素材键与产物不同步时（新加了怪却没出图）绝不能留白。
                  用职责图标而不是 emoji —— 至少颜色还对得上职责色，一眼能读出"对面这块是谁" */}
              {enemy.duty === 'tank' ? <Shield size={28} /> : enemy.duty === 'healer' ? <Heart size={28} /> : <Skull size={28} />}
            </div>
          )}
        </div>
        {hitting.length > 0 && <ImpactFx src={impactFxForRole(hitterRole ?? 'melee')} rotate={hitting.length % 2 === 0 ? -18 : 12} />}
        <FloatingNumbers events={hits} refMax={enemy.maxHp} now={now} />
        {/* 职责徽章：敌方也分坦克/战斗/医师（30 关起会出现敌方的医师），
            开战前就能看清对面谁扛谁奶 —— 这正是决定"先啃哪块骨头"的情报 */}
        <span className="dq-chip absolute -left-1 -top-1 font-semibold"
          style={{ color: '#0c0806', background: tint, borderColor: 'rgba(0,0,0,0.4)' }}>
          {DUTY_LABEL[enemy.duty]}
        </span>
        {/* 我方控制减益打上去的标记：让"我这几个角色到底在干嘛"看得见 */}
        {enemy.debuff && <DebuffBadge className="-right-1 -top-1" />}
      </div>
      <div className="w-full truncate text-center text-[9px] text-[#a89478] sm:text-[10px]">{enemy.name}</div>
      <div className={`dq-bar h-1.5 w-full ${!alive ? 'opacity-40' : ''}`}>
        <div className="dq-bar-in bg-dq-fire" style={{ width: `${pct}%`, color: '#ff6a1a' }} />
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
      <div className="dq-bar h-3">
        <div className="dq-bar-in bg-gradient-to-b from-[#ffb066] to-[#b83a0e]"
          style={{ width: `${max > 0 ? (hp / max) * 100 : 0}%`, color: '#ff6a1a' }} />
      </div>
    </div>
  )
}