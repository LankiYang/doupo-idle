// 抽卡手气榜 API 客户端。
//
// 与 `leaderboardApi` 的**关键差别**：本榜**不上报任何数字**。请求体里只有 `playerId` 和昵称，
// 「抽了多少次 / 出过几张圣阶」由服务端从权威档自己算（`/opt/doupo-game/api/server.js` 的 `/luck`）。
// 所以这里没有 power / stage 之类的参数 —— 分母是「越低越好」的分母，能被客户端上报就等于能被随手写成第一名。
//
// 两端共用同一个 `playerId`（`leaderboardApi.getPlayerId()`）：同一个人两张榜必须对上号。
import { apiFetch } from './authApi'
import { getPlayerId } from './leaderboardApi'

const API = `${import.meta.env.BASE_URL}api` // '/doupo/api'

export interface LuckRow {
  rank: number
  name: string
  pullCount: number   // 终身累计抽数
  shengCount: number  // 终身累计出圣阶张数
  avg: number         // pullCount / shengCount，越低越好
  updatedAt: number
}
/** 还没出圣阶的人：**只列抽数，不参与排名**（没有 `rank` 字段 —— 有 `rank` 才是名次） */
export interface LuckPullRow {
  name: string
  pullCount: number
  updatedAt: number
}
export interface LuckResp {
  entries: LuckRow[]      // 出了圣阶的 —— 按手气排名
  pulls: LuckPullRow[]    // 还没出的 —— 只列抽数，**不计入排名**
  total: number           // **只数有排名的那部分**（界面上「第 N 名 / 共 M 人」要跟它对得上）
  baseline: number  // 全服长期均衡值（约 52），服务端下发是为了「参照线只有一处来源」
  minSheng: number  // 上榜门槛
}
/** `pullCount/shengCount` 是「我自己」的两个计数，与「有没有上榜」无关 —— 界面据此写「已抽 N 抽」 */
export interface LuckMeResp {
  entry: LuckRow | null
  rank: number | null
  total: number
  pullCount?: number
  shengCount?: number
}

/** 提交结果：**失败也要看得见原因**（未上榜 / 没有云端存档 / 冷却），界面才能给出有用的提示 */
export type LuckSubmitResp =
  | { ok: true; rank: number | null; total: number; avg: number; pullCount: number; shengCount: number }
  | { ok: false; reason: 'cooldown' | 'noauth' | 'nosheng' | string; pullCount?: number; shengCount?: number; minSheng?: number }

/** 距上次提交的最小间隔(ms)：服务端同一 playerId 冷却 5s，这里不发比发出去被拒干净 */
const LUCK_MIN_GAP = 6000
let lastAt = 0

/**
 * 提交（服务端据此重算我这一行）。节流/网络错误返回 null，调用方静默忽略。
 *
 * ⚠️ **名字为空时请求里就不带 `name` 字段**（v1.53，与 `leaderboardApi.submitScore` 同一条）。
 *    原先写死成 `'无名侠客'` 上报，会在换设备后**覆盖**服务端那份权威昵称 ——
 *    不带字段 = "我没有新名字要说"，服务端沿用它自己那份（账号记录 → 榜上真名）。
 */
export async function submitLuck(name: string): Promise<LuckSubmitResp | null> {
  const now = Date.now()
  if (now - lastAt < LUCK_MIN_GAP) return null
  lastAt = now
  const nm = (name || '').trim().slice(0, 12)
  const body: Record<string, unknown> = { playerId: getPlayerId() }
  if (nm) body.name = nm
  try {
    const r = await apiFetch(`${API}/luck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    return (await r.json()) as LuckSubmitResp
  } catch {
    return null
  }
}

export async function fetchLuck(limit = 100): Promise<LuckResp | null> {
  try {
    const r = await apiFetch(`${API}/luck?limit=${limit}`)
    if (!r.ok) return null
    return (await r.json()) as LuckResp
  } catch {
    return null
  }
}

export async function fetchLuckMe(): Promise<LuckMeResp | null> {
  try {
    const r = await apiFetch(`${API}/luck/me?playerId=${encodeURIComponent(getPlayerId())}`)
    if (!r.ok) return null
    return (await r.json()) as LuckMeResp
  } catch {
    return null
  }
}