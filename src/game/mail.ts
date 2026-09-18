// 站内邮件：运营发公告/补偿/带附件的福利，服务端按 playerId 过滤后下发。
//
// 为什么不复用 rewards.ts 那套静态 JSON：奖励是**全服**的，收件人写死 'all' 不涉及隐私；
// 而邮件要能发给**特定玩家**，收件人只能是 playerId —— 而 playerId 就是存档码、持有即拥有。
// 放进 nginx 静态目录等于把一批玩家的账号公开发布。所以邮件库留在 api/data/（不可公网访问），
// 由 GET /doupo/api/mail 服务端过滤，连 to 字段都不回给客户端。
//
// 与 rewards 的另一处区别：奖励是**自动到账**（开局就发），邮件是**手动领取** ——
// 玩家得打开邮箱点一下，这才叫"发了公告"，否则没人会看到正文。
import { ITEM_INFO } from './data'
import { getPlayerId } from './leaderboardApi'

/** 与 rewards.ts 同一套口径：客户端永远不信任网络来的数字 */
const MAX_ITEM_AMOUNT = 1_000_000
const MAX_ITEM_KINDS = 20
const MAX_ID_LEN = 64
const MAX_TITLE_LEN = 40
const MAX_BODY_LEN = 2000
/** 单次最多展示多少封：与后端 MAIL_MAX 对齐，防邮件库长期不清理后一次渲染几百封卡住页面 */
const MAX_MAILS = 100

export interface Mail {
  /** 幂等键：领过就写进 state.gifts 的 `mail:<id>`，**改 id 等于让所有人重领一次** */
  id: string
  title: string
  body: string
  /** 附件。空对象 = 纯公告（按钮文案变成「知道了」） */
  items: Record<string, number>
  sender: string
  createdAt: number
  expiresAt: number
}

const API = `${import.meta.env.BASE_URL}api/mail`

/** 领取标记在 gifts 里的键。加 `mail:` 前缀是为了跟奖励 id 彻底隔开——
 *  两者共用 state.gifts 一张表（这样**不用给存档加任何字段**），但一旦同名，
 *  奖励会被当成"这封邮件已领"而永远发不出去。前缀让这件事在结构上不可能发生。 */
export const mailGiftKey = (id: string) => `mail:${id}`

/**
 * 校验附件表。只接受**白名单里的物品 + 正整数** —— 与 rewards.ts 的 sanitizeItems 同一套理由：
 * 键名拼错（写 `tanhuang` 而不是 `coin`）客户端加了数字也永远显示不出来，属于
 * "看着发了其实没有"，宁可整条丢掉让运营在控制台看见。
 */
function sanitizeItems(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const keys = Object.keys(src)
  if (keys.length > MAX_ITEM_KINDS) return null
  const out: Record<string, number> = {}
  for (const k of keys) {
    const v = Number(src[k])
    if (!Number.isInteger(v) || v <= 0 || v > MAX_ITEM_AMOUNT) return null
    if (!(k in ITEM_INFO)) return null
    out[k] = v
  }
  return out
}

/** 解析服务端回的邮件清单。逐封容错：坏的那封丢掉，好的照常显示——
 *  一封写坏的公告不该让整只邮箱打不开。新邮件排在前面（按 createdAt 倒序）。 */
export function parseMails(raw: unknown): Mail[] {
  const list = (raw as { mails?: unknown } | null)?.mails
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: Mail[] = []
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id || id.length > MAX_ID_LEN || seen.has(id)) continue
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, MAX_TITLE_LEN) : ''
    if (!title) continue // 没标题的邮件在列表里就是一行空白，玩家只会以为坏了
    // 附件表非法 → **整封丢掉**，而不是"当没有附件显示出来"：写着补偿 5000 灵金、
    // 点开却一个子儿没有，正是 rewards.ts 注释里那句"看着发了其实没有"，最难查。
    // （缺失 items 字段按"没有附件"处理，只有**给了但内容非法**才丢。）
    const items = sanitizeItems(o.items === undefined || o.items === null ? {} : o.items)
    if (items === null) {
      console.warn('[mail] 丢弃一封附件表非法的邮件：', id || JSON.stringify(item)?.slice(0, 120))
      continue
    }
    seen.add(id)
    out.push({
      id,
      title,
      body: typeof o.body === 'string' ? o.body.slice(0, MAX_BODY_LEN) : '',
      items,
      sender: typeof o.sender === 'string' ? o.sender.trim().slice(0, 20) : '',
      createdAt: Number.isFinite(Number(o.createdAt)) ? Number(o.createdAt) : 0,
      expiresAt: Number.isFinite(Number(o.expiresAt)) ? Number(o.expiresAt) : 0,
    })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out.slice(0, MAX_MAILS)
}

/** 拉邮件。网络失败/服务没起来一律返回空数组——邮箱拉不到不该影响游戏本身 */
export async function fetchMails(): Promise<Mail[]> {
  const res = await fetch(`${API}?playerId=${encodeURIComponent(getPlayerId())}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseMails(await res.json())
}