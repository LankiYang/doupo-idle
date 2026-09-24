import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame, onboardCurrent, onboardSteps, type OnboardStep } from '../game/engine'
import type { Tab } from '../App'

/**
 * 蒙层式**强制**引导（v1.58）。
 *
 * 用户 2026-09-22 原话：「要**无脑式**的引导……全部用**蒙层引导**，用户必须按照步骤
 * 一步一步来……一步步阻塞引导教玩家怎么开始战斗，然后第一次修炼，第一次装备，
 * 装备升级，然后活动领取，然后战斗爬塔……而且要**强制引导，蒙层式点击**。」
 *
 * ── 它是什么 ─────────────────────────────────────────────────────────────
 * 一整块压暗的遮罩，只在**当前该点的那一个东西**上挖一个洞。除了那个洞，
 * 点什么都没反应（点了洞以外的地方，气泡会晃一下 —— 不是"坏了"，是"点那儿"）。
 * "该点哪"不在这里判，全部来自引擎的 `onboardCurrent(state)`：
 * 蒙层只是那张表的一层皮，表走一步它换一个洞。
 *
 * ── 为什么是"挖四个矩形"而不是给目标加 z-index ──────────────────────────
 * 最直觉的做法是把遮罩设成 `fixed inset-0`，再把目标元素的 z-index 抬上去。
 * **在真实页面上做不到**：目标往往埋在好几层 `overflow` / `position:relative` 的容器里，
 * 这些祖先各自创建层叠上下文，子元素的 z-index 再大也抬不出祖先那一层 ——
 * 于是"洞"要么根本不出现，要么出现的位置对但点不到。
 * 所以这里是**四个矩形围出一个洞**（上/下/左/右各一块），目标所在的那块区域**根本没有东西覆盖**，
 * 点击自然到达真正的按钮 —— 不需要动任何页面的布局或层级。
 *
 * ── 三条它必须守住的东西 ─────────────────────────────────────────────────
 *   ① **不许把玩家关死**。挖洞的目标是"页面上真有一个能点的东西"。找不到时的兜底见
 *      `resolve()`：退回页签本身，而且我们的点击会**带上 `focus` 重新 navigate 一次** ——
 *      那一发常常正好补上缺的状态（最典型的是阵容页右栏没选中角色 ⇒ 整块不渲染）。
 *      连页签都找不到（页面还没挂上）时**整块不渲染**：宁可少盖一帧，也不能盖着不放。
 *   ② **不许改任何页面的布局**。这个组件只读 `getBoundingClientRect()`，一个样式都不往目标上写。
 *      写样式那种做法（比如给目标加个 outline）在目标被卸载时会留下脏样式，
 *      而目标恰恰是会被卸载的（点了它就该换页/换浮层）。
 *   ③ **禁用元素不算目标**。活动页的领奖按钮不可领时是 `disabled`，
 *      挖在它上面就是个死按钮。`firstUsable()` 逐条跳过。
 */

/**
 * 这一步"看着它跑"最多看多久，超过就**永久让路**（蒙层不再盖这一步）。
 *
 * 存在的唯一理由是**不许把玩家关死**：`lab` 那一步的完成判据是"打完第一层"，
 * 而爬塔战败时 `autoLab` 不会自己关（`tick` 会一直重开下一场）⇒
 * **打不过第 1 层的新号会永远停在这一步**，蒙层还挡着他去点撤退。
 *
 * 45 秒的来处：实测挂机战斗打出第一个人头只要 1~2 秒、爬塔一层是十几秒的量级，
 * 45 秒足够让"正常能过"的情况全部走完，又不至于让"过不去"的玩家干等太久。
 *
 * ⚠️ 兜底**刻意写在蒙层这一侧、不写进引擎**：这里要的是"跨本地/远程两种模式一致"。
 *    远程模式下引擎实例在服务端，客户端那个实例根本收不到战败事件 ——
 *    拿引擎内存态当判据会在体验服（远程）静默失效，而失效的样子是"线上还是被关死"。
 */
const RUNNING_GIVEUP_MS = 45000

