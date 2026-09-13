import { useState } from 'react'
import { useGame, game, charLabel, rarityInfo } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { CHARACTERS, SHENG_SHARD_COST, type Rarity } from '../game/data'

export default function RecruitView() {
  const state = useGame()
  const [results, setResults] = useState<{ id: string; isNew: boolean; rarity: Rarity }[]>([])

  const pull = (times: 1 | 10) => {
    const r = game.recruit(times)
    if (r.length > 0) setResults(r)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        <div className="mb-1 text-dq-gold">结拜天下豪杰</div>
        <div className="mb-3 text-sm text-[#a89478]">消耗缘分丹招募武魂，距保底地阶 {30 - state.pityCommon} 抽，距保底天阶 {90 - state.pityRare} 抽</div>
        <div className="flex flex-col justify-center gap-2 sm:flex-row sm:gap-3">
          <button onClick={() => pull(1)} disabled={(state.inventory.yuanfen ?? 0) < 1}
            className="rounded bg-dq-gold px-4 py-2 text-sm text-black disabled:opacity-40">
            结拜一次（缘分丹×1）
          </button>
          <button onClick={() => pull(10)} disabled={(state.inventory.yuanfen ?? 0) < 10}
            className="rounded bg-dq-fire px-4 py-2 text-sm text-black disabled:opacity-40">
            结拜十次（缘分丹×10）
          </button>
        </div>
        <div className="mt-3 border-t border-dq-border pt-3">
          <button onClick={() => game.redeemShengShard()}
            disabled={(state.inventory.shard_sheng ?? 0) < SHENG_SHARD_COST}
            className="rounded border border-dq-fire px-4 py-2 text-sm text-dq-fire disabled:opacity-40">
            ✨ 碎片凝聚·必得圣阶（圣阶角色碎片 ×{SHENG_SHARD_COST}，拥有 {state.inventory.shard_sheng ?? 0}）
          </button>
          <div className="mt-1 text-[11px] text-[#a89478]">碎片由中州（第 60 关起）掉落</div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="dq-panel grid w-full max-w-xl grid-cols-5 gap-2 rounded-md p-4">
          {results.map((r, i) => {
            const cdef = charLabel(r.id)!
            const rarity = rarityInfo(r.rarity)
            const portrait = portraitFor(r.id)
            return (
              <div key={i} className="overflow-hidden rounded border text-center text-xs" style={{ borderColor: rarity.color }}>
                <div className="relative aspect-square">
                  {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                  {r.isNew && <span className="absolute right-0 top-0 rounded-bl bg-green-600 px-1 text-[9px] text-white">新</span>}
                </div>
                <div className="truncate px-0.5" style={{ color: rarity.color }}>{cdef.name.slice(0, 4)}</div>
                <div className="pb-1 text-[#a89478]">{rarity.label}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-2 text-sm text-dq-gold">武魂名录（{Object.keys(state.roster).length} / {CHARACTERS.length} 已收录）</div>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {CHARACTERS.map(c => {
            const owned = !!state.roster[c.id]
            const rarity = rarityInfo(c.rarity)
            const portrait = portraitFor(c.id)
            return (
              <div key={c.id} className="overflow-hidden rounded border text-center text-[10px]"
                style={{ borderColor: owned ? rarity.color : '#3a2a1a', opacity: owned ? 1 : 0.35 }}>
                <div className="aspect-square">
                  {portrait && <img src={portrait} alt={c.name} className="h-full w-full object-cover" style={{ filter: owned ? 'none' : 'grayscale(1)' }} />}
                </div>
                <div className="truncate px-0.5" style={{ color: owned ? rarity.color : '#a89478' }}>{c.name.slice(0, 4)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
