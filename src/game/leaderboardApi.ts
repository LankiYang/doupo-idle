// 群雄榜后端 API 客户端：匿名 playerId 标识玩家，上传/拉取真实战绩
// API 基址随 vite base 走（/doupo/ → /doupo/api），与部署子路径解耦

import { apiFetch } from './authApi'

const ID_KEY = 'doupo-idle-player-id'
const API = `${import.meta.env.BASE_URL}api` // '/doupo/api'

function genId(): string {
  const arr = new Uint8Array(16)
  try {
    crypto.getRandomValues(arr) // 非安全上下文(http)下也可用
  } catch {
    for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

/** 匿名玩家 id（持久化在 localStorage；清缓存/换设备会视为新玩家） */
export function getPlayerId(): string {
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id || id.length < 8 || id.length > 64) { id = genId(); localStorage.setItem(ID_KEY, id) }
    return id
  } catch {
    return genId()
  }
}

/**
 * 覆盖当前身份 id。仅在「用存档码恢复云存档」时调用——存档数据与身份必须一起搬，
 * 否则恢复来的进度会以新生成的 id 继续上传，原 id 的云端档从此停更、榜单记录错位。
 */
export function setPlayerId(id: string): boolean {
  try {
    if (!id || id.length < 8 || id.length > 64) return false
    localStorage.setItem(ID_KEY, id)
    return true
  } catch {
    return false
  }
}

export interface LbRow { rank: number; name: string; power: number; stage: number; floor: number; updatedAt: number }
export interface LbResp { entries: LbRow[]; total: number }
export interface MeResp { entry: LbRow | null; rank: number | null; total: number }
export interface SubmitResp { rank: number | null; total: number }

/**
 * 阵容详情里的**一格**。
 * ⚠️ 服务端刻意只回这五样（见 `server.js` 的 `rosterOfRow`）：**没有 playerId、没有装备、
 *    没有异火是谁、没有资源**。异火虽然参与了战力计算，但**只算数、不告诉别人他带的是哪一朵**。
 */
export interface RosterSlot { slot: 'front' | 'back'; name: string; level: number; stars: number; power: number }
export interface RosterDetail { team: RosterSlot[] }
export interface RosterResp { entries: LbRow[]; total: number; rosters: (RosterDetail | null)[] }

/** 距上次提交的最小间隔(ms)：服务端对同一 playerId 的冷却就是 5s，这里不发比发出去被拒干净 */
const SUBMIT_MIN_GAP = 6000
/** 战绩完全没变时，最多多久补传一次(ms) */
const SUBMIT_SAME_GAP = 60000
let lastSubmitAt = 0
let lastPayload = ''

/**
 * 上传当前战绩；本地节流拦下、冷却中、网络错误一律返回 null，调用方静默忽略。
 *
 * ⚠️ **名字为空时，请求里就不带 `name` 字段**（v1.53）。写死成 `'无名侠客'` 上报会**覆盖**
 *    服务端那份权威昵称 —— 换设备后本机没有名字，一次上报就把榜上的名字顶成了"无名侠客"
 *    （2026-09-21 的事故）。不带字段 = "我没有新名字要说"，服务端沿用它自己那份。
 */
