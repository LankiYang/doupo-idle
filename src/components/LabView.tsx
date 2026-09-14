import { useState } from 'react'
import { useGame, game, charLabel, charStats, rarityInfo, itemLabel, fmtNum, LAB_OFFER_TIMEOUT, type CombatEvent, type GameState } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { sceneFor } from '../game/scenes'
import { blessingIconFor } from '../game/blessings'
import { impactFxForRole, impactFxForMonster, healFx } from '../game/fx'
import { useCombatSound } from '../game/sound'
import { LAB_BLESSINGS, labStats, isLabBoss, towerMonsterName, towerMonsterSpriteId, towerTierForFloor, ROLE_COLOR, ATK_STYLE_COLOR, type BlessingCategory, type AtkStyle } from '../game/data'

// 演出时间窗（ms）——与主线战斗一致
const HIT_MS = 380
const DASH_MS = 420
const IMPACT_MS = 450
const KILL_MS = 500
const IMPACT_DELAY = 200

const CATEGORY_COLOR: Record<BlessingCategory, string> = {
  offense: '#ff6a6a',
  defense: '#6ab4ff',
  economy: '#e8b04a',
}

function active(e: CombatEvent, now: number, windowMs: number): boolean {
  return e.time <= now && now - e.time < windowMs
}

function atImpact(e: CombatEvent): CombatEvent {
  return { ...e, time: e.time + IMPACT_DELAY }
}

function eventColor(e: CombatEvent, monsterAtkStyle: AtkStyle): string {
  if (e.type === 'heal') return '#4ade80'
  if (e.type === 'monsterDmg') return ATK_STYLE_COLOR[monsterAtkStyle]
  const role = e.who ? charLabel(e.who)?.role : undefined
  return role ? ROLE_COLOR[role] : '#ffd27a'
}

function FloatingNumbers({ events, refMax, now, monsterAtkStyle = 'melee' }: { events: CombatEvent[]; refMax: number; now: number; monsterAtkStyle?: AtkStyle }) {
  return (
    <>
      {events.filter(e => e.time <= now).map((e, i) => {
        const isHeal = e.type === 'heal'
        const color = eventColor(e, monsterAtkStyle)
        const pct = refMax > 0 ? e.value / refMax : 0
        const fontSize = pct >= 0.25 ? '22px' : pct >= 0.12 ? '17px' : '13px'
        const slot = Math.round(e.time / 97) % 3
        return (
          <span key={`${e.time}-${e.type}-${e.who ?? ''}-${i}`}
            className={`dq-floating-num ${isHeal ? 'heal' : ''}`}
            style={{ left: `calc(50% + ${(slot - 1) * 16}px)`, color, fontSize }}>
            {isHeal ? '+' : '-'}{fmtNum(e.value)}
          </span>
        )
      })}
    </>
  )
}

function ImpactFx({ src, rotate }: { src: string | undefined; rotate?: number }) {
  if (!src) return null
  return <img src={src} alt="" className="dq-impact-fx" style={rotate ? ({ '--fx-rot': `${rotate}deg` } as React.CSSProperties) : undefined} />
}

