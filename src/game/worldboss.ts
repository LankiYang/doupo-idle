// 集结讨伐（世界 Boss）：拉全服状态 + 上报自己这次讨伐的伤害。
//
// 三条设计约束决定了这个文件的形状：
//
// ① **奖励不在这里发**（2026-09-17 起改由服务端自动发）。血条被打穿的那一刻，服务端就按
//    贡献度把「战报 + 附件」写好发到每个人的邮箱，玩家自己点「领取」。于是整个活动
//    **一个存档字段都没加**，奖励档位改了也不用重新构建部署。
//
// ② **伤害只看"消掉几格"，不看战力**（用户定：个人不设贡献配额、无限的、没有战力加成、
//    全靠个人努力）。伤害 = 格数 × MATCH_DAMAGE_PER_TILE（`src/game/match3.ts` 里的常数），
//    这笔乘法现在收口在 `MatchBoard.tsx` 的 onClear 里 —— 本模块只负责把算好的数上报，
//    所以这里没有、也不该有这个常数（早先那是点按模式留下的）。
//    早先那套「伤害 = 战力 × 系数」是额度制的产物，与"不看战力"直接冲突，已整块拆掉。
//
// ③ **状态不进存档**（红线：能不加字段就不加）。全服血条/榜单/我的伤害全在服务端，
//    客户端只是个显示器；唯一需要持久化的东西是"奖励领没领"，那一块走邮箱，与本模块无关。
//
// ④ **攻击手段只有消消乐**（用户定，2026-09-17：「只保留消消乐攻击世界boss」）。
//    早先那个"经典点按"模式（一次点按 = 一次平均交换的伤害）连同它的自动讨伐整个拆掉了 ——
//    留着两套产出速度相当的按钮，玩家只会问"点哪个划算"，而答案毫无意义。
//
// ⑤ **一期之内血条会被打穿三次**（用户定：「一天允许被击败三次」）。每打穿一次，服务端
//    按当轮贡献度发一次奖（每次是原来那一份的三分之一）、然后把血条立起来、参战伤害清零。
//    所以客户端看到的 `dealt` 会**突然归零** —— 那不是丢数据，是新一轮开始了，见 kills。
import { useSyncExternalStore } from 'react'
import { getPlayerId } from './leaderboardApi'
import { apiFetch } from './authApi'
import { isRemoteMode } from './remoteMode'
import { ITEM_INFO } from './data'
import { fmtNum } from './engine'
import { BOSS_FORM_MAX } from './monsters'

/** 轮询间隔。设计文档 §4 定的 1 分钟 —— 全服血条一分钟跳一次，不假装实时 */
export const WB_POLL_MS = 60 * 1000
/**
 * 服务端两次伤害上报之间的最小间隔（server.js 的 `WB_COOLDOWN`）。
 * 消消乐的连消节奏远快于它 —— 一次连锁可能几百毫秒就打完了，
 * 所以**消出来的伤害必须先攒后发**，见 queueMatchDamage。
 */
export const WB_COOLDOWN_MS = 2000

const API = `${import.meta.env.BASE_URL}api/worldboss`

export interface WbBoss { name: string; form: number; formLabel: string }
export interface WbMe {
  damage: number; attempts: number
  /** 我的贡献度 = 我打的 ÷ 全服已打（奖励就按它分）。**没有上限**，打多少算多少 */
  pct: number
  /** 我超过了多少人（0~100）。分母扣掉了自己，所以第 1 名是 100 */
  percentile: number
  rank: number
}
export interface WbBoardRow { rank: number; name: string; damage: number; pct: number }
export interface WbState {
  period: number
  startedAt: number
  endsAt: number
  ended: boolean
  settled: boolean
  /** **这一轮**的血条被打穿了，正在（或即将）结算发奖。不等于本期结束 —— 见 kills */
  defeated: boolean
  /** 本期（今日）已被击败几次，打满 maxKills 本期就收官了 */
  kills: number
  /** 一期之内最多被击败几次（服务端定，当前是 3） */
  maxKills: number
  boss: WbBoss
  totalHp: number
  dealt: number
  remain: number
  remainPct: number
  progressPct: number
  participants: number
  /**
   * 本轮的奖励配置（服务端给的**原值**，界面只负责把它念出来）。
   * ️ 界面**不许**自己写一份数字：这个项目反复踩「两份实现必然漂」的坑，
   *    奖励尤其抄不得 —— 改了服务端而界面还写着旧数，等于向玩家报假账。
   */
  reward: WbReward | null
  /**
   * 付费重启的配置（服务端给的**原值**，价钱绝不在这里抄一份）。
   * `allowed` 由服务端算：今日三次打满**且**奖励结算完才为真。
   */
  restart: WbRestart | null
  /**
   * ★ **众筹重启**（2026-09-21）：把单人重启那 100 万拆开收的那条路。
   * 与 `restart` **并列**存在 —— 单人直重启保留，众筹只是多开的一个入口。
   * 同样是服务端给的**原值**，界面一个数字都不许自己算（改了服务端就会向玩家报假账）。
   */
  crowd: WbCrowd | null
  /**
   * 最近一条**全服通知**（当前只有"有人花钱重启了世界 Boss"这一种）。
   * 按 `seq` 去重 —— **别按 at**：两台机器时钟差几毫秒就会各显示一次。
   */
  notice: WbNotice | null
  me: WbMe | null
  board: WbBoardRow[]
}
export interface WbRestart {
  /** 重启一次的价钱。**键是道具 id**（当前只有 coin 灵金），界面按 ITEM_INFO 念名字 */
  cost: Record<string, number>
  allowed: boolean
  /** 本期已经重启过几次（只做记录） */
  count: number
}
/** 众筹出资榜的一行。与伤害榜同形，但比的是**出了多少钱** */
export interface WbCrowdRow { rank: number; name: string; amount: number; pct: number }
/**
 * ★ 众筹状态（服务端 `wbPublicState.crowd`）。
 *
 * 出资与分红是**两件事**，界面上要分得开：
 *  · **出资** —— 凑满 `goal` 就自动重启（效果与单人重启逐字相同）；
 *    本期没凑满则原样全额退还（走邮件，点领取入账）。
 *  · **分红** —— 这次众筹买下的那一轮被打穿时，出资者**另外**分一份材料，
 *    与「按伤害贡献」那份奖**各算各的、两笔都拿**。
 */
