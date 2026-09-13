// ═══ 内容承载量模拟：最优策略下当前内容能支撑多久 ═══
// 严格复刻 src/game/data.ts 与 src/game/engine.ts 的生产公式

// ── 复刻 data.ts ──
const RARITY_GROWTH = {
  yellow: { atk: 8, def: 4, hp: 60, atkG: 1.2, defG: 0.6, hpG: 4 },
  xuan: { atk: 12, def: 6, hp: 85, atkG: 1.6, defG: 0.8, hpG: 5.5 },
  di: { atk: 18, def: 9, hp: 120, atkG: 2.2, defG: 1.1, hpG: 7.5 },
  tian: { atk: 26, def: 13, hp: 170, atkG: 3.0, defG: 1.5, hpG: 10 },
  quasi: { atk: 38, def: 19, hp: 240, atkG: 4.0, defG: 2.0, hpG: 14 },
  sheng: { atk: 55, def: 27, hp: 340, atkG: 5.5, defG: 2.8, hpG: 20 },
}
const ROLE_MULT = {
  melee: { atk: 1.1, def: 1.0, hp: 1.0 },
  aoe: { atk: 1.0, def: 0.7, hp: 0.8 },
  single: { atk: 1.15, def: 0.7, hp: 0.75 },
  heal: { atk: 0.6, def: 0.8, hp: 1.1 },
  control: { atk: 0.85, def: 0.9, hp: 0.95 },
}
function def(id, name, rarity, position, role) {
  const g = RARITY_GROWTH[rarity], m = ROLE_MULT[role]
  return {
    id, name, rarity, position, role,
    baseAtk: Math.round(g.atk * m.atk), baseDef: Math.round(g.def * m.def), baseHp: Math.round(g.hp * m.hp),
    atkGrowth: +(g.atkG * m.atk).toFixed(2), defGrowth: +(g.defG * m.def).toFixed(2), hpGrowth: +(g.hpG * m.hp).toFixed(2),
  }
}
const CHARACTERS = [
  def('yellow_disciple', '云岚宗杂役弟子', 'yellow', 'front', 'melee'),
  def('yellow_mercenary', '加玛帝国雇佣兵', 'yellow', 'front', 'melee'),
  def('yellow_bandit', '乌坦城马贼', 'yellow', 'back', 'single'),
  def('yellow_hunter', '魔兽山脉猎人', 'yellow', 'back', 'single'),
  def('luoxuan', '洛萱', 'xuan', 'back', 'heal'),
  def('wuang', '吴昂', 'xuan', 'front', 'melee'),
  def('hanfeng', '韩枫', 'xuan', 'front', 'melee'),
  def('zhayi', '扎伊', 'xuan', 'back', 'single'),
  def('guqingfeng', '古清风', 'xuan', 'front', 'melee'),
  def('nalanyanran', '纳兰嫣然', 'di', 'back', 'single'),
  def('guyuan', '古元', 'di', 'front', 'melee'),
  def('haibodong', '海波东', 'di', 'front', 'melee'),
  def('cailin', '彩鳞', 'di', 'back', 'aoe'),
  def('nalanjie', '纳兰杰', 'di', 'back', 'single'),
  def('xiaozhan', '萧战', 'di', 'front', 'control'),
  def('yuntianhe', '云天河', 'di', 'front', 'control'),
  def('xiaoxunr', '萧薰儿', 'tian', 'front', 'melee'),
  def('yunyun', '云韵', 'tian', 'back', 'aoe'),
  def('yaochen', '药尘', 'tian', 'back', 'heal'),
  def('linmeiniang', '小医仙', 'tian', 'back', 'heal'),
  def('tuoshe', '陀舍古猿', 'tian', 'front', 'aoe'),
  def('xiaoyan_zong', '萧炎（斗宗期）', 'quasi', 'front', 'melee'),
  def('yunshan', '云山', 'quasi', 'front', 'control'),
  def('ziyan', '紫研', 'quasi', 'back', 'aoe'),
  def('xiaoyan_di', '萧炎（斗帝终极）', 'sheng', 'front', 'melee'),
  def('yunyun_queen', '云韵（女王终极形态）', 'sheng', 'back', 'aoe'),
]
const SUB_LEVELS = 9
const REALM_PILL = [1, 2, 3, 3, 4, 4, 5, 5, 6, 7, 7, 8]
const xpToNext = lv => Math.floor(20 * Math.pow(lv, 1.9))
const needsPillFor = lv => lv % SUB_LEVELS === 0
const pillGradeFor = lv => REALM_PILL[Math.min(11, Math.floor((lv - 1) / SUB_LEVELS))]
const pillCraftCost = g => ({ herb: g * 25, coin: g * 40 })

