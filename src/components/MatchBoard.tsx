import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MATCH_W, MATCH_H, comboMultiplier, newMatch, newSpecials, trySwapEx, hasMoveEx, isAdjacent, stepIds,
  SP_NONE, SP_COL, SP_BOMB,
  type Board, type Specials, type Ids, type SwapResultEx,
} from '../game/match3'
import * as sfx from '../game/sfx'
/**
 * 连击倍率的**显示**格式：最多两位小数、去掉尾随的 0（`1.15 → "1.15"`、`2.5 → "2.5"`）。
 *
 * ⚠️ 别退回 `toFixed(1)` —— 它会把 **1.15 印成 "1.1"**（1.15 的浮点表示略小于 1.15，
 *    toFixed 直接截），界面于是常年少报 0.05；而上一版 STEP=0.08 时同样是错的，
 *    只是方向反过来（1.08 → "1.1"，**多**报 0.02）。两版都错，只是错法不同。
 *    这是 `verify-combo-e2e.cjs` ⑦ 段拿**页面上的字**和源码常量对拍抓出来的 ——
 *    引擎那条（26/26）验的是数字，验不到"印出来长什么样"。
 *
 * `Math.round(v * 100) / 100` 那一层是必需的：`1 + 0.15 × 2` 算出来是 `1.3000000000000003`，
 * 直接 `String()` 会把那串尾巴原样印给玩家看。
 */
const fmtRate = (v: number) => String(Math.round(v * 100) / 100)
// 四张元素贴图 + 一块灵阵石盘底纹，都是生图模型出的（gen-image.cjs --batch batch-gems.json，
// 白底用 remove-bg.cjs 抠掉后转 webp）。**不是 CSS 色块** —— 用户对上一版「火木水土」四个
// 汉字方块的原话是"很丑"。
import gemFire from '../assets/sprites/gems/elem_fire.webp'
import gemWood from '../assets/sprites/gems/elem_wood.webp'
import gemWater from '../assets/sprites/gems/elem_water.webp'
import gemEarth from '../assets/sprites/gems/elem_earth.webp'
import boardPlate from '../assets/sprites/gems/board_plate.webp'

/**
 * 集结讨伐的消消乐盘面。**不看阵容也不看战力** —— 伤害只看你消得怎么样，
 * 与队伍强度完全无关：每格一个固定伤害，**连锁里越深的拍越值钱**
 * （倍率见 match3.ts 的 MATCH_COMBO_STEP / MATCH_COMBO_MAX，换算见 MATCH_DAMAGE_PER_TILE）。
 *
 * 交互取「点一下选中、再点相邻格交换」而不是拖拽：拖拽在移动端要处理 touchstart/
 * touchmove/touchend 与页面滚动打架，回到原点判定、误触判定一堆边界；点选两步是零歧义的，
 * 而且**点错了还能取消**（再点同一格），对休闲玩法反而更友好。
 *
 * v1.40 重做了这一层，起因是用户的三句话：
 *   「交换位置也没有动画 就图片切换」「感觉有点卡卡的」「打击效果 还有音效 连击要给出ui化文字」。
 *
 * 三个改动各自对应一句：
 *   ① **位移动画**：以前每格是 grid 里的一个固定格子（`key={i}`），交换时只能原地换掉 img 的
 *      src —— 看着就是"图片切换"。现在每格绝对定位、位置写在 transform 上，块有了身份
 *      （引擎的 Ids 层），交换/掉落时**同一块**从旧格子滑到新格子。
 *   ② **帧率**：以前的动画是 `transition-all` 加 `brightness` 滤镜 —— 滤镜每帧都要重绘，
 *      36 格一起就是"卡卡的"。现在只动 transform（走合成器，不触发布局与重绘），
 *      并且整块盘面 memo 住：父组件每 2 秒轮询、每消一笔都会重渲，以前会把 36 格一起重建。
 *   ③ **反馈**：消除有炸开、连击有居中大字、伤害有飘字、每个动作有声（音效见 game/sfx.ts）。
 *      **不许抖、不许闪**（用户对世界 Boss 的立绘提过同一条，这里同样照办）：
 *      所以是"缩放 + 上浮"，没有位移抖动、没有亮度闪烁。
 */

