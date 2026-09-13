// ═══ 真实时间线模拟：含击杀收益的完整游戏循环，最优策略 ═══
const RARITY_GROWTH = {
  yellow: { atk: 8, def: 4, hp: 60, atkG: 1.2, defG: 0.6, hpG: 4 },
  xuan: { atk: 12, def: 6, hp: 85, atkG: 1.6, defG: 0.8, hpG: 5.5 },
  di: { atk: 18, def: 9, hp: 120, atkG: 2.2, defG: 1.1, hpG: 7.5 },
  tian: { atk: 26, def: 13, hp: 170, atkG: 3.0, defG: 1.5, hpG: 10 },
  quasi: { atk: 38, def: 19, hp: 240, atkG: 4.0, defG: 2.0, hpG: 14 },
  sheng: { atk: 55, def: 27, hp: 340, atkG: 5.5, defG: 2.8, hpG: 20 },
}
const ROLE_MULT = {
  melee: { atk: 1.1, def: 1.0, hp: 1.0 }, aoe: { atk: 1.0, def: 0.7, hp: 0.8 },
  single: { atk: 1.15, def: 0.7, hp: 0.75 }, heal: { atk: 0.6, def: 0.8, hp: 1.1 },
  control: { atk: 0.85, def: 0.9, hp: 0.95 },
}
function def(id, rarity, position, role) {
  const g = RARITY_GROWTH[rarity], m = ROLE_MULT[role]
  return { id, rarity, position, role,
    baseAtk: Math.round(g.atk * m.atk), baseDef: Math.round(g.def * m.def), baseHp: Math.round(g.hp * m.hp),
    atkGrowth: +(g.atkG * m.atk).toFixed(2), defGrowth: +(g.defG * m.def).toFixed(2), hpGrowth: +(g.hpG * m.hp).toFixed(2) }
}
const POOL_REAL = [
  def('yellow_disciple', 'yellow', 'front', 'melee'), def('yellow_mercenary', 'yellow', 'front', 'melee'),
  def('yellow_bandit', 'yellow', 'back', 'single'), def('yellow_hunter', 'yellow', 'back', 'single'),
  def('luoxuan', 'xuan', 'back', 'heal'), def('wuang', 'xuan', 'front', 'melee'),
  def('zhayi', 'xuan', 'back', 'single'), def('nalanyanran', 'di', 'back', 'single'),
  def('cailin', 'di', 'back', 'aoe'),
]
const SUB = 9, REALM_PILL = [1,2,3,3,4,4,5,5,6,7,7,8]
const xpToNext = lv => Math.floor(20 * Math.pow(lv, 1.9))
const needsPill = lv => lv % SUB === 0
const pillGrade = lv => REALM_PILL[Math.min(11, Math.floor((lv - 1) / SUB))]
const pillCost = g => ({ herb: g * 25, coin: g * 40 })
const isBoss = s => s % 5 === 0
function stageStats(s) { const b = isBoss(s) ? 1.6 : 1; return {
  hp: Math.max(20, Math.floor(45 * Math.pow(1.095, s) * b)),
  atk: Math.max(3, Math.floor(5 * Math.pow(1.075, s) * b)),
  def: Math.max(0, Math.floor(1 * Math.pow(1.085, s) * b)) } }
const coinReward = s => Math.floor(8 + s * 5)
const ROUND_SEC = 2
function cs(e, cd, fire) {
  const sm = 1 + e.stars * 0.08
  let atk = (cd.baseAtk + cd.atkGrowth * e.level) * sm, d = (cd.baseDef + cd.defGrowth * e.level) * sm, hp = (cd.baseHp + cd.hpGrowth * e.level) * sm
  if (fire) { atk *= 1 + (fire.atk ?? 0) / 100; d *= 1 + (fire.def ?? 0) / 100; hp *= 1 + (fire.hp ?? 0) / 100 }
  return { atk: Math.round(atk), def: Math.round(d), hp: Math.round(hp) }
}

// 主线掉落表（按关卡区间）
function zoneDrops(s) {
  if (s >= 60) return [{ i: 'pill6', c: 0.12, mn: 1, mx: 2 }]
  if (s >= 45) return [{ i: 'pill5', c: 0.15, mn: 1, mx: 2 }]
  if (s >= 32) return [{ i: 'pill4', c: 0.18, mn: 1, mx: 2 }, { i: 'fire_sanqian', c: 0.03, mn: 1, mx: 1 }]
  if (s >= 20) return [{ i: 'pill3', c: 0.2, mn: 1, mx: 2 }, { i: 'fire_yunluo', c: 0.02, mn: 1, mx: 1 }]
  if (s >= 10) return [{ i: 'pill2', c: 0.25, mn: 1, mx: 2 }]
  return [{ i: 'pill1', c: 0.3, mn: 1, mx: 2 }]
}