export default function Onboarding({ onNavigate, activeTab }: {
  onNavigate: (t: Tab, focus?: string) => void
  activeTab: Tab
}) {
  const state = useGame()
  const step = onboardCurrent(state)
  /**
   * 这一帧蒙层长什么样。**只有这一个状态** —— 早先"要不要让路"是渲染时现算的
   * （`const watching = step.watch`），于是它**看不见页面**：既不知道玩家站在哪个页签，
   * 也不知道战斗层/阅读器到底在不在屏幕上，结果是两支各自都能把玩家关死（见 `measure`）。
   */
  const [view, setView] = useState<OnbView | null>(null)
  // 点空处时气泡抖一下。用 `key` 重挂载来**重播**动画（与 StoryView 那段 `key={view}` 同一个手法：
  // 同一个 class 连着加两次，浏览器不会重放）。
  const [nudge, setNudge] = useState(0)
  const prev = useRef('')

  const all = useMemo(() => onboardSteps(state), [state])
  const no = step ? all.findIndex(s => s.key === step.key) + 1 : 0

  // ⚠️ `step` 与 `activeTab` 走 **ref**，不进下面那个 effect 的依赖。
  //    放进去的话：`onboardSteps` 每帧重建一张表（`state` 每 100ms 换一次引用）⇒
  //    effect 每 100ms 拆装一次监听器，而里面那个 `setInterval(measure, 350)`
  //    **永远轮不到自己触发**（每次都被清掉重来）。症状是"定时重测"这一整条静默失效 ——
  //    页面异步长出来的目标（切页那一帧、浮层打开那一帧）从此再也量不到。
  const stepRef = useRef(step)
  stepRef.current = step
  const tabRef = useRef(activeTab)
  tabRef.current = activeTab
  const lastScrollAt = useRef(0)
  /** 「看着它跑」是从什么时候开始的（进 `running` 那一刻打点） */
  const watchSince = useRef(0)
  /**
   * 哪些步**跑太久、已经永久让路**。见 `RUNNING_GIVEUP_MS`。
   * 按 `step.key` 记，跨步骤共享 —— 让过路的步不该在玩家绕回来时又被盖一次。
   */
  const gaveUp = useRef<Set<string>>(new Set())

  // ── 量洞 ────────────────────────────────────────────────────────────────
  // 依赖只有 **步骤 key**：换一步才需要重新开始量。
  // ⚠️ 这里量的是**整帧该长什么样**，不只是洞的矩形 —— "要不要让路"必须和洞一起量，
  //    因为答案取决于**页面上现在有什么**（阅读器开没开、战斗层在不在、玩家在哪个页签），
  //    而这三件事都会在步骤不变的情况下变。
  // ⚠️ `key` 里**要带上"这一步跑起来了没有"**：`battle` / `lab` 两步在这个布尔翻转时
  //    **步骤 key 本身不变**（还是同一步），而 effect 的依赖只有 `key` ⇒ 不带上它的话，
  //    玩家点完「开启自动出战」得等下一个 350ms 周期蒙层才切成"看着它跑" ——
  //    那 350ms 里洞还开在那颗**此刻点下去是「停止出战」**的按钮上，
  //    正是这一版要消灭的那个窗口（见 engine 里 `running` 的长注释）。
  //    带上它 ⇒ running 一变 effect 立刻重跑、`measure()` 立刻跑一次，零延迟。
  const stepKey = step && step.kind === 'do' ? step.key : null
  const key = stepKey ? `${stepKey}|${step?.running ? 'run' : 'idle'}` : null
  useEffect(() => {
    if (!key) { setView(null); prev.current = ''; return }
    let alive = true
    const set = (v: OnbView | null, sig: string) => {
      if (sig === prev.current) return
      prev.current = sig
      setView(v)
    }
    /** 量一次。位置/尺寸没变就**不 setState**（否则每 350ms 白重渲一帧） */
    const measure = () => {
      if (!alive) return
      const s = stepRef.current
      // ⚠️ 比的是**纯 step key**（`stepKey`），不是带 `|run` 后缀的那个 ——
      //    后缀只用来驱动 effect 重跑，不是步骤身份的一部分。
      if (!s || s.kind !== 'do' || s.key !== stepKey) return
      const tab = tabRef.current

      // ── ① 剧情阅读器（或序章那类整屏舞台）正开着 ⇒ **蒙层整个让路** ──────
      // 阅读器是 `fixed inset-0 z-50` 的全屏层，我们的蒙层在 z-70 ⇒ 它在**底下**。
      // 早先这时蒙层照常压 70%、洞挖在"地图上那一格"（阅读器开着，那一格根本不在屏幕上）
      // ⇒ 玩家看到的是一整屏压暗的、**读不了的剧情**。
      // 阅读器自己就是这一步的强制内容（`fixed inset-0` 挡着一切、`onTap` 翻页、
      // 只有"读完按继续/开战"一条路），所以这里不叠第二层；玩家关掉阅读器就会回来。
      if (document.querySelector('[data-story-stage]')) { set({ mode: 'stage' }, `stage:${key}`); return }

      // ── ② 剧情战斗正在自动打 ⇒ 浅压暗 + 一句说明，**不挖洞** ────────────
      // 挖出来的是战斗层底下的地图那一格：点下去打不到、还误导。
      // ⚠️⚠️ 三个条件**缺一不可**，少一个就能把玩家关死（两个都真的发生过）：
      //   · `s.watch`  —— 引擎说这一步是"看着它跑完"的那一步；
      //   · 玩家**正站在这一页** —— 不然一块没有洞的压暗就盖在一个不相干的页面上，
      //     连页签都点不动，"没有地方可以点击"；
      //   · 战斗层**真的在屏幕上** —— `watch` 只是引擎的那份状态（它算的是"还有人站着"），
      //     而"战斗层画出来了没有"是这一帧的事，两者可能不同步。
      //     不成立时一律**退回去挖洞**：那块至少有一个能点的地方，不会把人关死。
      if (s.watch && tab === s.tab && document.querySelector('[data-story-battle]')) {
        set({ mode: 'watch' }, `watch:${key}`)
        return
      }

      // ── ②b ★这一步**自己跑起来了**（挂机出战 / 爬塔）⇒ 同样收成浅压暗 ─────
      // 为什么非切不可（不是审美）：那颗按钮此刻写着「自动出战中（点击停止）」，
      // 洞还开在它上面 ⇒ 玩家"以为没反应"的那第二下正好把它**关掉**。
      // 详见 engine 里 `running` 的长注释 —— 那是真浏览器实测出来的死锁，不是推理。
      // 切走之后洞里没有按钮，玩家点不到，也就关不掉了。
      //
      // ⚠️ 兜底：万一它一直跑不出结果（最典型的是**新号打不过天梯塔第 1 层**，
      //    而爬塔战败时 `autoLab` 不会自己关 ⇒ tick 无限重开），**跑够久就永久让路**。
      //    宁可少教这一课，也不能把玩家关在这一步里出不去 —— 与引擎那边
      //    `activityNothingToClaim` 是同一条理由、同一种处理。
      if (s.running && tab === s.tab) {
        if (gaveUp.current.has(s.key)) { set(null, `giveup:${key}`); return }
        if (!watchSince.current) watchSince.current = Date.now()
        if (Date.now() - watchSince.current > RUNNING_GIVEUP_MS) {
          gaveUp.current.add(s.key)
          set(null, `giveup:${key}`)
          return
        }
        set({ mode: 'watch' }, `watch:${key}`)
        return
      }
      watchSince.current = 0

      // ── ③ 其余：挖一个洞 ───────────────────────────────────────────────
      const next = resolve(s, tab)
      if (!next) { set(null, `none:${key}`); return }
      // 目标在视口外（窄屏上那一排卡片要滚才看得见）：先把它滚进来再量。
      // 为什么必须由我们代劳：遮罩挡着的时候**页面是滚不动的** ——
      // 滚动容器在遮罩底下，手指落在遮罩上，所以"玩家自己往下翻"这条出路不存在。
      // ⚠️⚠️ **横向也要管**（v1.60 补）。页签条是横向滚动的（10 个页签，390px 上放不下），
      //    而它和竖向是同一条理由：**遮罩挡着，横向也滚不动**。
      //    漏掉横向的后果是「去爬天梯塔」那一步在手机上把新号**锁死** ——
      //    实测（2026-09-22，390×844 真浏览器）洞开在 `x=401,w=68`，整块都在屏幕右边外，
      //    `elementFromPoint(435,82)` 返回 `null`：**没有任何东西可以点**，而蒙层又不会自己让路。
      //    这不是"玩家往下划一下就好"—— 他划不动。
      // ⚠️ `block` 只在**竖向**真的越界时才给 `center`：横向越界时给 `center` 会顺手把整页纵向
      //    顶一下（`App.tsx` 里那条页签 `scrollIntoView` 的注释记的就是这个坑）。
      // ⚠️ 限流到 1.2 秒一次：`measure` 每 350ms 跑一趟，不限流的话一个
      //    "比视口还高"的目标会让 `scrollIntoView` 一直打（够不着是它的常态）。
      const r0 = next.el.getBoundingClientRect()
      const offV = r0.top < 0 || r0.bottom > window.innerHeight
      const offH = r0.left < 0 || r0.right > window.innerWidth
      if ((offV || offH) && Date.now() - lastScrollAt.current > 1200) {
        lastScrollAt.current = Date.now()
        next.el.scrollIntoView({ block: offV ? 'center' : 'nearest', inline: 'nearest' })
      }
      const r = next.el.getBoundingClientRect()
      // ⚠️ 签名里**带上 `key`**：几何一样的两步是可能的（两步的目标碰巧同样大小、
      //    同一位置），只比几何的话换步那一帧会沿用上一步的洞、不重算。
      set({ mode: 'hole', kind: next.kind, top: r.top, left: r.left, width: r.width, height: r.height },
        `${key}:${next.kind}:${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(r.height)}`)
    }
    measure()
    // 页面是**异步长出来**的：切页那一下、装备详情浮层打开那一帧、活动清单拉回来之后，
    // 目标才出现。所以隔一段时间再量一次，而不是只量首帧就定死。
    const timer = window.setInterval(measure, 350)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [key])

  if (!step || step.kind !== 'do') return null

  // ── `stage`：整屏舞台（剧情阅读器/序章）正开着 ⇒ **我们整个不渲染** ──────
  // 不是"少盖一层"的讲究：阅读器在 z-50、我们在 z-70，盖上去它就在底下，
  // 玩家看到的是一整屏压暗的、读不了的剧情（用户报的就是这个）。
  // `null` 则说明还在量/没量到（`resolve` 也没找到能点的地方）——
  // 没量到就不盖：宁可少盖一帧，也不能盖着不放。
  //
  // ⚠️ 这里的 DOM 直读**不是** `measure` ① 的重复：`measure` 最快 350ms 才跑一趟，
  //    而"点了这一格 ⇒ 阅读器立刻盖上来"是我们**必须马上**让路的时刻。
  //    这一句让它在**下一帧**（引擎每 100ms 一次 `emit`）就撤掉，不必等定时器。
  //    改 ① 的时候这里要一起改（同一个选择器、同一个意思）。
  if (document.querySelector('[data-story-stage]')) return null
  if (!view || view.mode === 'stage') return null

  const vh = window.innerHeight
  const GAP = 12

  if (view.mode === 'watch') {
    // ── 看着它跑（剧情战斗）────────────────────────────────────────────────
    // 不挖洞、不放页签按钮，但仍然**盖住整屏**（点了没别的反应，气泡晃一下）。
    // 压暗刻意**比挖洞那套浅得多**（35% vs 70%）：这一屏玩家要看的就是那场架，
    // 压到看不见等于把"看"这件事也挡掉了。气泡放中上（战场上方那块空处），
    // 不去盖敌人的血条（敌人在战场区底部、我方战报在下面那张卡里）。
    return (
      <div data-onb-root={step.key} data-onb-kind="watch" className="fixed inset-0 z-[70]">
        <div onClick={() => setNudge(n => n + 1)} className="pointer-events-auto absolute inset-0 bg-black/20" />
        <Bubble nudge={nudge} k={step.key} no={no} total={all.length} title={step.title}
          style={{ maxWidth: '20rem', width: 'calc(100vw - 1.5rem)', top: Math.round(vh * 0.32) }}>
          {/* 跑起来那一刻该说的**不是**"点它" —— 那颗按钮现在点下去是反效果 */}
          {step.runningBody ?? step.body}
        </Bubble>
      </div>
    )
  }

  const { kind, top, left, width, height } = view

  // 洞开在屏幕上半部分 ⇒ 气泡放下面（反过来也一样）。判据是"哪边剩下的地方多"，
  // 而不是目标本身在上还是在下 —— 目标很高的时候这两种说法会打架。
  const below = top < vh * 0.45
  // 压暗的浓度。v1.61 由 70% 调到 45% —— 用户 2026-09-22「蒙层你可以透明度高一点」。
  // ⚠️ 别再往上加回去：这块遮罩**同时是"点别的没反应"的来源**，压到 70% 时底下的界面
  //    基本看不清，玩家会以为自己卡住了（第 4 步那个死锁就是这么被放大的：
  //    他看不清战斗在打，才去点第二下）。
  const dim = 'bg-black/45'

  return (
    <div data-onb-root={step.key} data-onb-kind={kind} className="pointer-events-none fixed inset-0 z-[70]">
      {/* ── 四块压暗。它们**不是**装饰：除了中间的洞，所有点击都由它们吃掉。 ── */}
      {[
        { top: 0, left: 0, right: 0, height: Math.max(0, top) },
        { top: top + height, left: 0, right: 0, bottom: 0 },
        { top, left: 0, width: Math.max(0, left), height },
        { top, left: left + width, right: 0, height },
      ].map((r, i) => (
        <div key={i} onClick={() => setNudge(n => n + 1)}
          className={`pointer-events-auto fixed ${dim}`} style={r} />
      ))}

      {/* ── 洞口的金边。`pointer-events-none`：它**不能**挡住点击，洞的意义就是让点击穿过去。
           `data-onb-hole` 是给判据用的锚：**"此刻有没有洞、洞开在哪"是可断言的一件事**，
           而金边正好是那个洞在 DOM 里的唯一形状（气泡与压暗块都不含这个信息）。 ── */}
      <div data-onb-hole={kind} className="pointer-events-none fixed z-[71] rounded-md border-2 border-dq-goldBright dq-onb-pulse"
        style={{ top: top - 3, left: left - 3, width: width + 6, height: height + 6 }} />

      {/* ── 洞开在**页签**上时，点它的活儿归我们。 ───────────────────────────
          为什么不放真页签自己接这一发：真页签只会 `navigate(tab)`，**丢掉了 `focus`**，
          而"阵容页右栏没选中角色"这种洞正是要靠 `focus` 才补得上（见 resolve）。
          这块是透明的，玩家看到的是洞里那颗真页签，点下去的却是我们这一发。 */}
      {kind === 'tab' && (
        <button aria-label="前往" data-onb-tab={step.tab}
          onClick={() => onNavigate(step.tab as Tab, step.focus)}
          className="pointer-events-auto fixed z-[71] rounded"
          style={{ top, left, width, height }} />
      )}

      <Bubble nudge={nudge} k={step.key} no={no} total={all.length} title={step.title}
        style={{ maxWidth: '20rem', width: 'calc(100vw - 1.5rem)', ...(below
          ? { top: top + height + GAP }
          : { bottom: vh - top + GAP }) }}>
        {/* "点哪儿"这句话必须跟着**洞开在哪**变 —— 同一句话在两种处境下指的
            **不是同一个东西**，照抄等于指错路。 */}
        {kind === 'tab'
          ? <>{activeTab === step.tab ? '这一页还没准备好，再点一下这个页签。' : <>先点下面的<span className="text-dq-goldBright">「{tabLabel(step.tab)}」</span>。</>}</>
          : kind === 'retry'
            ? '全员脱力了。点「再来一次」，这一场重打。'
            : step.body}
      </Bubble>
    </div>
  )
}

/**
 * 说明气泡。
 *
 * ⚠️ 抽出来是为了让"看它跑"那一支和挖洞那一支**长得一模一样** —— 两处各写一份的话，
 *    改宽度、改动画、改字号这类事就得记住改两遍，而漏掉的那一处不会有任何报错。
 *
 * ⚠️ `key={nudge}` 是**刻意的**：同一个 class 连着加两次浏览器不会重放动画，
 *    换 key 让 React 重挂这个 div，点空处时那句"点这儿"才会真的晃一下。
 */
function Bubble({ k, no, total, title, nudge, style, children }: {
  k: string; no: number; total: number; title: string; nudge: number
  style: CSSProperties; children: ReactNode
}) {
  return (
    <div key={nudge} data-onb-bubble={k}
      className={`pointer-events-none fixed left-1/2 z-[71] -translate-x-1/2 rounded-md border border-dq-gold/70 bg-dq-ink2/95 px-3 py-2 shadow-lg ${
        nudge ? 'dq-hit-shake' : 'dq-rise'}`}
      // 宽度走内联样式而不是 Tailwind 任意值：`w-[calc(100vw-1.5rem)]` 里的减号
      // **两侧必须有空格**，而 Tailwind 靠下划线表示空格（`100vw_-_1.5rem`），
      // 少一个下划线就成了一条浏览器解析不了、静静被丢掉的声明（气泡于是撑满整屏）。
      style={style}>
      <div className="mb-0.5 flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] tabular-nums text-dq-goldDim">{no} / {total}</span>
        <span className="text-sm font-bold text-dq-goldBright">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-[#e6dcc8]">{children}</p>
    </div>
  )
}

/**
 * 这一帧蒙层的形态。**只有这三种**，而且必须**量的时候一起定**（见 `measure`）——
 * 因为"该长什么样"取决于页面上此刻有什么（阅读器开没开、战斗层在不在、玩家在哪个页签），
 * 这些都可能在步骤不变的情况下变。
 *
 *   · `stage` —— 整屏舞台（剧情阅读器 / 序章）开着。它在我们下面，我们**不渲染**。
 *   · `watch` —— 剧情战斗在打。浅压暗 + 一句话，**不挖洞**。
 *   · `hole`  —— 其余。挖一个洞。`kind` = 洞开在什么上（`retry` = 打输了那颗「再来一次」）。
 */
type OnbView =
  | { mode: 'stage' }
  | { mode: 'watch' }
  | { mode: 'hole'; kind: 'anchor' | 'tab' | 'retry'; top: number; left: number; width: number; height: number }

/** 页签的中文名。**只用于气泡文案** —— 真页签文案在 App.tsx 的 TABS 里，两处不一样也不影响功能 */
function tabLabel(tab?: string): string {
  return ({ combat: '战斗', roster: '阵容', equipment: '装备', activity: '活动', lab: '天梯塔', story: '剧情' } as Record<string, string>)[tab ?? ''] ?? tab ?? ''
}

/**
 * 这一帧的洞开在哪儿。**这一处是整套蒙层唯一判断"点哪里"的地方。**
 *
 * 三种情形，按优先级：
 *   ① 他不在该去的页签上 ⇒ 洞开在**那颗页签**上（先教他怎么在页签之间走）。
 *   ② 在页签上 ⇒ 按 `step.anchors` 的顺序找第一个**存在的**目标。
 *      顺序有意义：阅读器开着时该点底栏主按钮，浮层开着时该点浮层里那颗，
 *      都排在"入口"前面（`onboardSteps` 里逐条写了）。
 *   ③ 站在对的页签上却一个都找不到 ⇒ **退回页签**。这一发不是敷衍：
 *      点击会带上 `focus` 重新 `navigate` 一次，而"缺的那块状态"常常正是它补的
 *      （阵容页右栏没选中角色 ⇒ 整块不渲染 ⇒ 修炼那一行根本不存在）。
 */
function resolve(step: OnboardStep, activeTab: Tab): { el: HTMLElement; kind: 'anchor' | 'tab' | 'retry' } | null {
  const tabBtn = (): HTMLElement | null => firstUsable(`[data-tab="${step.tab}"]`)
  if (activeTab !== step.tab) {
    const t = tabBtn()
    return t ? { el: t, kind: 'tab' } : null
  }
  for (const sel of step.anchors) {
    const el = firstUsable(sel)
    // ⚠️「再来一次」要单独认出来：洞开在它上面时气泡得说"重打这一场"，
    //    照抄 step.body（"读完按「开战」"）就是**指着一个不存在的按钮**说话。
    if (el) return { el, kind: el.hasAttribute('data-story-battle-retry') ? 'retry' : 'anchor' }
  }
  const t = tabBtn()
  return t ? { el: t, kind: 'tab' } : null
}

/**
 * 选择器里第一个**能点、看得见**的元素。
 *
 * ⚠️ 跳过禁用元素是必须的，不是讲究：活动页的领奖按钮不可领时是 `disabled`，
 *    挖在它上面 = 给玩家指了一个按不动的按钮，而他只会以为是自己点错了。
 */
function firstUsable(sel: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
    const r = el.getBoundingClientRect()
    // 小于这个尺寸的不是"目标"，是布局里塌掉的空壳（`display:none` 的 rect 全是 0）
    if (r.width < 6 || r.height < 6) continue
    if (getComputedStyle(el).visibility === 'hidden') continue
    return el
  }
  return null
}