import { useState, useMemo } from 'react'
import { useGame, game, storyGate, prologueActs, handbookSteps } from '../game/engine'
import StoryStage, { StageChip, StagePrimary, SpeakerTag } from './StoryStage'
import { OATH } from '../game/story'
import { loadNick, saveNick, NICK_MAX } from '../game/nickname'
import { submitNick } from '../game/leaderboardApi'
import { getAuthNick } from '../game/authApi'
import type { Tab } from '../App'

/**
 * 阻断式新手引导的**前三个整屏**（v1.54 建，v1.55 换主角，v1.58 并入引导流水线）。
 *
 * 用户 2026-09-21：「我们来做详细的新手引导+剧情，**要阻断式的**」，并给了参考案例
 * （「圣约学院 · 初始之约」）。这个组件对齐案例里"契约日"那一段的三层：
 *   ① 序章六幕（可跳过） ② 立誓落款（唯一的真阻断输入点） ③ 修行手册五步
 *
 * 用户 2026-09-22：「**我要扮演萧炎**」「注意新手要强制进剧情」——
 *   序章六幕整段重写成了**萧炎从天才跌成三段的三年**，「登记」也换成了「立誓」
 *   （主角不需要向谁报名，他需要在一张战书上落款）。
 *
 * ── v1.58 起它只负责"整屏的那几步" ───────────────────────────────────────
 * 用户当天又提：「把原有的那个新手引导**代替**，**全部用蒙层引导**……一步步阻塞引导
 * 教玩家怎么开始战斗、第一次修炼、第一次装备、装备升级、活动领取、爬塔。」
 * 于是引导只剩**一张表**（`engine.ts` 的 `onboardSteps`），每一步是二选一：
 *   · `kind: 'screen'` —— **这个组件**演（序章 / 立誓 / 手册，是一次性的线性剧本）
 *   · `kind: 'do'`     —— `Onboarding.tsx` 挖洞（去点页面上真有的某个东西）
 * `storyGate()` 因此退化成那张表的一个投影（只投影 `screen` 那三步），
 * **它不再返回 `'chapter'`** —— 第四票连同那个 `Chapter` 组件在 v1.58 删了。
 *
 * ── 为什么这三屏**可以**做全屏遮罩 ───────────────────────────────────────
 * 这是挂机游戏，玩家常常开着不动，遮罩会挡住自动战斗的观感（原 `NewbiePath.tsx`
 * 正是拿这条反对遮罩的，那话说得对）。所以这里**没有推翻它，是划清范围**：
 *   · 遮罩只覆盖**一次性、线性的剧本段**（序章 → 立誓 → 手册）。这一段里本来就没有战斗可看，
 *     遮住的是"一个还没开始的游戏"，不是"正在自动战斗的战场"。
 *   · 走到 `STORY_UNLOCK_NODE`（1-4）之后 `finished` 置位，整条引导**永久**返回 null，
 *     玩家再也见不到它（`onboardCurrent` 里那一票否决）。
 *   · "卡在某一步"的分支确实要单独处理，而这里只有**一处**会卡：立誓时名字为空。
 *     那不是 bug，是刻意的（案例里也是这么做的），下面 `fail` 那一段就是它的兜底反馈。
 *
 * ⚠️ 「新手要强制进剧情」这条现在是**整条流水线的性质**，不再是几票相加：
 *   表上第一个没做完的步骤就是当前该做的事，走不到解禁点就一直有一步没做完。
 *   新手**不可能**绕过剧情直接去打架 —— 想打架？表上那一步就把你送去打。
 *
 * ⚠️ 这个组件**不接管战斗**，也不停 tick。玩家被拦在这里的时候，离线收益照走
 *   （`lastProgressAt` 与服务端的挂机结算都不看这个字段）—— 阻断式在挂机游戏里的前提。
 */
export default function StoryGate({ onNavigate }: {
  onNavigate: (t: Tab, focus?: string) => void
}) {
  const state = useGame()
  const gate = storyGate(state)
  if (!gate) return null
  if (gate === 'prologue') return <Prologue />
  if (gate === 'enroll') return <Oath />
  return <Handbook onNavigate={onNavigate} />
}

// ─── ① 序章六幕 ─────────────────────────────────────────────────────────

/**
 * 序章。
 *
 * ⚠️ `view`（现在看到第几幕）是**组件自己的**，`story.prologueAct`（最远看到第几幕）才进存档。
 *    翻回上一幕看是自由操作，不该把进度退回去 —— 否则玩家翻回第 2 幕关掉页面，
 *    下次进来又被从头拦一次。引擎那边 `setPrologueAct` 也只前进不后退，两处一致。
 */
