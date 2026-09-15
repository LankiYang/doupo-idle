import { useState } from 'react'
import { useGame, game, charLabel, charStats, rarityInfo, fmtNum } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { equipSlotIcon } from '../game/equipIcons'
import { SLOT_INFO, AFFIX_LABEL, EQUIP_BREAKDOWN, type EquipSlot, type EquipItem, type EquipAffix } from '../game/data'

const SLOTS: EquipSlot[] = ['weapon', 'armor', 'accessory', 'ring']

/** 分解产物文案（详情浮层与确认框共用，保证口径一致） */
function breakdownText(item: EquipItem): string {
  const b = EQUIP_BREAKDOWN[item.quality]
  return b.xuanjing ? `武魂精血 ×${b.essence} · 玄晶 ×${b.xuanjing}` : `武魂精血 ×${b.essence}`
}

function AffixLine({ a, strong }: { a: EquipAffix; strong?: boolean }) {
  const suffix = a.type === 'critRate' || a.type === 'critDmg' ? '%' : '%'
  return (
    <div className={`flex justify-between ${strong ? 'text-dq-gold' : 'text-[#c9bda4]'}`}>
      <span>{AFFIX_LABEL[a.type]}</span>
      <span>+{a.value}{suffix}</span>
    </div>
  )
}

/** 装备详情：点击触发的浮层，桌面/触屏统一交互（原先用 hover 展示，触屏设备完全摸不到） */
function ItemDetailModal({ item, compare, onBreakdown, onClose }: {
  item: EquipItem; compare?: number | null; onBreakdown?: () => void; onClose: () => void
}) {
  const color = rarityInfo(item.quality).color
  const icon = equipSlotIcon(item.slot)
  // 显示战力是整数（引擎侧 Math.round），所以 ±0.5 以内的差异肉眼看不见，
  // 显示成"战力 +0"会让玩家以为界面坏了 —— 不到 1 点一律说"持平"。
  const cmp = typeof compare === 'number' ? Math.round(compare) : null
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-56 rounded border p-3 text-xs" style={{ borderColor: color }} onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          {icon && <img src={icon} alt={item.slot} className="h-10 w-10 rounded object-cover" />}
          <div style={{ color }}>{item.name}</div>
        </div>
        <div className="mb-2 text-[11px] text-[#a89478]">{SLOT_INFO[item.slot].label} · {rarityInfo(item.quality).label}</div>
        <AffixLine a={item.innate} strong />
        {item.extra.map((a, i) => <AffixLine key={i} a={a} />)}
        {cmp !== null && (
          <div className={`mt-2 text-[11px] ${cmp >= 1 ? 'text-green-400' : 'text-[#5a4a38]'}`}>
            对该武魂：{cmp >= 1 ? `战力 +${fmtNum(cmp)}` : cmp <= -1 ? '不如当前穿戴' : '≈ 持平（战力不变）'}
          </div>
        )}
        <div className="mt-2 border-t border-dq-border pt-2 text-[11px]">
          <div className="text-[#a89478]">分解可得</div>
          <div className="text-[#c9bda4]">{breakdownText(item)}</div>
        </div>
        {onBreakdown && (
          <button onClick={onBreakdown}
            className="mt-2 w-full rounded border border-dq-border py-1 text-[11px] hover:border-dq-fire">分解</button>
        )}
        <button onClick={onClose} className="mt-1 w-full rounded border border-dq-border py-1 text-[11px] hover:border-dq-gold">关闭</button>
      </div>
    </div>
  )
}

