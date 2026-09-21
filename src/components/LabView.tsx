import { useState, useMemo } from 'react'
import { Swords, Sparkles } from 'lucide-react'
import { useGame, game, charLabel, charStats, rarityInfo, itemLabel, LAB_OFFER_TIMEOUT, type GameState } from '../game/engine'
import { portraitFor } from '../game/portraits'
import { monsterSpriteFor } from '../game/monsters'
import { sceneFor } from '../game/scenes'
import { blessingIconFor } from '../game/blessings'
import { itemSprite } from '../game/icons'
import Ico from './Ico'
import { impactFxForMonster, healFx } from '../game/fx'
import { useCombatSound } from '../game/sound'
import { LAB_BLESSINGS, isLabBoss, towerMonsterName, towerMonsterSpriteId, DUTY_OF_ROLE, enemyUnitsForFloor, PILLS, labPillCost, LAB_ESSENCE_COST, LAB_ESSENCE_AMOUNT, LAB_HERB_COST, LAB_HERB_AMOUNT, type BlessingCategory } from '../game/data'
import { EnemySquad, EnemyTotalBar } from './EnemySquad'
import { active, atImpact, DASH_MS, HIT_MS, IMPACT_MS, KILL_MS, DebuffBadge, FloatingNumbers, ImpactFx } from './combatFx'

const CATEGORY_COLOR: Record<BlessingCategory, string> = {
  offense: '#ff6a6a',
  defense: '#6ab4ff',
  economy: '#e8b04a',
}

function LabFighterCard({ id, state, now }: { id: string | null; state: GameState; now: number }) {
  if (!id) return <div className="aspect-square w-12 shrink-0 rounded border border-dashed border-dq-border sm:w-16" />
  const cdef = charLabel(id)!
  const entry = state.roster[id]
  const portrait = portraitFor(id)
  const fireId = game.fireIdOf(id) // 见 engine.fireIdOf：异火生效规则只留一份
  const bt = game.blessingTotals()
  const maxHp = Math.max(1, Math.round(charStats(entry, cdef, fireId).hp * (1 + bt.hpPct / 100)))
  const hp = state.lab.battle?.fighterHp[id] ?? maxHp
  const alive = hp > 0
  const mine = state.combatEvents.filter(e => e.source === 'lab' && e.who === id)
  // 受击特效按打我那个敌人的招式上色（v1.28：塔里每一层的敌人都可能不止一个）
  const hitEvent = mine.find(e => e.type === 'monsterDmg' && active(atImpact(e), now, HIT_MS))
  const isHealed = mine.some(e => e.type === 'heal' && active(atImpact(e), now, IMPACT_MS))
  const isAttacking = mine.some(e => (e.type === 'dmg' || (e.type === 'heal' && DUTY_OF_ROLE[cdef.role] === 'healer')) && active(e, now, DASH_MS))
  const events = mine.filter(e => e.type === 'monsterDmg' || e.type === 'heal').map(atImpact)
  const debuffed = !!state.lab.battle?.fighterDebuff?.[id]
  return (
    <div className={`relative w-12 shrink-0 overflow-visible rounded border text-center text-[9px] sm:w-16 sm:text-[10px] ${alive ? 'border-dq-border' : 'border-red-900'} ${hitEvent ? 'dq-hit-shake-left' : ''} ${isAttacking ? 'dq-attack-dash' : ''}`}>
      <div className={`aspect-square overflow-hidden rounded-t ${!alive ? 'dq-death-fade' : ''}`}>
        {portrait && <img src={portrait} alt={cdef.name} className={`h-full w-full object-cover ${alive && !isAttacking ? 'dq-idle-bob' : ''}`} />}
      </div>
      {hitEvent && <ImpactFx src={impactFxForMonster(hitEvent.atkStyle ?? 'melee')} />}
      {isHealed && <ImpactFx src={healFx()} />}
      {debuffed && <DebuffBadge className="-right-1 -top-1" />}
      {/* 名字：原来 `slice(0, 3)` 硬截（同 RosterView）——已有 `truncate`，交给格子宽度 */}
      <div className="truncate px-0.5" style={{ color: rarityInfo(cdef.rarity).color }}>{cdef.name}</div>
      <div className="mx-1 mb-1 h-1 rounded bg-black/40">
        <div className="h-1 rounded bg-green-600 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
      </div>
      <FloatingNumbers events={events} refMax={maxHp} now={now} />
    </div>
  )
}

