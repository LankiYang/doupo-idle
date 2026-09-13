import { useState } from 'react'
import { useGame, itemLabel, fmtNum } from '../game/engine'
import { isMuted, toggleMuted } from '../game/sound'

const SHOW = ['coin', 'crystal', 'herb', 'yuanfen', 'daoling', 'essence', 'xuanjing']

export default function Header() {
  const state = useGame()
  const [muted, setMutedState] = useState(isMuted())
  return (
    <div className="relative flex items-center gap-2 border-b border-dq-border bg-dq-panel px-2 py-2 sm:justify-between sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="text-base font-medium text-dq-gold sm:text-lg">焚炎异录</div>
        <button onClick={() => setMutedState(toggleMuted())}
          className="rounded border border-dq-border px-1.5 py-0.5 text-xs text-[#a89478] hover:border-dq-gold"
          title={muted ? '取消静音' : '静音'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
      <div className="flex min-w-0 flex-1 gap-2.5 overflow-x-auto text-xs sm:flex-wrap sm:gap-4 sm:text-sm">
        {SHOW.map(id => {
          const info = itemLabel(id)
          const n = state.inventory[id] ?? 0
          return (
            <div key={id} className="flex shrink-0 items-center gap-1">
              <span>{info.icon}</span>
              <span className="hidden text-[#a89478] sm:inline">{info.name}</span>
              <span className="tabular-nums">{fmtNum(n)}</span>
            </div>
          )
        })}
      </div>
      {state.notice && (
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-dq-border bg-dq-panel px-3 py-1 text-xs text-dq-gold shadow sm:text-sm">
          {state.notice}
        </div>
      )}
    </div>
  )
}
