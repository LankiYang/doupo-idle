// ─── 游戏引擎 v1：境界成长、组队战斗、招募抽卡、离线结算 ──────────────────────
import { useSyncExternalStore } from 'react'
import {
  CHARACTERS, FIRES, PILLS, ITEM_INFO, RARITY_INFO, LAB_BLESSINGS,
  xpToNext, needsPillFor, pillGradeFor, realmLabel, realmMult,
  stageStats, isBossStage, zoneForStage, monsterForStage, stageCoinReward,
  labStats, isLabBoss, labDaolingReward,
  MAX_STARS, starUpCost, SHENG_SHARD_COST,
  rollEquip, rollEquipQuality, equipAffixSum,
  type CharacterDef, type Rarity, type EquipSlot, type EquipItem,
} from './data'
import { playSound } from './sound'

export interface RosterEntry { level: number; xp: number; stars: number; equip: Partial<Record<EquipSlot, EquipItem>> }

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'accessory', 'ring']
/** 暴击伤害基础倍率：没有戒指/词条时暴击率为 0，此值不生效；有暴击后按此为基准叠加装备的暴击伤害词条 */
const BASE_CRIT_DMG = 50
/** 单次掉落判定的基础概率，首领额外加成见 onKill/labOnKill */
const EQUIP_DROP_CHANCE = 0.06
const EQUIP_DROP_CHANCE_BOSS = 0.35
export type TeamSlot = string | null

export interface BattleState {
  monsterHp: number
  roundTimer: number
  fighterHp: Record<string, number>
}

export interface CombatEvent { type: 'dmg' | 'heal' | 'monsterDmg' | 'kill' | 'drop' | 'down'; value: number; who?: string; item?: string; time: number; source: 'main' | 'lab'; crit?: boolean; boss?: boolean }

/** 同一回合内相邻出手事件的演出间隔（ms）——UI 只播放 time 已到的事件，形成依次出手的节奏 */
export const SEQ_MS = 220

export interface LabBattleState {
  floor: number
  monsterHp: number
  roundTimer: number
  fighterHp: Record<string, number>
}

export interface LabState {
  battle: LabBattleState | null
  autoLab: boolean
  highestFloor: number
  blessings: string[] // 本次爬塔已选祝福，撤退/阵亡清空
  offer: string[] | null // 三选一待选
}

export interface GameState {
  roster: Record<string, RosterEntry>
  team: { front: TeamSlot[]; back: TeamSlot[] }
  equippedFire: string | null
  inventory: Record<string, number>
  battle: BattleState | null
  autoBattle: boolean
  stage: number
  highestStage: number
  wipeStage: number | null // 当前连续团灭发生在哪一关
  wipeStreak: number // 在 wipeStage 上连续团灭了几次
  lastProgressAt: number // 上次推进关卡的时间戳：用于识别"打不死也死不了"的僵持卡关
  lab: LabState
  kills: number
  pityCommon: number // 距离上次出地阶+的抽数
  pityRare: number // 距离上次出天阶+的抽数
  notice: string
  lastTick: number
  combatEvents: CombatEvent[]
  equipBag: EquipItem[]
}

const SAVE_KEY = 'doupo-idle-save-v1'
const ROUND_SEC = 2
const CHAR_MAP: Record<string, CharacterDef> = Object.fromEntries(CHARACTERS.map(c => [c.id, c]))
/** 重复抽到 / 主动卖出角色换取的武魂精血，按稀有度分级 */
export const ESSENCE_BY_RARITY: Record<Rarity, number> = { yellow: 5, xuan: 10, di: 20, tian: 35, quasi: 60, sheng: 100 }

const STARTER_IDS = ['yellow_disciple', 'yellow_mercenary', 'yellow_bandit', 'yellow_hunter']

function freshState(): GameState {
  const roster: Record<string, RosterEntry> = {}
  for (const id of STARTER_IDS) roster[id] = { level: 1, xp: 0, stars: 0, equip: {} }
  return {
    roster,
    team: { front: ['yellow_disciple', 'yellow_mercenary', null], back: ['yellow_bandit', 'yellow_hunter'] },
    equippedFire: null,
    inventory: { coin: 200, yuanfen: 5, crystal: 0, herb: 0, essence: 0, daoling: 0 },
    battle: null,
    autoBattle: false,
    stage: 1,
    highestStage: 1,
    wipeStage: null,
    wipeStreak: 0,
    lastProgressAt: Date.now(),
    lab: { battle: null, autoLab: false, highestFloor: 0, blessings: [], offer: null },
    kills: 0,
    pityCommon: 0,
    pityRare: 0,
    notice: '',
    lastTick: Date.now(),
    combatEvents: [],
    equipBag: [],
  }
}

