/**
 * 统一图标体系（v1.44）。
 *
 * 用户原话：「现在网页的 ui 都是纯 css 画的吧，还有 emoj」。
 * emoji 的真实问题有三层，不只是"不好看"：
 *   ① **跨设备字形完全不同** —— 安卓 / iOS / Windows 是三套脸，同一处 UI 在三种机器上是三种样子，
 *      所谓"自己的美术风格"根本立不住；
 *   ② **本机就没有 emoji 字体**（见项目红线⑨），出图与截图里全是一排豆腐块，
 *      而开发时看到的和玩家看到的不一样 = 每次改 UI 都在盲改；
 *   ③ emoji 的**基线、行高、颜色**都由系统决定，没法跟着品阶/职责配色走。
 *
 * 所以这里把图标收口成两件事，别再把字形散在 200 处 JSX 里：
 *   · **有具体形象的东西**（资源、丹药、异火、祝福、装备槽、元素块）→ 生图素材，
 *     统一"深色圆盘 + 鎏金描边"的底盘，全站一套质感。
 *   · **抽象动作**（关闭、箭头、加减、锁定、眼睛…）→ lucide 线性图标，
 *     颜色走 `currentColor`，能跟着按钮的语义色变。
 *
 * ⚠️ **取不到素材绝不崩、绝不留白**：回落到 emoji。
 * 这不是"兜底代码"，是部署纪律 —— 素材与产物两处不同步时（新加了 key 而产物里没那张图），
 * 玩家看到的最坏情况必须只是"这里还是个 emoji"，不能是整页白屏。
 */
import { useState } from 'react'

/** 图标素材：键 = 相对 `src/assets/sprites/` 的无扩展名路径，如 `icons/coin`、`blessings/sword` */
const modules = import.meta.glob('../assets/sprites/{icons,blessings,equip,gems,fx}/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const SPRITES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  // ../assets/sprites/icons/coin.webp → icons/coin
  SPRITES[filePath.replace(/^.*\/sprites\//, '').replace(/\.webp$/, '')] = url
}

/** 这张素材在不在产物里（自检脚本与"缺图不收口"的断言用） */
export function icoSrc(key: string | undefined): string | undefined {
  return key ? SPRITES[key] : undefined
}

/** 产物里一共有多少张图标素材 */
export const ICO_COUNT = Object.keys(SPRITES).length

export default function Ico({ name, emoji, className = '', title }: {
  /** 素材键，如 `icons/coin`；取不到时回落到 emoji */
  name?: string
  /** 回落字形。缺素材时至少还有东西可看 */
  emoji?: string
  className?: string
  title?: string
}) {
  const src = icoSrc(name)
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return emoji ? <span className={className} title={title}>{emoji}</span> : null
  }
  return (
    <img
      src={src}
      alt={title ?? ''}
      title={title}
      draggable={false}
      onError={() => setBroken(true)}
      className={`inline-block select-none object-contain ${className}`}
    />
  )
}