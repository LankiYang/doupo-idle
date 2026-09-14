import { useState, useEffect } from 'react'
import Header from './components/Header'
import RosterView from './components/RosterView'
import CombatView from './components/CombatView'
import RecruitView from './components/RecruitView'
import ShopView from './components/ShopView'
import LabView from './components/LabView'
import EquipmentView from './components/EquipmentView'
import LeaderboardView from './components/LeaderboardView'
import SaveView from './components/SaveView'
import { useGame } from './game/engine'
import { SHOP_BUFFS } from './game/data'
import { startCloudSync } from './game/saveApi'

type Tab = 'roster' | 'combat' | 'recruit' | 'shop' | 'lab' | 'equipment' | 'leaderboard' | 'save'

const TABS: { id: Tab; label: string }[] = [
  { id: 'roster', label: '阵容' },
  { id: 'combat', label: '战斗' },
  { id: 'equipment', label: '装备' },
  { id: 'recruit', label: '结拜' },
  { id: 'shop', label: '商城' },
  { id: 'lab', label: '天梯塔' },
  { id: 'leaderboard', label: '群雄榜' },
  { id: 'save', label: '存档' },
]

/** 生效中的限时增益细条（无增益时不占位） */
function BuffBar() {
  const state = useGame()
  const now = Date.now()
  const active = state.buffs.filter(b => b.expireAt > now)
  if (active.length === 0) return null
  return (
    <div className="flex gap-2 overflow-x-auto whitespace-nowrap border-b border-dq-border bg-black/30 px-2 py-0.5 sm:px-4">
      {active.map(b => {
        const def = SHOP_BUFFS.find(x => x.id === b.id)
        if (!def) return null
        const s = Math.max(0, Math.floor((b.expireAt - now) / 1000))
        return <span key={b.id} className="shrink-0 text-[10px] text-dq-fire sm:text-xs">{def.icon} {def.name} {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
      })}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('roster')
  useEffect(() => { startCloudSync() }, []) // 全局自动云备份

  return (
    <div className="dq-bg flex h-screen w-screen flex-col overflow-hidden">
      <Header />
      <BuffBar />
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-dq-border bg-dq-panel px-2 py-1 sm:px-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 rounded px-2.5 py-2 text-xs sm:px-3 sm:py-1 sm:text-sm ${tab === t.id ? 'bg-dq-gold text-black' : 'text-[#a89478] hover:text-dq-gold'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'roster' && <RosterView />}
      {tab === 'combat' && <CombatView onNavigate={setTab} />}
      {tab === 'equipment' && <EquipmentView />}
      {tab === 'recruit' && <RecruitView />}
      {tab === 'shop' && <ShopView />}
      {tab === 'lab' && <LabView />}
      {tab === 'leaderboard' && <LeaderboardView />}
      {tab === 'save' && <SaveView />}
    </div>
  )
}
