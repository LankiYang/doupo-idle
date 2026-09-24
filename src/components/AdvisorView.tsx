import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, ChevronDown } from 'lucide-react'
import { game } from '../game/engine'
import { CHARACTERS, RARITY_INFO, type CharacterDef } from '../game/data'
import { portraitFor } from '../game/portraits'
import { AI_CHAT_KEY, ADVISOR_POS_KEY } from '../game/storageKeys'
import { askAdvisor, fetchAiStatus, MAX_TURNS, type AiStatus, type ChatTurn } from '../game/aiApi'
import { uploadSave } from '../game/saveApi'

/**
 * AI 军师 —— 云韵（v1.56）。用户原话：
 *   「我们做ai军师，做一个美女立绘聊天框，用云韵的吧 可以和她聊天 问她我现在该做什么 练什么 怎么做，
 *     以及招募的角色都可以对话。」
 *
 * 三件事对应三处实现：
 *   · **美女立绘聊天框** —— 顶部/左侧固定立绘 + 下方对话区
 *   · **问她我该做什么/练什么/怎么做** —— 三个快捷问题（一个字不改地照搬用户原话），
 *     且服务端会把**权威档摘要**喂给模型（卡关连败、上阵阵容、资源、保底进度），
 *     所以她答的是"你这个号现在该干什么"，不是泛泛而谈
 *   · **招募的角色都可以对话** —— 顶部可切角色，每个角色一套独立会话
 *
 * ⚠️ **整个面板的高度是常数**（`100dvh`，立绘高度写死）。这是刻意的，也是本项目
 *    刚栽过的坑（v1.55 用户报「对话框高度固定，不要让高度变化然后整个屏幕都变」）：
 *    对话内容一变长，如果立绘/容器跟着长，整个屏幕就会跳。**唯一滚动的是消息区**。
 *
 * ⚠️ **本组件不调 `useGame()`**。App 每 100ms 重渲一次，这里若订阅了 tick，
 *    流式追加文字时每 100ms 重建一次消息列表 —— 长会话下会明显掉帧。
 *    角色名单改成"每次打开浮层时读一次 `game.state`"，够新，且零订阅。
 */

/**
 * 每个角色最多留几轮（一问一答算一轮）。见 storageKeys 里 AI_CHAT_KEY 的配额说明。
 *
 * ⚠️ **直接跟 `aiApi.MAX_TURNS` 走，不在这儿另写一个数** —— 两个常量各写一份的话，
 *    迟早出现"本地存了 20 轮、只发 10 轮"这种半截状态（用户 2026-09-22 报的
 *    「你这 ai 没有连续对话上下文」里，一半是这个、另一半是字段名发错了，见 aiApi.ts）。
 */
const KEEP_TURNS = MAX_TURNS
/** 单条消息存盘前的上限（字符）。不截的话一条超长回复就能把配额吃掉 */
const MAX_STORE_LEN = 600
/** 云韵是军师本尊：**没招募到她也能聊**（服务端 ownsChar 对她是特例） */
const ADVISOR_ID = 'yunyun'

/**
 * 军师面板里**取哪一张立绘**（v1.62）。用户 2026-09-23：
 *   「ai云韵的立绘换成圣阶那个，现在这个紫色的好丑」。
 *
 * `yunyun_queen` = 「云韵（宗主终极形态）」，品阶**圣阶**（`sheng`）——
 * 同一人物的另一套立绘，黑发金冠那版；原先用的是天阶 `yunyun`（紫发紫袍）。
 *
 * ⚠️ **只换图，不换人**：`ADVISOR_ID` 必须继续是 `'yunyun'`。三条理由 ——
 *    · 服务端 `ownsChar` 对 `'yunyun'` 是特例（**没招募到也能问**）。把 id 改成
 *      `yunyun_queen`，没抽到宗主终极形态的玩家会直接吃 `not_owned`，**军师就用不了了**；
 *    · 顶部名字、`curSub`、会话存储键、限频额度**全挂在 `charId` 上**，换 id 等于换了一个人；
 *    · `yunyun_queen` 在招募页/阵容页是它自己的角色，本文件这里的替换**只作用于军师面板**。
 */