function Prologue() {
  const state = useGame()
  const acts = prologueActs()
  // 初始视图位置 = 存档里"最远看到第几幕"（老玩家不会走到这儿；这里只服务中途退出的新玩家）
  const [view, setView] = useState(() => Math.min(state.story.prologueAct, acts.length))
  const a = acts[view - 1]
  const last = view === acts.length

  /**
   * 翻到第 n 幕。
   *
   * ⚠️ 写进存档的判据是 `v > 已记录`，**不是**"这一幕还没看过"。
   *    最初写的是后者（`if (!seen)`），结果第 1 幕永远满足"已看过"、第 2 幕起永远不写 ——
   *    进度**从头到尾一格没动**，只是最后那颗"走进乌坦城"顺手把它推到 7 才没暴露。
   *    中途退出的玩家会实打实地被从头再拦一遍。
   *    翻回上一幕看是自由操作，不写档（`v > prologueAct` 不成立），进度不倒退。
   */
  const go = (n: number) => {
    const v = Math.max(1, Math.min(acts.length, n))
    setView(v)
    if (v > state.story.prologueAct) game.setPrologueAct(v)
  }
  /** 跳过：直接把进度推到"全部看完"，后面按顺序进登记 */
  const skip = () => game.setPrologueAct(acts.length + 1)
  /** 最后一幕的出口。**必须越过 length**，不能是 `go(length + 1)` —— 那样会被 clamp 回原处，
   *  玩家点完没反应、又只有"跳过介绍"能走，等于把看完六幕的人关在序章里。 */
  const enter = () => game.setPrologueAct(acts.length + 1)

  return (
    <StoryStage
      scene={a.scene}
      kicker={a.kicker}
      title={a.title}
      // 立绘：`PROLOGUE` 每一幕自带 `cast`（谁站在台上）。序章是"一幕一屏"的旁白体，
      // 没有逐句推进，所以这里直接把那一幕的人摆上 —— 不需要 `vnCast` 那套推导。
      cast={a.cast?.map(c => ({ id: c.id, side: c.side, speaking: true, name: '' }))}
      topRight={
        <button onClick={skip} type="button" data-story-skip
          className="dq-tap rounded border border-dq-border2 px-2.5 py-1 text-[10px] text-[#d8c8ac] hover:text-dq-goldBright sm:text-xs">
          跳过介绍
        </button>
      }
      chips={<StageChip>{view} / {acts.length}</StageChip>}
      // 点屏幕任意处 = 翻到下一幕（用户 2026-09-22：「在推剧情的时候允许用户点击屏幕
      // 就很能切换下一页」）。最后一幕那一下与底栏那颗主按钮**是同一个动作** ——
      // 手势翻页不能因为"这是最后一屏"就变成没反应。
      onTap={last ? enter : () => go(view + 1)}
      footer={
        <>
          {/* ⚠️ 第一幕**不渲染**这颗按钮（原来是渲染成灰的）。用户 2026-09-22：
              「点不了就不要展示给用户了」。灰按钮占着底栏一半宽度、把主按钮挤小，
              而它想说的那件事（"没有上一幕"）在第一幕本来就是显然的。
              只在真有上一幕时出现，主按钮于是能吃满整行（`wide`）。 */}
          {view > 1 && (
            <button onClick={() => go(view - 1)} type="button" data-story-prev
              className="dq-btn dq-btn-ghost dq-tap shrink-0 px-3 py-2 text-sm">
              ← 上一幕
            </button>
          )}
          {last
            ? <StagePrimary onClick={enter} breath wide>燃起那点火苗 ›</StagePrimary>
            : <StagePrimary onClick={() => go(view + 1)} wide>下一幕 ›</StagePrimary>}
        </>
      }
    >
      {/* 正文两段 + 一句引用。节奏照案例：段落之间不留空行，引用单独隔开。
          ⚠️ `key={view}` 是**故意的**：换幕时让 React 重建这个 div，好让 `dq-rise`
              的入场动画重播一次。没有它，翻幕时文字是硬切的（场景和立绘都在淡，
              只有正文"啪"地换了，那一下最扎眼）。 */}
      <div key={view} className="dq-rise">
        {a.body.map((p, i) => (
          <p key={i} className="mb-2 text-base leading-relaxed text-[#e6dcc8] sm:text-lg">{p}</p>
        ))}
        <p className="mt-3 border-l-2 border-dq-gold/60 pl-3 text-base text-dq-ember sm:text-lg">「{a.quote}」</p>
      </div>
    </StoryStage>
  )
}