function LabFighterCard({ id, state, now, monsterAtkStyle }: { id: string | null; state: GameState; now: number; monsterAtkStyle: AtkStyle }) {
  if (!id) return <div className="aspect-square w-12 shrink-0 rounded border border-dashed border-dq-border sm:w-16" />
  const cdef = charLabel(id)!
  const entry = state.roster[id]
  const portrait = portraitFor(id)
  const fireId = state.equippedFire && id === state.team.front[0] ? state.equippedFire : null
  const bt = game.blessingTotals()
  const maxHp = Math.max(1, Math.round(charStats(entry, cdef, fireId).hp * (1 + bt.hpPct / 100)))
  const hp = state.lab.battle?.fighterHp[id] ?? maxHp
  const alive = hp > 0
  const mine = state.combatEvents.filter(e => e.source === 'lab' && e.who === id)
  const isHit = mine.some(e => e.type === 'monsterDmg' && active(atImpact(e), now, HIT_MS))
  const isHealed = mine.some(e => e.type === 'heal' && active(atImpact(e), now, IMPACT_MS))
  const isAttacking = mine.some(e => (e.type === 'dmg' || (e.type === 'heal' && cdef.role === 'heal')) && active(e, now, DASH_MS))
  const events = mine.filter(e => e.type === 'monsterDmg' || e.type === 'heal').map(atImpact)
  return (
    <div className={`relative w-12 shrink-0 overflow-visible rounded border text-center text-[9px] sm:w-16 sm:text-[10px] ${alive ? 'border-dq-border' : 'border-red-900'} ${isHit ? 'dq-hit-shake-left' : ''} ${isAttacking ? 'dq-attack-dash' : ''}`}>
      <div className={`aspect-square overflow-hidden rounded-t ${!alive ? 'dq-death-fade' : ''}`}>
        {portrait && <img src={portrait} alt={cdef.name} className={`h-full w-full object-cover ${alive && !isAttacking ? 'dq-idle-bob' : ''}`} />}
      </div>
      {isHit && <ImpactFx src={impactFxForMonster(monsterAtkStyle)} />}
      {isHealed && <ImpactFx src={healFx()} />}
      <div className="truncate px-0.5" style={{ color: rarityInfo(cdef.rarity).color }}>{cdef.name.slice(0, 3)}</div>
      <div className="mx-1 mb-1 h-1 rounded bg-black/40">
        <div className="h-1 rounded bg-green-600 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
      </div>
      <FloatingNumbers events={events} refMax={maxHp} now={now} monsterAtkStyle={monsterAtkStyle} />
    </div>
  )
}