const ADVISOR_PORTRAIT_ID = 'yunyun_queen'

/**
 * 面板内统一走这一支取图。
 *
 * ⚠️ **入口圆钮和面板立绘必须调同一个函数** —— 只改一处的话，云韵会顶上顶着圣阶、
 *    小头像还是旧的紫发，同一个人两张脸。
 */
function advisorPortrait(id: string): string | undefined {
  return portraitFor(id === ADVISOR_ID ? ADVISOR_PORTRAIT_ID : id)
}

/**
 * id → 角色定义。
 *
 * ⚠️ 别用引擎那个 `charLabel(id)` —— **它的名字骗人**：它返回的是整个 `CharacterDef`
 *    对象，不是字符串（`engine.ts` 里就一行 `return CHAR_MAP[id]`）。
 *    直接查这张表，既清楚又不必每次调用。
 */
const CHAR_BY_ID: Record<string, CharacterDef> = Object.fromEntries(CHARACTERS.map(c => [c.id, c]))

/** 显示名：查不到就退回 id（**绝不编一个名字**） */
const nameOf = (id: string) => CHAR_BY_ID[id]?.name || id

type Sessions = Record<string, ChatTurn[]>

function loadSessions(): Sessions {
  try {
    const o = JSON.parse(localStorage.getItem(AI_CHAT_KEY) || '{}')
    if (!o || typeof o !== 'object') return {}
    const out: Sessions = {}
    for (const [k, v] of Object.entries(o as Sessions)) {
      // 形状不对的整条丢掉 —— 聊天记录是**不是进度**的东西，宁可清掉也不能让坏数据
      // 在渲染时炸掉整个浮层（它会盖住整个屏幕，炸了等于游戏打不开）。
      if (!Array.isArray(v)) continue
      out[k] = v.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
    }
    return out
  } catch { return {} }
}

function saveSessions(s: Sessions) {
  try {
    // 存盘前先瘦身：每角色只留最近 KEEP_TURNS 轮、每条截到 MAX_STORE_LEN。
    // localStorage 满了会**抛异常**（QuotaExceededError），这个 try 是必须的。
    const slim: Sessions = {}
    for (const [k, v] of Object.entries(s)) {
      slim[k] = v.slice(-KEEP_TURNS * 2).map(t => ({ role: t.role, text: t.text.slice(0, MAX_STORE_LEN) }))
    }
    localStorage.setItem(AI_CHAT_KEY, JSON.stringify(slim))
  } catch { /* 写不进去就算了：聊天记录丢了不影响任何进度 */ }
}

/**
 * 服务端的 reason → 给玩家看的一句话。
 *
 * ⚠️ 措辞**不能自己编一套词**：reason 是服务端给的原文，这里只负责"怎么说"。
 *    另外"没问到"（网络）与"服务端明确拒绝"必须是两种话 —— 混成一句
 *    "出错了请重试"，玩家会对着一个今天已经问满额度的人反复重试。
 */
function reasonText(reason: string, retryAfter?: number): string {
  switch (reason) {
    case 'rate': return retryAfter ? `说慢些，${retryAfter} 秒后再问。` : '说慢些，稍候再问。'
    case 'daily_quota': return '今日问得够多了，明日再来吧。'
    case 'server_quota': return '今日问的军师太多，明日再来吧。'
    case 'not_owned': return '此人尚未入你门下。'
    case 'unknown_char': return '查无此人。'
    case 'ai_disabled': return '军师此刻不在。'
    case 'no_save': return '尚未寻得你的踪迹 —— 等云档同步好了再问。'
    case 'need_login': return '请先到「存档」页登录，再唤军师。'
    case 'bad_id': return '军师认不出你，请到「存档」页看一眼。'
    case 'too_large': return '这话太长了，省着点说。'
    case 'internal': return '军师走了神，稍后再问。'
    default: return '联络不上军师，稍后再问。'
  }
}