export function charStats(entry: RosterEntry, charDef: CharacterDef, fireId: string | null) {
  const lv = entry.level
  // 星级线性加成 × 境界乘法加成（后者是对抗怪物指数成长的关键，见 data.ts REALM_POWER）
  const starMult = 1 + entry.stars * 0.08
  const rMult = realmMult(lv)
  let atk = (charDef.baseAtk + charDef.atkGrowth * lv) * starMult * rMult
  let def = (charDef.baseDef + charDef.defGrowth * lv) * starMult * rMult
  let hp = (charDef.baseHp + charDef.hpGrowth * lv) * starMult * rMult
  if (fireId) {
    const fire = FIRES.find(f => f.id === fireId)
    if (fire) {
      atk *= 1 + (fire.atkPct ?? 0) / 100
      def *= 1 + (fire.defPct ?? 0) / 100
      hp *= 1 + (fire.hpPct ?? 0) / 100
    }
  }
  // 装备：全部词条是百分比加成（原因见 data.ts 装备系统注释），暴击率/暴击伤害只从装备来
  let critRate = 0, critDmg = BASE_CRIT_DMG
  let equipAtkPct = 0, equipDefPct = 0, equipHpPct = 0
  for (const slot of EQUIP_SLOTS) {
    const item = entry.equip?.[slot]
    if (!item) continue
    equipAtkPct += equipAffixSum(item, 'atkPct')
    equipDefPct += equipAffixSum(item, 'defPct')
    equipHpPct += equipAffixSum(item, 'hpPct')
    critRate += equipAffixSum(item, 'critRate')
    critDmg += equipAffixSum(item, 'critDmg')
  }
  atk *= 1 + equipAtkPct / 100
  def *= 1 + equipDefPct / 100
  hp *= 1 + equipHpPct / 100
  return { atk: Math.round(atk), def: Math.round(def), hp: Math.round(hp), critRate: Math.min(100, critRate), critDmg }
}

class GameStore {
  state: GameState
  private listeners = new Set<() => void>()

  constructor() {
    this.state = this.load()
    this.applyOfflineProgress()
    setInterval(() => this.tick(), 100)
    setInterval(() => this.save(), 2000)
    window.addEventListener('beforeunload', () => this.save())
  }

