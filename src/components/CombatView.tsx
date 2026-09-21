import { useState, useMemo, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Hourglass, ScrollText, Swords } from 'lucide-react'
import { useGame, game, charLabel, charStats, rarityInfo, itemLabel, nextGuides, newbieSteps, newbieCurrent, type GameState } from '../game/engine'
import { itemSprite } from '../game/icons'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { sceneFor } from '../game/scenes'
import { impactFxForMonster, healFx } from '../game/fx'
import { useCombatSound } from '../game/sound'
import { MAPS, isBossStage, zoneForStage, monsterForStage, DUTY_OF_ROLE, enemyUnitsForStage } from '../game/data'
import { EnemySquad, EnemyTotalBar } from './EnemySquad'
import BottomSheet from './BottomSheet'
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
      {/* 名字：原来是 `slice(0, 4)` 硬截（见 RosterView 同名注释）。这里本来就有 `truncate`，
          截到几个字由**格子宽度**决定、放不下给省略号，比固定切 4 个字诚实。 */}
      <div className="truncate px-0.5" style={{ color: tint }}>{cdef.name}</div>
      <div className="mx-1 mb-1 h-1.5 rounded bg-black/40">
        <div className="h-1.5 rounded bg-green-600 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
      </div>
      <FloatingNumbers events={events} refMax={maxHp} now={now} />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * 侧栏那三块，抽成组件
 *
 * ⚠️ **抽出来不是为了复用样式，是为了让手机端能把同一份内容塞进弹窗。**
 *    手机端（2026-09-21 重做）不再把侧栏竖着堆到战场上方，而是「战场占满 + 底部按钮 +
 *    选关弹窗」—— 但"选关里有哪些东西"必须**只有一份**。两边各写一遍的话，
 *    以后改掉落显示、改调档步长这种小事，迟早只改一边，而症状是
 *    "手机上少了个按钮"，没人会想到去看另一个文件。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 桌面侧栏的关卡大数字面板。手机端不渲染它 —— 那个位置换成了战场顶部的一行状态条 */
function StageInfoPanel({ stage, farming, mainStage, highestStage }: {
  stage: number; farming: boolean; mainStage: number; highestStage: number
}) {
  return (
    <div className="dq-panel rounded-md p-3 text-center">
      <div className="text-xs text-[#a89478]">{farming ? '自选关卡' : '主线关卡'}</div>
      <div className="text-3xl text-dq-gold">{stage}</div>
      <div className="text-xs text-[#a89478]">
        {farming ? `主线停在第 ${mainStage} 关` : `生涯最高 ${highestStage}`}
      </div>
    </div>
  )
}

/**
 * 选关的全部控件：调档 ±1/±5、地图快捷、掉落预览、前往/返回。
 *
 * 桌面端它是侧栏里的一块常驻面板；手机端它在底部弹窗里 —— **同一个组件**，
 * 差别只在外面包了什么容器，所以这里**不要**带 `dq-panel`（那是侧栏的材质，
 * 弹窗里再套一层会变成"面板嵌面板"的双层描边）。材质由调用方给。
 */
function StagePicker({ state, target, setTarget }: {
  state: GameState; target: number; setTarget: (n: number) => void
}) {
  const tZone = zoneForStage(target)
  const tMonster = monsterForStage(target)
  const tBoss = isBossStage(target)
  const tDrops = tZone.drops.filter(d => d.item !== 'coin')
  const farming = state.farmStage !== null
  // 未满 2 关时没有可选的档位（只能打第 1 关），整块不出现 —— 与改造前一致
  if (state.highestStage < 2) return null
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-dq-gold">选择关卡</span>
        {farming && <span className="rounded bg-dq-fire px-1.5 py-0.5 text-[10px] text-black">主线已暂停</span>}
      </div>

      {/* 调关卡档位的四个键。手机端加 `dq-tap` 与居中（实测这几个原本 27×23px，
          是全站最常连点的控件之一，而连点恰恰最需要"每次都在同一个地方按中"） */}
      <div className="mb-2 flex items-center gap-1">
        <button onClick={() => setTarget(target - 5)} className="dq-tap inline-flex w-8 items-center justify-center rounded border border-dq-border px-1 py-1 text-xs text-[#a89478] hover:text-dq-gold">−5</button>
        <button onClick={() => setTarget(target - 1)} className="dq-tap inline-flex w-7 items-center justify-center rounded border border-dq-border px-1 py-1 text-sm text-[#a89478] hover:text-dq-gold">−</button>
        <div className="flex-1 text-center text-xl text-dq-gold">{target}</div>
        <button onClick={() => setTarget(target + 1)} className="dq-tap inline-flex w-7 items-center justify-center rounded border border-dq-border px-1 py-1 text-sm text-[#a89478] hover:text-dq-gold">＋</button>
        <button onClick={() => setTarget(target + 5)} className="dq-tap inline-flex w-8 items-center justify-center rounded border border-dq-border px-1 py-1 text-xs text-[#a89478] hover:text-dq-gold">＋5</button>
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
    </>
  )
}

