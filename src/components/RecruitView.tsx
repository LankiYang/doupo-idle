import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Swords } from 'lucide-react'
import { useGame, game, charLabel, rarityInfo, baseCombatEffectOf, newbieCurrent, BASE_CRIT_DMG, type CombatEffect } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { LINK_POSTER_KEY } from '../game/storageKeys'
import linkPoster from '../assets/sprites/link/poster.webp'
import {
  CHARACTERS, RARITY_INFO, ROLE_LABEL, ROLE_TARGET_HINT,
  DUTY_OF_ROLE, DUTY_LABEL, DUTY_COLOR, FACTIONS, FACTION_OF,
  shardCostOf, isLinkChar, linkActive, linkRemainMs, linkClosedText, LINK_START_MS, LINK_SHARD_COST,
  type CharacterDef, type Rarity,
} from '../game/data'

/**
 * 全站统一的角色排序：品阶从高到低（圣 → 黄）。
 * 同品阶内保持 data.ts 的定义顺序（Array.sort 是稳定的，不需要第二个比较键）。
 * 收成一个函数是因为"三处各排各的"必然会分叉——卡池、兑换区、图鉴必须是同一份名单顺序。
 */
const byRarityDesc = (a: CharacterDef, b: CharacterDef) =>
  RARITY_INFO[b.rarity].order - RARITY_INFO[a.rarity].order

/**
 * 抽卡动画的节拍（v1.43）。
 *
 * `PULL_STEP_MS` 是**每张卡之间的间隔**：十连 90×9 = 810ms 全部翻完 ——
 * 比这慢会让人等，比这快就"看不出一张一张"。单抽不受影响（第一张的延迟恒为 0）。
 *
 * ⚠️ 这个数只写在 `animation-delay` 上（缘故见 index.css 那段说明）：卡在第一次渲染
 * 时就全在 DOM 里，所以**改它只改快慢，不改任何脚本读到的东西**。
 */
const PULL_STEP_MS = 90
/** 顶部公告挂多久：够读完一行字，又不至于赖在屏幕上（另有关闭按钮） */
const ANNOUNCE_MS = 6000

type PullResult = { id: string; isNew: boolean; rarity: Rarity; pity: boolean; shard: number; essence: number }

/**
 * 联动倒计时的显示格式：`小时:分`（如 `23:59`）。
 *
 * 刻意用数字而不是「23 小时 59 分」：**限时活动的时间必须一直挂在屏幕上**，
 * 而中文写法每跨一个量级就换一次宽度（"9 小时 5 分" ↔ "23 小时 59 分"），
 * 会把它左边的标题推来推去。数字写法配 `tabular-nums` + 定宽容器，一个字都不动。
 */
function remainText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

/**
 * 职业效果的措辞（数值来自引擎 `baseCombatEffectOf`，这里只决定怎么说）。
 * 与阵容页那份是同一条规矩：系数（1.5 / 0.75 / 0.55）留在引擎里，界面不复述。
 */
function effectView(e: CombatEffect): { label: string; value: string; hint?: string } {
  switch (e.kind) {
    case 'heal': return { label: '初始每次回复', value: String(e.value), hint: '单体 · 治血线最低的队友' }
    case 'heal_aoe': return { label: '初始每次回复', value: String(e.value), hint: '群体 · 每人（≈单奶一半）' }
    case 'aoe': return { label: '群攻每目标', value: String(e.value), hint: '伤害基数，未计敌方防御' }
    case 'control': return {
      label: '压制',
      value: `攻 -${e.atkPct}% / 防 -${e.defPct}%`,
      hint: `命中后 ${e.rounds} 回合`,
    }
  }
}

/**
 * 保底进度条。保底必须看得见——看不见的话玩家只会记得"我又空手了"，
 * 不会记得"我离保底近了 8 抽"，那这个机制在体验上就等于不存在。
 */
