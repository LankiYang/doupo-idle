// 运营奖励：服务端数据文件驱动的一次性发放。
//
// 为什么要有这个文件：走 GIFTS 发一次福利要「改 engine.ts → npm run build → 原子部署」三步，
// 部署本身有回滚点/nginx reload 这些仪式，发一次全服补偿的成本高得没必要。
// 现在奖励清单变成**服务端的一个 JSON**（/opt/doupo-game/rewards/rewards.json，由 bin/doupo-grant 维护），
// 客户端启动时拉一次、之后每 3 分钟拉一次：运营改文件即全服到账，不改代码、不构建、不部署。
//
// 为什么不是「服务端直接改存档」：本作是**客户端权威**存档（saveApi 的 uploadSave 只读本地档、
// 不比对云端 updatedAt），服务端改完会被玩家本地档在秒级整份盖回。发放必须由客户端在下一次加载时
// 自己写进存档，再随它自己的自动备份带上云——这也是本地-only 的玩家（多数）唯一能收到的方式。
//
// 幂等靠 state.gifts（发放 id → 领取时间戳），与内置 GIFTS 共用同一张表，随存档走。
import { ITEM_INFO } from './data'

/** 单条物品的发放上限：防手滑把 10 打成 1000000000。超限整条判非法（而不是悄悄截断成上限） */
export const MAX_ITEM_AMOUNT = 1_000_000
/** 一条奖励最多几种物品（纯防呆，正常用不到） */
const MAX_ITEM_KINDS = 20
/** id 长度上限，防把整段说明写进 id */
const MAX_ID_LEN = 64

export interface RemoteReward {
  /** 幂等键：领过就写进 state.gifts，**改 id 等于让所有人重领一次**，跟内置 GIFTS 同一个坑 */
  id: string
  label: string
  items: Record<string, number>
  /** 新注册账号是否也发。false = 只补"这条奖励存在之前就有的存档"（补偿性质） */
  newPlayersToo: boolean
  /** 过期时间戳，过了就不再发（0 = 不过期）。给限时活动用，免得忘记撤下 */
  expiresAt: number
}

export const REWARDS_URL = `${import.meta.env.BASE_URL}rewards/rewards.json`

/**
 * 校验一条奖励的物品表。只接受**白名单里的物品 + 正整数**：
 * - 键必须在 ITEM_INFO 里。写成 tanhuang/缘分丹 这种键名，客户端加了数字也永远不会显示，
 *   属于"看着发了其实没有"，宁可在校验阶段整条丢掉。
 * - 负数/0 会让玩家掉资源、小数会让库存出现 0.5 个丹，一律不接受。
 */
function sanitizeItems(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const keys = Object.keys(src)
  if (keys.length === 0 || keys.length > MAX_ITEM_KINDS) return null
  const out: Record<string, number> = {}
  for (const k of keys) {
    const v = Number(src[k])
    if (!Number.isInteger(v) || v <= 0 || v > MAX_ITEM_AMOUNT) return null
    if (!(k in ITEM_INFO)) return null
    out[k] = v
  }
  return out
}

/**
 * 把 rewards.json 的原文解析成可用清单。逐条容错：坏的那条丢掉，好的照发——
 * 一条写错的奖励不该让整批福利都发不出去。被丢掉的条目打 console.warn，运营侧一眼能看见。
 */
export function parseRewards(raw: unknown): RemoteReward[] {
  const list = (raw as { rewards?: unknown } | null)?.rewards
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: RemoteReward[] = []
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const items = sanitizeItems(o.items)
    // 空 id / 超长 id / id 重复：id 就是幂等键，分不清就等于会重发或少发，直接丢
    if (!id || id.length > MAX_ID_LEN || seen.has(id) || !items) {
      console.warn('[rewards] 丢弃一条非法奖励：', id || JSON.stringify(item)?.slice(0, 120))
      continue
    }
    seen.add(id)
    out.push({
      id,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : id,
      items,
      newPlayersToo: o.newPlayersToo !== false,
      expiresAt: Number.isFinite(Number(o.expiresAt)) ? Number(o.expiresAt) : 0,
    })
  }
  return out
}

/** 拉取奖励清单。网络失败/404 直接抛，由调用方吞掉——福利拉不到不该影响游戏本身 */
export async function fetchRemoteRewards(): Promise<RemoteReward[]> {
  const res = await fetch(REWARDS_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseRewards(await res.json())
}