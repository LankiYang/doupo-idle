import { useState } from 'react'
import WorldBossView from './WorldBossView'
import WorldBoss2View from './WorldBoss2View'

/**
 * 世界 Boss 的**合并入口**：顶层只有一个页签「世界boss」，两只玩法在这里用子页签切。
 *
 * 用户 2026-09-20：「两个世界boss合并到一起，共用一个入口叫世界boss。内部分tab就行」。
 * 合并前「集结讨伐」「连线讨伐」是两个平级页签 —— 在玩家眼里这本来就是同一个世界 Boss
 * 活动的两种打法，平级摆着等于让页签条多占一格（窄屏上要横滚两屏才够得着第二只）。
 *
 * ⚠️ **子页签的清单必须留在本文件，绝不能挪进 `App.tsx`。**
 *    `temp/verify-newbie-flow.cjs` 是用 `/\{\s*id:\s*'([^']+)'\s*,\s*label:/g` 扫
 *    **`App.tsx`** 来取"顶层页签清单"、再和真站点上的页签条逐一对账的。子页签写进去会被
 *    算成顶层页签，那条锚点当场红 —— 而它红的形态是"页签清单对不上"，看着像产品坏了。
 *
 * ⚠️ **为什么是"一个组件包两只"而不是"在 App 里用 state 切"**：合并层要有自己的 state
 *    （选了哪个子页签），把 state 提升到 App 会让**每次切子页签都重渲整棵页签树**；
 *    而 App 那层还挂着 `useGame()`（引擎每 100ms emit 一次）。放在这里，重渲范围止步于
 *    两只玩法本身。
 *
 * ⚠️ **切子页签会重置盘面（消消乐/连连看的盘是组件 `useState`，不是引擎状态）。**
 *    这不是这一版引入的回归 —— 合并前切顶层页签同样重置，语义一字未变。
 *    真要把盘面做成跨页保留，那是"盘面归引擎"的另一件事，别顺手在这里改。
 *
 * ⚠️ **`VITE_WB2=0` 时（正式服后端 `/worldboss2` 还没部署的那种产物）只剩一个子页签，
 *    此时连子页签条都不渲染** —— 一个只有一项的"分页控件"只会让人以为还有别的页。
 *    这也让"没部署第二只"的正式服产物在这一页上与合并前**视觉完全一致**，除了顶部页签少一个。
 */
export const WB2_TAB_ON = import.meta.env.VITE_WB2 !== '0'

type Sub = 'wb1' | 'wb2'

/** 标签沿用合并前那两个顶层页签名 —— 玩家已经认得它们了，改名等于白送一次困惑 */
const SUBS: { id: Sub; label: string }[] = [
  { id: 'wb1', label: '集结讨伐' },
  { id: 'wb2', label: '连线讨伐' },
]

export default function WorldBossTab() {
  const [sub, setSub] = useState<Sub>('wb1')
  const subs = WB2_TAB_ON ? SUBS : SUBS.slice(0, 1)

  return (
    // 根类名与两只玩法各自的根**逐字相同**（`min-h-0 flex-1 flex-col overflow-hidden`）——
    // 合并层夹在 App 与玩法中间，必须把"撑满剩余高度 + 不把内容顶出屏幕"这套约定原样接住，
    // 否则玩法那层的 `flex-1` 落在一个按内容定高的父级上，整页会被内容顶开。
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {subs.length > 1 && (
        // 次级页签条。**刻意做得比顶层页签条轻**（细字、小内边距、半透明底），
        // 否则两排金底按钮抢眼睛，玩家会分不清哪一排才是"换页面"。
        // ⚠️ 高度是抠过的：这一条要从玩法栏的可用高度里吃掉约 30px，而桌面端盘面刚刚被调大、
        //    手机端盘面本来就贴着"首屏可见率"的红线（见 index.css 里 m3 那几档 clamp 的推导）。
        //    再给它加 `py-2` 之类的，赔的是盘面可见行数。
        <div data-wb-subbar className="flex shrink-0 items-stretch gap-1 border-b border-dq-border bg-black/25 px-2 py-0.5 sm:px-4">
          {subs.map(s => (
            <button key={s.id} onClick={() => setSub(s.id)}
              data-wb-sub={s.id} data-wb-sub-active={sub === s.id ? '1' : '0'}
              className={`shrink-0 rounded border px-3 py-1 text-xs ${
                sub === s.id
                  ? 'border-dq-gold/50 bg-dq-gold/20 text-dq-gold'
                  : 'border-transparent text-[#a89478] hover:text-dq-gold'}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {sub === 'wb1' ? <WorldBossView /> : <WorldBoss2View />}
      </div>
    </div>
  )
}