const BOSS_STAGE_INTERVAL = 5, BOSS_STAGE_MULT = 1.6
const isBossStage = s => s % BOSS_STAGE_INTERVAL === 0
function stageStats(stage) {
  const boss = isBossStage(stage) ? BOSS_STAGE_MULT : 1
  return {
    hp: Math.max(20, Math.floor(45 * Math.pow(1.095, stage) * boss)),
    atk: Math.max(3, Math.floor(5 * Math.pow(1.075, stage) * boss)),
    def: Math.max(0, Math.floor(1 * Math.pow(1.085, stage) * boss)),
  }
}
const stageCoinReward = s => Math.floor(8 + s * 5)
const LAB_BOSS_INTERVAL = 5, LAB_BOSS_MULT = 1.6
const isLabBoss = f => f % LAB_BOSS_INTERVAL === 0
function labStats(floor) {
  const boss = isLabBoss(floor) ? LAB_BOSS_MULT : 1
  return {
    hp: Math.max(30, Math.floor(150 * Math.pow(1.16, floor) * boss)),
    atk: Math.max(5, Math.floor(8 * Math.pow(1.11, floor) * boss)),
    def: Math.max(0, Math.floor(2 * Math.pow(1.09, floor) * boss)),
  }
}
const labDaolingReward = f => { const b = Math.floor(2 + f * 0.6); return isLabBoss(f) ? b * 2 : b }

// ── 复刻 engine.ts ──
const ROUND_SEC = 2
function charStats(entry, cd, fire) {
  const lv = entry.level, sm = 1 + entry.stars * 0.08
  let atk = (cd.baseAtk + cd.atkGrowth * lv) * sm
  let d = (cd.baseDef + cd.defGrowth * lv) * sm
  let hp = (cd.baseHp + cd.hpGrowth * lv) * sm
  if (fire) { atk *= 1 + (fire.atk ?? 0) / 100; d *= 1 + (fire.def ?? 0) / 100; hp *= 1 + (fire.hp ?? 0) / 100 }
  return { atk: Math.round(atk), def: Math.round(d), hp: Math.round(hp) }
}
const crystalPerSec = n => 0.6 + n * 0.15
const herbPerSec = n => 0.3 + n * 0.05

// 异火：只有 4 种可获得（骨灵冷火=宗门商店、佛怒火莲=圣阶任务，两系统均未实现）
const FIRE_YUNLUO = { atk: 20 }          // 主线·魔兽山脉 boss 掉落
const FIRE_JINGLIAN = { atk: 15, def: 15, hp: 15 } // 天梯塔 60 层首通

