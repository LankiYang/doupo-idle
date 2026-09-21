import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useGame, game, charLabel, charStats, rarityInfo, fmtNum } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { equipSlotIcon } from '../game/equipIcons'
import {
  SLOT_INFO, AFFIX_LABEL, EQUIP_BREAKDOWN, EQUIP_ENH_PER_LV,
  type EquipSlot, type EquipItem, type EquipAffix,
} from '../game/data'

const SLOTS: EquipSlot[] = ['weapon', 'armor', 'accessory', 'ring']

/** 分解产物文案（详情浮层与确认框共用，保证口径一致） */
function breakdownText(item: EquipItem): string {
  const b = EQUIP_BREAKDOWN[item.quality]
  return b.xuanjing ? `武魂精血 ×${b.essence} · 玄晶 ×${b.xuanjing}` : `武魂精血 ×${b.essence}`
}

/** 强化等级对应的词条加成百分比（读 data.ts 的倍率，界面不复述这个数） */
function enhPct(lv: number): number {
  return Math.round(lv * EQUIP_ENH_PER_LV * 100)
}

/**
 * 一条词条。数值颜色直接编码 a.roll（品质位）—— 这个字段从装备系统上线起就存在，
 * 却一直没在界面上露过面，玩家只看得到数值、无从判断"这条是不是洗好了"。
 * roll ≥ 1 表示这条是**洗练突破自然上限**的（自然掉落永远到不了 1），加 ✦ 标记。
 */
function AffixLine({ a, strong, right }: { a: EquipAffix; strong?: boolean; right?: ReactNode }) {
  const tone = strong ? 'text-dq-gold'
    : a.roll >= 1 ? 'text-[#ffd76a]'
      : a.roll >= 0.8 ? 'text-[#e8dcc8]'
        : a.roll >= 0.5 ? 'text-[#c9bda4]' : 'text-[#8a7658]'
  return (
    <div className={`flex items-center gap-2 rounded bg-black/20 px-2 py-1 ${tone}`}>
      <span>{AFFIX_LABEL[a.type]}</span>
      <span className="ml-auto whitespace-nowrap">
        +{a.value}%{a.roll >= 1 && <span className="ml-0.5 text-[9px] text-dq-fire">✦</span>}
      </span>
      {right}
    </div>
  )
}

/**
 * 装备详情：点击触发的浮层，桌面/触屏统一交互（原先用 hover 展示，触屏设备完全摸不到）。
 *
 * v1.38 起按用户要求"做大、做好看"：图标 64px、名称放大、品阶与强化等级做成徽章、
 * 强化独立成块并带等级进度条与"下一级要多少 / 升完强多少"。
 *
 * v1.38.2：最高阶武器洗练后多一条**对比条**（原词条 ↔ 现在，可一键换回）。
 * 新加的这块文案里**不许出现「灵金」**——见下面锚点②（它按"洗练块里含灵金的最深一层 div"
 * 取消耗行，多一行含「灵金」的文字就会把那行顶掉）。这也是这里写"消耗"而不写"灵金"的原因。
 *
 * ️ 改版时有三处**不许动**，它们是回归脚本的锚点（verify-reforge / verify-ui-v125）：
 *   ① 洗练块里不能出现「斗气结晶」四字 —— 脚本用它在证明"洗练只用灵金，不再要结晶"；
 *      所以强化块与洗练块必须是**并列的两块**，别把强化消耗行塞进洗练块。
 *   ② 洗练消耗行必须是洗练块内**最后一行含「灵金」**的 div，且富余 rgb(201,189,164) /
 *      不足 rgb(248,113,113) 两种颜色不能换成别的色值。
 *   ③ 卡片自身不设文字色、背景保持 bg-dq-panel、不加背景图（脚本按计算样式断言"实心不透明"）。
 */
