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
import NewbiePath from './components/NewbiePath'
import MailBox from './components/MailBox'
import Ico from './components/Ico'
import { buffSprite } from './game/icons'
import WorldBossView from './components/WorldBossView'
import ActivityView from './components/ActivityView'
import { useGame, game } from './game/engine'
import { SHOP_BUFFS } from './game/data'
import { startCloudSync } from './game/saveApi'
import { startWorldBossSync } from './game/worldboss'

export type Tab = 'roster' | 'combat' | 'boss' | 'activity' | 'recruit' | 'shop' | 'lab' | 'equipment' | 'leaderboard' | 'save'

/**
 * 顺序即优先级。**战斗排第一**（v1.32）：这是个挂机游戏，战斗页是主屏——
 * 玩家的核心循环（看着它打、变强、再打）都发生在这一页；阵容/装备是"配置屏"，
 * 只有想调整时才去。原先默认停在阵容页，新玩家打开游戏看到的是一屏静止的配置项。
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'combat', label: '战斗' },
  { id: 'roster', label: '阵容' },
  { id: 'equipment', label: '装备' },
  { id: 'boss', label: '集结讨伐' },
  { id: 'activity', label: '活动' },
  { id: 'recruit', label: '招募' },
  { id: 'shop', label: '商城' },
  { id: 'lab', label: '天梯塔' },
  { id: 'leaderboard', label: '群雄榜' },
  { id: 'save', label: '存档' },
]

/**
 * 集结讨伐的全局接线：启动全服轮询 + 自动讨伐。
 *
 * 放在 App 而不是讨伐页里，是因为**自动讨伐不该因为切页而停**——
 * 挂机游戏里"我去看了眼背包，回来发现仗不打了"是没法解释的行为。
 * 单独一个小到只订阅不渲染的组件：让 useGame 的重渲止步于此，不至于带着整棵 tab 树一起重渲。
 *
 * 注：这里**不再注入战力**。用户定的是"集结讨伐不要有战力加成"，伤害只看消掉几格
 * （见 game/worldboss.ts 的文件头）。战力那条线拆掉之后，这个组件连 useGame 都不需要了。
 */
function WorldBossWiring() {
  useEffect(() => { startWorldBossSync() }, [])
  return null
}

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
        return (
          <span key={b.id} className="flex shrink-0 items-center gap-1 text-[10px] text-dq-fire sm:text-xs">
            <Ico name={buffSprite(b.id)} emoji={def.icon} className="h-3.5 w-3.5" />
            <span>{def.name} {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
          </span>
        )
      })}
    </div>
  )
}

export default function App() {
  // 默认落在战斗页（见 TABS 注释）：新玩家第一眼就该看到仗在打
  const [tab, setTab] = useState<Tab>('combat')
  // 新手之路第二步要"跳去阵容页并直接选中那名角色"，否则落地是一张空详情面板（selected 初始为 null）
  const [rosterFocus, setRosterFocus] = useState<string | null>(null)
  useEffect(() => { startCloudSync() }, []) // 全局自动云备份
  /**
   * 订阅一次状态：只为了活动 tab 上那个小红点能跟着 tick 重渲（emit 每 100ms 一次）。
   * 红点的**数**直接问引擎要（claimableCount），不在这里自己数一遍。
   */
  useGame()
  const activityDot = game.claimableCount()

  /** 带意图的跳转：除了切页，还能让目标页落地就选中某个角色 */
  const navigate = (t: Tab, focus?: string) => {
    setRosterFocus(focus ?? null)
    setTab(t)
  }

  return (
    <div className="dq-bg flex h-screen w-screen flex-col overflow-hidden">
      <Header />
      <WorldBossWiring />
      <BuffBar />
      <div data-tab-bar className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-dq-border bg-dq-panel px-2 py-1 sm:px-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => navigate(t.id)} data-tab={t.id} data-tab-active={tab === t.id ? '1' : '0'}
            className={`relative shrink-0 rounded px-2.5 py-2 text-xs sm:px-3 sm:py-1 sm:text-sm ${tab === t.id ? 'bg-dq-gold text-black' : 'text-[#a89478] hover:text-dq-gold'}`}>
            {t.label}
            {/* 有奖可领时的小红点。⚠️ 里面**不放任何文字**（连 aria-hidden 的字符都不放）——
                按钮的无障碍名就是 tab 文案，塞个「•」进去会让 getByRole('button', { name: '活动' })
                这类精确匹配全部落空。一个纯色圆点，对文本断言完全透明。 */}
            {t.id === 'activity' && activityDot > 0 && (
              <span data-act-dot className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-dq-fire" />
            )}
          </button>
        ))}
      </div>
      <NewbiePath onNavigate={navigate} activeTab={tab} />
      {tab === 'roster' && <RosterView focusId={rosterFocus} onFocusConsumed={() => setRosterFocus(null)} />}
      {tab === 'combat' && <CombatView onNavigate={navigate} />}
      {tab === 'equipment' && <EquipmentView />}
      {tab === 'boss' && <WorldBossView />}
      {tab === 'activity' && <ActivityView />}
      {tab === 'recruit' && <RecruitView />}
      {tab === 'shop' && <ShopView />}
      {tab === 'lab' && <LabView />}
      {tab === 'leaderboard' && <LeaderboardView />}
      {tab === 'save' && <SaveView />}
      {/* 邮箱不进 tab 行：它是运营触点，该在任何一页都够得着（入口是右侧那个信封标签） */}
      <MailBox />
    </div>
  )
}
