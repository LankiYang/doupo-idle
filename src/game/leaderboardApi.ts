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

export interface LbRow { rank: number; name: string; power: number; stage: number; updatedAt: number }
export interface LbResp { entries: LbRow[]; total: number }
export interface MeResp { entry: LbRow | null; rank: number | null; total: number }
export interface SubmitResp { rank: number | null; total: number }

/** 上传当前战绩；冷却中(429)或网络错误返回 null，调用方静默忽略 */
export async function submitScore(name: string, power: number, stage: number): Promise<SubmitResp | null> {
  try {
    const r = await fetch(`${API}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), name, power: Math.floor(power), stage: Math.floor(stage) }),
    })
    if (!r.ok) return null
    return (await r.json()) as SubmitResp
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