export interface WbCrowd {
  /** 众筹目标（灵金）。与单人重启是同一笔钱，只是拆开收 */
  goal: number
  /** 单次最低出资 */
  min: number
  raised: number
  /** 还差多少凑满。单笔出资**由服务端自动截到它**（想多出也只会买到正好凑满） */
  left: number
  contributors: number
  /** 我已经出了多少（0 = 还没出过） */
  mine: number
  /** 本期已合力重启几次 */
  count: number
  /**
   * 现在能不能出资。判据与单人重启**同一个**（今日三次打满且奖励结算完）——
   * 众筹买的就是"再来一轮"，没打满时收钱等于卖一个还不存在的东西。
   * ⚠️ 它只决定按钮能不能点，**真正的把关在服务端**（客户端说了不算）。
   */
  allowed: boolean
  /** 分红·人人保底的那一份（键是道具 id，界面按 ITEM_INFO 念名字） */
  base: Record<string, number>
  /** 分红·按出资比例分的那一份 */
  pool: Record<string, number>
  board: WbCrowdRow[]
}
export interface WbNotice { seq: number; text: string; at: number }
/** 服务端 `WB_REWARD` + 缘分丹的区间（见 api/server.js 的 WB_REWARD） */
export interface WbReward {
  base: Record<string, number>
  pool: Record<string, number>
  /** 缘分丹：按贡献度落在 [min, max] 之间，**保底 min 颗** */
  yuanfenMin: number
  yuanfenMax: number
  maxKills: number
}
export interface WbReport {
  ok: boolean
  /** 服务端实际收下的伤害（超出剩余血量会被**截断**，不是整条拒绝） */
  accepted: number
  capped: boolean
  /** 我这边的累计伤害。**可为 null** —— 被拒（冷却/已结束/已击败）的回执里这几个字段是缺的 */
  damage: number | null
  /** 全服血条的即时快照。回执里带着它，界面就不用再补一个 GET（见 applyReport） */
  totalHp: number | null
  dealt: number | null
  progressPct: number | null
  participants: number | null
  /** 血条是否已被打穿（**重生之后**的值：今日还有次数时，打穿那一笔回的就是 false） */
  defeated: boolean
  /**
   * 这一笔把血条打穿了（血条已重置、本轮伤害清零）。
   * 与 defeated 分开：后者是"当前锁没锁"，这个才是"我刚打赢了" —— 一天要赢三次，
   * 光看 defeated 的话第 1、2 次根本认不出来（打穿即重生，回执里它是 false）。
   */
  justKilled: boolean
  /** 今日已讨伐次数。可缺 —— 老服务端不给 */
  kills: number | null
  maxKills: number | null
  /**
   * 这一笔是**付费重启动**（不是伤害上报），且服务端**照做了**。
   * 只有它为真时调用方才允许"这笔钱花出去了"。
   */
  restarted: boolean
  /**
   * 这一笔是**众筹出资**，且服务端**收下了这笔钱**。
   * 与 `restarted` 同一个意思：只有它为真时，调用方才允许认为钱花出去了。
   *
   * ⚠️ 名字**必须**和状态字段 `crowd`（众筹池读数，是个对象）区分开。服务端的回执是
   *    把完整状态 `Object.assign` 之后一起带回来的 —— 回执里若也叫 `crowd: true`，
   *    这个布尔就会**覆盖掉**状态里的对象，`parseWorldBoss` 读 `o.crowd.goal` 拿到
   *    undefined ⇒ 整块判无效 ⇒ crowd 变 null。表现是每出一笔资面板就闪没一次。
   *    （`restarted` 而不叫 `restart`，本来就是同一条纪律。）
   */
  crowdfunded: boolean
  /** 这一笔实际收下的出资额。**可能小于请求值** —— 服务端会截到"还差多少凑满" */
  donated: number
  /** 这一笔把众筹池**凑满**了（血条随即回满、讨伐次数归零），通知也会跟着发 */
  filled: boolean
  /**
   * ok=false 时的原因：
   * 伤害上报 'cooldown' | 'defeated' | 'period ended'
   * 单人重启 'not-exhausted' | 'settling' | 'poor'
   * 众筹    'not-exhausted' | 'settling' | 'filled' | 'too-small' | 'need_login' | 'poor'
   */
  reason: string
}

