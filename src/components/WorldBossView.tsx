import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame, game, fmtNum, charLabel } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { bossSpriteFor } from '../game/monsters'
import {
  useWorldBoss, useWorldBossError, useWorldBossQueued,
  useWorldBossPollSeq, useWorldBossPollDelta,
  refreshWorldBoss, remainMs, fmtDuration,
  queueMatchDamage, flushQueuedDamage, rewardLabelsOf, restartWorldBoss,
  crowdfundWorldBoss, crowdRewardLabelOf,
  type WbState, type WbNotice,
} from '../game/worldboss'
import MatchBoard from './MatchBoard'
import RankBadge from './RankBadge'
import type { SwapResult } from '../game/match3'

/**
 * 集结讨伐页。纵向布局（设计文档 §10）—— 左右布局是单人 PvE 的构图，
 * 屏幕另一半只放得下一个敌人，**放不下另外几十个人**；纵向天然把「天」和「人」分开：
 * 上面是同一个敌人，下面是所有人。
 *
 *   顶栏 | [ BOSS 区(flex-1) | 玩法栏(排行榜 · 我的贡献 · 消消乐 · 部队) ] | 战斗日志
 *
 * v1.39 按用户意见改了这一页的四处：
 *   ① 立绘换成三张高分辨率整幅插画，**自带背景**，铺满整块（原先 256px 像素画被拉大，既糊又空）；
 *   ② 底部那条旗子「援军阵列」太丑 → 改成**竖排排行榜**，挪到消消乐上面，带名字与伤害百分比；
 *   ③ 「我的贡献」从一个条 + 一行小字做成一块**读数面板**（伤害原值 · 占比徽标 · 名次 · 进度条）；
 *   ④ 消掉一格给 Boss 一个**轻微的受击动作**（只动 transform，不抖也不闪）。
 *
 * ⚠️ 这一页的 `data-wb-*` / `data-m3-*` 是回归脚本的锚点，**结构可以改、锚点不许动**：
 *    服务端状态、我的伤害与占比、今日讨伐次数、排队中的伤害、日志、奖励标注全在上面。
 */

/** 通知横幅挂多久（ms）。够读完一句话，又不至于挡着玩 */
const NOTICE_SHOW_MS = 12 * 1000
/**
 * 「这条通知算不算新鲜」。进页面时第一次看到的那条通知只有在这个时限内才弹 ——
 * 否则每次打开游戏都会把几小时前那条"某某重启了世界 Boss"再弹一遍。
 */
const NOTICE_FRESH_MS = 10 * 60 * 1000

/**
 * 给每个人一方颜色稳定的色块：同名同色，刷新不变（沿用原先旗子的算法，
 * 玩家认的是"我的颜色"，换一套哈希等于把这份熟悉感丢掉）。
 */
function flagHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** 排行榜的一行：名次 · 名字 · 伤害条 · 伤害原值 · 伤害百分比 */
function RankRow({ rank, name, damage, pct, mine }: { rank: number; name: string; damage: number; pct: number; mine?: boolean }) {
  const hue = flagHue(name)
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div
      // 锚点：`data-wb-flag="me"` 仍表示"这一行是我"。老脚本靠它找自己那一行
      data-wb-flag={mine ? 'me' : name}
      data-wb-rank-row={rank}
      title={`${name} · 第 ${rank} 名 · 造成 ${damage} 伤害 · 占全服 ${pct.toFixed(1)}%`}
      className={`flex items-center gap-1.5 rounded px-1 py-[3px] ${mine ? 'bg-dq-gold/10 ring-1 ring-dq-gold/40' : ''}`}>
      {/* 名次这一格曾有一条"**必须锁高** `h-4`"的告诫：前三名渲染奖牌 emoji、第四名起是数字，
          两者的行高不一样，我打上榜那一刻整行高 2px、榜单跟着蹿 2px（实测 390×844：89 ↔ 91px）。
          v1.44 换成 `RankBadge` 之后**这格不再是"内容决定高度"**：1 名和 100 名是同一个盒子，
          那条抖动不再靠注释约束，而是**结构上做不到**了。`h-4 w-4 shrink-0` 仍然保留。 */}
      {/* rank ≤ 0 =「名次还没定」：刚打第一笔、服务端下一次轮询才把我算进参与者，
          客户端在本地先造了一行（见 worldboss.ts 的 `rank: 0`）。**不能显示成「第 0 名」** ——
          那是把"还没算"当成了名次，玩家只会觉得是 bug。 */}
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
      {/* tabular-nums + 定宽：这个数字每消一笔就变一次，位数也会变（「9.0万」→「12.3万」），
          不定宽的话整行会跟着左右抽动 —— 那正是玩家报过的"排名和文字在抖" */}
      <span className="w-[42px] shrink-0 text-right tabular-nums text-[10px] text-[#a89478] sm:w-[48px]">{fmtNum(damage)}</span>
      <span className={`w-[38px] shrink-0 text-right tabular-nums text-[10px] ${mine ? 'text-dq-gold' : 'text-dq-fire'}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

/**
 * 竖排排行榜（用户定：「和排行榜一样竖着排，然后有名字，有每个人的伤害百分比」）。
 *
 * **铁律沿用旧旗子条：无论多少人，「我」永远钉在最上面并高亮。**
 * 人一多就按伤害降序排，弱号会被排到几十名开外、翻十屏都找不到自己 ——
 * 而弱号恰恰最需要在这里被看见（哪怕他其实排在榜外，也要造一行出来）。
 *
 * 高度写死 + 内部滚动：这一栏在窄屏下是"内容多高就多高"，而 BOSS 区是 flex-1 ——
 * 名单长一截就把立绘和血条顶上去一截（红线的老病，见 dq-boss-queued 那段注释）。
 */
function RankList({ state, contribPct }: { state: WbState; contribPct: number }) {
  const me = state.me
  const myRank = me?.rank ?? 0
  const rows = useMemo(() => {
    // 我那一行：能对上榜就用榜上的（服务端算的占比是权威值），对不上（榜只回前 10 名）就自己造一行。
    // 对不上的情况很常见：人一多，弱号永远在榜外 —— 那正是最该被看见的人。
    const hit = myRank > 0 ? state.board.find(r => r.rank === myRank) : undefined
    const mineRow = me
      ? { rank: myRank || 0, name: '我', damage: me.damage, pct: hit ? hit.pct : contribPct }
      : null
    const others = state.board.filter(r => !mineRow || r.rank !== myRank)
    return { mineRow, others }
  }, [state.board, me, myRank, contribPct])
  // ⚠️「还有多少人」按 participants 算，**不能按手上这几行算**：榜单服务端只回前 10 行，
  //    拿 others.length 当全量的话，47 人时这里永远算出"还有 0 人"（队尾那句就是死代码）。
  const notDrawn = Math.max(0, state.participants - (rows.mineRow ? 1 : 0) - rows.others.length)
  return (
    <div className="rounded border border-dq-border bg-black/30" data-wb-reinforce>
      <div className="flex items-baseline justify-between border-b border-dq-border/60 px-2 py-0.5">
        <span className="text-[10px] text-dq-gold">讨伐榜</span>
        <span className="tabular-nums text-[10px] text-[#a89478]">
          {state.participants} 人合击
          {me && myRank > 0 && <span className="ml-1 text-dq-gold" title={`超过 ${me.percentile}% 的人`}>· 我第 {myRank} 名</span>}
          {notDrawn > 0 && <span className="ml-1">· 还有 {notDrawn} 人</span>}
        </span>
      </div>
      {/* 名单高度写死：手机上 2 行左右、桌面 5 行，长的自己滚。**别改成 h-auto** ——
          那会把 BOSS 区顶来顶去。手机上收到 48px 是为了给下面的盘面腾高度：
          竖屏手机的高度是稀缺资源，而盘面**必须一进来就看到大半**（主玩法不该要滚才看得见）。
          反正「我」永远置顶高亮，两行里必定有我 + 榜首。 */}
      <div className="max-h-[48px] overflow-y-auto px-1 py-0.5 md:max-h-[96px]">
        {rows.mineRow
          ? <RankRow rank={rows.mineRow.rank} name={rows.mineRow.name} damage={rows.mineRow.damage} pct={rows.mineRow.pct} mine />
          : <div className="px-1 py-1 text-center text-[10px] text-[#6b5b47]">还没有人出手，消一格就是伤害</div>}
        {rows.others.map(r => <RankRow key={r.rank} rank={r.rank} name={r.name} damage={r.damage} pct={r.pct} />)}
        {!rows.mineRow && rows.others.length === 0 && <div className="h-[18px]" />}
      </div>
    </div>
  )
}

/**
 * 我上阵的 6 名角色。只画我的：别人的阵容是隐私（§10.3）。
 * **缩到 40px 见方**：这一栏的高度是从 boss 那边匀出来的，6 个小头像够表达"我带了谁"。
 */
function MySquad({ state }: { state: ReturnType<typeof useGame> }) {
  const slots = [...state.team.front, ...state.team.back]
  // 锚点给探针量"滚到底之后阵容够不够得着"（右栏挤不下时会滚）
  return (
    <div className="flex justify-center gap-1" data-wb-squad>
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

export default function WorldBossView() {
  const state = useGame()
  const wb = useWorldBoss()
  const err = useWorldBossError()
  // 击败奖励的文案。**数字全部来自服务端回包**，界面只负责念（见 rewardLabelsOf）
  const reward = useMemo(() => rewardLabelsOf(wb?.reward ?? null), [wb?.reward])
  const [tick, setTick] = useState(() => Date.now())
  const logRef = useRef<{ text: string; at: number; amount?: number }[]>([])
  const [, forceLog] = useState(0)
  /** 供日志回调读"当前"状态：effect 只依赖轮询序号，不依赖 wb（依赖它会连带重跑） */
  const wbRef = useRef(wb)
  useEffect(() => { wbRef.current = wb }, [wb])
  /** 攒在队列里还没发出去的伤害（消消乐连消比服务端 2 秒冷却快，见 worldboss.ts） */
  const queued = useWorldBossQueued()
  /** 上次轮询里**别人**打掉的量（已扣掉我自己） */
  const pollSeq = useWorldBossPollSeq()
  const pollDelta = useWorldBossPollDelta()
  /** 全服通知的横幅（当前只有"有人花钱重启了世界 Boss"这一种），到点自动收起 */
  const [banner, setBanner] = useState<WbNotice | null>(null)
  const seenNotice = useRef<number | null>(null)
  /** 重启请求在途 —— 挡住连点（一次点击就是 100 万灵金，绝不能双击扣两次） */
  const [restarting, setRestarting] = useState(false)
  /**
   * 众筹出资框里的数（字符串，**不要存成 number**：存 number 的话用户清空输入框
   * 会被 `Number('')` 变成 0 再回填成 "0"，光标和输入节奏全乱）。
   * 留空 = 按最低额度出，见 doCrowdfund。
   */
  const [crowdAmt, setCrowdAmt] = useState('')
  /** 出资请求在途 —— 同样挡连点（一次点击就是真金白银） */
  const [crowding, setCrowding] = useState(false)
  /**
   * 手机端：把「榜单 / 我的贡献 / 部队 / 众筹 / 重启」这一堆面板**收进底部弹窗**。
   *
   * 用户 2026-09-21 定的是全局口径：「手机尺寸下所有页面都要要求一屏展示，不要做整体的下滑，
   * 想想怎么设计ui和交互满足这一点，可以横向滑动和弹窗内滑动」+「手机端不一定需要面板，
   * 而是按钮 弹窗 跳转的逻辑」。这一页是**最塞不下**的一页：玩法栏里躺着 5 块面板，
   * 光它们就 ~320px，而 320×568 这种机器整页留给玩法栏的不到 200px ——
   * 盘面必然被挤到没有。
   *
   * ⚠️ 所以这里**不是**"把面板缩小一点"，是把它们**整体移出主屏**：
   *    盘面独占剩下的全部高度（`--cs` 同时受容器的高约束，见 index.css），
   *    面板改由底部栏的「详情」按钮唤出，在弹窗里滚（弹窗内滚是用户明确允许的）。
   *
   * ⚠️ 开关只切**类名**、不切 DOM（面板始终在文档里，只是 `display:none`）——
   *    这页有十几个 `data-wb-*` 锚点供后台探针读，条件渲染会让它们在手机视口下**整体消失**。
   */
  const [panelsOpen, setPanelsOpen] = useState(false)
  // 注：战力注入与轮询**不在这里**启动 —— 那是 App 层 WorldBossWiring 的活，
  // 因为它必须在离开这一页之后继续跑（自动讨伐不能因为切页就停）。
  // 这里再注册一次的话，本组件一卸载，那份冻结的 ref 会把 App 的注册盖掉。

  // 倒计时每秒走一格
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  /**
   * amount 只在「我这一击」时给：它是**服务端收下的**伤害原值（文字里那个数被 fmtNum 缩写过，对不了账）。
   *
   * ⚠️ v1.40 起这里是 `useCallback`：`onMatchClear` 要交给 `MatchBoard`，而那个组件是
   *    `memo` 过的 —— 回调用内联箭头函数的话，父组件每 2 秒轮询一次就换一个新身份，
   *    memo 一次都拦不住，36 个格子照旧全量重建（"卡卡的"就是这么来的）。
   */
  const push = useCallback((text: string, amount?: number) => {
    logRef.current = [{ text, at: Date.now(), amount }, ...logRef.current].slice(0, 40)
    forceLog(n => n + 1)
  }, [])

  // 轮询回来的"这一分钟**别人**打掉了多少"：跨玩家事件，让共斗感落在一行字上（§10.4）。
  // 读数里已经扣掉了我自己（见 worldboss.ts 的 pollBaseDealt）—— 否则每消一笔都会
  // 多推一条"全服合力打掉"，把我自己的战报从一屏 4 条的日志里挤出去。
  useEffect(() => {
    if (pollSeq <= 0 || pollDelta <= 0) return
    push(`全服合力打掉 ${fmtNum(pollDelta)}（血条剩 ${(wbRef.current?.remainPct ?? 0).toFixed(1)}%）`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollSeq])

  // 换期了就把日志清掉，免得上一期的战报挂在新一期下面
  useEffect(() => { logRef.current = []; forceLog(n => n + 1); lastKills.current = null }, [wb?.period])

  /**
   * 打赢一次报一句。判据是 **kills 的上升沿**，不是 defeated 的：
   * 一天要打赢三次，而服务端是"打穿即重生"——回执里 defeated 当场就是 false，
   * 拿它做上升沿的话第 1、2 次击败根本不会被看见（只有第 3 次锁住期才看得到）。
   *
   * 放在 effect 而不是 onMatchClear 里，是因为**打穿的可能是别人**：
   * 那一笔只在每分钟的轮询里出现，onClear 根本不会经过。
   * lastKills 用 null 起手：刚进页面拉到的那个 kills（比如别人今天已经打了 2 次）
   * 是"当前战绩"，不是"我刚打赢"，不能弹战报。
   */
  const lastKills = useRef<number | null>(null)
  useEffect(() => {
    const k = wb?.kills ?? 0
    if (lastKills.current === null) { lastKills.current = k; return }
    if (k > lastKills.current) {
      const max = wb?.maxKills ?? 3
      push(k < max
        ? `第 ${k} 次击败！${wb?.boss.name ?? 'BOSS'} 倒下，奖励已发到邮箱，血条已重置`
        : `第 ${k} 次击败！本轮 ${max} 次讨伐已毕，奖励已发到邮箱，可花灵金重启世界 Boss`)
    }
    lastKills.current = k
  }, [wb?.kills])

  /**
   * 全服通知：**按 seq 去重**（不按 at —— 两台机器时钟差几毫秒就会各显示一次）。
   * 进页面第一次看到的那条只有"新鲜的"才弹，否则每次打开游戏都会重播几小时前的旧通知。
   */
  useEffect(() => {
    const n = wb?.notice ?? null
    if (!n) return
    if (seenNotice.current === null) {
      seenNotice.current = n.seq
      if (Date.now() - n.at > NOTICE_FRESH_MS) return
    } else if (n.seq <= seenNotice.current) {
      return
    } else {
      seenNotice.current = n.seq
    }
    setBanner(n)
    push(n.text)
    const t = setTimeout(() => setBanner(null), NOTICE_SHOW_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb?.notice?.seq])

  // 离开页面 / 切到后台时，把攒在队列里的伤害送出去。
  // 消消乐的伤害是先攒后发的（服务端 2 秒冷却），不解这一下，玩家刚消完就切页会丢掉几笔。
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushQueuedDamage() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushQueuedDamage)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushQueuedDamage)
      flushQueuedDamage()   // 切到别的页签（组件卸载）同样要送出去
    }
  }, [])

  /**
   * 立绘的**受击动作**（用户定：「消消乐造成的攻击给boss造成轻微的攻击动画，但不要抖和闪」）。
   *
   * 所以只做一件事：**整体微微一沉、随即弹回**（transform 而已）。
   * 刻意排除的两种做法：左右来回 = 抖；改 brightness/opacity = 闪。
   * 一条连锁打得越狠沉得越深一点，但幅度上限就到这里 —— 它是"挨了一下"的反馈，
   * 不是打击感演示（真正的反馈在血条和日志上）。
   *
   * 挂在这个 wrapper 上、**不挂在 img 上**：img 带着 `dq-boss-breathe` 的呼吸动画，
   * 两者挤在同一个元素上会互相覆盖 transform（与 dq-idle-bob-flip 那条注释同一个坑）。
   */
  const bossRef = useRef<HTMLDivElement | null>(null)
  const hitAnim = useCallback((combo: number) => {
    const el = bossRef.current
    if (!el || typeof el.animate !== 'function') return
    // 系统设了"减少动态效果"就别动 —— 与 index.css 里那条 @media 同一个口径
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const deep = combo > 1 ? 9 : 6
    el.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: `translateY(${deep}px) scale(${combo > 1 ? 0.982 : 0.99})` },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: combo > 1 ? 300 : 240, easing: 'ease-out' })
  }, [])

  /**
   * 消消乐结算完一笔：进队列，并往日志里记一条。**伤害不在这里发送** —— 见 queueMatchDamage。
   *
   * 活动中心（v1.42）那两个计数指标：**这一处是唯一同时握着"出手了一次"和"消掉了几格"的地方**。
   * 远程模式下它们随这笔伤害一起上报、由服务端记（见 `worldboss.ts` 的 `metricsForRemote`），
   * 下面两行 `bumpMetric` 在那个模式下是 no-op；本地模式下它们仍是唯一的那一份。
   */
  const onMatchClear = useCallback((res: SwapResult, damage: number) => {
    queueMatchDamage(damage, res.tiles)
    game.bumpMetric('boss.hit', 1)
    game.bumpMetric('match3.tiles', res.tiles)
    hitAnim(res.combo)
    push(`消除 ${res.tiles} 格${res.combo > 1 ? ` · ${res.combo} 连击` : ''}，造成 ${fmtNum(damage)} 伤害`, damage)
  }, [hitAnim, push])

  const me = wb?.me
  /**
   * 我的贡献度 = 我打的 ÷ 全服已打。**就在本地算**，不用服务端 me.pct ——
   * 那个只在每分钟的轮询里刷新，而消消乐每 2 秒就推一笔，用它会看到"我打了半天贡献度不动"。
   * 奖励就是按这个比例分的，所以它必须是最新的那个数。
   */
  const contribPct = me && wb && wb.dealt > 0 ? Math.min(100, (me.damage / wb.dealt) * 100) : 0
  const maxKills = wb?.maxKills ?? 3
  const kills = wb?.kills ?? 0
  /** 本轮三次打满 —— 这一轮到此为止，盘面锁死。**花钱重启可以让它重新开跑** */
  const done = kills >= maxKills
  /**
   * 锁盘面的条件：三次打满，或本期到点。**不含 defeated** ——
   * defeated 是"这一轮刚被打穿、正在结算"，而服务端会立刻把血条立起来，
   * 锁上去只会让盘面在下一笔回执之前闪一下（消消乐正连着消，手感上就是卡一下）。
   */
  const defeated = done || !!wb?.ended
  const ended = !!wb?.ended
  const sprite = bossSpriteFor(wb?.boss.form ?? 1)
  /**
   * 众筹块要用的几个读数。金额**全部取自服务端下发的那一份**（`wb.crowd`），
   * 这里只做两件本地事：算进度条宽度、把分红池念成中文（见 crowdRewardLabelOf）。
   */
  const crowd = wb?.crowd ?? null
  const crowdPct = crowd && crowd.goal > 0 ? Math.min(100, (crowd.raised / crowd.goal) * 100) : 0
  const crowdReward = crowdRewardLabelOf(crowd)

  /**
   * 付费重启（用户定：「每日3次结束后允许玩家花钱给整个世界boss重启一次，暂定100w重启一次」）。
   *
   * **先请服务端点头、再动钱**：服务端会验"今日三次确实打满了、且最后一杀的奖已经发完"，
   * 被拒（没打满 / 还在结算）的时候一分钱都不该出去 —— 反过来先扣后退的话，
   * 玩家会看到余额莫名闪一下。价钱也**只有服务端那一份**（`wb.restart.cost`），
   * 这里只是把它念出来。
   *
   * ⚠️ **扣费只有一处，取决于模式**：远程模式下这条请求带着令牌，服务端认得出是谁 ⇒
   *    由**服务端**扣（见 `server.js` 里 `action:'restart'` 那段）；本地模式下服务端认不出
   *    （老路径），才由这里扣。**两边都扣就是双花**（用户做这整套就是为了堵这个）。
   *    余额也顺着下一次 `/state` 回来（≤1 秒），所以远程模式下这里什么都不用做。
   */
  const doRestart = async () => {
    if (restarting || !wb) return
    const cost = Math.floor(Number(wb.restart?.cost?.coin) || 0)
    if (cost > 0 && Math.floor(state.inventory.coin ?? 0) < cost) {
      game.setNotice(`灵金不足（重启需要 ${fmtNum(cost)}）`)
      return
    }
    setRestarting(true)
    try {
      const r = await restartWorldBoss()
      if (r.restarted) {
        if (cost > 0 && !game.isRemote()) game.spendCoin(cost)
        push(`已重启世界 Boss（花费 ${fmtNum(cost)} 灵金），血条回满，接着打`)
      } else if (r.reason === 'poor') {
        // 服务端说钱不够（它扣费失败就**不重启**，钱优先）。走到这里通常是本地余额
        // 比服务端那份新（刚花掉还没同步），所以这不是网络错误，别去重试。
        game.setNotice(`灵金不足（重启需要 ${fmtNum(cost)}）`)
      } else {
        game.setNotice(r.reason === 'settling' ? '上一轮还在结算奖励，稍候再试' : '今日三次尚未打满，还不能重启')
      }
    } catch {
      // ⚠️ 远程模式下**不能说"灵金未扣"** —— 请求可能已经送到、只是回执丢了，
      //    钱到底动没动这里无从得知。不确定就说不确定，让玩家自己看一眼余额。
      game.setNotice(game.isRemote() ? '网络不太好，重启结果未知，请刷新看看' : '网络不太好，重启没成功，灵金未扣')
    } finally {
      setRestarting(false)
    }
  }
  /**
   * ★ **众筹出资**（2026-09-21 用户定）：把那 100 万拆开收，凑满自动重启。
   *
   * 与 doRestart 的两点关键差别，都写在下面：
   *
   * ⚠️ **钱只能由服务端扣**（这里绝不调 `game.spendCoin`）—— 众筹**没有**本地那条老路。
   *    服务端要按人记账、打穿后按人分红，认不出令牌就直接拒（`reason:'need_login'`）；
   *    客户端自己扣的话，服务端那份账上根本没这个人，分红也就无从发。
   *
   * ⚠️ **实际扣掉的数以回执里的 `donated` 为准**：服务端会把这一笔**截到"还差多少凑满"**，
   *    所以提示里报的必须是他，不能是我们请求的那个数（否则玩家会以为多出的那些也扣了）。
   */
  const doCrowdfund = async () => {
    const crowd = wb?.crowd
    if (crowding || !crowd) return
    const min = Math.max(1, Math.floor(crowd.min))
    // 留空 = 按最低额度出（输入框的 placeholder 也正是这个数）
    const want = crowdAmt.trim() === '' ? min : Math.floor(Number(crowdAmt) || 0)
    if (want < min) {
      game.setNotice(`单次出资不能少于 ${fmtNum(min)} 灵金`)
      return
    }
    /**
     * 本地先看一眼余额：**服务端才是权威**（远程模式下余额以它那份为准），
     * 但明显不够时没必要白跑一趟 —— 与 doRestart 那条前置检查同一个尺度。
     */
    if (Math.floor(state.inventory.coin ?? 0) < want) {
      game.setNotice(`灵金不足（本次出资 ${fmtNum(want)}）`)
      return
    }
    setCrowding(true)
    try {
      const r = await crowdfundWorldBoss(want)
      if (r.crowdfunded) {
        if (r.filled) {
          setCrowdAmt('')
          push(`众筹凑满！你出资 ${fmtNum(r.donated)} 灵金，血条已回满，全服接着打`)
        } else {
          push(`已出资 ${fmtNum(r.donated)} 灵金，众筹进度 ${fmtNum(crowd.raised + r.donated)} / ${fmtNum(crowd.goal)}`)
        }
      } else if (r.reason === 'poor') {
        game.setNotice(`灵金不足（本次出资 ${fmtNum(want)}）`)
      } else if (r.reason === 'need_login') {
        // 与众筹的设计直接相关：钱要按人记账、分红要按人发，没有身份就没法记这笔账
        game.setNotice('众筹需要先登录账号（出资按人记账，分红也按人发）')
      } else if (r.reason === 'too-small') {
        game.setNotice(`单次出资不能少于 ${fmtNum(min)} 灵金`)
      } else if (r.reason === 'filled') {
        game.setNotice('这一轮众筹已经凑满，血条马上重启')
      } else {
        game.setNotice(r.reason === 'settling' ? '上一轮还在结算奖励，稍候再试' : '今日三次尚未打满，还不能众筹重启')
      }
    } catch {
      // ⚠️ 与 doRestart 同一条口径：远程模式下**不能说"没扣钱"** —— 请求可能已经送到、
      //    只是回执丢了。不确定就说不确定，让玩家自己看一眼余额。
      game.setNotice(game.isRemote() ? '网络不太好，出资结果未知，请刷新看看余额' : '网络不太好，出资没成功')
    } finally {
      setCrowding(false)
    }
  }
  const restartCost = Math.floor(Number(wb?.restart?.cost?.coin) || 0)

  if (!wb) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[#a89478]">
        <div>集结讨伐的数据还没拉下来…</div>
        {err && <div className="text-xs text-red-400">（{err}）</div>}
        <button onClick={() => void refreshWorldBoss()} className="rounded border border-dq-border px-3 py-1 text-xs text-dq-gold">重试</button>
      </div>
    )
  }

  return (
    // relative 是给通知横幅用的：横幅**绝对定位**、不参与 flex 布局 ——
    // 插进文档流里的话，它一出现就把底下的立绘和血条整体顶下去（这一页的老病）。
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      // 给测试留的原始数值出口。fmtNum 会把大数缩写成「1629万」，
      // 靠解析中文文本对账既脆又验不准 —— 这些字段的权威值本来就在服务端，直接暴露原值。
      data-wb-period={wb.period}
      data-wb-dealt={wb.dealt}
      data-wb-totalhp={wb.totalHp}
      data-wb-participants={wb.participants}
      data-wb-me-damage={me?.damage ?? 0}
      data-wb-me-pct={Math.round(contribPct * 10) / 10}
      data-wb-me-rank={me?.rank ?? 0}
      data-wb-defeated={defeated ? '1' : '0'}
      data-wb-kills={kills}
      data-wb-maxkills={maxKills}
      data-wb-restart-allowed={wb.restart?.allowed ? '1' : '0'}
      data-wb-restart-count={wb.restart?.count ?? 0}>
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-dq-border bg-black/30 px-2 py-1 text-[10px] sm:px-4 sm:text-xs">
        <span className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-dq-gold">集结讨伐 · 第 {wb.period} 期</span>
          {/* 今日战果。用户定「一天允许被击败三次」，所以这一条是玩家最该盯的数字 ——
              它决定本轮还有几次可打，比血条百分比更有行动指向 */}
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${done ? 'border-dq-qing text-dq-qing' : 'border-dq-gold/60 text-dq-gold'}`}
            data-wb-killlabel={`${kills}/${maxKills}`}>
            本轮已讨伐 {kills}/{maxKills}{done ? ' · 已毕' : ''}
          </span>
        </span>
        <span className="text-[#a89478]">
          {ended ? '本期已结束，等开新一期' : <>距结算 <span className="tabular-nums text-dq-fire">{fmtDuration(remainMs(wb, tick))}</span></>}
        </span>
      </div>

      {/* 全服通知横幅（有人花钱重启了世界 Boss）。绝对定位 → 出场退场都不影响任何布局 */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-8 z-20 flex justify-center px-2">
          <div className="pointer-events-auto flex max-w-full items-start gap-2 rounded border border-dq-gold/60 bg-black/85 px-2.5 py-1.5 text-[11px] leading-snug text-dq-gold shadow-lg">
            <span data-wb-notice={banner.seq}>{banner.text}</span>
            <button onClick={() => setBanner(null)} className="shrink-0 text-[#a89478] hover:text-dq-gold" aria-label="关闭">✕</button>
          </div>
        </div>
      )}

      {/* 弹窗遮罩。`md:hidden` 兜底：桌面端没有能打开弹窗的入口，正常不会亮 */}
      {panelsOpen && <div className="fixed inset-0 z-30 bg-black/70 md:hidden" onClick={() => setPanelsOpen(false)} />}

      {/* 主区：**桌面左右分栏**（md:flex-row），窄屏上下堆叠。
          消消乐盘面是固定像素高度（6 行格子，用户定：不许缩），纵向怎么排都会把 boss 挤成一条；
          而桌面屏幕上左右各有几百像素是空的。把玩法栏挪到右边那一栏，boss 就独占整个高度。
          ⚠️ 桌面还要**居中并封顶宽度**（v1.52）：不封顶的话，屏幕越宽 boss 越横着长
          （1440px 上左栏有 900+ px），而盘面那栏是固定宽 —— 用户 2026-09-20
          「注意在电脑端尺寸扩大消消乐和连连看的尺寸 **缩小boss的尺寸**」要的正是这个。
          1120px 是这么定的：盘面拿到它要的宽度之后（右栏 460 + 内边距），左栏还剩 ~660px，
          只有封顶前的一半多点 —— 而它仍然装得下立绘该有的细节。
          ⚠️ 只挂在 md 起：手机上这一行是 `flex-col`，这两条类名没有意义（也不能生效，
             `max-w` 会跟着 `mx-auto` 一起把窄屏的立绘缩窄）。 */}
      <div className={`dq-wb-main flex min-h-0 flex-1 flex-col md:mx-auto md:w-full md:max-w-[1120px] md:flex-row ${panelsOpen ? '' : 'dq-wb-main-fill'}`}>
        {/* BOSS 区：**吃掉所有富余高度**（flex-1）。
            立绘是整幅插画（1024、自带背景），用 object-cover 铺满整块 —— 原先那种
            「256px 像素画 + object-contain + pixelated」撑不满这块，中间会空出一条死区。
            定位偏上 30%：整幅图里人物头顶在 ~17%、脚在 ~85%，居中裁切在窄屏会把头切掉。
            `min-h-[80px]` 是**保底**：窄屏下它和右栏按 1:3 分剩余高度（玩法栏拿大头 ——
            竖屏手机的稀缺资源是高度，而盘面、榜单、重启口都在右栏），但矮屏上不分保底会被压成
            一条几十像素的缝。实测（390×844 / 360×640）：这一页真正能用到的只有 638 / 434px
            （外层 tab 栏就吃掉 120），扣掉顶栏与日志后，"排行榜 + 贡献面板 + 完整盘面"在小屏上
            **数学上放不下** —— 取舍是让立绘先让位，而不是让盘面被裁。 */}
        <div className="dq-wb-boss relative min-h-[80px] flex-1 overflow-hidden bg-[#0b0710]">
          {/* 受击动画挂在这一层；呼吸动画挂里面的 img（两层各自管自己的 transform） */}
          <div ref={bossRef} className="absolute inset-0" data-wb-boss-hit>
            {sprite && (
              <img src={sprite} alt={wb.boss.name}
                className="dq-boss-breathe h-full w-full object-cover object-[center_30%]" />
            )}
          </div>
          {/* pr 是给右侧那个常驻邮箱标签让位：血条右端那行百分比正好在它底下 */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-8 pr-12 max-md:pt-4 sm:px-4 sm:pr-14">
            <div className="mb-1 flex items-baseline justify-between text-[11px] sm:text-sm">
              <span className="font-bold text-dq-gold">{wb.boss.name}<span className="ml-1.5 text-[10px] font-normal text-[#a89478]">{wb.boss.formLabel}</span></span>
              <span className="text-[#a89478]">{wb.participants} 人合击</span>
            </div>
            {/* 全服血条：一分钟跳一次，跳的时候掉一格 —— 不假装实时（§10.4） */}
            <div className="h-3.5 w-full overflow-hidden rounded-sm border border-dq-border bg-black/60 sm:h-5">
              <div className="h-full bg-gradient-to-r from-red-700 via-dq-fire to-amber-400 transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, 100 - wb.remainPct))}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-[#a89478] sm:text-xs">
              <span>全服已打 {fmtNum(wb.dealt)} / {fmtNum(wb.totalHp)}</span>
              <span className="text-dq-fire">{wb.progressPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* 玩法栏。桌面固定 **460px**（v1.52，原 372）；窄屏下**与 BOSS 区按 1:3 分剩余高度**
            （`flex-[3] min-h-0`）。
            ⚠️ 460 与 `index.css` 里消消乐那档 `--cs` 上限 **56px** 是一对的：内层可用宽 = 460 −
            左右内边距 32 − `md:pr-12` 48 = 380px，正好放得下 6×56+34 = 370px 的盘面。
            **改一个必须改另一个** —— 列宽了但上限没抬，格子不会变大（白宽）；上限抬了但列没宽，
            `calc` 那一支会把格子卡回去。两处的注释互相指了对方。
            ⚠️ 它原来是 `shrink-0`（内容多高就多高）+ `justify-center` —— 挤不下时内容直接
            顶出容器，而这一页的根是 `overflow-hidden`，于是**底部被裁掉**（实测：360×640 下
            重启块落到视口外 31px、桌面 1280×720 下右栏自身溢出 56px）。现在改成"挤不下就滚"。
            ⚠️ 内层那个 `my-auto` 不能改成外层的 `justify-center`：**溢出容器里的 justify-center
            会把顶部内容推到滚不到的地方**（flex 的老坑）。宽裕时靠 `my-auto` 居中，效果一样。 */}
        <div className={`flex min-h-0 flex-col overflow-y-auto px-2 py-1.5 sm:px-4 md:w-[460px] md:flex-none md:border-l md:border-dq-border md:pr-12 ${
          panelsOpen
            ? 'dq-wb-play-sheet fixed inset-x-0 bottom-0 z-40 max-h-[80dvh] rounded-t-xl border-t border-dq-border bg-dq-panel pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:bottom-auto md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:bg-transparent'
            : 'dq-wb-play-fill'
        }`}>
          {/* 栏内间距：手机上 4px（`gap-1`）、桌面 6px —— 手机上省下的这 12px 全部让给盘面的可见部分，
            比"少显示一行榜单"划算（榜单行数已经压到 2 行，再压就只剩标题了）。 */}
          {panelsOpen && (
            <div className="mb-2 flex shrink-0 items-center justify-between md:hidden">
              <span className="text-sm text-dq-gold">集结讨伐 · 详情</span>
              <button onClick={() => setPanelsOpen(false)} aria-label="关闭"
                className="dq-tap rounded px-2 text-[#a89478] hover:text-dq-gold">✕</button>
            </div>
          )}
          <div className="dq-wb-column my-auto flex w-full flex-col gap-1 md:gap-1.5">
          {/* 排行榜：用户定「底部排行榜太丑，放到消消乐上面，竖着排、有名字、有每个人的伤害百分比」 */}
          <RankList state={wb} contribPct={contribPct} />

          {/* 我的贡献。用户定「把贡献的值和百分比 ui 化一点、更清晰明了」——
              原先是一根条 + 一行挤在右边的小字，数值和占比在视觉上分不出主次。 */}
          <div className="flex items-center gap-2 rounded border border-dq-border bg-black/30 px-2 py-0.5" data-wb-mine-panel>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[10px] text-[#a89478]">我的贡献</span>
                {/* tabular-nums + 定宽：这个数字每消一笔就变一次、位数也会变（「9.0万」→「12.3万」），
                    不定宽的话会把它右边那枚占比徽标推着左右挪 */}
                <span className="min-w-[54px] shrink-0 tabular-nums text-sm font-bold leading-tight text-dq-fire sm:min-w-[64px] sm:text-base"
                  data-wb-mine-num>
                  {fmtNum(me?.damage ?? 0)}
                </span>
                <span className={`min-w-[42px] shrink-0 rounded border px-1 text-center tabular-nums text-[10px] leading-tight ${defeated ? 'border-dq-qing text-dq-qing' : 'border-dq-gold/60 text-dq-gold'}`}
                  data-wb-mine-pct>
                  {contribPct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full border border-dq-border bg-black/50">
                <div className={`h-full transition-[width] duration-300 ${defeated ? 'bg-dq-qing' : 'bg-dq-gold'}`}
                  style={{ width: `${contribPct}%` }} data-wb-mine-bar />
              </div>
            </div>
            <div className="shrink-0 text-right text-[10px] leading-tight text-[#a89478]" title={me && me.rank > 0 ? `超过 ${me.percentile}% 的人` : undefined}>
              {/* rank=0 = 名次还没定（下一笔轮询才出来），显示成「第 0 名」会被当成 bug */}
              {me ? <>{me.rank > 0 ? <>第 <span className="tabular-nums text-dq-gold">{me.rank}</span> 名</> : '名次待定'}<br />{wb.participants} 人合击</> : '尚未出手'}
            </div>
          </div>

          <div className="dq-wb-board-first flex flex-col items-center gap-1">
            <MatchBoard disabled={defeated || ended} onClear={onMatchClear} fmtDamage={fmtNum} />
            {/* 攒着还没发出去的那部分。不显示的话，玩家连消几下会以为"消了不掉血" */}
            {/* ⚠️ 这一行**必须常驻**，不可见时也得占着高度（`invisible` 而不是条件渲染）。
                它是整页唯一会随每一笔上报「出现 / 消失」的元素，而右栏在窄屏下是"内容多高就多高"、
                BOSS 区是 flex-1 —— 它一冒出来就把 BOSS 区和整条血条**顶上去 19px**，
                上报回执一到、queued 归零，又掉回来。实测（temp/probe-boss-jitter.cjs，390×844）：
                BOSS 区高度在 243/224 之间反复跳、血条 y 在 301/282 之间反复跳，
                连消的时候整个屏幕一直在上下弹（玩家报「不要让这个屏幕整体抖动」）。
                给它一个恒定高度，抖动从结构上消失 —— 不是把动画调慢那种糊弄。 */}
            <div className={`h-4 text-[10px] text-dq-fire ${queued > 0 ? '' : 'invisible'}`}
              data-wb-queued={queued}>
              结算中 +{fmtNum(queued)}
            </div>
            {/* 击败奖励的**常驻标注**（用户定「掉落奖励标注一下」）。同样写死高度 + truncate：
                宁可截断，也不许文案长短去挤上面那条 flex-1 的 BOSS 区（理由见上一行）。
                `title` 里放完整数值，桌面 hover 可见 —— 界面上只念种类与分配规则，
                精确到个位的数在领奖邮件里本来就一目了然，写死在这儿反而容易过期。 */}
            <div className="h-4 max-w-full truncate text-[10px] text-[#a89478]"
              title={reward.full || undefined} data-wb-reward-text={reward.short}>
              {reward.short}
            </div>
          </div>

          <MySquad state={state} />

          {/* ★ **众筹重启**（2026-09-21）：把那 100 万拆开收 —— 用户的病根是「100w 很多人付不起」，
              所以这一块排在单人重启**上面**（它才是大多数人用得上的那个入口）。
              高度全部**写死**（理由见上面 `data-wb-queued` 那段长注释）：这一栏挤不下时宁可自己滚，
              也绝不许把上面的 BOSS 区顶来顶去。
              服务端不下发 `crowd` 时（对上了还没更新的旧后端）整块不渲染 —— 宁可不显示，
              也不显示一条"目标 0、还差 0"的假进度条（那会变成一个看起来免费的按钮）。 */}
          {!ended && crowd && (
            <div className="flex flex-col gap-1 rounded border border-dq-border bg-black/30 px-2 py-1"
              data-wb-crowd
              data-wb-crowd-raised={crowd.raised}
              data-wb-crowd-goal={crowd.goal}
              data-wb-crowd-mine={crowd.mine}
              data-wb-crowd-allowed={crowd.allowed ? '1' : '0'}>
              <div className="flex items-baseline justify-between text-[10px]">
                <span className="text-dq-gold">
                  众筹重启
                  {crowd.count > 0 && <span className="ml-1 text-[#a89478]">已合力重启 {crowd.count} 次</span>}
                </span>
                <span className="tabular-nums text-[#a89478]">
                  {fmtNum(crowd.raised)} / {fmtNum(crowd.goal)}
                  <span className="ml-1 text-dq-fire">{crowdPct.toFixed(1)}%</span>
                </span>
              </div>
              {/* 进度条：与全服血条同一个视觉语言（窄条 + 圆角），一眼看得出"还差多少" */}
              <div className="h-1.5 overflow-hidden rounded-full border border-dq-border bg-black/50">
                <div className="h-full bg-gradient-to-r from-amber-600 to-dq-gold transition-[width] duration-300"
                  style={{ width: `${crowdPct}%` }} data-wb-crowd-bar />
              </div>
              {/* 出资榜**横着排一行**，不另开一块竖榜：这一栏的高度是稀缺资源，
                  而"谁出了多少"只要一眼的可见度就够了（完整榜单在服务端那边）。 */}
              <div className="h-4 truncate text-[10px] leading-4 text-[#a89478]" data-wb-crowd-board>
                {crowd.board.length === 0
                  ? '还没有人出资 · 凑满即自动重启'
                  : crowd.board.slice(0, 3).map(b => `${b.name} ${fmtNum(b.amount)}`).join(' · ')
                    + (crowd.contributors > 3 ? ` · 共 ${crowd.contributors} 人` : '')}
              </div>
              {/* 出资口。**常驻**（未打满时禁用）—— 与重启按钮同一个理由：条件渲染会在打满那一刻
                  把整块顶一下，而那正是玩家正盯着屏幕的瞬间。 */}
              <div className="flex items-center gap-1">
                <input
                  type="number" inputMode="numeric"
                  value={crowdAmt}
                  onChange={e => setCrowdAmt(e.target.value)}
                  placeholder={`最低 ${fmtNum(crowd.min)}`}
                  disabled={!crowd.allowed || crowding}
                  data-wb-crowd-input
                  className="h-[26px] min-w-0 flex-1 rounded border border-dq-border bg-black/40 px-1.5 text-[11px] tabular-nums text-dq-gold outline-none focus:border-dq-gold/60 disabled:text-[#6b5b47]"
                />
                <button
                  onClick={() => void doCrowdfund()}
                  disabled={crowding || !crowd.allowed}
                  data-wb-crowd-pay
                  className="h-[26px] shrink-0 rounded border border-dq-gold/60 bg-dq-gold/10 px-2 text-[11px] text-dq-gold transition-colors hover:bg-dq-gold/20 disabled:cursor-not-allowed disabled:border-dq-border disabled:bg-transparent disabled:text-[#6b5b47]">
                  {crowding ? '出资中…' : '出资'}
                </button>
              </div>
              <div className="h-4 max-w-full truncate text-[10px] leading-tight text-dq-qing"
                title={crowdReward || undefined}>
                {!crowd.allowed
                  ? `今日已讨伐 ${kills}/${maxKills} 次，打满后可众筹重启`
                  : crowd.mine > 0
                    ? `我已出资 ${fmtNum(crowd.mine)} · 还差 ${fmtNum(crowd.left)} 凑满`
                    : `还差 ${fmtNum(crowd.left)} 凑满即自动重启 · 出资者另分红材料`}
              </div>
            </div>
          )}

          {/* 付费重启的出口。**常驻**（未打满时禁用），**不是**"打满三次才出现"：
              ① 条件渲染的一行会在打满那一刻把整条 BOSS 区顶一下 —— 就是 `data-wb-queued`
                 那一行踩过的坑（见上面的长注释），而打满正是玩家正盯着屏幕的瞬间；
              ② 这个机制本来就该提前让玩家看得见：此前要打满三次才第一次见到这个按钮，
                 没人知道"打满之后还能花钱重开"。
              高度写死（按钮 `h-[26px]` + 说明行 `h-4`），文案再长也只 truncate、绝不换行去挤上面。
              服务端不下发价钱时（`restart.cost` 缺失，例如对上了还没更新的旧后端）整块不渲染 ——
              宁可不显示，也不显示一个"花费 0 灵金"的按钮。
              ⚠️ **按钮 disabled 不等于放行**：真正的把关在服务端（`wbRestartAllowed`），
              客户端这份 `allowed` 只用来决定它能不能点。 */}
          {!ended && restartCost > 0 && (
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => void doRestart()}
                disabled={restarting || !wb.restart?.allowed}
                data-wb-restart
                data-wb-restart-cost={restartCost}
                className="h-[26px] w-full truncate rounded border border-dq-gold/60 bg-dq-gold/10 px-2 text-[11px] text-dq-gold transition-colors hover:bg-dq-gold/20 disabled:cursor-not-allowed disabled:border-dq-border disabled:bg-transparent disabled:text-[#6b5b47]">
                {restarting ? '重启中…' : `花费 ${fmtNum(restartCost)} 灵金重启世界 Boss`}
              </button>
              <div className="h-4 max-w-full truncate text-center text-[10px] leading-tight text-dq-qing">
                {!done
                  ? `今日已讨伐 ${kills}/${maxKills} 次，打满后可重启`
                  : wb.restart?.allowed
                    ? '本轮 3 次讨伐已毕：重启后血条回满，全服可再打 3 次'
                    : '奖励结算中，稍候即可重启'}
                {(wb.restart?.count ?? 0) > 0 && <span className="text-[#a89478]"> · 本期已重启 {wb.restart?.count} 次</span>}
              </div>
            </div>
          )}
          {/* 本期到点（重启也没用了）：只留一句提示。**高度与上面那块对齐**（26+4+4+gap=46），
              免得"到点"那一刻整页又跳一下 */}
          {ended && (
            <div className="flex h-[46px] items-center justify-center text-center text-[11px] text-dq-qing">
              本期已结束，奖励按贡献度发到了邮箱，去邮箱点「领取」入账
            </div>
          )}
          </div>
        </div>

        {/* 手机底部操作栏。**常驻**（不随弹窗开合增减），位置在 主区 的最后 ——
            手机 主区 是 flex-col，所以它就是贴底那一行；桌面 `md:hidden` 直接不是 flex 项。
            ⚠️ 左边那两个数是**故意不带 `data-wb-*` 锚点**的：锚点必须全页唯一
            （`data-wb-mine-num` 已经挂在弹窗里那一份上），这里再挂一份会让
            `querySelector` 取到"先出现的那个"，而它在手机上正是隐藏的弹窗里那份。 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-dq-border bg-dq-panel px-2 py-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[11px]">
              <span className="text-[#a89478]">我的贡献 </span>
              <span className="tabular-nums font-bold text-dq-fire">{fmtNum(me?.damage ?? 0)}</span>
              <span className="ml-1.5 tabular-nums text-dq-gold">{contribPct.toFixed(1)}%</span>
            </div>
            <div className="truncate text-[10px] text-[#a89478]">
              {crowd && !ended
                ? `众筹 ${crowdPct.toFixed(0)}% · 还差 ${fmtNum(crowd.left)}`
                : `本轮已讨伐 ${kills}/${maxKills} 次`}
            </div>
          </div>
          <button onClick={() => setPanelsOpen(o => !o)}
            className="dq-tap shrink-0 rounded border border-dq-gold/60 bg-dq-gold/10 px-3 py-1 text-[11px] text-dq-gold">
            {panelsOpen ? '收起' : '榜单 · 众筹 ›'}
          </button>
        </div>
      </div>

      {/* 战斗日志 */}
      {/* 战报。**手机上只留最新一行（22px）**，桌面仍是 3 行 56px ——
          手机的主屏是给盘面的，而这一条本来就是"扫一眼最近发生了什么"的滚动条，
          三行历史在 568px 高的屏幕上等于拿 56px 换两行没人回看的旧消息。
          ⚠️ 只**藏**不删：三条日志仍然渲染在文档里（`data-wb-log` / `data-wb-log-amount`
             是后台探针的锚点，注释掉会让手机视口下的读数整体消失）。
          ⚠️ 空态在手机上换一句短的：下面那句长说明是"首次进来教你怎么玩"的，
             22px 的盒子里它会被拦腰切断，读起来像坏掉了。短的这句与盘面下方的
             `data-m3-hint` 是同一件事的两种说法，手机上留着短的足够。 */}
      <div className="h-[22px] shrink-0 overflow-hidden border-t border-dq-border bg-black/40 px-2 py-0.5 text-[10px] leading-relaxed sm:px-4 sm:text-xs md:h-[56px] md:py-1">
        {logRef.current.length === 0
          ? <>
            <div className="text-[#6b5b47] max-md:hidden">点一格选中、再点相邻一格交换，凑齐三个同色即消。消掉几格就是几格伤害，不看阵容也不看战力。血条全服共用，打穿一轮发一次奖、一轮最多三次。{reward.full}</div>
            <div className="truncate text-[#6b5b47] md:hidden">点选或滑动相邻两格交换，消几格就是几格伤害 · 血条全服共用</div>
          </>
          : logRef.current.slice(0, 3).map((l, i) => (
            <div key={l.at} data-wb-log={l.text} data-wb-log-amount={l.amount ?? ''} className={i === 0 ? 'text-dq-gold' : 'text-[#a89478] max-md:hidden'}>{l.text}</div>
          ))}
      </div>
    </div>
  )
}