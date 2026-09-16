import { useState, useMemo } from 'react'
import { useGame, game, charLabel, charStats, rarityInfo, itemLabel, nextGuides, type GameState } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { sceneFor } from '../game/scenes'
import { impactFxForMonster, healFx } from '../game/fx'
import { useCombatSound } from '../game/sound'
import { MAPS, isBossStage, zoneForStage, monsterForStage, DUTY_OF_ROLE, enemyUnitsForStage } from '../game/data'
import { EnemySquad, EnemyTotalBar } from './EnemySquad'
import { active, atImpact, DASH_MS, HIT_MS, IMPACT_MS, KILL_MS, DebuffBadge, FloatingNumbers, ImpactFx } from './combatFx'

type Tab = 'roster' | 'combat' | 'recruit' | 'shop'

function FighterCard({ id, state, now }: { id: string | null; state: GameState; now: number }) {
  if (!id) return <div className="aspect-square w-14 shrink-0 rounded border border-dashed border-dq-border sm:w-20" />
  const cdef = charLabel(id)!
  const entry = state.roster[id]
  const portrait = portraitFor(id)
  // 与实际战斗血量口径一致：星级/境界/装备加成都要算进去，否则血条分母跟真实血量对不上
  const fireId = game.fireIdOf(id) // 见 engine.fireIdOf：异火生效规则只留一份
  const maxHp = charStats(entry, cdef, fireId).hp
  const hp = state.battle?.fighterHp[id] ?? maxHp
  const alive = hp > 0
  const mine = state.combatEvents.filter(e => e.source === 'main' && e.who === id)
  // 受击特效按**打我那个敌人的招式**上色（v1.28：每个敌人各有招式，不再是全场统一一种）
  const hitEvent = mine.find(e => e.type === 'monsterDmg' && active(atImpact(e), now, HIT_MS))
  const isHealed = mine.some(e => e.type === 'heal' && active(atImpact(e), now, IMPACT_MS))
  // 治疗角色出手时也"冲刺"（冲过去加血），所以 heal 事件对医师同样算攻击动作
  const isAttacking = mine.some(e => (e.type === 'dmg' || (e.type === 'heal' && DUTY_OF_ROLE[cdef.role] === 'healer')) && active(e, now, DASH_MS))
  const events = mine.filter(e => e.type === 'monsterDmg' || e.type === 'heal').map(atImpact)
  // 被敌方控制角色压制中：不标出来玩家只会觉得"我的输出莫名其妙变低了"
  const debuffed = !!state.battle?.fighterDebuff?.[id]
  return (
    <div className={`relative w-14 shrink-0 overflow-visible rounded border text-center text-[10px] sm:w-20 sm:text-xs ${alive ? 'border-dq-border' : 'border-red-900'} ${hitEvent ? 'dq-hit-shake-left' : ''} ${isAttacking ? 'dq-attack-dash' : ''}`}>
      <div className={`aspect-square overflow-hidden rounded-t ${!alive ? 'dq-death-fade' : ''}`}>
        {portrait && <img src={portrait} alt={cdef.name} className={`h-full w-full object-cover ${alive && !isAttacking ? 'dq-idle-bob' : ''}`} />}
      </div>
      {hitEvent && <ImpactFx src={impactFxForMonster(hitEvent.atkStyle ?? 'melee')} />}
      {isHealed && <ImpactFx src={healFx()} />}
      {debuffed && <DebuffBadge className="-right-1 -top-1" />}
      <div className="truncate px-0.5" style={{ color: rarityInfo(cdef.rarity).color }}>{cdef.name.slice(0, 4)}</div>
      <div className="mx-1 mb-1 h-1.5 rounded bg-black/40">
        <div className="h-1.5 rounded bg-green-600 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
      </div>
      <FloatingNumbers events={events} refMax={maxHp} now={now} />
    </div>
  )
}

