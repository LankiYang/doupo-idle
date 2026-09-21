// 第二只世界 Boss（万魂锁尊 · 连连看讨伐）：拉全服状态 + 上报自己这次讨伐的伤害。
//
// ─────────────────────────────────────────────────────────────────────────
// 这个文件是 `worldboss.ts` 的**副本**，与它并排存在，只改了四处：
//
//   ① 接口地址：`/api/worldboss2`。
//   ② 模块级 store 与**攒发队列各自一份**。这一条是**必须**的，不是洁癖：
//      两边共用一个队列的话，连连看消出来的伤害会被 POST 到 `/worldboss` 上去 ——
//      打的是这只 Boss、掉的是那只的血条，而且**不会报任何错**。
//   ③ 攻击手段是连连看 ⇒ **没有"格"这个概念**。活动中心那两个计数指标里
//      `boss.hit`（讨伐出手）照记，`match3.tiles` 恒送 0 —— 连连看一次消的是一对，
//      把它折成"格数"再报上去，等于给第一只的指标灌水。
//   ④ **不做付费重启**（本轮出界，见计划）。服务端给了 `restart` 就照旧解析出来，
//      页面只是不渲染那一块。
//
// 复用的（**不复制**，因为它们与"哪只 Boss"无关）：
//   类型 `WbState` / `WbReport`、解析函数 `parseWorldBoss` / `parseReport`、
//   文案 `rewardLabelsOf`、时间 `remainMs` / `fmtDuration`、常量 `WB_POLL_MS` / `WB_COOLDOWN_MS`。
//   ⚠️ 复用的前提是**服务端那两份返回形状一致**（`wb2PublicState` 是 `wbPublicState` 的副本）。
//      将来谁给其中一只加了字段，另一个的解析也要一起看 —— 解析函数在这里是**共用**的。
//
// 为什么不抽成一个"世界 Boss 工厂"：与"服务端复制一套 wb2*"同一个理由 —— 两只 Boss
// 各打各的，改一只不该可能波及另一只。这个文件的体量（不到 worldboss.ts 的三分之一）
// 已经是复用类型与解析函数之后的结果了。
// ─────────────────────────────────────────────────────────────────────────
//
// 三条设计约束与第一只完全相同（原文见 `worldboss.ts` 的文件头，不再抄一遍）：
// 奖励由服务端自动发、伤害只看消掉多少**不看战力**、**状态不进存档**。
//
// ⑤ **一期之内血条同样会被打穿三次**：每打穿一次服务端按当轮贡献度发一次奖、血条立起来、
//    参战伤害清零。所以 `dealt` 会**突然归零** —— 那不是丢数据，是新一轮开始了，见 kills。
import { useSyncExternalStore } from 'react'
import { getPlayerId } from './leaderboardApi'
import { apiFetch } from './authApi'
import { isRemoteMode } from './remoteMode'
import { BOSS2_FORM_MAX } from './monsters'
import {
  WB_POLL_MS, WB_COOLDOWN_MS, parseWorldBoss, parseReport,
  type WbState, type WbReport,
} from './worldboss'

export type { WbState, WbReport } from './worldboss'

/** 轮询间隔。与第一只同样一分钟一跳 */
export const WB2_POLL_MS = WB_POLL_MS
/**
 * 服务端两次伤害上报之间的最小间隔（server.js 的 `WB2_COOLDOWN`，与第一只同值）。
 * 连连看一对最快只要 ~420ms（见 LinkLinkBoard 的逐帧节奏），**远快于它** ⇒
 * 伤害必须先攒后发，见 queueLinkDamage。
 */
export const WB2_COOLDOWN_MS = WB_COOLDOWN_MS

const API = `${import.meta.env.BASE_URL}api/worldboss2`

