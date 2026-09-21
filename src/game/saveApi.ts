// 云存档客户端：**启动时以云端为准** + 游戏中的变更上报 + 手动恢复 + 存档码找回
//
// 2026-09-18 的重要转向 —— 从前这一步是反的：
//   旧行为：`startCloudSync()` 一进页面就 `uploadSave()`，把**本机**存档推上云。
//           任何一台留着旧档的设备（多设备、旧标签页、另一台电脑）打开一次，
//           就把云端的巅峰档盖掉。一位玩家的 110 关档就是这么没的，链路零备份、不可找回。
//   新行为：**打开先拉云端**，云端进度不低于本地就采用云端；本地只在"确实更高"时才上报。
//           ⇒ 本地存档从"权威来源"降级成"断网缓存"，它再也盖不掉云端了。
//
// 安全要点（沿用并加强）：
//   · 采用云端前先把当前本地档备份到 .bak，走已加固的 load()/migrate() 校验；
//     云端数据万一损坏会自动回退到 .bak，杜绝死档。
//   · 拉取失败/超时一律回退本地 —— 断网、后端挂了、接口改版，都不能让人打不开游戏。
import { getPlayerId } from './leaderboardApi'
import { apiFetch } from './authApi'
import {
  SAVE_KEY, SAVE_BAK_KEY as BAK_KEY, SAVE_META_KEY as META_KEY,
  SAVE_OWNER_KEY, SAVE_SWITCHED_KEY,
} from './storageKeys'

const API = `${import.meta.env.BASE_URL}api`

export interface CloudMeta { lastUpload: number; lastHash: string }
export interface CloudSave { data: string; updatedAt: number }
export interface SaveSummary { stage: number; chars: number; coin: number }

function readMeta(): CloudMeta {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) || '{}'); return { lastUpload: m.lastUpload || 0, lastHash: m.lastHash || '' } } catch { return { lastUpload: 0, lastHash: '' } }
}
function writeMeta(m: CloudMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* ignore */ } }

/** 轻量指纹：判断存档是否变化，避免无谓上传 */
function fingerprint(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h + ':' + s.length
}

export function summarizeSave(raw: string): SaveSummary | null {
  try {
    const s = JSON.parse(raw)
    return {
      stage: s.highestStage ?? s.stage ?? 0,
      chars: s.roster && typeof s.roster === 'object' ? Object.keys(s.roster).length : 0,
      coin: Math.floor(s.inventory?.coin ?? 0),
    }
  } catch { return null }
}

function localSave(): string | null {
  try { return localStorage.getItem(SAVE_KEY) } catch { return null }
}

/** 本机这份存档属于哪个账号。读不到/形状不对一律返回 `''`（= 不知道，按"是我的"处理）。 */
function readOwner(): string {
  try { return localStorage.getItem(SAVE_OWNER_KEY) || '' } catch { return '' }
}
function writeOwner(pid: string) {
  try { localStorage.setItem(SAVE_OWNER_KEY, pid) } catch { /* ignore */ }
}

/**
 * 声明"从现在起，本机这份存档属于 `pid`"。
 *
 * 供**在页面里换了身份**的地方调用（目前只有「用存档码找回」的 `confirmRestore`）。
 * 不调它的后果不是丢档、而是绕远：启动序列会把这次变更误判成「换账号」，
 * 于是把刚写进去的档挪进 `.switched` 再重新从云端拉一遍同一份 ——
 * 结果没错，但多一次往返，且 `.switched` 会被一个根本不是"换账号"的场景污染。
 */
export function setSaveOwner(pid: string) { writeOwner(pid) }

/**
 * 把本机这两份存档挪进 `.switched` 单槽并清空 —— 用于「换账号」。
 *
 * ⚠️ **两份都要清**。引擎 `load()` 的兜底顺序是 `SAVE_KEY → SAVE_KEY+'.bak'`，
 *    只清主档的话它会读回 `.bak`，而那也是**上一个账号**的档 —— 换账号等于没换，
 *    下一个账号会顶着前一个账号的进度开始（串档，比丢档更糟）。
 *
 * ⚠️ 挪而不是删：同一台设备上换回来的情况是真实存在的（两个人共用一台电脑），
 *    留一个单槽，至少最近一次换走的档还能人工捞回来。
 */