/** 数值兜底：非数字/负数一律当 0，避免 NaN 顺着渲染扩散 */
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

/**
 * 把 GET /api/worldboss 的原文解析成可用状态。**逐字段容错**（与 rewards.ts / mail.ts 同一套口径）：
 * 服务端字段一旦改名，宁可让界面少显示一块，也不能让整个页面白屏。
 *
 * `bossFormMax`：这条夹取要按**这只 Boss 自己**有几张立绘来。第二只 Boss（连连看讨伐）
 * 复用了这个解析函数（两边的返回形状是同一份 `wbPublicState`），但立绘张数是各自一份 ——
 * 传默认值就是第一只的老行为，**调用方不传时逐字节不变**。
 */
export function parseWorldBoss(raw: unknown, bossFormMax: number = BOSS_FORM_MAX): WbState {
  const o = (raw ?? {}) as Record<string, unknown>
  const b = (o.boss ?? {}) as Record<string, unknown>
  const meRaw = o.me as Record<string, unknown> | null | undefined
  const boardRaw = Array.isArray(o.board) ? o.board : []
  const board: WbBoardRow[] = []
  for (const it of boardRaw.slice(0, 20)) {
    const r = (it ?? {}) as Record<string, unknown>
    const name = str(r.name)
    if (!name) continue // 没昵称的行在榜上就是一条空白，跳过
    board.push({ rank: num(r.rank), name, damage: num(r.damage), pct: num(r.pct) })
  }
  const rwRaw = (o.reward ?? {}) as Record<string, unknown>
  // 奖励里的数字**逐项容错**：任何一项不是有限正数就丢掉它，界面少念一项就是了，
  // 绝不因为服务端多/少一个字段就整块不显示（与 board 的处理同一口径）
  const numMap = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {}
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const n = Number(val)
        if (Number.isFinite(n) && n > 0) out[k] = n
      }
    }
    return out
  }
  const rwBase = numMap(rwRaw.base), rwPool = numMap(rwRaw.pool)
  const rwMin = num(rwRaw.yuanfenMin), rwMax = num(rwRaw.yuanfenMax)
  const reward: WbReward | null =
    (Object.keys(rwBase).length || Object.keys(rwPool).length || rwMax > 0)
      ? { base: rwBase, pool: rwPool, yuanfenMin: rwMin, yuanfenMax: rwMax, maxKills: num(rwRaw.maxKills) || num(o.maxKills) || 3 }
      : null
  const totalHp = num(o.totalHp)
  const dealt = num(o.dealt)
  // 付费重启：cost 与 reward 同一套口径 —— **逐项容错**，一项都不是正数就整块当没有，
  // 界面少显示一块，总好过凭空报一个 0 价（那会变成"免费重启"的假按钮）
  const rsRaw = (o.restart ?? {}) as Record<string, unknown>
  const rsCost = numMap(rsRaw.cost)
  const restart: WbRestart | null = Object.keys(rsCost).length
    ? { cost: rsCost, allowed: rsRaw.allowed === true, count: num(rsRaw.count) }
    : null
  /**
   * 众筹：与 restart **同一套口径** —— 逐项容错，`goal` 不是正数就整块当没有。
   * 界面少显示一块，总好过凭空报一个"目标 0、还差 0"的假进度条
   * （那样的按钮看起来是免费的，点下去才知道不是 —— 正是这套口径要避免的事）。
   */
  const crRaw = (o.crowd ?? {}) as Record<string, unknown>
  const crBoardRaw = Array.isArray(crRaw.board) ? crRaw.board : []
  const crBoard: WbCrowdRow[] = []
  for (const it of crBoardRaw.slice(0, 20)) {
    const r = (it ?? {}) as Record<string, unknown>
    const name = str(r.name)
    if (!name) continue            // 没昵称的行在榜上就是一条空白，跳过（与伤害榜同一条）
    crBoard.push({ rank: num(r.rank), name, amount: num(r.amount), pct: num(r.pct) })
  }
  const crGoal = num(crRaw.goal)
  const crRaised = num(crRaw.raised)
  const crowd: WbCrowd | null = crGoal > 0 ? {
    goal: crGoal,
    min: num(crRaw.min),
    raised: crRaised,
    // 服务端给的是权威值；万一缺字段（老服务端）就自己兜算一下，
    // 别让进度条凭空归零（与 remainPct 的处理同一条）
    left: crRaw.left === undefined ? Math.max(0, crGoal - crRaised) : num(crRaw.left),
    contributors: num(crRaw.contributors),
    mine: num(crRaw.mine),
    count: num(crRaw.count),
    allowed: crRaw.allowed === true,
    base: numMap(crRaw.base),
    pool: numMap(crRaw.pool),
    board: crBoard,
  } : null
  const ntRaw = (o.notice ?? null) as Record<string, unknown> | null
  const ntSeq = ntRaw ? num(ntRaw.seq) : 0
  const notice: WbNotice | null = ntRaw && ntSeq > 0 && str(ntRaw.text)
    ? { seq: ntSeq, text: str(ntRaw.text), at: num(ntRaw.at) }
    : null
  return {
    period: num(o.period),
    startedAt: num(o.startedAt),
    endsAt: num(o.endsAt),
    ended: o.ended === true,
    settled: o.settled === true,
    defeated: o.defeated === true,
    boss: {
      name: str(b.name, '未知'),
      // 形态号**按手里有几张立绘夹**（不是写死 4）：服务端将来加一档、这份产物还没有那张图时，
      // 这里退回最后一档的样子 —— 与 bossSpriteFor 的"就近退回"是同一套兜底
      form: Math.min(bossFormMax || 1, Math.max(1, num(b.form) || 1)),
      formLabel: str(b.formLabel),
    },
    totalHp,
    dealt,
    remain: num(o.remain),
    // 服务端给的是权威值；只有它缺失时才用 dealt/totalHp 兜算，别让进度条凭空归零
    remainPct: o.remainPct === undefined && totalHp > 0 ? Math.max(0, 100 - (dealt / totalHp) * 100) : num(o.remainPct),
    progressPct: o.progressPct === undefined && totalHp > 0 ? (dealt / totalHp) * 100 : num(o.progressPct),
    participants: num(o.participants),
    kills: num(o.kills),
    // 服务端给了就信它；万一缺字段（老服务端）退回 3，界面至少不会显示成「0/0」
    maxKills: num(o.maxKills) || 3,
    reward,
    restart,
    crowd,
    notice,
    me: meRaw && typeof meRaw === 'object' ? {
      damage: num(meRaw.damage),
      attempts: num(meRaw.attempts),
      pct: num(meRaw.pct),
      percentile: num(meRaw.percentile),
      rank: num(meRaw.rank),
    } : null,
    board,
  }
}

