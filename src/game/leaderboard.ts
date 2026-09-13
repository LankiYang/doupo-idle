// ─── 假排行榜：没有后端，本地生成一批"看起来真实"的虚拟对手 ──────────────────
// 核心思路：
// 1. 虚拟对手的战力是相对"基准战力"的一个比例，基准战力 = 玩家首次打开榜单时的真实战力，
//    只在第一次生成时定住，之后不会因为玩家自己战力变化而重新洗牌。
// 2. 基准战力本身随现实时间缓慢复利增长（模拟"别人也在挂机变强"），
//    玩家如果实际战力涨得比这个速度快，就能真正往上爬名次；不玩的话名次会被"追上"——
//    否则玩家不管涨多少倍战力，相对排名会因为对手跟着等比例涨而永远原地不动，榜单就没意义了。

const SEED_KEY = 'doupo-idle-leaderboard-seed-v2'

const NAME_PREFIX = ['焚', '紫', '玄', '天', '风', '云', '剑', '影', '霄', '煞', '幽', '烈', '寒', '傲', '疾', '雷', '御', '破', '灭', '苍', '墨', '赤', '青', '白', '夜']
const NAME_SUFFIX = ['天笑', '云仙', '断魂', '无极', '惊鸿', '逍遥', '孤影', '剑心', '破军', '长歌', '醉月', '归尘', '战神', '龙吟', '星痕', '雨落', '山河', '无双', '独尊', '幻音', '折雪', '啸天', '踏空', '问道', '摘星']

function randomName(rng: () => number): string {
  const p = NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]
  const s = NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)]
  return p + s
}

/** 简单的可复现伪随机数生成器（基于种子），保证同一个 seed 每次生成的比例序列一致 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface FakeRival { name: string; ratio: number }
interface LeaderboardSeed { seedValue: number; entries: FakeRival[]; baselinePower: number; createdAt: number }

const RIVAL_COUNT = 49
/** 虚拟对手战力每天自然复利增长的比例：模拟"别人也在挂机变强"，太快会让玩家永远追不上，太慢又没有紧迫感 */
const DAILY_GROWTH = 0.035

function loadOrCreateSeed(myPower: number): LeaderboardSeed {
  try {
    const raw = localStorage.getItem(SEED_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LeaderboardSeed
      if (parsed.entries?.length === RIVAL_COUNT && parsed.baselinePower > 0) return parsed
    }
  } catch { /* ignore */ }
  const seedValue = Math.floor(Math.random() * 2 ** 31)
  const rng = mulberry32(seedValue)
  const entries: FakeRival[] = []
  for (let i = 0; i < RIVAL_COUNT; i++) {
    // 对数正态式分布：exp((0~1的随机数-0.5)*3.2) 大致落在 0.2x~5x 之间，
    // 越靠近 1x（跟玩家旗鼓相当）的人数密度越高，符合"高手少、路人多"的直觉
    const ratio = Math.exp((rng() - 0.5) * 3.2)
    entries.push({ name: randomName(rng), ratio })
  }
  const seed: LeaderboardSeed = { seedValue, entries, baselinePower: Math.max(1, myPower), createdAt: Date.now() }
  try { localStorage.setItem(SEED_KEY, JSON.stringify(seed)) } catch { /* ignore */ }
  return seed
}

export interface LeaderboardRow { rank: number; name: string; power: number; isMe: boolean }

/** 生成完整榜单：虚拟对手（随时间缓慢增长）+ 玩家自己（实时真实战力），按战力降序排列 */
export function buildLeaderboard(myPower: number, myName: string): LeaderboardRow[] {
  const seed = loadOrCreateSeed(myPower)
  const days = Math.max(0, (Date.now() - seed.createdAt) / (1000 * 60 * 60 * 24))
  const growth = Math.pow(1 + DAILY_GROWTH, days)
  const rows = seed.entries.map(e => ({ name: e.name, power: Math.max(1, Math.round(e.ratio * seed.baselinePower * growth)), isMe: false }))
  rows.push({ name: myName, power: myPower, isMe: true })
  rows.sort((a, b) => b.power - a.power)
  return rows.map((r, i) => ({ rank: i + 1, name: r.name, power: r.power, isMe: r.isMe }))
}