function stashLocalSave() {
  try {
    const cur = localStorage.getItem(SAVE_KEY)
    if (cur) localStorage.setItem(SAVE_SWITCHED_KEY, cur)
    localStorage.removeItem(SAVE_KEY)
    localStorage.removeItem(BAK_KEY)
  } catch { /* 隐私模式等：写不进去就算了，下面的 applyCloudSave 仍会尝试 */ }
}

/** 拉云端（带超时）。后端慢不能把人卡在启动界面上（放置游戏玩家网络环境参差）。 */
async function fetchCloud(timeoutMs: number): Promise<CloudSave | null> {
  try {
    const c = await Promise.race([
      downloadSave(),
      new Promise<null>(r => setTimeout(() => r(null), timeoutMs)),
    ])
    return c && typeof c.data === 'string' ? c : null
  } catch { return null }
}

/**
 * 启动时的权威同步：**云端优先**。
 *
 * 决策表（按顺序判）：
 *   云端拉不到（离线/超时/没档）        → 用本地，继续玩
 *   云端有档，但本地进度更高            → 用本地，并把它上报上去（服务端会接受更高的那份）
 *   云端有档、关卡相等，**且本机有未上传的改动、且云端这份正是我们上次同步的那一份**
 *                                       → 用本地，并把它上报上去（2026-09-20 新增，见下方注释）
 *   其余                                → **采用云端**（这就是这次转向的核心）
 *
 * ⚠️ 第二条的 `>=` 不能写成 `>`：相等时也该用云端 —— 云端是服务端裁决过的真相，
 *    本地只是个缓存，没必要在这上面分高下。
 *    **但"本地只是个缓存"有个前提：本地没有尚未上报的改动。** 见第三条。
 * ⚠️ 第三条绝不能反过来（不能"云端更高就用本地的"）—— 那正是要根治的病。
 */
export interface PullResult {
  used: 'cloud' | 'local' | 'none'
  localStage: number
  cloudStage: number
  reason?: string
}

