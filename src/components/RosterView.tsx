import { useState, useEffect } from 'react'
import { Swords } from 'lucide-react'
import { useGame, game, charLabel, rarityInfo, itemLabel, onboardCurrent, combatPower, fmtNum, TEAM_FRONT_SIZE, TEAM_BACK_SIZE, type TeamSlotPos, type CombatEffect } from '../game/engine'
import { itemSprite } from '../game/icons'
import Ico from './Ico'
import { portraitFor } from '../game/portraits'
import { xpToNext, realmLabel, needsPillFor, pillGradeFor, FIRES, MAX_STARS, STARS_PER_TIER, STAR_TIERS, STAR_TIER_JUMP, starUpCost, starTierOf, starTierIndex, RELEASE_REFUND, ROLE_LABEL, ROLE_TARGET_HINT, DUTY_OF_ROLE, DUTY_LABEL, DUTY_COLOR, FACTIONS, FACTION_OF, bondBonusesFor } from '../game/data'

type AssignTarget = { row: 'front' | 'back'; index: number } | null

/**
 * 职业效果的措辞（数值本身来自引擎 `game.combatEffectOf`，这里只决定怎么说）。
 * ⚠️ 群攻那条的"未计敌方防御"不是客套话：伤害结算是 `攻击×0.55 − 目标防御×0.6` 再乘 ±15% 浮动，
 * 面板给的是基数。不写清楚就会变成下一个"面板和实战对不上"的投诉（v1.29 的教训）。
 */
function effectView(e: CombatEffect): { label: string; value: string; hint?: string } {
  switch (e.kind) {
    case 'heal': return { label: '每次回复', value: String(e.value), hint: '单体 · 治血线最低的队友' }
    case 'heal_aoe': return { label: '每次回复', value: String(e.value), hint: '群体 · 每人（≈单奶一半）' }
    case 'aoe': return { label: '群攻每目标', value: String(e.value), hint: '伤害基数，未计敌方防御' }
    case 'control': return {
      label: '压制',
      value: `攻 -${e.atkPct}% / 防 -${e.defPct}%`,
      hint: `命中后 ${e.rounds} 回合`,
    }
  }
}

/** 百分比展示：整数就不拖小数点（12% / 12.5%），暴击率可带装备词条的小数 */
function trimPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * 星级字形：只画**当前品质档内的 10 颗**（v1.28.9 起上限 50★，再按总星数画就是 50 个字形）。
 * 整十星显示该档 10 颗全满（如 10★ = 铜档圆满、同时已晋入银星），clamp 到 [0, STARS_PER_TIER]
 * 杜绝 repeat(负数) 崩溃。**颜色由 starTierOf 给** —— 这是玩家要的"星级的颜色"。
 */
function starInTier(stars: number): number {
  const s = Math.max(0, Math.min(MAX_STARS, Math.floor(stars) || 0))
  if (s === 0) return 0
  const r = s % STARS_PER_TIER
  return r === 0 ? STARS_PER_TIER : r
}

function starGlyphs(stars: number): string {
  const inTier = starInTier(stars)
  return '★'.repeat(inTier) + '☆'.repeat(STARS_PER_TIER - inTier)
}