/**
 * 把服务端给的奖励配置念成中文。**数字全部来自服务端**（`WbReward`），这里只负责措辞与排序 ——
 * 界面上不许自己写死一份数：改了 `WB_REWARD` 而界面还念旧数，等于向玩家报假账。
 *
 * 返回两种粒度：`short` 给界面上那行常驻标注（窄屏放得下），`full` 给 `title` 与日志区。
 */
export function rewardLabelsOf(r: WbReward | null): { short: string; full: string } {
  const empty = { short: '', full: '' }
  if (!r) return empty
  const kinds = [...new Set([...Object.keys(r.base), ...Object.keys(r.pool)])]
  if (kinds.length === 0 && !(r.yuanfenMax > 0)) return empty
  const nm = (k: string) => ITEM_INFO[k]?.name ?? k
  const yfName = r.yuanfenMax > 0 ? `缘分丹${r.yuanfenMin}~${r.yuanfenMax}颗` : ''
  const short = `击败奖励 ${[...kinds.map(nm), ...(yfName ? [yfName] : [])].join('·')}（按贡献度分）`
  const baseSeg = Object.keys(r.base).map(k => `${nm(k)} ${fmtNum(r.base[k])}`).join('、')
  const poolSeg = Object.keys(r.pool).map(k => `${nm(k)} ${fmtNum(r.pool[k])}`).join('、')
  const full = [
    baseSeg ? `人人有份：${baseSeg}` : '',
    poolSeg ? `奖池按贡献度分：${poolSeg}` : '',
    yfName ? `缘分丹保底 ${r.yuanfenMin} 颗、最高 ${r.yuanfenMax} 颗` : '',
  ].filter(Boolean).join('；')
  return { short, full }
}

/**
 * 把**众筹分红池**念成中文。与 `rewardLabelsOf` 同一条红线：
 * **数字与种类全部来自服务端**（`WbCrowd` 的 base / pool），这里只负责措辞与排序 ——
 * 界面上写死一份材料清单的话，改了服务端而界面还念旧数，等于向玩家报假账。
 */
export function crowdRewardLabelOf(c: WbCrowd | null): string {
  if (!c) return ''
  const kinds = [...new Set([...Object.keys(c.base), ...Object.keys(c.pool)])]
  if (kinds.length === 0) return ''
  const nm = (k: string) => ITEM_INFO[k]?.name ?? k
  return `出资者额外分红 ${kinds.map(nm).join('·')}（人人保底 + 其余按出资比例）`
}

