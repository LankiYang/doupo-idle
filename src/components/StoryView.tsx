import { useState, type ReactNode } from 'react'
import {
  useGame, game,
  storyNodes, storyCurrent, storyProgress, storyScript, storyUnlockNode, storyActViews, storyBattleOf,
  type StoryNodeView,
} from '../game/engine'
import { NODE_KIND_LABEL } from '../game/story'
import { castAt, sceneAt } from '../game/vnCast'
import StoryStage, { StageChip, StagePrimary, Typewriter, SpeakerTag } from './StoryStage'
import StoryBattle from './StoryBattle'
import { loadNick } from '../game/nickname'
import { getAuthNick } from '../game/authApi'
import type { Tab } from '../App'

/**
 * 「旅程」页（v1.54 建，v1.55 重排）：第一章的**四幕**节点地图 + 剧本阅读器 + 剧情战斗。
 *
 * ── 和阻断式引导的分工 ────────────────────────────────────────────────
 * `StoryGate` 只管**开场那一段**（序章 → 立誓 → 手册），走完就永久退场。
 * 这一页是**之后**玩家自己回来的地方：地图上十六格，打到哪格亮哪格。
 * 两者共用 `storyNodes()` 的判定和 `StoryStage` 的皮，但**状态各管各的**。
 *
 * ── v1.55 的三处改动 ──────────────────────────────────────────────────
 *   ① **按幕分组**（用户：「每一章都要经历起承转合」）—— 不再是十六张平铺的卡，
 *      而是四组，每组带节拍（起/承/转/合）、这一幕要干什么、以及做完了几格。
 *   ② **战斗格不再是"去打主线第 N 关"**（用户：「剧情的战斗不和主线战斗耦合」）——
 *      它现在是「开战」，打的是这一格自己的人（`node.combat`），赢了也只完成这一格。
 *   ③ **战斗前先读一段台词** —— 四个战斗格都写了前置剧本（剧本在 `story.ts` 的 SCRIPTS），
 *      读完最后一句那颗按钮从「收下」变成「开战」。这是视觉小说的常规节奏：
 *      先给动机，再动手；直接甩一个战斗界面会让人不知道自己在打谁。
 *
 * ── 手机端「一屏」怎么落 ──────────────────────────────────────────────
 * 外层 `flex-1 min-h-0` 吃满剩余高度，**只有中间那张列表滚**（`overflow-y-auto`）。
 * 顶部章节条与底部提示都是 `flex-none`。文档本身永远不滚 —— 见
 * `memory/doupo-mobile-onescreen.md` 那条硬约束。
 */