export default function RosterView({ focusId, onFocusConsumed }: {
  /** 带意图跳转（新手之路第二步）：落地直接选中这名角色 */
  focusId?: string | null
  onFocusConsumed?: () => void
} = {}) {
  const state = useGame()
  const [selected, setSelected] = useState<string | null>(null)

  /**
   * 新手之路第二步跳过来时，右栏默认是一张**空详情面板**（selected 初始为 null）——
   * 引导说的"去打坐修炼"那个滑条根本不在屏幕上，等于指了个不存在的东西。
   * 所以带 focusId 进来时直接选中它；消费掉之后通知外层清空，免得玩家下次自己
   * 切到阵容页又被强行选中一次。
   */
  useEffect(() => {
    if (focusId && state.roster[focusId]) {
      setSelected(focusId)
      onFocusConsumed?.()
    }
  }, [focusId])
  const [assignTarget, setAssignTarget] = useState<AssignTarget>(null)
  // 拖拽状态：从名录拖（from = null）还是从某个阵位拖（from = 那个坐标）
  const [dragging, setDragging] = useState<{ id: string; from: TeamSlotPos | null } | null>(null)
  const [dragOver, setDragOver] = useState<TeamSlotPos | null>(null)
  // 名录按品阶从高到低（圣 → 黄），与结缘页同一套顺序。
  // 原先直接 Object.keys(state.roster) 拿到的是**抽到的先后**，同一份"武魂名录"在两个页面会是两种排法。
  const ownedIds = Object.keys(state.roster)
    .sort((a, b) => {
      const ca = charLabel(a), cb = charLabel(b)
      if (!ca || !cb) return 0
      return rarityInfo(cb.rarity).order - rarityInfo(ca.rarity).order
    })
  const inTeam = new Set([...state.team.front, ...state.team.back].filter(Boolean) as string[])
  const emptySlots = [...state.team.front, ...state.team.back].filter(x => !x).length

  /** 把 id 放到某个阵位；目标位原来有人则被顶下来（setSlot 的语义，一次 emit） */
  const place = (pos: TeamSlotPos, id: string) => {
    game.setSlot(pos.row, pos.index, id)
    setSelected(id)
    setAssignTarget(null)
  }

  /**
   * 点阵位。三条规则互不重叠：
   *   空位 + 手里已选中某人 → **直接编入**。
   *     这是玩家最自然的顺序（先点人、再点位置）。旧版在这里毫无反应，只能往下滚到详情面板
   *     再点一次「前排1」—— 玩家反馈的「要点上面、点了点下面才能加入成功」就是这个。
   *   空位 + 手里没人 → 进入"点武魂"模式。
   *   有人的格子 → 看他的详情 + 进入"点武魂替换他"模式。
   * ⚠️ "有人"的格子**不**吃手里那个选中角色：否则玩家选着 A 去点 B 想看看 B 的属性，
   * 一按就把 B 顶掉了。换人有两条明确的路（拖拽 / 先点该位再点名录），不必把"查看"也变成"写入"。
   */
  const clickSlot = (pos: TeamSlotPos, occupant: string | null) => {
    if (!occupant && selected) { place(pos, selected); return }
    setAssignTarget(pos)
    if (occupant) setSelected(occupant)
  }

  const pickChar = (id: string) => {
    if (assignTarget) { place(assignTarget, id); return }
    setSelected(id)
  }

  /** 松手落位：阵位阵位 = 换位；名录→阵位 = 编入（目标有人则替换） */
  const dropOnSlot = (pos: TeamSlotPos) => {
    const d = dragging
    setDragging(null)
    setDragOver(null)
    if (!d) return
    if (d.from) game.swapSlots(d.from, pos)
    else place(pos, d.id)
  }

  const endDrag = () => { setDragging(null); setDragOver(null) }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 sm:flex-row sm:p-4">
      <div className="shrink-0 space-y-3 sm:w-64">
        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-dq-gold">前排</span>
            {emptySlots > 0 && ownedIds.length > inTeam.size && (
              <button onClick={() => game.fillEmptySlots()}
                className="rounded border border-dq-border px-1.5 py-0.5 text-[10px] text-[#d8c6a8] hover:border-dq-gold">
                一键补满空位
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {state.team.front.map((id, i) => (
              <Slot key={i} charId={id} posId={'front-' + i}
                active={assignTarget?.row === 'front' && assignTarget.index === i}
                canDrop={!!selected && !id}
                over={dragOver?.row === 'front' && dragOver.index === i}
                onClick={() => clickSlot({ row: 'front', index: i }, id)}
                onClear={() => game.setSlot('front', i, null)}
                onDragStart={() => id && setDragging({ id, from: { row: 'front', index: i } })}
                onDragOver={() => setDragOver({ row: 'front', index: i })}
                onDrop={() => dropOnSlot({ row: 'front', index: i })}
                onDragEnd={endDrag} />
            ))}
          </div>
          <div className="mb-2 mt-3 text-sm text-dq-gold">后排</div>
          <div className="flex gap-2">
            {state.team.back.map((id, i) => (
              <Slot key={i} charId={id} posId={'back-' + i}
                active={assignTarget?.row === 'back' && assignTarget.index === i}
                canDrop={!!selected && !id}
                over={dragOver?.row === 'back' && dragOver.index === i}
                onClick={() => clickSlot({ row: 'back', index: i }, id)}
                onClear={() => game.setSlot('back', i, null)}
                onDragStart={() => id && setDragging({ id, from: { row: 'back', index: i } })}
                onDragOver={() => setDragOver({ row: 'back', index: i })}
                onDrop={() => dropOnSlot({ row: 'back', index: i })}
                onDragEnd={endDrag} />
            ))}
          </div>
          {/* 提示条：把"下一步该点什么"写在阵位正下方，玩家不用去翻详情面板 */}
          {assignTarget ? (
            <div className="mt-2 rounded border border-dq-gold/60 bg-dq-gold/10 px-2 py-1 text-[11px] leading-relaxed text-dq-gold">
              {(() => {
                const occ = state.team[assignTarget.row][assignTarget.index]
                return occ
                  ? <>点下方武魂即可<b>替换</b> {charLabel(occ)?.name ?? occ}</>
                  : <>点下方武魂即可编入 {assignTarget.row === 'front' ? '前排' : '后排'}{assignTarget.index + 1}</>
              })()}
              <button onClick={() => setAssignTarget(null)} className="ml-2 text-[#a89478] underline">取消</button>
            </div>
          ) : selected ? (
            <div className="mt-2 text-[11px] leading-relaxed text-dq-gold">
              已选 <span className="text-dq-fire">{charLabel(selected)?.name ?? selected}</span>：
              点一个空位编入，或直接拖到位置上（阵位之间拖动 = 换位）
            </div>
          ) : null}
        </div>

        <div className="dq-panel rounded-md p-3">
          <div className="mb-2 text-sm text-dq-gold">武魂名录</div>
          <div className="grid grid-cols-4 gap-2">
            {ownedIds.map(id => {
              const cdef = charLabel(id)!
              const rarity = rarityInfo(cdef.rarity)
              const portrait = portraitFor(id)
              // data-char-id：名录在 v1.28.1 改成按品阶排序后，"第 N 个按钮"就不再等于
              // Object.keys(roster)[N] 了 —— 自动化测试按位置点会点到别的角色上，
              // 表现为"面板显示的不是这个人的属性"，看着像引擎算错。带上 id 让测试按 id 定位。
              return (
                <button key={id} onClick={() => pickChar(id)} data-char-id={id}
                  draggable
                  onDragStart={() => setDragging({ id, from: null })}
                  onDragEnd={endDrag}
                  title={inTeam.has(id) ? '上阵中（拖动可换位）' : '点一下选中，再点空位编入；也可以直接拖到位置上'}
                  className="relative aspect-square cursor-grab overflow-hidden rounded border active:cursor-grabbing"
                  style={{
                    borderColor: selected === id ? rarity.color : '#3a2a1a',
                    // 选中的卡加一圈光晕：它是"点空位就会放上去的那个人"，必须一眼看出来
                    boxShadow: selected === id ? `0 0 0 2px ${rarity.color}66` : undefined,
                    opacity: dragging?.id === id ? 0.4 : 1,
                  }}>
                  {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                  {/* 职责色点：名录里一眼看出谁扛、谁奶、谁是输出 */}
                  <span className="absolute left-0.5 top-0.5 h-2 w-2 rounded-full border border-black/60"
                    style={{ background: DUTY_COLOR[DUTY_OF_ROLE[cdef.role]] }} />
                  {/* 上阵标记：名录里要能看出谁已经在阵上，否则玩家会重复往阵里塞人 */}
                  {inTeam.has(id) && (
                    <span className="absolute right-0 top-0 rounded-bl bg-dq-gold px-1 text-[9px] leading-tight text-black">阵</span>
                  )}
                  {/* 角色名。⚠️ 原来是 `text-[9px]` + `slice(0, 4)`，用户 2026-09-21 的原话是
                      「特别是角色名字太小了」—— 手机上这行只有指甲盖宽，而且**硬截 4 个字**，
                      「云岚宗杂役」这种 5 字名第 5 个字直接没了（不是省略号，是被切掉）。
                      9px 已由 index.css 的手机端字号阶梯统一抬到 12px；
                      这里把硬截换成 `truncate`：放得下几个显示几个，放不下给省略号，
                      比"永远只显示前 4 个字"诚实。 */}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[9px] leading-tight"
                    style={{ color: rarity.color }}>
                    {cdef.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <BondPanel />

        <FirePanel />
      </div>

      <div className="dq-panel min-w-0 flex-1 rounded-md p-4">
        {selected ? <CharDetail key={selected} id={selected} onAssign={(row, idx) => game.setSlot(row, idx, selected)} onSold={() => setSelected(null)} /> : <TeamOverview onPick={setSelected} />}
      </div>
    </div>
  )
}

/**
 * 阵容总览（v1.44）—— 占的是**右栏没选人时**那一整块。
 *
 * 这里原先只有一行居中的灰字「点击左侧武魂查看详情…」，在桌面端那是一块
 * **占了屏幕三分之二的死空间**：玩家一进阵容页，看到的是半屏空白，
 * 而这一页恰恰是全站信息密度最高的一页（羁绊、异火、名录、阵位全在这）。
 *
 * 放什么进来有一条硬约束：**只能是已经为真的东西**，不许造数。
 * 于是取三样都能从 state 直接读出来的：
 *   · 队伍战力 —— 走 `combatPower`，与排行榜上传的是**同一个函数**
 *     （界面自己再算一遍就迟早会和榜单对不上，那类投诉已经有过）
 *   · 上阵人数与空位 —— 直接数阵位
 *   · 操作指引 —— 把左栏那三句散落的提示收在一处，新玩家第一次进来会看到
 * 不在这里放"推荐上阵"之类的建议：那需要一套引擎侧的评价口径，不是本次改版的事。
 */
function TeamOverview({ onPick }: { onPick: (id: string) => void }) {
  const state = useGame()
  const slots = [...state.team.front, ...state.team.back]
  const filled = slots.filter(Boolean).length
  const empty = slots.length - filled
  const power = combatPower(state)
  const bonds = bondBonusesFor(slots)
  const owned = Object.keys(state.roster).length
  const activeBonds = bonds.active.filter(b => b.tier).length

  // 阵位 → (行, 序号)：给每个上阵成员标出"他站哪"，与左栏六个格子一一对得上
  const seatOf = (i: number) => i < TEAM_FRONT_SIZE
    ? `前${i + 1}`
    : `后${i - TEAM_FRONT_SIZE + 1}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <div className="text-dq-gold">阵容总览</div>
        <div className="text-[11px] text-[#a89478]">
          武魂 {owned} 名 · 上阵 <span className="tabular-nums text-[#e8dcc8]">{filled}</span>/{slots.length}
        </div>
      </div>

      {/* 战力条：数字走 combatPower（与排行榜上传的是同一个函数），
          旁边两个小块说清"阵位还剩几个、羁绊凑出来没有"——
          这三样是玩家在阵容页唯一需要一眼确认的状态。 */}
      <div className="mt-3 flex items-stretch gap-2">
        <div className="dq-slot flex flex-1 items-center justify-between rounded px-3 py-2">
          <span className="text-[11px] text-[#a89478]">队伍战力</span>
          <span className="text-2xl leading-none tabular-nums text-dq-gold" data-stat="team-power">{fmtNum(power)}</span>
        </div>
        <div className="dq-slot flex min-w-[6.5rem] flex-col justify-center rounded px-2.5 py-2 text-[11px]">
          <div className="text-[#a89478]">阵位</div>
          <div className={empty > 0 ? 'text-dq-fire' : 'text-dq-qing'}>
            {empty > 0 ? `空 ${empty} 个` : '已满 6 人'}
          </div>
        </div>
        <div className="dq-slot flex min-w-[6.5rem] flex-col justify-center rounded px-2.5 py-2 text-[11px]">
          <div className="text-[#a89478]">阵营羁绊</div>
          <div className={activeBonds > 0 ? 'text-dq-fire' : 'text-[#5a4a38]'}>
            {activeBonds > 0 ? `已激活 ${activeBonds} 条` : '尚未激活'}
          </div>
        </div>
      </div>

      {/* 上阵成员：把"这六个人到底是谁、谁在扛"列出来。
          左栏虽然画着头像，但那里只有图没有数 —— 而"我该练谁"靠的正是下一行这个战力。 */}
      <div className="mt-3">
        <div className="mb-1.5 text-xs text-dq-gold">上阵成员</div>
        <div className="space-y-1">
          {slots.map((id, i) => {
            const seat = seatOf(i)
            if (!id) {
              return (
                <div key={i} className="dq-slot flex items-center gap-2 rounded px-2 py-1 text-[11px] text-[#5a4a38]" data-seat={seat}>
                  <span className="w-7 shrink-0">{seat}</span>
                  <span>空位 · 点左栏这个格子编入，或从名录拖一个人过来</span>
                </div>
              )
            }
            const cdef = charLabel(id)
            if (!cdef) {
              // 名录里认不出的 id（存档里留了个已下架角色的残留）：如实说明，不静默画个空格
              return (
                <div key={i} className="dq-slot flex items-center gap-2 rounded px-2 py-1 text-[11px] text-dq-fire" data-seat={seat}>
                  <span className="w-7 shrink-0">{seat}</span>
                  <span>该武魂已不在名录中（{id}）</span>
                </div>
              )
            }
            const rarity = rarityInfo(cdef.rarity)
            const portrait = portraitFor(id)
            const duty = DUTY_OF_ROLE[cdef.role]
            return (
              <button key={i} onClick={() => onPick?.(id)} data-seat={seat} data-team-char={id}
                className="flex w-full items-center gap-2 rounded border border-dq-border px-2 py-1 text-left text-[11px] hover:border-dq-gold">
                <span className="w-7 shrink-0 text-[#a89478]">{seat}</span>
                <span className="h-6 w-6 shrink-0 overflow-hidden rounded-sm border" style={{ borderColor: rarity.color }}>
                  {portrait && <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: rarity.color }}>{cdef.name}</span>
                <span className="shrink-0 rounded px-1 text-[9px] text-black" style={{ background: DUTY_COLOR[duty] }}>{DUTY_LABEL[duty]}</span>
                <span className="shrink-0 tabular-nums text-[#a89478]">战力 {fmtNum(game.powerOf(id))}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 text-[11px] leading-relaxed text-[#a89478]">
        <div className="mb-1.5 text-xs text-dq-gold">怎么排阵</div>
        <div className="space-y-1">
          <div>① 点左侧名录里的武魂 —— 右栏会显示他的详情，再点下方「前排N / 后排N」编入</div>
          <div>② 点一个<b className="text-[#e8dcc8]">空位</b>：手里已选中人就直接编入，没选中就进入「点武魂」模式</div>
          <div>③ 桌面端可以直接<b className="text-[#e8dcc8]">拖动</b>：名录拖进阵位 = 编入，阵位拖到阵位 = 换位</div>
        </div>
      </div>

      <div className="mt-auto pt-3 text-[10px] leading-relaxed text-[#5a4a38]">
        前排先挨打、后排后挨打；异火只认前排第一位。阵型摆好后去战斗页开自动出战。
      </div>
    </div>
  )
}

/**
 * 阵营羁绊面板：把"我现在凑出了什么、还差几个人"摊开讲清楚。
 *
 * 羁绊是布阵决策的一半，但它完全藏在数值里——不显示的话，玩家只能靠试，
 * 「凑同阵营」这个玩法就等于不存在。所以这里既报**已激活**的档位，
 * 也报**差几个人**能升到下一档：后者才是"我该不该再带一个云岚宗"的依据。
 */
function BondPanel() {
  // 自己订阅 state 而不是读一次快照：羁绊要随"换人/换位"实时变，
  // 依赖父组件顺手重渲染迟早会在组件被挪走后失效。算法与引擎共用同一个纯函数。
  const state = useGame()
  const bonds = bondBonusesFor([...state.team.front, ...state.team.back])
  if (bonds.active.length === 0) {
    return (
      <div className="dq-panel rounded-md p-3">
        <div className="mb-1 text-sm text-dq-gold">阵营羁绊</div>
        <div className="text-[11px] text-[#a89478]">上阵 2 名同阵营武魂即可激活羁绊</div>
      </div>
    )
  }
  const total = [
    bonds.atkPct > 0 ? `攻击 +${bonds.atkPct}%` : '',
    bonds.defPct > 0 ? `防御 +${bonds.defPct}%` : '',
    bonds.hpPct > 0 ? `气血 +${bonds.hpPct}%` : '',
    bonds.crit > 0 ? `暴击 +${bonds.crit}%` : '',
  ].filter(Boolean)
  return (
    <div className="dq-panel rounded-md p-3">
      <div className="mb-1 text-sm text-dq-gold">阵营羁绊</div>
      {/* 口径声明：玩家拿"详情页数字/战力没变"来验证羁绊是否生效，得先说清哪里的数字含它 */}
      <div className="mb-2 text-[11px] leading-relaxed text-[#a89478]">
        同阵营上阵人数达标，全队共享加成。加成计入<span className="text-dq-fire">战斗中</span>的攻防血，
        上阵角色的属性面板已含这一份；战力评分只算单个角色，不含羁绊。
      </div>
      <div className="space-y-1.5">
        {bonds.active.map(b => {
          const next = b.faction.tiers.find(t => t.count > b.count)
          return (
            <div key={b.faction.id} className="rounded border px-2 py-1"
              style={{ borderColor: b.tier ? b.faction.color : '#3a2a1a', opacity: b.tier ? 1 : 0.55 }}>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: b.faction.color }}>
                  {b.faction.name}
                </span>
                <span className="text-[#a89478]">
                  {b.count} 人{b.fromWild > 0 && bonds.wildcardFrom ? `（含 ${b.fromWild} 名${FACTIONS[bonds.wildcardFrom].name}）` : ''}
                  {b.tier ? ` · 已激活 ${b.tier.count} 人档` : ''}
                </span>
              </div>
              <div className="text-[11px] text-[#e8dcc8]">
                {b.tier ? b.tier.desc : `还差 ${(b.faction.tiers[0].count) - b.count} 人 → ${b.faction.tiers[0].desc}`}
              </div>
              {b.tier && next && (
                <div className="text-[10px] text-[#5a4a38]">再上 {next.count - b.count} 人 → {next.desc}</div>
              )}
            </div>
          )
        })}
      </div>
      {/* 癞子生效时把"补给了谁"说出口。玩家上阵凡人/燕云后看到的是一份凭空变大的档位，
          不解释就等于让他以为界面算错了（而这个机制在别处没有任何提示）。
          v1.63 起癞子有两个（凡人、燕云），所以**补位者的名字要从 wildcardFrom 取**，
          不能再写死"凡人" —— 这一句同时承担"两边不会叠加"的说明义务：
          玩家把燕云和凡人一起上阵时，会看到其中一个明明在场却没补位，不解释就是个 bug。 */}
      {bonds.wildcardHost && bonds.wildcardFrom && (
        <div data-wildcard-note className="mt-2 text-[11px] leading-relaxed"
          style={{ color: FACTIONS[bonds.wildcardFrom].color }}>
          {FACTIONS[bonds.wildcardFrom].name}：上阵的{FACTIONS[bonds.wildcardFrom].name}成员正替
          <span className="text-[#e8dcc8]">{FACTIONS[bonds.wildcardHost].name}</span>
          补人数（补给人最多的那个阵营），它自己那一档按实际人数算。
          {bonds.wildcardIdle && (
            <span className="text-[#a89478]">
              {' '}队的{FACTIONS[bonds.wildcardIdle].name}这次没有补位 —— 燕云与凡人同时在场时
              <span className="text-[#e8dcc8]">只有一个能补</span>
              ，由人数多的那一边来（人数相同则凡人优先）。
            </span>
          )}
        </div>
      )}
      {total.length > 0 && (
        <div className="mt-2 border-t border-dq-border pt-1.5 text-[11px] text-dq-fire">
          全队加成：{total.join(' · ')}
        </div>
      )}
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
              <Ico name={`icons/fire_${f.id}`} emoji={f.icon} className="h-6 w-6 shrink-0" />
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

/**
 * 一个阵位格子。三种来源的视觉反馈要能分开：
 *   canDrop —— 手里已选中一个武魂，这个空位就是"点一下就能放上去"的目标（金色虚线 + 「点此编入」）
 *   over    —— 正被拖拽悬停（实心高亮）
 *   active  —— 处于"点武魂"模式（等待从名录选一个人来）
 * 拖拽与点选**同时支持**：桌面用拖的，触屏用点（HTML5 拖拽在手机上本来就不可靠，不能让交互只有一条路）。
 */
function Slot({ charId, posId, active, canDrop, over, onClick, onClear, onDragStart, onDragOver, onDrop, onDragEnd }: {
  charId: string | null
  /** 形如 front-0：给自动化测试一个稳定锚点，免得测试去认「空位/点此编入」这类会变的文案 */
  posId: string
  active: boolean
  canDrop: boolean
  over: boolean
  onClick: () => void
  onClear: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const cdef = charId ? charLabel(charId) : null
  const portrait = charId ? portraitFor(charId) : null
  return (
    <div onClick={onClick}
      data-slot={posId}
      draggable={!!charId}
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDragLeave={() => { /* 悬停高亮由 onDragOver 覆盖，离开不必清 —— 清会把相邻格子的高亮闪掉 */ }}
      onDrop={e => { e.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
      className={`relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed text-[10px] leading-tight hover:border-dq-gold ${cdef ? 'active:cursor-grabbing' : ''}`}
      style={{
        borderColor: over ? '#fff2c4' : active ? '#e8b04a' : canDrop ? '#e8b04a99' : cdef ? rarityInfo(cdef.rarity).color : undefined,
        borderStyle: cdef || active ? 'solid' : 'dashed',
        boxShadow: over ? '0 0 0 2px #e8b04a' : undefined,
        background: canDrop ? '#e8b04a12' : undefined,
      }}>
      {cdef ? (
        <>
          {portrait ? (
            <img src={portrait} alt={cdef.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-center leading-tight" style={{ color: rarityInfo(cdef.rarity).color }}>{cdef.name.slice(0, 3)}</span>
          )}
          {/* 移出阵容。⚠️ 原来是 `-right-1 -top-1 h-4 w-4` —— 而槽位那层是
              `overflow-hidden rounded`（立绘要靠它裁圆角），这个按钮有 4px 伸到框外被**父级裁掉**：
              实测（temp/probe-mobile-pages.cjs，320px）它同时是页面上唯一被报"文字被裁"的元素，
              可点宽度只剩 12px 左右 —— 正是玩家说的"经常点不到"。
              改成完整落在框内、并放大到 20px：不再被裁，手指也够得着。
              代价是压住立绘右上角一小块，比"点不掉这个人"划算。 */}
          <button onClick={e => { e.stopPropagation(); onClear() }}
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[11px] leading-none text-white after:absolute after:-inset-2 after:content-['']">×</button>
        </>
      ) : <span className={canDrop ? 'text-dq-gold' : 'text-[#5a4a38]'}>{active ? '选择武魂' : canDrop ? '点此编入' : '空位'}</span>}
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
  // 引导第③件事（第一次修炼）指向的就是这个按钮：呼吸灯亮在这里。
  // ⚠️ 判据只有 `onboardCurrent` 一处（与 CombatView 同一条口径）。
  const nbTrain = onboardCurrent(state)?.key === 'train'
  const rarity = rarityInfo(cdef.rarity)
  // 职责（战斗/坦克/医师）与攻击方式（群攻/单体…）是两件正交的事，两个标签都要给：
  // 只标"坦克"玩家不知道它打得怎么样，只标"群攻"又不知道它该站哪
  const duty = DUTY_OF_ROLE[cdef.role]
  const faction = FACTION_OF[id] ? FACTIONS[FACTION_OF[id]] : null
  const portrait = portraitFor(id)
  const need = xpToNext(entry.level)
  const blockedByPill = entry.xp >= need && needsPillFor(entry.level)
  const pillGrade = pillGradeFor(entry.level)
  const inTeam = [...state.team.front, ...state.team.back].includes(id)
  // 当前所在阵位（没上阵则 curRow = null），给下方「编入阵容」按钮组标出"（当前）"
  const frontIdx = state.team.front.indexOf(id)
  const backIdx = state.team.back.indexOf(id)
  const curRow: 'front' | 'back' | null = frontIdx >= 0 ? 'front' : backIdx >= 0 ? 'back' : null
  const curIdx = frontIdx >= 0 ? frontIdx : backIdx
  // 返还明细一律走引擎（releaseRefundOf 也就是 releaseChar 实际结算用的那个方法），
  // 组件不自己算 —— 否则"界面承诺的"和"实际到账的"迟早会对不上
  const refund = game.releaseRefundOf(id)

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
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[#a89478]">
              <span className="rounded px-1.5 py-0.5 text-[10px] text-black" style={{ background: DUTY_COLOR[duty] }}>{DUTY_LABEL[duty]}</span>
              <span className="rounded border border-dq-border px-1.5 py-0.5 text-[10px]">{ROLE_LABEL[cdef.role]}</span>
              {faction && (
                <span className="rounded border px-1.5 py-0.5 text-[10px]"
                  style={{ color: faction.color, borderColor: faction.color }}>
                  {faction.name}
                </span>
              )}
              <span>{rarity.label}</span>
              {/* 推荐站位：**这条以前只有招募页有**，于是"想排个阵先去看这人该站哪"要跳到
                  招募页翻名录 —— 排阵容的地方反而不告诉你站哪，这属于把最该在这儿的
                  一条信息放错了页。文案与招募页逐字相同（同一件事在两页说法不一样更糟）。
                  ⚠️ 这是**角色自带的定位**（`CharacterDef.position`），不是"当前站在哪"
                  ——下半部分的编入阵容按钮才管当前站位。 */}
              <span data-stat="pos" className="rounded border border-dq-border px-1.5 py-0.5 text-[10px] text-[#a89478]">
                {cdef.position === 'front' ? '推荐前排' : '推荐后排'}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-[#5a4a38]">{cdef.desc}</div>
            {/* 打法说明：把引擎里的目标选择规则摆到明面上，玩家排阵前就知道"他会去打谁" */}
            <div className="mt-1 flex items-center gap-1 text-xs text-dq-fire/80">
            <Swords size={12} className="shrink-0" />
            <span>{ROLE_TARGET_HINT[cdef.role]}</span>
          </div>
          </div>
          <div className="text-right">
            <div className="text-dq-gold">{realmLabel(entry.level)}</div>
            {/* 星级按品质档上色：一眼能分出铜/银/金/赤/彩，而不是只靠数星星 */}
            <div className="text-sm" style={{ color: starTierOf(entry.stars).color }}>
              {starTierOf(entry.stars).name} {entry.stars}★
            </div>
            <div className="text-xs" style={{ color: starTierOf(entry.stars).color }}>
              {starGlyphs(entry.stars)}
            </div>
            {/* 单人战力：**这里以前只有队伍总战力**（`combatPower`，在队伍总览条上），
                单个武魂值多少要看就得去招募页翻名录。换人上阵时"这两个谁强"是当场要答的问题，
                所以摆在这一列（境界/星级旁边）——与招募页详情里那个「当前战力」是同一个
                `powerOf` 口径，取整规则也一致（`powerOf` 返回未取整值，直接渲染会出 35.1795）。 */}
            <div className="mt-0.5 text-xs text-[#a89478]">
              战力 <span data-stat="power" className="tabular-nums text-dq-gold"><span data-stat-value>{fmtNum(Math.round(game.powerOf(id)))}</span></span>
            </div>
          </div>
        </div>

        {/* 属性走**战斗口径** game.battleStatsOf（= charStats × 阵营羁绊 × 商城增益），不是裸属性 statsOf。
            两层坑叠在这一个数字上：
            ① 曾经界面自算 baseAtk + atkGrowth*level（漏星级/境界/异火/装备）⇒「升星没有属性提升」；
            ② v1.28 加了阵营羁绊却只改战斗口径 ⇒ 玩家凑齐 6 个云岚宗、详情里的攻击纹丝不动，
               报成「阵容组合加成没有实际生效」（其实同一角色伤害已经 335 → 417）。
            显示与战斗同源，"看不到的加成"这一类问题才断根。 */}
        {(() => {
          const st = game.battleStatsOf(id)
          if (!st) return null
          const bo = inTeam ? game.bondBonuses() : null
          const bondText = bo ? [
            bo.atkPct > 0 ? `攻击 +${bo.atkPct}%` : '',
            bo.defPct > 0 ? `防御 +${bo.defPct}%` : '',
            bo.hpPct > 0 ? `气血 +${bo.hpPct}%` : '',
            bo.crit > 0 ? `暴击 +${bo.crit}%` : '',
          ].filter(Boolean).join(' · ') : ''
          // 职业效果（治疗量 / 群攻每目标 / 压制）走引擎，界面只负责排版与措辞：
          // 系数（1.5 / 0.75 / 0.55）留在 fightRound 那一处，避免"展示乘一遍、结算乘一遍"
          const eff = game.combatEffectOf(id)
          const effView = eff ? effectView(eff) : null
          return (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <Stat name="atk" label="攻击" value={st.atk} />
                <Stat name="def" label="防御" value={st.def} />
                <Stat name="hp" label="气血" value={st.hp} />
              </div>
              {/* 暴击与职业效果：这两行的数一直算在战斗里，但过去从没露过面 ——
                  玩家评估一个医师/群攻/控制角色时，攻防血根本答不了"他到底能干什么" */}
              <div className={`mt-2 grid gap-3 text-sm ${effView ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <Stat name="critRate" label="暴击率" value={`${trimPct(st.critRate)}%`} hint={st.critRate <= 0 ? '只从装备词条来' : undefined} />
                <Stat name="critDmg" label="暴击伤害" value={`+${trimPct(st.critDmg)}%`} hint="暴击时伤害倍率" />
                {/* 锚点带上 kind：这格是按定位条件渲染的，测试要能断言"医师有治疗格、近战没有" */}
                {effView && <Stat name={`effect-${eff!.kind}`} label={effView.label} value={effView.value} hint={effView.hint} />}
              </div>
              {/* 羁绊面板报一个百分比，数字里到底含没含它，得有处对账 */}
              <div className="mt-1.5 text-[11px] leading-relaxed text-[#a89478]">
                {bondText
                  ? <>战斗属性 · 已含阵营羁绊 <span className="text-dq-fire">{bondText}</span></>
                  : inTeam
                    ? '战斗属性（当前阵容没凑出阵营羁绊加成）'
                    : '未上阵 · 基础属性，上阵且凑齐同阵营后另加羁绊加成'}
              </div>
            </>
          )
        })()}

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

        {/* ⚠️ `data-onb` 挂在**这一行**上，不是只挂在右边那颗按钮上 ——
            蒙层挖的洞要把滑条一起放进来。只挖按钮的话，玩家想把结晶拉多一点也不行，
            只能反复点同一个数（"一次修炼"教的是"打坐能提等级"，不是"点三次"）。 */}
        <div className="mt-3 flex items-center gap-2" data-onb="train">
          <input type="range" min={10} max={snapCrystal} step={10}
            value={Math.min(trainAmt, snapCrystal)}
            onChange={e => setTrainAmt(Number(e.target.value))}
            className="flex-1" />
          <span className="w-20 text-right text-sm">{Math.min(trainAmt, snapCrystal)} 结晶</span>
          <button onClick={() => game.trainChar(id, trainAmt)}
            data-newbie-hint={nbTrain ? '1' : undefined}
            className={`rounded bg-dq-gold px-3 py-1 text-sm text-black ${nbTrain ? 'dq-breath' : ''}`}>打坐修炼</button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {entry.stars >= MAX_STARS ? (
            <div className="rounded border border-dq-border px-3 py-1 text-sm text-[#5a4a38]">
              已达最高星级 {MAX_STARS}★（{STAR_TIERS[STAR_TIERS.length - 1].name}）
            </div>
          ) : (() => {
            const c = starUpCost(entry.stars)
            const have = state.inventory[c.item] ?? 0
            // 预览必须与上方面板同一个口径（battleStatsOf）：否则面板显示含羁绊的值、
            // 预览拿裸属性算差，"升一星涨 258"点完却涨了 320，又是一次"数字对不上"的反馈
            const now = game.battleStatsOf(id)
            const next = game.battleStatsOf(id, entry.stars + 1)
            // 跨档单独提示：品质跃升是额外的 +10% 属性，不写出来玩家只会以为换了个颜色
            const crosses = starTierIndex(entry.stars + 1) > starTierIndex(entry.stars)
            const nextTier = starTierOf(entry.stars + 1)
            return (
              <>
                <button onClick={() => game.starUp(id)} disabled={have < c.amount}
                  className="rounded border border-dq-border px-3 py-1 text-sm hover:border-dq-gold disabled:opacity-40">
                  升星 {entry.stars}★→{entry.stars + 1}★（消耗 {c.amount} {itemLabel(c.item).name}，拥有 {Math.floor(have)}）
                </button>
                {/* 把"这一星到底涨多少"写在按钮旁：星级加成挂在 charStats 的加成层，
                    光看星级字形涨了、数字不动，玩家会以为没生效（曾经的 bug 就是这么被发现的） */}
                {now && next && (
                  <span className="text-xs text-[#a89478]">
                    升星后 攻击 +{next.atk - now.atk} · 防御 +{next.def - now.def} · 气血 +{next.hp - now.hp}
                  </span>
                )}
                {crosses && (
                  <span className="text-xs" style={{ color: nextTier.color }}>
                    下一星晋入 {nextTier.name}：属性额外 +{Math.round(STAR_TIER_JUMP * 100)}%
                  </span>
                )}
              </>
            )
          })()}
        </div>

        <div className="mt-4">
          <div className="mb-1 text-xs text-[#a89478]">编入阵容</div>
          <div className="flex gap-2">
            {/* 已上阵的角色，把他所在的那个位置标出来 —— 否则六个按钮长得一样，
                玩家分不清"我点的是当前位置"还是"我要把他挪过去" */}
            {Array.from({ length: TEAM_FRONT_SIZE }, (_, i) => (
              <button key={`f${i}`} onClick={() => onAssign('front', i)}
                className={`rounded border px-2 py-1 text-xs hover:border-dq-gold ${curRow === 'front' && curIdx === i ? 'border-dq-gold text-dq-gold' : 'border-dq-border'}`}>
                前排{i + 1}{curRow === 'front' && curIdx === i ? '（当前）' : ''}
              </button>
            ))}
            {Array.from({ length: TEAM_BACK_SIZE }, (_, i) => (
              <button key={`b${i}`} onClick={() => onAssign('back', i)}
                className={`rounded border px-2 py-1 text-xs hover:border-dq-gold ${curRow === 'back' && curIdx === i ? 'border-dq-gold text-dq-gold' : 'border-dq-border'}`}>
                后排{i + 1}{curRow === 'back' && curIdx === i ? '（当前）' : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {inTeam ? (
            <div className="text-xs text-[#5a4a38]">上阵中的武魂不能放生，先换下来再操作</div>
          ) : confirmSell ? (
            <div className="rounded border border-dq-fire/50 p-2">
              <div className="mb-1 text-xs text-dq-fire">确定放生 {cdef.name}？此操作不可撤销</div>
              {refund && (
                <div className="mb-2 space-y-0.5 text-[11px] leading-relaxed text-[#d8c6a8]">
                  <div className="text-[#a89478]">
                    返还已投入资源的 {Math.round(RELEASE_REFUND * 100)}%（角色本身的价值照给）：
                  </div>
                  <div>
                    <Ico name={itemSprite('essence')} className="h-3.5 w-3.5 align-[-3px]" /> {itemLabel('essence').name} ×{refund.essence}
                    <span className="text-[#a89478]">（本身 {refund.own} + 升星 {refund.essence - refund.own}）</span>
                  </div>
                  {refund.xuanjing > 0 && (
                    <div><Ico name={itemSprite('xuanjing')} className="h-3.5 w-3.5 align-[-3px]" /> {itemLabel('xuanjing').name} ×{refund.xuanjing}
                      <span className="text-[#a89478]">（投入 {refund.invested.xuanjing}）</span></div>
                  )}
                  {refund.crystal > 0 && (
                    <div><Ico name={itemSprite('crystal')} className="h-3.5 w-3.5 align-[-3px]" /> {itemLabel('crystal').name} ×{refund.crystal}
                      <span className="text-[#a89478]">（投入 {refund.invested.crystal}）</span></div>
                  )}
                  {Object.entries(refund.pills).map(([pid, n]) => (
                    <div key={pid}><Ico name={itemSprite(pid)} className="h-3.5 w-3.5 align-[-3px]" /> {itemLabel(pid).name} ×{n}
                      <span className="text-[#a89478]">（投入 {refund.invested.pills[pid] ?? 0}）</span></div>
                  ))}
                  <div className="text-[#5a4a38]">身上的装备会退回背包</div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => { game.releaseChar(id); onSold() }}
                  className="rounded bg-dq-fire px-2 py-1 text-xs text-black">确认放生</button>
                <button onClick={() => setConfirmSell(false)}
                  className="rounded border border-dq-border px-2 py-1 text-xs hover:border-dq-gold">取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmSell(true)}
              className="rounded border border-dq-border px-2 py-1 text-xs text-[#a89478] hover:border-dq-fire hover:text-dq-fire">
              放生（返还养成投入的 {Math.round(RELEASE_REFUND * 100)}%）
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * `name` 是给自动化用的稳定锚点（`data-stat`）—— 见 SPEC 的"定位优先级"：
 * ① 显式锚点 ② 语义+文案 ③ 标签结构推断。标签文案会随措辞调整而变，
 * 结构会被包一层 `<div>` 打穿（v1.28.5、v1.30 两次），锚点不会。
 */
function Stat({ name, label, value, hint }: { name: string; label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded border border-dq-border p-2 text-center" data-stat={name}>
      <div className="text-[#a89478]">{label}</div>
      <div className="text-dq-gold" data-stat-value>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-[#5a4a38]">{hint}</div>}
    </div>
  )
}
