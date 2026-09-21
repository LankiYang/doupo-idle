// 「线上换产物了」的自检哨兵（v2.0 阶段 3 之后 · 反作弊链条 ③ 放量的前置）。
//
// 为什么需要它：这是**挂机游戏**，页面一开就是几小时几天；而线上换产物只改
// `index.html` 里那一行 `<script src="/doupo/assets/index-XXXX.js">` —— 已经跑起来的
// 页面**永远不会**知道。实测（2026-09-19 正式服）：`/save` 224 次、`/state` 0 次，
// 存量页面上一个都追不到。追不到 ⇒ 新客户端铺不开 ⇒ 灰度放量没有样本 ⇒
// `/save` 收窄永远等不到"流量排空"。这个模块就是补这一环。
//
// 判据只有一条，且**没有基线假设**：
//
//     正在跑的入口（DOM 反查） ≠ 服务端此刻发的入口（no-store 拉一份 index.html）
//
// ⚠️ **不要**改成"记住第一次看到的入口、之后拿它比"。那版有个致命洞：页面若在
//    部署**之后**才做第一次检查，记住的就已经是**新**入口 ⇒ 永远不刷 —— 恰恰救不到
//    要救的那批人（他们正是"部署时还挂着"的老页面）。
//
// ⚠️ 本模块**只用一个 GET**，服务端一行不改，也不读任何服务端字段：
//    两个 systemd unit 共用 `WorkingDirectory=/opt/doupo-game/api`，服务端从 `../dist`
//    推断出来的产物永远是**正式服**那份，体验服会被喂错标识。"谁在服务我"只有浏览器知道。
//
// ⚠️ **绝不抛错、绝不 `console.error`**：回归清单里 `verify-pull-anim` /
//    `verify-savepage-manual-gone` / `verify-account-client` / `verify-match3-e2e`
//    等锚点都在收集 `pageerror` 与 console 错误，这里抖一下就是**四处假红**。
//    所以每条路径都吞异常，且拿不准时**什么都不做**（不刷、不报）。

import { SENTINEL_GUARD_KEY } from './storageKeys'

/** 检查间隔。120 秒 —— 一次 GET 约 1KB，代价可以忽略 */
const DEFAULT_CHECK_MS = 120000
/** 两次检查的最小间隔（`visibilitychange` 可能连着来，别打爆网络） */
const MIN_GAP_MS = 30000
/** 单次请求的上限：服务端"接受连接但不响应"时不能让 fetch 永久挂着 */
const FETCH_TIMEOUT_MS = 5000
/** 可见时要"已经知道不一致"满这么久才动手。2 个周期 = 天然缓一拍（prod 约 4 分钟） */
const SETTLE_FACTOR = 2

/**
 * 检查间隔。**只有测试构建会注入 `VITE_SENTINEL_MS`**（正式服与体验服都不注入）——
 * 否则验证脚本要等 2 分钟一轮，没法跑。不注入时就是上面的默认值。
 */
function checkMs(): number {
  const v = Number(import.meta.env.VITE_SENTINEL_MS)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CHECK_MS
}

/** 从一段 HTML 或一个 URL 里抽出产物入口名（`index-XXXXXXXX.js`）；抽不到返回 null */
function entryOf(text: string): string | null {
  const m = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(text)
  return m ? m[1] : null
}

/** **正在跑的**那一个入口：从 DOM 里那一行 `<script type="module" src="...">` 反查 */
function runningEntry(): string | null {
  try {
    const el = document.querySelector('script[type="module"][src*="/assets/index-"]')
    const src = el?.getAttribute('src') || ''
    return entryOf(src)
  } catch { return null }
}

/** 已经为哪个入口自动刷过一次了（见 `SENTINEL_GUARD_KEY` 的注释：防成环） */
function guardGet(): string {
  try { return sessionStorage.getItem(SENTINEL_GUARD_KEY) || '' } catch { return '' }
}
function guardSet(v: string): void {
  try { sessionStorage.setItem(SENTINEL_GUARD_KEY, v) } catch { /* 存不了就算了，最多多刷一次 */ }
}