// ─── ② 立誓落款（唯一的真阻断输入点）────────────────────────────────────

/**
 * 立誓落款。
 *
 * 对齐案例的「入学登记」：**名字是空的，主按钮点了没反应**。
 * 这是整套引导里唯一一处"故意不给反馈"，所以必须给出**另一条**反馈路径 ——
 * 点了没反应和点了坏了，在玩家眼里是一模一样的。这里用：
 *   · 按钮本身**不置灰**（灰掉等于告诉他"这条路走不通"，而其实走不通的只有"不填名字"）
 *   · 空着点 → 输入框抖一下 + 一行红字点名说清楚
 *
 * ⚠️ v1.55 从「入门登记」改成「立誓」。主角是萧炎，他不需要向谁报名 ——
 *    但他**需要一个落款**：那张三年之约的战书上得写名字，才作数。
 *    这样玩家填的这一格和主线（三年之约）是同一件事，而不是流程上的一道关。
 *    文案抽在 `story.ts` 的 `OATH` 里（章节地图那边也要引用它，写在两处必然分叉）。
 *
 * ⚠️ 名字**不走存档**，走账号昵称那条唯一写入口（`nickname.ts` + `POST /nickname`，
 *    v1.53 刚收口）。这里只额外记一个"他立过誓了"（`game.setEnrolled()`）。
 *
 * ⚠️ `submitNick` **不等**。断网时它返回 null，这时候**照样放行** ——
 *    昵称的服务端那份是权威副本，本机这份只是缓存（见 nickname.ts 的文件头），
 *    为了一个"榜上还没同步的名字"把玩家卡在开场，是拿最大的代价换最小的收益。
 *
 * ⚠️ `data-story-name` / `data-story-name-fail` 这两个属性**不能改名**：
 *    `temp/story-gate-test.cjs` 靠它们定位输入框与那一行红字。改名 = 静默丢掉两个断言。
 */