/**
 * 四种元素。四色仍然分得很开（火橙红 / 木翠绿 / 水湛蓝 / 土金黄）——
 * 贴图看着漂亮不代表色弱玩家分得清，所以「明度」也一起拉开：土最亮、木最暗。
 */
const GEMS = [
  { ch: '火', img: gemFire },
  { ch: '木', img: gemWood },
  { ch: '水', img: gemWater },
  { ch: '土', img: gemEarth },
]

/**
 * 逐帧节奏。三个数都试过：再快就看不清"消了哪几格"，再慢连消会拖成慢动作。
 * 交换 190 与 CSS 里 `.dq-m3-tile` 的过渡时长是**同一个数**，改一处要改两处。
 */
const SWAP_MS = 190
const POP_MS = 150
const FALL_MS = 200

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const EMPTY: number[] = []

interface View {
  board: Board
  specials: Specials
  ids: Ids
}

/**
 * 特殊块的角标。**用 SVG 画，不引素材**：
 *   横消 = 一根带双箭头的横杠（"把这一行推平"）、竖消 = 同一根转 90°、爆破 = 四角星。
 * 形状本身就是说明，不需要配文字 —— 36px 的格子里写不下字。
 * 描边是深色的：宝石有亮有暗，纯亮色角标压在金黄的"土"上会糊成一片。
 */
function SpecialMark({ kind }: { kind: number }) {
  const bar = (
    <>
      <path d="M3 12h18" stroke="#3a1d00" strokeWidth="6" strokeLinecap="round" />
      <path d="M3 12h18" stroke="#fff3c4" strokeWidth="3" strokeLinecap="round" />
      <path d="M3 12l6-5v10z" fill="#fff3c4" stroke="#3a1d00" strokeWidth="1" />
      <path d="M21 12l-6-5v10z" fill="#fff3c4" stroke="#3a1d00" strokeWidth="1" />
    </>
  )
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
      data-m3-mark={kind}>
      {kind === SP_BOMB ? (
        <>
          <circle cx="12" cy="12" r="8" fill="none" stroke="#3a1d00" strokeWidth="4.5" />
          <circle cx="12" cy="12" r="8" fill="none" stroke="#fff3c4" strokeWidth="2" />
          <path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4z"
            fill="#fff3c4" stroke="#3a1d00" strokeWidth="1.2" strokeLinejoin="round" />
        </>
      ) : (
        <g transform={kind === SP_COL ? 'rotate(90 12 12)' : undefined}>{bar}</g>
      )}
    </svg>
  )
}

/**
 * 一个块。**memo 过** —— 这是帧率那一半：一次交换只动两格，其余 34 格不该跟着重建。
 * （父组件在轮询回来、以及我每消一笔上报时都会重渲，以前 36 个格子全都跟着重来一遍。）
 */