export default function LabView() {
  const state = useGame()
  const lab = state.lab
  const floor = lab.battle?.floor ?? lab.highestFloor + 1
  const boss = isLabBoss(floor)
  const monster = labStats(floor)
  const monsterName = towerMonsterName(floor)
  const monsterSprite = monsterSpriteFor(towerMonsterSpriteId(floor))
  const monsterAtkStyle = towerTierForFloor(floor).atkStyle
  const scene = sceneFor('tower')
  const now = Date.now()

  const labEvents = state.combatEvents.filter(e => e.source === 'lab')
  useCombatSound(labEvents)
  const hittingNow = labEvents.filter(e => e.type === 'dmg' && active(atImpact(e), now, HIT_MS))
  const monsterHit = hittingNow.length > 0
  const hitterRole = hittingNow.length > 0 ? charLabel(hittingNow[hittingNow.length - 1].who!)?.role : undefined
  const monsterAttacking = labEvents.some(e => e.type === 'monsterDmg' && active(e, now, DASH_MS))
  const monsterKilled = labEvents.some(e => e.type === 'kill' && active(atImpact(e), now, KILL_MS))
  const monsterDmgEvents = labEvents.filter(e => e.type === 'dmg').map(atImpact)
  const [confirming, setConfirming] = useState<string | null>(null)

  const pickBlessing = (id: string) => {
    if (confirming) return
    setConfirming(id)
    setTimeout(() => { game.chooseBlessing(id); setConfirming(null) }, 320)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:flex-row sm:gap-4 sm:p-4">
      <div className="shrink-0 space-y-2 sm:w-56">
        <div className="dq-panel rounded-md p-3 text-center">
          <div className="text-xs text-[#a89478]">当前层数</div>
          <div className="text-3xl text-dq-gold">{lab.battle ? floor : '—'}</div>
          <div className="text-xs text-[#a89478]">生涯最高 {lab.highestFloor} 层</div>
        </div>

        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">本次祝福</div>
          {lab.blessings.length === 0 ? (
            <div className="text-xs text-[#5a4a38]">尚未获得祝福，每 5 层首领三选一</div>
          ) : (
            <div className="space-y-1">
              {lab.blessings.map(id => {
                const b = LAB_BLESSINGS.find(x => x.id === id)!
                const color = CATEGORY_COLOR[b.category]
                const icon = blessingIconFor(b.id)
                return (
                  <div key={id} className="flex items-start gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: color }}>
                    {icon && <img src={icon} alt={b.name} className="mt-0.5 h-6 w-6 shrink-0 rounded object-cover" />}
                    <div>
                      <span style={{ color }}>{b.name}</span>
                      <div className="text-[#a89478]">{b.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-2 text-[11px] text-[#a89478]">战败或撤退会清空祝福，从第 1 层重新开始；生涯最高层与论道令永久保留</div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => game.toggleAutoLab()}
            className={`flex-1 rounded px-3 py-2 text-sm ${lab.autoLab ? 'bg-dq-fire text-black' : 'bg-dq-gold text-black'}`}>
            {lab.autoLab ? '爬塔中（点击停止）' : '开始爬塔'}
          </button>
          {lab.battle && (
            <button onClick={() => game.retreatLab()}
              className="rounded border border-dq-border px-3 py-2 text-sm hover:border-dq-gold">撤退</button>
          )}
        </div>

        <LabShop />
      </div>

      <div className={`relative flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-dq-border p-3 sm:min-h-0 sm:p-4 ${monsterKilled ? 'dq-screen-shake' : ''}`}
        style={scene ? { backgroundImage: `linear-gradient(180deg, rgba(10,8,20,0.6), rgba(8,6,16,0.88)), url(${scene})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: '#1a1310' }}>
        <div className="mb-3 flex items-center justify-between text-sm sm:text-base">
          <div className="text-dq-gold">
            天梯塔 · 第 {floor} 层 · {monsterName}
            {boss && <span className="ml-2 rounded bg-dq-fire px-1.5 py-0.5 text-xs text-black">首领</span>}
          </div>
        </div>

        {!lab.battle && !lab.offer && (
          <div className="mb-2 text-sm text-[#a89478]">尚未出发，点击"开始爬塔"——每次都是全新的祝福组合</div>
        )}

        {lab.offer && (
          <div className="mb-4 rounded-md border border-dq-fire bg-black/60 p-3">
            <div className="mb-2 text-center text-sm text-dq-fire">✨ 三选一祝福 ✨
              {lab.offerAt > 0 && (
                <span className="ml-2 text-xs text-[#a89478]">
                  {Math.max(0, Math.ceil((LAB_OFFER_TIMEOUT - (now - lab.offerAt)) / 1000))}s 后自动选择
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {lab.offer.map(id => {
                const b = LAB_BLESSINGS.find(x => x.id === id)!
                const color = CATEGORY_COLOR[b.category]
                const isConfirming = confirming === id
                const icon = blessingIconFor(b.id)
                return (
                  <button key={id} onClick={() => pickBlessing(id)} disabled={!!confirming}
                    className={`relative overflow-visible rounded border-2 p-2 text-center text-xs transition-transform disabled:cursor-default ${isConfirming ? 'scale-105' : 'hover:scale-[1.03]'}`}
                    style={{ borderColor: color, opacity: confirming && !isConfirming ? 0.35 : 1 }}>
                    {icon ? (
                      <img src={icon} alt={b.name} className="mx-auto h-8 w-8 rounded object-cover sm:h-10 sm:w-10" />
                    ) : (
                      <div className="text-xl">✨</div>
                    )}
                    <div className="mt-1" style={{ color }}>{b.name}</div>
                    <div className="mt-1 text-[#a89478]">{b.desc}</div>
                    {isConfirming && (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded dq-blessing-pick"
                        style={{ background: `${color}55` }}>
                        <span className="text-lg text-white">✓</span>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="relative mb-4 flex flex-1 items-center justify-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="flex flex-col justify-center gap-1 sm:gap-1.5">
              {state.team.back.map((id, i) => <LabFighterCard key={`b${i}`} id={lab.battle ? id : null} state={state} now={now} monsterAtkStyle={monsterAtkStyle} />)}
            </div>
            <div className="flex flex-col justify-center gap-1 sm:gap-1.5">
              {state.team.front.map((id, i) => <LabFighterCard key={`f${i}`} id={lab.battle ? id : null} state={state} now={now} monsterAtkStyle={monsterAtkStyle} />)}
            </div>
          </div>

          <div className="shrink-0 px-1 text-lg text-dq-fire sm:px-2 sm:text-2xl">⚔</div>

          <div className="flex w-24 shrink-0 flex-col items-center gap-2 sm:w-32">
            <div className={`relative h-20 w-20 overflow-visible rounded border-2 sm:h-24 sm:w-24 ${boss ? 'border-dq-fire dq-boss-pulse' : 'border-dq-border'} bg-black/30 ${monsterKilled ? 'dq-kill-flash' : ''} ${monsterAttacking ? 'dq-monster-lunge' : ''}`}>
              <div className={`flex h-full w-full items-center justify-center overflow-hidden rounded ${monsterHit ? 'dq-hit-shake' : ''}`}>
                {monsterSprite ? (
                  <img src={monsterSprite} alt={monsterName} className={`h-full w-full object-contain [transform:scaleX(-1)] ${!monsterHit && !monsterAttacking ? 'dq-idle-bob-flip' : ''}`} />
                ) : (
                  <div className="text-3xl">{boss ? '👑' : '👹'}</div>
                )}
              </div>
              {monsterHit && hitterRole && <ImpactFx src={impactFxForRole(hitterRole)} rotate={hittingNow.length % 2 === 0 ? -18 : 12} />}
              <FloatingNumbers events={monsterDmgEvents} refMax={monster.hp} now={now} monsterAtkStyle={monsterAtkStyle} />
            </div>
            {lab.battle && (
              <div className="w-full">
                <div className="mb-1 flex justify-between text-[10px] text-[#a89478]">
                  <span>血量</span>
                  <span>{fmtNum(Math.max(0, lab.battle.monsterHp))} / {fmtNum(monster.hp)}</span>
                </div>
                <div className="h-3 rounded bg-black/40">
                  <div className="h-3 rounded bg-dq-fire transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max(0, (lab.battle.monsterHp / monster.hp) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded border border-dq-border bg-black/40 p-2 text-xs">
          {labEvents.filter(e => e.time <= now).slice(-10).reverse().map((e, i) => (
            <div key={i} className="text-[#a89478]">
              {e.type === 'dmg' && `${charLabel(e.who!)?.name ?? ''} 造成 ${e.value} 伤害`}
              {e.type === 'heal' && `${charLabel(e.who!)?.name ?? ''} 回复 ${e.value} 气血`}
              {e.type === 'monsterDmg' && `${monsterName} 对 ${charLabel(e.who!)?.name ?? ''} 造成 ${e.value} 伤害`}
              {e.type === 'down' && `${charLabel(e.who!)?.name ?? ''} 倒下了`}
              {e.type === 'kill' && `突破 ${e.who}！`}
              {e.type === 'drop' && `首通奖励 ${itemLabel(e.item!).icon}${itemLabel(e.item!).name} ×${e.value}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LabShop() {
  const state = useGame()
  const daoling = state.inventory.daoling ?? 0
  return (
    <div className="dq-panel rounded-md p-3">
      <div className="mb-2 text-sm text-dq-gold">论道令商店（{daoling}）</div>
      <div className="space-y-1">
        {[1, 3, 5].map(grade => (
          <button key={grade} onClick={() => game.buyLabShop('pill', grade)}
            className="flex w-full items-center justify-between rounded border border-dq-border px-2 py-1 text-xs hover:border-dq-gold">
            <span>💊 {grade} 品丹药 ×1</span>
            <span className="text-dq-gold">{grade * 15} 论道令</span>
          </button>
        ))}
        <button onClick={() => game.buyLabShop('essence')}
          className="flex w-full items-center justify-between rounded border border-dq-border px-2 py-1 text-xs hover:border-dq-gold">
          <span>🩸 武魂精血 ×20</span>
          <span className="text-dq-gold">10 论道令</span>
        </button>
      </div>
    </div>
  )
}
