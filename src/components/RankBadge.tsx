/**
 * 名次徽章（v1.44）。排行榜与集结讨伐榜共用。
 *
 * 原先前三名渲染的是 🥇🥈🥉 三个 emoji。换掉它们有三个理由，最后一条是硬伤：
 *   ① 三个字形来自系统 emoji 字体，在安卓 / iOS / Windows 上是三套完全不同的画风，
 *      榜单一排下去颜色、大小、基线都在跳；
 *   ② 本机没有 emoji 字体（红线⑨），出图与截图里是一排豆腐块，改版时看不见真实效果；
 *   ③ **奖牌与数字的行高不一样** —— 讨伐榜为此专门写了"名次这一格必须锁高 `h-4`"的注释
 *      （见 WorldBossView 的 RankRow）：我打上榜那一刻，整行高 2px、榜单跟着蹿。
 *      徽章是固定尺寸的盒子，第 1 名和第 100 名**结构上就是同一个盒子**，
 *      那条抖动从"靠注释提醒后人别改"变成了"改不动"。
 *
 * 颜色只在 1~3 名上出现（金 / 银 / 铜），第 4 名起是纯数字、颜色交给调用方的 `currentColor` ——
 * 两个榜单对"普通名次"的配色本来就不同（一个是灰、一个是红），这里不该越权。
 */
const TIER = [
  { bg: 'linear-gradient(160deg, #ffe3a3, #c8901f)', ring: '#ffe9b8' }, // 金
  { bg: 'linear-gradient(160deg, #eef0f4, #97a0ab)', ring: '#f4f6f9' }, // 银
  { bg: 'linear-gradient(160deg, #e8b285, #95582a)', ring: '#f0c39a' }, // 铜
]

export default function RankBadge({ rank, className = 'h-5 w-5 text-[11px]' }: {
  /** ≤0 表示「名次还没定」（本地先造的那一行，服务端下一轮才把我算进参与者）——显示一个破折号，绝不显示「第 0 名」 */
  rank: number
  className?: string
}) {
  if (rank <= 0) {
    return <span className={`inline-flex items-center justify-center leading-none ${className}`}>–</span>
  }
  const tier = rank <= 3 ? TIER[rank - 1] : null
  if (!tier) {
    return <span className={`inline-flex items-center justify-center leading-none tabular-nums ${className}`}>{rank}</span>
  }
  return (
    <span
      data-rank-medal={rank}
      className={`inline-flex items-center justify-center rounded-full font-bold leading-none text-[#0c0806] ${className}`}
      style={{ background: tier.bg, boxShadow: `inset 0 0 0 1px ${tier.ring}, 0 1px 3px rgba(0,0,0,0.5)` }}
    >
      {rank}
    </span>
  )
}