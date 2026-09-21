import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  LINK_W, LINK_H, LINK_EMPTY, LINK_CELLS,
  canLink, findAnyPair, newLinkBoard, reshuffle, isCleared, damageOf,
  LINK_COMBO_WINDOW_MS, linkPointOf,
  type Board,
} from '../game/linklink'
import * as sfx from '../game/sfx'
// 盘面底纹**与消消乐共用同一张**（灵阵石盘）。连连看没有自己的素材，而底纹是"这块盘有来头"
// 的氛围层、不参与辨识 —— 两只 Boss 用同一张，反而像同一套世界观里的两种玩法。
import boardPlate from '../assets/sprites/gems/board_plate.webp'

/**
 * 第二只世界 Boss 的**连连看盘面**。
 *
 * 交互：点两个**图案相同**、且**能连起来**（拐弯不超过两次、路径经过的格子都得是空的、
 * 可以绕到盘面外面走）的格子，这一对就被消掉，对 Boss 造成一次伤害。连不上只是提示，
 * **不消耗任何东西** —— 选错图案、或是连不上，都不该有惩罚，这跟消消乐点错了不扣分同一个口径。
 *
 * 与消消乐盘面（`MatchBoard.tsx`）的关系：**规则、盘面演化、身份层全都不同**，只借了三样东西：
 *   ① 那套"只动 transform、格子 memo、反馈层绝对定位"的帧率经验（同样的话不再抄一遍）；
 *   ② `.dq-m3-in` / `.dq-m3-pop` / `.dq-m3-combo` / `.dq-m3-dmg` 这四个**通用动画类**
 *      （名字里的 m3 是历史名字，它们本身与消消乐无关，改那边会同时影响这里）；
 *   ③ `sfx.ts` 的音效，一个都没新增。
 *
 * 刻意**没有**照搬的两处：
 *   · **不要 ids 身份层**。消消乐需要它是因为"交换/掉落"要让**同一块**从旧格子滑到新格子；
 *     连连看消掉就是空、不补块，唯一会让块挪地方的是"重排"，而那一下**全部领新号、集体
 *     重新入场**更清楚（这套做法本身就是照抄 MatchBoard 重排那段的）。少一层状态，
 *     就少一处"拿过期盘面继续结算"的机会。
 *   · **`--gap` 固定为 0**，理由见 index.css 里 `.dq-ll-grid` 那段：连线的 SVG 用格子单位
 *     和格子一一对应，留了 gap 就要在 JS 里补一个定义在 CSS 里的常量偏移。
 *
 * ⚠️ 锚点族是 `data-ll-*`（**不是** `data-m3-*`）。消消乐那族的锚点有回归脚本在用，
 *    两个盘面同时在页面上时也不能互相认错 —— 探针按 `data-m3-cell` 找消消乐、
 *    按 `data-ll-cell` 找连连看，各找各的。
 */

/**
 * 8 种图案的**形状 + 配色**。
 *
 * 为什么形状要各不相同：光靠颜色分不出来的是色弱玩家，而这一页**整个玩法就是"找出相同的两个"**
 * —— 认不出图案的人不是"玩得吃力"，是玩不了。所以形状与颜色是两条独立的辨识通道。
 *
 * 为什么不用素材贴图：消消乐那四颗宝石是生图模型出的，确实好看；但那是 **4 张**，
 * 这里是 **8 张**，一次出八张还得风格统一，是一次专门的素材工程。而这一版**首先要回答的是
 * "连连看的手感对不对"**（见 linklink.ts 的 LINK_PAIRS_PER_MIN）—— 手感没定就先去画图，
 * 图画完可能要因为玩法调整重画。所以先用 SVG 画死形状，手感定了再补贴图。
 *
 * ⚠️ 这个数组的长度**必须等于 `linklink.ts` 的 `LINK_KINDS`**。对不上的表现是
 *    "两种图案长得一模一样"（`KINDS[k]` 越界后落到兜底的第 0 个），盘面上看着像 bug。
 *    UI 冒烟里有一条判据盯着"盘面上真的出现了 8 种不同的图案"。
 */
