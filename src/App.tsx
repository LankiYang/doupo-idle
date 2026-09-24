import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import RosterView from './components/RosterView'
import CombatView from './components/CombatView'
import RecruitView from './components/RecruitView'
import ShopView from './components/ShopView'
import LabView from './components/LabView'
import EquipmentView from './components/EquipmentView'
import LeaderboardView from './components/LeaderboardView'
import SaveView from './components/SaveView'
import Onboarding from './components/Onboarding'
import StoryGate from './components/StoryGate'
import StoryView from './components/StoryView'
import MailBox from './components/MailBox'
import Ico from './components/Ico'
import { buffSprite } from './game/icons'
import WorldBossTab, { WB2_TAB_ON } from './components/WorldBossTab'
import ActivityView from './components/ActivityView'
import Advisor from './components/AdvisorView'
import { useGame, game } from './game/engine'
import { SHOP_BUFFS } from './game/data'
import { startCloudSync } from './game/saveApi'
import { startWorldBossSync } from './game/worldboss'
import { startWorldBoss2Sync } from './game/worldboss2'

export type Tab = 'story' | 'roster' | 'combat' | 'boss' | 'activity' | 'recruit' | 'shop' | 'lab' | 'equipment' | 'leaderboard' | 'save'

/**
 * 顺序即优先级。**战斗排第一**（v1.32）：这是个挂机游戏，战斗页是主屏——
 * 玩家的核心循环（看着它打、变强、再打）都发生在这一页；阵容/装备是"配置屏"，
 * 只有想调整时才去。原先默认停在阵容页，新玩家打开游戏看到的是一屏静止的配置项。
 *
 * ⚠️ **两只世界 Boss（集结讨伐 / 连线讨伐）自 v1.52 起合并成一个顶层页签「世界boss」**
 *    —— 用户 2026-09-20：「两个世界boss合并到一起，共用一个入口叫世界boss。内部分tab就行」。
 *    合并前它们是两个平级页签：十一个页签在窄屏上要横向滚两屏才够得着第二只，
 *    而玩家眼里这本来就是"同一个世界 Boss、两种打法"。子页签实现在 `components/WorldBossTab.tsx`。
 *    ⚠️ **子页签的清单必须留在那个文件里，绝不能写进本文件** ——
 *    `temp/verify-newbie-flow.cjs` 是用 `/\{\s*id:\s*'([^']+)'\s*,\s*label:/g` 扫**本文件**
 *    取"顶层页签清单"、再和真站点上的页签条逐一对账的。子页签写进来会被当成顶层页签，
 *    锚点当场红 —— 而它红的形态是"页签清单对不上"，看着像产品坏了。
 *
 * ⚠️ **第二只玩法（连线讨伐）仍受 `VITE_WB2` 控制、默认开**，判据语义与 v1.47 起一字未变，
 *    只是从"少一个页签"变成"少一个子页签"（只剩一个子页签时连子页签条都不渲染）。
 *    默认开（`!== '0'`）是**刻意的**：体验服此刻已经在跑带这个玩法的产物，回归脚本的三份
 *    夹具产物、`verify-link-ui` / `probe-mobile-pages` 也都依赖它 —— 默认关掉的话，它们会
 *    **静默少测一整套连连看**（红的不是代码，是那一行）。代价是"以后构建正式服忘了带
 *    `VITE_WB2=0`"会把玩法悄悄放出去 —— 所以正式服部署一律走 `temp/deploy-prod-*.sh` 里
 *    那条固定命令，别手敲 `npm run build`。
 */
const TABS_ALL: { id: Tab; label: string }[] = [
  { id: 'combat', label: '战斗' },
  // ⚠️ 「旅程」这一格 v1.60 **已撤**（用户 2026-09-22：「**旅程也不要了，就只剩蒙层引导**，
  //    引导去 tab 里面的战斗模块，**不要自己单独做个旅程模块的战斗**」）。
  //    撤掉的只是**入口**，`StoryView` 与全部剧情内容一个字没删 ——
  //    门留在战斗页那条状态行上（`data-onb="story-door"`），是条随时可点的细线。
  //    这就是"弱剧情"：它不再占打头的第二格，但也没有消失。
  //    ⚠️ 别把下面 `tab === 'story'` 那条渲染分支一起删掉 —— 删了那扇门就指向一片空白。
  { id: 'roster', label: '阵容' },
  { id: 'equipment', label: '装备' },
  // 世界 Boss 的合并入口：里面是「集结讨伐」+「连线讨伐」两个子页签。
  // 标签**按玩法大类命名**、不按 Boss 名字 —— Boss 名字还在改，玩法不会变。
  { id: 'boss', label: '世界boss' },
  { id: 'activity', label: '活动' },
  { id: 'recruit', label: '招募' },
  { id: 'shop', label: '商城' },
  { id: 'lab', label: '天梯塔' },
  { id: 'leaderboard', label: '群雄榜' },
  { id: 'save', label: '存档' },
]

