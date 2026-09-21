import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { whoAmI } from './game/authApi'
import { startBuildSentinel } from './game/buildSentinel'
import { pullAuthoritative } from './game/saveApi'
import { getPlayerId, setPlayerId } from './game/leaderboardApi'
import { applyRollout, decideMode, getRemotePid, isRemoteMode, setRemotePid } from './game/remoteMode'

/**
 * 启动序列（SPEC §4.4.5 本地模式 / §4.6 远程模式）。
 *
 * ⚠️ **顺序是有意义的，一步都不能调换**：
 *   ① **模式** —— 决定"这台设备用哪种跑法"。必须最先，因为引擎构造时就要决定
 *      开不开 100ms tick / 2s 落盘（见 `remoteMode.ts` 头注释）；
 *   ② **身份** —— 令牌换身份，让"这台设备是哪个账号"**在引擎构造之前**定下来；
 *   ③ **状态** —— 远程模式下先拉一份全量（页面第一次画出来就是服务端那份）；
 *              本地模式下走"云端优先"对齐（老行为）；
 *   ④ **这时才** `import('./App')`，引擎随之构造、`load()`。
 *
 * 为什么 App 必须动态 import：`game` 是**模块级单例**，import 即构造、即 `load()` 一次。
 * 若按老写法在最顶上静态 import，引擎会先按**本机那份**存档把内存态建好 ——
 * 之后再往 localStorage 里写什么都来不及了（单例里的状态已经定了）。
 *
 * ⚠️ 每一步都必须容错：**断网/后端挂了不能让人打不开游戏**。
 *    远程模式下"后端挂了"的形态是**用本机副本渲染 + 顶部「重连中」+ 只读**，
 *    **绝不**退回本地算账（那正是这一整轮要拆掉的绕过口）。
 */
const BOOT_BUDGET_MS = 8000
/** 远程模式下等第一份全量的上限。等不到也照渲（用本机副本），轮询会接着追。 */
const FIRST_STATE_MS = 4000