/** 云韵的开场白。**写死，不是 AI 生成的** —— 打开即刻有内容，不必先等一次调用、也不花这个钱。 */
const GREETING = '本座在。想聊点什么？问正事 —— 眼下该做什么、该练谁、哪一步过不去；闲聊也行，说说剧情、说说人。'

// ── 悬浮入口的停靠位置（v1.59）──────────────────────────────────────────
//
// 用户 2026-09-22：「军师那个入口，允许上下拖动吸附侧边栏，一直固定在那个位置会容易挡住按钮」。
// 右下角那颗 56px 的圆钮确实压着一堆页面的主按钮（战斗页的"开战"、装备页的"强化"都在右下方）。
//
// ★ 存的是**比例**（`yRatio` = 离顶 / 可视高），不是像素：手机转屏、或者换一台矮一截的设备，
//   存像素就会把它留在屏幕外。
// ★ `side` 是"最近的边"：拖动松手时看圆心落在屏幕中线哪一侧 —— 这就是"吸附侧边栏"。
type EntryPos = { side: 'left' | 'right'; yRatio: number }
/** 默认位置：右侧、靠下（与原 `bottom-4 right-3` 基本一致，老玩家看不出差别） */
const ENTRY_DEFAULT: EntryPos = { side: 'right', yRatio: 0.88 }
/** 圆钮边长（= `h-14 w-14`）与离屏幕边缘的留白 */
const ENTRY_SIZE = 56
const ENTRY_GAP = 10

function loadEntryPos(): EntryPos {
  try {
    const o = JSON.parse(localStorage.getItem(ADVISOR_POS_KEY) || 'null')
    if (o && (o.side === 'left' || o.side === 'right')
      && typeof o.yRatio === 'number' && Number.isFinite(o.yRatio)) {
      return { side: o.side, yRatio: Math.min(1, Math.max(0, o.yRatio)) }
    }
  } catch { /* 坏数据 ⇒ 回默认位置。入口位置丢了不影响任何进度 */ }
  return ENTRY_DEFAULT
}

function saveEntryPos(p: EntryPos) {
  try { localStorage.setItem(ADVISOR_POS_KEY, JSON.stringify(p)) } catch { /* 写不进去就算了 */ }
}

