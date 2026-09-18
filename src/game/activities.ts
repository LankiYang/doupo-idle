// 活动中心：**服务端数据文件驱动**的活动配置（v1.42）。
//
// 与 rewards.ts 同一个思路、同一套理由：活动要能"配"，就不能写在源码里。
// 写在源码里的活动 = 改一次活动要「改 data.ts → npm run build → 原子部署」，
// 而且 v1.41 的限时常量已经教过一次：**换期/改期 = 重建 + 重新部署，一步都不能省**。
// 现在活动清单是 /opt/doupo-game/activities/activities.json（由 bin/doupo-activity 维护），
// 客户端启动拉一次、之后每 3 分钟拉一次：运营改文件即全服生效，不改代码、不构建、不部署。
//
// ── 抽象：**进度从哪来** × **周期多长**，两个正交的维度 ──────────────────────────
//
//   kind: 'online'   在线时长类 —— 进度 = 在线分钟数（tick 里按 wall-clock 累加）
//   kind: 'checkin'  签到类     —— 无进度，点一下就是达标（target 恒为 1，周期恒为 daily）
//   kind: 'task'     任务类     —— 进度 = 某个计数指标（metric，见下方白名单）
//
//   cycle: 'once'    一次性（达成一次就永久领过）
//          'daily'   每日（按本地日期跨天重置，第二天可以再领）
//
// 阶梯奖励（在线 30 分钟领一档、2 小时再领一档）**不做成一条活动的多个档位**，
// 而是**拆成多条活动**：每条独立可开关、独立改奖励、独立测试，配置里多写几行而已。
// 反过来说，把档位塞进一条活动会让"这条活动领到第几档了"变成一个新状态，
// 而拆开之后，领取状态就是**每条活动一个布尔**，没有任何新概念。
//
// ── 指标白名单 ────────────────────────────────────────────────────────────
// metric 必须在这张表里，否则**整条活动判非法丢弃**（与 rewards 的物品白名单同理）：
// 写错一个指标名而"看着配了、其实永远不涨"，是运营最难自己发现的一类错。
// 加一个新指标 = 这里加一行 + 在**唯一那个动作处**调一次 game.bumpMetric（见 engine.ts）。
import { ITEM_INFO } from './data'
import { sanitizeItems } from './rewards'

/** 进度来源 */
export type ActivityKind = 'online' | 'checkin' | 'task'
/** 周期：一次性 / 每日（按本地日期跨天重置） */
export type ActivityCycle = 'once' | 'daily'
/** 活动相对当前时间的位置：未开始 / 进行中 / 已结束 */
export type ActivityStatus = 'pending' | 'active' | 'ended'

/** id 长度上限（防把整段说明写进 id） */
const MAX_ID_LEN = 64
/** 标题长度上限（超了截断而不是丢弃 —— 标题写长一点是笔误，不是恶意） */
const MAX_TITLE_LEN = 40
/** 目标值上限：防手滑把 30 打成 3000000000，那种活动等于永远做不完 */
const MAX_TARGET = 1_000_000

/**
 * 可用的计数指标。**这是配置能写什么 metric 的唯一依据。**
 * label/unit 只用于界面展示（"今日消除格数 120/300 格"），不参与判定。
 *
 * ⚠️ 表里每一项都必须真的有人 bump（grep metricKey 就能找到挂点）。
 *    加了表项却没挂点 = 配出来的活动永远停在 0，比"配置写错"更隐蔽：
 *    配置写错至少会被丢弃并 warn，没挂点则是一条**看起来完全正常、就是不动**的活动。
 */
export const ACTIVITY_METRICS: Record<string, { label: string; unit: string }> = {
  recruit: { label: '招募', unit: '次' },
  redeem: { label: '碎片兑换', unit: '次' },
  enhance: { label: '装备强化', unit: '级' },
  reforge: { label: '装备洗练', unit: '次' },
  starup: { label: '武魂升星', unit: '次' },
  craft: { label: '炼丹', unit: '次' },
  shop: { label: '商城购买', unit: '次' },
  'lab.win': { label: '天梯塔通关', unit: '层' },
  'stage.win': { label: '主线通关', unit: '关' },
  'boss.hit': { label: '集结讨伐出手', unit: '次' },
  'match3.tiles': { label: '消除格数', unit: '格' },
  'checkin.days': { label: '累计签到', unit: '天' },
}

export interface ActivityDef {
  /** 幂等键的一部分：领过就再也领不到（daily 型是"这一天领过"）。**改 id 等于让所有人重领** */
  id: string
  title: string
  desc: string
  kind: ActivityKind
  /** kind === 'task' 时的计数指标；其余 kind 恒为空串 */
  metric: string
  /** 达成所需：online = 分钟，task = 次数/格数，checkin 恒为 1 */
  target: number
  cycle: ActivityCycle
  items: Record<string, number>
  /** 生效窗口：0 = 不限（startAt 立即生效、endAt 永不结束） */
  startAt: number
  endAt: number
  /** 展示排序，小的在前；相同则按配置文件里的先后 */
  order: number
  enabled: boolean
}

