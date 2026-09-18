import { useState, useMemo, type ReactNode } from 'react'
import { AlertTriangle, Hourglass, Swords } from 'lucide-react'
import { useGame, game, charLabel, charStats, rarityInfo, itemLabel, nextGuides, newbieSteps, newbieCurrent, type GameState } from '../game/engine'
import { itemSprite } from '../game/icons'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { sceneFor } from '../game/scenes'
import { impactFxForMonster, healFx } from '../game/fx'
import { useCombatSound } from '../game/sound'
import { MAPS, isBossStage, zoneForStage, monsterForStage, DUTY_OF_ROLE, enemyUnitsForStage } from '../game/data'
import { EnemySquad, EnemyTotalBar } from './EnemySquad'
import { active, atImpact, DASH_MS, HIT_MS, IMPACT_MS, KILL_MS, DebuffBadge, FloatingNumbers, ImpactFx } from './combatFx'
import Ico from './Ico'

type Tab = 'roster' | 'combat' | 'recruit' | 'shop'

/**
 * 没有具体形象的两条建议（卡关 / 僵持）用 lucide 线性图标 —— 它们是"状态"不是"物品"，
 * 硬生一张图反而是把抽象概念具象化，越画越远。
 * 其余四条（丹药 / 结晶 / 缘分丹 / 炼丹）都有现成素材，由 `Guide.spr` 带过来。
 */
const GUIDE_GLYPH: Record<string, ReactNode> = {
  stuck: <AlertTriangle size={14} />,
  stalemate: <Hourglass size={14} />,
}

function FighterCard({ id, state, now }: { id: string | null; state: GameState; now: number }) {
  // 空位：用内嵌槽的凹陷材质，跟阵位格、装备空格是同一套"这里本该有东西"的语言
  if (!id) return <div className="dq-slot aspect-square w-14 shrink-0 sm:w-20" />
  const cdef = charLabel(id)!
  const entry = state.roster[id]
  const portrait = portraitFor(id)
  // 与实际战斗血量口径一致：星级/境界/装备加成都要算进去，否则血条分母跟真实血量对不上
  const fireId = game.fireIdOf(id) // 见 engine.fireIdOf：异火生效规则只留一份
  const maxHp = charStats(entry, cdef, fireId).hp
  const hp = state.battle?.fighterHp[id] ?? maxHp
  const alive = hp > 0
  const tint = rarityInfo(cdef.rarity).color
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
    <div className={`relative w-14 shrink-0 overflow-visible rounded border text-center text-[10px] sm:w-20 sm:text-xs ${hitEvent ? 'dq-hit-shake-left' : ''} ${isAttacking ? 'dq-attack-dash' : ''}`}
      style={{ borderColor: alive ? tint : '#7f1d1d', boxShadow: alive ? `0 2px 8px rgba(0,0,0,0.55), 0 0 10px -5px ${tint}` : '0 2px 8px rgba(0,0,0,0.55)' }}>
      {/* 立绘框。v1.44 之前这里是"一个方框 + object-cover 贴图"，而敌方那边是
          「地光 + 暗角 + 职责色描边」的一整套呈现 —— 同一场战斗里左右两边的视觉语言不一样，
          我方看上去像是没做完。这里把敌方的做法镜像过来（地光用**品阶色**，
          因为玩家认我方角色靠的是品阶），两边于是都读作"场上的一枚棋子"。
          ⚠️ 我方立绘是**带背景的方图**（不是抠底全身），所以用 object-cover 满铺；
          改 object-contain 会在四周露出一圈底、变成四个角的黑框，别照搬敌方那侧。 */}
      <div className={`relative aspect-square overflow-hidden rounded-t ${!alive ? 'dq-death-fade' : ''}`}
        style={{
          backgroundImage: `radial-gradient(ellipse 85% 55% at 50% 100%, ${tint}44 0%, rgba(0,0,0,0) 72%), linear-gradient(180deg, #1c1410 0%, #0c0806 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,214,140,0.14), inset 0 0 0 1px rgba(8,5,4,0.9)`,
        }}>
        {portrait && <img src={portrait} alt={cdef.name} className={`h-full w-full object-cover ${alive && !isAttacking ? 'dq-idle-bob' : ''}`} />}
        {/* 顶部一点点受光、底部压暗 —— 让"贴着框的方图"退成有纵深的立绘 */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(255,216,150,0.06) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(8,5,4,0.5) 100%)' }} />
      </div>
      {hitEvent && <ImpactFx src={impactFxForMonster(hitEvent.atkStyle ?? 'melee')} />}
      {isHealed && <ImpactFx src={healFx()} />}
      {debuffed && <DebuffBadge className="-right-1 -top-1" />}
      <div className="truncate px-0.5" style={{ color: tint }}>{cdef.name.slice(0, 4)}</div>
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
  // 新手之路在的时候，战斗页不再叠 mid-game 提示：新号开局就有 5 颗缘分丹，nextGuides 必然弹出
  // "攒了 5 颗缘分丹，去招募抽个新武将" —— 与新手之路第 3 步指的是同一件事。
  // 一次只给一个指令；三步走完（newbieSteps 返回 null）后 nextGuides 自然恢复。
  const guides = newbieSteps(state) ? [] : nextGuides(state)
  // 新手之路第 1 步指向的就是这个按钮：呼吸灯亮在这里（引导条自己不再亮，见 NewbiePath 注释）
  const nbBattle = newbieCurrent(state)?.key === 'battle' && !state.autoBattle

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
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1">
                <span>掉落：</span>
                <Ico name={itemSprite('coin')} className="h-3.5 w-3.5 align-[-3px]" />
                <span>灵金</span>
                <Ico name={itemSprite('crystal')} className="h-3.5 w-3.5 align-[-3px]" />
                <span>结晶</span>
                {tDrops.map((d, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <Ico name={itemSprite(d.item)} className="h-3.5 w-3.5 align-[-3px]" />
                    <span>{itemLabel(d.item).name}</span>
                  </span>
                ))}
              </div>
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
          data-newbie-hint={nbBattle ? '1' : undefined}
          className={`w-full rounded px-3 py-2 text-sm ${state.autoBattle ? 'bg-dq-fire text-black' : 'bg-dq-gold text-black'} ${nbBattle ? 'dq-breath' : ''}`}>
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
                <span className="shrink-0 text-dq-fire">
                  {g.spr ? <Ico name={g.spr} className="h-4 w-4 align-[-3px]" /> : GUIDE_GLYPH[g.kind]}
                </span>
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

          <div className="shrink-0 px-1 text-dq-fire sm:px-2"><Swords size={22} className="sm:hidden" /><Swords size={30} className="hidden sm:block" /></div>

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
              {e.type === 'drop' && `获得 ${itemLabel(e.item!).name} ×${e.value}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