export default function Advisor() {
  // 入口是否显示，取决于后端状态。`checked=false` 是"还没问到"，此时**什么都不显示** ——
  // 先渲染按钮再让它消失，比不显示更糟。
  const [checked, setChecked] = useState(false)
  const [st, setSt] = useState<AiStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [charId, setCharId] = useState(ADVISOR_ID)
  const [sessions, setSessions] = useState<Sessions>({})
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [ownedIds, setOwnedIds] = useState<string[]>([])
  const abortRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // ── 悬浮入口：停靠位置 + 拖动（见 `EntryPos` 那段注释）──────────────────
  const [entryPos, setEntryPos] = useState<EntryPos>(loadEntryPos)
  /** 拖动途中的实时位置（px，离顶）。`null` = 没在拖，用 `entryPos` 算 */
  const [dragTop, setDragTop] = useState<number | null>(null)
  /** 可视高度。转屏 / 地址栏收起时要重算，所以放 state 而不是读一次 `window` */
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const dragRef = useRef<{ id: number; y0: number; top0: number; moved: boolean } | null>(null)
  /**
   * 拖完那一下会补一个 `click`。不拦的话"拖到别处"会顺手把面板打开 ——
   * 松手即弹窗，看起来就像拖拽坏了。
   * ⚠️ 用 `pointerdown` 清零（而不是在 `click` 里清）：touch 拖拽常常**根本不发 click**，
   *    只在 click 里清的话，这个标记会一直挂着，把**下一次真正的点击**吃掉。
   */
  const suppressTap = useRef(false)

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  /** 圆钮必须完整停在屏幕里（拖到边缘也只贴边，不出去） */
  const clampTop = useCallback((y: number) =>
    Math.max(ENTRY_GAP, Math.min(Math.max(ENTRY_GAP, vh - ENTRY_SIZE - ENTRY_GAP), y)), [vh])

  const topNow = clampTop(dragTop ?? entryPos.yRatio * vh)

  const onEntryDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    suppressTap.current = false
    dragRef.current = { id: e.pointerId, y0: e.clientY, top0: e.currentTarget.getBoundingClientRect().top, moved: false }
    // 抓住指针：手指滑出这颗钮之后依然收得到 move/up（否则一滑快就"拖丢了"）
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老浏览器没有就算了 */ }
  }, [])

  const onEntryMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dy = e.clientY - d.y0
    // 6px 之内算"手抖"，不算拖动 —— 触屏点一下本来就会有 1~3px 的位移
    if (!d.moved && Math.abs(dy) < 6) return
    d.moved = true
    setDragTop(clampTop(d.top0 + dy))
  }, [clampTop])

  const onEntryUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    dragRef.current = null
    setDragTop(null)
    if (!d || !d.moved) return          // 没真拖 ⇒ 交给 onClick 去开面板
    suppressTap.current = true
    // 吸附：看**圆心**落在屏幕中线哪一侧（不是看手指，手指可能已经在屏幕外了）
    const side: EntryPos['side'] = e.clientX < window.innerWidth / 2 ? 'left' : 'right'
    const next: EntryPos = { side, yRatio: clampTop(d.top0 + (e.clientY - d.y0)) / Math.max(1, vh) }
    setEntryPos(next)
    saveEntryPos(next)
  }, [clampTop, vh])

  /**
   * 面板开着的时候锁住背景滚动（v1.59）。
   *
   * 用户报「军师页面不是一屏展示的」。这一条堵的是它的另一半：面板虽是 `fixed inset-0`，
   * 但**底下的游戏页面照样能滚**（手机上手指落在面板外缘、或惯性甩一下就会带动它），
   * 表现就是"这个页面能滑动、不是一屏"。锁的只是浮层开着的那段时间。
   */
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // 启动时问一次状态。2.5 秒超时（`fetchAiStatus` 内置）：后端挂了也不能拖住页面。
  useEffect(() => {
    let alive = true
    fetchAiStatus().then(s => { if (alive) { setSt(s); setChecked(true) } })
    return () => { alive = false }
  }, [])

  /** 打开浮层：读一次角色名单（**不订阅 tick**，见文件头） */
  const openPanel = useCallback(() => {
    const roster = game.state.roster || {}
    // 军师永远第一个，其余按 CHARACTERS 的固有顺序（与阵容页/后端名录同序）
    const ids = CHARACTERS.map(c => c.id).filter(id => id !== ADVISOR_ID && roster[id])
    setOwnedIds(ids)
    setSessions(loadSessions())
    setErr('')
    setOpen(true)
    /**
     * ★ 军师读的是**云档**（服务端权威，见 `api.cjs` 的 `stateOf`）。
     *
     * 而正式服此刻灰度 0% ⇒ 绝大多数玩家跑的是**本地模式**，进度只在本机，
     * 要等 `startCloudSync` 那个 180 秒的周期才会过一次云。于是新号（或刚改完进度的人）
     * 第一次点开军师，拿到的是「尚未寻得你的踪迹」—— 功能看起来是坏的，其实只是还没同步。
     *
     * 这里补一次**非强制**上传，语义正好是"确保云端有本机这份档"：
     *   · 云端已有 ⇒ `lastHash` 命中，**一个请求都不发**
     *   · 本机变过 ⇒ 真上传一次（等于把那次同步提前）
     * ⚠️ **不会盖掉任何好档**：服务端对"云端进度更高"回 `stale` 并拒绝，
     *    这条保护与 `startCloudSync` 走的是同一条路，这里没有引入新语义。
     * ⚠️ 远程模式下状态本来就在服务端，不需要也不该传（`App.tsx` 起同步时也是这么判的）。
     */
    if (!game.isRemote()) void uploadSave()
  }, [])

  const closePanel = useCallback(() => {
    // ⚠️ 关掉就**停掉正在生成的这一条** —— 否则玩家关了面板，服务端还在替他跟模型说话（花他的钱）。
    //    不主动 abort 也不是不能停（后端挂了 `res.on('close')`），但那要多绕一个来回。
    abortRef.current?.()
    abortRef.current = null
    setBusy(false)
    setOpen(false)
    setPickerOpen(false)
  }, [])

  const turns = sessions[charId] || []

  // 新消息进来滚到底。**只滚消息区这一层**（它是 `overflow-y-auto`），
  // 浮层本身是 `overflow-hidden` 的定高容器 —— 这是"整个屏幕不会变"的实现方式。
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy, open])

  const send = useCallback((q: string) => {
    const text = q.trim()
    if (!text || busy) return
    setErr('')
    setDraft('')
    setBusy(true)
    const base = sessions[charId] || []
    // 先落一条空的助手气泡，流式的字往里追加；出错时若还是空的就把它撤掉
    const withPending: ChatTurn[] = [...base, { role: 'user', text }, { role: 'assistant', text: '' }]
    const commit = (list: ChatTurn[]) => setSessions(prev => {
      const next = { ...prev, [charId]: list }
      saveSessions(next)
      return next
    })
    setSessions(prev => ({ ...prev, [charId]: withPending }))

    const patchLast = (fn: (t: string) => string) => setSessions(prev => {
      const list = prev[charId] || []
      if (!list.length) return prev
      const copy = list.slice()
      const last = copy[copy.length - 1]
      if (!last || last.role !== 'assistant') return prev
      copy[copy.length - 1] = { role: 'assistant', text: fn(last.text) }
      return { ...prev, [charId]: copy }
    })

    abortRef.current = askAdvisor(charId, text, base, {
      onText: t => patchLast(s => s + t),
      onDone: () => {
        abortRef.current = null
        setBusy(false)
        // 收尾时才写盘（流式途中每 45ms 写一次 localStorage 是白费）
        setSessions(prev => {
          const list = (prev[charId] || []).slice(-KEEP_TURNS * 2)
          const next = { ...prev, [charId]: list }
          saveSessions(next)
          return next
        })
      },
      onError: (reason, detail, retryAfter) => {
        abortRef.current = null
        setBusy(false)
        setErr(reasonText(reason, retryAfter))
        commit(base)   // 这一问整条撤掉（连问题一起）—— 留一个空气泡比什么都没有更让人摸不着头脑
        void detail
      },
    })
  }, [busy, charId, sessions])

  // 状态没问到（后端没有这个端点 / 断网）或后端明确说没开 ⇒ 整个功能不出现。
  if (!checked || !st || !st.enabled) return null

  const cur = CHAR_BY_ID[charId]
  const curName = charId === ADVISOR_ID ? '云韵' : nameOf(charId)
  const curSub = charId === ADVISOR_ID
    ? '军师 · 云岚宗宗主'
    : `${cur ? (RARITY_INFO[cur.rarity]?.label || '') : ''}${cur ? ` · ${cur.name}` : ''}`

  return (
    <>
      {/* ── 入口：可上下拖动的悬浮头像 ──
          为什么不做成第 11 个页签：用户 2026-09-20 刚把十一个页签合并成十个
          （「两个世界boss合并到一起…内部分tab就行」），页签条在窄屏上已经要横向滚两屏。
          军师是"随时能问"，不是"一个要去的位置"，悬浮按钮才对。
          ⚠️ `z-30` **低于**新手引导的 `z-50`：引导期间它被遮罩盖住、点不到 —— 这是对的，
             新玩家先过剧情。
          ★ v1.59：可以**上下拖**，松手自动吸到最近的那一侧（见 `EntryPos` 那段注释）。
            拖动期间 `dragTop` 接管 `top`，所以是跟着手指走的。
          ⚠️ `touch-action: none` 是必须的：不加的话手机上竖着拖会先被浏览器当成**滚页面**，
             手指一走钮就停在原地。 */}
      {!open && (
        <div className="fixed z-30"
          style={{
            top: topNow,
            ...(entryPos.side === 'left' ? { left: ENTRY_GAP } : { right: ENTRY_GAP }),
          }}>
          {/* ── 光效（用户 2026-09-22：「ai 军师能不能做个什么简单的光效或者动画动态的，吸引一些注意力」）──
              做法：钮的外圈放一圈**慢慢呼吸的金色环**（`animate-ping` 放慢到 2.2s —— 默认的 1s 太跳）。
              纯装饰：`pointer-events-none` + `aria-hidden`，**不吃点击、不进无障碍树**。
              ⚠️ 必须放在钮的**外面**：钮上有 `overflow-hidden`（裁立绘用的），放里面会被裁得一干二净。 */}
          <span aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-dq-gold/70 animate-ping [animation-duration:2.2s]" />
          <button data-advisor-entry aria-label="唤出军师云韵（可上下拖动）"
            onPointerDown={onEntryDown} onPointerMove={onEntryMove}
            onPointerUp={onEntryUp} onPointerCancel={onEntryUp}
            onClick={() => { if (suppressTap.current) { suppressTap.current = false; return } openPanel() }}
            style={{ touchAction: 'none' }}
            className="dq-tap relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-dq-gold bg-dq-panel shadow-lg shadow-black/50">
            {advisorPortrait(ADVISOR_ID)
              ? <img src={advisorPortrait(ADVISOR_ID)} alt="云韵" draggable={false} className="pointer-events-none h-full w-full object-cover object-[50%_18%]" />
              : <span className="text-lg text-dq-gold">韵</span>}
          </button>
          {/* ── 文字标注：光效只负责"吸引注意"，它到底是什么还得写出来（用户同一条要求的后半句）。
              贴钮的下缘居中；`whitespace-nowrap` + 10px 保证吸边时也不会被屏幕切掉。 ── */}
          <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] leading-none text-dq-gold">AI 军师</span>
        </div>
      )}

      {open && (
        <div data-advisor-panel
          className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
          {/* ⚠️ 整个面板 `h-[100dvh]` 且 `overflow-hidden`：任何"内容变长就把面板撑高"
              的写法都会让整屏跟着动（v1.55 的坑）。滚动只发生在下面那个消息区里。 */}
          <div className="mx-auto flex h-full w-full max-w-[1120px] flex-col overflow-hidden border-dq-border bg-dq-panel md:flex-row md:border-x"
            style={{ height: '100dvh' }}>

            {/* ── 立绘 ──
                手机：顶部一条，高度写死 `32dvh`。
                桌面：左栏，占满整高（`md:h-full`）。
                两个断点下高度都**不随内容变化**。 */}
            <div className="relative h-[32dvh] shrink-0 overflow-hidden md:h-full md:w-[40%]">
              {advisorPortrait(charId)
                ? <img src={advisorPortrait(charId)} alt={curName}
                    className="h-full w-full object-cover object-[50%_15%]" />
                : <div className="flex h-full w-full items-center justify-center text-4xl text-dq-gold">{curName.slice(0, 1)}</div>}
              {/* 名字压在立绘下缘 */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
                <div className="text-base text-dq-gold">{curName}</div>
                <div className="text-[11px] text-[#a89478]">{curSub}</div>
              </div>
              <button onClick={closePanel} aria-label="关闭"
                className="dq-tap absolute left-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-[#d8c8a8]">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── 对话侧 ── */}
            <div className="flex min-h-0 flex-1 flex-col">
              {/* 顶栏：换人 */}
              <div className="relative flex shrink-0 items-center justify-between border-b border-dq-border px-3 py-1.5">
                <span className="text-xs text-[#a89478]">与她说话</span>
                {ownedIds.length > 0 && (
                  <button onClick={() => setPickerOpen(v => !v)} data-advisor-picker
                    className="dq-tap inline-flex items-center gap-1 rounded border border-dq-border px-2 py-1 text-xs text-dq-gold">
                    换个人 <ChevronDown className="h-3 w-3" />
                  </button>
                )}
                {pickerOpen && (
                  <div className="absolute right-2 top-full z-10 max-h-[45dvh] w-56 overflow-y-auto rounded border border-dq-border bg-dq-panel shadow-lg shadow-black/60">
                    {[{ id: ADVISOR_ID, label: '云韵 · 军师' },
                      ...ownedIds.map(id => ({ id, label: nameOf(id) }))].map(o => (
                      <button key={o.id} onClick={() => { setCharId(o.id); setPickerOpen(false); setErr('') }}
                        className={`dq-tap block w-full truncate px-3 py-2 text-left text-xs hover:bg-black/30 ${o.id === charId ? 'text-dq-gold' : 'text-[#d8c8a8]'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── 消息区：**全屏唯一的滚动条** ──
                  ★ `overscroll-contain`：滚到顶/底之后再甩手指，别把滚动**传给底下的页面**
                  （传过去就是"这个浮层还能跟着滑"，正是"不是一屏"的那个手感）。 */}
              <div ref={scrollRef} data-advisor-msgs
                className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
                {turns.length === 0 && (
                  <>
                    <Bubble who={curName} text={GREETING} />
                    {/* 三个快捷问题 = 用户原话那三问。写死，点了直接发。 */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['我现在该做什么？', '我该练谁？', '这一步怎么做？'].map(q => (
                        <button key={q} onClick={() => send(q)} data-advisor-quick
                          className="dq-tap rounded-full border border-dq-border px-3 py-1 text-xs text-dq-gold hover:bg-black/30">
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {turns.map((t, i) => (
                  <Bubble key={i} who={t.role === 'user' ? '你' : curName} mine={t.role === 'user'} text={t.text} />
                ))}
                {/* ⚠️ 这里**曾经**还有一条"正在想"的气泡（`busy && 最后一条是空助手`）。
                    v1.59 删掉了：`send()` 早就先塞了一条空的助手气泡进去，而 `Bubble`
                    对空 `text` 渲染的就是「……」⇒ 同一时刻**两个省略号气泡**叠在一起。
                    （用户 2026-09-22 报：「对话loding气泡 会有两个...气泡loding」。）
                    要加回"正在想"的视觉，改 `Bubble` 自己，别再在外面挂第二条。 */}
              </div>

              {err && (
                <div data-advisor-err className="shrink-0 px-3 pb-1 text-center text-[11px] text-dq-fire">{err}</div>
              )}

              {/* ── 输入区（固定在底部）── */}
              <div className="flex shrink-0 items-end gap-2 border-t border-dq-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
                  data-advisor-input placeholder="问军师点什么…" maxLength={300}
                  onKeyDown={e => {
                    // 回车发送（手机上用"换行"键），Shift+Enter 换行
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft) }
                  }}
                  className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded border border-dq-border bg-black/30 px-2 py-2 text-base text-[#e8dcc8] outline-none placeholder:text-[#6b5c48]" />
                <button onClick={() => send(draft)} disabled={busy || !draft.trim()} data-advisor-send
                  aria-label="发送"
                  className="dq-tap inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-dq-gold text-black disabled:opacity-40">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 一条气泡。`text` 为空时给个省略号（流式还没吐字 / 正在想）
 *
 * ⚠️ **字号 15px 是下限，别再往回调**：12px（`text-xs`）在手机上是"看着费劲"那一档，
 *    用户 2026-09-22 刚为字号提过两条（剧情对话 + 这里）。
 *    输入框那边是 **16px**，比这里还大一档 —— 那不是风格问题：**iOS Safari 在聚焦
 *    字号 <16px 的输入框时会把整页放大**，而放大之后页面自然"不是一屏"了。
 *    用户原话「军师页面不是一屏展示的，不要允许缩放」说的正是这件事。
 *    ⇒ 输入框 16px 是**功能约束**，不是审美；两处差这 1px 是刻意的。
 */
function Bubble({ who, text, mine }: { who: string; text: string; mine?: boolean }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[15px] leading-relaxed ${
        mine ? 'bg-dq-gold/20 text-[#e8dcc8]' : 'border border-dq-border bg-black/30 text-[#e8dcc8]'}`}>
        <div className={`mb-0.5 text-[11px] ${mine ? 'text-dq-gold' : 'text-[#a89478]'}`}>{who}</div>
        {text || '……'}
      </div>
    </div>
  )
}