export async function submitScore(name: string, power: number, stage: number, floor = 0): Promise<SubmitResp | null> {
  const nm = (name || '').trim().slice(0, 12)
  const body: Record<string, unknown> = {
    playerId: getPlayerId(), power: Math.floor(power), stage: Math.floor(stage), floor: Math.floor(floor),
  }
  if (nm) body.name = nm
  const payload = JSON.stringify({ nm, power: body.power, stage: body.stage, floor: body.floor })
  const now = Date.now()
  // 本地节流：「进榜单页 / 点刷新 / 改昵称」都会提交一次，而服务端 5s 内只认第一次。
  // 重复请求被拒时浏览器会在控制台打一条红色 429（玩家截图来问"是不是坏了"），所以干脆不发。
  if (now - lastSubmitAt < SUBMIT_MIN_GAP) return null
  if (payload === lastPayload && now - lastSubmitAt < SUBMIT_SAME_GAP) return null
  lastSubmitAt = now
  lastPayload = payload
  try {
    const r = await apiFetch(`${API}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    const j = await r.json()
    // 服务端冷却回的是 200 + ok:false（不是错误，见 SPEC 坑 14）。这种情况没有名次可报，
    // 必须返回 null，否则调用方会拿到一个 rank 为 undefined 的"成功响应"（多标签页同开时真会撞上）。
    if (j?.ok === false) return null
    return j as SubmitResp
  } catch {
    return null
  }
}

export async function fetchLeaderboard(limit = 100): Promise<LbResp | null> {
  try {
    const r = await apiFetch(`${API}/leaderboard?limit=${limit}`)
    if (!r.ok) return null
    return (await r.json()) as LbResp
  } catch {
    return null
  }
}

/**
 * 拉「带阵容」的榜单（`?withRoster=1`）。`rosters` 与 `entries` **同序等长** —— 同一次响应
 * 里出来的两段，天然对齐，所以阵容里不需要带任何身份标识符。
 *
 * ⚠️ **单独一支、按需调用**：服务端为它要额外读一遍每个人的权威档。所以只在玩家真点了
 *    「查看阵容」时才发这一发 —— 平时的刷新一波不该产生这个成本（也不该读到别人的背包）。
 * ⚠️ 回包里的 `null` = 那个人还没有云端存档（纯本地玩家）⇒ 界面直接说"看不到阵容"，
 *    **不拿他自己上报的战力去凑**（与手气榜同一条规矩：宁可空着，也不摆一个能随手编的数）。
 */
export async function fetchLeaderboardWithRoster(limit = 100): Promise<RosterResp | null> {
  try {
    const r = await apiFetch(`${API}/leaderboard?limit=${limit}&withRoster=1`)
    if (!r.ok) return null
    return (await r.json()) as RosterResp
  } catch {
    return null
  }
}

export async function fetchMe(): Promise<MeResp | null> {
  try {
    const r = await apiFetch(`${API}/me?playerId=${encodeURIComponent(getPlayerId())}`)
    if (!r.ok) return null
    return (await r.json()) as MeResp
  } catch {
    return null
  }
}

/**
 * 取回**权威昵称**（v1.53）。服务端的顺序是：账号记录里的 `nick` → 榜上既有的真名 → 空串。
 *
 * ⚠️ 它返回 `''`（还没起名）与返回 `null`（**没问到**）是**两件事**，调用方必须分开处理：
 *    前者是"这个人确实还没名字"（该引导他起名），后者是"这次没问到"（网络/服务端问题，
 *    应该保持现状、下次再问）—— 把后者当成前者，就会在断网时弹一个起名框出来。
 */
export async function fetchNick(): Promise<string | null> {
  try {
    const r = await apiFetch(`${API}/nickname?playerId=${encodeURIComponent(getPlayerId())}`)
    if (!r.ok) return null
    const j = await r.json()
    if (!j || j.ok !== true || typeof j.nick !== 'string') return null
    return j.nick.trim()
  } catch {
    return null
  }
}

/**
 * 改名字（v1.53）。服务端会把它写进**账号记录**（有账号时），并同步两张榜上那条的名字。
 *
 * 返回**服务端最终采用的名字**；`null` = 没改成（冷却中 / 断网 / 名字为空）。
 * ⚠️ 调用方要用**回执里的名字**去写本地缓存，而不是自己那份输入 —— 服务端可能做了清洗。
 */
export async function submitNick(nick: string): Promise<string | null> {
  try {
    const r = await apiFetch(`${API}/nickname`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), nick: (nick || '').trim().slice(0, 12) }),
    })
    if (!r.ok) return null
    const j = await r.json()
    if (!j || j.ok !== true || typeof j.nick !== 'string') return null
    return j.nick
  } catch {
    return null
  }
}

/** 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 */
export function agoText(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
