import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame, game, fmtNum, charLabel } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { boss2SpriteFor } from '../game/monsters'
import { remainMs, fmtDuration, rewardLabelsOf, type WbState } from '../game/worldboss'
import {
  useWorldBoss2, useWorldBoss2Error, useWorldBoss2Queued,
  useWorldBoss2PollSeq, useWorldBoss2PollDelta,
  refreshWorldBoss2, queueLinkDamage, flushQueuedLinkDamage,
} from '../game/worldboss2'
import LinkLinkBoard from './LinkLinkBoard'
import RankBadge from './RankBadge'

/**
 * 第二只世界 Boss（万魂锁尊 · **连连看**讨伐）页。
 *
 * 与第一只（`WorldBossView.tsx`）的关系：**版式抄，代码抄，锚点不抄**。
 *
 *   · 版式一模一样（血条在上、讨伐榜、我的贡献面板、盘面、部队、日志）——
 *     两只 Boss 是同一个活动的两种玩法，玩家不该学两套界面。
 *   · 代码是**副本**：`RankRow` / `RankList` / `MySquad` / `flagHue` 这几个从那边抄了过来。
 *     本来可以抽出共用，但**刻意不抽** —— 这一轮的第一原则是"第一只一个字节都不动"，
 *     而动共用组件就是动第一只。两只 Boss 的展示将来也会分化（榜单口径、奖励文案）。
 *     ⚠️ 改了那边这几个组件，记得回来看这里。
 *   · 锚点族是**新的 `data-wb2-*`**（页面级）+ `data-ll-*`（盘面，见 LinkLinkBoard）。
 *     绝不能沿用 `data-wb-*`：那族锚点有回归脚本在用（`verify-wb-*`、`probe-boss-jitter`），
 *     第二只页面上出现同名的锚点会让"第一只零改动"这件事没法验证。
 *
 * **不做付费重启**（本轮出界）：没有重启按钮、没有"花费 N 灵金"那一块、也没有
 * "有人重启了世界 Boss"的全服通知横幅（那三种通知本来就只有重启这一种）。
 *
 * 玩法与伤害的换算全在 `linklink.ts`（每对多少伤害、连击怎么加成）；这一页只负责
 * 把盘面交上来的数**攒起来上报**，以及把服务端的状态念出来。**这里不写任何伤害系数。**
 */

/** 给每个人一方颜色稳定的色块：同名同色，刷新不变（沿用第一只那套算法 ——
 *  同一个玩家在两只 Boss 的榜上该是同一个颜色） */
function flagHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** 讨伐榜的一行：名次 · 名字 · 伤害条 · 伤害原值 · 伤害百分比 */
function RankRow({ rank, name, damage, pct, mine }: { rank: number; name: string; damage: number; pct: number; mine?: boolean }) {
  const hue = flagHue(name)
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div
      data-wb2-flag={mine ? 'me' : name}
      data-wb2-rank-row={rank}
      title={`${name} · 第 ${rank} 名 · 造成 ${damage} 伤害 · 占全服 ${pct.toFixed(1)}%`}
      className={`flex items-center gap-1.5 rounded px-1 py-[3px] ${mine ? 'bg-dq-gold/10 ring-1 ring-dq-gold/40' : ''}`}>
      <RankBadge rank={rank} className={`h-4 w-4 shrink-0 text-[10px] ${mine ? 'text-dq-gold' : 'text-[#6b5b47]'}`} />
      <span
        className={`w-[16px] shrink-0 rounded-sm border border-black/50 ${mine ? 'ring-1 ring-dq-gold' : ''}`}
        style={{ background: `linear-gradient(160deg, hsl(${hue} 55% 45%), hsl(${hue} 60% 28%))` }}
      />
      <span className={`w-[58px] shrink-0 truncate text-[10px] sm:w-[68px] ${mine ? 'font-bold text-dq-gold' : 'text-[#c9bda4]'}`}>
        {name}
      </span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/50">
        <div className={`h-full rounded-full ${mine ? 'bg-dq-gold' : 'bg-dq-fire/70'}`} style={{ width: `${w}%` }} />
      </div>
      {/* tabular-nums + 定宽：这个数字每消一笔就变一次、位数也会变，不定宽整行会跟着左右抽动 */}
      <span className="w-[42px] shrink-0 text-right tabular-nums text-[10px] text-[#a89478] sm:w-[48px]">{fmtNum(damage)}</span>
      <span className={`w-[38px] shrink-0 text-right tabular-nums text-[10px] ${mine ? 'text-dq-gold' : 'text-dq-fire'}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

/**
 * 竖排讨伐榜。铁律与第一只相同：**无论多少人，「我」永远钉在最上面并高亮**。
 * 高度写死 + 内部滚动，理由也相同（它是 flex-1 的 BOSS 区底下的东西，长一截就把立绘顶上去一截）。
 */
function RankList({ state, contribPct }: { state: WbState; contribPct: number }) {
  const me = state.me
  const myRank = me?.rank ?? 0
  const rows = useMemo(() => {
    const hit = myRank > 0 ? state.board.find(r => r.rank === myRank) : undefined
    const mineRow = me
      ? { rank: myRank || 0, name: '我', damage: me.damage, pct: hit ? hit.pct : contribPct }
      : null
    const others = state.board.filter(r => !mineRow || r.rank !== myRank)
    return { mineRow, others }
  }, [state.board, me, myRank, contribPct])
  // ⚠️「还有多少人」按 participants 算，**不能按手上这几行算**：榜单服务端只回前 10 行
  const notDrawn = Math.max(0, state.participants - (rows.mineRow ? 1 : 0) - rows.others.length)
  return (
    <div className="rounded border border-dq-border bg-black/30" data-wb2-reinforce>
      <div className="flex items-baseline justify-between border-b border-dq-border/60 px-2 py-0.5">
        <span className="text-[10px] text-dq-gold">讨伐榜</span>
        <span className="tabular-nums text-[10px] text-[#a89478]">
          {state.participants} 人合击
          {me && myRank > 0 && <span className="ml-1 text-dq-gold" title={`超过 ${me.percentile}% 的人`}>· 我第 {myRank} 名</span>}
          {notDrawn > 0 && <span className="ml-1">· 还有 {notDrawn} 人</span>}
        </span>
      </div>
      <div className="max-h-[48px] overflow-y-auto px-1 py-0.5 md:max-h-[96px]">
        {rows.mineRow
          ? <RankRow rank={rows.mineRow.rank} name={rows.mineRow.name} damage={rows.mineRow.damage} pct={rows.mineRow.pct} mine />
          : <div className="px-1 py-1 text-center text-[10px] text-[#6b5b47]">还没有人出手，消掉一对就是伤害</div>}
        {rows.others.map(r => <RankRow key={r.rank} rank={r.rank} name={r.name} damage={r.damage} pct={r.pct} />)}
        {!rows.mineRow && rows.others.length === 0 && <div className="h-[18px]" />}
      </div>
    </div>
  )
}

/** 我上阵的 6 名角色（别人的阵容是隐私）。只画我的 */
function MySquad({ state }: { state: ReturnType<typeof useGame> }) {
  const slots = [...state.team.front, ...state.team.back]
  return (
    <div className="flex justify-center gap-1" data-wb2-squad>
      {slots.map((id, i) => {
        const cdef = (id && charLabel(id)) || null
        const p = id ? portraitFor(id) : undefined
        return (
          <div key={i} className="relative w-9 shrink-0 overflow-hidden rounded border border-dq-border sm:w-10">
            <div className="aspect-square bg-black/40">
              {p && cdef && <img src={p} alt={cdef.name} className="dq-idle-bob h-full w-full object-cover" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function WorldBoss2View() {
  const state = useGame()
  const wb = useWorldBoss2()
  const err = useWorldBoss2Error()
  const reward = useMemo(() => rewardLabelsOf(wb?.reward ?? null), [wb?.reward])
  const [tick, setTick] = useState(() => Date.now())
  const logRef = useRef<{ text: string; at: number; amount?: number }[]>([])
  const [, forceLog] = useState(0)
  const wbRef = useRef(wb)
  useEffect(() => { wbRef.current = wb }, [wb])
  const queued = useWorldBoss2Queued()
  const pollSeq = useWorldBoss2PollSeq()
  const pollDelta = useWorldBoss2PollDelta()
  // 注：轮询**不在这里**启动 —— 那是 App 层 WorldBossWiring 的活，
  // 因为它必须在离开这一页之后继续跑（血条是全服的，切页不该让它停）。

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  /**
   * amount 只在「我这一击」时给：它是**服务端收下的**伤害原值（文字里那个数被 fmtNum 缩写过，对不了账）。
   *
   * ⚠️ 必须是 `useCallback`：`onLinkClear` 要交给 `LinkLinkBoard`，而那个组件是 `memo` 过的 ——
   *    回调用内联箭头函数的话，父组件每 2 秒轮询一次就换一个新身份，memo 一次都拦不住，
   *    48 个格子照旧全量重建（消消乐那边"卡卡的"就是这么来的）。
   */
  const push = useCallback((text: string, amount?: number) => {
    logRef.current = [{ text, at: Date.now(), amount }, ...logRef.current].slice(0, 40)
    forceLog(n => n + 1)
  }, [])

  // 轮询回来的"这一分钟**别人**打掉了多少"：跨玩家事件，让共斗感落在一行字上。
  // 读数里已经扣掉了我自己（见 worldboss2.ts 的 pollBaseDealt）
  useEffect(() => {
    if (pollSeq <= 0 || pollDelta <= 0) return
    push(`全服合力打掉 ${fmtNum(pollDelta)}（血条剩 ${(wbRef.current?.remainPct ?? 0).toFixed(1)}%）`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollSeq])

  // 换期了就把日志清掉，免得上一期的战报挂在新一期下面
  useEffect(() => { logRef.current = []; forceLog(n => n + 1); lastKills.current = null }, [wb?.period])

  /**
   * 打赢一次报一句。判据是 **kills 的上升沿**，不是 defeated 的 ——
   * 一天要打赢三次，而服务端是"打穿即重生"，回执里 defeated 当场就是 false，
   * 拿它做上升沿的话第 1、2 次击败根本不会被看见。
   * lastKills 用 null 起手：刚进页面拉到的那个 kills 是"当前战绩"，不是"我刚打赢"。
   */
  const lastKills = useRef<number | null>(null)
  useEffect(() => {
    const k = wb?.kills ?? 0
    if (lastKills.current === null) { lastKills.current = k; return }
    if (k > lastKills.current) {
      const max = wb?.maxKills ?? 3
      push(k < max
        ? `第 ${k} 次击败！${wb?.boss.name ?? 'BOSS'} 倒下，奖励已发到邮箱，血条已重置`
        : `第 ${k} 次击败！本轮 ${max} 次讨伐已毕，奖励已发到邮箱`)
    }
    lastKills.current = k
  }, [wb?.kills])

  // 离开页面 / 切到后台时，把攒在队列里的伤害送出去。
  // 连连看的伤害同样是先攒后发的（服务端 2 秒冷却），不解这一下，玩家刚消完就切页会丢掉几笔。
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushQueuedLinkDamage() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushQueuedLinkDamage)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushQueuedLinkDamage)
      flushQueuedLinkDamage()   // 切到别的页签（组件卸载）同样要送出去
    }
  }, [])

  /**
   * 立绘的**受击动作**：整体微微一沉、随即弹回（transform 而已）。
   * 刻意排除的两种做法与第一只相同：左右来回 = 抖；改 brightness/opacity = 闪。
   * 挂在 wrapper 上、不挂在 img 上（img 带着呼吸动画，两者挤在同一个元素上会互相覆盖 transform）。
   */
  const bossRef = useRef<HTMLDivElement | null>(null)
  const hitAnim = useCallback((combo: number) => {
    const el = bossRef.current
    if (!el || typeof el.animate !== 'function') return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const deep = combo > 1 ? 9 : 6
    el.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: `translateY(${deep}px) scale(${combo > 1 ? 0.982 : 0.99})` },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: combo > 1 ? 300 : 240, easing: 'ease-out' })
  }, [])

  /**
   * 连消一对：进队列，并往日志里记一条。**伤害不在这里发送** —— 见 queueLinkDamage。
   *
   * ⚠️ 这里**只 bump「boss.hit」，不 bump「match3.tiles」**：连连看一次消的是一对（2 格），
   *    而 `match3.tiles` 这个指标的名字就写着"格"、第一只按"消掉几格"记 ——
   *    把连连看折成格数灌进去，等于让玩第二只的人给第一只的活动进度加速。
   *    两只 Boss 都算的只有"出手了一次"（`boss.hit`），这也正是计划里定的口径。
   */
  const onLinkClear = useCallback((damage: number, combo: number) => {
    queueLinkDamage(damage, 1)
    game.bumpMetric('boss.hit', 1)
    hitAnim(combo)
    push(`连消一对${combo > 1 ? ` · ${combo} 连击` : ''}，造成 ${fmtNum(damage)} 伤害`, damage)
  }, [hitAnim, push])

  const me = wb?.me
  /** 我的贡献度 = 我打的 ÷ 全服已打。**就在本地算**（服务端那份只在每分钟的轮询里刷新，
   *  而盘面每几百毫秒就推一笔，用它会看到"我打了半天贡献度不动"）。奖励就是按它分的 */
  const contribPct = me && wb && wb.dealt > 0 ? Math.min(100, (me.damage / wb.dealt) * 100) : 0
  const maxKills = wb?.maxKills ?? 3
  const kills = wb?.kills ?? 0
  const done = kills >= maxKills
  /** 锁盘面的条件：三次打满，或本期到点。**不含 defeated**（那是"这一轮刚被打穿、正在结算"，
   *  服务端会立刻把血条立起来，锁上去只会让盘面在下一笔回执之前闪一下） */
  const defeated = done || !!wb?.ended
  const ended = !!wb?.ended
  const sprite = boss2SpriteFor(wb?.boss.form ?? 1)

  if (!wb) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[#a89478]">
        <div>魂锁讨伐的数据还没拉下来…</div>
        {err && <div className="text-xs text-red-400">（{err}）</div>}
        <button onClick={() => void refreshWorldBoss2()} className="rounded border border-dq-border px-3 py-1 text-xs text-dq-gold">重试</button>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      // 给测试留的原始数值出口（与第一只同一口径：fmtNum 会缩写成「1629万」，
      // 靠解析中文文本对账既脆又验不准 —— 权威值本来就在服务端，直接暴露原值）
      data-wb2-period={wb.period}
      data-wb2-dealt={wb.dealt}
      data-wb2-totalhp={wb.totalHp}
      data-wb2-participants={wb.participants}
      data-wb2-me-damage={me?.damage ?? 0}
      data-wb2-me-pct={Math.round(contribPct * 10) / 10}
      data-wb2-me-rank={me?.rank ?? 0}
      data-wb2-defeated={defeated ? '1' : '0'}
      data-wb2-kills={kills}
      data-wb2-maxkills={maxKills}>
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-dq-border bg-black/30 px-2 py-1 text-[10px] sm:px-4 sm:text-xs">
        <span className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-dq-gold">魂锁讨伐 · 第 {wb.period} 期</span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${done ? 'border-dq-qing text-dq-qing' : 'border-dq-gold/60 text-dq-gold'}`}
            data-wb2-killlabel={`${kills}/${maxKills}`}>
            本轮已讨伐 {kills}/{maxKills}{done ? ' · 已毕' : ''}
          </span>
        </span>
        <span className="text-[#a89478]">
          {ended ? '本期已结束，等开新一期' : <>距结算 <span className="tabular-nums text-dq-fire">{fmtDuration(remainMs(wb, tick))}</span></>}
        </span>
      </div>

      {/* 主区：桌面左右分栏。⚠️ 桌面**居中并封顶 1120px** 的理由与第一只逐字相同
          （见 `WorldBossView.tsx` 那段）：不封顶则屏幕越宽 boss 越横着长，
          而用户 2026-09-20 要的是"盘面变大、boss 变小"。两只玩法**必须用同一个封顶值**，
          否则玩家在子页签之间切换时左栏宽度会跳一下。 */}
      <div className="flex min-h-0 flex-1 flex-col md:mx-auto md:w-full md:max-w-[1120px] md:flex-row">
        {/* BOSS 区：吃掉所有富余高度。立绘是整幅插画（自带背景），object-cover 铺满 */}
        <div className="relative min-h-[80px] flex-1 overflow-hidden bg-[#0b0710]">
          <div ref={bossRef} className="absolute inset-0" data-wb2-boss-hit>
            {sprite
              ? <img src={sprite} alt={wb.boss.name} className="dq-boss-breathe h-full w-full object-cover object-[center_30%]" />
              // 立绘还没出（`sprites/boss2/` 是空目录时 `BOSS2_FORM_MAX` 为 0，见 monsters.ts）——
              // 渲染一行名字占位，而不是留一块纯黑（"立绘凭空消失"最像 bug）。
              // 图放进去之后这条分支自然就不再走到。
              : <div className="flex h-full w-full items-center justify-center text-2xl font-bold tracking-[0.3em] text-[#4a3556] sm:text-4xl">{wb.boss.name}</div>}
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-8 pr-12 sm:px-4 sm:pr-14">
            <div className="mb-1 flex items-baseline justify-between text-[11px] sm:text-sm">
              <span className="font-bold text-dq-gold">{wb.boss.name}<span className="ml-1.5 text-[10px] font-normal text-[#a89478]">{wb.boss.formLabel}</span></span>
              <span className="text-[#a89478]">{wb.participants} 人合击</span>
            </div>
            <div className="h-3.5 w-full overflow-hidden rounded-sm border border-dq-border bg-black/60 sm:h-5">
              <div className="h-full bg-gradient-to-r from-violet-700 via-dq-fire to-amber-400 transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, 100 - wb.remainPct))}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-[#a89478] sm:text-xs">
              <span>全服已打 {fmtNum(wb.dealt)} / {fmtNum(wb.totalHp)}</span>
              <span className="text-dq-fire">{wb.progressPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* 玩法栏。桌面固定 **480px**（v1.52，原 424）。
            ⚠️ v1.47 手机端专项把桌面宽度 372 → 424：372 是**第一只**（消消乐 6 列）够用的数，
            但连连看是 8 列 + 两侧外框 = **8.72 格宽**（分母的来历见 `index.css` 那条），在 372-padding
            的列里每格只剩 30.7px（实测），比手机还小。
            ⚠️ v1.52 再 424 → 480：用户 2026-09-20「在电脑端尺寸扩大消消乐和连连看的尺寸」。
            480 减去左右内边距 32、再减 `md:pr-12` 48 ⇒ 内层可用约 400px，
            `400 / 8.72 = 45.9` ⇒ `--cs` 顶到 `index.css` 那档新上限 **44px**（盘面外框 383.7px）。
            **列宽与那档上限是一对的，改一个必须改另一个。** */}
        <div className="flex min-h-0 flex-[3] flex-col overflow-y-auto px-2 py-1.5 sm:px-4 md:w-[480px] md:flex-none md:border-l md:border-dq-border md:pr-12">
          <div className="my-auto flex w-full flex-col gap-1 md:gap-1.5">
          <RankList state={wb} contribPct={contribPct} />

          {/* 我的贡献 */}
          <div className="flex items-center gap-2 rounded border border-dq-border bg-black/30 px-2 py-0.5" data-wb2-mine-panel>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[10px] text-[#a89478]">我的贡献</span>
                <span className="min-w-[54px] shrink-0 tabular-nums text-sm font-bold leading-tight text-dq-fire sm:min-w-[64px] sm:text-base"
                  data-wb2-mine-num>
                  {fmtNum(me?.damage ?? 0)}
                </span>
                <span className={`min-w-[42px] shrink-0 rounded border px-1 text-center tabular-nums text-[10px] leading-tight ${defeated ? 'border-dq-qing text-dq-qing' : 'border-dq-gold/60 text-dq-gold'}`}
                  data-wb2-mine-pct>
                  {contribPct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full border border-dq-border bg-black/50">
                <div className={`h-full transition-[width] duration-300 ${defeated ? 'bg-dq-qing' : 'bg-dq-gold'}`}
                  style={{ width: `${contribPct}%` }} data-wb2-mine-bar />
              </div>
            </div>
            <div className="shrink-0 text-right text-[10px] leading-tight text-[#a89478]" title={me && me.rank > 0 ? `超过 ${me.percentile}% 的人` : undefined}>
              {/* rank=0 = 名次还没定（下一笔轮询才出来），显示成「第 0 名」会被当成 bug */}
              {me ? <>{me.rank > 0 ? <>第 <span className="tabular-nums text-dq-gold">{me.rank}</span> 名</> : '名次待定'}<br />{wb.participants} 人合击</> : '尚未出手'}
            </div>
          </div>

          <div className="dq-wb-board-first flex flex-col items-center gap-1">
            <LinkLinkBoard disabled={defeated || ended} onClear={onLinkClear} fmtDamage={fmtNum} />
            {/* 攒着还没发出去的那部分。不显示的话，玩家连消几下会以为"消了不掉血"。
                ⚠️ 这一行**必须常驻**，不可见时也得占着高度（`invisible` 而不是条件渲染）——
                它一冒出来就把 BOSS 区和整条血条顶上去，回执一到又掉回来，连消时整屏上下弹。
                第一只那边实测过（probe-boss-jitter），这里照搬同一个结论。 */}
            <div className={`h-4 text-[10px] text-dq-fire ${queued > 0 ? '' : 'invisible'}`}
              data-wb2-queued={queued}>
              结算中 +{fmtNum(queued)}
            </div>
            {/* 击败奖励的常驻标注。同样写死高度 + truncate：宁可截断，也不许文案长短去挤 BOSS 区 */}
            <div className="h-4 max-w-full truncate text-[10px] text-[#a89478]"
              title={reward.full || undefined} data-wb2-reward-text={reward.short}>
              {reward.short}
            </div>
          </div>

          <MySquad state={state} />

          {/* 本期到点：只留一句提示。**不做付费重启**（本轮出界），所以这里没有重启按钮，
              也没有第一只那块"打满后可重启"的说明行 —— 打满就是打满 */}
          {ended && (
            <div className="flex h-[46px] items-center justify-center text-center text-[11px] text-dq-qing">
              本期已结束，奖励按贡献度发到了邮箱，去邮箱点「领取」入账
            </div>
          )}
          </div>
        </div>
      </div>

      {/* 战斗日志 */}
      <div className="h-[56px] shrink-0 overflow-hidden border-t border-dq-border bg-black/40 px-2 py-1 text-[10px] leading-relaxed sm:px-4 sm:text-xs">
        {logRef.current.length === 0
          ? <div className="text-[#6b5b47]">点两个**图案相同**的格子，只要它们能连起来（拐弯不超过两次、路上没有别的块，可以绕到盘面外走）就会消掉，对 Boss 造成一次伤害。连不上只是提示，不消耗任何东西。血条全服共用，打穿一轮发一次奖、一轮最多三次。{reward.full}</div>
          : logRef.current.slice(0, 3).map((l, i) => (
            <div key={l.at} data-wb2-log={l.text} data-wb2-log-amount={l.amount ?? ''} className={i === 0 ? 'text-dq-gold' : 'text-[#a89478]'}>{l.text}</div>
          ))}
      </div>
    </div>
  )
}