/**
 * 操作回执：`bad` 一为真就整条转成警示色并挂一个三角标。
 *
 * 原先成功与失败**共用同一个 `text-dq-gold`**，只有开头那个 emoji 不同
 * （成功 `✦` / 失败 `⚠️`）—— 而 emoji 在本机根本没有字形（红线⑨），
 * 开发的时候两者长得一模一样，玩家那边则取决于他的系统。**用 emoji 区分成败是假的区分。**
 */
type DetailMsg = { text: string; bad: boolean }

function DetailMsgLine({ msg, className = '' }: { msg?: DetailMsg | null; className?: string }) {
  if (!msg) return null
  return (
    <div className={`${className} text-[11px] ${msg.bad ? 'text-dq-fire' : 'text-dq-gold'}`}>
      {msg.bad && <AlertTriangle size={11} className="mr-1 inline align-[-1px]" />}
      {msg.text}
    </div>
  )
}

function ItemDetailModal({ item, compare, onBreakdown, onReforge, onUndoReforge, onEnhance, reforgeMsg, enhanceMsg, onClose }: {
  item: EquipItem; compare?: number | null; onBreakdown?: () => void
  onReforge?: (idx: number) => void; onUndoReforge?: () => void; onEnhance?: (times: number) => void
  // 提示一律用 `null` 表示"没有"（不是空串）—— 与 DetailMsgLine 的 `msg?: DetailMsg | null` 对齐，
  // 也与 state 的类型一致。混用 '' 会让 `tsc -b` 报 "Argument of type '\"\"' is not assignable to
  // parameter of type 'SetStateAction<DetailMsg | null>'"。
  reforgeMsg?: DetailMsg | null; enhanceMsg?: DetailMsg | null; onClose: () => void
}) {
  const state = useGame()
  const color = rarityInfo(item.quality).color
  const icon = equipSlotIcon(item.slot)
  // 显示战力是整数（引擎侧 Math.round），所以 ±0.5 以内的差异肉眼看不见，
  // 显示成"战力 +0"会让玩家以为界面坏了 —— 不到 1 点一律说"持平"。
  const cmp = typeof compare === 'number' ? Math.round(compare) : null
  const cost = game.reforgeCost(item.quality)
  // 黄阶没有额外词条、也就没有洗练（cost.coin 为 0），此时整块洗练 UI 都不该出现
  const canReforge = !!onReforge && item.extra.length > 0 && cost.coin > 0
  const afford = (state.inventory.coin ?? 0) >= cost.coin
  // 强化的一切状态与价目都读引擎的 enhanceInfo，组件不自己查 EQUIP_ENHANCE（两份口径迟早分叉）
  const enh = game.enhanceInfo(item)
  const crystal = state.inventory.crystal ?? 0
  const essence = state.inventory.essence ?? 0
  const canEnhance = !!onEnhance && !enh.maxed
  const affordOne = crystal >= enh.cost.crystal && essence >= enh.cost.essence
  const affordMax = crystal >= enh.toMaxCost.crystal && essence >= enh.toMaxCost.essence
  /**
   * 上一次洗练前的词条（v1.38.2，仅最高阶武器有）。默认已经采用新结果，
   * 这里只是把"原来那条"摆出来给玩家一次换回的机会——**两边并排**，
   * 是因为玩家要比的正是"新的这条值不值得换掉旧的"，隔开或只显示一边都等于让他自己记。
   */
  const undoSnap = game.reforgeUndoOf(item.id)
  const lvTone = enh.lv > 0 ? 'bg-dq-gold/20 text-dq-gold' : 'bg-black/30 text-[#8a7658]'
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-[21rem] overflow-auto rounded-lg border-2 bg-dq-panel p-4 text-sm shadow-2xl sm:w-[26rem]"
        style={{ borderColor: color, boxShadow: `0 0 28px -8px ${color}` }} onClick={e => e.stopPropagation()}>

        {/* ── 头部：大图标 + 名称 + 品阶/槽位 + 强化等级徽章 ── */}
        <div className="flex items-start gap-3">
          {/* 详情浮层里的大图标也走同一块承台 —— 这是玩家最仔细看装备图标的地方，
              剑/甲那两张暗图在没有承台时几乎看不出是把剑 */}
          {icon && <span className="dq-iconplate inline-block h-16 w-16 shrink-0 overflow-hidden rounded-md border"
            style={{ borderColor: color }}>
            <img src={icon} alt={item.slot} className="h-full w-full object-cover" />
          </span>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold" style={{ color }}>{item.name}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: `${color}22`, color }}>
                {rarityInfo(item.quality).label}
              </span>
              <span className="text-[#a89478]">{SLOT_INFO[item.slot].label}</span>
              <span className={`ml-auto rounded px-1.5 py-0.5 font-mono ${lvTone}`}>+{enh.lv}</span>
            </div>
          </div>
        </div>

        {/* ── 强化（v1.38）：与洗练是两块并列的 UI，别合并 ── */}
        <div className="mt-3 rounded-md border border-dq-border bg-black/25 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-dq-gold">强化</span>
            <span className="font-mono text-xs text-[#e8dcc8]">
              +{enh.lv}<span className="text-[#5a4a38]"> / +{enh.cap}</span>
            </span>
          </div>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-black/50">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(enh.lv / Math.max(1, enh.cap)) * 100}%`, backgroundColor: color }} />
          </div>
          {enh.maxed ? (
            <div className="text-[11px] text-[#a89478]">
              已满级 —— 词条加成 ×{(1 + enh.cap * EQUIP_ENH_PER_LV).toFixed(2)}（{rarityInfo(item.quality).label}的上限是 +{enh.cap}）
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="shrink-0 text-[#a89478]">下一级消耗</span>
                <span className={`text-right ${affordOne ? 'text-[#c9bda4]' : 'text-red-400'}`}>
                  斗气结晶 ×{fmtNum(enh.cost.crystal)} · 武魂精血 ×{fmtNum(enh.cost.essence)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-[#a89478]">词条加成</span>
                <span className="text-[#e8dcc8]">
                  +{enhPct(enh.lv)}% <span className="text-[#5a4a38]">→</span> <span className="text-green-400">+{enhPct(enh.lv + 1)}%</span>
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => onEnhance?.(1)} disabled={!canEnhance || !affordOne}
                  className={`flex-1 rounded border py-1.5 text-xs ${canEnhance && affordOne
                    ? 'border-dq-gold bg-dq-gold/15 text-dq-gold hover:bg-dq-gold/25'
                    : 'border-[#3a2a1a] text-[#5a4a38]'}`}>强化 +1</button>
                <button onClick={() => onEnhance?.(enh.cap - enh.lv)} disabled={!canEnhance || !affordMax}
                  className={`flex-1 rounded border py-1.5 text-xs ${canEnhance && affordMax
                    ? 'border-dq-border text-[#e8dcc8] hover:border-dq-gold'
                    : 'border-[#3a2a1a] text-[#5a4a38]'}`}>强化至满级</button>
              </div>
            </>
          )}
          <DetailMsgLine msg={enhanceMsg} className="mt-1.5" />
        </div>

        {/* ── 词条 ── */}
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-dq-gold">词条</div>
          <div className="space-y-1">
            {/* 先天词条不给洗练按钮：它是槽位的身份（戒指必给暴击率），洗掉这个概念就不成立了 */}
            <AffixLine a={item.innate} strong />
            {item.extra.map((a, i) => (
              <AffixLine key={i} a={a} right={canReforge ? (
                <button onClick={() => onReforge!(i)} disabled={!afford} data-affix-idx={i}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${afford
                    ? 'border-dq-border text-[#e8dcc8] hover:border-dq-fire'
                    : 'border-[#3a2a1a] text-[#5a4a38]'}`}>洗练</button>
              ) : undefined} />
            ))}
          </div>
          {/* ── 洗练对比（v1.38.2）：最高阶武器专用。默认已采用新词条，这里给一次换回的机会 ── */}
          {undoSnap && item.extra[undoSnap.idx] && (
            <div className="mt-2 rounded-md border border-dq-gold/40 bg-dq-gold/5 p-2">
              <div className="mb-1 text-[10px] text-dq-gold">
                本次洗练对比（第 {undoSnap.idx + 1} 条 · 已采用新词条）
              </div>
              <div className="flex items-stretch gap-1.5 text-[11px]">
                <div className="min-w-0 flex-1 rounded bg-black/25 px-2 py-1">
                  <div className="text-[9px] text-[#8a7658]">原词条</div>
                  <div className="truncate text-[#c9bda4]">{AFFIX_LABEL[undoSnap.from.type]} +{undoSnap.from.value}%</div>
                </div>
                <div className="flex shrink-0 items-center text-[#5a4a38]">→</div>
                <div className="min-w-0 flex-1 rounded bg-black/25 px-2 py-1">
                  <div className="text-[9px] text-[#8a7658]">现在</div>
                  <div className="truncate text-[#ffd76a]">
                    {AFFIX_LABEL[item.extra[undoSnap.idx].type]} +{item.extra[undoSnap.idx].value}%
                  </div>
                </div>
              </div>
              <button onClick={() => onUndoReforge?.()}
                className="mt-1.5 w-full rounded border border-dq-gold/60 py-1 text-[11px] text-dq-gold hover:bg-dq-gold/15">
                换回原词条
              </button>
              <div className="mt-1 text-[9px] text-[#8a7658]">换回不返还本次洗练的消耗，且只留这一次机会</div>
            </div>
          )}
          {/* 花在按钮上明示，不再弹确认框：洗练是要反复点的动作，每次确认反而折磨人 */}
          {canReforge && (
            <div className="mt-2 text-[10px]">
              <div className="text-[#a89478]">洗练一条（类型与数值都重掷，价格固定不涨）</div>
              <div className={afford ? 'text-[#c9bda4]' : 'text-red-400'}>
                灵金 ×{fmtNum(cost.coin)}
              </div>
            </div>
          )}
          <DetailMsgLine msg={reforgeMsg} className="mt-1" />
        </div>

        {cmp !== null && (
          <div className={`mt-3 text-[11px] ${cmp >= 1 ? 'text-green-400' : 'text-[#5a4a38]'}`}>
            对该武魂：{cmp >= 1 ? `战力 +${fmtNum(cmp)}` : cmp <= -1 ? '不如当前穿戴' : '≈ 持平（战力不变）'}
          </div>
        )}

        <div className="mt-3 border-t border-dq-border pt-2 text-[11px]">
          <div className="text-[#a89478]">分解可得</div>
          <div className="text-[#c9bda4]">{breakdownText(item)}</div>
          {enh.lv > 0 && (
            <div className="mt-0.5 text-[#a89478]">
              另退强化材料（已投入的七成）：斗气结晶 ×{fmtNum(enh.refund.crystal)} · 武魂精血 ×{fmtNum(enh.refund.essence)}
            </div>
          )}
        </div>
        {onBreakdown && (
          <button onClick={onBreakdown}
            className="mt-3 w-full rounded border border-dq-border py-1.5 text-xs hover:border-dq-fire">分解</button>
        )}
        <button onClick={onClose} className="mt-1.5 w-full rounded border border-dq-border py-1.5 text-xs hover:border-dq-gold">关闭</button>
      </div>
    </div>
  )
}

export default function EquipmentView() {
  const state = useGame()
  const teamIds = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  const [selectedChar, setSelectedChar] = useState<string | null>(teamIds[0] ?? null)
  /**
   * 详情浮层看的是哪件装备 —— **存 id，不存对象引用**。
   *
   * ⚠️ 这里原先是 `useState<EquipItem|null>`，注释还写着"peekItem 是 state 里的同一个对象引用，
   *    引擎就地改写了它，所以浮层会跟着更新"。**那句在远程模式下不成立**：服务端回的增量是
   *    JSON 解出来的**新对象**，`equipBag` 整个被换掉，旧引用从此冻在那一刻 ——
   *    洗练完、强化完，浮层里的词条/等级还是洗之前的（**静默错，玩家看不出来**）。
   *    改成每次渲染从当前 state 里重新找一遍，两个模式都对。
   */
  const [peekId, setPeekId] = useState<string | null>(null)
  const peekItem = peekId ? game.findEquip(peekId) : null
  const [junkPreview, setJunkPreview] = useState<{ count: number; essence: number; xuanjing: number } | null>(null)
  const [toast, setToast] = useState<DetailMsg | null>(null)
  const [reforgeMsg, setReforgeMsg] = useState<DetailMsg | null>(null)
  const [enhanceMsg, setEnhanceMsg] = useState<DetailMsg | null>(null)

  if (teamIds.length === 0 || !selectedChar) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[#a89478]">先去阵容页编排队伍，再来管理装备</div>
  }

  const cdef = charLabel(selectedChar)!
  const entry = state.roster[selectedChar]
  const fireId = game.fireIdOf(selectedChar) // 异火规则收在引擎里，组件别自己拼：口径分叉就会出现「界面显示的」和「战斗用的」不是一回事
  const stats = charStats(entry, cdef, fireId)
  // 基准战力只算一次；背包里每件的"换上能涨多少" = 装上后的战力 − 这个基准
  const basePower = game.powerOf(selectedChar)

  const bagSorted = [...state.equipBag].sort((a, b) => rarityInfo(b.quality).order - rarityInfo(a.quality).order)
  const isInBag = (item: EquipItem) => state.equipBag.some(i => i.id === item.id)
  /** 强化等级徽章：引擎兜底过的值（缺字段/越界都在 equipLv 里收干净） */
  const lvOf = (item: EquipItem) => game.equipLv(item)

  /** 打开详情浮层。必须清掉上一次的洗练/强化提示，否则换个装备打开会显示成"刚洗出的结果" */
  function openItem(item: EquipItem) {
    setReforgeMsg(null)
    setEnhanceMsg(null)
    setPeekId(item.id)
  }

  /**
   * 洗练一条额外词条。不做二次确认：消耗已经明示在按钮旁边，而且这是要反复点的动作。
   *
   * ⚠️ `await`：远程模式下这是打到服务端的动作（§4.6），回执要一个来回才有。
   *    本地模式返回的是普通值，`await` 一个非 Promise 照常成立 —— 两种模式同一份代码。
   */
  async function doReforge(idx: number) {
    if (!peekItem) return
    const r = await game.reforgeEquip(peekItem.id, idx)
    if (!r.ok || !r.affix) { setReforgeMsg({ text: r.why ?? '洗练失败', bad: true }); return }
    setReforgeMsg({ text: `洗练完成：${AFFIX_LABEL[r.affix.type]} +${r.affix.value}%`, bad: false })
  }

  /**
   * 换回上一次洗练前的词条（v1.38.2，仅最高阶武器）。**不退费**，理由见 engine.undoReforge。
   * 快照用掉即清空（引擎里做的），所以这里不用手动关掉对比条——emit 一响它就自己没了。
   */
  async function doUndoReforge() {
    if (!peekItem) return
    const r = await game.undoReforge(peekItem.id)
    if (!r.ok || !r.affix) { setReforgeMsg({ text: r.why ?? '换回失败', bad: true }); return }
    setReforgeMsg({ text: `已换回原词条：${AFFIX_LABEL[r.affix.type]} +${r.affix.value}%`, bad: false })
  }

  /**
   * 强化：times=1 是点一次升一级，times=上限-当前 就是「强化至满级」。
   * 引擎是**逐级扣费、扣到哪级算哪级**的：材料只够 3 级时返回 levels=3 且 ok=true，
   * 界面上要如实说"升了 3 级 + 为什么停下"，不能说成失败（那样玩家会以为按钮坏了）。
   */
  async function doEnhance(times: number) {
    if (!peekItem) return
    const r = await game.enhanceEquip(peekItem.id, times)
    // ⚠️ 强化等级要**在动作之后重新查**（`game.enhanceInfo` 读的是当前 state）。
    //    远程模式下这里的 `peekItem` 已经是新对象了（每次渲染重新 find），照旧成立。
    const now = peekItem ? game.enhanceInfo(peekItem) : { lv: 0 }
    if (!r.ok) { setEnhanceMsg({ text: r.why ?? '强化失败', bad: true }); return }
    setEnhanceMsg({ text: `强化成功 +${now.lv}${r.why ? `（${r.why}）` : ''}`, bad: false })
  }

  async function doAutoEquip() {
    const r = await game.autoEquipBest()
    const shown = Math.round(r.powerGain)
    setToast({ text: r.changed
      ? `已为 ${teamIds.length} 名上阵武魂自动换上四件套（调整 ${r.changed} 件，${shown >= 1 ? `战力 +${fmtNum(shown)}` : '显示战力持平'}）`
      : '当前穿戴已是最优，无需调整', bad: false })
  }

  /** 单件分解（背包卡片上的按钮）。强化过的会一并退还材料，要让玩家看到退了什么 */
  async function doBreakdown(item: EquipItem) {
    const r = await game.breakdownEquip(item.id)
    if (!r) { setToast({ text: '分解失败（这件装备品阶无法识别，已保留）', bad: true }); return }
    const back = r.refundCrystal ? ` · 退还斗气结晶 ×${fmtNum(r.refundCrystal)} / 武魂精血 ×${fmtNum(r.refundEssence)}` : ''
    setToast({ text: `分解 1 件，获得武魂精血 ×${r.essence}${r.xuanjing ? ` · 玄晶 ×${r.xuanjing}` : ''}${back}`, bad: false })
  }

  /** 先扫一遍算出会分解多少、产出多少，让玩家确认后才真正执行 */
  function previewJunk() {
    let count = 0, essence = 0, xuanjing = 0
    for (const item of state.equipBag) {
      if (!game.isJunkEquip(item)) continue
      const b = EQUIP_BREAKDOWN[item.quality]
      count++; essence += b.essence; xuanjing += b.xuanjing
    }
    if (!count) { setToast({ text: '没有可分解的装备（背包里都还有用武之地）', bad: true }); return }
    setJunkPreview({ count, essence, xuanjing })
  }

  async function confirmJunk() {
    const r = await game.breakdownJunk()
    setJunkPreview(null)
    const back = r.refundCrystal ? ` · 退还斗气结晶 ×${fmtNum(r.refundCrystal)} / 武魂精血 ×${fmtNum(r.refundEssence)}` : ''
    setToast({ text: `分解 ${r.count} 件，获得武魂精血 ×${r.essence}${r.xuanjing ? ` · 玄晶 ×${r.xuanjing}` : ''}${back}`, bad: false })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:flex-row sm:gap-4 sm:p-4">
      <div className="shrink-0 space-y-2 sm:w-48">
        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">选择武魂</div>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-3">
            {teamIds.map(id => {
              const d = charLabel(id)!
              const p = portraitFor(id)
              const active = id === selectedChar
              return (
                <button key={id} onClick={() => setSelectedChar(id)}
                  className={`overflow-hidden rounded border text-center text-[10px] ${active ? 'border-dq-gold' : 'border-dq-border'}`}>
                  <div className="aspect-square">{p && <img src={p} alt={d.name} className="h-full w-full object-cover" />}</div>
                  {/* 名字：原来 `slice(0, 4)` 硬截（同 RosterView）——这里本来就有 `truncate`，
                    交给格子宽度决定截到第几个字。手机端 5 列每格 ≈ 65px 偏挤，
                    但这一栏是**换人**用的短列表（只有上阵的那几个），不像图鉴那样铺满一屏，
                    暂时不动列数。 */}
                  <div className="truncate px-0.5" style={{ color: rarityInfo(d.rarity).color }}>{d.name}</div>
                </button>
              )
            })}
          </div>
        </div>
        <div className="dq-panel rounded-md p-3 text-xs">
          <div className="mb-2 text-sm text-dq-gold">{cdef.name} 当前属性</div>
          <div className="flex justify-between"><span className="text-[#a89478]">攻击</span><span>{stats.atk}</span></div>
          <div className="flex justify-between"><span className="text-[#a89478]">防御</span><span>{stats.def}</span></div>
          <div className="flex justify-between"><span className="text-[#a89478]">气血</span><span>{stats.hp}</span></div>
          <div className="flex justify-between"><span className="text-[#a89478]">暴击率</span><span>{stats.critRate.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span className="text-[#a89478]">暴击伤害</span><span>{stats.critDmg.toFixed(1)}%</span></div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-dq-gold">已穿戴</div>
            <div className="flex flex-wrap gap-2">
              {/* 这两个是装备页的主操作（一键穿戴 / 一键分解）。实测手机端只有 27px 高，
                是全页最该按得准的两个键 —— 它们点的都是"批量改动"，按错一次很难撤销 */}
              <button onClick={doAutoEquip}
                className="dq-tap-lg inline-flex items-center justify-center rounded bg-dq-gold px-2.5 py-1 text-[11px] text-black">一键最优穿戴</button>
              <button onClick={previewJunk}
                className="dq-tap-lg inline-flex items-center justify-center rounded border border-dq-border px-2.5 py-1 text-[11px] text-[#e8dcc8] hover:border-dq-fire">一键分解垃圾</button>
            </div>
          </div>
          <DetailMsgLine msg={toast} className="mb-2" />
          <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
            {SLOTS.map(slot => {
              const item = entry.equip[slot]
              const icon = equipSlotIcon(slot)
              const color = item ? rarityInfo(item.quality).color : '#3a2a1a'
              const lv = item ? lvOf(item) : 0
              return (
                <div key={slot} className="rounded border p-2 text-center text-xs" style={{ borderColor: color }}>
                  {/* 强化等级外显：槽位标签旁边的小徽章，0 级也显示（否则玩家不知道这件能强化） */}
                  <div className="mb-1 flex items-center justify-center gap-1 text-[10px]">
                    <span className="text-[#a89478]">{SLOT_INFO[slot].label}</span>
                    {item && (
                      <span className={`rounded px-1 font-mono ${lv > 0 ? 'bg-dq-gold/20 text-dq-gold' : 'text-[#5a4a38]'}`}>+{lv}</span>
                    )}
                  </div>
                  <button onClick={() => item && openItem(item)} disabled={!item}
                    className="dq-iconplate mx-auto mb-1 block h-11 w-11 overflow-hidden rounded sm:h-14 sm:w-14">
                    {icon && <img src={icon} alt={slot} className="h-full w-full object-cover" style={{ opacity: item ? 1 : 0.3 }} />}
                  </button>
                  {item ? (
                    <>
                      <div className="truncate" style={{ color }}>{item.name}</div>
                      <button onClick={() => game.unequipItem(selectedChar, slot)}
                        className="mt-1 w-full rounded border border-dq-border py-0.5 text-[10px] hover:border-dq-gold">卸下</button>
                    </>
                  ) : (
                    <div className="text-[10px] text-[#5a4a38]">未装备</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="dq-panel flex min-h-0 flex-1 flex-col rounded-md p-3">
          <div className="mb-2 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
            <div className="text-sm text-dq-gold">背包（{state.equipBag.length}）</div>
            <div className="text-[11px] text-[#a89478]">击杀有概率掉落，首领掉落率更高 · 数字为换上后 {cdef.name} 的战力变化</div>
          </div>
          {bagSorted.length === 0 ? (
            <div className="text-xs text-[#5a4a38]">暂无装备，去主线或天梯塔多打几场</div>
          ) : (
            <div className="grid grid-cols-4 gap-2 overflow-auto sm:grid-cols-6">
              {bagSorted.map(item => {
                const color = rarityInfo(item.quality).color
                const icon = equipSlotIcon(item.slot)
                const lv = lvOf(item)
                const gain = game.powerIfEquipped(selectedChar, item) - basePower
                // 同上：按取整后的显示战力分档，避免出现"↑ 战力 +0"
                const gained = Math.round(gain)
                return (
                  <div key={item.id} className="relative rounded border p-1.5 text-center text-[10px]" style={{ borderColor: color }}>
                    {/* 强化等级外显：卡片右上角徽章，>=1 级才上金色 */}
                    <span className={`pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/70 px-1 font-mono text-[9px] ${lv > 0 ? 'text-dq-gold' : 'text-[#5a4a38]'}`}>+{lv}</span>
                    <button onClick={() => openItem(item)} className="dq-iconplate mx-auto block h-10 w-10 overflow-hidden rounded">
                      {icon && <img src={icon} alt={item.slot} className="h-full w-full object-cover" />}
                    </button>
                    <button onClick={() => openItem(item)} className="w-full truncate" style={{ color }}>{item.name}</button>
                    <div className={`mt-0.5 text-[9px] ${gained >= 1 ? 'text-green-400' : 'text-[#5a4a38]'}`}>
                      {gained >= 1 ? `↑ 战力 +${fmtNum(gained)}` : gained <= -1 ? '不如当前' : '≈ 持平'}
                    </div>
                    <div className="mt-1">
                      <button onClick={() => game.equipItem(selectedChar, item.id)}
                        className="w-full rounded bg-dq-gold py-0.5 text-black">穿戴</button>
                    </div>
                    <button onClick={() => doBreakdown(item)}
                      className="mt-0.5 w-full rounded border border-dq-border py-0.5 hover:border-dq-fire">分解</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {peekItem && (
        <ItemDetailModal item={peekItem}
          compare={isInBag(peekItem) ? game.powerIfEquipped(selectedChar, peekItem) - basePower : null}
          onBreakdown={isInBag(peekItem) ? () => { void doBreakdown(peekItem); setPeekId(null) } : undefined}
          onReforge={doReforge}
          onUndoReforge={doUndoReforge}
          onEnhance={doEnhance}
          reforgeMsg={reforgeMsg}
          enhanceMsg={enhanceMsg}
          onClose={() => { setPeekId(null); setReforgeMsg(null); setEnhanceMsg(null) }} />
      )}

      {junkPreview && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4" onClick={() => setJunkPreview(null)}>
          <div className="w-64 rounded border border-dq-fire bg-dq-panel p-3 text-xs shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 text-dq-fire">确认批量分解？</div>
            <div className="space-y-1 text-[#c9bda4]">
              <div>将分解 <span className="text-[#e8dcc8]">{junkPreview.count}</span> 件装备</div>
              <div>获得 武魂精血 ×{junkPreview.essence}{junkPreview.xuanjing ? ` · 玄晶 ×${junkPreview.xuanjing}` : ''}</div>
            </div>
            <div className="mt-2 text-[10px] text-[#a89478]">
              只分解「所有上阵武魂换上都不会变强」的装备，可能还有用的会保留。
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={confirmJunk} className="flex-1 rounded bg-dq-fire py-1 text-black">确认分解</button>
              <button onClick={() => setJunkPreview(null)} className="flex-1 rounded border border-dq-border py-1 hover:border-dq-gold">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}