/** 拉全服状态。网络失败/404 直接抛，由调用方吞掉 —— 讨伐页拉不到不该影响游戏本身 */
export async function fetchWorldBoss2(): Promise<WbState> {
  const res = await apiFetch(`${API}?playerId=${encodeURIComponent(getPlayerId())}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // ⚠️ 第二只的形态档数按**自己的**立绘张数夹（两只 Boss 的立绘张数可以不同）
  return parseWorldBoss(await res.json(), BOSS2_FORM_MAX)
}

/**
 * 上报一次讨伐。注意 ok:false 也**不是网络错误**（冷却/已击败/本期已结束），照常返回回执。
 *
 * `clears` 是"出手了几次"（= 这把攒了几对），随 `boss.hit` 那条活动指标走。
 * 没有 `tiles` 参数 —— 连连看没有"格"，见文件头 ③。
 */
export async function reportLinkDamage(damage: number, clears = 0): Promise<WbReport> {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: getPlayerId(),
      damage: Math.max(0, Math.floor(damage)),
      // 活动中心的计数指标。**只有远程模式才带**（见 metricsForRemote）：
      // 老客户端不带 ⇒ 服务端一分不动，它们仍靠自己本地 bump + 上传。
      ...metricsForRemote(clears),
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseReport(await res.json())
}

/**
 * 计数指标要不要随这笔上报送上去。
 *
 * ⚠️ 判据是**模式**，不是"值大不大"：本地模式下客户端自己 `bumpMetric`（老行为），
 *    再送一份上去就成了**双份**。远程模式下客户端不记（`bumpMetric` 是 no-op），
 *    这一份是**唯一**的来源。
 * ⚠️ `tiles: 0` 也要送：省掉这个键会让服务端把这一笔当成"老客户端"（见 server.js 那段）。
 *    **恒为 0 是刻意的** —— 连连看没有格，见文件头 ③。
 */
function metricsForRemote(clears: number): Record<string, number> {
  if (!isRemoteMode()) return {}
  // `tiles` 恒 0 是**刻意的**，见文件头 ③：连连看一次消的是一对，折成"格数"报上去
  // 等于给第一只的 `match3.tiles` 指标灌水。
  return { clears: Math.max(0, Math.floor(clears)), tiles: 0 }
}

// ─────────────────────── 模块级小 store ───────────────────────
// 状态**不进存档**（红线），所以放在模块里，由 useSyncExternalStore 订阅。
// 与第一只**各一份**：共用一个 snapshot 会让两只 Boss 的血条互相覆盖。
let snapshot: WbState | null = null
let lastError = ''
/**
 * 「全服合力打掉多少」的读数基准。理由与第一只完全相同（我自己的上报也算进 dealt 的变化里，
 * 不扣掉的话每消一笔就会多推一条"全服合力打掉"）—— 见 `worldboss.ts` 的 `pollBaseDealt`。
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

export function subscribeWorldBoss2(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export const worldBoss2Snapshot = () => snapshot

/** 订阅读取。两个值分开取（而不是打包成对象）：每次 emit 都返回新对象会让 React 无限重渲 */
export function useWorldBoss2(): WbState | null {
  return useSyncExternalStore(subscribeWorldBoss2, worldBoss2Snapshot, worldBoss2Snapshot)
}
export function useWorldBoss2Error(): string {
  return useSyncExternalStore(subscribeWorldBoss2, () => lastError, () => lastError)
}
/** 轮询序号：每次**轮询**带回"别人打掉了"就 +1。界面靠它触发一次日志，而不是靠值变化 */
export function useWorldBoss2PollSeq(): number {
  return useSyncExternalStore(subscribeWorldBoss2, () => pollSeq, () => pollSeq)
}
/** 上次轮询里**别人**打掉的量（已经扣掉我自己） */
export function useWorldBoss2PollDelta(): number {
  return useSyncExternalStore(subscribeWorldBoss2, () => pollDelta, () => pollDelta)
}

/** 重新拉一次全服状态 */
export async function refreshWorldBoss2(): Promise<void> {
  try {
    const next = await fetchWorldBoss2()
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
 * 把上报回执合并进当前状态。逻辑与第一只**逐行对应**（那边有详细的踩坑注释，
 * 尤其是 `justKilled` 那一段：一天三次的模型下服务端打穿即重生，回执报的是**新一轮**的账，
 * 所以"第一次参战、又正好收掉最后一刀"的人不能被 `!s.me && myDamage <= 0` 这句吞掉）。
 */
function applyReport(r: WbReport): void {
  const s = snapshot
  if (!s) return
  const myDamage = r.damage ?? s.me?.damage ?? 0
  if (!s.me && myDamage <= 0 && !r.justKilled) {
    setSnapshot({ ...s, defeated: s.defeated || r.defeated, kills: r.kills ?? s.kills })
    return
  }
  const me = s.me
    ? { ...s.me, damage: myDamage }
    : { damage: myDamage, attempts: 1, pct: 0, percentile: 0, rank: 0 }
  if (r.totalHp === null || r.dealt === null) {
    setSnapshot({ ...s, me, defeated: s.defeated || r.defeated, kills: r.kills ?? s.kills })
    return
  }
  pollBaseDealt = r.dealt   // 我打的这部分不算进「全服合力」
  const remain = Math.max(0, r.totalHp - r.dealt)
  const killedNow = r.justKilled === true
  setSnapshot({
    ...s,
    totalHp: r.totalHp,
    dealt: r.dealt,
    remain,
    remainPct: r.totalHp > 0 ? Math.round((remain / r.totalHp) * 1000) / 10 : s.remainPct,
    progressPct: r.progressPct ?? s.progressPct,
    participants: r.participants ?? s.participants,
    // 平时「打穿了就只升不降」；打穿的那一笔以回执为准（它回的是重生后的状态）——
    // 再"只升不降"就会把上一轮的 true 粘住，盘面永远锁着解不开
    defeated: killedNow ? r.defeated : (s.defeated || r.defeated || remain <= 0),
    kills: r.kills ?? s.kills,
    me,
  })
}

// ── 攒伤害的队列（连连看专用）────────────────────────────────────
// 一对最快 ~420ms 就消完了，而服务端 2 秒才收一笔 ⇒ 直发的话十次有九次被 'cooldown' 拒掉，
// 玩家看到的是「消了但没掉血」。所以：**先攒，攒够了再发**。
let queued = 0
/** 攒着的**出手次数**（`boss.hit` 那条活动指标），跟伤害同生共死 */
let queuedClears = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastSentAt = 0
/**
 * 是否有一笔伤害**正在飞**（已经 `reportLinkDamage` 出去了、还没等到回执）。
 *
 * ⚠️ 存在理由与第一只完全相同，而且**第二只更容易踩**：`flushQueued` 是先清队列再 await 的，
 *    "在途"这段时间里 `queuedLinkDamage()` 是 0，光看队列会以为"没东西在等"。
 *    **buildSentinel 必须同时查这一只** —— 少了它，玩家在连连看里消出来的那几笔会在
 *    产物切换导致的自动刷新里凭空蒸发（见 buildSentinel.ts 的 hasWorkInFlight）。
 */
let flushing = false

/** 还攒着多少伤害没发出去。界面拿它显示"正在结算" */
export function queuedLinkDamage(): number { return Math.floor(queued) }

export function useWorldBoss2Queued(): number {
  return useSyncExternalStore(subscribeWorldBoss2, queuedLinkDamage, queuedLinkDamage)
}

/**
 * 把一笔伤害攒进队列并安排发送。
 *
 * `pairs` 是这一笔消了几对。它**只进"出手次数"**这个计数，不参与伤害换算 ——
 * 伤害在 `LinkLinkBoard` 里就按连击算好了（换算是引擎的事，见 linklink.ts 的 damageOf）。
 * **调用方照旧还要自己 bump 一次「boss.hit」** —— 那一下在远程模式下是 no-op（服务端计），
 * 在本地模式下才是唯一的那份。
 */
export function queueLinkDamage(damage: number, pairs = 1): void {
  if (!(damage > 0)) return
  queued += damage
  queuedClears += Math.max(1, Math.floor(pairs))
  emit()
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer !== null) return          // 已经有一次在等，不用再排
  const wait = Math.max(0, lastSentAt + WB2_COOLDOWN_MS + 120 - Date.now())
  flushTimer = setTimeout(() => { flushTimer = null; void flushQueued() }, wait)
}

async function flushQueued(): Promise<void> {
  if (queued <= 0) return
  const wait = lastSentAt + WB2_COOLDOWN_MS + 120 - Date.now()
  if (wait > 0) { scheduleFlush(); return }   // 还没到服务端能收的时刻，再等等
  const d = Math.floor(queued)
  const c = queuedClears
  queued = 0
  queuedClears = 0
  lastSentAt = Date.now()
  let giveBack = 0
  let giveBackClears = 0
  flushing = true
  try {
    const r = await reportLinkDamage(d, c)
    applyReport(r)
    // 血条已经打穿 / 本期结束：再消也进不去，把攒着的一并丢掉，别让它一直重试空转。
    // 丢掉是**安全**的：这些伤害本来就会被服务端按"剩余血量"截断成 0。
    if (r.defeated || r.reason === 'defeated' || r.reason === 'period ended') { queued = 0; emit(); return }
    // 服务端说"还没到点收"（冷却）：这也是**没送到**，跟网络失败一样得还回去重发。
    // 时钟差一点点就会出现"我以为过了 2 秒、服务端说没有"，玩家一下一下点出来的伤害不该这么丢。
    if (!r.ok && r.accepted <= 0) { giveBack = d; giveBackClears = c }
  } catch (e) {
    // 网络抖动：**把伤害还回队列**。宁可晚几秒到账，不能少。
    giveBack = d
    giveBackClears = c
    setSnapshot(snapshot, e instanceof Error ? e.message : String(e))
  } finally {
    flushing = false
    if (giveBack > 0) queued += giveBack
    queuedClears += giveBackClears
    emit()
  }
  if (queued > 0) scheduleFlush()
}

/** 立刻把攒着的发出去（离开页面时调用，别把玩家刚消的几笔丢在队列里） */
export function flushQueuedLinkDamage(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  void flushQueued()
}

/** 有一笔伤害**正在飞**吗（出了网、还没回执）。见 `flushing` 的注释 */
export function worldBoss2FlushInFlight(): boolean { return flushing }

/** 启动全服状态轮询：进页面拉一次，之后每分钟一次 */
let started = false
export function startWorldBoss2Sync(intervalMs = WB2_POLL_MS) {
  if (started) return
  started = true
  void refreshWorldBoss2()
  setInterval(() => {
    // 页签在后台时不必轮询：回来那次会补上（visibilitychange）
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refreshWorldBoss2()
  }, intervalMs)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshWorldBoss2() })
}