export default function EquipmentView() {
  const state = useGame()
  const teamIds = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  const [selectedChar, setSelectedChar] = useState<string | null>(teamIds[0] ?? null)
  const [peekItem, setPeekItem] = useState<EquipItem | null>(null)
  const [junkPreview, setJunkPreview] = useState<{ count: number; essence: number; xuanjing: number } | null>(null)
  const [toast, setToast] = useState('')

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

  function doAutoEquip() {
    const r = game.autoEquipBest()
    const shown = Math.round(r.powerGain)
    setToast(r.changed
      ? `✓ 已为 ${teamIds.length} 名上阵武魂自动换上四件套（调整 ${r.changed} 件，${shown >= 1 ? `战力 +${fmtNum(shown)}` : '显示战力持平'}）`
      : '当前穿戴已是最优，无需调整')
  }

  /** 先扫一遍算出会分解多少、产出多少，让玩家确认后才真正执行 */
  function previewJunk() {
    let count = 0, essence = 0, xuanjing = 0
    for (const item of state.equipBag) {
      if (!game.isJunkEquip(item)) continue
      const b = EQUIP_BREAKDOWN[item.quality]
      count++; essence += b.essence; xuanjing += b.xuanjing
    }
    if (!count) { setToast('没有可分解的装备（背包里的都还有用武之地）'); return }
    setJunkPreview({ count, essence, xuanjing })
  }

  function confirmJunk() {
    const r = game.breakdownJunk()
    setJunkPreview(null)
    setToast(`✓ 分解 ${r.count} 件，获得武魂精血 ×${r.essence}${r.xuanjing ? ` · 玄晶 ×${r.xuanjing}` : ''}`)
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
                  <div className="truncate px-0.5" style={{ color: rarityInfo(d.rarity).color }}>{d.name.slice(0, 4)}</div>
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
              <button onClick={doAutoEquip}
                className="rounded bg-dq-gold px-2.5 py-1 text-[11px] text-black">一键最优穿戴</button>
              <button onClick={previewJunk}
                className="rounded border border-dq-border px-2.5 py-1 text-[11px] text-[#e8dcc8] hover:border-dq-fire">一键分解垃圾</button>
            </div>
          </div>
          {toast && <div className="mb-2 text-[11px] text-dq-gold">{toast}</div>}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
            {SLOTS.map(slot => {
              const item = entry.equip[slot]
              const icon = equipSlotIcon(slot)
              const color = item ? rarityInfo(item.quality).color : '#3a2a1a'
              return (
                <div key={slot} className="rounded border p-2 text-center text-xs" style={{ borderColor: color }}>
                  <div className="mb-1 text-[10px] text-[#a89478]">{SLOT_INFO[slot].label}</div>
                  <button onClick={() => item && setPeekItem(item)} disabled={!item}
                    className="mx-auto mb-1 block h-11 w-11 overflow-hidden rounded bg-black/30 sm:h-14 sm:w-14">
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
                const gain = game.powerIfEquipped(selectedChar, item) - basePower
                // 同上：按取整后的显示战力分档，避免出现"↑ 战力 +0"
                const gained = Math.round(gain)
                return (
                  <div key={item.id} className="relative rounded border p-1.5 text-center text-[10px]" style={{ borderColor: color }}>
                    <button onClick={() => setPeekItem(item)} className="mx-auto block h-10 w-10 overflow-hidden rounded bg-black/30">
                      {icon && <img src={icon} alt={item.slot} className="h-full w-full object-cover" />}
                    </button>
                    <button onClick={() => setPeekItem(item)} className="w-full truncate" style={{ color }}>{item.name}</button>
                    <div className={`mt-0.5 text-[9px] ${gained >= 1 ? 'text-green-400' : 'text-[#5a4a38]'}`}>
                      {gained >= 1 ? `↑ 战力 +${fmtNum(gained)}` : gained <= -1 ? '不如当前' : '≈ 持平'}
                    </div>
                    <div className="mt-1">
                      <button onClick={() => game.equipItem(selectedChar, item.id)}
                        className="w-full rounded bg-dq-gold py-0.5 text-black">穿戴</button>
                    </div>
                    <div className="mt-0.5 flex gap-1">
                      <button onClick={() => game.sellEquip(item.id)}
                        className="flex-1 rounded border border-dq-border hover:border-dq-gold">卖</button>
                      <button onClick={() => game.breakdownEquip(item.id)}
                        className="flex-1 rounded border border-dq-border hover:border-dq-fire">分解</button>
                    </div>
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
          onBreakdown={isInBag(peekItem) ? () => { game.breakdownEquip(peekItem.id); setPeekItem(null) } : undefined}
          onClose={() => setPeekItem(null)} />
      )}

      {junkPreview && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={() => setJunkPreview(null)}>
          <div className="w-64 rounded border border-dq-fire p-3 text-xs" onClick={e => e.stopPropagation()}>
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