export default function StoryView({ onNavigate }: { onNavigate: (t: Tab, focus?: string) => void }) {
  const state = useGame()
  const nodes = storyNodes(state)
  const acts = storyActViews(state)
  const prog = storyProgress(state)
  // 「当前该读的那一格」：**从引擎取，不在这里再扫一遍** —— `storyCurrent()` 与
  // `storyActViews()` 里算 `active` 用的是同一句（`ready && !done`），两处各写一份的话
  // "高亮的幕"和"呼吸的那张卡"迟早会分家（比如以后加了分支或回看）。全章至多一个。
  const cur = storyCurrent(state)
  // 正在读的那一格（null = 没在读）。读完由阅读器自己决定是领奖还是开战
  const [reading, setReading] = useState<string | null>(null)
  const sb = storyBattleOf(state)

  // 剧情战斗是**全屏覆盖**，优先级最高：它在跑的时候玩家不该看到地图（也点不到，
  // 但那样会让"我明明点了没反应"这种事发生 —— 覆盖层挡着才是诚实的做法）。
  if (sb) {
    const lines = storyScript(sb.nodeId, loadNick() || getAuthNick() || '')
    const node = nodes.find(n => n.id === sb.nodeId)
    return (
      <StoryBattle battle={sb}
        // 架要打在**刚才那个地方**：沿用剧本最后一句的场景，而不是切回默认底
        scene={sceneAt(lines, lines.length - 1) ?? 'wutan'}
        title={node?.title ?? '剧情战斗'}
        onRetreat={() => { game.stopStoryBattle(); setReading(null) }} />
    )
  }
  if (reading) return <ScriptReader nodeId={reading} onClose={() => setReading(null)} />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 顶部章节条 ── */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-dq-border bg-dq-panel/60 px-3 py-2 sm:px-5">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.22em] text-dq-ember sm:text-xs">CHAPTER 1 · 起承转合</div>
          <h2 data-chapter-title className="dq-title text-base text-dq-goldBright sm:text-xl">乌坦城的火</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StageChip active>{prog.done} / {prog.total}</StageChip>
          {/* 解禁点的位置明说。玩家该知道这道戏还要演多久，而不是被一直牵着走 */}
          <span className="text-[10px] text-[#a89478] sm:text-xs">
            走完 {storyUnlockNode()}，引导结束
          </span>
        </div>
      </div>

      {/* ── 节点列表：**只有这一层滚** ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {acts.map(a => <ActBlock key={a.no} act={a} nodes={nodes.filter(n => n.act === a.no)}
            currentId={cur?.id ?? null}
            onRead={setReading} />)}
        </div>
        <p className="mx-auto mt-3 max-w-3xl text-[10px] leading-relaxed text-[#7a6a56] sm:text-xs">
          {/* ⚠️ 这里**不能**写 Markdown 的 `**…**` 加粗 —— JSX 里它就是两个星号，会原样印出来
              （2026-09-22 的截图在手册那一屏抓到过同样的问题）。要强调就上 span。 */}
          剧情战斗与主线<span className="text-[#a89478]">各打各的</span>：它不掉关卡、不记团灭，
          输了重来就是，赢了也只完成这一格。主线那边照常挂机推进 —— 两条线互不干扰。
        </p>
        {/* 给一个去主线的口子。剧情**不再把玩家往主线赶**（耦合已经拆了），
            但"看完这一段想去练练级"是很自然的下一步，让他在原地就能走，
            而不是退出去再自己找 tab。 */}
        <div className="mx-auto mt-2 max-w-3xl">
          <button onClick={() => onNavigate('combat')} type="button" data-story-to-combat
            className="dq-tap rounded border border-dq-border2 px-2.5 py-1 text-[10px] text-dq-gold hover:text-dq-goldBright sm:text-xs">
            去主线战场 ›
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 一幕（起 / 承 / 转 / 合）。
 *
 * 用户 2026-09-22：「每一章都要经历起承转合」。分组不是装饰 ——
 * 它让玩家在打开地图的第一眼就知道**这一章走到哪一拍**了：
 * 「起」刚起头、「转」说明支点快到了、「合」说明这一章要收了。
 * 平铺十六张卡给不出这个信息，只能看出"做了几个"。
 */
function ActBlock({ act, nodes, currentId, onRead }: {
  act: { no: number; beat: string; title: string; brief: string; total: number; done: number; cleared: boolean; active: boolean }
  nodes: StoryNodeView[]
  /** 「现在该做的那一格」的 id（全站至多一个，见 NodeCard 的呼吸灯注释） */
  currentId: string | null
  onRead: (id: string) => void
}) {
  // 空的幕（节点被删光）整块不渲染 —— 一个空标题条比不显示更让人困惑
  if (act.total === 0) return null
  return (
    <section data-story-act={act.no} data-act-beat={act.beat}
      className={`rounded border px-2.5 py-2.5 sm:px-3 ${act.active ? 'border-dq-gold/60 bg-dq-ink2/60' : 'border-dq-border bg-dq-ink2/30'}`}>
      <header className="mb-2 flex items-start gap-2">
        {/* 节拍那个字单独给一块 —— 「起/承/转/合」是这一章的结构，值得一眼认出来 */}
        <span data-act-badge
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border text-sm font-bold ${
            act.cleared ? 'border-dq-qing/60 text-dq-qing'
              : act.active ? 'border-dq-gold bg-dq-gold/20 text-dq-goldBright'
                : 'border-dq-border2 text-dq-goldDim'}`}>
          {act.beat}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="dq-title truncate text-sm text-dq-goldBright sm:text-base">{act.title}</h3>
            <span className="shrink-0 text-[10px] tabular-nums text-[#a89478]">{act.done} / {act.total}</span>
          </div>
          <p className="text-[10px] leading-relaxed text-[#a89478] sm:text-xs">{act.brief}</p>
        </div>
      </header>
      <ol className="grid gap-2 sm:grid-cols-2">
        {nodes.map(n => <NodeCard key={n.id} node={n} current={n.id === currentId} onRead={() => onRead(n.id)} />)}
      </ol>
    </section>
  )
}

/**
 * 一格节点。
 *
 * 三种样子，**判据全部来自引擎**（`done` / `locked` / `ready`），这里不重新数一遍：
 *   ① `done`    已领 —— 打勾，没有按钮
 *   ② `locked`  前置没走完 —— 「待开放」，按钮不渲染（渲染了也点不动）
 *   ③ ready     —— `story` 类给「读 ›」，`battle` 类给「开战 ›」
 *
 * ⚠️ v1.54 有第四种「去打第 N 关」，v1.55 随耦合一起删掉了。
 *    那条分支正是"剧情卡在练度上"的来源（引擎里那段注释写了原因），
 *    留着它会让玩家盯着一张写着"去打第 60 关"的卡 —— 而这一格讲的还是三段的萧炎。
 *
 * ── 用户 2026-09-22：「把这种当前该读的章节高亮呼吸灯闪烁」────────────────
 * 指的是**现在就能做的那一格**（`storyCurrent()`，全名见引擎）。它加 `dq-breath`
 * —— 引导呼吸灯那套，**刻意复用而不是新写一个**：那套 CSS 的注释写着
 * "同时亮两处等于没亮，全站任一时刻至多一个元素带这个类"，而这里恰好也是"至多一个"
 * （第一章是一条 `requires` 直链，任何时刻只有一格 ready；模板见 `story.ts`）。
 * 复用还带来一个好处：**"该做什么就喘一下"全站只有一套语言**，
 * 玩家在阵容页认过的那个会喘的按钮，到剧情页是同一个信号。
 *
 * ⚠️ 呼吸灯**不是唯一的信号**：当前那张卡的边框同时升到 `border-dq-gold`。
 *    原因有二 —— ① 只靠动画表达"当前"，对设了"减少动态效果"的人是**什么都看不到**；
 *    ② `dq-breath` 的 5px 外扩圈在两张卡只隔 8px（`gap-2`）时贴得很近，
 *    边框那一档才是"扫一眼就知道是哪张"的那个。
 *
 * ── 「这整个章节卡片都允许点击直接进入 不止那个读按钮」──────────────────
 * `li` 上直接挂 onClick ⇒ **鼠标/手指点哪儿都进得去**（卡片里的空白也算）。
 * ⚠️ **不给它 `role`/`tabIndex`**：卡片里那颗「读 ›」按钮还在，键盘与读屏用户
 *    走的是它 —— 再给整张卡一个 role=button，同一个动作就会在 Tab 顺序里出现两次
 *    （而且 `role=button` 里套 `button` 是嵌套交互元素，读屏会念成两层）。
 *    卡片可点在这里是**指针上的便利**，不是第二条无障碍通路，所以不重复声明。
 * 只有 ready 那一格可点：已领的点进去没有内容，待开放的点进去是空的 ——
 * 两者都不该给"能点"的样子。
 */
function NodeCard({ node, current, onRead }: { node: StoryNodeView; current: boolean; onRead: () => void }) {
  const kindLabel = NODE_KIND_LABEL[node.kind]
  const clickable = !node.done && !node.locked
  return (
    <li data-story-node={node.id}
      data-node-state={node.done ? 'done' : node.locked ? 'locked' : 'ready'}
      data-node-current={current ? 'true' : 'false'}
      onClick={clickable ? onRead : undefined}
      className={`flex items-start gap-2 rounded border px-2.5 py-2 ${
        node.done ? 'border-dq-border bg-dq-ink2/40'
          : node.locked ? 'border-dq-border bg-dq-ink2/30 opacity-60'
            : current ? 'dq-breath border-dq-gold bg-dq-ink2/70'
              : 'border-dq-border2 bg-dq-ink2/70'} ${clickable ? 'cursor-pointer' : ''}`}>
      <span className={`mt-0.5 shrink-0 text-xs tabular-nums ${node.done ? 'text-dq-qing' : 'text-dq-goldDim'}`}>
        {node.done ? '✓' : node.id}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-sm ${node.done ? 'text-[#7a6a56]' : 'text-[#e6dcc8]'}`}>{node.title}</span>
          <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
            node.kind === 'battle' ? 'border-dq-fire/60 text-dq-fire' : 'border-dq-border2 text-[#a89478]'}`}>
            {kindLabel}
          </span>
        </div>
        <div className="text-[10px] leading-relaxed text-[#a89478] sm:text-xs">{node.brief}</div>
      </div>

      {!node.done && (
        <div className="shrink-0 self-center">
          {node.locked
            ? <span className="text-[10px] text-[#7a6a56] sm:text-xs">待开放</span>
            : <CardBtn onClick={onRead} data-node-act={node.kind === 'battle' ? 'fight' : 'read'} gold={node.kind === 'battle'}>
                {node.kind === 'battle' ? '开战 ›' : '读 ›'}
              </CardBtn>}
        </div>
      )}
    </li>
  )
}

function CardBtn({ children, onClick, gold, ...rest }: {
  children: ReactNode; onClick: () => void; gold?: boolean; [k: `data-${string}`]: string
}) {
  return (
    // ⚠️ `stopPropagation`：这张卡整张也可点（见 NodeCard），按钮的点击会冒泡到 `li`，
    //    不拦的话同一个动作走两遍。现在"读/开战"这一发只从这里出，
    //    卡片的 onClick 只管**按钮以外**的那些区域。
    <button onClick={e => { e.stopPropagation(); onClick() }} type="button" {...rest}
      className={`dq-tap whitespace-nowrap rounded border px-2 py-1 text-[10px] sm:text-xs ${
        gold ? 'dq-btn dq-btn-gold font-bold' : 'border-dq-border2 text-dq-gold hover:text-dq-goldBright'}`}>
      {children}
    </button>
  )
}

/**
 * 剧本阅读器：**一句一屏**，点一下走一句。
 *
 * ⚠️ 「点一下」有**两个入口**：底栏那颗「继续 ›」和**整屏任意一处**（`onTap`，
 *    用户 2026-09-22 要的）。两个入口都走同一个 `next()` —— 手势那边**不许另写一条**
 *    "直接跳下一句"的捷径，否则打字机没流完时点屏幕会吞掉半句话，
 *    而"点快了会漏字"是这类阅读器最容易被抱怨的一种坏法。
 *    回退入口是底栏的「‹ 上一页」，往回翻不重播打字机（理由见 `prev`）。
 *
 * ── 三个不能改的地方 ────────────────────────────────────────────────
 * ① **逐句推进不走 `/action`**。它只是本机的一个 `idx`，一个字都不往服务器发。
 *    走 `/action` 的话，服务端每个玩家有 `ACTION_MIN_MS = 120` 的全局节流 ——
 *    读得快的人每两句就会被吞掉一次，表现为"点了没反应"。发奖那一发（`claimStoryNode`）
 *    才是真正的 op，也只有它该是 op。
 * ② **关掉就丢进度**。中途退出，下次从第一句重读。这是刻意的：剧本很短（每段七到十七句），
 *    为它往存档里加一个 `readIdx` 字段，代价是迁移、清理、以及"读到一半的档"这种没人想管的状态。
 * ③ **场景与立绘都是"推"出来的，不是逐句写死的**。`sceneAt` 往后继承最近一次显式声明的场景，
 *    `castAt` 从开场推到现在台上站着谁（规则与理由见 `vnCast.ts`）。
 *    直接读 `line.scene` 的话，没标场景的句子会退回默认底，画面每句闪一下。
 *
 * ── 战斗格在这里的收尾不一样 ────────────────────────────────────────
 * `story` 类读完 = 领奖（`claimStoryNode`）；`battle` 类读完 = **开战**
 * （`startStoryBattle`，领奖要等打完）。所以收尾那颗按钮的文案与动作都跟着 `node.kind` 走，
 * 而"读完之后到底发生了什么"由引擎决定 —— 组件不自己发奖、也不自己判胜负。
 */
function ScriptReader({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const state = useGame()
  const [idx, setIdx] = useState(0)
  // 打字机是否已经流完。决定「继续」是"读完这句"还是"下一句"
  const [typed, setTyped] = useState(false)
  // 递增这个数 = 让打字机立刻放全文（见 StoryStage 的 Typewriter）
  const [reveal, setReveal] = useState(0)
  const name = loadNick() || getAuthNick() || ''
  const lines = storyScript(nodeId, name)
  const node = storyNodes(state).find(n => n.id === nodeId)
  const isBattle = node?.kind === 'battle'

  const line = lines[idx]
  const last = idx >= lines.length - 1
  const cast = castAt(lines, idx)
  const scene = sceneAt(lines, idx) ?? 'wutan'

  /** 收尾：**先关再发**（领奖 / 开战）。两者都要走服务端或改全局态，
   *  挡在关闭动作前面的话，玩家会盯着一屏读完的台词等一个网络请求。 */
  const finish = () => {
    onClose()
    if (!node) return
    if (isBattle) {
      // 战斗格：读完只是**开打**，奖励要等打赢（`storyBattleRound` → `storyOnWin` → `claimStoryNode`）
      if (!node.done) game.startStoryBattle(nodeId)
    } else if (!node.done) {
      game.claimStoryNode(nodeId)
    }
  }

  /** 走下一句。⚠️ 打字机没流完时**先读完这一句**，不跳句 —— 视觉小说的惯例，
   *  也是唯一不会让玩家漏掉半句话的做法。 */
  const next = () => {
    if (!typed) { setReveal(r => r + 1); return }
    if (last) { finish(); return }
    setIdx(i => i + 1)
    setTyped(false)
    setReveal(0)
  }

  /**
   * 回上一句（用户 2026-09-22：「给用户一个上一页的按钮」）。
   *
   * ⚠️ 往回翻**不重播打字机**：把这一句直接当"已读"（`setTyped(true)` + 推满 reveal）。
   *    想再看一眼刚才那句的人，要的是那句话，不是再看它一个字一个字流一遍 ——
   *    而"翻回去还得等"会让这颗按钮显得是坏的。
   */
  const prev = () => {
    if (idx === 0) return
    setIdx(i => i - 1)
    setTyped(true)
    setReveal(r => r + 1)
  }

  // 没有剧本（节点表改了、或这一段被清空了）：给一个出口，不许把玩家卡在空屏上。
  // ⚠️ 这里**不能**顺手调 `finish()` —— 那是在渲染过程中改父组件的 state
  //    （React 会警告，而且父组件当场重渲，这一帧的渲染结果就废了）。给颗按钮让他自己点。
  if (!line) {
    return (
      <StoryStage scene={scene} kicker="剧情" title={node?.title}
        footer={<StagePrimary onClick={finish} anchor="1">{isBattle ? '开战 ›' : '回地图 ›'}</StagePrimary>}>
        <p className="text-sm text-[#c9bda6]">这一段暂时没有内容。</p>
      </StoryStage>
    )
  }

  return (
    <StoryStage
      scene={scene}
      kicker={node ? `${node.id} · ${NODE_KIND_LABEL[node.kind]}` : undefined}
      title={node?.title}
      cast={cast}
      // 点屏幕任意处 = 翻下一页（用户 2026-09-22：「在推剧情的时候允许用户点击屏幕
      // 就很能切换下一页」）。手机上底栏那颗「继续」够不着时，翻页不该要求挪手。
      // 落在按钮上的点击不算（见 StoryStage 的 `onTap`）。
      onTap={next}
      topRight={
        <button onClick={finish} type="button" data-script-skip
          className="dq-tap rounded border border-dq-border2 px-2.5 py-1 text-[10px] text-[#d8c8ac] hover:text-dq-goldBright sm:text-xs">
          跳过
        </button>
      }
      chips={
        <>
          {/* 在场人物：立绘已经摆在那儿了，这一排是给"他叫什么"用的 ——
              立绘没有名牌，第一次登场时光看图认不出人。 */}
          {cast.map(c => <StageChip key={`${c.side}:${c.id}`} active={c.speaking}>{c.name}</StageChip>)}
          <StageChip>{idx + 1} / {lines.length}</StageChip>
        </>
      }
      footer={
        <>
          <button onClick={onClose} type="button" data-script-back
            className="dq-btn dq-btn-ghost dq-tap shrink-0 px-2.5 py-2 text-sm sm:px-3">
            ← 回地图
          </button>
          <div className="flex shrink-0 items-center gap-2">
            {/* ⚠️ 第一句没有"上一页"可回 ⇒ 这一颗**不渲染**（不是渲染成灰的）。
                用户 2026-09-22：「点不了就不要展示给用户了」—— 灰按钮占着地方，
                而它想说的是"你已经在第一句了"，这句话在界面上本来就有（右下角 `1 / N`）。
                ⚠️ DOM 顺序：它必须在主按钮**前面** —— `verify-story-1-8.cjs` 与 `diag-story.cjs`
                   都靠 `[data-story-footer] button` 的 `.last()` 取主按钮，插到后面会把它们
                   变成"一直在点上一页"（那种红看起来像产品卡住了）。 */}
            {idx > 0 && (
              <button onClick={prev} type="button" data-script-prev
                className="dq-btn dq-btn-ghost dq-tap px-2.5 py-2 text-sm sm:px-3">
                ‹ 上一页
              </button>
            )}
            <StagePrimary onClick={next} breath={last && typed} anchor="1">
              {!typed ? '继续 ›' : last ? (isBattle ? '开战 ›' : '收下 ›') : '继续 ›'}
            </StagePrimary>
          </div>
        </>
      }
    >
      {/* 旁白（`who` 为空）不挂名牌 —— 给旁白安一个说话人是最常见的舞台腔错误 */}
      <SpeakerTag who={line.who} role={line.role} />
      <Typewriter text={line.text} reveal={reveal} onDone={() => setTyped(true)}
        className={`text-base leading-relaxed sm:text-lg ${line.who ? 'text-[#e6dcc8]' : 'text-[#c9bda6] italic'}`} />
    </StoryStage>
  )
}