export const ACTIVITIES_URL = `${import.meta.env.BASE_URL}activities/activities.json`

/**
 * 本地日期键。**全站只有这一个日期口径**（商城跨天回落也走它）——
 * 两处各写一份 `new Date().toDateString()` 的话，哪天有人给其中一处加了时区处理，
 * "签到说今天签过了、商城说今天还没买"这种对不上的怪事就会冒出来。
 *
 * 用本地时区（toDateString 本来就是），因为玩家感知的"今天"是他自己日历上的今天。
 */
export function todayKey(now: number = Date.now()): string {
  return new Date(now).toDateString()
}

/** 活动此刻的位置。左闭右开，与 data.ts 里联动窗口的判定同一个写法 */
export function activityStatus(a: ActivityDef, now: number = Date.now()): ActivityStatus {
  if (a.startAt > 0 && now < a.startAt) return 'pending'
  if (a.endAt > 0 && now >= a.endAt) return 'ended'
  return 'active'
}

/** 能进活动中心的（进行中 + 已启用）；未开始与已结束的不展示，避免"配了但点不动"的困惑 */
export function activeActivities(list: ActivityDef[], now: number = Date.now()): ActivityDef[] {
  return list.filter(a => a.enabled && activityStatus(a, now) === 'active')
}

/**
 * 校验一条活动的物品表 —— 与运营奖励**共用同一套**（rewards.sanitizeItems）。
 * 这里只再挡一件事：活动奖励不能为空（空奖励的活动点了没反应，玩家会当成 bug）。
 */
function sanitizeReward(raw: unknown): Record<string, number> | null {
  const items = sanitizeItems(raw)
  if (!items) return null
  return Object.keys(items).length > 0 ? items : null
}

/**
 * 把 activities.json 的原文解析成可用清单。**逐条容错**：坏的那条丢掉，好的照配。
 * 一条写错的活动不该让整个活动中心都空掉。丢掉的都 console.warn，运营侧一眼能看见。
 */
export function parseActivities(raw: unknown): ActivityDef[] {
  const list = (raw as { activities?: unknown } | null)?.activities
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: ActivityDef[] = []
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const drop = (why: string) => console.warn(`[activities] 丢弃一条非法活动（${why}）：`, id || JSON.stringify(item)?.slice(0, 120))

    if (!id || id.length > MAX_ID_LEN || seen.has(id)) { drop('id 缺失/超长/重复'); continue }
    const kind = o.kind
    if (kind !== 'online' && kind !== 'checkin' && kind !== 'task') { drop('kind 不认识'); continue }
    const items = sanitizeReward(o.items)
    if (!items) { drop('奖励表非法或为空'); continue }

    // checkin 的 target/cycle 是**固定的**：签到就是"今天点一下"，写成 7 天或 once 都不是签到该有的样子。
    // 要"连续/累计签到 N 天"用 task + metric 'checkin.days'，那样语义才清楚。
    const target = kind === 'checkin' ? 1 : Math.floor(Number(o.target))
    if (!Number.isFinite(target) || target <= 0 || target > MAX_TARGET) { drop('target 非法'); continue }
    const cycle: ActivityCycle = kind === 'checkin' ? 'daily' : (o.cycle === 'daily' ? 'daily' : 'once')

    // task 的 metric 必须在白名单里；online/checkin 的进度不来自计数指标
    let metric = ''
    if (kind === 'task') {
      metric = typeof o.metric === 'string' ? o.metric.trim() : ''
      if (!(metric in ACTIVITY_METRICS)) { drop(`metric「${metric}」不在白名单里`); continue }
    }

    const startAt = Number.isFinite(Number(o.startAt)) ? Math.max(0, Math.floor(Number(o.startAt))) : 0
    const endAt = Number.isFinite(Number(o.endAt)) ? Math.max(0, Math.floor(Number(o.endAt))) : 0
    if (endAt > 0 && startAt > 0 && endAt <= startAt) { drop('endAt 不晚于 startAt'); continue }

    seen.add(id)
    out.push({
      id,
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, MAX_TITLE_LEN) : id,
      desc: typeof o.desc === 'string' ? o.desc.trim().slice(0, 80) : '',
      kind,
      metric,
      target,
      cycle,
      items,
      startAt,
      endAt,
      order: Number.isFinite(Number(o.order)) ? Number(o.order) : 0,
      enabled: o.enabled !== false,
    })
  }
  // 排序收口在这里：界面不必再排一次（两处各排一次，改排序规则时必然只改一处）
  return out.sort((a, b) => a.order - b.order)
}

/** 拉取活动配置。网络失败/404 直接抛，由调用方吞掉 —— 拉不到活动不该影响游戏本身 */
export async function fetchActivities(): Promise<ActivityDef[]> {
  const res = await fetch(ACTIVITIES_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseActivities(await res.json())
}

/** 奖励的一行文字（"灵金 ×500 · 缘分丹 ×1"），界面与日志共用 */
export function rewardText(items: Record<string, number>): string {
  return Object.keys(items)
    .map(k => `${ITEM_INFO[k]?.name ?? k} ×${items[k]}`)
    .join(' · ')
}