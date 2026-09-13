import { useState } from 'react'
import { useGame, game, charLabel, charStats, rarityInfo } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { equipSlotIcon } from '../game/equipIcons'
import { SLOT_INFO, AFFIX_LABEL, type EquipSlot, type EquipItem, type EquipAffix } from '../game/data'

const SLOTS: EquipSlot[] = ['weapon', 'armor', 'accessory', 'ring']

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
function ItemDetailModal({ item, onClose }: { item: EquipItem; onClose: () => void }) {
  const color = rarityInfo(item.quality).color
  const icon = equipSlotIcon(item.slot)
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
        <button onClick={onClose} className="mt-3 w-full rounded border border-dq-border py-1 text-[11px] hover:border-dq-gold">关闭</button>
      </div>
    </div>
  )
}

export default function EquipmentView() {
  const state = useGame()
  const teamIds = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  const [selectedChar, setSelectedChar] = useState<string | null>(teamIds[0] ?? null)
  const [peekItem, setPeekItem] = useState<EquipItem | null>(null)

  if (teamIds.length === 0 || !selectedChar) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[#a89478]">先去阵容页编排队伍，再来管理装备</div>
  }

  const cdef = charLabel(selectedChar)!
  const entry = state.roster[selectedChar]
  const fireId = state.equippedFire && selectedChar === state.team.front[0] ? state.equippedFire : null
  const stats = charStats(entry, cdef, fireId)

  const bagSorted = [...state.equipBag].sort((a, b) => rarityInfo(b.quality).order - rarityInfo(a.quality).order)

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
          <div className="mb-2 text-sm text-dq-gold">已穿戴</div>
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
            <div className="text-[11px] text-[#a89478]">击杀有概率掉落，首领掉落率更高</div>
          </div>
          {bagSorted.length === 0 ? (
            <div className="text-xs text-[#5a4a38]">暂无装备，去主线或天梯塔多打几场</div>
          ) : (
            <div className="grid grid-cols-4 gap-2 overflow-auto sm:grid-cols-6">
              {bagSorted.map(item => {
                const color = rarityInfo(item.quality).color
                const icon = equipSlotIcon(item.slot)
                return (
                  <div key={item.id} className="relative rounded border p-1.5 text-center text-[10px]" style={{ borderColor: color }}>
                    <button onClick={() => setPeekItem(item)} className="mx-auto block h-10 w-10 overflow-hidden rounded bg-black/30">
                      {icon && <img src={icon} alt={item.slot} className="h-full w-full object-cover" />}
                    </button>
                    <button onClick={() => setPeekItem(item)} className="w-full truncate" style={{ color }}>{item.name}</button>
                    <div className="mt-1 flex gap-1">
                      <button onClick={() => game.equipItem(selectedChar, item.id)}
                        className="flex-1 rounded bg-dq-gold py-0.5 text-black">穿戴</button>
                      <button onClick={() => game.sellEquip(item.id)}
                        className="flex-1 rounded border border-dq-border hover:border-dq-fire">卖</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {peekItem && <ItemDetailModal item={peekItem} onClose={() => setPeekItem(null)} />}
    </div>
  )
}