/**
 * 此刻掀掉页面会不会丢东西。
 *
 * ⚠️ **绝不能用 `!state.battle` 当判据**：`engine.ts` 里是
 * `if (battle) … else if (autoBattle) startBattle()` —— 仗打完**同一个 tick** 就开下一场，
 * "不在战斗中"的窗口 ≈0。而挂机玩家（**正是要追的那批人**）恒开着自动战斗 ⇒
 * 那个判据等于让哨兵永不工作。
 *
 * 用两个**真的会有在途工作**的界面状态代替：
 *   ① 消消乐正在结算（`[data-m3-busy="1"]`，`MatchBoard.tsx` 自带的属性，不用改 UI）。
 *      盘面**空闲**不阻塞 —— 盘面是纯本地谜题，清掉不丢任何资源；而"挂机玩家永远刷不到"
 *      才是真问题。真在连消/掉落动画里则要等它结算完。
 *   ② 世界 Boss 有伤害在途。⚠️ `flushQueued` 是**先清队列再 await** 的，所以
 *      "出了网、还没回执"那一下 `queuedDamage()` 是 0，光看队列长度会漏掉它 ——
 *      必须看 `worldBossFlushInFlight()`。（漏掉的后果是这笔伤害**凭空蒸发**。）
 *
 * ⚠️ **两只 Boss 各查各的，一条都不能省**（第二只 = 连连看讨伐）：
 *    · 盘面锚点族**刻意不共用**（连连看是 `data-ll-busy`，见 `LinkLinkBoard.tsx`），
 *      所以上面那两句 querySelector 是两条；
 *    · 伤害队列也是**各自一份**（共用一个队列会把这边的伤害 POST 到另一只身上），
 *      所以下面两个模块都要问。
 *    少任何一条的表现都一样：玩家在那只 Boss 里刚打出来的东西，被一次自动刷新吃掉。
 */
async function hasWorkInFlight(): Promise<boolean> {
  try {
    if (document.querySelector('[data-m3-busy="1"]')) return true
    if (document.querySelector('[data-ll-busy="1"]')) return true
  } catch { /* 探测失败当作不忙，继续往下判 */ }
  // ⚠️ 必须**动态** import：哨兵活在入口 chunk 里，静态引 `worldboss` 会经它把
  //    `engine` 也拖进入口的静态依赖 —— 那就违反了"引擎必须在模式与身份定下来之后
  //    才构造"（见 `main.tsx` 的启动序列）。
  //    实测代价（2026-09-19，正式服口径的产物对比）：`worldboss` 会被从 App chunk 里
  //    **切出来**成为独立 chunk（约 10KB），App 相应地小 9.5KB —— 总字节几乎不变，
  //    只是首屏多一个**并行**请求（App chunk 静态依赖它，浏览器一起取）。
  //    `worldboss2` 静态依赖 `worldboss`，所以它俩落在同一片依赖里，不额外多一次往返。
  // ⚠️ 两个模块**分开 try**：一只问不出来不该让另一只的答案作废（都问不出来时仍按忙处理）
  try {
    const m = await import('./worldboss')
    if (m.worldBossFlushInFlight() || m.queuedDamage() > 0) return true
  } catch {
    return true   // 问不出来 ⇒ 当作忙（安全侧：宁可晚刷，不可丢伤害）
  }
  try {
    const m2 = await import('./worldboss2')
    if (m2.worldBoss2FlushInFlight() || m2.queuedLinkDamage() > 0) return true
  } catch {
    return true
  }
  return false
}

/** 拉一份**当前**的 index.html，抽出它引用的入口 */
async function servedEntry(baseUrl: string): Promise<string | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => { try { ac.abort() } catch { /* 忽略 */ } }, FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(baseUrl + 'index.html', { cache: 'no-store', signal: ac.signal })
    if (!r.ok) return null
    return entryOf(await r.text())
  } catch {
    return null   // 断网 / 超时 / 后端挂了：**静默不动**，下个周期再说
  } finally {
    clearTimeout(timer)
  }
}

let started = false

