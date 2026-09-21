import { useState } from 'react'
import { useGame, game, newbieSteps, newbieCurrent } from '../game/engine'
import { Check } from 'lucide-react'
import Ico from './Ico'

/**
 * 新手之路（v1.32）：开局三步的进度条，挂在 tab 行下面、**全站可见**。
 *
 * 为什么不做成战斗页里的一个面板：第二步在阵容页、第三步在招募页，玩家一跳页就看不到
 * 自己走到哪了，引导就断了。挂在导航条下方，跨页也始终在场。
 *
 * 为什么不做全屏遮罩强制走完：这是挂机游戏，玩家常常开着不动，遮罩会挡住自动战斗的观感；
 * 而且"卡在某一步"的分支要单独处理，测试面比收益大。这里每一步都给一个**立刻能点的按钮**，
 * 愿意自己乱点的玩家也不受阻拦。
 *
 * 三步全部完成时 `newbieSteps` 返回 null，整条自动收起、不再出现。
 *
 * 呼吸灯（v1.32 补）：**同一时刻只亮一处** —— 玩家已经站在目标页时，亮的是页面上那个
 * 真正要按的按钮（由各页面按 `newbieCurrent` 自己加 `dq-breath`）；还没到目标页时，
 * 才亮这条里"带你去"的那个按钮。两处一起亮等于没亮。
 */
