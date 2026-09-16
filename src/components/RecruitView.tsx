import { useState } from 'react'
import { useGame, game, charLabel, rarityInfo, baseCombatEffectOf, BASE_CRIT_DMG, type CombatEffect } from '../game/engine'
import { portraitFor } from '../game/portraits'
import {
  CHARACTERS, RARITY_INFO, SHARD_COST, ROLE_LABEL, ROLE_TARGET_HINT,
  DUTY_OF_ROLE, DUTY_LABEL, DUTY_COLOR, FACTIONS, FACTION_OF,
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
 * 武魂详情浮层：结缘页上任意一张角色卡（兑换区 / 结拜结果 / 武魂名录）点开都能看立绘与人设。
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
  const cost = SHARD_COST[c.rarity]
  const afford = shards >= cost
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
          <div className="mt-1 text-xs text-dq-fire/80">⚔ {ROLE_TARGET_HINT[c.role]}</div>
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
  const [results, setResults] = useState<{ id: string; isNew: boolean; rarity: Rarity; pity: boolean; shard: number; essence: number }[]>([])
  const [pick, setPick] = useState<CharacterDef | null>(null)
  // 详情浮层：兑换区 / 结拜结果 / 武魂名录三处的卡片共用一个详情，
  // 所以存的是角色本身而不是"哪张卡" —— 同一角色从哪点进来看到的都必须一样
  const [detail, setDetail] = useState<CharacterDef | null>(null)
  const [toast, setToast] = useState('')
  const pity = game.pityState()

  const shards = state.inventory.shard ?? 0
  // 只列未拥有的：已拥有的会被引擎拒掉，摆出来只是让玩家点一个必然失败的按钮。
  const unowned = CHARACTERS.filter(c => !state.roster[c.id]).sort(byRarityDesc)
  // 图鉴（`...` 复制一份再排，CHARACTERS 是 import 的常量数组，原地 sort 会污染所有用它的地方）
  const catalog = [...CHARACTERS].sort(byRarityDesc)

  const pull = (times: 1 | 10) => {
    const r = game.recruit(times)
    if (r.length > 0) setResults(r)
  }

  function doRedeem() {
    if (!pick) return
    const r = game.redeemShard(pick.id)
    setToast(r.ok ? `✨ 碎片凝聚成形，获得「${pick.name}」` : ` ${r.why ?? '兑换失败'}`)
    setPick(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        <div className="mb-1 text-dq-gold">结拜天下豪杰</div>
        <div className="mb-3 text-sm text-[#a89478]">消耗缘分丹招募武魂</div>
        <div className="mb-3 space-y-2 text-left">
          <PityBar label="天阶保底" cur={pity.tian.cur} max={pity.tian.max} color={RARITY_INFO.tian.color} />
          <PityBar label="准圣保底" cur={pity.quasi.cur} max={pity.quasi.max} color={RARITY_INFO.quasi.color} />
          <PityBar label="圣阶保底" cur={pity.sheng.cur} max={pity.sheng.max} color={RARITY_INFO.sheng.color} />
        </div>
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

        <div className="mt-3 border-t border-dq-border pt-3 text-left">
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
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                {unowned.map(c => {
                  const rarity = rarityInfo(c.rarity)
                  const cost = SHARD_COST[c.rarity]
                  const afford = shards >= cost
                  const portrait = portraitFor(c.id)
                  return (
                    <button key={c.id} onClick={() => setDetail(c)}
                      className={`overflow-hidden rounded border text-center text-[10px] hover:border-dq-gold ${afford ? '' : 'opacity-40'}`}
                      style={{ borderColor: rarity.color }}>
                      <div className="aspect-square">
                        {portrait && <img src={portrait} alt={c.name} className="h-full w-full object-cover" />}
                      </div>
                      <div className="truncate px-0.5" style={{ color: rarity.color }}>{c.name.slice(0, 4)}</div>
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
      </div>

      {results.length > 0 && (
        <div className="dq-panel grid w-full max-w-xl grid-cols-5 gap-2 rounded-md p-4">
          {results.map((r, i) => {
            const cdef = charLabel(r.id)!
            const rarity = rarityInfo(r.rarity)
            const portrait = portraitFor(r.id)
            return (
              <button key={i} onClick={() => setDetail(cdef)}
                className="overflow-hidden rounded border text-center text-xs hover:border-dq-gold" style={{ borderColor: rarity.color }}>
                <div className="relative aspect-square">
                  {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                  {r.isNew
                    ? <span className="absolute right-0 top-0 rounded-bl bg-green-600 px-1 text-[9px] text-white">新</span>
                    : <span className="absolute right-0 top-0 rounded-bl bg-black/70 px-1 text-[9px] text-dq-gold">
                        {r.shard > 0 ? `✨+${r.shard}` : `精血+${r.essence}`}
                      </span>}
                  {r.pity && <span className="absolute left-0 top-0 rounded-br bg-dq-gold px-1 text-[9px] text-black">保底</span>}
                </div>
                <div className="truncate px-0.5" style={{ color: rarity.color }}>{cdef.name.slice(0, 4)}</div>
                <div className="pb-1 text-[#a89478]">
                  {r.isNew ? rarity.label : r.shard > 0 ? '重复·转碎片' : '重复·返精血'}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-dq-gold">武魂名录（{Object.keys(state.roster).length} / {CHARACTERS.length} 已收录）</span>
          <span className="text-[11px] text-[#a89478]">点击查看详情</span>
        </div>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {catalog.map(c => {
            const owned = !!state.roster[c.id]
            const rarity = rarityInfo(c.rarity)
            const portrait = portraitFor(c.id)
            return (
              <button key={c.id} onClick={() => setDetail(c)} data-char-id={c.id}
                className="overflow-hidden rounded border text-center text-[10px] hover:border-dq-gold"
                style={{ borderColor: owned ? rarity.color : '#3a2a1a', opacity: owned ? 1 : 0.35 }}>
                <div className="aspect-square">
                  {portrait && <img src={portrait} alt={c.name} className="h-full w-full object-cover" style={{ filter: owned ? 'none' : 'grayscale(1)' }} />}
                </div>
                <div className="truncate px-0.5" style={{ color: owned ? rarity.color : '#a89478' }}>{c.name.slice(0, 4)}</div>
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
              <div>消耗 角色碎片 ×<span className="text-[#e8dcc8]">{SHARD_COST[pick.rarity]}</span></div>
              <div>获得 <span style={{ color: rarityInfo(pick.rarity).color }}>{rarityInfo(pick.rarity).label}「{pick.name}」</span></div>
              <div className="text-[11px] text-[#a89478]">兑换后剩余 ✨×{shards - SHARD_COST[pick.rarity]}</div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={doRedeem} className="flex-1 rounded bg-dq-fire py-1 text-black">确认兑换</button>
              <button onClick={() => setPick(null)} className="flex-1 rounded border border-dq-border py-1 hover:border-dq-gold">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}