const KINDS: { fill: string; edge: string }[] = [
  { fill: '#ff8c42', edge: '#7c2d12' },   // 橙
  { fill: '#4ade80', edge: '#166534' },   // 绿
  { fill: '#38bdf8', edge: '#075985' },   // 蓝
  { fill: '#a78bfa', edge: '#4c1d95' },   // 紫
  { fill: '#f472b6', edge: '#831843' },   // 玫
  { fill: '#2dd4bf', edge: '#134e4a' },   // 青
  { fill: '#facc15', edge: '#78350f' },   // 黄
  { fill: '#e2e8f0', edge: '#334155' },   // 灰白（最亮的一档，落在最暗的底色上最跳）
]

/** 八种形状，都是 24×24 里画得下的基本形 —— 小尺寸下还认得出来的只有这些 */
function shapeOf(k: number) {
  switch (k) {
    case 0: return <circle cx="12" cy="12" r="8.4" />
    case 1: return <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" />
    case 2: return <path d="M12 3.6 21 20.4H3z" />
    case 3: return <path d="M12 2.6l2.9 6.2 6.6.8-4.9 4.5 1.3 6.5L12 17.4 6.1 20.6l1.3-6.5-4.9-4.5 6.6-.8z" />
    case 4: return <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
    case 5: return <path d="M9.4 3h5.2v6.4H21v5.2h-6.4V21H9.4v-6.4H3V9.4h6.4z" />
    // 圆环（`evenodd` 掏空，比"月牙"好画也更好认）
    case 6: return <path fillRule="evenodd" d="M12 3.4a8.6 8.6 0 100 17.2 8.6 8.6 0 000-17.2zm0 4.4a4.2 4.2 0 010 8.4 4.2 4.2 0 010-8.4z" />
    default: return <path d="M12 2.4l1.9 7.7 7.7 1.9-7.7 1.9-1.9 7.7-1.9-7.7L2.4 12l7.7-1.9z" />
  }
}

/**
 * 一个图案。用 SVG 画 + **不用渐变**：48 个格子各是一张 SVG，每张自带 `<defs>` 就会
 * 有 48 个同名渐变 id（改 id 又要引 `useId`）。纯色 + 深色描边 + 一点高光已经够跳了。
 */
function KindMark({ k }: { k: number }) {
  const s = KINDS[k] ?? KINDS[0]
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
      <g fill={s.fill} stroke={s.edge} strokeWidth="1.5" strokeLinejoin="round">{shapeOf(k)}</g>
      {/* 高光：给平面图形一点体积感。**压在左下**（光从左上来的话另一侧才该亮，
          但玩家的眼睛在屏幕前，左上高光是最容易被读成"凸起"的那个方向） */}
      <ellipse cx="9.2" cy="8.4" rx="2.1" ry="1.4" fill="#fff" opacity="0.4" transform="rotate(-28 9.2 8.4)" />
    </svg>
  )
}

/**
 * 逐帧节奏。三个数都试过：再快看不清"消了哪一对"，再慢连点会拖成慢动作。
 *
 * ⚠️ `LINE_KEEP_MS` 与 index.css 里 `.dq-ll-line` 的动画时长是**同一个数**，改一处要改两处。
 *    `POP_MS` 与 `.dq-m3-pop` 的时长同理（那个是借来的类，改它会同时影响消消乐）。
 */
const POP_MS = 150
const LINE_KEEP_MS = 420
const HINT_MS = 900
/** 盘面清空 / 重排之后停一下再摆新牌，让玩家看清"刚才那下是换盘了" */
const REBUILD_MS = 380

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const EMPTY: number[] = []

/** 把盘面编成 48 个字符：`.` 是空格、`0`~`7` 是图案。给测试当锚点用（一眼看得出整盘） */
const enc = (b: Board) => b.map(v => (v === LINK_EMPTY ? '.' : String(v))).join('')

/** 喇叭图标：与 MatchBoard 同一个理由 —— emoji 在本机没有字体，截图里是方块 */
function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h3l5 4V5L7 9H4z" fill="currentColor" stroke="none" />
      {muted
        ? <path d="M16 9l5 6M21 9l-5 6" />
        : <><path d="M16.5 9.5a4 4 0 0 1 0 5" /><path d="M19 7a7.5 7.5 0 0 1 0 10" /></>}
    </svg>
  )
}

