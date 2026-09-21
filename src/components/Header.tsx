import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useGame, itemLabel, fmtNum } from '../game/engine'
import { itemSprite } from '../game/icons'
import { isMuted, toggleMuted } from '../game/sound'
import Ico from './Ico'

const SHOW = ['coin', 'crystal', 'herb', 'yuanfen', 'daoling', 'essence', 'xuanjing']

export default function Header() {
  const state = useGame()
  const [muted, setMutedState] = useState(isMuted())
  return (
    <div className="relative flex items-center gap-2 border-b border-dq-border bg-gradient-to-b from-[#241a13] to-[#150f0b] px-2 py-2 sm:justify-between sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="dq-title text-base font-medium sm:text-lg">焚炎异录</div>
        <button onClick={() => setMutedState(toggleMuted())}
          className="dq-tap inline-flex items-center justify-center rounded border border-dq-border px-1.5 py-1 text-[#a89478] transition-colors hover:border-dq-gold hover:text-dq-gold"
          title={muted ? '取消静音' : '静音'}>
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      </div>
      {/* 资源条。
          ⚠️ 手机端**换成换行**，不是横滑。实测（temp/probe-mobile-pages.cjs）：
          320px 的屏上这一条原本是 `overflow-x-auto`，"武魂精血"被推到屏外 30px、
          "玄晶"被推到屏外 68px —— 而横滑这件事**屏幕上没有任何提示**，
          玩家看到的就是"少了一种资源"。7 个资源在小屏上折成两行，谁都看得见。
          ≥640px 恢复成不换行的横排（桌面本来放得下，换行反而把顶栏撑高）。 */}
      <div className="flex min-w-0 flex-1 flex-wrap gap-x-2.5 gap-y-0.5 text-xs sm:gap-4 sm:text-sm">
        {SHOW.map(id => {
          const info = itemLabel(id)
          const n = state.inventory[id] ?? 0
          return (
            <div key={id} className="flex shrink-0 items-center gap-1">
              <Ico name={itemSprite(id)} emoji={info.icon} className="h-4 w-4" title={info.name} />
              <span className="hidden text-[#a89478] sm:inline">{info.name}</span>
              <span className="tabular-nums">{fmtNum(n)}</span>
            </div>
          )
        })}
      </div>
      {state.notice && (
        <div className="dq-panel absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded px-3 py-1 text-xs text-dq-gold sm:text-sm">
          {state.notice}
        </div>
      )}
    </div>
  )
}