/** 江湖路线全景。桌面常驻（当"我在哪张图"的总览），手机端收进选关弹窗 */
function RoutePanel({ stage }: { stage: number }) {
  const currentZoneId = zoneForStage(stage).id
  return (
    <div className="dq-panel rounded-md p-3">
      <div className="mb-2 text-sm text-dq-gold">江湖路线</div>
      <div className="flex flex-wrap gap-1 sm:block sm:space-y-1">
        {MAPS.map(m => {
          const reached = stage >= m.levelReq
          const current = m.id === currentZoneId
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

  /**
   * 手机端的两点本地 UI 状态。**桌面端永远不会置位**（触发它们的按钮都是 `sm:hidden`），
   * 所以不需要 `useIsMobile` 之类的设备判断 —— 纯断点 + 一个只会被手机点到的开关，
   * 比"读 window 宽度再分支渲染"少一条会出错的路径。
   */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

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

  const logLines = mainEvents.filter(e => e.time <= now).slice(-12).reverse()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto sm:flex-row sm:gap-4 sm:p-4">
      {/* ── 桌面侧栏。手机端**整块不渲染**：那些面板改由底部按钮 + 弹窗承载 ── */}
      <aside className="hidden shrink-0 space-y-2 sm:block sm:w-56">
        <StageInfoPanel stage={stage} farming={farming} mainStage={state.stage} highestStage={state.highestStage} />
        {state.highestStage >= 2 && (
          <div className="dq-panel rounded-md p-3">
            <StagePicker state={state} target={target} setTarget={setTarget} />
          </div>
        )}
        <RoutePanel stage={stage} />
        <button onClick={() => game.toggleAutoBattle()}
          data-newbie-hint={nbBattle ? '1' : undefined}
          className={`w-full rounded px-3 py-2 text-sm ${state.autoBattle ? 'bg-dq-fire text-black' : 'bg-dq-gold text-black'} ${nbBattle ? 'dq-breath' : ''}`}>
          {state.autoBattle ? '自动出战中（点击停止）' : '开启自动出战'}
        </button>
      </aside>

      <div className={`relative flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden sm:min-h-0 sm:rounded-md sm:border sm:border-dq-border sm:p-4 ${monsterKilled ? 'dq-screen-shake' : ''}`}
        style={scene ? { backgroundImage: `linear-gradient(180deg, rgba(10,8,6,0.55), rgba(10,8,6,0.85)), url(${scene})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: '#1a1310' }}>

        {/* 手机端顶部状态条：原来是侧栏里那个「主线关卡 / 大字 / 生涯最高」的面板。
            手机上不需要一个专供大数字的面板 —— 把它压成一行，顺带把「去选关」这个
            最自然的意图接上（点整条即可），于是"选关"连按钮都不用另外占位。 */}
        <button onClick={() => setPickerOpen(true)}
          className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5 sm:hidden">
          <span className="text-dq-gold">第 {stage} 关</span>
          <span className="truncate text-[#a89478]">{zone.name} · {monsterDef.name}</span>
          {boss && <span className="shrink-0 rounded bg-dq-fire px-1 text-[10px] text-black">首领</span>}
          {farming && <span className="shrink-0 rounded bg-dq-gold px-1 text-[10px] text-black">自选</span>}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-dq-gold">选关<ChevronRight size={12} /></span>
        </button>

        {/* 桌面端标题行（含累计击杀）。手机端这一行的信息已由上面那条状态条承担 */}
        <div className="mb-3 hidden flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pt-3 text-sm sm:flex sm:px-0 sm:pt-0 sm:text-base">
          <div className="text-dq-gold">
            {zone.name} · 第 {stage} 关 · {monsterDef.name}
            {boss && <span className="ml-2 rounded bg-dq-fire px-1.5 py-0.5 text-xs text-black">首领</span>}
            {farming && <span className="ml-2 rounded bg-dq-gold px-1.5 py-0.5 text-xs text-black">自选关卡</span>}
          </div>
          <div className="text-xs text-[#a89478] sm:text-sm">累计击杀 {state.kills}</div>
        </div>

        <div className="mb-2 px-3 text-sm text-[#a89478] sm:px-0">
          <span className="sm:hidden">累计击杀 {state.kills}</span>
          {!state.battle && <span className="sm:hidden"> · </span>}
          {!state.battle && <span>尚未出战，点击"开启自动出战"</span>}
        </div>

        {guides.length > 0 && (
          <div className="mb-3 space-y-1 px-3 sm:px-0">
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
        <div className="relative mb-4 flex flex-1 items-center justify-center gap-2 px-3 sm:gap-4 sm:px-0">
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

        {/* 手机端：日志折叠开关。**放在日志容器外面**，这样容器本身的 class
            与改造前逐字一致，桌面端一个字节都没动（见下面那个 div）。 */}
        <button onClick={() => setLogOpen(v => !v)}
          className="mx-3 mb-2 flex shrink-0 items-center gap-1 rounded border border-dq-border bg-black/40 px-2 py-1.5 text-[11px] text-[#a89478] sm:hidden">
          <ScrollText size={12} />战斗日志
          <span className="ml-auto text-dq-gold">{logOpen ? '收起 ▾' : '展开 ▸'}</span>
        </button>

        <div className={`mx-3 mb-3 rounded border border-dq-border bg-black/40 p-2 text-xs sm:mx-0 sm:mb-0 sm:flex-1 sm:overflow-auto ${logOpen ? 'max-h-32 shrink-0 overflow-auto' : 'hidden sm:block'}`}>
          {logLines.map((e, i) => (
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

      {/* ── 手机端底部操作栏。
          不挂 `fixed`：它是这个 flex 列里的最后一个 `shrink-0`，天然落在拇指区，
          又不会盖住战场底部（fixed 就得再给战场补 padding 去躲它，容易漏）。
          `env(safe-area-inset-bottom)` 是刘海屏/小白条的安全区。 ── */}
      <div className="flex shrink-0 items-stretch gap-2 border-t border-dq-border bg-dq-panel p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden">
        <button onClick={() => setPickerOpen(true)}
          className="dq-tap-lg rounded border border-dq-border px-3 text-xs text-[#a89478]">选关</button>
        {farming && (
          <button onClick={() => game.setFarmStage(null)}
            className="dq-tap-lg rounded bg-dq-gold px-3 text-xs text-black">返回主线</button>
        )}
        {/* ⚠️ 这个按钮**刻意不带 `data-newbie-hint`**：那个属性是离线验收脚本的锚点
            （`[data-newbie-hint="1"]`），桌面侧栏那个按钮已经占着它了。两个都带的话，
            脚本的单数定位会一次匹配到两个元素（strict mode 当场红），
            而红的形态是"新手引导坏了"，离真正的原因很远。呼吸灯（`dq-breath`）两端都亮，
            那是纯视觉，不参与定位。 */}
        <button onClick={() => game.toggleAutoBattle()}
          className={`dq-tap-lg flex-1 rounded px-3 text-sm text-black ${state.autoBattle ? 'bg-dq-fire' : 'bg-dq-gold'} ${nbBattle ? 'dq-breath' : ''}`}>
          {state.autoBattle ? '自动出战中（点击停止）' : '开启自动出战'}
        </button>
      </div>

      {/* ── 手机端选关弹窗。内容与桌面侧栏**同一个组件**，只有外壳不同 ── */}
      {pickerOpen && (
        <BottomSheet title="关卡与路线" onClose={() => setPickerOpen(false)}>
          <StagePicker state={state} target={target} setTarget={setTarget} />
          <div className="mt-3 border-t border-dq-border pt-3">
            <RoutePanel stage={stage} />
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