/** 解析一次上报的回执。缺字段一律按"没接受"处理 —— 宁可少算一次伤害，也不能凭空多算 */
export function parseReport(raw: unknown): WbReport {
  const o = (raw ?? {}) as Record<string, unknown>
  /**
   * 「缺失」与「0」要分得开：num() 把负数/非数字都压成 0，用在**必给**的字段上没问题，
   * 但回执里的血条/我的伤害是**可缺**的 —— 被冷却拒的回执就不带它们。
   * 压成 0 再合并进界面，等于"血条被打成 0"，见 applyReport。
   */
  const opt = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return {
    ok: o.ok === true,
    accepted: num(o.accepted),
    capped: o.capped === true,
    damage: opt(o.damage),
    totalHp: opt(o.totalHp),
    dealt: opt(o.dealt),
    progressPct: opt(o.progressPct),
    participants: opt(o.participants),
    defeated: o.defeated === true,
    justKilled: o.justKilled === true,
    kills: opt(o.kills),
    maxKills: opt(o.maxKills),
    restarted: o.restarted === true,
    crowdfunded: o.crowdfunded === true,
    donated: num(o.donated),
    filled: o.filled === true,
    reason: str(o.reason),
  }
}

/** 拉全服状态。网络失败/404 直接抛，由调用方吞掉 —— 讨伐页拉不到不该影响游戏本身 */
export async function fetchWorldBoss(): Promise<WbState> {
  const res = await apiFetch(`${API}?playerId=${encodeURIComponent(getPlayerId())}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseWorldBoss(await res.json())
}

/** 上报一次讨伐。注意 ok:false 也**不是网络错误**（冷却/已击败/本期已结束），照常返回回执 */
export async function reportDamage(damage: number, clears = 0, tiles = 0): Promise<WbReport> {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: getPlayerId(),
      damage: Math.max(0, Math.floor(damage)),
      // 活动中心那两个计数指标（boss.hit / match3.tiles）。**只有远程模式才带**（见
      // `metricsForRemote`）：老客户端不带 ⇒ 服务端一分不动，它们仍靠自己本地 bump + 上传，
      // 今天怎么算现在还怎么算。
      ...metricsForRemote(clears, tiles),
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseReport(await res.json())
}

/**
 * 计数指标要不要随这笔上报送上去。
 *
 * ⚠️ 判据是**模式**，不是"值大不大"：本地模式下客户端自己 `bumpMetric`（老行为），
 *    再送一份上去就成了**双份**（服务端记一份、客户端那份随 `POST /save` 上传又盖回来）。
 *    远程模式下客户端不记（`bumpMetric` 是 no-op），这一份是**唯一**的来源。
 * ⚠️ `0` 也要送：`clears` 为 0 而 `tiles` 不为 0 是可能的（配置里只配了格子那一条），
 *    省掉一个 0 会让服务端把这一笔当成"老客户端"。
 */
function metricsForRemote(clears: number, tiles: number): Record<string, number> {
  if (!isRemoteMode()) return {}
  const c = Math.max(0, Math.floor(clears))
  const t = Math.max(0, Math.floor(tiles))
  return (c || t) ? { clears: c, tiles: t } : {}
}

/**
 * 请服务端**重启世界 Boss**（用户定 2026-09-17：每日三次打满后可以花钱重启）。
 *
 * ⚠️ **远程模式下不在这里扣钱**，本地模式下才扣。判据是**服务端认不认得出你是谁**：
 *    这条请求经 `apiFetch` 发出，带着 `Authorization: Bearer`，
 *    服务端（`/worldboss` 的 `action:'restart'`）能解析出令牌主人时**由它扣**，
 *    解析不出（老客户端 / 没登录的裸存档码）时才退回老路径（客户端自己扣）。
 *    两边都扣 = 双花，所以**客户端只在本地模式扣** —— 见 `WorldBossView.doRestart`。
 *
 * ⚠️ **必须先请求、后扣费**：服务端说不行（没打满 / 还在结算 / 灵金不够）的时候
 *    一分钱都不该动。失败就把钱退回去，别留下"点了没反应还扣了钱"。
 *
 * 回执带的是**完整状态**（与 GET 同一份 wbPublicState），所以成功时直接拿它整个换掉快照，
 * 不用再补一次 GET；换的时候顺手把「全服合力」的读数基准归零 —— 重启后 dealt 就是 0。
 *
 * ⚠️ 灵金不足时服务端回 `reason:'poor'` 且**重启不发生**（钱优先，见 server.js 那段注释）；
 *    调用方要把它当成"没重启"处理，别当成网络错误去重试。
 */
export async function restartWorldBoss(): Promise<{ ok: boolean; restarted: boolean; reason: string }> {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), action: 'restart' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = await res.json()
  const r = parseReport(raw)
  if (r.restarted) {
    const next = parseWorldBoss(raw)
    pollBaseDealt = next.dealt
    pollDelta = 0
    setSnapshot(next)
  }
  return { ok: r.ok, restarted: r.restarted, reason: r.reason }
}

/**
 * ★ **众筹出资**（2026-09-21，用户定）：把单人重启那 100 万拆开收。
 *
 * 形状与 `restartWorldBoss` 几乎一样，两点关键差别：
 *
 * ⚠️ **钱一律由服务端扣，这里绝不碰余额** —— 众筹**没有**"本地模式下客户端自己扣"那条老路。
 *    理由是记账：服务端必须知道**是谁**出的钱，才能按人记、才能在打穿后按人分红。
 *    所以这一条请求必须带着令牌；服务端认不出令牌时直接拒绝（`reason:'need_login'`），
 *    一分钱都不收 —— 那正是"让客户端自报出资额"这个口子必须堵上的原因。
 *
 * ⚠️ **`donated` 可能小于请求值**：服务端会把这一笔**截到"还差多少凑满"**，
 *    回执里那个才是真正扣掉的数。给玩家看的必须是它，不能是自己请求的那个数。
 */
export async function crowdfundWorldBoss(amount: number): Promise<{
  ok: boolean; crowdfunded: boolean; donated: number; filled: boolean; reason: string
}> {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), action: 'crowdfund', amount: Math.floor(amount) }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = await res.json()
  const r = parseReport(raw)
  if (r.crowdfunded) {
    // 回执带的是**完整状态**（与 GET 同一份 wbPublicState）⇒ 成功时整个换掉快照，不用再补 GET；
    // 顺手把「全服合力」的读数基准归零 —— 凑满重启之后 dealt 就是 0（与 restartWorldBoss 一致）。
    const next = parseWorldBoss(raw)
    pollBaseDealt = next.dealt
    pollDelta = 0
    setSnapshot(next)
  }
  return { ok: r.ok, crowdfunded: r.crowdfunded, donated: r.donated, filled: r.filled, reason: r.reason }
}

// ─────────────────────── 模块级小 store ───────────────────────
// 状态**不进存档**（红线），所以放在模块里，由 useSyncExternalStore 订阅。
// 刻意不 import engine：worldboss 是个独立的网络模块，反向依赖整个 engine 会让它没法单独测。
let snapshot: WbState | null = null
let lastError = ''
/**
 * 「全服合力打掉多少」的读数基准。
 *
 * 为什么需要它：界面要报一句"这一分钟全服一起打掉了多少"（共斗感就落在这一行字上），
 * 但 dealt 的变化**既有别人的、也有我自己的** —— 我自己上报的回执也会把 dealt 顶上去。
 * 只按 dealt 的差来算的话，每消一笔就会多推一条「全服合力打掉 X」，而日志一屏只显示 4 条，
 * 连消几下就把自己的战报全挤没了，还把我一个人说成"全服"。
 * 所以：**上报时把基准同步吃掉**（applyReport 里），轮询时算出来的差就只剩别人的了。
 */
let pollBaseDealt: number | null = null
let pollSeq = 0
let pollDelta = 0
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

function setSnapshot(next: WbState | null, err = '') {
  snapshot = next
  lastError = err
  emit()
}

export function subscribeWorldBoss(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export const worldBossSnapshot = () => snapshot

/** 订阅读取。两个值分开取（而不是打包成对象）：每次 emit 都返回新对象会让 React 无限重渲 */
export function useWorldBoss(): WbState | null {
  return useSyncExternalStore(subscribeWorldBoss, worldBossSnapshot, worldBossSnapshot)
}
export function useWorldBossError(): string {
  return useSyncExternalStore(subscribeWorldBoss, () => lastError, () => lastError)
}
/** 轮询序号：每次**轮询**带回"别人打掉了"就 +1。界面靠它触发一次日志，而不是靠值变化（值会重复） */
export function useWorldBossPollSeq(): number {
  return useSyncExternalStore(subscribeWorldBoss, () => pollSeq, () => pollSeq)
}
/** 上次轮询里**别人**打掉的量（已经扣掉我自己，见 pollBaseDealt） */
export function useWorldBossPollDelta(): number {
  return useSyncExternalStore(subscribeWorldBoss, () => pollDelta, () => pollDelta)
}

/** 重新拉一次全服状态 */
export async function refreshWorldBoss(): Promise<void> {
  try {
    const next = await fetchWorldBoss()
    if (pollBaseDealt !== null && next.dealt > pollBaseDealt) {
      pollDelta = next.dealt - pollBaseDealt
      pollSeq++
    }
    pollBaseDealt = next.dealt
    setSnapshot(next)
  } catch (e) {
    // 保留上一次的好数据，只把错误亮出来 —— 一次网络抖动不该让界面清空
    setSnapshot(snapshot, e instanceof Error ? e.message : String(e))
  }
}

/**
 * 把上报回执合并进当前状态。
 *
 * 为什么不再「打完立刻 GET 一次」：消消乐每 2 秒就发一笔伤害，每次都跟一个 GET
 * 就是 30 倍请求量。而回执里已经带了界面要的全部字段（我的总伤害、全服已打、总血量、
 * 是否打穿），够用了；榜单名次那几项回执没有，交给每分钟的轮询补齐 —— 名次本来就是慢变量。
 */
function applyReport(r: WbReport): void {
  const s = snapshot
  if (!s) return
  const myDamage = r.damage ?? s.me?.damage ?? 0
  /**
   * 从没参战过、这笔也没打进去（冷却/已结束/已击败）→ 别凭空把我造到榜上。
   *
   * ⚠️ 但**打穿的那一笔是例外**（`justKilled`）：一天三次的模型下服务端打穿即重生，
   *    回执报的是**新一轮**的账 —— 我的本轮伤害当然是 0。于是「第一次参战、又正好
   *    收掉最后一刀」的人在这里就成了「s.me 为空 + myDamage 为 0」，整张回执（连
   *    kills 一起）被这句静默吞掉：界面停在「今日已讨伐 0/3」、打赢的战报也不弹，
   *    要等下一笔上报或下一分钟轮询才补上。v1.36 之前不会 —— 那时打穿不重生，
   *    回执带的是真伤害，走不到这个分支。
   */
  if (!s.me && myDamage <= 0 && !r.justKilled) {
    // 全服战果（kills / defeated）照样得跟上：别人打穿的那一笔也会落到这条路径上
    setSnapshot({ ...s, defeated: s.defeated || r.defeated, kills: r.kills ?? s.kills })
    return
  }
  const me: WbMe = s.me
    ? { ...s.me, damage: myDamage }
    : { damage: myDamage, attempts: 1, pct: 0, percentile: 0, rank: 0 }
  // 血条这几个字段**回执里可能没有**（被拒的回执）——那就只更新"我"，别动全服血条。
  // 早先无脑按 0 合并，导致被冷却拒一次血条就归零，要等下一分钟轮询才恢复。
  // 被拒的回执只带 kills（不带血条）—— 那也要更新，否则「今日已讨伐 N/3」会停在旧值
  if (r.totalHp === null || r.dealt === null) {
    setSnapshot({ ...s, me, defeated: s.defeated || r.defeated, kills: r.kills ?? s.kills })
    return
  }
  pollBaseDealt = r.dealt   // 我打的这部分不算进「全服合力」（见 pollBaseDealt 的说明）
  const remain = Math.max(0, r.totalHp - r.dealt)
  /** 这一笔把血条打穿了：服务端已经就地把血条立起来，回执里是**新一轮**的开局读数 */
  const killedNow = r.justKilled === true
  setSnapshot({
    ...s,
    totalHp: r.totalHp,
    dealt: r.dealt,
    remain,
    remainPct: r.totalHp > 0 ? Math.round((remain / r.totalHp) * 1000) / 10 : s.remainPct,
    progressPct: r.progressPct ?? s.progressPct,
    participants: r.participants ?? s.participants,
    // 平时「打穿了就**只升不降**」：回执里 defeated 缺失时不能把它抹回 false，
    // 否则界面会从"已击败"闪回"还能打"（血条明明是 0）。
    // ⚠️ 但打穿的那一笔是例外：它回的是**重生后**的状态（dealt=0、defeated=false），
    //    再"只升不降"就会把上一轮残留的 true 粘住，盘面永远锁着解不开。
    //    服务端用 justKilled 明说了"这一笔打赢了"，那就以回执为准。
    defeated: killedNow ? r.defeated : (s.defeated || r.defeated || remain <= 0),
    kills: r.kills ?? s.kills,
    me,
  })
}

// ── 攒伤害的队列（消消乐专用）────────────────────────────────────
// 音游式连消的节奏远快于服务端 2 秒冷却，直发的话十次有九次被 'cooldown' 拒掉，
// 玩家看到的是「消了但没掉血」。所以：**先攒，攒够了再发**。
let queued = 0
/**
 * 攒着的**活动计数**（一次连消 = 出手一次 + 消掉 N 格），跟伤害一起送。
 *
 * ⚠️ 它们跟伤害**同生共死**：送失败要跟伤害一起还回队列（否则这一笔活动进度就凭空少了）。
 * ⚠️ 这里**刻意不设上限** —— 上限（`WB_METRIC_CAP`）是服务端的判断，客户端猜一个只会猜错。
 * ⚠️ 只有远程模式才会真的送出去（见 `metricsForRemote`），本地模式下攒了也不发、由调用方
 *    自己 `bumpMetric`，但那两行计数**仍然要清掉**，免得下一笔把上一位玩家的账带上。
 */
let queuedClears = 0
let queuedTiles = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastSentAt = 0
/**
 * 是否有一笔伤害**正在飞**（已经 `reportDamage` 出去了、还没等到回执）。
 *
 * ⚠️ 存在理由：`flushQueued` 是**先清队列再 await** 的，所以"在途"这段时间里
 *    `queuedDamage()` 是 0 —— 光看队列会以为"没东西在等"，其实这一笔已经出网了。
 *    重新加载页面会把 `finally` 里那句"还回队列"一起带走 ⇒ **这笔伤害凭空蒸发**。
 *    想知道"现在能不能安全地把页面掀掉"必须看这个标志，不能看队列长度。
 */
let flushing = false

/** 还攒着多少伤害没发出去。界面拿它显示"正在结算" */
export function queuedDamage(): number { return Math.floor(queued) }

export function useWorldBossQueued(): number {
  return useSyncExternalStore(subscribeWorldBoss, queuedDamage, queuedDamage)
}

/**
 * 把一笔伤害攒进队列并安排发送。
 *
 * `tiles` = 这一笔消掉了几格。**调用方照旧还要自己 bump 一次「match3.tiles」** ——
 * 那一下在远程模式下是 no-op（服务端计），在本地模式下才是唯一的那份。
 */
export function queueMatchDamage(damage: number, tiles = 0): void {
  if (!(damage > 0)) return
  queued += damage
  queuedClears += 1
  queuedTiles += Math.max(0, Math.floor(tiles))
  emit()
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer !== null) return          // 已经有一次在等，不用再排
  const wait = Math.max(0, lastSentAt + WB_COOLDOWN_MS + 120 - Date.now())
  flushTimer = setTimeout(() => { flushTimer = null; void flushQueued() }, wait)
}

async function flushQueued(): Promise<void> {
  if (queued <= 0) return
  const wait = lastSentAt + WB_COOLDOWN_MS + 120 - Date.now()
  if (wait > 0) { scheduleFlush(); return }   // 还没到服务端能收的时刻，再等等
  const d = Math.floor(queued)
  const c = queuedClears
  const t = queuedTiles
  queued = 0
  queuedClears = 0
  queuedTiles = 0
  lastSentAt = Date.now()
  let giveBack = 0
  let giveBackClears = 0
  let giveBackTiles = 0
  flushing = true
  try {
    const r = await reportDamage(d, c, t)
    applyReport(r)
    // 血条已经打穿 / 本期结束：再消也进不去，把攒着的一并丢掉，别让它一直重试空转。
    // 丢掉是**安全**的：这些伤害本来就会被服务端按"剩余血量"截断成 0，留着只会空转。
    if (r.defeated || r.reason === 'defeated' || r.reason === 'period ended') { queued = 0; emit(); return }
    // 服务端说"还没到点收"（冷却）：这也是**没送到**，跟网络失败一样得还回去重发。
    // 不还的话这笔就凭空蒸发了 —— 客户端和服务端的时钟差一点点，就会出现
    // "我以为过了 2 秒、服务端说没有"，玩家一下一下点出来的伤害不该这么丢。
    // ⚠️ 计数跟伤害一起还：服务端在**没接受**这条路径上没记过账，不还就等于这一笔活动进度少了。
    if (!r.ok && r.accepted <= 0) { giveBack = d; giveBackClears = c; giveBackTiles = t }
  } catch (e) {
    // 网络抖动：**把伤害还回队列**。玩家一下一下点出来的东西，
    // 不能因为一次失败就凭空蒸发 —— 宁可晚几秒到账，不能少。
    giveBack = d
    giveBackClears = c
    giveBackTiles = t
    setSnapshot(snapshot, e instanceof Error ? e.message : String(e))
  } finally {
    flushing = false
    if (giveBack > 0) queued += giveBack
    queuedClears += giveBackClears
    queuedTiles += giveBackTiles
    emit()
  }
  if (queued > 0) scheduleFlush()
}

/** 立刻把攒着的发出去（离开页面时调用，别把玩家刚消的几笔丢在队列里） */
export function flushQueuedDamage(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  void flushQueued()
}

/**
 * 有一笔伤害**正在飞**吗（出了网、还没回执）。见 `flushing` 的注释。
 *
 * 给"能不能安全地重新加载这个页面"用：`false` 才代表此刻掀掉页面不会丢东西。
 */
export function worldBossFlushInFlight(): boolean { return flushing }

/**
 * 启动全服状态轮询：进页面拉一次，之后每分钟一次。
 * （早先这里还挂着一个"自动讨伐"的循环，随点按模式一起拆了 —— 消消乐没法代打。）
 */
let started = false
export function startWorldBossSync(intervalMs = WB_POLL_MS) {
  if (started) return
  started = true
  void refreshWorldBoss()
  setInterval(() => {
    // 页签在后台时不必轮询：回来那次会补上（visibilitychange）
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refreshWorldBoss()
  }, intervalMs)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshWorldBoss() })
}

/** 距本期结算还剩多久（ms）。已结束返回 0 */
export function remainMs(s: WbState | null, now = Date.now()): number {
  if (!s || !s.endsAt) return 0
  return Math.max(0, s.endsAt - now)
}

/** 把一段毫秒数写成「12:34」「1:02:03」 */
export function fmtDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}