/**
 * 世界 Boss 的全局接线（**两只**）：启动全服轮询。
 *
 * 放在 App 而不是讨伐页里，理由与第一只当初相同：轮询一旦挂上就**不该因为切页而停** ——
 * 挂机游戏里"我去看了眼背包，回来发现血条是十分钟前的"是没法解释的行为。
 * 单独一个小到只订阅不渲染的组件：让 useGame 的重渲止步于此，不至于带着整棵 tab 树一起重渲。
 *
 * ⚠️ **第二只也要在这里启动**（`startWorldBoss2Sync`）—— 那里面除了每分钟一跳，
 *    还挂了 `visibilitychange`（切回前台补拉一次）。只在 `WorldBoss2View` 里启动的话，
 *    从没点开过那一页的玩家连这条监听都没挂上。
 *
 * 注：这里**不再注入战力**。用户定的是"集结讨伐不要有战力加成"，伤害只看消掉几格
 * （见 game/worldboss.ts 的文件头）。战力那条线拆掉之后，这个组件连 useGame 都不需要了。
 */
function WorldBossWiring() {
  // ⚠️ 第二只在后端还没有时（`VITE_WB2=0`）**连轮询都不要挂** —— 否则正式服上每分钟
  //    都有一条注定 404 的请求，白白往控制台刷错误、也浪费玩家的流量。
  useEffect(() => {
    startWorldBossSync()
    if (WB2_TAB_ON) startWorldBoss2Sync()
  }, [])
  return null
}

/**
 * 远程模式的两条状态条（SPEC §4.6）：**未登录** / **断线**。
 *
 * ⚠️ 这一条不是装饰，是**断线语义的一部分**：远程模式下断线时页面**不会**退回本地算账
 *    （那正是这一整轮要拆掉的绕过口），所以数字会**冻住**。没有这条横幅的话，玩家看到的是
 *    "数字不动了、点了没反应"，只会以为游戏坏了 —— 必须有人告诉他"是网断了，不是在算账"。
 *
 * ⚠️ 本地模式（`remote` 为 false）下这个组件渲染 `null`：老玩法里根本没有"服务端状态"这回事。
 *    用 `game.remoteStatus()` 而不是往 `state` 里塞字段 —— `state` 与云档同构是回滚红线。
 */