  private load(): GameState {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as GameState
        const base = freshState()
        const roster: Record<string, RosterEntry> = { ...base.roster, ...parsed.roster }
        // 老存档的角色条目没有 equip 字段，逐个补上，否则 charStats 里访问 entry.equip[slot] 会崩
        for (const id of Object.keys(roster)) roster[id] = { ...roster[id], equip: roster[id].equip ?? {} }
        return {
          ...base,
          ...parsed,
          roster,
          team: parsed.team ?? base.team,
          inventory: { ...base.inventory, ...parsed.inventory },
          stage: parsed.stage ?? base.stage,
          highestStage: parsed.highestStage ?? parsed.stage ?? base.highestStage,
          lastProgressAt: parsed.lastProgressAt ?? Date.now(),
          lab: { ...base.lab, ...parsed.lab, battle: null },
          combatEvents: [],
          equipBag: parsed.equipBag ?? [],
        }
      }
    } catch { /* ignore */ }
    return freshState()
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)) } catch { /* ignore */ }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = () => this.state
  private emit() {
    this.state = { ...this.state }
    this.listeners.forEach(fn => fn())
  }

  setNotice(text: string) {
    this.state.notice = text
    setTimeout(() => {
      if (this.state.notice === text) { this.state.notice = ''; this.emit() }
    }, 3000)
  }

  // ── 斗气结晶（挂机产出，随打坐弟子数量增长）────────────────────────────────
  crystalPerSec(): number {
    const rosterCount = Object.keys(this.state.roster).length
    return 0.6 + rosterCount * 0.15
  }

  // ── 灵药（药园挂机产出，供炼丹合成丹药）────────────────────────────────────
  herbPerSec(): number {
    const rosterCount = Object.keys(this.state.roster).length
    return 0.3 + rosterCount * 0.05
  }

  private applyOfflineProgress() {
    const nowMs = Date.now()
    const dt = Math.min((nowMs - this.state.lastTick) / 1000, 8 * 3600)
    if (dt > 1) {
      this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + this.crystalPerSec() * dt
      this.state.inventory.herb = (this.state.inventory.herb ?? 0) + this.herbPerSec() * dt
    }
    this.state.battle = null
    this.state.lastTick = nowMs
  }

  private tick() {
    const nowMs = Date.now()
    const dt = Math.min((nowMs - this.state.lastTick) / 1000, 5)
    this.state.lastTick = nowMs

    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + this.crystalPerSec() * dt
    this.state.inventory.herb = (this.state.inventory.herb ?? 0) + this.herbPerSec() * dt

    if (this.state.battle) {
      this.state.battle.roundTimer -= dt
      while (this.state.battle && this.state.battle.roundTimer <= 0) {
        this.state.battle.roundTimer += ROUND_SEC
        this.battleRound()
      }
    } else if (this.state.autoBattle) {
      this.startBattle()
    }

    if (this.state.lab.battle && !this.state.lab.offer) {
      this.state.lab.battle.roundTimer -= dt
      while (this.state.lab.battle && !this.state.lab.offer && this.state.lab.battle.roundTimer <= 0) {
        this.state.lab.battle.roundTimer += ROUND_SEC
        this.labBattleRound()
      }
    } else if (this.state.lab.autoLab && !this.state.lab.battle && !this.state.lab.offer) {
      this.startLab()
    }

    const cutoff = Date.now() - 3000
    this.state.combatEvents = this.state.combatEvents.filter(e => e.time > cutoff)

    this.emit()
  }

  // ── 经验分配（通用斗气结晶 → 指定角色）──────────────────────────────────
  trainChar(id: string, amount: number) {
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return
    const have = this.state.inventory.crystal ?? 0
    const spend = Math.min(amount, have)
    if (spend <= 0) return
    this.state.inventory.crystal = have - spend
    this.gainXp(id, spend)
    this.emit()
  }

  private gainXp(id: string, amount: number) {
    const entry = this.state.roster[id]
    if (!entry) return
    entry.xp += amount
    while (true) {
      const need = xpToNext(entry.level)
      if (entry.xp < need) break
      if (needsPillFor(entry.level)) {
        const grade = pillGradeFor(entry.level)
        const pid = `pill${grade}`
        if ((this.state.inventory[pid] ?? 0) < 1) { entry.xp = need; break }
        this.state.inventory[pid] -= 1
        this.setNotice(`⚡ ${CHAR_MAP[id]?.name} 服丹突破！${realmLabel(entry.level + 1)}`)
        playSound('breakthrough')
      }
      entry.xp -= need
      entry.level += 1
    }
  }

  // ── 阵容 ───────────────────────────────────────────────────────────────
  setSlot(row: 'front' | 'back', index: number, charId: string | null) {
    if (charId && !this.state.roster[charId]) return
    // 同一角色不能同时占用两个位置
    if (charId) {
      for (const r of ['front', 'back'] as const) {
        this.state.team[r] = this.state.team[r].map(x => (x === charId ? null : x))
      }
    }
    this.state.team[row][index] = charId
    this.emit()
  }

  equipFire(fireId: string | null) {
    if (fireId && !this.ownsFire(fireId)) { this.setNotice('尚未获得此异火'); return }
    this.state.equippedFire = fireId
    this.emit()
  }

  ownsFire(fireId: string): boolean {
    return (this.state.inventory[`fire_${fireId}`] ?? 0) > 0
  }

  /** 异火只认主战角色（前排第一位）为主 */
  private fireFor(charId: string): string | null {
    return this.state.equippedFire && charId === this.state.team.front[0] ? this.state.equippedFire : null
  }

  // ── 战斗：不再手选地图，关卡随击杀持续推进，怪物数值随关卡数指数成长 ──────────
  activeFighters(): string[] {
    return [...this.state.team.front, ...this.state.team.back].filter((x): x is string => !!x)
  }

  startBattle() {
    const fighters = this.activeFighters()
    if (fighters.length === 0) { this.setNotice('请先编排阵容'); return }
    const fighterHp: Record<string, number> = {}
    for (const id of fighters) {
      const entry = this.state.roster[id]
      const cdef = CHAR_MAP[id]
      if (entry && cdef) fighterHp[id] = charStats(entry, cdef, this.fireFor(id)).hp
    }
    this.state.battle = { monsterHp: stageStats(this.state.stage).hp, roundTimer: ROUND_SEC, fighterHp }
    this.emit()
  }

  stopBattle() {
    this.state.battle = null
    this.state.autoBattle = false
    this.emit()
  }

  toggleAutoBattle() {
    this.state.autoBattle = !this.state.autoBattle
    if (this.state.autoBattle && !this.state.battle) this.startBattle()
    this.emit()
  }

  private frontAlive(b: BattleState): string | null {
    return this.state.team.front.find(id => id && (b.fighterHp[id] ?? 0) > 0) ?? null
  }
  private backAlive(b: BattleState): string | null {
    return this.state.team.back.find(id => id && (b.fighterHp[id] ?? 0) > 0) ?? null
  }
  private anyAlive(b: BattleState): boolean {
    return Object.values(b.fighterHp).some(hp => hp > 0)
  }

  private battleRound() {
    const b = this.state.battle
    if (!b) return
    const stage = this.state.stage
    const monsterDef = monsterForStage(stage)
    const monster = stageStats(stage)

    // 我方行动：输出角色打怪，治疗角色回复队友
    // 演出节奏：每个出手事件的 time 依次错开 SEQ_MS，UI 只播放 time 已到的事件，形成"依次出手"而非全员同帧
    const t0 = Date.now()
    let seq = 0
    let totalDmg = 0
    for (const id of this.activeFighters()) {
      const hp = b.fighterHp[id] ?? 0
      if (hp <= 0) continue
      const cdef = CHAR_MAP[id]
      const entry = this.state.roster[id]
      if (!cdef || !entry) continue
      const stats = charStats(entry, cdef, this.fireFor(id))
      if (cdef.role === 'heal') {
        let lowestId: string | null = null
        let lowestPct = 1
        for (const fid of this.activeFighters()) {
          const fhp = b.fighterHp[fid] ?? 0
          if (fhp <= 0) continue
          const fdef = CHAR_MAP[fid]
          const fentry = this.state.roster[fid]
          if (!fdef || !fentry) continue
          const maxHp = charStats(fentry, fdef, this.fireFor(fid)).hp
          const pct = fhp / maxHp
          if (pct < lowestPct) { lowestPct = pct; lowestId = fid }
        }
        if (lowestId) {
          const fdef = CHAR_MAP[lowestId]
          const fentry = this.state.roster[lowestId]
          const maxHp = fdef && fentry ? charStats(fentry, fdef, this.fireFor(lowestId)).hp : 0
          const heal = Math.round(stats.atk * 1.5)
          b.fighterHp[lowestId] = Math.min(maxHp, (b.fighterHp[lowestId] ?? 0) + heal)
          this.state.combatEvents.push({ type: 'heal', value: heal, who: lowestId, time: t0 + seq * SEQ_MS, source: 'main' })
          seq++
        }
        continue
      }
      let dmg = Math.max(1, Math.round((stats.atk - monster.def * 0.6) * (0.85 + Math.random() * 0.3)))
      const crit = Math.random() * 100 < stats.critRate
      if (crit) dmg = Math.round(dmg * (1 + stats.critDmg / 100))
      totalDmg += dmg
      this.state.combatEvents.push({ type: 'dmg', value: dmg, who: id, time: t0 + seq * SEQ_MS, source: 'main', crit })
      seq++
    }
    b.monsterHp -= totalDmg

    if (b.monsterHp <= 0) {
      this.state.combatEvents.push({ type: 'kill', value: 0, who: monsterDef.name, time: t0 + seq * SEQ_MS, source: 'main', boss: isBossStage(stage) })
      this.onKill()
      if (!this.state.battle) return
      b.monsterHp = stageStats(this.state.stage).hp
      return
    }

    // 怪物反击：优先攻击前排存活者（演出上排在全员出手之后）
    const targetId = this.frontAlive(b) ?? this.backAlive(b)
    if (targetId) {
      const cdef = CHAR_MAP[targetId]
      const entry = this.state.roster[targetId]
      if (cdef && entry) {
        const stats = charStats(entry, cdef, this.fireFor(targetId))
        const mdmg = Math.max(0, Math.round((monster.atk - stats.def) * (0.85 + Math.random() * 0.3)))
        b.fighterHp[targetId] = Math.max(0, (b.fighterHp[targetId] ?? 0) - mdmg)
        const tCounter = t0 + seq * SEQ_MS + 120
        this.state.combatEvents.push({ type: 'monsterDmg', value: mdmg, who: targetId, time: tCounter, source: 'main' })
        if (b.fighterHp[targetId] <= 0) {
          this.state.combatEvents.push({ type: 'down', value: 0, who: targetId, time: tCounter + 200, source: 'main' })
        }
      }
    }

    if (!this.anyAlive(b)) {
      if (this.state.wipeStage === this.state.stage) this.state.wipeStreak += 1
      else { this.state.wipeStage = this.state.stage; this.state.wipeStreak = 1 }
      this.setNotice(`全队阵亡，撤退疗伤中…（第 ${this.state.stage} 关已连续 ${this.state.wipeStreak} 次）`)
      this.state.battle = null
    }
  }

  /** 装备掉落：命中就在 4 个槽位里随机一个、按权重随机品阶，首领用更高的掉落率 */
  private tryDropEquip(boss: boolean) {
    const chance = boss ? EQUIP_DROP_CHANCE_BOSS : EQUIP_DROP_CHANCE
    if (Math.random() > chance) return
    const slot = EQUIP_SLOTS[Math.floor(Math.random() * EQUIP_SLOTS.length)]
    const quality = rollEquipQuality()
    const item = rollEquip(slot, quality)
    this.state.equipBag.push(item)
    this.setNotice(`🎁 获得装备：${item.name}`)
  }

  private onKill() {
    this.state.kills++
    const stage = this.state.stage
    const zone = zoneForStage(stage)
    const boss = isBossStage(stage)
    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + stageStats(stage).hp / 20
    this.state.inventory.coin = (this.state.inventory.coin ?? 0) + Math.floor(stageCoinReward(stage) * (boss ? 1.5 : 1))
    this.tryDropEquip(boss)
    for (const d of zone.drops) {
      if (d.item === 'coin') continue // 铜钱走关卡奖励，不再吃地图表里的固定区间
      if (Math.random() > d.chance) continue
      const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1))
      this.state.inventory[d.item] = (this.state.inventory[d.item] ?? 0) + n
      this.state.combatEvents.push({ type: 'drop', value: n, item: d.item, time: Date.now(), source: 'main' })
    }
    // 首通奖励：缘分丹 + 异火里程碑
    // 缘分丹原先只有初始 5 颗、零产出来源，抽卡开局即死，26 名角色里 18~21 名永久不可得
    const isFirstClear = stage >= this.state.highestStage
    if (isFirstClear) {
      if (boss) {
        const n = 1 + (stage % 25 === 0 ? 2 : 0) // 每 5 关首领给 1 颗，每 25 关多给 2 颗
        this.state.inventory.yuanfen = (this.state.inventory.yuanfen ?? 0) + n
        this.state.combatEvents.push({ type: 'drop', value: n, item: 'yuanfen', time: Date.now(), source: 'main' })
      }
      for (const f of FIRES) {
        if (f.stageReq === stage && !this.ownsFire(f.id)) {
          this.state.inventory[`fire_${f.id}`] = 1
          this.setNotice(`🔥 首通第 ${stage} 关！获得异火「${f.name}」`)
        }
      }
    }
    if (boss && !isFirstClear) {
      this.setNotice(`⚔ 击破第 ${stage} 关首领！`)
    }
    this.state.stage += 1
    this.state.highestStage = Math.max(this.state.highestStage, this.state.stage)
    this.state.wipeStage = null
    this.state.wipeStreak = 0
    this.state.lastProgressAt = Date.now()
  }

  // ── 天梯塔：roguelike 爬塔，祝福仅本次爬塔生效，战败/撤退清空重来 ──────────────
  blessingTotals() {
    const t = { atkPct: 0, defPct: 0, hpPct: 0, lifesteal: 0, pierce: 0, dodge: 0, coinPct: 0, daolingPct: 0, crystalPct: 0 }
    for (const id of this.state.lab.blessings) {
      const b = LAB_BLESSINGS.find(x => x.id === id)
      if (!b) continue
      t.atkPct += b.atkPct ?? 0
      t.defPct += b.defPct ?? 0
      t.hpPct += b.hpPct ?? 0
      t.lifesteal += b.lifesteal ?? 0
      t.pierce += b.pierce ?? 0
      t.dodge += b.dodge ?? 0
      t.coinPct += b.coinPct ?? 0
      t.daolingPct += b.daolingPct ?? 0
      t.crystalPct += b.crystalPct ?? 0
    }
    return t
  }

  private labFighterStats(id: string) {
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return null
    const base = charStats(entry, cdef, this.fireFor(id))
    const bt = this.blessingTotals()
    return {
      atk: Math.round(base.atk * (1 + bt.atkPct / 100)),
      def: Math.round(base.def * (1 + bt.defPct / 100)),
      hp: Math.round(base.hp * (1 + bt.hpPct / 100)),
      critRate: base.critRate,
      critDmg: base.critDmg,
    }
  }

  startLab() {
    const fighters = this.activeFighters()
    if (fighters.length === 0) { this.setNotice('请先编排阵容'); return }
    this.state.lab.blessings = []
    this.state.lab.offer = null
    const fighterHp: Record<string, number> = {}
    for (const id of fighters) {
      const s = this.labFighterStats(id)
      if (s) fighterHp[id] = s.hp
    }
    this.state.lab.battle = { floor: 1, monsterHp: labStats(1).hp, roundTimer: ROUND_SEC, fighterHp }
    this.emit()
  }

  retreatLab() {
    this.state.lab.battle = null
    this.state.lab.autoLab = false
    this.state.lab.blessings = []
    this.state.lab.offer = null
    this.emit()
  }

  toggleAutoLab() {
    this.state.lab.autoLab = !this.state.lab.autoLab
    if (this.state.lab.autoLab && !this.state.lab.battle) this.startLab()
    this.emit()
  }

  private labFrontAlive(b: LabBattleState): string | null {
    return this.state.team.front.find(id => id && (b.fighterHp[id] ?? 0) > 0) ?? null
  }
  private labBackAlive(b: LabBattleState): string | null {
    return this.state.team.back.find(id => id && (b.fighterHp[id] ?? 0) > 0) ?? null
  }
  private labAnyAlive(b: LabBattleState): boolean {
    return Object.values(b.fighterHp).some(hp => hp > 0)
  }

  private labBattleRound() {
    const b = this.state.lab.battle
    if (!b) return
    const boss = isLabBoss(b.floor)
    const monster = labStats(b.floor)
    const bt = this.blessingTotals()

    // 与主线一致的依次出手演出节奏
    const t0 = Date.now()
    let seq = 0
    let totalDmg = 0
    for (const id of this.activeFighters()) {
      const hp = b.fighterHp[id] ?? 0
      if (hp <= 0) continue
      const cdef = CHAR_MAP[id]
      if (!cdef) continue
      const stats = this.labFighterStats(id)
      if (!stats) continue
      if (cdef.role === 'heal') {
        let lowestId: string | null = null
        let lowestPct = 1
        for (const fid of this.activeFighters()) {
          const fhp = b.fighterHp[fid] ?? 0
          if (fhp <= 0) continue
          const fs = this.labFighterStats(fid)
          if (!fs) continue
          const pct = fhp / fs.hp
          if (pct < lowestPct) { lowestPct = pct; lowestId = fid }
        }
        if (lowestId) {
          const fs = this.labFighterStats(lowestId)
          const maxHp = fs ? fs.hp : 0
          const heal = Math.round(stats.atk * 1.5)
          b.fighterHp[lowestId] = Math.min(maxHp, (b.fighterHp[lowestId] ?? 0) + heal)
          this.state.combatEvents.push({ type: 'heal', value: heal, who: lowestId, time: t0 + seq * SEQ_MS, source: 'lab' })
          seq++
        }
        continue
      }
      const pierce = Math.min(0.9, bt.pierce / 100)
      let dmg = Math.max(1, Math.round((stats.atk - monster.def * 0.6 * (1 - pierce)) * (0.85 + Math.random() * 0.3)))
      const crit = Math.random() * 100 < stats.critRate
      if (crit) dmg = Math.round(dmg * (1 + stats.critDmg / 100))
      totalDmg += dmg
      if (bt.lifesteal > 0) {
        const fs = this.labFighterStats(id)
        if (fs) b.fighterHp[id] = Math.min(fs.hp, hp + Math.round(dmg * bt.lifesteal / 100))
      }
      this.state.combatEvents.push({ type: 'dmg', value: dmg, who: id, time: t0 + seq * SEQ_MS, source: 'lab', crit })
      seq++
    }
    b.monsterHp -= totalDmg

    if (b.monsterHp <= 0) {
      this.state.combatEvents.push({ type: 'kill', value: 0, who: `第${b.floor}层`, time: t0 + seq * SEQ_MS, source: 'lab', boss })
      this.labOnKill(b, boss)
      if (!this.state.lab.battle) return
      b.floor += 1
      b.monsterHp = labStats(b.floor).hp
      return
    }

    if (bt.dodge > 0 && Math.random() < bt.dodge / 100) return

    const targetId = this.labFrontAlive(b) ?? this.labBackAlive(b)
    if (targetId) {
      const stats = this.labFighterStats(targetId)
      if (stats) {
        const mdmg = Math.max(0, Math.round((monster.atk - stats.def) * (0.85 + Math.random() * 0.3)))
        b.fighterHp[targetId] = Math.max(0, (b.fighterHp[targetId] ?? 0) - mdmg)
        const tCounter = t0 + seq * SEQ_MS + 120
        this.state.combatEvents.push({ type: 'monsterDmg', value: mdmg, who: targetId, time: tCounter, source: 'lab' })
        if (b.fighterHp[targetId] <= 0) {
          this.state.combatEvents.push({ type: 'down', value: 0, who: targetId, time: tCounter + 200, source: 'lab' })
        }
      }
    }

    if (!this.labAnyAlive(b)) {
      this.setNotice(`爬塔失败于第 ${b.floor} 层，祝福清空，重新出发`)
      this.state.lab.battle = null
      this.state.lab.blessings = []
    }
  }

  private labOnKill(b: LabBattleState, boss: boolean) {
    this.state.kills++
    const bt = this.blessingTotals()
    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + (labStats(b.floor).hp / 25) * (1 + bt.crystalPct / 100)
    this.state.inventory.coin = (this.state.inventory.coin ?? 0) + Math.floor(10 * (1 + bt.coinPct / 100))
    this.tryDropEquip(boss)

    const isFirstClear = b.floor > this.state.lab.highestFloor
    if (isFirstClear) {
      this.state.lab.highestFloor = b.floor
      const daoling = Math.floor(labDaolingReward(b.floor) * (1 + bt.daolingPct / 100))
      this.state.inventory.daoling = (this.state.inventory.daoling ?? 0) + daoling
      this.state.combatEvents.push({ type: 'drop', value: daoling, item: 'daoling', time: Date.now(), source: 'lab' })
      // 每 5 层首通给 1 颗缘分丹：与主线并列的抽卡货币来源
      if (isLabBoss(b.floor)) {
        this.state.inventory.yuanfen = (this.state.inventory.yuanfen ?? 0) + 1
        this.state.combatEvents.push({ type: 'drop', value: 1, item: 'yuanfen', time: Date.now(), source: 'lab' })
      }
      for (const f of FIRES) {
        if (f.floorReq === b.floor && !this.ownsFire(f.id)) {
          this.state.inventory[`fire_${f.id}`] = 1
          this.setNotice(`🔥 首通 ${b.floor} 层！获得异火「${f.name}」`)
        }
      }
    }

    if (boss) {
      const owned = new Set(this.state.lab.blessings)
      const offer = LAB_BLESSINGS.filter(x => !owned.has(x.id)).map(x => x.id)
      for (let i = offer.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[offer[i], offer[j]] = [offer[j], offer[i]]
      }
      if (offer.length > 0) {
        this.state.lab.offer = offer.slice(0, 3)
        this.setNotice(`✨ 第 ${b.floor} 层告破，三选一祝福降临！`)
      }
    }
  }

  chooseBlessing(id: string) {
    if (!this.state.lab.offer?.includes(id)) return
    this.state.lab.blessings.push(id)
    this.state.lab.offer = null
    this.emit()
  }

  buyLabShop(item: 'pill' | 'essence', grade?: number) {
    if (item === 'pill' && grade) {
      const cost = grade * 15
      if ((this.state.inventory.daoling ?? 0) < cost) { this.setNotice('论道令不足'); return }
      this.state.inventory.daoling -= cost
      this.state.inventory[`pill${grade}`] = (this.state.inventory[`pill${grade}`] ?? 0) + 1
      this.setNotice(`兑换 ${grade} 品丹药 ×1`)
    } else if (item === 'essence') {
      const cost = 10
      if ((this.state.inventory.daoling ?? 0) < cost) { this.setNotice('论道令不足'); return }
      this.state.inventory.daoling -= cost
      this.state.inventory.essence = (this.state.inventory.essence ?? 0) + 20
      this.setNotice('兑换武魂精血 ×20')
    }
    this.emit()
  }

  // ── 招募抽卡 ───────────────────────────────────────────────────────────
  private rollRarity(): Rarity {
    this.state.pityCommon++
    this.state.pityRare++
    if (this.state.pityRare >= 90) {
      this.state.pityRare = 0
      return Math.random() < 0.15 ? 'sheng' : Math.random() < 0.4 ? 'quasi' : 'tian'
    }
    if (this.state.pityCommon >= 30) {
      this.state.pityCommon = 0
      const r = Math.random()
      return r < 0.05 ? 'quasi' : r < 0.25 ? 'tian' : 'di'
    }
    const r = Math.random()
    if (r < 0.005) return 'sheng'
    if (r < 0.03) return 'quasi'
    if (r < 0.12) return 'tian'
    if (r < 0.30) return 'di'
    if (r < 0.60) return 'xuan'
    return 'yellow'
  }

  recruit(times: 1 | 10) {
    const cost = times
    if ((this.state.inventory.yuanfen ?? 0) < cost) { this.setNotice('缘分丹不足'); return [] }
    this.state.inventory.yuanfen -= cost
    const results: { id: string; isNew: boolean; rarity: Rarity }[] = []
    for (let i = 0; i < times; i++) {
      const rarity = this.rollRarity()
      const pool = CHARACTERS.filter(c => c.rarity === rarity)
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (!pick) continue
      const isNew = !this.state.roster[pick.id]
      if (isNew) {
        this.state.roster[pick.id] = { level: 1, xp: 0, stars: 0, equip: {} }
      } else {
        this.state.inventory.essence = (this.state.inventory.essence ?? 0) + ESSENCE_BY_RARITY[rarity]
      }
      results.push({ id: pick.id, isNew, rarity })
    }
    if (results.length > 0) {
      const order = RARITY_INFO
      const best = results.reduce((a, b) => order[b.rarity].order > order[a.rarity].order ? b : a)
      playSound(order[best.rarity].order >= 4 ? 'gachaHigh' : order[best.rarity].order >= 2 ? 'gachaMid' : 'gachaLow')
    }
    this.emit()
    return results
  }

  /**
   * 卖出/放生角色：换取武魂精血（价格同重复抽到时的转换表），
   * 解决"抽卡能重复但拿到的东西完全没有主动处理渠道"的问题。
   * 上阵中的角色不能卖，防止手滑把正在用的队友卖掉。
   */
  releaseChar(id: string) {
    const cdef = CHAR_MAP[id]
    const entry = this.state.roster[id]
    if (!cdef || !entry) return
    if ([...this.state.team.front, ...this.state.team.back].includes(id)) {
      this.setNotice('上阵中的武魂不能卖出，先把TA换下来')
      return
    }
    for (const item of Object.values(entry.equip)) this.state.equipBag.push(item)
    delete this.state.roster[id]
    const gain = ESSENCE_BY_RARITY[cdef.rarity]
    this.state.inventory.essence = (this.state.inventory.essence ?? 0) + gain
    this.setNotice(`放生了 ${cdef.name}，获得 ${gain} 武魂精血`)
    this.emit()
  }

  // ── 升星 ───────────────────────────────────────────────────────────────
  starUp(id: string) {
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return
    if (entry.stars >= MAX_STARS) { this.setNotice('已达最高星级'); return }
    const cost = starUpCost(entry.stars)
    if ((this.state.inventory[cost.item] ?? 0) < cost.amount) {
      this.setNotice(`需要 ${cost.amount} ${itemLabel(cost.item).name}`)
      return
    }
    this.state.inventory[cost.item] -= cost.amount
    entry.stars += 1
    this.setNotice(`${cdef.name} 突破至 ${entry.stars}★`)
    this.emit()
  }

  /**
   * 圣阶碎片兑换：30 碎片必得一名未拥有的圣阶角色。
   * 原先碎片只有掉落、没有任何消耗入口，掉了也没用。
   */
  redeemShengShard() {
    const need = SHENG_SHARD_COST
    if ((this.state.inventory.shard_sheng ?? 0) < need) { this.setNotice(`需要 ${need} 枚圣阶角色碎片`); return }
    const pool = CHARACTERS.filter(c => c.rarity === 'sheng' && !this.state.roster[c.id])
    if (pool.length === 0) { this.setNotice('圣阶角色已全部集齐'); return }
    const pick = pool[Math.floor(Math.random() * pool.length)]
    this.state.inventory.shard_sheng -= need
    this.state.roster[pick.id] = { level: 1, xp: 0, stars: 0, equip: {} }
    this.setNotice(`✨ 碎片凝聚成形！获得圣阶「${pick.name}」`)
    this.emit()
  }

  // ── 装备：背包（equipBag）与角色已穿戴（roster[id].equip）之间互相移动 ──────────
  equipItem(charId: string, itemId: string) {
    const entry = this.state.roster[charId]
    const idx = this.state.equipBag.findIndex(i => i.id === itemId)
    if (!entry || idx < 0) return
    const item = this.state.equipBag[idx]
    this.state.equipBag.splice(idx, 1)
    const prev = entry.equip[item.slot]
    if (prev) this.state.equipBag.push(prev)
    entry.equip[item.slot] = item
    this.emit()
  }

  unequipItem(charId: string, slot: EquipSlot) {
    const entry = this.state.roster[charId]
    const item = entry?.equip[slot]
    if (!entry || !item) return
    delete entry.equip[slot]
    this.state.equipBag.push(item)
    this.emit()
  }

  /** 卖掉背包里用不上的装备换灵金，避免背包被垃圾词条堆满又没有处理手段 */
  sellEquip(itemId: string) {
    const idx = this.state.equipBag.findIndex(i => i.id === itemId)
    if (idx < 0) return
    const item = this.state.equipBag[idx]
    const price = { yellow: 20, xuan: 50, di: 120, tian: 300, quasi: 700, sheng: 1800 }[item.quality]
    this.state.equipBag.splice(idx, 1)
    this.state.inventory.coin = (this.state.inventory.coin ?? 0) + price
    this.emit()
  }

  // ── 炼丹（灵药+灵金 → 指定品阶丹药，缓解突破材料瓶颈）───────────────────────
  craftPill(grade: number) {
    const pill = PILLS.find(p => p.grade === grade)
    if (!pill) return
    const cost = pillCraftCost(grade)
    if ((this.state.inventory.herb ?? 0) < cost.herb || (this.state.inventory.coin ?? 0) < cost.coin) {
      this.setNotice('灵药或灵金不足')
      return
    }
    this.state.inventory.herb -= cost.herb
    this.state.inventory.coin -= cost.coin
    this.state.inventory[pill.id] = (this.state.inventory[pill.id] ?? 0) + 1
    this.setNotice(`炼成 ${pill.icon}${pill.name} ×1`)
    this.emit()
  }
}