function PityBar({ label, cur, max, color }: { label: string; cur: number; max: number; color: string }) {
  const left = Math.max(0, max - cur)
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px]">
        <span style={{ color }}>{label}</span>
        <span className={left === 0 ? 'text-dq-gold' : 'text-[#a89478]'}>
          {left === 0 ? '下一抽必出' : `还有 ${left} 抽`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-black/40">
        <div className="h-1.5 rounded transition-[width] duration-300"
          style={{ width: `${Math.min(100, (cur / max) * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

/**
 * 武魂详情浮层：结缘页上任意一张角色卡（兑换区 / 招募结果 / 武魂名录）点开都能看立绘与人设。
 *
 * 和阵容页那份「武魂」详情**不能复用**：那里的角色一定已收录，面板里塞满了等级、星级、
 * 修炼进度、上阵/放生按钮；而结缘页点开的角色**多半还没拥有**——那些字段根本没有值。
 * 所以这里只讲"这角色是谁、怎么打、初始属性多少"，属性一律给 1 级基础值并标明"初始"，
 * 免得玩家拿它和阵容页里的当前属性对不上。
 */
function RecruitDetail({ c, owned, shards, onClose, onRedeem }: {
  c: CharacterDef
  owned: boolean
  shards: number
  onClose: () => void
  onRedeem: () => void
}) {
  const rarity = rarityInfo(c.rarity)
  // 职责（战斗/坦克/医师）与攻击方式（群攻/单体…）是两件正交的事，两个标签都要给：
  // 只标"坦克"玩家不知道它打得怎么样，只标"群攻"又不知道它该站哪
  const duty = DUTY_OF_ROLE[c.role]
  const faction = FACTION_OF[c.id] ? FACTIONS[FACTION_OF[c.id]] : null
  const portrait = portraitFor(c.id)
  const cost = shardCostOf(c)
  const afford = shards >= cost
  // 限时联动：活动结束后这名武魂不再可获得（已拥有的照常显示战力，不受影响）
  const linkOver = isLinkChar(c.id) && !linkActive()
  // powerOf 对未收录的角色返回 0（不是抛错），所以这里可以直接调，不用先判 owned。
  // 取整：它返回的是 charPower 的**未取整**值（装备一键最优穿戴拿它当搜索目标，要小数），
  // 直接渲染会显示 35.1795 这种数；群雄榜的 combatPower 与装备页的涨幅都是 Math.round 过的
  const power = Math.round(game.powerOf(c.id))

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      {/* 遮罩 ≠ 背景：浮层必须自带实心底色（bg-dq-panel），只靠 bg-black/75 那层半透明遮罩
          在浅色立绘上会透出底下的卡片，字就读不清了 */}
      <div className="max-h-full w-full max-w-sm overflow-auto rounded-md border-2 bg-dq-panel p-4 shadow-2xl"
        style={{ borderColor: rarity.color }} onClick={e => e.stopPropagation()}>
        <div className="relative">
          {portrait && (
            <div className="mx-auto w-32 overflow-hidden rounded border sm:w-40" style={{ borderColor: rarity.color }}>
              <img src={portrait} alt={c.name} className="aspect-square w-full object-cover" />
            </div>
          )}
          <button onClick={onClose} aria-label="关闭"
            className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-dq-border bg-black/70 text-xs text-[#c9bda4] hover:border-dq-gold hover:text-dq-gold">
            ×
          </button>
        </div>

        <div className="mt-3 text-center">
          <div className="text-xl" style={{ color: rarity.color }}>{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
            <span className="rounded px-1.5 py-0.5 text-black" style={{ background: DUTY_COLOR[duty] }}>{DUTY_LABEL[duty]}</span>
            <span className="rounded border border-dq-border px-1.5 py-0.5 text-[#c9bda4]">{ROLE_LABEL[c.role]}</span>
            {faction && (
              <span className="rounded border px-1.5 py-0.5"
                style={{ color: faction.color, borderColor: faction.color }}>
                {faction.name}
              </span>
            )}
            <span className="px-1 text-[#a89478]">{rarity.label}</span>
            <span className="rounded border border-dq-border px-1.5 py-0.5 text-[#a89478]">
              {c.position === 'front' ? '推荐前排' : '推荐后排'}
            </span>
          </div>
          <div className="mt-2 text-xs text-[#a89478]">{c.desc}</div>
          {/* 打法说明：把引擎里的目标选择规则摆到明面上，玩家抽到就知道"他会去打谁" */}
          <div className="mt-1 flex items-center gap-1 text-xs text-dq-fire/80">
            <Swords size={12} className="shrink-0" />
            {/* `data-role-hint` 是给 `temp/shot-control-hint.cjs` 用的锚点。
                v1.44 之前这行开头是 `⚔` 字形，那个出图脚本靠"从 innerText 里按 ⚔ 起头截到下一个字"
                来取这段说明；字形换成 lucide 之后那条正则再也匹配不到 ——
                而它匹配不到只会打印「未找到」，**看起来像故障、其实是我改对了**（红线㉘的同一形态）。
                锚点改成显式 data 属性，从此与装饰字形脱钩。
                ⚠️ 这件注释里**不许写正则字面量** —— 里面那个"斜杠加星号"会把 JSX 注释提前闭合，
                剩下半行当场变成代码。这个坑刚踩过：tsc 静默通过（它按注释收场了），
                rolldown 在二十行之外报「Expected `}`」。 */}
            <span data-role-hint>{ROLE_TARGET_HINT[c.role]}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-dq-border pt-3 text-center">
          <div data-stat="recruit-baseAtk">
            <div className="text-[10px] text-[#a89478]">初始攻击</div>
            <div className="text-sm text-[#e8dcc8]" data-stat-value>{c.baseAtk}</div>
          </div>
          <div data-stat="recruit-baseDef">
            <div className="text-[10px] text-[#a89478]">初始防御</div>
            <div className="text-sm text-[#e8dcc8]" data-stat-value>{c.baseDef}</div>
          </div>
          <div data-stat="recruit-baseHp">
            <div className="text-[10px] text-[#a89478]">初始气血</div>
            <div className="text-sm text-[#e8dcc8]" data-stat-value>{c.baseHp}</div>
          </div>
        </div>

        {/* 暴击与职业效果：兑换前最该知道的两件事 —— 他是不是个能奶的、能不能打一群。
            数值走引擎（baseCombatEffectOf / BASE_CRIT_DMG），界面不复述系数 */}
        {(() => {
          const ev = baseCombatEffectOf(c)
          const view = ev ? effectView(ev) : null
          return (
            <div className={`mt-2 grid gap-2 text-center ${view ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div data-stat="recruit-critRate">
                <div className="text-[10px] text-[#a89478]">初始暴击率</div>
                <div className="text-sm text-[#e8dcc8]" data-stat-value>0%</div>
              </div>
              <div data-stat="recruit-critDmg">
                <div className="text-[10px] text-[#a89478]">暴击伤害</div>
                <div className="text-sm text-[#e8dcc8]" data-stat-value>+{BASE_CRIT_DMG}%</div>
              </div>
              {view && (
                <div data-stat={`recruit-effect-${ev!.kind}`}>
                  <div className="text-[10px] text-[#a89478]">{view.label}</div>
                  <div className="text-sm text-[#e8dcc8]" data-stat-value>{view.value}</div>
                </div>
              )}
            </div>
          )
        })()}
        <div className="mt-1 text-center text-[10px] leading-relaxed text-[#5a4a38]">
          暴击率只从装备词条来；上阵且凑齐同阵营后另有羁绊加成
        </div>

        <div className="mt-3 border-t border-dq-border pt-3 text-center text-[11px]">
          {owned ? (
            <div className="text-[#a89478]">
              <span className="text-green-500">已收录</span> · 当前战力 <span className="text-dq-gold">{power}</span>
            </div>
          ) : linkOver ? (
            /* 限时联动**当前拿不到**的未拥有角色：图鉴仍留名（让玩家知道缺的是谁），
               但不再摆一个必然失败的按钮。措辞按时段取（活动开始前说"已结束"是假话） */
            <div data-link-over className="text-[#a89478]">
              {linkClosedText()}
            </div>
          ) : (
            <>
              <div className="mb-2 text-[#a89478]">
                尚未收录 · 兑换需 ✨×{cost}（现有 {shards}）
              </div>
              <button onClick={onRedeem} disabled={!afford}
                className="w-full rounded bg-dq-fire py-1.5 text-black disabled:opacity-40">
                {afford ? `兑换武魂（✨×${cost}）` : '碎片不足'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function RecruitView() {
  const state = useGame()
  const [results, setResults] = useState<PullResult[]>([])
  /**
   * 抽卡轮次：唯一的用途是给结果卡换 `key`。
   * `key={i}` 时连抽两次，React 会复用同一批 DOM 节点 ⇒ **第二次的入场动画不会重放**
   * （动画在同一个节点上已经播完过一次），表现是"第二次抽卡没有动画"。
   */
  const [round, setRound] = useState(0)
  /** 圣阶顶部公告：`null` = 不显示。存 id 列表是因为十连里可能不止一名圣阶 */
  const [announce, setAnnounce] = useState<string[] | null>(null)
  const [pick, setPick] = useState<CharacterDef | null>(null)
  // 详情浮层：兑换区 / 招募结果 / 武魂名录三处的卡片共用一个详情，
  // 所以存的是角色本身而不是"哪张卡" —— 同一角色从哪点进来看到的都必须一样
  const [detail, setDetail] = useState<CharacterDef | null>(null)
  const [toast, setToast] = useState('')
  /** 联动海报浮层：活动期内、且**这一轮联动**还没弹过时打开（判定见下面的 effect） */
  const [poster, setPoster] = useState(false)
  /** 倒计时心跳：活动结束的那一刻界面要自己翻面，不能等下一次存档变化 */
  const [, linkTick] = useState(0)
  /** 圣阶公告的定时器：它要等那张卡翻出来才响，中途再抽一次必须把上一次的掐掉 */
  const annTimer = useRef<number | null>(null)
  const pity = game.pityState()

  /** 联动是否进行中。**每次渲染重新算** —— 它是个纯函数，不需要塞进 state */
  const linkOn = linkActive()

  useEffect(() => {
    if (!linkOn) return
    const t = setInterval(() => linkTick(n => n + 1), 30000)
    return () => clearInterval(t)
  }, [linkOn])

  // 切页/卸载时把公告的定时器一起带走，免得它在一个已经不在的组件上 setState
  useEffect(() => () => { if (annTimer.current !== null) window.clearTimeout(annTimer.current) }, [])

  // 公告到点自己收（关掉它 = 提前把 announce 置空，effect 跟着清理重来）
  useEffect(() => {
    if (!announce) return
    const t = window.setTimeout(() => setAnnounce(null), ANNOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [announce])

  useEffect(() => {
    if (!linkActive()) return
    // "弹过了"存的是**这一轮活动的起始时刻**：下次再开新联动时间戳不同，会自动再弹，不用人工清
    if (localStorage.getItem(LINK_POSTER_KEY) === String(LINK_START_MS)) return
    setPoster(true)
  }, [])

  const closePoster = () => {
    setPoster(false)
    // 隐私模式下 localStorage 会抛异常 —— 写不进去只是"下次还会弹"，不该影响关掉海报
    try { localStorage.setItem(LINK_POSTER_KEY, String(LINK_START_MS)) } catch { /* ignore */ }
  }

  const shards = state.inventory.shard ?? 0
  // 只列未拥有的：已拥有的会被引擎拒掉，摆出来只是让玩家点一个必然失败的按钮。
  // 联动角色在**活动结束后**从兑换区移出（图鉴里仍留名，见 catalog）
  const unowned = CHARACTERS
    .filter(c => !state.roster[c.id] && (!isLinkChar(c.id) || linkOn))
    // 活动期内联动角色排最前：这是当期主推，淹在 8 个圣阶里就等于没做
    .sort((a, b) => (Number(isLinkChar(b.id)) - Number(isLinkChar(a.id))) || byRarityDesc(a, b))
  // 图鉴（`...` 复制一份再排，CHARACTERS 是 import 的常量数组，原地 sort 会污染所有用它的地方）
  const catalog = [...CHARACTERS].sort(byRarityDesc)

  /**
   * ⚠️ `await`：远程模式下抽卡是**服务端**执行的（SPEC §4.6），结果要一个来回才有。
   *    本地模式返回的是普通数组，`await` 一个非 Promise 照常成立 —— 两种模式同一份代码。
   *    这也是"抽到什么不再是客户端说了算"的落点：下面这个 `r` 直接来自服务端的 `result`。
   */
  const pull = async (times: 1 | 10) => {
    const r = await game.recruit(times)
    if (r.length === 0) return
    setRound(k => k + 1)   // 换 key ⇒ 结果卡重新挂载 ⇒ 入场动画每次都重放
    setResults(r)

    // 圣阶的顶部公告**等那张卡翻出来再报**：抽中的那一瞬间就弹等于给自己剧透，
    // 而且公告与卡片是同一件事的两面，错开 90ms×序号 看起来才像"抽到了才报喜"。
    if (annTimer.current !== null) window.clearTimeout(annTimer.current)
    const sheng = r.filter(x => x.rarity === 'sheng')
    if (sheng.length === 0) {
      // 连抽两次、第二次没出圣阶时，上一轮的公告不该还挂在那儿（它已经不是"刚抽到的"了）
      setAnnounce(null)
      return
    }
    const at = r.findIndex(x => x.rarity === 'sheng')
    annTimer.current = window.setTimeout(() => {
      annTimer.current = null
      setAnnounce(sheng.map(x => x.id))
    }, at * PULL_STEP_MS + 320)
  }

  // 新手之路第 3 步指向的就是这两个按钮：呼吸灯亮在**引导话术指的那一个**上
  // （够十连时引导条写的是「十连必出天阶」，那就该亮十连那个；亮错一个等于指错路）。
  const nbRecruit = newbieCurrent(state)?.key === 'recruit'
  /*
   * ⚠️ **这一页的 `✨` 是故意留着的，别顺手"清理"掉。**
   * 它出现在价格与角标里（`✨×60`、`✨+N`），而 `verify-shard` / `verify-recruit-detail` /
   * `verify-link-ui` / `verify-prod-v125` / `verify-pull-anim` 五条脚本**按 `✨×\d+` 与 `✨\+\d+`
   * 的正则从 innerText 里读价格**（其中 verify-prod-v125 是打线上跑的）。
   * 把它换成 `<Ico>` 只换来一个"更精致"的观感，代价是五条脚本当场变红 ——
   * 而且它们是**老锚点**，红的原因还不好认（regex 匹配不到只会让断言静默失败）。
   * 真要换，得先同步改那五条脚本的取值方式（改成读 `data-*` 属性），是一次独立的改动。
   */
  const nbTenPull = nbRecruit && Math.floor(state.inventory.yuanfen ?? 0) >= 10
  const nbOnePull = nbRecruit && !nbTenPull

  async function doRedeem() {
    if (!pick) return
    const r = await game.redeemShard(pick.id)
    setToast(r.ok ? `✨ 碎片凝聚成形，获得「${pick.name}」` : ` ${r.why ?? '兑换失败'}`)
    setPick(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        {/* 限时联动横幅。⚠️ 结构写死成"两行固定高度"，倒计时只换数字不换布局：
            这一页的红线是"数据在变不许把版面推来推去"（见 probe-boss-jitter 的同类教训） */}
        {linkOn && (
          <div data-link-banner className="mb-3 rounded border px-2 py-1.5 text-left"
            style={{ borderColor: '#5eead4' }}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span style={{ color: '#5eead4' }}>凡人修仙传 联动进行中</span>
              <span className="shrink-0 tabular-nums text-[#c9bda4]" data-link-remain>
                剩余 <span className="inline-block w-[38px] text-right">{remainText(linkRemainMs())}</span>
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-[#a89478]">
              韩立 / 银月 限时加入招募（圣阶）· 兑换需 ✨×{LINK_SHARD_COST} · 结束后移出卡池与兑换
            </div>
          </div>
        )}
        <div className="mb-1 text-dq-gold">招募天下豪杰</div>
        <div className="mb-3 text-sm text-[#a89478]">消耗缘分丹招募武魂</div>
        <div className="mb-3 space-y-2 text-left">
          <PityBar label="天阶保底" cur={pity.tian.cur} max={pity.tian.max} color={RARITY_INFO.tian.color} />
          <PityBar label="准圣保底" cur={pity.quasi.cur} max={pity.quasi.max} color={RARITY_INFO.quasi.color} />
          <PityBar label="圣阶保底" cur={pity.sheng.cur} max={pity.sheng.max} color={RARITY_INFO.sheng.color} />
        </div>
        <div className="flex flex-col justify-center gap-2 sm:flex-row sm:gap-3">
          <button onClick={() => pull(1)} disabled={(state.inventory.yuanfen ?? 0) < 1}
            data-newbie-hint={nbOnePull ? '1' : undefined}
            className={`rounded bg-dq-gold px-4 py-2 text-sm text-black disabled:opacity-40 ${nbOnePull ? 'dq-breath' : ''}`}>
            招募一次（缘分丹×1）
          </button>
          <button onClick={() => pull(10)} disabled={(state.inventory.yuanfen ?? 0) < 10}
            data-newbie-hint={nbTenPull ? '1' : undefined}
            className={`rounded bg-dq-fire px-4 py-2 text-sm text-black disabled:opacity-40 ${nbTenPull ? 'dq-breath' : ''}`}>
            招募十次（缘分丹×10）
          </button>
        </div>

        {/* ★ 抽奖结果：紧接抽卡按钮的下方。v1.43 之前它在**碎片兑换之后**，
            与"我刚抽到了什么"隔着一整个兑换区（用户原话：「抽奖之后的结果放到
            点击抽卡按钮紧接着的下方区域」）。
            ⚠️ 十张卡在第一次渲染时就全在 DOM 里，错峰只做在 animation-delay 上 ——
            缘故见 index.css 那段（整站脚本都在抽完 150ms 内读 body.innerText）。 */}
        {results.length > 0 && (
          <div data-pull-results className="mt-3 border-t border-dq-border pt-3 text-left">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="text-dq-gold">本次招募结果</span>
              <span className="text-[#a89478]">点击卡片查看详情</span>
            </div>
            <div className="grid grid-cols-4 gap-2 md:grid-cols-5">
              {results.map((r, i) => {
                const cdef = charLabel(r.id)!
                const rarity = rarityInfo(r.rarity)
                const portrait = portraitFor(r.id)
                // 准圣（order 4）/ 圣阶（order 5）走特殊入场 + 光效。判据取自品阶表，
                // 不另写一份"哪几档算稀有"—— 与引擎的抽卡补偿分界是同一条线
                const rare = rarity.order >= RARITY_INFO.quasi.order
                // `--dq-glow` 是 CSS 里那条光晕的颜色；animationDelay 只在这两个类上用
                const anim = { animationDelay: `${i * PULL_STEP_MS}ms`, '--dq-glow': rarity.color } as CSSProperties
                return (
                  <button key={`${round}-${i}`} onClick={() => setDetail(cdef)}
                    data-pull-card={r.rarity}
                    className={`overflow-hidden rounded border text-center text-xs hover:border-dq-gold ${rare ? 'dq-pull-rare' : 'dq-pull-in'}`}
                    style={{ borderColor: rarity.color, ...anim }}>
                    <div className="relative aspect-square">
                      {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                      {/* 光效自己一层：入场动画在 button 上（transform），这里只管光（opacity/box-shadow）——
                          挤在同一个元素上会互相覆盖 transform */}
                      {rare && <span data-pull-halo className="dq-pull-halo" style={anim} />}
                      {r.isNew
                        ? <span className="absolute right-0 top-0 rounded-bl bg-green-600 px-1 text-[9px] text-white">新</span>
                        : <span className="absolute right-0 top-0 rounded-bl bg-black/70 px-1 text-[9px] text-dq-gold">
                            {r.shard > 0 ? `✨+${r.shard}` : `精血+${r.essence}`}
                          </span>}
                      {r.pity && <span className="absolute left-0 top-0 rounded-br bg-dq-gold px-1 text-[9px] text-black">保底</span>}
                    </div>
                    {/* 名字：原来 `slice(0, 4)` 硬截（同 RosterView），已有 `truncate` */ }
                    <div className="truncate px-0.5" style={{ color: rarity.color }}>{cdef.name}</div>
                    <div className="pb-1 text-[#a89478]">
                      {r.isNew ? rarity.label : r.shard > 0 ? '重复·转碎片' : '重复·返精血'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 碎片兑换：结果区上移之后它自然落到下面（用户：「把碎片兑换挪下去一点」）。
          独立成一个面板而不是主面板里的一段 —— 它是**另一件事**（存量的出口），
          不再夹在"抽卡"和"抽卡结果"中间。 */}
      <div data-shard-shop className="dq-panel w-full max-w-xl rounded-md p-4 text-left">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-dq-gold">角色碎片 · 兑换武魂</span>
          <span className="text-[#e8dcc8]">✨ 角色碎片 ×{shards}</span>
        </div>
        {toast && <div className="mb-2 text-[11px] text-dq-gold">{toast}</div>}
        {unowned.length === 0 ? (
          <div className="text-[11px] text-[#a89478]">
            {CHARACTERS.length} 名武魂已全部收录，碎片暂时没有用处——留着等新武魂登场
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {unowned.map(c => {
                const rarity = rarityInfo(c.rarity)
                const cost = shardCostOf(c)
                const afford = shards >= cost
                const portrait = portraitFor(c.id)
                return (
                  <button key={c.id} onClick={() => setDetail(c)}
                    data-unowned-id={c.id}
                    className={`overflow-hidden rounded border text-center text-[10px] hover:border-dq-gold ${afford ? '' : 'opacity-40'}`}
                    style={{ borderColor: rarity.color }}>
                    <div className="relative aspect-square">
                      {portrait && <img src={portrait} alt={c.name} className="h-full w-full object-cover" />}
                      {isLinkChar(c.id) && (
                        <span className="absolute right-0 top-0 rounded-bl bg-[#5eead4] px-1 text-[9px] text-black">联动</span>
                      )}
                    </div>
                    {/* 名字：原来 `slice(0, 4)` 硬截（同 RosterView），已有 `truncate` */ }
                    <div className="truncate px-0.5" style={{ color: rarity.color }}>{c.name}</div>
                    <div className={`pb-0.5 text-[9px] ${afford ? 'text-dq-fire' : 'text-[#5a4a38]'}`}>✨×{cost}</div>
                  </button>
                )
              })}
            </div>
            <div className="mt-1.5 text-[11px] text-[#a89478]">
              点击卡片查看武魂立绘与介绍 · 碎片来自「重复抽到准圣 / 圣阶武魂」与中州（第 60 关起）掉落 · 只能兑换尚未拥有的武魂 · 重复抽到 6 次 ≈ 换 1 名同阶
            </div>
          </>
        )}
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-dq-gold">武魂名录（{Object.keys(state.roster).length} / {CHARACTERS.length} 已收录）</span>
          <span className="text-[11px] text-[#a89478]">点击查看详情</span>
        </div>
        {/* ⚠️ 手机端 4 列（原 5 列）、桌面仍是 6 列 —— 用户 2026-09-21 的原话是
            「可以把 ui 放大，一排少放点」。手机端字号整体抬上去之后，5 列每格只有
            (390−32−32)/5 ≈ 65px，12.5px 的角色名**露不全**（「萧炎（斗破）」只到「萧炎（斗」），
            放大字号的收益被挤没了。4 列每格 ≈ 82px，六字名能整整齐齐放下。
            改的是**列数**不是字号：字号一列一列地缩回去，就白抬了。
            `sm:` 那档顺移一位（原来 ≥640px 直接跳 6 列，现在先走 5 列）——
            640–767px 是手机横屏与折叠机展开态，跟手机同档更合理。 */}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {catalog.map(c => {
            const owned = !!state.roster[c.id]
            const rarity = rarityInfo(c.rarity)
            const portrait = portraitFor(c.id)
            return (
              <button key={c.id} onClick={() => setDetail(c)} data-char-id={c.id}
                className="overflow-hidden rounded border text-center text-[10px] hover:border-dq-gold"
                style={{ borderColor: owned ? rarity.color : '#3a2a1a', opacity: owned ? 1 : 0.35 }}>
                <div className="relative aspect-square">
                  {portrait && <img src={portrait} alt={c.name} className="h-full w-full object-cover" style={{ filter: owned ? 'none' : 'grayscale(1)' }} />}
                  {isLinkChar(c.id) && (
                    <span className="absolute right-0 top-0 rounded-bl bg-[#5eead4] px-1 text-[9px] text-black">联动</span>
                  )}
                </div>
                {/* 名字：原来是 `slice(0, 4)`，与 RosterView 一样是**硬截**不是省略号 */}
                <div className="truncate px-0.5" style={{ color: owned ? rarity.color : '#a89478' }}>{c.name}</div>
              </button>
            )
          })}
        </div>
      </div>

      {detail && !pick && (
        <RecruitDetail c={detail} owned={!!state.roster[detail.id]} shards={shards}
          onClose={() => setDetail(null)}
          onRedeem={() => { setPick(detail); setDetail(null) }} />
      )}

      {pick && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4" onClick={() => setPick(null)}>
          <div className="w-64 rounded border border-dq-fire bg-dq-panel p-3 text-xs shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 text-dq-fire">确认兑换？</div>
            <div className="space-y-1 text-[#c9bda4]">
              <div>消耗 角色碎片 ×<span className="text-[#e8dcc8]">{shardCostOf(pick)}</span></div>
              <div>获得 <span style={{ color: rarityInfo(pick.rarity).color }}>{rarityInfo(pick.rarity).label}「{pick.name}」</span></div>
              <div className="text-[11px] text-[#a89478]">兑换后剩余 ✨×{shards - shardCostOf(pick)}</div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={doRedeem} className="flex-1 rounded bg-dq-fire py-1 text-black">确认兑换</button>
              <button onClick={() => setPick(null)} className="flex-1 rounded border border-dq-border py-1 hover:border-dq-gold">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部公告（v1.43）：**只在抽到圣阶时**出现（用户：「抽到圣阶可以在顶部通知公告」）。
          这是"抽卡反馈"的最后一块：卡片上那点光效在十连的格子里不够醒目，
          报喜要有一条自己的、压在所有内容之上的横幅。
          ⚠️ 它只报给**自己**看。全服公告是另一件事：要新起一条服务端通道，
          还会把"谁抽到了什么"摊给所有玩家 —— 与本条需求不是同一个东西，没有顺手做。

          ⚠️ 外层只管居中、滑入动画写在内层：Tailwind 的 `-translate-x-1/2` 本身就是一条
          transform，和动画写在同一个元素上会被整个覆盖（公告会跳到屏幕左边去）。 */}
      {announce && (
        <>
          {/* 全屏一闪：随公告一起挂载，动画自己收尾到透明 —— 不需要任何"何时撤掉"的状态 */}
          <div className="dq-pull-flash" />
          <div className="pointer-events-none fixed left-1/2 top-2 z-30 w-[min(94vw,26rem)] -translate-x-1/2">
            <div data-pull-announce
              className="dq-pull-announce pointer-events-auto flex items-center gap-3 rounded-md border-2 bg-dq-panel px-3 py-2 shadow-2xl"
              style={{ borderColor: RARITY_INFO.sheng.color }}>
              <div className="flex shrink-0 gap-1">
                {announce.slice(0, 3).map(id => {
                  const p = portraitFor(id)
                  return p ? (
                    <img key={id} src={p} alt={charLabel(id)?.name ?? ''}
                      className="h-9 w-9 rounded border object-cover" style={{ borderColor: RARITY_INFO.sheng.color }} />
                  ) : null
                })}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[10px] tracking-widest" style={{ color: RARITY_INFO.sheng.color }}>圣阶降临</div>
                <div className="truncate text-sm text-dq-gold">
                  {announce.length > 1 && `${announce.length} 名 · `}
                  {announce.map(id => charLabel(id)?.name ?? id).join(' · ')}
                </div>
              </div>
              <button onClick={() => setAnnounce(null)} aria-label="关闭公告"
                className="shrink-0 rounded border border-dq-border px-1.5 py-0.5 text-[11px] text-[#a89478] hover:border-dq-gold hover:text-dq-gold">
                ✕
              </button>
            </div>
          </div>
        </>
      )}

      {/* 联动海报：**首次进入招募页**时弹一次（见上面的 effect）。
          z-40 压在详情/确认浮层之上 —— 它只在进页面时出现，不该被别的东西盖住。
          ⚠️ 海报图里**没有烧任何文字**（生图模型画中文必糊），文案一律由这里叠上去，
          改活动时间/改文案都不用重新生图。 */}
      {poster && (
        <div data-link-poster className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4" onClick={closePoster}>
          <div className="max-h-full w-full max-w-xs overflow-auto rounded-lg border-2 bg-dq-panel shadow-2xl"
            style={{ borderColor: '#5eead4' }} onClick={e => e.stopPropagation()}>
            <img src={linkPoster} alt="凡人修仙传联动" className="w-full" />
            <div className="p-3 text-center">
              <div className="text-sm" style={{ color: '#5eead4' }}>凡人修仙传 × 焚炎异录</div>
              <div className="mt-1 text-xs text-dq-gold">限时联动 · 韩立 / 银月 加入招募</div>
              <div className="mt-1 text-[11px] text-[#a89478]">
                两名圣阶武魂 · 活动期 24 小时 · 结束后移出抽卡池与兑换
              </div>
              <div className="mt-0.5 text-[11px] text-[#a89478]">
                角色碎片兑换需 ✨×{LINK_SHARD_COST}
              </div>
              <button onClick={closePoster} className="mt-3 w-full rounded bg-dq-fire py-1.5 text-sm text-black">
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}