export default function CombatView({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const state = useGame()
  const farming = state.farmStage !== null
  const stage = state.farmStage ?? state.stage
  const zone = zoneForStage(stage)
  const monsterDef = monsterForStage(stage)
  const boss = isBossStage(stage)
  const monsterSprite = monsterSpriteFor(monsterDef.id)
  const scene = sceneFor(zone.id)
  const now = Date.now()
  // 未出战时也要把"对面站了谁"画出来：敌方阵容是关卡的纯函数，开战前就能看清对面几个人、谁是坦克
  const previewEnemies = useMemo(() => enemyUnitsForStage(stage), [stage])
  const enemies = state.battle?.enemies ?? previewEnemies
  const enemyName = (uid?: string) => enemies.find(e => e.uid === uid)?.name ?? '敌人'

  // 刷材料选关：目标关卡本地状态，默认选「生涯最高关 − 1」（卡关时刚好能稳定刷的最后一关）
  const maxFarm = Math.max(1, state.highestStage)
  const [targetRaw, setTargetRaw] = useState(() => Math.max(1, state.highestStage - 1))
  const target = Math.min(Math.max(1, targetRaw), maxFarm)
  const setTarget = (n: number) => setTargetRaw(Math.min(Math.max(1, n), maxFarm))
  const tZone = zoneForStage(target)
  const tMonster = monsterForStage(target)
  const tBoss = isBossStage(target)
  const tDrops = tZone.drops.filter(d => d.item !== 'coin')

  const mainEvents = state.combatEvents.filter(e => e.source === 'main')
  useCombatSound(mainEvents)
  // 挨打/出手/被击败的演出由 EnemyCard 自己按 uid 判定，这里只留屏幕级的那一个
  const monsterKilled = mainEvents.some(e => e.type === 'kill' && active(atImpact(e), now, KILL_MS))
  const guides = nextGuides(state)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:flex-row sm:gap-4 sm:p-4">
      <div className="shrink-0 space-y-2 sm:w-56">
        <div className="dq-panel rounded-md p-3 text-center">
          <div className="text-xs text-[#a89478]">{farming ? '自选关卡' : '主线关卡'}</div>
          <div className="text-3xl text-dq-gold">{stage}</div>
          <div className="text-xs text-[#a89478]">
            {farming ? `主线停在第 ${state.stage} 关` : `生涯最高 ${state.highestStage}`}
          </div>
        </div>

        {state.highestStage >= 2 && (
          <div className="dq-panel rounded-md p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-dq-gold">选择关卡</span>
              {farming && <span className="rounded bg-dq-fire px-1.5 py-0.5 text-[10px] text-black">主线已暂停</span>}
            </div>

            <div className="mb-2 flex items-center gap-1">
              <button onClick={() => setTarget(target - 5)} className="w-8 rounded border border-dq-border px-1 py-1 text-xs text-[#a89478] hover:text-dq-gold">−5</button>
              <button onClick={() => setTarget(target - 1)} className="w-7 rounded border border-dq-border px-1 py-1 text-sm text-[#a89478] hover:text-dq-gold">−</button>
              <div className="flex-1 text-center text-xl text-dq-gold">{target}</div>
              <button onClick={() => setTarget(target + 1)} className="w-7 rounded border border-dq-border px-1 py-1 text-sm text-[#a89478] hover:text-dq-gold">＋</button>
              <button onClick={() => setTarget(target + 5)} className="w-8 rounded border border-dq-border px-1 py-1 text-xs text-[#a89478] hover:text-dq-gold">＋5</button>
            </div>

            <div className="mb-2 text-[11px] leading-relaxed text-[#a89478]">
              <span className="text-[#e8dcc8]">{tZone.name} · {tMonster.name}</span>
              {tBoss && <span className="ml-1 rounded bg-dq-fire px-1 text-[10px] text-black">首领</span>}
              <div className="mt-0.5">掉落：🪙灵金 💎结晶{tDrops.length > 0 ? ' ' + tDrops.map(d => itemLabel(d.item).icon + itemLabel(d.item).name).join(' ') : ''}</div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {MAPS.filter(m => state.highestStage >= m.levelReq).map(m => (
                <button key={m.id} onClick={() => setTarget(m.levelReq)}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${tZone.id === m.id ? 'border-dq-gold text-dq-gold' : 'border-dq-border text-[#a89478] hover:text-dq-gold'}`}>
                  {m.name}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              {farming && (
                <button onClick={() => game.setFarmStage(null)}
                  className="w-full rounded bg-dq-gold px-3 py-2 text-sm text-black">
                  返回主线（第 {state.stage} 关）
                </button>
              )}
              <button onClick={() => game.setFarmStage(target)}
                disabled={farming && state.farmStage === target}
                className="w-full rounded bg-dq-fire px-3 py-2 text-sm text-black disabled:opacity-40">
                {farming && state.farmStage === target ? `正在第 ${target} 关战斗` : `前往第 ${target} 关战斗`}
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-[#5a4a38]">在自选关卡战斗只拿掉落、不推进主线，练强后点「返回主线」继续闯关</div>
          </div>
        )}

        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">江湖路线</div>
          <div className="flex flex-wrap gap-1 sm:block sm:space-y-1">
            {MAPS.map(m => {
              const reached = stage >= m.levelReq
              const current = m.id === zone.id
              return (
                <div key={m.id}
                  className={`rounded border px-2 py-1 text-xs sm:text-sm ${current ? 'border-dq-gold text-dq-gold' : reached ? 'border-dq-border text-[#e8dcc8]' : 'border-dq-border text-[#5a4a38]'}`}>
                  {m.name} <span className="text-[10px] sm:text-xs">Lv.{m.levelReq}+</span>
                  {current && <span className="ml-1 text-[10px] sm:text-xs">（当前）</span>}
                </div>
              )
            })}
          </div>
          <div className="mt-2 text-[11px] text-[#a89478]">击杀会自动推进到下一关，怪物随关卡数持续变强，每 5 关一个首领</div>
        </div>

        <button onClick={() => game.toggleAutoBattle()}
          className={`w-full rounded px-3 py-2 text-sm ${state.autoBattle ? 'bg-dq-fire text-black' : 'bg-dq-gold text-black'}`}>
          {state.autoBattle ? '自动出战中（点击停止）' : '开启自动出战'}
        </button>
      </div>

      <div className={`relative flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-dq-border p-3 sm:min-h-0 sm:p-4 ${monsterKilled ? 'dq-screen-shake' : ''}`}
        style={scene ? { backgroundImage: `linear-gradient(180deg, rgba(10,8,6,0.55), rgba(10,8,6,0.85)), url(${scene})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: '#1a1310' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm sm:text-base">
          <div className="text-dq-gold">
            {zone.name} · 第 {stage} 关 · {monsterDef.name}
            {boss && <span className="ml-2 rounded bg-dq-fire px-1.5 py-0.5 text-xs text-black">首领</span>}
            {farming && <span className="ml-2 rounded bg-dq-gold px-1.5 py-0.5 text-xs text-black">自选关卡</span>}
          </div>
          <div className="text-xs text-[#a89478] sm:text-sm">累计击杀 {state.kills}</div>
        </div>

        {!state.battle && (
          <div className="mb-2 text-sm text-[#a89478]">尚未出战，点击"开启自动出战"</div>
        )}

        {guides.length > 0 && (
          <div className="mb-3 space-y-1">
            {guides.map((g, i) => (
              <button key={i} onClick={() => onNavigate(g.tab)}
                className="flex w-full items-center gap-2 rounded border border-dq-fire bg-black/50 px-2 py-1.5 text-left text-xs hover:bg-black/70">
                <span>{g.icon}</span>
                <span className="flex-1 text-[#e8dcc8]">{g.text}</span>
                <span className="text-dq-gold">去看看 ›</span>
              </button>
            ))}
          </div>
        )}

        {/* 左右对战布局：我方阵容（后排+前排）── VS ── 敌方 */}
        <div className="relative mb-4 flex flex-1 items-center justify-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex flex-col justify-center gap-1.5 sm:gap-2">
              {state.team.back.map((id, i) => <FighterCard key={`b${i}`} id={id} state={state} now={now} />)}
            </div>
            <div className="flex flex-col justify-center gap-1.5 sm:gap-2">
              {state.team.front.map((id, i) => <FighterCard key={`f${i}`} id={id} state={state} now={now} />)}
            </div>
          </div>

          <div className="shrink-0 px-1 text-lg text-dq-fire sm:px-2 sm:text-2xl">⚔</div>

          <div className="flex shrink-0 flex-col items-center gap-2">
            <EnemySquad enemies={enemies} now={now} events={mainEvents} sprite={monsterSprite} />
            {state.battle && <div className="w-44 sm:w-56"><EnemyTotalBar enemies={enemies} /></div>}
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded border border-dq-border bg-black/40 p-2 text-xs">
          {mainEvents.filter(e => e.time <= now).slice(-12).reverse().map((e, i) => (
            <div key={i} className="text-[#a89478]">
              {e.type === 'dmg' && `${charLabel(e.who!)?.name ?? ''} 对 ${enemyName(e.target)} 造成 ${e.value} 伤害`}
              {e.type === 'heal' && `${charLabel(e.who!)?.name ?? ''} 回复 ${e.value} 气血`}
              {e.type === 'monsterDmg' && `${enemyName(e.from)} 对 ${charLabel(e.who!)?.name ?? ''} 造成 ${e.value} 伤害`}
              {e.type === 'down' && `${charLabel(e.who!)?.name ?? ''} 倒下了`}
              {e.type === 'kill' && `击败 ${e.who}！`}
              {e.type === 'drop' && `获得 ${itemLabel(e.item!).icon}${itemLabel(e.item!).name} ×${e.value}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