export const game = new GameStore()
;(window as unknown as { __game: GameStore }).__game = game

export function useGame(): GameState {
  return useSyncExternalStore(game.subscribe, game.getSnapshot)
}

export function itemLabel(id: string): { name: string; icon: string } {
  return ITEM_INFO[id] ?? { name: id, icon: '📦' }
}

/**
 * 大数缩写（万/亿/兆）。境界乘法加成引入后，后期伤害与资源会到 1e8 以上，
 * 直接显示原始数字会撑破布局也读不出量级。
 */
export function fmtNum(n: number): string {
  const v = Math.floor(n)
  if (v < 10000) return String(v)
  if (v < 1e8) return (v / 1e4).toFixed(v < 1e6 ? 1 : 0) + '万'
  if (v < 1e12) return (v / 1e8).toFixed(v < 1e10 ? 1 : 0) + '亿'
  return (v / 1e12).toFixed(1) + '兆'
}

/**
 * 综合战力：汇总当前上阵（前排+后排，最多 5 人）每个人的攻防血算出一个总分，供排行榜使用。
 * 权重（攻×1、防×2、血×0.15）按现有数值表校准过——攻击原始数值最小、防御次之、气血最大，
 * 直接相加会被气血一个数值主导，调整后三项对总分的贡献大致都在 25%~45% 区间，不会被单一维度掩盖。
 * 暴击率/暴击伤害折算进"有效攻击"，让堆暴击词条的装备也能反映到战力上。
 */
