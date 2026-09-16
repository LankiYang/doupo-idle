// ═══ 给境界加成设上限，找不雪崩又有纵深的参数 ═══
const { execSync } = require('child_process')
const fs = require('fs')
let src = fs.readFileSync(__dirname + '/sim-full.cjs', 'utf8')

const CONFIGS = [
  { name: '加成1.3 上限斗帝(11)', pow: 1.3, cap: 11 },
  { name: '加成1.3 上限9', pow: 1.3, cap: 9 },
  { name: '加成1.25 上限11', pow: 1.25, cap: 11 },
  { name: '加成1.2 上限15', pow: 1.2, cap: 15 },
  { name: '加成1.15 上限20', pow: 1.15, cap: 20 },
]
for (const c of CONFIGS) {
  const patched = src
    .replace(/const REALM_POWER=[\d.]+/, `const REALM_POWER=${c.pow}`)
    .replace(/const realmMult=lv=>Math\.pow\(REALM_POWER,Math\.floor\(\(lv-1\)\/SUB\)\)/,
      `const realmMult=lv=>Math.pow(REALM_POWER,Math.min(${c.cap},Math.floor((lv-1)/SUB)))`)
    .replace(/for\(let i=0;i<5;i\+\+\) runs\.push\(trial\(365\)\)/, 'for(let i=0;i<4;i++) runs.push(trial(365))')
  fs.writeFileSync(__dirname + '/_tmp_sim.cjs', patched)
  const out = execSync('node ' + __dirname + '/_tmp_sim.cjs', { encoding: 'utf8', maxBuffer: 1e8 })
  const lines = out.split('\n')
  const get = t => { const l = lines.find(x => x.trim().startsWith(t)); return l ? l.trim() : '' }
  const finals = lines.filter(l => l.includes('主线第')).slice(-5, -1)
  const stages = finals.map(l => +(l.match(/主线第(\d+)关/)?.[1] ?? 0))
  const chars = finals.map(l => +(l.match(/角色 (\d+)\/54/)?.[1] ?? 0))
  const mn = Math.min(...stages), mx = Math.max(...stages)
  console.log(`\n── ${c.name} (上限 ×${Math.pow(c.pow, c.cap).toFixed(1)}) ──`)
  console.log(`   1天:${get('1天')}`)
  console.log(`   7天:${get('7天')}`)
  console.log(`   365天:${get('365天')}`)
  console.log(`   1年终局关卡分布: ${stages.join(' / ')}  → 极差 ${mx - mn}倍差=${(mx / Math.max(1, mn)).toFixed(1)}x`)
  console.log(`   角色收集: ${chars.join(' / ')} /54`)
}
fs.unlinkSync(__dirname + '/_tmp_sim.cjs')