/** 一个格子。**memo 过** —— 一次消除只动两格，其余 46 格不该跟着重建 */
const Tile = memo(function Tile({ at, x, y, v, selected, popping, disabled, onPick }: {
  at: number
  x: number
  y: number
  v: number
  selected: boolean
  popping: boolean
  disabled: boolean
  onPick: (i: number) => void
}) {
  const step = 'var(--cs)'
  const empty = v === LINK_EMPTY
  return (
    <button type="button" onClick={() => onPick(at)}
      // 空格**不设 disabled**：点空格要有反馈（取消选中），disabled 会让点击彻底没反应。
      // 真正的"不许点"是父组件的 disabled，那一条在 pick 里判。
      disabled={disabled}
      data-ll-cell={at} data-ll-v={v} data-ll-sel={selected ? '1' : '0'}
      style={{ width: 'var(--cs)', height: 'var(--cs)', transform: `translate3d(calc(${x} * ${step}), calc(${y} * ${step}), 0)` }}
      className="dq-ll-tile">
      {!empty && (
        // 图案缩进 3px 造出格间间隙（见 .dq-ll-grid 那段：**不能用 gap**）。
        // 这一层只负责"这一块自己"的动画（入场 / 消除炸开），与外面那层的格子坐标各走各的。
        <div className={`dq-m3-in absolute inset-[3px] ${popping ? 'dq-m3-pop' : ''}`}>
          <KindMark k={v} />
        </div>
      )}
    </button>
  )
})