export async function pullAuthoritative(timeoutMs = 3500): Promise<PullResult> {
  const me = getPlayerId()

  // ── 换账号检测：必须在"比进度"之前 ──────────────────────────────────
  // 本地存档是**单键**的、不按 playerId 分家（历史的形状，改键名 = 全服进度清零）。
  // 所以"这份本地档属于谁"只能靠 SAVE_OWNER_KEY 这个标记。标记缺失 = 老玩家升级上来，
  // 按"是我的"处理 ⇒ 零迁移，谁也不会被挡在门外。
  const owner = readOwner()
  if (owner && owner !== me) {
    // ⚠️ 真的会发生的场景：两个人共用一台设备，或者玩家自己换号登录。
    //    此时若照常走下面的"比进度"，本机这份**上一个账号的档**会被当成"我在别的设备上
    //    又推进了"而**上传到新账号名下** —— 串档，比丢档更糟，两个账号的进度搅在一起。
    //    处置：本地两份档挪进 .switched 单槽，然后**完全以云端为准**，绝不比、绝不上报。
    stashLocalSave()
    writeOwner(me)
    const c2 = await fetchCloud(timeoutMs)
    if (!c2) {
      // 新账号在云端也没有档 ⇒ 全新开始。本地已被清干净，引擎会走 freshState。
      return { used: 'none', localStage: -1, cloudStage: -1, reason: 'switched-no-cloud' }
    }
    const cs2 = summarizeSave(c2.data)?.stage ?? -1
    if (!applyCloudSave(c2.data)) {
      return { used: 'none', localStage: -1, cloudStage: cs2, reason: 'apply-failed' }
    }
    try { writeMeta({ lastUpload: c2.updatedAt || Date.now(), lastHash: fingerprint(c2.data) }) } catch { /* ignore */ }
    return { used: 'cloud', localStage: -1, cloudStage: cs2, reason: 'switched' }
  }
  // 标记补齐（老玩家首次升级、或全新设备）：走完这一趟，这份档就正式归属于 me 了
  writeOwner(me)

  const local = localSave()
  const localStage = local ? (summarizeSave(local)?.stage ?? -1) : -1

  const cloud = await fetchCloud(timeoutMs)

  if (!cloud) {
    return { used: local ? 'local' : 'none', localStage, cloudStage: -1, reason: 'no-cloud' }
  }
  const cloudStage = summarizeSave(cloud.data)?.stage ?? -1

  if (localStage >= 0 && localStage > cloudStage) {
    // 本地确实更高：这是"我在别的设备上又推进了"，不是"本机是旧档"。
    // 先落地本地继续玩，再把这份更高的传上去（服务端按最高关裁决，会接受）。
    void uploadSave(true)
    return { used: 'local', localStage, cloudStage, reason: 'local-higher' }
  }

  // ── "关卡相等"这一格：本机有**没传上去**的改动时，不能让云端抹掉它 ──────
  //
  // ⚠️ 2026-09-20 修复。此前这一格是无条件"采用云端"，于是：
  //   玩家的**等级、背包、邮件领取**都不改变 `highestStage`（它只在过关时 Math.max），
  //   所以"领了邮件马上刷新"时，本机与云端的关卡**相等** ⇒ 采用云端 ⇒
  //   云端那份（最多 3 分钟前上传的）里没有这次领取 ⇒ 玩家看到"又能领一次"。
  //   升级了角色刷新后等级退回去，是同一个病。复现见 temp/repro-sync-loss.cjs。
  //
  // 判据用**内容指纹**，不用时钟：
  //   `cloudUntouched` —— 云端此刻的字节 == 我们上次同步上去的那一份（`meta.lastHash`）
  //                      ⇒ 这期间**没有任何设备**写过云档（服务端只把 `body.data` 原样落盘）
  //                      ⇒ 本机这些未上传的改动就是全世界最新的 ⇒ 留下、并传上去。
  //   `localDirty`     —— 本机内容确实已经不是上次同步的那份了。
  // ⚠️ 为什么不用 `updatedAt` 比大小：`POST /save` 回的 `updatedAt` 与落盘写进 wrapper 的
  //    那个是**两次 `Date.now()`**，差 1~2ms，用它当判据会永远判成"云端被别人动过"。
  // ⚠️ 为什么这条不会复活 2026-09-18 事故（一台留着旧档的设备盖掉云端高进度）：
  //    那种设备 `localStage < cloudStage` ⇒ 两个分支都不进 ⇒ 照样采用云端。
  //    何况服务端 `POST /save` 本身就是"新关 < 旧关 ⇒ 拒"（reason:'stale'）。
  //    两台设备同关但内容不同时，云端指纹 ≠ 我们的 `lastHash` ⇒ `cloudUntouched` 为假 ⇒
  //    同样采用云端，不会发生"旧设备盖掉新内容"。
  // ⚠️ 一个副作用是**故意的**：本机有未上传改动时会多发一次 `POST /save`（`force=true`）。
  //    这恰恰是原来缺的那次同步 —— 服务端对"关卡相等"是接受的。
  if (localStage >= 0 && localStage === cloudStage) {
    const meta = readMeta()
    const localDirty = !!local && fingerprint(local) !== meta.lastHash
    const cloudUntouched = fingerprint(cloud.data) === meta.lastHash
    if (localDirty && cloudUntouched) {
      void uploadSave(true)
      return { used: 'local', localStage, cloudStage, reason: 'local-dirty' }
    }
  }

  // 采用云端。applyCloudSave 会先把当前本地档推进 .bak，所以这一步可逆。
  if (!applyCloudSave(cloud.data)) {
    return { used: 'local', localStage, cloudStage, reason: 'apply-failed' }
  }
  // ⚠️ 采用云端之后要把 lastHash 写成这份内容的指纹 —— 否则接下来的**首次自动上传**
  //    会认为"本地变了"，把刚拉下来的同一份又原样传回去（无害但白费一次往返）。
  try { writeMeta({ lastUpload: cloud.updatedAt || Date.now(), lastHash: fingerprint(cloud.data) }) } catch { /* ignore */ }
  return { used: 'cloud', localStage, cloudStage }
}