export default function LabView() {
  const state = useGame()
  const lab = state.lab
  const floor = lab.battle?.floor ?? lab.highestFloor + 1
  const boss = isLabBoss(floor)
  const monsterName = towerMonsterName(floor)
  const monsterSprite = monsterSpriteFor(towerMonsterSpriteId(floor))
  const scene = sceneFor('tower')
  const now = Date.now()
  // 与主线同一套：塔里也画"这一层站了谁"，没进战斗时同样看得见
  const previewEnemies = useMemo(() => enemyUnitsForFloor(floor), [floor])
  const enemies = lab.battle?.enemies ?? previewEnemies
  const enemyName = (uid?: string) => enemies.find(e => e.uid === uid)?.name ?? '敌人'

  const labEvents = state.combatEvents.filter(e => e.source === 'lab')
  useCombatSound(labEvents)
  // 挨打/出手的演出交给 EnemyCard 按 uid 判定，这里只保留屏幕级的击败闪动
  const monsterKilled = labEvents.some(e => e.type === 'kill' && active(atImpact(e), now, KILL_MS))
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
            <div className="mb-2 flex items-center justify-center gap-2 text-center text-sm text-dq-fire"><Sparkles size={14} /><span>三选一祝福</span><Sparkles size={14} />
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
                      <Sparkles size={20} className="mx-auto" />
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
              {state.team.back.map((id, i) => <LabFighterCard key={`b${i}`} id={lab.battle ? id : null} state={state} now={now} />)}
            </div>
            <div className="flex flex-col justify-center gap-1 sm:gap-1.5">
              {state.team.front.map((id, i) => <LabFighterCard key={`f${i}`} id={lab.battle ? id : null} state={state} now={now} />)}
            </div>
          </div>

          <div className="shrink-0 px-1 text-dq-fire sm:px-2"><Swords size={22} className="sm:hidden" /><Swords size={30} className="hidden sm:block" /></div>

          <div className="flex shrink-0 flex-col items-center gap-2">
            <EnemySquad enemies={enemies} now={now} events={labEvents} sprite={monsterSprite} small />
            {lab.battle && <div className="w-36 sm:w-48"><EnemyTotalBar enemies={enemies} /></div>}
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded border border-dq-border bg-black/40 p-2 text-xs">
          {labEvents.filter(e => e.time <= now).slice(-10).reverse().map((e, i) => (
            <div key={i} className="text-[#a89478]">
              {e.type === 'dmg' && `${charLabel(e.who!)?.name ?? ''} 对 ${enemyName(e.target)} 造成 ${e.value} 伤害`}
              {e.type === 'heal' && `${charLabel(e.who!)?.name ?? ''} 回复 ${e.value} 气血`}
              {e.type === 'monsterDmg' && `${enemyName(e.from)} 对 ${charLabel(e.who!)?.name ?? ''} 造成 ${e.value} 伤害`}
              {e.type === 'down' && `${charLabel(e.who!)?.name ?? ''} 倒下了`}
              {e.type === 'kill' && `突破 ${e.who}！`}
              {/* 同一类 drop 事件有两种说法：论道令 / 缘分丹是**首通限定**（`first`），
                  每层的灵药是**常驻掉落**。写成一样的话，玩家每层都会看到"首通奖励 灵药"
                  —— 而他没有首通。判据是引擎给的 `first`，不在这里猜 item 名字。 */}
              {e.type === 'drop' && `${e.first ? '首通奖励' : '获得'} ${itemLabel(e.item!).name} ×${e.value}`}
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
      <div className="mb-1 text-sm text-dq-gold">论道令商店（{daoling}）</div>
      {/* 说清这个资源为什么稀缺：论道令只在天梯塔首通新层时发放，刷不到 ——
          不写这句，玩家会以为"多爬几天就能买光"，定价（8 品 1024 令）看着像乱标 */}
      <div className="mb-2 text-[10px] text-[#a89478]">
        论道令来自天梯塔首通奖励，重复通关不再产出。这里是拿它换丹药 / 养成材料的救急通道。
      </div>
      <div className="space-y-1">
        {/* 遍历 PILLS 全 8 品（v1.35 前只挂 1/3/5 品，卡在 6/7/8 品突破点的人买不到东西）。
            价格一律读 labPillCost —— 界面上显示的和引擎扣的是同一个数，不可能漂。 */}
        {PILLS.map(pill => {
          const cost = labPillCost(pill.grade)
          const owned = state.inventory[pill.id] ?? 0
          const afford = daoling >= cost
          return (
            <button key={pill.id} onClick={() => game.buyLabShop('pill', pill.grade)}
              data-shop-item={`pill-${pill.grade}`}
              className={`dq-tap flex w-full items-center justify-between rounded border border-dq-border px-2 py-1 text-xs ${afford ? 'hover:border-dq-gold' : 'opacity-50'}`}>
              <span className="flex items-center gap-1.5">
                <Ico name={itemSprite(pill.id)} emoji={pill.icon} className="h-5 w-5" />
                <span>{pill.name} ×1</span>
                {owned > 0 && <span className="ml-1 text-[10px] text-[#a89478]">持有 {owned}</span>}
              </span>
              <span className="text-dq-gold">{cost} 论道令</span>
            </button>
          )
        })}
        <button onClick={() => game.buyLabShop('essence')}
          data-shop-item="essence"
          className={`dq-tap flex w-full items-center justify-between rounded border border-dq-border px-2 py-1 text-xs ${daoling >= LAB_ESSENCE_COST ? 'hover:border-dq-gold' : 'opacity-50'}`}>
          <span className="flex items-center gap-1.5">
            <Ico name={itemSprite('essence')} className="h-5 w-5" />
            <span>武魂精血 ×{LAB_ESSENCE_AMOUNT}</span>
          </span>
          <span className="text-dq-gold">{LAB_ESSENCE_COST} 论道令</span>
        </button>
        {/* 灵药（2026-09-17 用户定「论道商店允许购买灵药」）。价格读 LAB_HERB_COST ——
            **不能再便宜**：1 令换超过 ≈7.5 灵药，「买灵药→炼丹」就会比直接买丹药划算，
            丹药那 8 档就没人点了。推导写在 data.ts 的 LAB_HERB_COST 上。 */}
        <button onClick={() => game.buyLabShop('herb')}
          data-shop-item="herb"
          className={`dq-tap flex w-full items-center justify-between rounded border border-dq-border px-2 py-1 text-xs ${daoling >= LAB_HERB_COST ? 'hover:border-dq-gold' : 'opacity-50'}`}>
          <span className="flex items-center gap-1.5">
            <Ico name={itemSprite('herb')} className="h-5 w-5" />
            <span>灵药 ×{LAB_HERB_AMOUNT}</span>
          </span>
          <span className="text-dq-gold">{LAB_HERB_COST} 论道令</span>
        </button>
      </div>
    </div>
  )
}