function Oath() {
  const [draft, setDraft] = useState(() => loadNick() || getAuthNick() || '')
  const [fail, setFail] = useState('')
  const [shake, setShake] = useState(false)

  const submit = () => {
    const v = draft.trim().slice(0, NICK_MAX)
    if (!v) {
      // 案例里这一步是"点了毫无反应"。我们保留阻断、补上说明 ——
      // 「点了没反应」和「点了坏了」在玩家眼里没有区别，而后者会让他直接关掉游戏。
      setFail(OATH.emptyHint)
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    setFail('')
    saveNick(v)                    // 本机立刻生效（后面几屏的称呼都用它）
    submitNick(v).then(final => {  // 服务端那份是权威，回来了以后者为准
      if (final && final !== v) saveNick(final)
    }).catch(() => { /* 断网就算了：本机这份够用，下次进榜会补上 */ })
    // 这一步之后 `storyGate` 变成 'handbook'，本组件连同遮罩一起被换掉 —— 不用自己收尾
    game.setEnrolled()
  }

  return (
    <StoryStage
      scene="xiao_backhill"
      kicker={OATH.kicker}
      title={OATH.title}
      // 这一幕是药尘让他落款。两个人都站着 —— 左边药尘（说话的是他），右边萧炎握笔
      cast={[
        { id: 'yaochen', side: 'left', speaking: true, name: '药尘' },
        { id: 'xiaoyan_zong', side: 'right', speaking: false, name: '萧炎' },
      ]}
      chips={<StageChip>药尘的话</StageChip>}
      footer={
        <>
          {/* 左边留白：主按钮在右边，和案例一致（案例里主按钮也是右下角那一颗）。
              手机上这行说明收掉（`hidden sm:inline`）—— 「更简单 更明显」，
              底栏只剩那颗要按的按钮。 */}
          <span className="hidden text-[10px] text-[#a89478] sm:inline sm:text-xs">落完款，这张纸才算数</span>
          <StagePrimary onClick={submit} breath wide>{OATH.cta}</StagePrimary>
        </>
      }
    >
      <SpeakerTag who="药尘" role="戒指里的灵魂" />
      {/* `OATH.body` 是两段引子，不必逐字流出（这里不是"角色在说话"，是交代处境）。
          真正的台词只有下面这一句 —— 打字机留给它。 */}
      <div className="dq-rise">
        {OATH.body.map((p, i) => (
          <p key={i} className="mb-2 text-base leading-relaxed text-[#c9bda6] sm:text-lg">{p}</p>
        ))}
      </div>
      <p className="mb-4 border-l-2 border-dq-gold/60 pl-3 text-base text-[#e6dcc8] sm:text-lg">
        「这张纸的末尾，写谁的名字？」
      </p>

      <label className="mb-1 block text-xs text-[#a89478]">道号（最多 {NICK_MAX} 字）</label>
      <input
        data-story-name
        value={draft}
        maxLength={NICK_MAX}
        onChange={e => { setDraft(e.target.value); if (fail) setFail('') }}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder="写一个你认得出的名字"
        autoComplete="off"
        className={`dq-tap w-full max-w-xs rounded border bg-dq-ink2 px-3 py-2 text-base text-[#e6dcc8] outline-none placeholder:text-[#6a5947] ${
          fail ? 'border-dq-fire' : 'border-dq-border focus:border-dq-border2'} ${shake ? 'dq-hit-shake' : ''}`}
      />
      {/* 这一行只在"空着点了"之后出现。它是这一整套引导里唯一的一处错误反馈 */}
      {fail && <div data-story-name-fail className="mt-2 text-xs text-dq-fire">{fail}</div>}
    </StoryStage>
  )
}

// ─── ③ 修行手册五步 ─────────────────────────────────────────────────────

/**
 * 手册：**开场给玩家看的总纲**，看一次就过。
 *
 * 它是引导路线**第一张地图**：这里五步的完成态直接问 `handbookSteps(state)` ——
 * 那个函数又把每一步转问 `onboardSteps`（判据只有一份，不在这儿再数一遍）。
 *
 * ⚠️ **每一步后面的「去打一场 › / 去修炼 › / 去招募 ›」在 v1.55e 全删了**。
 *    用户 2026-09-22：「序章结束的时候，下面有三个选项，**这个点不了**，
 *    点不了就不要展示给用户了」—— 说的就是这三颗。
 *    它们**按下去确实会跳页签**，但这一屏是 `z-50` 的全屏遮罩：跳的是**遮罩背后**那一层，
 *    玩家眼前一个字都没变（手册还是那五步、还是这个遮罩）。
 *    从玩家角度这就是"点了没反应"，而"点了没反应"和"游戏坏了"在他眼里没有区别 ——
 *    这正是组件头上那条注释里反复讲的那件事。
 *    换言之：这一层只要还挂着，它许诺的"带你过去"就**兑现不了**，
 *    所以不是把按钮改成"点了先关掉遮罩"（那等于第 3/4/5 步可以跳过剧情去做，
 *    与「新手要强制过剧情」那四票冲突），而是**别让这一屏许诺它做不到的事**：
 *    五步退回成一张清单（做到哪步在哪步），唯一的出口是底栏那颗「开始第一章 ›」。
 */
function Handbook({ onNavigate }: { onNavigate: (t: Tab, focus?: string) => void }) {
  const state = useGame()
  const steps = useMemo(() => handbookSteps(state), [state])
  const doneCount = steps.filter(s => s.done).length

  return (
    <StoryStage
      scene="wutan"
      kicker="修行手册"
      title={`${loadNick() || getAuthNick() || '你'}，接下来这五件事`}
      chips={<StageChip active>{doneCount} / {steps.length} 已完成</StageChip>}
      footer={
        <>
          <span className="hidden text-[10px] text-[#a89478] sm:inline sm:text-xs">每一步都会把你带到下一个目标。</span>
          {/* v1.55d：出口从「战斗页」改成「剧情页」。
              手册一关，`storyGate` 立刻变成 'chapter'（第四票）⇒ 送去战斗页会被当场挡住，
              玩家看到的是"点了按钮、屏幕闪了一下又回来"，比不给按钮还费解。
              直接送到我们本来就要他去的地方。
              ⚠️ v1.60：那一票已经并进蒙层流水线（`storyGate` 只是 `onboardSteps` 的投影），
              而且用户把「旅程」页签撤了（「**旅程也不要了，就只剩蒙层引导**」）——
              所以这里**改回战斗页**：手册之后接的就是引导第①步「让战斗自己跑起来」，
              而战斗页正是那一步挖洞的地方。送到剧情页反而会让人以为还得先读剧本。 */}
          <StagePrimary onClick={() => { game.markHandbook(); onNavigate('combat') }} breath wide>
            开始战斗 ›
          </StagePrimary>
        </>
      }
    >
      {/* ⚠️ 这里不能用 Markdown 的 `**…**` 加粗 —— JSX 里它就是两个星号，会**原样印出来**
          （第一版截图里真的印着「你负责**战前那两件事**」）。要强调就上 span。 */}
      {/* ⚠️ **这一屏刻意不跟字号**（v1.59：序章、立誓、阅读器那三处都提到了 16px）。
          理由：手册这五步在最小那档手机上必须**一屏放得下**（下面那段注释有实测数字），
          14px→16px 会让每行多占一截，第 05 步就得划一下才看得见。
          用户报的是"剧情对话气泡字小" —— 那是阅读器与序章/立誓；这一屏是**操作清单**，不是对话。
          真要动它，先改 `verify-story-fix.cjs` 的 B1 并写清为什么。 */}
      <p className="mb-2 text-sm leading-relaxed text-[#e6dcc8] sm:mb-3 sm:text-base">
        战斗是自动打的，你负责<span className="text-dq-goldBright">战前那两件事</span>：把人放在对的位置上，然后把等级抬够。
      </p>
      {/* ⚠️ 手机上五步**尽量一屏放得下**（卡高 `h-[38dvh]`）。实测（`temp/probe-vn-mobile.cjs`，
          它会把"卡片高/内容高/超出多少"打出来）：
            390×844 → 卡 320px，内容 305px ⇒ **放得下**（不压的时候是 377px，超出 57px）
            375×667 → 卡 252px ⇒ 还差 52px，**要划一下才看得见第 05 步**
          这 57px 是这么抠出来的：行内边距 6→4px（省 20）、行间距 6→4px（省 8）、
          说明段下边距 12→8（省 4）、做完的那两行不显示 why（省 32）。共 64px。
          ⚠️ **别再打"这一屏把卡加高"的主意**（试过 `h-[46dvh]`，撤了）：
          `verify-story-fix.cjs` 的 B1 量的正是"各屏卡高必须只有一个值"，
          那是用户明说过的要求（「对话框的高度固定，不要让高度变化 然后整个屏幕都变」），
          而它换来的只是"最小那档手机少划一下"。真要动，先改 B1 并写清为什么。 */}
      <ol className="space-y-1 sm:space-y-1.5">
        {steps.map(s => (
          <li key={s.no} data-handbook-step={s.no} data-handbook-done={s.done ? '1' : '0'}
            className="flex items-start gap-2 rounded border border-dq-border bg-dq-ink2/60 px-2 py-1 sm:px-2.5 sm:py-1.5">
            <span className={`shrink-0 text-xs tabular-nums ${s.done ? 'text-dq-qing' : 'text-dq-goldDim'}`}>
              {s.done ? '✓' : s.no}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm ${s.done ? 'text-[#7a6a56] line-through' : 'text-[#e6dcc8]'}`}>{s.title}</span>
              {/* ⚠️ 手机上**做完的那几步不显示这句说明**（`hidden sm:block`）。
                  理由不是省地方，是它已经没用了：那一行的勾和删除线已经说完了
                  "这件事你干完了"，再补一句"为什么要干"只会让这一屏更长。
                  尺寸依据见下面那段注释 —— 手机上这 5 行必须**一屏放得下**，
                  够不着的那一行等于没写。 */}
              <span className={`text-[10px] text-[#a89478] sm:block sm:text-xs ${s.done ? 'hidden' : 'block'}`}>{s.why}</span>
            </span>
          </li>
        ))}
      </ol>
    </StoryStage>
  )
}

// ─── ④ 第一章向导（v1.55d 的第四票，**v1.58 已删**）──────────────────────
//
// 原来这里是一个 `Chapter` 组件：手册看完之后压一张"先看完这一段"的全屏卡，
// 玩家在剧情页上时让路（`activeTab === 'story'` ⇒ 不渲染），否则一直盖着。
//
// v1.58 用户要求把整条引导收成**一条蒙层流水线**（原话见 `engine.ts` 的 `OnboardStep`），
// 第一章那几格于是不再是这一层特殊照顾的对象，而是那张表里的四个普通步骤
// （`node:1-1` … `node:1-4`，由节点表生成）。它们现在由 `Onboarding.tsx` 挖洞 ——
// 洞开在**具体那一格**上，比原来那张"进入剧情 ›"的卡精确得多：
// 原来玩家点进去还要自己找该读哪一格，现在地图上只有一格是亮的。
//
// ⚠️ 别再把它加回来。`storyGate` 已经**不会再返回 'chapter'**（它只是 `onboardSteps`
//    的一个投影，只投影 `screen` 那三步），加回来就是一个永远不触发的死组件 ——
//    而"死组件"最坏的地方是它看起来还在管事（`[data-chapter-next]` 之类的钩子会被人继续引用）。