/** 判定：该队伍从满血开始，能否击杀该关卡怪物（期望值，去随机） */
function canClear(team, stage, fire, statsMode) {
  const m = statsMode === 'lab' ? labStats(stage) : stageStats(stage)
  const S = team.map((t, i) => charStats(t.entry, t.cd, i === 0 ? fire : null))
  let hp = S.map(s => s.hp)
  let mhp = m.hp
  const fullHp = S.map(s => s.hp)
  for (let round = 0; round < 4000; round++) {
    let dmg = 0
    for (let i = 0; i < team.length; i++) {
      if (hp[i] <= 0) continue
      if (team[i].cd.role === 'heal') {
        let lo = -1, loPct = 1
        for (let j = 0; j < team.length; j++) { if (hp[j] <= 0) continue; const p = hp[j] / fullHp[j]; if (p < loPct) { loPct = p; lo = j } }
        if (lo >= 0) hp[lo] = Math.min(fullHp[lo], hp[lo] + Math.round(S[i].atk * 1.5))
        continue
      }
      dmg += Math.max(1, Math.round(S[i].atk - m.def * 0.6))
    }
    mhp -= dmg
    if (mhp <= 0) return { ok: true, rounds: round + 1 }
    // 怪物反击前排第一个存活者
    let tgt = -1
    for (let i = 0; i < team.length; i++) if (team[i].cd.position === 'front' && hp[i] > 0) { tgt = i; break }
    if (tgt < 0) for (let i = 0; i < team.length; i++) if (hp[i] > 0) { tgt = i; break }
    if (tgt < 0) return { ok: false }
    hp[tgt] = Math.max(0, hp[tgt] - Math.max(0, Math.round(m.atk - S[tgt].def)))
    if (!hp.some(h => h > 0)) return { ok: false }
  }
  return { ok: false, stall: true }
}

/** 给定角色池与等级/星级上限，组最优队（1 治疗 + 输出，前排放最肉的） */
function bestTeam(pool, level, stars) {
  const mk = cd => ({ cd, entry: { level, xp: 0, stars } })
  const heals = pool.filter(c => c.role === 'heal')
  const rest = pool.filter(c => c.role !== 'heal')
  const score = cd => cd.baseAtk + cd.atkGrowth * level
  rest.sort((a, b) => score(b) - score(a))
  const team = []
  const fronts = rest.filter(c => c.position === 'front')
  if (fronts.length) team.push(mk(fronts[0]))       // 前排第一位吃异火+承伤
  for (const c of rest) { if (team.length >= (heals.length ? 4 : 5)) break; if (!team.find(t => t.cd.id === c.id)) team.push(mk(c)) }
  if (heals.length) { heals.sort((a, b) => score(b) - score(a)); team.push(mk(heals[0])) }
  return team.slice(0, 5)
}

function maxStage(pool, level, stars, fire, mode = 'main') {
  const team = bestTeam(pool, level, stars)
  let s = 1
  for (; s < 2000; s++) { if (!canClear(team, s, fire, mode).ok) break }
  return { stage: s - 1, team }
}

console.log('═══ 1. 结构性结论：玩家线性 vs 怪物指数 ═══')
const eliteAll = CHARACTERS
for (const lv of [50, 100, 200, 400, 800]) {
  const r = maxStage(eliteAll, lv, 5, FIRE_JINGLIAN)
  console.log(`  全26角色 ${lv}级 5★ 净莲妖火 → 主线可达第 ${r.stage} 关`)
}

console.log('\n═══ 2. 缘分丹真实产出 = 0，实际能拥有的角色 ═══')
// 复刻 rollRarity 概率，跑 5 抽的期望结果（多次取样）
function rollRarity(rng, pity) {
  pity.c++; pity.r++
  if (pity.r >= 90) { pity.r = 0; return rng() < 0.15 ? 'sheng' : rng() < 0.4 ? 'quasi' : 'tian' }
  if (pity.c >= 30) { pity.c = 0; const r = rng(); return r < 0.05 ? 'quasi' : r < 0.25 ? 'tian' : 'di' }
  const r = rng()
  if (r < 0.005) return 'sheng'
  if (r < 0.03) return 'quasi'
  if (r < 0.12) return 'tian'
  if (r < 0.30) return 'di'
  if (r < 0.60) return 'xuan'
  return 'yellow'
}
const STARTERS = ['yellow_disciple', 'yellow_mercenary', 'yellow_bandit', 'yellow_hunter']
let totalUnique = 0, best = { n: 0 }
const TRIALS = 20000
for (let t = 0; t < TRIALS; t++) {
  const owned = new Set(STARTERS)
  const pity = { c: 0, r: 0 }
  for (let i = 0; i < 5; i++) {
    const rar = rollRarity(Math.random, pity)
    const cand = CHARACTERS.filter(c => c.rarity === rar)
    owned.add(cand[Math.floor(Math.random() * cand.length)].id)
  }
  totalUnique += owned.size
  if (owned.size > best.n) best = { n: owned.size }
}
console.log(`  初始 5 抽（且永久无法再获得缘分丹）→ 平均拥有 ${(totalUnique / TRIALS).toFixed(1)} 名角色，最好情况 ${best.n} 名`)
console.log(`  名录总数 26 名 → 实际永久无缘 ${26 - Math.round(totalUnique / TRIALS)} 名左右`)

