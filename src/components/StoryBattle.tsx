import { useMemo } from 'react'
import { useGame, game, charLabel, charStats, rarityInfo, fmtNum, storyNodes, type StoryBattleState } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { EnemySquad, EnemyTotalBar } from './EnemySquad'
import { sceneFor } from '../game/scenes'
import type { SceneId } from '../game/story'

/**
 * 剧情战斗的**演出层**（v1.55）。
 *
 * 用户 2026-09-22：「战斗你可以剧情的战斗不和主线战斗耦合」。
 * 引擎那一侧的耦合已经拆了（`StoryBattleState` / `startStoryBattle` / `storyBattleRound`，
 * 理由见 GameState.storyBattle 的注释）。这里解决的是**另一半**：看起来也得是两回事。
 *
 * ── 为什么不做成"跟主线战斗一模一样" ──────────────────────────────────
 * 复刻 CombatView 是最省事的路（那套斩击、飘字、冲刺、音效都现成），
 * 但那样玩家会以为自己**回到了主线**：同一个战场皮、同一个选关条、同样的"赢了推关"。
 * 而剧情战斗的规则与主线有三处实质不同，装成一样只会让人误解：
 *   · 输了**不掉任何东西**，也不记团灭 —— 重来就是
 *   · 赢了**不推主线关卡**，只完成这一格
 *   · 只有一场，**不刷下一波** —— 打完就散
 * 所以这一屏刻意做得更"轻"：用剧情那边的舞台皮（场景图 + 压暗 + 深色卡），
 * 战斗信息压成两条血条 + 一排头像。它读起来是"这一段剧情里插了一场架"，
 * 而不是"我切到了战斗页"。
 *
 * ── 手机端「一屏」──────────────────────────────────────────────────────
 * 与 StoryStage 同一套：`fixed inset-0 flex flex-col overflow-hidden`，
 * 只有中间的战报条可以滚，其余全部 `flex-none`。见 `memory/doupo-mobile-onescreen.md`。
 */
export default function StoryBattle({ battle, scene, title, onRetreat }: {
  battle: StoryBattleState
  /** 从这一格的剧本最后一句沿用的场景 —— 架要打在刚才那个地方，不是切回默认底 */
  scene: SceneId
  title: string
  onRetreat: () => void
}) {
  const state = useGame()
  // 与 CombatView 同一个口径：`tick()` 每 100ms 一次 `emit()`，用渲染时的 Date.now()
  // 去卡特效的时间窗就够了。全站只有这一种做法，别在这里另起一个 rAF 时钟。
  const now = Date.now()
  const enemies = battle.enemies
  // ⚠️ 只捞 `'story'` 的事件。三个来源互不透传（见 CombatEvent.source 的注释）——
  //    不滤的话，玩家一边挂主线时，主线那边打的怪的伤害数字会飘到这一屏上来。
  const events = useMemo(() => state.combatEvents.filter(e => e.source === 'story'), [state.combatEvents])
  const sprite = monsterSpriteFor(storyNodes(state).find(n => n.id === battle.nodeId)?.combat?.sprite ?? '')

  const bg = sceneFor(scene)
  const fighters = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  const wiped = Object.values(battle.fighterHp).every(hp => hp <= 0)

  return (
    <div data-story-battle={battle.nodeId} className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-dq-bg">
      {/* ── 战场 ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {bg
          ? <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className="absolute inset-0 bg-gradient-to-b from-dq-panel to-dq-bg" />}
        {/* 压得比剧情舞台更暗：这一屏要读的是血条和数字，背景只需要交代"在哪打" */}
        <div className="absolute inset-0 bg-gradient-to-b from-dq-bg/80 via-dq-bg/55 to-dq-bg/90" />

        <div className="absolute inset-x-0 top-0 p-3 sm:p-5">
          <div className="text-[10px] tracking-[0.22em] text-dq-ember sm:text-xs">剧情战斗</div>
          <h2 data-story-battle-title className="dq-title mt-1 truncate text-xl text-dq-goldBright sm:text-3xl">{title}</h2>
        </div>

        {/* 敌方：整体血条 + 一个一个的敌人卡（复用主线那套 EnemySquad，
            敌人卡本身没有"主线"属性，给它一份敌人列表就能画 —— 这是**真的**可以复用的一层） */}
        <div className="absolute inset-x-0 bottom-3 px-3 sm:bottom-5 sm:px-5">
          <div className="mx-auto w-full max-w-3xl">
            <EnemyTotalBar enemies={enemies} />
            <div className="mt-2 flex justify-center">
              <EnemySquad enemies={enemies} now={now} events={events} sprite={sprite} />
            </div>
          </div>
        </div>
      </div>

      {/* ── 我方血条 + 战报 ── */}
      <div data-story-battle-card
        className="max-h-[46dvh] flex-none overflow-y-auto border-t border-dq-border2 bg-dq-panel/95 px-3 py-3 backdrop-blur-sm sm:max-h-[40dvh] sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap gap-1.5">
            {fighters.map(id => <FighterChip key={id} id={id} hp={battle.fighterHp[id] ?? 0} />)}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#a89478] sm:text-xs">
            {wiped ? '全员脱力 —— 剧情战斗不掉落、不记连败，整顿一下随时重来。'
              : '这一场不影响主线：不掉关卡、不记团灭、打完不刷下一波。'}
          </p>
        </div>
      </div>

      {/* ── 底栏 ── */}
      <div className="flex flex-none items-center justify-between gap-2 border-t border-dq-border bg-dq-ink px-3 py-2 sm:px-6 sm:py-3">
        <button onClick={onRetreat} type="button" data-story-battle-retreat
          className="dq-btn dq-btn-ghost dq-tap px-3 py-2 text-sm">
          ← 退出
        </button>
        {wiped && (
          <button onClick={() => { game.stopStoryBattle(); game.startStoryBattle(battle.nodeId) }} type="button"
            data-story-battle-retry className="dq-btn dq-btn-gold dq-tap px-4 py-2 text-sm font-bold">
            再来一次 ›
          </button>
        )}
      </div>
    </div>
  )
}

/** 我方一个人的血条。刻意不含立绘/特效 —— 见文件头"做得更轻"那段 */
function FighterChip({ id, hp }: { id: string; hp: number }) {
  const state = useGame()
  const cdef = charLabel(id)
  const entry = state.roster[id]
  // 与战斗口径一致：星级/境界/装备/异火都要算，否则血条分母对不上真实血量
  const maxHp = cdef && entry ? charStats(entry, cdef, game.fireIdOf(id)).hp : 1
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0
  const dead = hp <= 0
  const tint = cdef ? rarityInfo(cdef.rarity).color : '#7f1d1d'
  const pic = portraitFor(id)
  return (
    <div data-story-fighter={id}
      className={`flex items-center gap-1.5 rounded border px-1.5 py-1 ${dead ? 'opacity-45' : ''}`}
      style={{ borderColor: dead ? '#7f1d1d' : tint }}>
      {pic
        ? <img src={pic} alt="" className="h-7 w-7 shrink-0 rounded-sm object-cover object-top" />
        : <div className="h-7 w-7 shrink-0 rounded-sm bg-dq-ink2" />}
      <div className="min-w-0">
        <div className="max-w-[5.5rem] truncate text-[10px] text-[#e6dcc8]">{cdef?.name ?? id}</div>
        <div className="mt-0.5 h-1 w-16 overflow-hidden rounded-full bg-black/60 sm:w-20">
          <div className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, background: dead ? '#7f1d1d' : tint }} />
        </div>
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-[#a89478]">{fmtNum(Math.max(0, hp))}</span>
    </div>
  )
}