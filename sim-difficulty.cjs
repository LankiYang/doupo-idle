// ⚠️ 已过时（v1.28 起）——本脚本模拟的是**单怪物**时代的战斗，结论不再适用于当前版本。
//
// 它的 stageStats / charStats 是从 data.ts / engine.ts **手抄**的副本，不是 import。
// 手抄的副本迟早和引擎发散，v1.28 把一关从"一只血包"改成"1~6 个各有职责的敌人"，
// 就是最新的例子：这里仍按"一个怪物、我方全员集火"结算，因此它给出的难度曲线
// （零操作能打到第几关）在 v1.28 已明显偏离实际，不能拿来做平衡决策。
//
// 要评估当前版本的难度，请用 temp/compare-v127-v128.cjs：它直接驱动**真实构建产物**，
// 用同一套阵容在改版前后两个版本上各扫一遍"最低可胜等级"，结论不依赖任何复刻公式。
// 本文件仅作历史参考保留。
//
// 原始用途：难度曲线模拟——零操作能打到第几关；把沿途资源全砸进升级后又能打到第几关

const REALMS_GRADE = [1,2,3,3,4,4,5,5,6,7,7,8] // 12 个大境界的丹药品阶
const SUB = 9

function xpToNext(level) { return Math.floor(20 * Math.pow(level, 1.9)) }
function needsPillFor(level) { return level % SUB === 0 }
function pillGradeFor(level) {
  const realmIdx = Math.min(REALMS_GRADE.length - 1, Math.floor((level - 1) / SUB))
  return REALMS_GRADE[realmIdx]
}

function stageStats(stage) {
  const boss = stage % 5 === 0 ? 1.6 : 1
  return {
    hp: Math.max(20, Math.floor(45 * Math.pow(1.095, stage) * boss)),
    atk: Math.max(3, Math.floor(5 * Math.pow(1.075, stage) * boss)),
    def: Math.max(0, Math.floor(1 * Math.pow(1.085, stage) * boss)),
  }
}
function stageCoinReward(stage) { return Math.floor(8 + stage * 5) }

// 起始 4 名黄阶角色
const CHARS = [
  { id: 'disciple', baseAtk: 9, baseDef: 4, baseHp: 60, atkG: 1.32, defG: 0.60, hpG: 4.00, front: true },
  { id: 'mercenary', baseAtk: 9, baseDef: 4, baseHp: 60, atkG: 1.32, defG: 0.60, hpG: 4.00, front: true },
  { id: 'bandit', baseAtk: 9, baseDef: 3, baseHp: 45, atkG: 1.38, defG: 0.42, hpG: 3.00, front: false },
  { id: 'hunter', baseAtk: 9, baseDef: 3, baseHp: 45, atkG: 1.38, defG: 0.42, hpG: 3.00, front: false },
]

function charStats(c, level) {
  return {
    atk: Math.round(c.baseAtk + c.atkG * level),
    def: Math.round(c.baseDef + c.defG * level),
    hp: Math.round(c.baseHp + c.hpG * level),
  }
}

// 用平均伤害（不带随机波动）模拟一整场战斗：满血开打，能否在我方团灭前打死怪物
function simulateFight(levels, stage) {
  const mon = stageStats(stage)
  const stats = CHARS.map(c => charStats(c, levels[c.id]))
  const hp = stats.map(s => s.hp)
  let monsterHp = mon.hp
  const order = [0, 1, 2, 3] // disciple, mercenary(front), bandit, hunter(back) — front 优先受击
  let rounds = 0
  while (monsterHp > 0) {
    rounds++
    if (rounds > 500) return { win: false, hpLeft: hp, rounds } // 保底防止死循环
    // 我方总伤害
    let totalDmg = 0
    for (let i = 0; i < 4; i++) {
      if (hp[i] <= 0) continue
      totalDmg += Math.max(1, Math.round(stats[i].atk - mon.def * 0.6))
    }
    monsterHp -= totalDmg
    if (monsterHp <= 0) break
    // 怪物反击：前排优先（0,1 为前排）
    let targetIdx = [0, 1, 2, 3].find(i => hp[i] > 0)
    if (targetIdx === undefined) return { win: false, hpLeft: hp, rounds }
    const dmg = Math.max(0, Math.round(mon.atk - stats[targetIdx].def))
    hp[targetIdx] -= dmg
    if (hp.every(h => h <= 0)) return { win: false, hpLeft: hp, rounds }
  }
  return { win: true, hpLeft: hp, rounds }
}

// ── Phase A：零操作，角色永远 1 级，找出"满血单场也打不过"的硬上限 ──
const level1 = { disciple: 1, mercenary: 1, bandit: 1, hunter: 1 }
let hardCapA = 1
for (let s = 1; s <= 500; s++) {
  const r = simulateFight(level1, s)
  if (!r.win) { hardCapA = s - 1; break }
  hardCapA = s
}
console.log(`【零操作】1 级团队满血单场极限：第 ${hardCapA} 关（第 ${hardCapA + 1} 关满血也打不过）`)