export default function NewbiePath({ onNavigate, activeTab }: {
  onNavigate: (tab: 'combat' | 'roster' | 'recruit', focus?: string) => void
  activeTab: string
}) {
  const state = useGame()
  const steps = newbieSteps(state)
  /**
   * 手机端：这条清单**折成一行**，点标题展开成全清单。
   *
   * 用户 2026-09-21 定的全局口径是「手机尺寸下所有页面都要要求一屏展示，不要做整体的下滑」，
   * 而这条是**全站常驻**的（跨页都在），实测在 320px 宽的机器上要占 **109px** ——
   * 它是除内容区之外最大的一块固定开销，比整个 BOSS 立绘还高，而它换来的信息
   * 只是"三步走到哪了"。折成一行 ≈ 32px，一次给**每一页**腾出 77px。
   *
   * ⚠️ 折的只是**排版**，不是内容：三步的 chip 全部照旧渲染在同一个容器里
   *    （`data-newbie-step` / `-done` / `-current` 一个不少），只是没轮到的那几步
   *    在手机上不显示。所以后台探针在任何视口下读到的清单都是完整的 ——
   *    这也是**没有**把清单搬进弹窗的原因：搬进去就得渲染两份，锚点会重复。
   *    展开态是"就地长出来"的绝对定位浮层，同样只有一份 DOM。
   *
   * ⚠️ 当前那一步**永远留在这一行里**（连同它那个「去 ›」按钮）：
   *    那是新玩家在这台手机上要点的第一个东西，让他在"点标题 → 展开 → 再点"里
   *    多走两步，就是把引导的门槛加回去了。
   */
  const [open, setOpen] = useState(false)
  if (!steps) return null
  // 当前步 = 第一个没做完的；它后面的步灰着，不抢注意力。
  // 判据与各页面呼吸灯高亮共用 newbieCurrent，避免两处各判一次而漂掉。
  const currentKey = newbieCurrent(state)?.key
  const doneCount = steps.filter(s => s.done).length

  return (
    // ⚠️ 桌面端仍是**换行**，不横滑。实测（temp/probe-mobile-pages.cjs，375px）：
    // 横滑时「2. 用斗气结晶给一名角色打坐修炼，升到 2 级」被推到屏外 160px ——
    // 而这条是**引导新人的清单**，把第三步藏在滑动之后等于没写。
    // 换成换行之后整条路线一眼看全（代价是竖着多占一两行，而它会随进度自行消失）。
    // ⚠️ `max-md:relative` 只在手机上做浮层的定位基准，桌面不加 `position` ——
    //    全站这么多绝对定位的东西，改动这里的包含块是自找麻烦。
    <div
      data-newbie-path
      className="flex flex-wrap items-center gap-1.5 border-b border-dq-fire/60 bg-dq-fire/10 px-2 py-1.5 max-md:relative max-md:flex-nowrap sm:gap-2 sm:px-4"
    >
      {/* 手机端的标题即折叠开关：一行之内既报进度、又能展开 */}
      <button onClick={() => setOpen(o => !o)} data-newbie-toggle
        className="dq-tap inline-flex shrink-0 items-center gap-1 border-0 bg-transparent p-0 text-[10px] font-bold text-dq-fire md:hidden">
        新手之路 <span className="tabular-nums">{doneCount}/{steps.length}</span>
        <span className={`text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      <span className="hidden shrink-0 text-[10px] font-bold text-dq-fire sm:text-xs md:inline">新手之路</span>
      {/* 三步的 chip 全在这一个容器里。手机上没轮到的那几步 `display:none`（展开时全部露出来） */}
      <div className={`flex flex-wrap items-center gap-1.5 sm:gap-2 ${
        open
          ? 'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-30 max-md:gap-1.5 max-md:border-b max-md:border-dq-fire/60 max-md:bg-dq-panel max-md:p-2 max-md:shadow-lg'
          : 'max-md:min-w-0 max-md:flex-nowrap max-md:overflow-hidden'}`}>
      {steps.map((s, i) => {
        const isCurrent = s.key === currentKey
        // 第一步的按钮直接把仗打起来——玩家点完立刻看到战斗，而不是"跳到战斗页再找按钮"
        const battleBtn = s.key === 'battle' && !state.autoBattle
        // 只在这一条自己就是"下一个动作"时才呼吸（玩家已在目标页时，呼吸灯让给页面上的真按钮）
        const breathHere = isCurrent && activeTab !== s.tab
        return (
          <div
            key={s.key}
            data-newbie-step={s.key}
            data-newbie-done={s.done ? '1' : '0'}
            data-newbie-current={isCurrent ? '1' : '0'}
            className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] max-md:min-w-0 max-md:shrink sm:text-xs ${
              !open && !isCurrent ? 'max-md:hidden' : ''} ${
              s.done ? 'border-dq-border text-[#5a4a38]'
                : isCurrent ? 'border-dq-gold bg-black/40 text-dq-gold'
                  : 'border-dq-border text-[#a89478]'
            }`}
          >
            <span className="shrink-0">
              {s.done
                ? <Check size={12} className="inline text-dq-qing" />
                : <Ico name={s.spr} className="inline h-3.5 w-3.5 align-[-2px]" />}
            </span>
            <span className="max-md:truncate">{i + 1}. {s.text}</span>
            {isCurrent && s.hint && <span className="text-[#a89478]">{s.hint}</span>}
            {/* ⚠️ 上面这个键是新玩家在手机上的**第一个**要点的东西（新手之路的「去…」），
                实测原本只有 19px 高 —— 首次接触就点不中是最坏的一种第一印象。
                加 `dq-tap`（≥640px 不生效，桌面版式不变）。

                ⚠️ `shrink-0 whitespace-nowrap` 是随手机端字号放大一起补的：
                全站字号抬上去之后，这个按钮的四个字在 390px 上放不下，**自己折成了两行**
                （「开启自动出 / 战 ›」）—— 实测截图里一眼就能看到。麻烦的是它旁边那个
                chip 本来就是 `max-md:shrink`，两边都不肯让，最后是按钮断行而不是 chip 省略。
                钉住不换行、且不许被压扁，让步的是 chip（它有 `truncate`，本来就该让）。 */}
            {isCurrent && !s.hint && !(s.key === 'battle' && state.autoBattle) && (
              <button
                data-newbie-action
                onClick={() => {
                  if (battleBtn) game.toggleAutoBattle()
                  else onNavigate(s.tab, s.focus)
                }}
                className={`dq-tap inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded bg-dq-gold px-1.5 py-0.5 text-black hover:opacity-90 ${breathHere ? 'dq-breath' : ''}`}
              >
                {s.action} ›
              </button>
            )}
            {isCurrent && s.key === 'battle' && state.autoBattle && (
              <span className="text-[#a89478]">出战中…</span>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}