export function combatPower(state: GameState): number {
  const teamIds = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  let total = 0
  for (const id of teamIds) {
    const cdef = CHAR_MAP[id]
    const entry = state.roster[id]
    if (!cdef || !entry) continue
    const fireId = state.equippedFire && id === state.team.front[0] ? state.equippedFire : null
    const stats = charStats(entry, cdef, fireId)
    const effAtk = stats.atk * (1 + (stats.critRate / 100) * (stats.critDmg / 100))
    total += effAtk * 1 + stats.def * 2 + stats.hp * 0.15
  }
  return Math.round(total)
}

export function charLabel(id: string) {
  return CHAR_MAP[id]
}

export function rarityInfo(r: Rarity) {
  return RARITY_INFO[r]
}

/**
 * 炼丹成本：按品阶指数增长（每级 ×2），而不是原先的线性（grade*25/40）。
 *
 * 原因：丹药是唯一卡境界突破的资源，但线性成本相对灵药/灵金的挂机产出速度完全跟不上——
 * 实测最贵的 8 品丹药只需 200 灵药 + 320 灵金，20 人满编挂机 2.6 分钟就能攒够，
 * 相当于炼丹房从头到尾没起到过"资源取舍"的作用。
 * 指数曲线按 4 人初始阵容的产出速度（0.5 灵药/秒）校准，
 * 让每个品阶第一次用到的时间点大致对应：1 品 ~2 分钟 → 8 品 ~2 小时，
 * 是一次要花时间攒的真实投入，而不是顺手一点的按钮。
 */