const Tile = memo(function Tile({ at, x, y, v, sp, selected, popping, disabled, onPick }: {
  at: number
  x: number
  y: number
  v: number
  sp: number
  selected: boolean
  popping: boolean
  disabled: boolean
  onPick: (i: number) => void
}) {
  const g = GEMS[v] ?? GEMS[0]
  // 位置 = 格序 × (格宽 + 间隙)，两个数都来自 CSS 变量（.dq-m3-grid 里按容器宽算）
  const step = 'calc(var(--cs) + var(--gap))'
  /**
   * ⚠️ 点击盒 = **一整格间距（cs + gap）**，不是 cs。这是 v1.47「经常点不到正确的区块」
   * 的根治，两个原因叠在一起：
   *   ① 旧版按钮只有 cs 宽，格间那 4px 是**死区** —— 点在缝上什么都不发生；
   *   ② 旧版宝石画的是 `scale-[1.12]`，视觉上比按钮大 12%，于是**宝石边缘那一圈
   *      其实属于邻居的按钮** —— 手指按在看到的宝石上，选中的却是旁边那块。
   * 现在：按钮 = 整格间距（相邻两块严丝合缝、无死区），宝石缩在 gap/2 的内衬里，
   * 视觉尺寸回到 cs（= 旧版 40×1.12 ≈ 44.8 → 新版 cs 上限 44，看着一样大）。
   * **不变式：点击盒 ≥ 视觉盒**，任何一格上"看到哪块就点到哪块"。
   */
  const pitch = 'calc(var(--cs) + var(--gap))'
  return (
    <button type="button" onClick={() => onPick(at)} disabled={disabled}
      data-m3-cell={at} data-m3-v={v} data-m3-sp={sp}
      // 选中时的放大也走同一个 transform：**不能**用 Tailwind 的 `scale-110`，
      // 那个类会自己写一条 transform 覆盖掉位移，格子会瞬间跳回左上角。
      style={{ width: pitch, height: pitch, transform: `translate3d(calc(${x} * ${step}), calc(${y} * ${step}), 0) scale(${selected ? 1.12 : 1})` }}
      className="dq-m3-tile">
      {/* 这一层只负责"块自己"的动画（掉落入场 / 消除炸开），与外面那层的格子坐标各走各的。
          内衬 gap/2 把视觉盒收回到 cs —— 点击盒留在外面的整格间距上。 */}
      <div className={`dq-m3-in relative h-full w-full ${popping ? 'dq-m3-pop' : ''}`}
        style={{ padding: 'calc(var(--gap) / 2)' }}>
        <div className={`relative h-full w-full rounded-md bg-black/35 p-[1px] ${selected ? 'ring-2 ring-dq-gold' : ''} ${disabled ? 'opacity-40' : ''}`}>
          {/* 宝石本身带透明通道（抠过白底），所以这里不需要圆角遮罩；
              drop-shadow 给它一点"浮在盘面上"的立体感 */}
          <img src={g.img} alt={g.ch} draggable={false}
            className="h-full w-full object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]" />
          {sp !== SP_NONE && (
            <div className="dq-m3-mark dq-m3-mark-pulse">
              <SpecialMark kind={sp} />
            </div>
          )}
        </div>
      </div>
    </button>
  )
})

/** 喇叭图标：与特殊块角标同一个理由 —— emoji 在本机没有字体，截图里是方块 */
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