const state = {
  t: 0,
  roster: {}, inv: { coin: 200, crystal: 0, herb: 0, essence: 0 },
  stage: 1, highestStage: 1, fire: null,
}
const OWNED = POOL_REAL.map(c => c.id)
for (const id of OWNED) state.roster[id] = { level: 1, xp: 0, stars: 0 }
const CD = Object.fromEntries(POOL_REAL.map(c => [c.id, c]))

// 组队：前排最肉 + 输出 + 1治疗
function pickTeam() {
  const score = id => { const cd = CD[id]; return cd.baseAtk + cd.atkGrowth * state.roster[id].level }
  const heals = OWNED.filter(id => CD[id].role === 'heal')
  const rest = OWNED.filter(id => CD[id].role !== 'heal').sort((a, b) => score(b) - score(a))
  const t = []
  const f = rest.filter(id => CD[id].position === 'front')
  if (f.length) t.push(f[0])
  for (const id of rest) { if (t.length >= 4) break; if (!t.includes(id)) t.push(id) }
  if (heals.length) t.push(heals.sort((a, b) => score(b) - score(a))[0])
  return t.slice(0, 5)
}
let team = pickTeam()

function fireObj() {
  if (state.fire === 'jinglian') return { atk: 15, def: 15, hp: 15 }
  if (state.fire === 'yunluo') return { atk: 20 }
  if (state.fire === 'sanqian') return { atk: 10 }
  return null
}

// 最优消费：结晶优先喂"每点结晶换最多攻击"的角色 = atkGrowth/xpToNext(lv) 最大者
function spendCrystal() {
  let guard = 0
  while (guard++ < 100000) {
    let bestId = null, bestEff = 0
    for (const id of team) {
      const e = state.roster[id], cd = CD[id]
      const need = xpToNext(e.level) - e.xp
      if (need > state.inv.crystal) continue
      // 卡突破口且无丹 → 喂不进去
      if (needsPill(e.level)) { const g = pillGrade(e.level); if ((state.inv['pill' + g] ?? 0) < 1) continue }
      const eff = cd.atkGrowth / Math.max(1, xpToNext(e.level))
      if (eff > bestEff) { bestEff = eff; bestId = id }
    }
    if (!bestId) break
    const e = state.roster[bestId]
    const need = xpToNext(e.level) - e.xp
    state.inv.crystal -= need
    if (needsPill(e.level)) { const g = pillGrade(e.level); state.inv['pill' + g] -= 1 }
    e.level += 1; e.xp = 0
  }
  team = pickTeam()
}
// 炼丹：只炼队伍当前卡住需要的品阶
function craftNeeded() {
  for (const id of team) {
    const e = state.roster[id]
    if (!needsPill(e.level)) continue
    if (xpToNext(e.level) - e.xp > state.inv.crystal) continue
    const g = pillGrade(e.level)
    if ((state.inv['pill' + g] ?? 0) >= 1) continue
    const c = pillCost(g)
    if (state.inv.herb >= c.herb && state.inv.coin >= c.coin) {
      state.inv.herb -= c.herb; state.inv.coin -= c.coin
      state.inv['pill' + g] = (state.inv['pill' + g] ?? 0) + 1
    }
  }
}
function spendEssence() {
  for (const id of team) {
    const e = state.roster[id]
    while (e.stars < 5) { const c = (e.stars + 1) * 15; if (state.inv.essence < c) break; state.inv.essence -= c; e.stars += 1 }
  }
}

const marks = []
let hp = null, mhp = stageStats(1).hp
let lastProgressT = 0, stuckReported = false
const MAX_T = 5 * 365 * 24 * 3600 // 模拟上限 5 年

const F = () => fireObj()
function teamStats() { return team.map((id, i) => cs(state.roster[id], CD[id], i === 0 ? F() : null)) }

let S = teamStats()
hp = S.map(s => s.hp)