function LinkLinkBoardInner({ disabled, onClear, initial, fmtDamage }: {
  /** 打穿/本期结束时锁住盘面 */
  disabled?: boolean
  /** 消掉一对的回调。damage 已按连击算好（**换算是引擎的事，这里不乘第二遍**） */
  onClear?: (damage: number, combo: number) => void
  /** 测试用：指定开局盘面 */
  initial?: Board
  /** 伤害飘字的格式化（默认本机千分位）。传父组件的 fmtNum，免得这里再写一份缩写规则 */
  fmtDamage?: (n: number) => string
}) {
  const [board, setBoard] = useState<Board>(() => initial ?? newLinkBoard())
  /**
   * "这一副牌的第几代"。重排/清空之后 +1 —— 格子用它当 key 的一部分，
   * 让 React **重挂载**这些节点，入场动画才会重播。只靠类名不变的话，
   * 玩家看到的是"48 块原地换了个颜色"，而不是"换了一副牌"。
   */
  const [gen, setGen] = useState(0)
  const [sel, setSel] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [pop, setPop] = useState<number[]>(EMPTY)
  const [line, setLine] = useState<number[] | null>(null)
  const [hint, setHint] = useState('')
  const [bigCombo, setBigCombo] = useState<{ n: number; key: number } | null>(null)
  const [floats, setFloats] = useState<{ id: number; text: string }[]>([])
  const [muted, setMuted] = useState(() => sfx.isMuted())
  /** 本盘消掉多少对（只做展示与测试读数，不影响伤害） */
  const [pairs, setPairs] = useState(0)
  const [reshuffles, setReshuffles] = useState(0)

  // 玩法状态一律走 ref：`play()` 是一串 await，中途父组件会重渲好几次，
  // 闭包里的 state 会过期（拿过期盘面继续结算 = 消掉的格子"复活"）。
  const boardRef = useRef(board)
  const selRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const disabledRef = useRef(!!disabled)
  const aliveRef = useRef(true)
  const hintTimer = useRef<number | null>(null)
  const lineTimer = useRef<number | null>(null)
  const floatKey = useRef(0)
  const comboKey = useRef(0)
  const onClearRef = useRef(onClear)
  /** 上一对是在什么时候消掉的 —— 连击窗口的锚 */
  const lastPairAt = useRef(0)
  /** 当前连到第几对（第 1 对从 1 起数，不是从 0） */
  const comboN = useRef(0)
  /**
   * 最近一次连线的**拐点数**。常驻锚点（不是那根会自己消失的线）——
   * 线只活 420ms，探针来不及读就成了"恒真的假绿"（读不到 = 没断言）。见 verify-linklink-ui。
   */
  const [lastPath, setLastPath] = useState(0)

  useEffect(() => { onClearRef.current = onClear })
  useEffect(() => { disabledRef.current = !!disabled }, [disabled])
  useEffect(() => () => {
    aliveRef.current = false
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
    if (lineTimer.current) window.clearTimeout(lineTimer.current)
  }, [])

  const setSelBoth = useCallback((v: number | null) => { selRef.current = v; setSel(v) }, [])
  const flashHint = useCallback((t: string) => {
    setHint(t)
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => { if (aliveRef.current) setHint('') }, HINT_MS)
  }, [])
  const showFloat = useCallback((text: string) => {
    const id = ++floatKey.current
    setFloats(f => [...f, { id, text }])
    window.setTimeout(() => { if (aliveRef.current) setFloats(f => f.filter(x => x.id !== id)) }, 950)
  }, [])

  /** 摆一副新牌（清空之后、或重排兜底时）。全部重新入场 */
  const deal = useCallback((b: Board) => {
    boardRef.current = b
    setBoard(b)
    setGen(g => g + 1)
    setPop(EMPTY)
    setSelBoth(null)
  }, [setSelBoth])

  /**
   * 消掉一对。`path` 是引擎给的拐点序列（带框下标），直接拿去画线。
   *
   * 时序：连线出现 → 两格炸开 → 从盘面移除 → 线自己淡出。全程约 420ms，
   * 远快于服务端 2 秒的冷却 —— 所以伤害攒发那一套（见 worldboss2.ts）是必需的，
   * 直发的话十次有九次会被 'cooldown' 拒掉，玩家看到的是"消了但没掉血"。
   */
  const play = useCallback(async (path: number[], a: number, b: number) => {
    busyRef.current = true
    setBusy(true)

    // 连击：两对之间**不倒手**才算连着（窗口与引擎的常量同一个数）
    const now = Date.now()
    comboN.current = (now - lastPairAt.current <= LINK_COMBO_WINDOW_MS) ? comboN.current + 1 : 1
    lastPairAt.current = now
    const n = comboN.current
    const dmg = damageOf(n)

    setLine(path)
    setLastPath(path.length)
    setPop([a, b])
    sfx.playClear(n, 2)
    if (n >= 3) {
      const key = ++comboKey.current
      setBigCombo({ n, key })
      // 播完就撤：留着的话它在 DOM 里是个 opacity:0 的幽灵，
      // 而 `data-ll-combo-big` 又会被测试当成"现在正显示连击"（判据会永远为真）
      window.setTimeout(() => { if (aliveRef.current) setBigCombo(c => (c && c.key === key ? null : c)) }, 900)
      sfx.playCombo(n)
    }
    showFloat('+' + (fmtDamage ?? ((x: number) => x.toLocaleString('zh-CN')))(dmg))

    await sleep(POP_MS)
    if (!aliveRef.current) return

    const cur = boardRef.current
    const nb = cur.slice()
    nb[a] = LINK_EMPTY
    nb[b] = LINK_EMPTY
    boardRef.current = nb
    setBoard(nb)
    setPop(EMPTY)
    setPairs(p => p + 1)
    onClearRef.current?.(dmg, n)

    // 线不立刻撤：它才刚画出来，跟炸开同帧消失就白画了
    if (lineTimer.current) window.clearTimeout(lineTimer.current)
    lineTimer.current = window.setTimeout(() => { if (aliveRef.current) setLine(null) }, LINE_KEEP_MS)

    // ① 盘面空了：这一盘打光了，来新的一副
    if (isCleared(nb)) {
      flashHint('盘面清空，重新发牌')
      sfx.playCreate()
      await sleep(REBUILD_MS)
      if (!aliveRef.current) return
      deal(newLinkBoard())
      setPairs(0)
      setReshuffles(0)
      busyRef.current = false
      if (aliveRef.current) setBusy(false)
      return
    }
    // ② 还有块、但一对都连不上了：重排。
    //    ⚠️ **必须真的判一次**（findAnyPair 开销 0.003ms，见 calib-linklink ③）——
    //    "重排发生了"如果靠猜，那条 UI 判据就是恒真的。而且实测重排**几乎不发生**
    //    （40 局一次，见 calib-linklink ①），所以这条分支平时根本不会走到。
    if (!findAnyPair(nb)) {
      flashHint('无可消，重排')
      sfx.playReshuffle()
      await sleep(REBUILD_MS)
      if (!aliveRef.current) return
      // 重排只打乱**还剩下的**块的位置；兜底（某色只剩一个孤块 / 牌太少怎么摆都连不上）
      // 才会重发一整副，那时牌数会变多 —— 引擎保证回的一定有解。
      deal(reshuffle(nb))
      setReshuffles(x => x + 1)
    }
    busyRef.current = false
    if (aliveRef.current) setBusy(false)
  }, [deal, flashHint, showFloat, fmtDamage])

  const pick = useCallback((i: number) => {
    if (disabledRef.current || busyRef.current) return
    sfx.unlock()                                  // 首次点击解锁音频（浏览器规矩）
    const v = boardRef.current
    const cur = selRef.current
    // 点空格 = 取消选中。**不是错误**（盘面越消越空，误触空格太常见了），
    // 所以不响 playBad、也不弹提示。
    if (v[i] === LINK_EMPTY) { setSelBoth(null); return }
    if (cur === null) { sfx.playPick(); setSelBoth(i); return }
    if (cur === i) { setSelBoth(null); return }   // 再点自己 = 取消
    if (v[cur] === LINK_EMPTY) { setSelBoth(i); return }   // 选中之后那格被消掉了（理论上到不了）
    // 图案不同 / 连不上：**只提示，不换盘、不扣东西**。点的那一格改成新的选中 ——
    // 玩家这时候的意图显然是想消这一格，而不是想消刚才那格。
    if (v[cur] !== v[i]) { sfx.playBad(); flashHint('图案不一样'); setSelBoth(i); return }
    const path = canLink(v, cur, i)
    if (!path) { sfx.playBad(); flashHint('连不上'); setSelBoth(i); return }
    setSelBoth(null)
    void play(path, cur, i)
  }, [play, setSelBoth, flashHint])

  const encBoard = useMemo(() => enc(board), [board])
  const area = {
    width: `calc(${LINK_W} * var(--cs))`,
    height: `calc(${LINK_H} * var(--cs))`,
  }
  // 连线覆盖层：viewBox 用**格子单位**（可见格 (0,0) 的中心是 (0.5,0.5)），并且
  // 四周各留 1 格的余量 —— 绕外圈的那条路径画在盘面**外面**，不留余量就被裁掉了。
  // 单位与像素的换算是"1 单位 = 1 个格宽"，这**只在 --gap 为 0 时成立**（见 index.css）。
  //
  // ⚠️ v1.47：1.5 → 1.0。**这个数同时是"布局宽度"和"坐标空间"**，所以它一改，
  //    盘面外框就从 11 格宽变成 10 格宽 —— 那正是 320/360px 手机上左边被切掉、
  //    以及 1440px 桌面上最右一列跑出屏幕的根因（实测见 index.css 那段）。
  //
  // ⚠️ v1.49：1.0 → 0.36，**手机端把格子做大那件事的关键**。外框只需放得下"绕一圈"
  //    的那条线，1 格是它的**上界**、不是下界：8 列 + 两侧各 1 格 = 分母 10，
  //    等于白白让出 20% 的宽度。收成 0.36 之后分母是 8.72 —— 375px 机型上
  //    格宽 35.9 → 41.2px（320px 上 30.4 → 34.9px，刚好越过全站 34px 的点击下限）。
  //    这个数不是拍的：`LINK_RING = 0.28` 是线要画到的地方，再加描边半宽 0.065，
  //    合起来 0.345 —— 取 0.36 让描边也落在 SVG 盒子里面。
  //    **三处必须一起改**：这里、`linklink.ts` 的 `LINK_RING`、`index.css` 的 `--cs` 分母。
  const PAD = 0.36

  return (
    <div className="dq-ll-stage flex flex-col items-center gap-1"
      data-ll-board={encBoard} data-ll-busy={busy ? '1' : '0'}
      data-ll-sel={sel ?? -1} data-ll-combo={comboN.current} data-ll-pairs={pairs}
      data-ll-reshuffles={reshuffles} data-ll-lastpath={lastPath}>
      {/* 外层**不裁**（连线要画到盘面外），裁的是里面那层盘面。
          ⚠️ `--cs` 必须定义在**这一层**：连线那层 SVG 是它的子元素，定义在里面那层盘面上
          的话 SVG 读不到（CSS 变量只往下传，兄弟之间不共享）。 */}
      <div className="dq-ll-grid relative" style={{ ...area, margin: `calc(${PAD} * var(--cs))` }}>
        <div className="dq-ll-plate absolute inset-0 overflow-hidden rounded-lg border border-dq-border/80 shadow-[inset_0_0_18px_rgba(0,0,0,0.9)]"
          style={{ '--ll-plate': `url(${boardPlate})` } as CSSProperties}>
          {board.map((v, at) => (
            <Tile key={`${at}-${gen}`} at={at} x={at % LINK_W} y={Math.floor(at / LINK_W)}
              v={v} selected={sel === at} popping={pop.includes(at)}
              disabled={!!disabled} onPick={pick} />
          ))}
        </div>
        {/* 连线层。**在外层里、盘面容器外** —— 放进去会被 overflow-hidden 裁掉。
            `pointer-events-none`：它盖在格子上，不挡点击。
            画两根同 d 的折线（暗的粗一圈 + 亮的细）伪造发光，**不用 filter** ——
            drop-shadow 每帧都要重绘，而这一条线的每一帧都在动。 */}
        <svg className="pointer-events-none absolute z-10 overflow-visible"
          style={{
            left: `calc(-${PAD} * var(--cs))`, top: `calc(-${PAD} * var(--cs))`,
            width: `calc(${LINK_W + PAD * 2} * var(--cs))`, height: `calc(${LINK_H + PAD * 2} * var(--cs))`,
          }}
          viewBox={`${-PAD} ${-PAD} ${LINK_W + PAD * 2} ${LINK_H + PAD * 2}`}>
          {line && (
            <polyline data-ll-line={line.length}
              points={line.map(li => { const p = linkPointOf(li); return `${p.x},${p.y}` }).join(' ')}
              className="dq-ll-glow" />
          )}
          {line && (
            <polyline
              points={line.map(li => { const p = linkPointOf(li); return `${p.x},${p.y}` }).join(' ')}
              className="dq-ll-line" />
          )}
        </svg>
        {/* 打击反馈都在这层：**绝对定位、不参与布局** —— 它们一旦挤进正常流，
            每次连击都会把盘面顶一下，就成了另一种"抖"。 */}
        {bigCombo && <div key={bigCombo.key} className="dq-m3-combo" data-ll-combo-big={bigCombo.n}>{bigCombo.n} 连击</div>}
        {floats.map(f => (
          <div key={f.id} className="dq-floating-num dq-m3-dmg" data-ll-dmg>{f.text}</div>
        ))}
      </div>
      <div className="relative flex h-4 w-full items-center justify-center">
        <span className="text-[10px] text-dq-gold sm:text-xs" data-ll-hint={hint}>{hint}</span>
        {/* 与消消乐那边逐字同一条：所在行只有 h-4，不能用 `dq-tap`（会上下溢出压住盘面吞点击），
            改用 `after:` 叠一层透明扩大区。实测原尺寸 18×18。 */}
        <button type="button" data-ll-sfx={muted ? '0' : '1'}
          title={muted ? '音效已关' : '音效已开'}
          // 关掉之后**不再解锁音频**：玩家点了关还听见"咔"的一声是最烦的
          onClick={() => { const v = !muted; sfx.setMuted(v); setMuted(v); if (!v) { sfx.unlock(); sfx.playPick() } }}
          className={`absolute right-0 top-1/2 -translate-y-1/2 rounded p-0.5 after:absolute after:-inset-2 after:content-[''] ${muted ? 'text-[#7a6a55]' : 'text-dq-gold'}`}>
          <SoundIcon muted={muted} />
        </button>
      </div>
    </div>
  )
}

export default memo(LinkLinkBoardInner)

/** 盘面有多少格 —— 给页面侧写"这一盘还有几块"之类的读数用，别在那边再抄一遍 48 */
export const LINK_BOARD_CELLS = LINK_CELLS