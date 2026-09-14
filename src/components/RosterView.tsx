import { useState, useEffect } from 'react'
import { useGame, game, charLabel, rarityInfo, itemLabel, ESSENCE_BY_RARITY } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { xpToNext, realmLabel, needsPillFor, pillGradeFor, FIRES, MAX_STARS, starUpCost } from '../game/data'

type AssignTarget = { row: 'front' | 'back'; index: number } | null

/** 星级字形：clamp 到 [0, MAX_STARS]，杜绝 repeat(负数) 崩溃（升星上限已是 10★，旧代码硬编码 5 会在 6★+ 时炸） */
function starGlyphs(stars: number): string {
  const s = Math.max(0, Math.min(MAX_STARS, Math.floor(stars) || 0))
  return '★'.repeat(s) + '☆'.repeat(MAX_STARS - s)
}

export default function RosterView() {
  const state = useGame()
  const [selected, setSelected] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<AssignTarget>(null)
  const ownedIds = Object.keys(state.roster)

  const pickChar = (id: string) => {
    if (assignTarget) {
      game.setSlot(assignTarget.row, assignTarget.index, id)
      setAssignTarget(null)
    }
    setSelected(id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 sm:flex-row sm:p-4">
      <div className="shrink-0 space-y-3 sm:w-64">
        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">前排</div>
          <div className="flex gap-2">
            {state.team.front.map((id, i) => (
              <Slot key={i} charId={id}
                active={assignTarget?.row === 'front' && assignTarget.index === i}
                onClick={() => { setAssignTarget({ row: 'front', index: i }); if (id) setSelected(id) }}
                onClear={() => game.setSlot('front', i, null)} />
            ))}
          </div>
          <div className="mb-2 mt-3 text-sm text-dq-gold">后排</div>
          <div className="flex gap-2">
            {state.team.back.map((id, i) => (
              <Slot key={i} charId={id}
                active={assignTarget?.row === 'back' && assignTarget.index === i}
                onClick={() => { setAssignTarget({ row: 'back', index: i }); if (id) setSelected(id) }}
                onClear={() => game.setSlot('back', i, null)} />
            ))}
          </div>
          {assignTarget && (
            <div className="mt-2 text-[11px] text-dq-gold">
              点击下方武魂即可编入 {assignTarget.row === 'front' ? '前排' : '后排'}{assignTarget.index + 1}
              <button onClick={() => setAssignTarget(null)} className="ml-2 text-[#a89478] underline">取消</button>
            </div>
          )}
        </div>

        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">武魂名录</div>
          <div className="grid grid-cols-4 gap-2">
            {ownedIds.map(id => {
              const cdef = charLabel(id)!
              const rarity = rarityInfo(cdef.rarity)
              const portrait = portraitFor(id)
              return (
                <button key={id} onClick={() => pickChar(id)}
                  className="relative aspect-square overflow-hidden rounded border"
                  style={{ borderColor: selected === id ? rarity.color : '#3a2a1a' }}>
                  {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[9px] leading-tight"
                    style={{ color: rarity.color }}>
                    {cdef.name.slice(0, 4)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <FirePanel />
      </div>

      <div className="dq-panel min-w-0 flex-1 rounded-md p-4">
        {selected ? <CharDetail key={selected} id={selected} onAssign={(row, idx) => game.setSlot(row, idx, selected)} onSold={() => setSelected(null)} /> : (
          <div className="flex h-full items-center justify-center text-[#a89478]">点击左侧武魂查看详情，或先点一个空位再选武魂快速编入</div>
        )}
      </div>
    </div>
  )
}

function FirePanel() {
  const state = useGame()
  const leaderId = state.team.front[0]
  const leader = leaderId ? charLabel(leaderId) : null

  return (
    <div className="dq-panel rounded-md p-3">
      <div className="mb-1 text-sm text-dq-gold">异火</div>
      <div className="mb-2 text-[11px] text-[#a89478]">
        异火只认前排第一位为主{leader ? `（当前：${leader.name}）` : '（前排第一位空缺）'}
      </div>
      <div className="space-y-1">
        {FIRES.map(f => {
          const owned = state.inventory[`fire_${f.id}`] > 0
          const equipped = state.equippedFire === f.id
          return (
            <button key={f.id} disabled={!owned}
              onClick={() => game.equipFire(equipped ? null : f.id)}
              className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs disabled:opacity-30 ${equipped ? 'border-dq-fire' : 'border-dq-border hover:border-dq-gold'}`}>
              <span>{f.icon}</span>
              <span className="min-w-0 flex-1">
                <div className={equipped ? 'text-dq-fire' : 'text-[#e8dcc8]'}>{f.name}{equipped && ' · 已装配'}</div>
                <div className="truncate text-[#a89478]">{owned ? f.desc : `未获得 · ${f.source}`}</div>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Slot({ charId, active, onClick, onClear }: { charId: string | null; active: boolean; onClick: () => void; onClear: () => void }) {
  const cdef = charId ? charLabel(charId) : null
  const portrait = charId ? portraitFor(charId) : null
  return (
    <div onClick={onClick}
      className="relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-dq-border text-[11px] hover:border-dq-gold"
      style={{
        borderColor: active ? '#e8b04a' : cdef ? rarityInfo(cdef.rarity).color : undefined,
        borderStyle: cdef || active ? 'solid' : 'dashed',
      }}>
      {cdef ? (
        <>
          {portrait ? (
            <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-center leading-tight" style={{ color: rarityInfo(cdef.rarity).color }}>{cdef.name.slice(0, 3)}</span>
          )}
          <button onClick={e => { e.stopPropagation(); onClear() }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">×</button>
        </>
      ) : <span className="text-[#5a4a38]">{active ? '选择武魂' : '空位'}</span>}
    </div>
  )
}

function CharDetail({ id, onAssign, onSold }: { id: string; onAssign: (row: 'front' | 'back', idx: number) => void; onSold: () => void }) {
  const state = useGame()
  const [trainAmt, setTrainAmt] = useState(100)
  // 打坐滑条上限快照：斗气结晶每 tick 都在涨，若直接绑定 max/value，滑条会随每次重渲染自己滑动。
  // 改为仅在挂载/切换角色时快照一次，保持稳定；真正花费时 engine.trainChar 会再按当前结晶取 min，不会超花。
  const [snapCrystal, setSnapCrystal] = useState(() => Math.max(10, Math.floor(state.inventory.crystal ?? 0)))
  useEffect(() => { setSnapCrystal(Math.max(10, Math.floor(state.inventory.crystal ?? 0))) }, [id])
  const [confirmSell, setConfirmSell] = useState(false)
  const cdef = charLabel(id)
  const entry = state.roster[id]
  if (!cdef || !entry) return null
  const rarity = rarityInfo(cdef.rarity)
  const portrait = portraitFor(id)
  const need = xpToNext(entry.level)
  const blockedByPill = entry.xp >= need && needsPillFor(entry.level)
  const pillGrade = pillGradeFor(entry.level)
  const inTeam = [...state.team.front, ...state.team.back].includes(id)
  const sellGain = ESSENCE_BY_RARITY[cdef.rarity]

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {portrait && (
        <div className="mx-auto w-28 shrink-0 overflow-hidden rounded-md border-2 sm:mx-0 sm:w-36" style={{ borderColor: rarity.color }}>
          <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl" style={{ color: rarity.color }}>{cdef.name}</div>
            <div className="text-sm text-[#a89478]">{rarity.label} · {cdef.desc}</div>
          </div>
          <div className="text-right">
            <div className="text-dq-gold">{realmLabel(entry.level)}</div>
            <div className="text-sm text-[#a89478]">{starGlyphs(entry.stars)}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label="攻击" value={Math.round(cdef.baseAtk + cdef.atkGrowth * entry.level)} />
          <Stat label="防御" value={Math.round(cdef.baseDef + cdef.defGrowth * entry.level)} />
          <Stat label="气血" value={Math.round(cdef.baseHp + cdef.hpGrowth * entry.level)} />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-[#a89478]">
            <span>修炼进度</span>
            <span>{Math.floor(entry.xp)} / {need}</span>
          </div>
          <div className="h-2 rounded bg-black/40">
            <div className="h-2 rounded bg-dq-gold" style={{ width: `${Math.min(100, (entry.xp / need) * 100)}%` }} />
          </div>
          {blockedByPill && (
            <div className="mt-1 text-xs text-dq-fire">突破需要 {pillGrade} 品丹药 ×1（背包：{state.inventory[`pill${pillGrade}`] ?? 0}）</div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input type="range" min={10} max={snapCrystal} step={10}
            value={Math.min(trainAmt, snapCrystal)}
            onChange={e => setTrainAmt(Number(e.target.value))}
            className="flex-1" />
          <span className="w-20 text-right text-sm">{Math.min(trainAmt, snapCrystal)} 结晶</span>
          <button onClick={() => game.trainChar(id, trainAmt)}
            className="rounded bg-dq-gold px-3 py-1 text-sm text-black">打坐修炼</button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {entry.stars >= MAX_STARS ? (
            <div className="rounded border border-dq-border px-3 py-1 text-sm text-[#5a4a38]">已达最高星级 {MAX_STARS}★</div>
          ) : (() => {
            const c = starUpCost(entry.stars)
            const have = state.inventory[c.item] ?? 0
            return (
              <button onClick={() => game.starUp(id)} disabled={have < c.amount}
                className="rounded border border-dq-border px-3 py-1 text-sm hover:border-dq-gold disabled:opacity-40">
                升星 {entry.stars}★→{entry.stars + 1}★（消耗 {c.amount} {itemLabel(c.item).icon}{itemLabel(c.item).name}，拥有 {Math.floor(have)}）
              </button>
            )
          })()}
        </div>

        <div className="mt-4">
          <div className="mb-1 text-xs text-[#a89478]">编入阵容</div>
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <button key={`f${i}`} onClick={() => onAssign('front', i)}
                className="rounded border border-dq-border px-2 py-1 text-xs hover:border-dq-gold">前排{i + 1}</button>
            ))}
            {[0, 1].map(i => (
              <button key={`b${i}`} onClick={() => onAssign('back', i)}
                className="rounded border border-dq-border px-2 py-1 text-xs hover:border-dq-gold">后排{i + 1}</button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {inTeam ? (
            <div className="text-xs text-[#5a4a38]">上阵中的武魂不能放生，先换下来再操作</div>
          ) : confirmSell ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-dq-fire">确定放生 {cdef.name}？此操作不可撤销</span>
              <button onClick={() => { game.releaseChar(id); onSold() }}
                className="rounded bg-dq-fire px-2 py-1 text-black">确认放生</button>
              <button onClick={() => setConfirmSell(false)}
                className="rounded border border-dq-border px-2 py-1 hover:border-dq-gold">取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirmSell(true)}
              className="rounded border border-dq-border px-2 py-1 text-xs text-[#a89478] hover:border-dq-fire hover:text-dq-fire">
              放生（换取 {sellGain} 🩸武魂精血）
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-dq-border p-2 text-center">
      <div className="text-[#a89478]">{label}</div>
      <div className="text-dq-gold">{value}</div>
    </div>
  )
}
