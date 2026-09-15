// 群雄榜后端 API 客户端：匿名 playerId 标识玩家，上传/拉取真实战绩
// API 基址随 vite base 走（/doupo/ → /doupo/api），与部署子路径解耦

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

/** 距上次提交的最小间隔(ms)：服务端对同一 playerId 的冷却就是 5s，这里不发比发出去被拒干净 */
const SUBMIT_MIN_GAP = 6000
/** 战绩完全没变时，最多多久补传一次(ms) */
const SUBMIT_SAME_GAP = 60000
let lastSubmitAt = 0
let lastPayload = ''

/** 上传当前战绩；本地节流拦下、冷却中、网络错误一律返回 null，调用方静默忽略 */
export async function submitScore(name: string, power: number, stage: number, floor = 0): Promise<SubmitResp | null> {
  const payload = JSON.stringify({ name, power: Math.floor(power), stage: Math.floor(stage), floor: Math.floor(floor) })
  const now = Date.now()
  // 本地节流：「进榜单页 / 点刷新 / 改昵称」都会提交一次，而服务端 5s 内只认第一次。
  // 重复请求被拒时浏览器会在控制台打一条红色 429（玩家截图来问"是不是坏了"），所以干脆不发。
  if (now - lastSubmitAt < SUBMIT_MIN_GAP) return null
  if (payload === lastPayload && now - lastSubmitAt < SUBMIT_SAME_GAP) return null
  lastSubmitAt = now
  lastPayload = payload
  try {
    const r = await fetch(`${API}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), name, power: Math.floor(power), stage: Math.floor(stage), floor: Math.floor(floor) }),
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
    const r = await fetch(`${API}/leaderboard?limit=${limit}`)
    if (!r.ok) return null
    return (await r.json()) as LbResp
  } catch {
    return null
  }
}

export async function fetchMe(): Promise<MeResp | null> {
  try {
    const r = await fetch(`${API}/me?playerId=${encodeURIComponent(getPlayerId())}`)
    if (!r.ok) return null
    return (await r.json()) as MeResp
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