export function pillCraftCost(grade: number): { herb: number; coin: number } {
  const herb = Math.round(60 * Math.pow(2, grade - 1))
  return { herb, coin: Math.round(herb * 1.6) }
}

// ── 卡关引导：读实际库存/进度算出具体可执行的建议，而不是空泛提示 ──────────────
export interface Guide { icon: string; text: string; tab: 'roster' | 'alchemy' | 'recruit' }

export function nextGuides(state: GameState): Guide[] {
  const out: Guide[] = []

  if (state.wipeStreak >= 2) {
    out.push({ icon: '⚠️', text: `已经连续卡在第 ${state.stage} 关 ${state.wipeStreak} 次了，该去强化队伍了`, tab: 'roster' })
  } else if (state.battle && Date.now() - state.lastProgressAt > 3 * 60 * 1000) {
    // 僵持卡关：伤害有 1 点保底、治疗又抵得住反击，于是既打不死也死不了，
    // wipeStreak 恒为 0 —— 这是后期最难受的状态，但原先完全不给任何提示
    const mins = Math.floor((Date.now() - state.lastProgressAt) / 60000)
    out.push({ icon: '🐢', text: `第 ${state.stage} 关已经磨了 ${mins} 分钟还没推进，伤害不足，去强化队伍`, tab: 'roster' })
  }

  // 有角色卡在突破口，且丹药不够
  for (const id of Object.keys(state.roster)) {
    const entry = state.roster[id]
    if (needsPillFor(entry.level) && entry.xp >= xpToNext(entry.level)) {
      const grade = pillGradeFor(entry.level)
      const have = state.inventory[`pill${grade}`] ?? 0
      if (have < 1) {
        out.push({ icon: '💊', text: `${CHAR_MAP[id]?.name ?? id} 卡在突破口，需要 ${grade} 品丹药，去丹房炼一颗`, tab: 'alchemy' })
        break
      }
    }
  }

  const crystal = state.inventory.crystal ?? 0
  if (crystal >= 150) {
    out.push({ icon: '💎', text: `攒了 ${Math.floor(crystal)} 点斗气结晶还没用，去阵容页给角色打坐修炼`, tab: 'roster' })
  }

  const yuanfen = state.inventory.yuanfen ?? 0
  if (yuanfen >= 5) {
    out.push({ icon: '🎴', text: `攒了 ${yuanfen} 颗缘分丹，去结拜抽个新武将说不定能带飞`, tab: 'recruit' })
  }

  const herb = state.inventory.herb ?? 0
  const coin = state.inventory.coin ?? 0
  if (out.every(g => g.icon !== '💊')) {
    for (const pill of PILLS) {
      const cost = pillCraftCost(pill.grade)
      if (herb >= cost.herb && coin >= cost.coin && (state.inventory[pill.id] ?? 0) < 1) {
        out.push({ icon: '🌿', text: `灵药灵金够炼一颗${pill.name}了，去丹房备着`, tab: 'alchemy' })
        break
      }
    }
  }

  return out.slice(0, 3)
}

export { CHAR_MAP }
