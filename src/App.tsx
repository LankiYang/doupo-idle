import { useState } from 'react'
import Header from './components/Header'
import RosterView from './components/RosterView'
import CombatView from './components/CombatView'
import RecruitView from './components/RecruitView'
import AlchemyView from './components/AlchemyView'
import LabView from './components/LabView'
import EquipmentView from './components/EquipmentView'
import LeaderboardView from './components/LeaderboardView'

type Tab = 'roster' | 'combat' | 'recruit' | 'alchemy' | 'lab' | 'equipment' | 'leaderboard'

const TABS: { id: Tab; label: string }[] = [
  { id: 'roster', label: '阵容' },
  { id: 'combat', label: '战斗' },
  { id: 'equipment', label: '装备' },
  { id: 'recruit', label: '结拜' },
  { id: 'alchemy', label: '丹房' },
  { id: 'lab', label: '天梯塔' },
  { id: 'leaderboard', label: '群雄榜' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('roster')

  return (
    <div className="dq-bg flex h-screen w-screen flex-col overflow-hidden">
      <Header />
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
      {tab === 'alchemy' && <AlchemyView />}
      {tab === 'lab' && <LabView />}
      {tab === 'leaderboard' && <LeaderboardView />}
    </div>
  )
}
