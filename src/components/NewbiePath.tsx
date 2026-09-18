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
  if (!steps) return null
  // 当前步 = 第一个没做完的；它后面的步灰着，不抢注意力。
  // 判据与各页面呼吸灯高亮共用 newbieCurrent，避免两处各判一次而漂掉。
  const currentKey = newbieCurrent(state)?.key

  return (
    <div
      data-newbie-path
      className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-dq-fire/60 bg-dq-fire/10 px-2 py-1.5 sm:gap-2 sm:px-4"
    >
      <span className="shrink-0 text-[10px] font-bold text-dq-fire sm:text-xs">新手之路</span>
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
            className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] sm:text-xs ${
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
            <span>{i + 1}. {s.text}</span>
            {isCurrent && s.hint && <span className="text-[#a89478]">{s.hint}</span>}
            {isCurrent && !s.hint && !(s.key === 'battle' && state.autoBattle) && (
              <button
                data-newbie-action
                onClick={() => {
                  if (battleBtn) game.toggleAutoBattle()
                  else onNavigate(s.tab, s.focus)
                }}
                className={`rounded bg-dq-gold px-1.5 py-0.5 text-black hover:opacity-90 ${breathHere ? 'dq-breath' : ''}`}
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
  )
}