/** 上传当前本地存档；force=false 时若内容未变则跳过 */
export async function uploadSave(force = false): Promise<{ ok: boolean; reason?: string; updatedAt?: number }> {
  const data = localSave()
  if (!data) return { ok: false, reason: 'no-save' }
  const fp = fingerprint(data)
  const meta = readMeta()
  if (!force && meta.lastHash === fp) return { ok: false, reason: 'unchanged' }
  try {
    const r = await apiFetch(`${API}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), data }),
    })
    if (r.status === 429) return { ok: false, reason: 'cooldown' }
    if (!r.ok) return { ok: false, reason: 'http' + r.status }
    const j = await r.json()
    // 服务端「冷却/拒绝」回的是 200 + ok:false（不再用 429 制造控制台红字）：
    // 这种必须当失败处理，否则会把 lastHash 写成本次的指纹，后续同一份内容就再也不会重传了
    if (j?.ok !== true) {
      // ⚠️ `stale` 是新语义（2026-09-18 权威存档）：服务端说**云端进度比本机高**，
      //    拒绝用本机的旧档覆盖它。这不是故障，是保护 —— 但它意味着**本机落后了**，
      //    记下来让存档页能如实告诉玩家"云端有更新的进度，可以恢复"。
      if (j?.reason === 'stale') {
        try {
          localStorage.setItem(META_KEY, JSON.stringify({
            ...readMeta(), cloudAhead: true,
            cloudStage: j.cloudStage ?? 0, yourStage: j.yourStage ?? 0,
          }))
        } catch { /* ignore */ }
      }
      return { ok: false, reason: j?.reason || 'rejected' }
    }
    writeMeta({ lastUpload: j.updatedAt || Date.now(), lastHash: fp })
    return { ok: true, updatedAt: j.updatedAt }
  } catch { return { ok: false, reason: 'network' } }
}

/** 拉取某 playerId 的云存档（默认自己；传入存档码即跨设备找回） */
export async function downloadSave(playerId = getPlayerId()): Promise<CloudSave | null> {
  try {
    const r = await apiFetch(`${API}/save?playerId=${encodeURIComponent(playerId)}`)
    if (!r.ok) return null
    const j = await r.json()
    return typeof j?.data === 'string' ? { data: j.data, updatedAt: j.updatedAt } : null
  } catch { return null }
}

/**
 * 应用云存档：先把当前本地存档备份到 .bak（恢复可逆），再写回主存档。
 * 调用方随后 reload，由 load() 校验；若云存档损坏会自动回退 .bak。
 */
export function applyCloudSave(data: string): boolean {
  try {
    const cur = localStorage.getItem(SAVE_KEY)
    if (cur && cur !== data) localStorage.setItem(BAK_KEY, cur)
    localStorage.setItem(SAVE_KEY, data)
    return true
  } catch { return false }
}

export function getCloudMeta(): CloudMeta { return readMeta() }

let started = false
/**
 * 全局自动云备份：**启动时不再上传**（那是 2026-09-18 事故的根因），
 * 只在游戏进行中把变更同步上去 —— 每 3 分钟（仅内容变化时）+ 切后台/关页面尽力传一次。
 * 启动时的那一次"对齐云端"由 `pullAuthoritative()` 负责，它在渲染之前跑完。
 *
 * ⚠️ **2026-09-18（v2.0 账号）：`pagehide` 上的 sendBeacon 裸上传已删除。** 两条理由：
 *  ① 它是**裸上传** —— 绕过了 `uploadSave` 的指纹检查、`stale` 处理与 `ok:false` 处理，
 *     服务端说"你这份是旧的"它也不知道（那正是事故当天最该被拦住的一条路）。
 *  ② **`sendBeacon` 不能带 `Authorization` 头**（它不收自定义 header）。有了账号之后，
 *     凡设过密码的玩家走这条路必然被服务端拒掉 —— 一个既无用又有害的残留。
 * 切后台时 `visibilitychange` 仍会传一次，且那时页面还活着、走的是**完整的** `uploadSave`。
 */
export function startCloudSync(intervalMs = 180000) {
  if (started) return
  started = true
  // ⚠️ 这里**故意没有** `void uploadSave()`。见文件头注释：
  //    "一打开页面就上传本机档"会让任何一台留着旧档的设备覆盖云端高进度。
  //    启动时的云端对齐交给 pullAuthoritative() —— 它先拉、比进度、必要时才上传。
  setInterval(() => { void uploadSave() }, intervalMs)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void uploadSave() })
}