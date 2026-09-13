import { useGame, game, itemLabel, pillCraftCost } from '../game/engine'
import { PILLS, REALMS } from '../game/data'

function realmForGrade(grade: number): string {
  const idx = REALMS.findIndex(r => r.pillGrade === grade)
  if (idx < 0) return ''
  const from = REALMS[idx]
  const to = REALMS[idx + 1]
  return to ? `${from.name} → ${to.name}` : `${from.name} 境内`
}

export default function AlchemyView() {
  const state = useGame()

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-2xl rounded-md p-4 text-center">
        <div className="mb-1 text-dq-gold">丹房炼药</div>
        <div className="text-sm text-[#a89478]">
          打坐时药园会自动产出 {itemLabel('herb').icon}灵药（当前 {Math.floor(state.inventory.herb ?? 0)}），
          消耗灵药+灵金即可炼制对应品阶丹药，用于角色跨境界突破，不必只靠打怪掉落
        </div>
      </div>

      <div className="dq-panel grid w-full max-w-2xl grid-cols-2 gap-3 rounded-md p-4 sm:grid-cols-4">
        {PILLS.map(p => {
          const cost = pillCraftCost(p.grade)
          const have = state.inventory[p.id] ?? 0
          const canAfford = (state.inventory.herb ?? 0) >= cost.herb && (state.inventory.coin ?? 0) >= cost.coin
          return (
            <div key={p.id} className="rounded border border-dq-border p-2 text-center text-xs">
              <div className="text-2xl">{p.icon}</div>
              <div className="mt-1 text-dq-gold">{p.name}</div>
              <div className="text-[#a89478]">{realmForGrade(p.grade)}</div>
              <div className="mt-1 text-[#a89478]">拥有 ×{Math.floor(have)}</div>
              <div className="mt-1 text-[#a89478]">{itemLabel('herb').icon}{cost.herb} + {itemLabel('coin').icon}{cost.coin}</div>
              <button onClick={() => game.craftPill(p.grade)} disabled={!canAfford}
                className="mt-2 w-full rounded bg-dq-gold px-2 py-1 text-black disabled:opacity-30">
                炼制
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
