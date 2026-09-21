// 客户端模式开关（v2.0 阶段 3，SPEC §4.6）—— **一个没有副作用的模块**。
//
// 为什么要单独一个文件：`game/engine.ts` 的模块体里有 `new GameStore(...)`，
// **import 它就等于构造引擎、等于 `load()` 一次**（`main.tsx` 那个"App 必须动态 import"
// 的机关正是为它而设）。而"这台设备用哪种模式跑"这件事**必须在引擎构造之前就定下来** ——
// 引擎构造时就要决定开不开 100ms tick / 2s 落盘。所以把它放在这里：
// `main.tsx` 能先 import 它做决定，而不会顺手把引擎建起来。
//
// 模式判定（优先级从高到低）：
//   ① URL 参数 `?mode=client|local` —— **回滚开关**：线上出问题，加一个参数就退回老行为。
//      选中后写进 localStorage 的 `MODE_KEY`，刷新/跳转都跟着走（参数只在当次导航有效）。
//   ② localStorage 的 `MODE_KEY`（上一次选过的）。
//   ③ 构建期全量：`VITE_REMOTE_DEFAULT=1` ⇒ 无条件全员远程。
//   ④ **灰度**：有账号 ⇒ 远程；否则存档码哈希 < `VITE_ROLLOUT_PERCENT` ⇒ 远程。
//   ⑤ 其余一律本地 —— **安全默认**（拿不到身份、抛错、百分比为 0 都落这里）。
//
// ⚠️ **①② 与 ③④⑤ 是在两个不同的时刻算的**，因为 ④ 需要身份（存档码），而身份要等
//    `whoAmI()` 回来才知道。所以 `decideMode()` 只能定 ①②（外加一个"暂定本地"），
//    ③④⑤ 挪到 `applyRollout()` 里 —— 它在 `main.tsx` 的启动序列里、**引擎构造之前**执行。
//
// ⚠️ 两个模式**共用同一份存档**，切来切去不丢任何东西（服务端权威 + 本机副本）。
//    这与"换域名 = 换源 = 存档消失"是两件事：那里变的是 localStorage 的**源**，这里变的是跑法。
//    实证（`saveApi.ts` 的 pullAuthoritative 决策表）：只有**本机进度严格更高**时才用本地，
//    否则一律采用云端 ⇒ 远程期间本机档停更，切回本地必然采用云端那份，不会退回旧进度。
import { MODE_KEY } from './storageKeys'

export type ClientMode = 'client' | 'local'

/** 进程内的模式决定。`null` = 还没定（= 老行为，本地模式）。 */
let decided: ClientMode | null = null
/** 这台设备在服务端是哪个玩家（令牌解析出来的，或本机那份存档码）。 */
let pid = ''
/** ①② 命中过 ⇒ ③④⑤ 一律不推翻（玩家显式选过、或运营用回滚开关拨过）。 */
let explicit = false

/**
 * 定下本次会话的模式。**必须在 `import('./App.tsx')` 之前调**（那样才赶得上引擎构造）。
 *
 * ⚠️ 它只定得下**①②**；③④⑤ 要等身份（存档码），由 `applyRollout()` 接着定。
 *
 * @param search 当前 `location.search`（例如 `?mode=client`）
 */
export function decideMode(search = ''): ClientMode {
  let fromUrl: ClientMode | null = null
  try {
    const m = new URLSearchParams(search).get('mode')
    if (m === 'client' || m === 'local') fromUrl = m
  } catch { /* 没有 URL 环境（Node/测试）：当没给 */ }

  if (fromUrl) {
    // 写进 localStorage 而不是只记在内存：`SaveView` 换账号那条路会 reload 页面，
    // 而 reload 会丢掉 URL 上的参数 —— 不落盘的话换完账号模式就偷偷变了。
    try { localStorage.setItem(MODE_KEY, fromUrl) } catch { /* 隐私模式：内存里这次仍然算数 */ }
    explicit = true
    decided = fromUrl
    return decided
  }

  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'client' || saved === 'local') { explicit = true; decided = saved; return decided }
  } catch { /* 同上 */ }

  // ③④⑤ 需要存档码，而存档码要等 `whoAmI()` 回来才知道 —— 这里只给一个**暂定的安全值**，
  // 真正的判定留给 `applyRollout()`。中途若被兜底打断，停在"本地"正是我们要的形态。
  decided = 'local'
  return decided
}

/**
 * 灰度的放量比例（**构建期注入**）。
 *
 * **缺省 / 非法 / 越界一律 0 ⇒ 全员本地 ⇒ 与没有灰度时逐字节相同。**
 * 这条不变量是整套东西的立身之本：老锚点回归、预览产物、`npm run build` 的默认输出
 * 全都**不注入**这个变量，它们必须一个字节都不变。
 *
 * 放量时在构建命令里注入，例如 `VITE_ROLLOUT_PERCENT=5 npm run build -- …`。
 */
const ROLLOUT_PERCENT = ((): number => {
  const raw = Number(import.meta.env.VITE_ROLLOUT_PERCENT)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(100, Math.floor(raw)))
})()