while (state.t < MAX_T) {
  // 一个战斗回合 = 2 秒
  state.t += ROUND_SEC
  const n = OWNED.length
  state.inv.crystal += (0.6 + n * 0.15) * ROUND_SEC
  state.inv.herb += (0.3 + n * 0.05) * ROUND_SEC

  const m = stageStats(state.stage)
  S = teamStats()
  const full = S.map(s => s.hp)
  for (let i = 0; i < hp.length; i++) if (hp[i] > full[i]) hp[i] = full[i]

  let dmg = 0
  for (let i = 0; i < team.length; i++) {
    if (hp[i] <= 0) continue
    if (CD[team[i]].role === 'heal') {
      let lo = -1, loP = 1
      for (let j = 0; j < team.length; j++) { if (hp[j] <= 0) continue; const p = hp[j] / full[j]; if (p < loP) { loP = p; lo = j } }
      if (lo >= 0) hp[lo] = Math.min(full[lo], hp[lo] + Math.round(S[i].atk * 1.5))
      continue
    }
    dmg += Math.max(1, Math.round(S[i].atk - m.def * 0.6))
  }
  mhp -= dmg

  if (mhp <= 0) {
    // onKill
    state.inv.crystal += m.hp / 20
    state.inv.coin += Math.floor(coinReward(state.stage) * (isBoss(state.stage) ? 1.5 : 1))
    for (const d of zoneDrops(state.stage)) {
      if (Math.random() > d.c) continue
      const k = d.mn + Math.floor(Math.random() * (d.mx - d.mn + 1))
      state.inv[d.i] = (state.inv[d.i] ?? 0) + k
      if (d.i === 'fire_yunluo' && state.fire !== 'jinglian') state.fire = 'yunluo'
      if (d.i === 'fire_sanqian' && !state.fire) state.fire = 'sanqian'
    }
    state.stage += 1
    if (state.stage > state.highestStage) { state.highestStage = state.stage; lastProgressT = state.t }
    mhp = stageStats(state.stage).hp
    craftNeeded(); spendCrystal(); spendEssence()
  } else {
    let tgt = -1
    for (let i = 0; i < team.length; i++) if (CD[team[i]].position === 'front' && hp[i] > 0) { tgt = i; break }
    if (tgt < 0) for (let i = 0; i < team.length; i++) if (hp[i] > 0) { tgt = i; break }
    if (tgt >= 0) hp[tgt] = Math.max(0, hp[tgt] - Math.max(0, Math.round(m.atk - S[tgt].def)))
    if (!hp.some(h => h > 0)) {
      // 团灭 → 满血重来（关卡不回退）
      craftNeeded(); spendCrystal(); spendEssence()
      S = teamStats(); hp = S.map(s => s.hp); mhp = stageStats(state.stage).hp
    }
  }

  // 记录里程碑
  const hrs = state.t / 3600
  for (const mk of [1, 6, 24, 72, 168, 336, 720, 1440, 2880, 4320, 8760, 17520, 43800]) {
    if (!marks.find(x => x.h === mk) && hrs >= mk) {
      const lv = team.map(id => state.roster[id].level)
      marks.push({ h: mk, stage: state.highestStage, lv: Math.max(...lv), lvMin: Math.min(...lv), fire: state.fire })
    }
  }
  // 卡死判定：连续 1 年无任何新关卡才算真的走不动了
  if (state.t - lastProgressT > 365 * 24 * 3600 && !stuckReported) {
    stuckReported = true
    break
  }
}

console.log('═══ 最优策略真实时间线（现实 9 角色、含击杀收益） ═══\n')
const fmt = h => h < 24 ? `${h} 小时` : `${h / 24} 天`
for (const m of marks) console.log(`  游玩 ${fmt(m.h).padEnd(8)} → 主线第 ${String(m.stage).padStart(3)} 关   队伍等级 ${m.lvMin}~${m.lv}   异火:${m.fire ?? '无'}`)
console.log(`\n  最终卡死在第 ${state.highestStage} 关`)
console.log(`  达到该关卡用时 ${(lastProgressT / 3600 / 24).toFixed1 ? (lastProgressT / 3600 / 24).toFixed(1) : (lastProgressT / 3600 / 24)} 天（此后 30 天零进展，判定为永久卡死）`)
const lvs = team.map(id => `${id}:${state.roster[id].level}级${state.roster[id].stars}★`)
console.log(`  终局队伍：${lvs.join(', ')}`)
console.log(`  终局库存：结晶 ${(state.inv.crystal / 1e6).toFixed(1)}M  灵药 ${(state.inv.herb / 1e3).toFixed(0)}K  灵金 ${(state.inv.coin / 1e3).toFixed(0)}K  精血 ${state.inv.essence}`)