/** 只渲染一次（正常路径与兜底路径都可能走到这里）。 */
let rendered = false
async function render() {
  if (rendered) return
  rendered = true
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

async function boot() {
  // ① 模式。**必须在任何 import('./game/engine') 之前** —— 那里会构造单例。
  //    ⚠️ 这一步只定得下**显式选择**（`?mode=` 或本地上次选过的）；灰度的放量判定
  //       要等身份（存档码），在 ③′ 那里落定。
  let mode = decideMode(typeof location !== 'undefined' ? location.search : '')

  // ② 本设备还登着吗。⚠️ 只有**服务端确认过**才动本地身份 ——
  //    本地存着令牌不等于它还有效（会话 180 天过期、服务端换过 machines）。
  let me: string | null = null
  try { me = await whoAmI() } catch { me = null }
  if (aborted) return          // 兜底已接管 ⇒ **立刻停手，绝不在引擎构造之后改身份**
  if (me) setPlayerId(me)

  // ③ 这台设备在服务端是哪个玩家：有账号就是令牌解析出的那个，
  //    没有账号的老玩家（或全新访客）就用本机那份存档码 —— 服务端两种都认。
  try { setRemotePid(me || getPlayerId()) } catch { /* localStorage 不可用：两个模式都还能跑 */ }

  if (aborted) return

  // ③′ **灰度的放量判定在这里落定** —— 引擎要到下面 `import('./game/engine')` 才构造，赶得上。
  //     ⚠️ 必须**重新赋值给 `mode`**：下面用的是这个局部变量，不是 `isRemoteMode()`。
  //     `getRemotePid()` 在 localStorage 不可用时是空串 ⇒ 落回本地（安全默认）。
  mode = applyRollout(getRemotePid(), !!me)

  if (aborted) return

  if (mode === 'client') {
    // 远程模式：先拿一份全量再渲染。**引擎在这里才第一次被 import**（= 构造）。
    const { game } = await import('./game/engine')
    try {
      await Promise.race([game.pollState(), new Promise(r => setTimeout(r, FIRST_STATE_MS))])
    } catch { /* 拉不到就用本机副本画，页面显示「重连中」且只读 */ }
    if (aborted) return
    await render()
    // ⚠️ 轮询放在 render **之后**：它是心跳（服务端按"90 秒内有过 /state"判在线），
    //    但抢在首屏之前起没有意义，反而让首屏多等一个来回。
    game.startRemoteLoop()
    return
  }

  // 本地模式（老行为，一字未改）
  try {
    // 云端优先。内部按"换账号 → 比进度 → 采用/上报"的顺序判，见 saveApi.ts
    await pullAuthoritative()
  } catch { /* 同上：失败就用本机档 */ }

  if (aborted) return
  await render()
}

/**
 * 总兜底：**无论卡在哪一步，都要出画面**（实测过的最坏形态 —— 服务端"接受连接但不响应"时，
 * 没有超时的那一版会让页面 20 秒仍是完全空白）。
 *
 * ⚠️ 兜底**不是**"另起一条路去渲染"就完事：那样 `boot()` 还在继续跑，会在**引擎已经构造之后**
 *    再执行 `setPlayerId()` / `setRemotePid()` —— 而身份正是靠"先于引擎定下来"，
 *    顺序一乱就是串档（比丢档更糟）。所以兜底只置一个标志，让 boot 在**下一个检查点自己停下**。
 *
 * ⚠️ 远程模式下这一条**还要负责把轮询接上**（见下）。真触发时页面会以本机副本渲染，
 *    宁可让玩家看到"上次的样子"，也不给他一个白屏。
 */
let aborted = false
setTimeout(() => {
  if (rendered) return
  aborted = true
  void (async () => {
    await render()
    // ⚠️ **兜底不能只渲染就完事。** `render()` 会经 `App.tsx` 把引擎构造出来
    //    （`App.tsx:17` 静态 import 了它），而此刻 `boot()` 很可能正卡在上面那句
    //    `pollState` 的 4 秒等待里 —— 它下面那句 `startRemoteLoop()` **永远不会执行**。
    //    于是引擎是**远程的**、却**没有轮询链**：页面拿本机副本渲染、`remoteDown` 还是
    //    false ⇒ **不显示「重连中」**，而远程模式下本地一行账都不算 ⇒ 画面是死的，
    //    玩家既不知道断线了、也不知道要刷新。这条链必须在兜底里补上。
    //
    //    ✅ 幂等安全：`startRemoteLoop()` 自带保护（`engine.ts:1365` 起，`remoteTimer`
    //    非空即返回；且开头 `if (!this.remote) return`）⇒ 正常路径与这里都调不会起两条链。
    //    ✅ 顺序安全：`isRemoteMode()` 读的 `decided` 与引擎构造时读的是同一个值，
    //    而这句在 `await render()`（= 构造点）**之后** ⇒ 两者不会分叉。
    //    若 boot 还没走到 `applyRollout`，`decided` 仍是 `'local'` ⇒ 这里不补，正是要的安全默认。
    if (isRemoteMode()) {
      const { game } = await import('./game/engine')
      game.startRemoteLoop()
    }
  })()
}, BOOT_BUDGET_MS)

void boot()

/**
 * 「线上换产物了」的自检哨兵（`game/buildSentinel.ts`）。
 *
 * ⚠️ **必须在模块作用域起，不能放进 `boot()` 里**：`boot()` 在远程模式那条分支是
 *    `startRemoteLoop(); return` **提前返回**的，挂在它末尾就漏掉了远程模式 ——
 *    而远程模式正是阶段 3 的主体，也正是灰度放量要覆盖的那批人。
 *
 * 它与启动序列**完全无关**：不碰模式、不碰身份、不改任何状态，只定期比一下
 * "我在跑的入口"与"服务端现在发的入口"，不一致且**没有在途工作时**才 reload。
 * 全程吞异常、绝不抛（有 4 个锚点在收集 `pageerror`，抖一下就是四处假红）。
 */
startBuildSentinel()