/**
 * 启动哨兵。**挂在 `main.tsx` 的模块作用域**（与 `void boot()` 同级），不是 boot 里面 ——
 * ⚠️ `boot()` 在远程模式那条分支是**提前 return** 的（`main.tsx` 里 `startRemoteLoop()` 之后），
 *    挂在它末尾会漏掉远程模式，而远程模式正是阶段 3 的主体。
 * 幂等：重复调用只有第一次生效。
 */
export function startBuildSentinel(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const baseUrl = import.meta.env.BASE_URL || '/'
  const interval = checkMs()
  const minGap = Math.min(MIN_GAP_MS, Math.floor(interval / 2))
  const settleMs = interval * SETTLE_FACTOR

  let inFlight = false
  let lastCheckAt = 0
  /** 第一次观察到"不一致"的时刻；一致时清空 */
  let mismatchSince = 0
  /** 最近一次看到的服务端入口 —— 供"刚切到后台、来不及重新拉"那条捷径用 */
  let lastServed: string | null = null

  function doReload(target: string): void {
    // ⚠️ 守卫必须**先写**：`location.reload()` 会把模块内存整个清掉，
    //    写在 reload 之后的任何标记都是死代码。
    guardSet(target)
    try { location.reload() } catch { /* 忽略 */ }
  }

  /** 只用内存里已知的信息决定要不要立刻刷（后台时用，省一次往返） */
  async function reloadNowIfKnownStale(): Promise<boolean> {
    if (!lastServed || mismatchSince === 0) return false
    if (guardGet() === lastServed) return false   // 已经为它刷过一次 ⇒ 不再刷（防成环）
    // ⚠️ 这里**也要**查在途工作：切到后台那一瞬间 `WorldBossView` 的
    //    `visibilitychange` 刚把队列里的伤害发出去（`flushQueuedDamage`），
    //    而"出了网还没回执"这件事只有 `worldBossFlushInFlight()` 看得见 ——
    //    少这一句就是每次切后台都吞掉玩家刚消出来的那几笔。
    if (await hasWorkInFlight()) return false
    doReload(lastServed)
    return true
  }

  async function tick(): Promise<void> {
    if (inFlight) return
    const now = Date.now()
    if (now - lastCheckAt < minGap) return
    inFlight = true
    lastCheckAt = now
    try {
      const running = runningEntry()
      if (!running) return                    // 抽不到（dev 环境 / 结构变了）⇒ 静默不动
      const served = await servedEntry(baseUrl)
      if (!served) return                     // 拉不到 ⇒ 保持原判，等下一轮
      lastServed = served

      if (running === served) { mismatchSince = 0; return }   // 已经是最新的

      if (mismatchSince === 0) mismatchSince = now
      if (guardGet() === served) return       // 这个入口已经刷过一次了，别再刷

      // 后台标签页：不打断画面，也不影响任何人 —— 但**有在途工作时仍要等**
      // （正在飞的伤害/正在结算的消消乐，掀掉就没了）。
      if (document.visibilityState === 'hidden') {
        if (await hasWorkInFlight()) return
        doReload(served)
        return
      }

      // 可见：缓一拍再动手，免得玩家正看着画面突然白一下。
      if (now - mismatchSince < settleMs) return
      if (await hasWorkInFlight()) return
      doReload(served)
    } catch {
      /* 哨兵自身绝不能把异常漏出去 —— 那会打红一堆收集 pageerror 的锚点 */
    } finally {
      inFlight = false
    }
  }

  // 切到后台那一刻：如果**已经知道**自己旧了，直接刷，不必再等一个周期
  // （后台窗口很珍贵 —— 玩家可能下一秒就切回来）。
  async function onVisibility(): Promise<void> {
    try {
      if (document.visibilityState === 'hidden') {
        if (await reloadNowIfKnownStale()) return
      }
      await tick()
    } catch { /* 同上：绝不漏异常 */ }
  }

  try {
    document.addEventListener('visibilitychange', () => { void onVisibility() })
    void tick()                                // 打开就先对一次（首屏不受影响：它是异步的）
    setInterval(() => { void tick() }, interval)
  } catch {
    /* 连监听都挂不上就算了，最坏是这一台不自动刷 */
  }
}