// ── 顺带算一下：不吃丹药突破，纯 1 级团队，真实"连续挂机不回血"下大概卡在哪 ──
function simulateStreakFromLevel1() {
  const stats = CHARS.map(c => charStats(c, 1))
  const hp = stats.map(s => s.hp)
  let stage = 1
  while (true) {
    const mon = stageStats(stage)
    let monsterHp = mon.hp
    let rounds = 0
    while (monsterHp > 0) {
      rounds++
      if (rounds > 500) return stage - 1
      let totalDmg = 0
      for (let i = 0; i < 4; i++) { if (hp[i] > 0) totalDmg += Math.max(1, Math.round(stats[i].atk - mon.def * 0.6)) }
      monsterHp -= totalDmg
      if (monsterHp <= 0) break
      let targetIdx = [0, 1, 2, 3].find(i => hp[i] > 0)
      if (targetIdx === undefined) return stage - 1
      hp[targetIdx] -= Math.max(0, Math.round(mon.atk - stats[targetIdx].def))
      if (hp.every(h => h <= 0)) return stage - 1
    }
    stage++
    if (stage > 500) return 500
  }
}
const streakCap = simulateStreakFromLevel1()
console.log(`【零操作·连续不回血】1 级团队一口气挂机（不重开）能连续推到第 ${streakCap} 关（此后被逐渐磨死，重开满血也回到同一面墙）`)

// ── Phase A 资源统计：从 1 关清到 hardCapA 关，沿途累计多少资源 ──
// 简化：假设每关都一次通过（不计重试损耗），只统计击杀掉落 + 时间到 hardCapA 关所需的估计时长内的被动产出
let totalCoin = 200, totalCrystalFromKill = 0
for (let s = 1; s <= hardCapA; s++) {
  totalCoin += Math.floor(stageCoinReward(s) * (s % 5 === 0 ? 1.5 : 1))
  totalCrystalFromKill += stageStats(s).hp / 20
}
console.log(`\n打到第 ${hardCapA} 关，纯击杀掉落累计：灵金 ${Math.floor(totalCoin)}，斗气结晶(战斗产出部分) ${Math.floor(totalCrystalFromKill)}`)

// ── Phase B：把资源全砸进升级，看能推到第几关 ──
// 简化的"全力升级"策略：把可用结晶均分给 4 名角色练级，用灵药+灵金按需炼丹突破
// 假设离线/挂机总时长按打到 hardCapA 关花費的时间来估算被动产出（用回合数近似時間）
function estimateTimeToStage(cap) {
  // 每关战斗回合数 × 2 秒/回合，粗略估算总耗时（秒）
  let totalRounds = 0
  const stats = CHARS.map(c => charStats(c, 1))
  for (let s = 1; s <= cap; s++) {
    const mon = stageStats(s)
    let monsterHp = mon.hp, rounds = 0
    while (monsterHp > 0 && rounds < 500) {
      rounds++
      let totalDmg = 0
      for (let i = 0; i < 4; i++) totalDmg += Math.max(1, Math.round(stats[i].atk - mon.def * 0.6))
      monsterHp -= totalDmg
    }
    totalRounds += rounds
  }
  return totalRounds * 2 // 秒
}
const timeSec = estimateTimeToStage(hardCapA)
const crystalPerSec = 0.6 + 4 * 0.15 // 4 名角色在花名册中
const herbPerSec = 0.3 + 4 * 0.05
const passiveCrystal = crystalPerSec * timeSec
const passiveHerb = herbPerSec * timeSec

console.log(`预估打到第 ${hardCapA} 关耗时约 ${(timeSec/60).toFixed(1)} 分钟，期间被动产出斗气结晶 ${Math.floor(passiveCrystal)}，灵药 ${Math.floor(passiveHerb)}`)

const totalCrystal = passiveCrystal + totalCrystalFromKill
let totalHerb = passiveHerb
let coin = totalCoin

// 均分结晶练级，需要突破时优先用灵药+灵金炼丹（炼丹成本 herb=grade*25, coin=grade*40）
const levels = { disciple: 1, mercenary: 1, bandit: 1, hunter: 1 }
const xp = { disciple: 0, mercenary: 0, bandit: 0, hunter: 0 }
let crystalPool = totalCrystal
const order2 = ['disciple', 'mercenary', 'bandit', 'hunter']
let spentAnything = true
while (spentAnything) {
  spentAnything = false
  for (const id of order2) {
    if (crystalPool < 10) break
    const give = Math.min(50, crystalPool)
    xp[id] += give
    crystalPool -= give
    spentAnything = true
    while (xp[id] >= xpToNext(levels[id])) {
      const need = xpToNext(levels[id])
      if (needsPillFor(levels[id])) {
        const grade = pillGradeFor(levels[id])
        const herbCost = grade * 25, coinCost = grade * 40
        if (totalHerb >= herbCost && coin >= coinCost) {
          totalHerb -= herbCost; coin -= coinCost
        } else {
          xp[id] = need // 卡住，等下一轮结晶/灵药
          break
        }
      }
      xp[id] -= need
      levels[id] += 1
    }
  }
  if (crystalPool < 10) break
}

console.log(`\n资源砸满后角色等级：`, levels, `剩余灵药 ${Math.floor(totalHerb)}，剩余灵金 ${Math.floor(coin)}，剩余结晶 ${Math.floor(crystalPool)}`)

let hardCapB = hardCapA
for (let s = hardCapA; s <= 500; s++) {
  const r = simulateFight(levels, s)
  if (!r.win) { hardCapB = s - 1; break }
  hardCapB = s
}
console.log(`【满级升级后】满血单场极限：第 ${hardCapB} 关`)