console.log('\n═══ 3. 真实可达上限（只有 9 名角色、无缘分丹） ═══')
// 现实池：4 初始 + 5 抽（取一个中位数好运结果：拿到 1 地阶治疗以下的常见组合）
const realPoolIds = [...STARTERS, 'luoxuan', 'wuang', 'zhayi', 'nalanyanran', 'cailin']
const realPool = CHARACTERS.filter(c => realPoolIds.includes(c.id))
for (const lv of [50, 100, 200, 400]) {
  const r = maxStage(realPool, lv, 5, FIRE_YUNLUO)
  console.log(`  现实9角色 ${lv}级 5★ 陨落心炎 → 主线可达第 ${r.stage} 关`)
}

console.log('\n═══ 4. 升级成本 vs 挂机产出（时间成本） ═══')
function crystalToLevel(target) { let sum = 0; for (let lv = 1; lv < target; lv++) sum += xpToNext(lv); return sum }
function pillsNeeded(target) { const need = {}; for (let lv = 1; lv < target; lv++) if (needsPillFor(lv)) { const g = pillGradeFor(lv); need[g] = (need[g] ?? 0) + 1 } return need }
for (const lv of [50, 100, 200]) {
  const perChar = crystalToLevel(lv)
  const team5 = perChar * 5
  const cps = crystalPerSec(9)
  const hrs = team5 / cps / 3600
  const need = pillsNeeded(lv)
  let herb = 0, coin = 0
  for (const [g, n] of Object.entries(need)) { const c = pillCraftCost(+g); herb += c.herb * n; coin += c.coin * n }
  const herbHrs = herb * 5 / herbPerSec(9) / 3600
  console.log(`  5人全部练到 ${lv} 级：需斗气结晶 ${(team5 / 1e6).toFixed(2)}M → 纯挂机 ${hrs.toFixed(0)} 小时（${(hrs / 24).toFixed(1)} 天）`)
  console.log(`     突破丹药需灵药 ${(herb * 5 / 1000).toFixed(1)}K → 挂机 ${herbHrs.toFixed(0)} 小时；灵金 ${(coin * 5 / 1000).toFixed(1)}K`)
}

console.log('\n═══ 5. 天梯塔上限 ═══')
for (const lv of [100, 200, 400]) {
  const r1 = maxStage(realPool, lv, 5, FIRE_YUNLUO, 'lab')
  const r2 = maxStage(eliteAll, lv, 5, FIRE_JINGLIAN, 'lab')
  console.log(`  ${lv}级 5★ → 塔层上限：现实9角色 ${r1.stage} 层 / 全26角色 ${r2.stage} 层（祝福未计入，约可再+15%）`)
}
console.log(`  注：塔层美术只做到第 4 梯队（60 层起），60 层以上外观不再变化`)
console.log(`  注：塔奖励(论道令)仅能买 1/3/5 品丹药与精血，${'高阶丹药(6-8品)无法从塔获得'}`)

console.log('\n═══ 6. 死档道具 ═══')
console.log('  缘分丹：初始 5 颗，无任何产出来源 → 抽卡系统一次性')
console.log('  玄晶：ITEM_INFO 里有定义，无产出、无消耗 → 完全死档')
console.log('  圣阶角色碎片：中州 1% 掉落，但无任何消耗入口 → 掉了也没用')
console.log('  骨灵冷火/佛怒火莲：标注来源为宗门商店/圣阶任务，两系统均未实现 → 永久无法获得')
console.log('  武魂精血：可从塔商店买，但升星上限 5★（满星仅需 225/角色）→ 很快溢出无用')
