// ═══ 装备数值校准：满装/空装战力差距，掉落节奏是否合理 ═══
const RARITIES = ['yellow', 'xuan', 'di', 'tian', 'quasi', 'sheng']
const EQUIP_QUALITY = {
  yellow: { statMult: 0.8, extraAffixCount: 0 },
  xuan: { statMult: 1.0, extraAffixCount: 1 },
  di: { statMult: 1.3, extraAffixCount: 1 },
  tian: { statMult: 1.7, extraAffixCount: 2 },
  quasi: { statMult: 2.2, extraAffixCount: 2 },
  sheng: { statMult: 3.0, extraAffixCount: 3 },
}
const EQUIP_QUALITY_WEIGHT = { yellow: 40, xuan: 30, di: 16, tian: 9, quasi: 4, sheng: 1 }
const AFFIX_RANGE = {
  atkPct: { base: 1.5, span: 2.5 }, defPct: { base: 1.5, span: 2.5 }, hpPct: { base: 1.5, span: 2.5 },
  critRate: { base: 0.8, span: 1.5 }, critDmg: { base: 3, span: 6 },
}
const AFFIX_TYPES = ['atkPct', 'defPct', 'hpPct', 'critRate', 'critDmg']
const SLOT_INNATE = { weapon: 'atkPct', armor: 'defPct', accessory: 'hpPct', ring: 'critRate' }
const SLOTS = ['weapon', 'armor', 'accessory', 'ring']

function rollAffix(type, statMult) {
  const roll = Math.random(), r = AFFIX_RANGE[type]
  return { type, value: +((r.base + roll * r.span) * statMult).toFixed(1) }
}
function rollEquip(slot, quality) {
  const q = EQUIP_QUALITY[quality]
  const innate = rollAffix(SLOT_INNATE[slot], q.statMult)
  const extra = []
  for (let i = 0; i < q.extraAffixCount; i++) extra.push(rollAffix(AFFIX_TYPES[Math.floor(Math.random() * 5)], q.statMult))
  return { slot, quality, innate, extra }
}
function rollQuality() {
  const total = Object.values(EQUIP_QUALITY_WEIGHT).reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (const rar of RARITIES) { r -= EQUIP_QUALITY_WEIGHT[rar]; if (r <= 0) return rar }
  return 'yellow'
}

console.log('═══ 1. 单件装备的平均总词条值（品阶递进是否有梯度感） ═══')
for (const rar of RARITIES) {
  const N = 20000
  let sum = { atkPct: 0, defPct: 0, hpPct: 0, critRate: 0, critDmg: 0 }
  for (let i = 0; i < N; i++) {
    const it = rollEquip('weapon', rar)
    sum[it.innate.type] += it.innate.value
    for (const e of it.extra) sum[e.type] += e.value
  }
  const total = Object.values(sum).reduce((a, b) => a + b, 0) / N
  console.log(`  ${rar.padEnd(6)} 平均总词条值(单件武器) ≈ ${total.toFixed(1)}%`)
}

console.log('\n═══ 2. 假定「全身同一品阶」时，四件套的总加成（vs 现有异火/境界基准） ═══')
console.log('  参照：单个异火加成约 10~35%（且只作用于前排第一位）；REALM_POWER 每级境界 ×1.2，封顶 ×15.4')
for (const rar of RARITIES) {
  const N = 5000
  let totals = { atkPct: [], defPct: [], hpPct: [], critRate: [], critDmg: [] }
  for (let i = 0; i < N; i++) {
    const sum = { atkPct: 0, defPct: 0, hpPct: 0, critRate: 0, critDmg: 0 }
    for (const slot of SLOTS) {
      const it = rollEquip(slot, rar)
      sum[it.innate.type] += it.innate.value
      for (const e of it.extra) sum[e.type] += e.value
    }
    for (const k in sum) totals[k].push(sum[k])
  }
  const avg = k => (totals[k].reduce((a, b) => a + b, 0) / N).toFixed(1)
  console.log(`  ${rar.padEnd(6)} 四件套均值 → 攻击+${avg('atkPct')}% 防御+${avg('defPct')}% 气血+${avg('hpPct')}% 暴击率+${avg('critRate')}% 暴击伤害+${avg('critDmg')}%`)
}

console.log('\n═══ 3. 掉落节奏：刷到一件「全身四件同品阶」大约要多少件装备 ═══')
// 简化：假设玩家只在乎凑齐 4 个槽位×目标品阶以上，不管具体词条
function expectedDropsForQuality(targetIdx) {
  // 单次掉落 >= targetIdx 品阶的概率
  const total = Object.values(EQUIP_QUALITY_WEIGHT).reduce((a, b) => a + b, 0)
  const pAtLeast = RARITIES.slice(targetIdx).reduce((a, r) => a + EQUIP_QUALITY_WEIGHT[r], 0) / total
  return { pAtLeast, expectedForOneSlot: 1 / pAtLeast }
}
for (let i = 0; i < RARITIES.length; i++) {
  const { pAtLeast, expectedForOneSlot } = expectedDropsForQuality(i)
  console.log(`  品阶 >= ${RARITIES[i].padEnd(6)} 单次掉落概率 ${(pAtLeast * 100).toFixed(1)}%  期望 ${expectedForOneSlot.toFixed(1)} 件掉落出 1 件该品阶以上`)
}

console.log('\n═══ 4. 结论用数据（供人工判断是否需要调整） ═══')
console.log('  若 sheng 四件套总加成超过 100%/项，且掉落率对应的现实获取速度过快，说明数值偏大，需要调低 statMult 或调低掉落权重')