/**
 * 把存档码散成 0-99 的桶号（FNV-1a）。
 *
 * ⚠️ **`Math.imul` 不是风格问题，绝不能换成 `*`。** 32 位整数乘法写成 `*` 会退化成浮点
 *    （`h * 16777619` 可达 2^56 > 2^53 ⇒ 低位被舍入丢掉）⇒ **桶号整体错位**。
 *
 *    ⚠️ 危害的**形态**要说准，否则将来有人会拿"看着挺稳定"来反驳：
 *    **不是**"每次算出来不一样"（IEEE754 是确定性的，同一个码永远同一个错值），
 *    而是**桶号全盘错位 ⇒ 放量比例对不上目标，且全程不报任何错**。
 *    实测（`temp/verify-rollout-bucket.cjs` E 段）：与正确版**不一致率 99.0%**，
 *    5% 档实际放进 7.36%（正确版 5.83%）—— 比例失控，但页面上一切正常。
 *
 * ⚠️ 桶号是**单调**的：判据是 `bucketOf(pid) < percent` ⇒ 调高百分比只会让更多人进来，
 *    不会把已经在里面的人踢出去（放量途中不折腾玩家）。
 */
function bucketOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 100
}

/**
 * 身份确定之后把模式**落定**。**必须在 `import('./game/engine')` 之前调** ——
 * 引擎构造时会读一次 `isRemoteMode()`（`engine.ts` 模块体里的 `new GameStore`），
 * 之后这个值就跟着引擎实例走了，再改也没有用。
 *
 * @param playerId   `main.tsx` 已经算好的身份：有账号就是账号的 pid，否则本机存档码。
 *                   localStorage 不可用时是**空串** ⇒ 落回本地（安全默认）。
 * @param hasAccount 本机此刻登录着**服务端确认过**的账号（`whoAmI()` 非 null）。
 *                   语义是"这位玩家知道自己的账号名和密码" ⇒ 出事能自己找回云端档。
 *
 * ⚠️ **`ROLLOUT_PERCENT <= 0` 时连"有账号优先"也不启用。** 否则"不注入 = 全员本地"这条
 *    会被打破：线上只要有人登录过账号，他下次刷新就自动进远程了 —— 那是**未经批准的放量**。
 *    这一条是本文件最容易写错的地方。
 */
export function applyRollout(playerId: string, hasAccount: boolean): ClientMode {
  // ①② 是玩家/运营的显式选择，灰度一律不推翻
  if (explicit) {
    if (decided === null) decided = 'local'   // 到不了这里（①② 一定赋过值），防御性的
    return decided
  }

  // ③ 构建期全量 ⇒ **无条件**全员远程。
  //
  // ⚠️ **这一条必须排在下面的百分比闸门之前。** 顺序反了的话，`VITE_REMOTE_DEFAULT=1`
  //    配上一个不注入百分比（或注入 0）的构建，会**静默落回本地** —— 将来真要做全量发布时
  //    的表现是"改了变量、重建、部署，然后什么都没发生"，而且它绿得很正常（页面照常能玩）。
  //    "无条件"三个字只有在闸门之外才成立。
  //
  // ⚠️ 它**不**破坏「不注入 = 全员本地」那条不变量：默认构建里这个变量同样不被注入
  //    （实测：`/tmp/doupo-prev` 里它是纯 `local`，被折叠成常量）。
  if (import.meta.env.VITE_REMOTE_DEFAULT === '1') { decided = 'client'; return decided }

  // ★ 没放量 ⇒ 全员本地（**包括有账号的**，见上面那条警告）
  if (ROLLOUT_PERCENT <= 0) { decided = 'local'; return decided }

  // ④ 有账号的优先：第一批试验田，出事能靠「账号名 + 密码」把云端权威档找回来
  if (hasAccount) { decided = 'client'; return decided }

  // ④ 其余按存档码哈希。空 pid（localStorage 不可用）⇒ 本地
  decided = playerId && bucketOf(playerId) < ROLLOUT_PERCENT ? 'client' : 'local'
  return decided
}

/** 这次会话是不是远程模式（引擎构造时读一次，之后不再变）。 */
export function isRemoteMode(): boolean { return decided === 'client' }

/**
 * 记下"这台设备是哪个玩家"。远程模式的两条请求（`/state`、`/action`）都要带它 ——
 * 带了令牌的走令牌，没令牌的（老玩家、没注册账号的）就靠这个存档码。
 *
 * ⚠️ **不做成引擎去 import `leaderboardApi`**：那会把 `localStorage` 的读写引进
 *    服务端那份引擎产物（`vite.engine.config.ts`），而 Node 里没有 localStorage。
 *    由 `main.tsx`（它本来就要算这个身份）传进来，方向是干净的"外面喂给引擎"。
 */
export function setRemotePid(id: string) { pid = id }
/** 当前玩家。**只读内存** —— 没定过就是空串，请求会退化成 `need_login`/`bad_id`，不会猜。 */
export function getRemotePid(): string { return pid }