function RemoteBar() {
  useGame()
  const st = game.remoteStatus()
  if (!st.remote) return null
  const text = st.needLogin ? '登录状态已失效，请到「存档」页重新登录' : st.down ? '重连中…' : ''
  if (!text) return null
  return (
    <div data-remote-bar={st.needLogin ? 'need-login' : 'down'}
      className="shrink-0 border-b border-dq-border bg-black/40 px-2 py-0.5 text-center text-[10px] text-dq-fire sm:px-4 sm:text-xs">
      {text}
    </div>
  )
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
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  // 全局自动云备份。⚠️ **远程模式下没有"上报"这回事**：状态在服务端，客户端只渲染它，
  // 这条链路上一个字节都不往回传（`startCloudSync` 只管 `POST /save` 那一套）。
  useEffect(() => { if (!game.isRemote()) startCloudSync() }, [])
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
  // 页签条在小屏上是**横向滚动**的（10 个页签，320px 机型一屏只放得下 5 个）。
  // 手指点页签时那个页签本来就在视野里，但**程序化切页**（新手之路的"去强化"、战斗页的跳转）
  // 不是 —— 落地后当前页签停在屏幕外，玩家看不到高亮、也不知道自己在哪一页。
  // `block: 'nearest'` 是必须的：不给它，`scrollIntoView` 会连**整页纵向**一起滚，
  // 切个页把页面顶到别处去。
  useEffect(() => {
    tabBarRef.current?.querySelector<HTMLElement>('[data-tab-active="1"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  return (
    // ⚠️ `h-screen` 是 `100vh` —— 手机上它是**大视口**的高度（地址栏收起时那个值），
    //    比真正看得见的高度大一截。外壳又是 `overflow-hidden`，于是每页底部被裁掉、
    //    而且**滚不到**（2026-09-21 用户报「尺寸坏了 / 够不着」）。
    //    这里用内联 `100dvh` 覆盖：支持 dvh 的浏览器按"当前可视高度"算，
    //    不支持的会把这条**无效声明丢掉**、自然退回类名上的 `100vh`。
    //    ⚠️ 别改成只写 `h-dvh` 类：Tailwind 生成的顺序不保证压得住 `h-screen`，
    //       内联样式才是稳的。
    <div className="dq-bg flex h-screen w-screen flex-col overflow-hidden" style={{ height: '100dvh' }}>
      <Header />
      <WorldBossWiring />
      <RemoteBar />
      <BuffBar />
      <div ref={tabBarRef} data-tab-bar className="flex items-stretch gap-1 border-b border-dq-border bg-dq-panel px-2 py-1 sm:px-4">
        {/* 只有这一层滚动：tab 多、窄屏放不下时横向滚，而邮箱按钮在滚动区**外面** ——
            运营触点任何时候都要够得着，不能靠"把页签滚到底"去找它。 */}
        <div className="flex flex-1 gap-1 overflow-x-auto whitespace-nowrap">
          {TABS_ALL.map(t => (
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
        {/* 邮箱（v1.33 建、v1.45 挪位）：入口在这一排按钮的**右上角**。
            它不是 tab（点了不切页），所以不能进 TABS 那层 —— 但位置就在同一排的最右端。
            ⚠️ 抽屉是 `fixed inset-0`，从这一层 `overflow-x-auto` 里逃得出去（往上没有任何
               `transform`/`filter`/`contain` 会创建包含块）—— 改动这附近的布局时要留意这条。 */}
        <MailBox />
      </div>
      {/* 常驻「新手之路」条 v1.58 **已删**：用户要求把引导收成一条强制流水线
          （「把原有的那个新手引导代替，全部用蒙层引导」），三步软提示并入
          `onboardSteps`，由下面的 `Onboarding` 蒙层逐步接管。
          ⚠️ 别再把它加回来 —— 一条不拦人的进度条与蒙层并存时，
             两者会给**同一个玩家**两个不同的"现在该做什么"。 */}
      {tab === 'roster' && <RosterView focusId={rosterFocus} onFocusConsumed={() => setRosterFocus(null)} />}
      {/* 剧情页 v1.60：**不再有页签，但这一条必须留着**。
          它是 `StoryView` 唯一的挂载点，战斗页那条「剧情 ›」细线（`data-onb="story-door"`）
          点的就是 `navigate('story')` —— 拆掉它，那扇门后面就是一片空白。
          （`Tab` 类型里的 `'story'` 同理，别顺手清掉。） */}
      {tab === 'story' && <StoryView onNavigate={navigate} />}
      {tab === 'combat' && <CombatView onNavigate={navigate} />}
      {tab === 'equipment' && <EquipmentView />}
      {/* 世界 Boss：合并入口。两只玩法在**组件内部**用子页签切（见 WorldBossTab.tsx）——
          之所以有这个中间层，是为了让顶层页签只有「世界boss」一个，
          而子页签清单又不落进本文件（理由见上面 TABS_ALL 的注释）。 */}
      {tab === 'boss' && <WorldBossTab />}
      {tab === 'activity' && <ActivityView />}
      {tab === 'recruit' && <RecruitView />}
      {tab === 'shop' && <ShopView />}
      {tab === 'lab' && <LabView />}
      {tab === 'leaderboard' && <LeaderboardView />}
      {tab === 'save' && <SaveView />}
      {/* AI 军师云韵（v1.56）。**自包含**：入口悬浮按钮 + 全屏聊天浮层都在组件内部，
          所以它不进 TABS（理由见 AdvisorView 文件头：用户刚把页签从 11 个并到 10 个）。
          ⚠️ 放在 `StoryGate` **之前**：两者都是 `z-50`，同层级下 DOM 靠后的赢 ——
             新手引导就该盖住军师（那期间玩家还不该问"我该练谁"）。 */}
      <Advisor />
      {/* 阻断式新手引导（v1.54）。**放在最后**：它是 `fixed inset-0 z-50`，
          盖住 Header / 页签条 / 当前页 —— 存档里该拦的时候它就该盖住一切。
          老玩家这里每 100ms 白跑一次 `storyGate()`：那是三个字段的判断，可忽略。
          ⚠️ 它**不接管 tick**，被拦住的玩家离线收益照走（见 StoryGate.tsx 文件头）。 */}
      <StoryGate onNavigate={navigate} />
      {/* 蒙层式**强制**引导（v1.58）。**放在最后 = 盖在所有东西之上**（z-[70]，
          比 StoryGate / 军师那两层 z-50 还高）。
          与 StoryGate 的分工是一条线切开的：`onboardCurrent` 返回 `screen` 的那几步
          （序章 / 立誓 / 手册）由 StoryGate 演，返回 `do` 的那几步（去打架 / 去修炼 /
          去装备……）由这里挖洞 —— 同一时刻只可能有一个在渲染（`kind` 二选一）。
          ⚠️ 它只读 `getBoundingClientRect()`，一个样式都不往目标上写（理由见该文件头 ②）。 */}
      <Onboarding onNavigate={navigate} activeTab={tab} />
    </div>
  )
}