function MatchBoardInner({ disabled, onClear, initial, fmtDamage }: {
  /** 打穿/本期结束时锁住盘面 */
  disabled?: boolean
  /** 一次交换结算完的回调。tiles 是这次总共消掉的格数（含连锁），damage 已按系数算好 */
  onClear?: (res: SwapResultEx, damage: number) => void
  /** 测试用：指定开局盘面 */
  initial?: Board
  /** 伤害飘字的格式化（默认本机千分位）。传父组件的 fmtNum，免得这里再写一份缩写规则 */
  fmtDamage?: (n: number) => string
}) {
  const [view, setView] = useState<View>(() => initial
    ? { board: initial, specials: newSpecials(), ids: initial.map((_, i) => i) }
    : newMatch())
  const [sel, setSel] = useState<number | null>(null)     // 选中待交换的格子
  const [busy, setBusy] = useState(false)
  const [pop, setPop] = useState<number[]>(EMPTY)         // 正在炸的格子
  const [hint, setHint] = useState('')
  const [combo, setCombo] = useState<{ n: number; key: number } | null>(null)
  const [floats, setFloats] = useState<{ id: number; text: string }[]>([])
  const [muted, setMuted] = useState(() => sfx.isMuted())

  // 玩法状态一律走 ref：`play()` 是一串 await，中途父组件会重渲好几次，
  // 闭包里的 state 会过期（拿过期盘面继续结算 = 消掉的格子"复活"）。
  const viewRef = useRef(view)
  const selRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const disabledRef = useRef(!!disabled)
  const nextIdRef = useRef(initial ? initial.length : view.ids.length)
  const aliveRef = useRef(true)
  const hintTimer = useRef<number | null>(null)
  const floatKey = useRef(0)
  const comboKey = useRef(0)
  const onClearRef = useRef(onClear)

  useEffect(() => { onClearRef.current = onClear })
  useEffect(() => { disabledRef.current = !!disabled }, [disabled])
  useEffect(() => () => {
    aliveRef.current = false
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
  }, [])

  const commit = useCallback((v: View) => { viewRef.current = v; setView(v) }, [])
  const setSelBoth = useCallback((v: number | null) => { selRef.current = v; setSel(v) }, [])
  const flashHint = useCallback((t: string) => {
    setHint(t)
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => { if (aliveRef.current) setHint('') }, 900)
  }, [])
  const showFloat = useCallback((text: string) => {
    const id = ++floatKey.current
    setFloats(f => [...f, { id, text }])
    window.setTimeout(() => { if (aliveRef.current) setFloats(f => f.filter(x => x.id !== id)) }, 950)
  }, [])

  /** 逐帧播一次交换的全部连锁 */
  const play = useCallback(async (res: SwapResultEx, a: number, c: number) => {
    busyRef.current = true
    setBusy(true)
    sfx.playSwap()
    // ① 交换：身份与两层一起对调，CSS 把位移过渡出来（以前这一帧只是换了个 img）
    const v0 = viewRef.current
    const ids0 = v0.ids.slice()
    ids0[a] = v0.ids[c]; ids0[c] = v0.ids[a]
    commit({ board: res.swapped, specials: res.swappedSpecials, ids: ids0 })
    await sleep(SWAP_MS)
    let before = res.swappedSpecials
    for (let k = 0; k < res.steps.length; k++) {
      if (!aliveRef.current) return
      const st = res.steps[k]
      // 这一拍有没有引爆特殊块（判据是"被消的格子里有特殊块"，不是"消得多"）
      const blasted = st.cleared.some(i => before[i] !== SP_NONE)
      setPop(st.cleared)
      sfx.playClear(k + 1, st.cleared.length)
      if (blasted) sfx.playBlast()
      if (res.created.some(x => x.combo === k + 1)) sfx.playCreate()
      await sleep(POP_MS)
      if (!aliveRef.current) return
      // ② 掉落：身份按引擎给的轨迹搬（哪块掉到哪儿只有结算过程自己知道）
      const nx = stepIds(viewRef.current.ids, st.src, nextIdRef.current)
      nextIdRef.current = nx.nextId
      commit({ board: st.after, specials: st.specialsAfter, ids: nx.ids })
      setPop(EMPTY)
      before = st.specialsAfter
      await sleep(FALL_MS)
    }
    // 伤害**包含连击加成**，且换算只在引擎里做一次（`res.damage = 等效格数 × 每格伤害`）。
    // 界面自己拿 `res.tiles` 去乘每格伤害 = 把连击加成丢掉（中文乘号写在这里是给静态锚点留活路：
    // 写成半角 `*` 的话，这一行注释会被"裸扫文件文本"的脚本当成真的在算伤害）。
    const dmg = res.damage
    // 连击从头喊到尾都喊就没意思了：**两拍起**才报，报一次（连锁收尾时）
    if (res.combo >= 2) {
      const key = ++comboKey.current
      setCombo({ n: res.combo, key })
      // 播完就撤：留着的话它在 DOM 里是个 opacity:0 的幽灵，
      // 而 `data-m3-combo` 又会被测试当成"现在正显示连击"（判据会永远为真）
      window.setTimeout(() => { if (aliveRef.current) setCombo(c => (c && c.key === key ? null : c)) }, 950)
      sfx.playCombo(res.combo)
    }
    showFloat('+' + (fmtDamage ?? ((n: number) => n.toLocaleString('zh-CN')))(dmg))
    onClearRef.current?.(res, dmg)
    // 无解了就地重排：让玩家对着死盘干瞪眼是最没道理的一种卡住
    const v1 = viewRef.current
    if (!hasMoveEx(v1.board, v1.specials)) {
      flashHint('无可消，重排')
      sfx.playReshuffle()
      await sleep(420)
      if (!aliveRef.current) return
      const fresh = newMatch()
      // 整盘重排：**全部领新号**，这样每块都会播一次入场动画（否则会看到 36 块原地瞬移）
      const ids2 = fresh.board.map(() => nextIdRef.current++)
      commit({ board: fresh.board, specials: fresh.specials, ids: ids2 })
    }
    busyRef.current = false
    if (aliveRef.current) setBusy(false)
  }, [commit, flashHint, showFloat, fmtDamage])

  const pick = useCallback((i: number) => {
    if (disabledRef.current || busyRef.current) return
    sfx.unlock()                                  // 首次点击解锁音频（浏览器规矩）
    const cur = selRef.current
    if (cur === null) { sfx.playPick(); setSelBoth(i); return }
    if (cur === i) { setSelBoth(null); return }   // 再点自己 = 取消，不换
    if (!isAdjacent(cur, i)) { setSelBoth(i); return }   // 点了个不相邻的：改成选它，别报错
    const v = viewRef.current
    setSelBoth(null)
    const res = trySwapEx(v.board, v.specials, cur, i)
    if (!res) { sfx.playBad(); flashHint('这样换消不掉'); return }
    void play(res, cur, i)
  }, [play, setSelBoth, flashHint])

  /**
   * ── 滑动换块（v1.47 手机端）──────────────────────────────────────────────
   * 玩家原话：「增加滑动式交互，你懂的消消乐是可以上下左右滑动的」。
   *
   * 与点选**共存**，不是替代：单击仍是"选中/取消"（老锚点回归里点格子的用例全靠它，
   * 而点选也是不少人的习惯）。所以只有**真正拖动过**（位移越过阈值）才算滑动，
   * 并且要把随后浏览器补发的那一次 `click` 吞掉 —— 否则一次滑动会被处理两遍
   * （先按滑动换了块，抬起手指时又按点选逻辑改了选中态）。
   *
   * 用 Pointer Events 而不是 Touch Events：鼠标、触摸、手写笔同一套代码，
   * 桌面玩家用鼠标拖也一样能换（顺带把桌面也变好用了）。
   */
  const swipeRef = useRef<{ at: number; x: number; y: number } | null>(null)
  /** 本次手势已被当作滑动处理 ⇒ 随之而来的 click 要忽略 */
  const swipedRef = useRef(false)
  /** 滑动阈值：手指抖一下不该算拖动。8px 约等于一个指尖的抖动幅度 */
  const SWIPE_MIN = 8

  const onTileDown = useCallback((e: React.PointerEvent, at: number) => {
    swipedRef.current = false
    swipeRef.current = { at, x: e.clientX, y: e.clientY }
  }, [])

  const onTileMove = useCallback((e: React.PointerEvent) => {
    const s = swipeRef.current
    if (!s || swipedRef.current) return
    if (disabledRef.current || busyRef.current) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.hypot(dx, dy) < SWIPE_MIN) return
    swipedRef.current = true        // 从这一刻起，这次手势属于滑动
    swipeRef.current = null
    const x = s.at % MATCH_W, y = Math.floor(s.at / MATCH_W)
    // 只认**主轴**方向：斜着划一手，按位移大的那一边走。正好 45° 时按横向（>=）
    let tx = x, ty = y
    if (Math.abs(dx) >= Math.abs(dy)) tx = Math.min(MATCH_W - 1, Math.max(0, x + (dx > 0 ? 1 : -1)))
    else ty = Math.min(MATCH_H - 1, Math.max(0, y + (dy > 0 ? 1 : -1)))
    if (tx === x && ty === y) return   // 已经在边的尽头还往外划：什么都不做
    sfx.unlock()
    const j = ty * MATCH_W + tx
    pick(s.at)                          // 先选中起点：与点选走**同一条**判定路径
    pick(j)                             // 再选邻居 ⇒ 引擎自己判能不能换、换不动就提示
  }, [pick])

  const onTileUp = useCallback(() => { swipeRef.current = null }, [])

  /** 点击入口：被吞掉的那一次 click 不进 pick */
  const tap = useCallback((i: number) => {
    if (swipedRef.current) { swipedRef.current = false; return }
    pick(i)
  }, [pick])

  // 按**身份**升序渲染：DOM 顺序恒定（新块永远追加在末尾），React 不会来回搬节点 ——
  // 搬节点会把正在跑的过渡打断，那正好就是要修的那个"没有动画"。
  const order = useMemo(() => {
    const arr = view.ids.map((id, at) => ({ id, at }))
    arr.sort((p, q) => p.id - q.id)
    return arr
  }, [view.ids])

  const area = { width: `calc(${MATCH_W} * var(--cs) + ${MATCH_W - 1} * var(--gap))`, height: `calc(${MATCH_W} * var(--cs) + ${MATCH_W - 1} * var(--gap))` }

  return (
    <div className="dq-m3-stage flex flex-col items-center gap-1" data-m3-board={view.board.join('')} data-m3-busy={busy ? '1' : '0'}>
      {/* 盘面**不能**自己撑开高度：里面全是绝对定位的块，尺寸由上面的 area 显式给死。
          `overflow-hidden` 是为了让"从顶上掉下来"的新块在盘面外就被裁掉。 */}
      <div className="dq-m3-grid relative overflow-hidden rounded-lg border border-dq-border/80 p-1.5 shadow-[inset_0_0_18px_rgba(0,0,0,0.9)]"
        style={{
          // 灵阵石盘底纹压到很暗再铺（等同在它上面盖一层 66% 的黑）：
          // 直接铺原图的话八卦纹路会和宝石抢注意力，而宝石才是要一眼认出来的东西。
          // 压暗后它只剩"这块盘有来头"的质感，不参与辨识。
          backgroundImage: `linear-gradient(rgba(0,0,0,0.66), rgba(0,0,0,0.66)), url(${boardPlate})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}>
        <div className="relative" style={area}
          // 滑动的手势层放在**盘面这一层**（而不是每个块上）：块会被 memo 住、会重渲，
          // 手势状态挂在上层才不会因为"这块刚被换走"而丢。
          // `touch-action: none` 在 .dq-m3-grid 上（CSS），否则纵向划会先把页面滚起来。
          onPointerDown={e => {
            const el = (e.target as HTMLElement).closest('[data-m3-cell]')
            if (el) onTileDown(e, Number(el.getAttribute('data-m3-cell')))
          }}
          onPointerMove={onTileMove}
          onPointerUp={onTileUp}
          onPointerCancel={onTileUp}>
          {order.map(t => (
            <Tile key={t.id} at={t.at} x={t.at % MATCH_W} y={Math.floor(t.at / MATCH_W)}
              v={view.board[t.at]} sp={view.specials[t.at]}
              selected={sel === t.at} popping={pop.includes(t.at)}
              disabled={!!disabled} onPick={tap} />
          ))}
          {/* 打击反馈都在这层：**绝对定位、不参与布局** ——
              它们一旦挤进正常流，每次连击都会把盘面顶一下，就成了另一种"抖"。 */}
          {/* ⚠️ `data-m3-combo` 是锚点（probe-match3-v140.cjs 读它）⇒ **属性值必须仍是纯数字**，
              倍率只加在文本里。 */}
          {combo && <div key={combo.key} className="dq-m3-combo" data-m3-combo={combo.n}>{combo.n} 连击 ×{fmtRate(comboMultiplier(combo.n))}</div>}
          {floats.map(f => (
            <div key={f.id} className="dq-floating-num dq-m3-dmg" data-m3-dmg>{f.text}</div>
          ))}
        </div>
      </div>
      <div className="relative flex h-4 w-full items-center justify-center">
        <span className="text-[10px] text-dq-gold sm:text-xs" data-m3-hint={hint}>{hint}</span>
        {/* ⚠️ 这一格**不能用 `dq-tap`**：它所在的那行只有 h-4（16px），
            而它是 `absolute + -translate-y-1/2` 居中的 —— 撑到 34px 只会让它上下各溢出 9px、
            压在盘面最后一排上**把点击吞掉**（帮倒忙）。
            改用 `after:` 叠一层透明的扩大区：视觉不变，手指够得着。
            实测原尺寸 18×18（temp/probe-mobile-pages.cjs，320px）。 */}
        <button type="button" data-m3-sfx={muted ? '0' : '1'}
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

export default memo(MatchBoardInner)