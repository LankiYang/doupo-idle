// ═══ 曲线调参：找到"境界乘法加成 + 软化怪物成长"的合适参数 ═══
const RG = { yellow:{atk:8,def:4,hp:60,atkG:1.2,defG:0.6,hpG:4}, xuan:{atk:12,def:6,hp:85,atkG:1.6,defG:0.8,hpG:5.5},
  di:{atk:18,def:9,hp:120,atkG:2.2,defG:1.1,hpG:7.5}, tian:{atk:26,def:13,hp:170,atkG:3.0,defG:1.5,hpG:10},
  quasi:{atk:38,def:19,hp:240,atkG:4.0,defG:2.0,hpG:14}, sheng:{atk:55,def:27,hp:340,atkG:5.5,defG:2.8,hpG:20} }
const RM = { melee:{atk:1.1,def:1.0,hp:1.0}, aoe:{atk:1.0,def:0.7,hp:0.8}, single:{atk:1.15,def:0.7,hp:0.75},
  heal:{atk:0.6,def:0.8,hp:1.1}, control:{atk:0.85,def:0.9,hp:0.95} }
function D(id,rar,pos,role){const g=RG[rar],m=RM[role];return{id,rarity:rar,position:pos,role,
  baseAtk:Math.round(g.atk*m.atk),baseDef:Math.round(g.def*m.def),baseHp:Math.round(g.hp*m.hp),
  atkGrowth:+(g.atkG*m.atk).toFixed(2),defGrowth:+(g.defG*m.def).toFixed(2),hpGrowth:+(g.hpG*m.hp).toFixed(2)}}
// 现实池：4 初始 + 5 抽典型结果
const POOL = [D('a','yellow','front','melee'),D('b','yellow','front','melee'),D('c','yellow','back','single'),
  D('d','yellow','back','single'),D('e','xuan','back','heal'),D('f','xuan','front','melee'),
  D('g','xuan','back','single'),D('h','di','back','single'),D('i','di','back','aoe')]
const SUB=9
const xpN=lv=>Math.floor(20*Math.pow(lv,1.9))
const realmIdx=lv=>Math.floor((lv-1)/SUB)

function mkStage(hpB,atkB,defB){return s=>{const b=s%5===0?1.6:1;return{
  hp:Math.max(20,Math.floor(45*Math.pow(hpB,s)*b)),
  atk:Math.max(3,Math.floor(5*Math.pow(atkB,s)*b)),
  def:Math.max(0,Math.floor(1*Math.pow(defB,s)*b))}}}
function cs(e,cd,realmPow){
  // ⚠️ 本脚本是 v1.7 的调参模型（RM 只有 5 种定位、没有职责维），星级系数这一行已同步 v1.28.9 口径。
  //    唯一权威是 src/game/data.ts 的 starMultOf —— 别拿本脚本的输出去论证当前平衡。
  const sm=1+e.stars*0.08+0.1*Math.floor(e.stars/10), rm=Math.pow(realmPow,realmIdx(e.level))
  return{atk:Math.round((cd.baseAtk+cd.atkGrowth*e.level)*sm*rm),
    def:Math.round((cd.baseDef+cd.defGrowth*e.level)*sm*rm),
    hp:Math.round((cd.baseHp+cd.hpGrowth*e.level)*sm*rm)}}

function team(level,stars){
  const hs=POOL.filter(c=>c.role==='heal'), rs=POOL.filter(c=>c.role!=='heal')
  const sc=cd=>cd.baseAtk+cd.atkGrowth*level
  rs.sort((a,b)=>sc(b)-sc(a))
  const t=[];const f=rs.filter(c=>c.position==='front');if(f.length)t.push(f[0])
  for(const c of rs){if(t.length>=4)break;if(!t.find(x=>x.id===c.id))t.push(c)}
  if(hs.length)t.push(hs[0])
  return t.slice(0,5).map(cd=>({cd,entry:{level,xp:0,stars}}))}

function canClear(tm,stage,SSf,realmPow){
  const m=SSf(stage), S=tm.map(t=>cs(t.entry,t.cd,realmPow))
  const full=S.map(s=>s.hp); let hp=[...full], mhp=m.hp
  for(let r=0;r<20000;r++){
    let dmg=0
    for(let i=0;i<tm.length;i++){if(hp[i]<=0)continue
      if(tm[i].cd.role==='heal'){let lo=-1,lp=1
        for(let j=0;j<tm.length;j++){if(hp[j]<=0)continue;const p=hp[j]/full[j];if(p<lp){lp=p;lo=j}}
        if(lo>=0)hp[lo]=Math.min(full[lo],hp[lo]+Math.round(S[i].atk*1.5));continue}
      dmg+=Math.max(1,Math.round(S[i].atk-m.def*0.6))}
    mhp-=dmg
    if(mhp<=0)return {ok:true,rounds:r+1}
    let tg=-1
    for(let i=0;i<tm.length;i++)if(tm[i].cd.position==='front'&&hp[i]>0){tg=i;break}
    if(tg<0)for(let i=0;i<tm.length;i++)if(hp[i]>0){tg=i;break}
    if(tg<0)return{ok:false}
    hp[tg]=Math.max(0,hp[tg]-Math.max(0,Math.round(m.atk-S[tg].def)))
    if(!hp.some(h=>h>0))return{ok:false}}
  return{ok:false,stall:true}}

// 关键指标：达到某关卡需要多少级（越平滑越好），以及"每关所需回合数"是否失控
function stageAtLevel(level,SSf,realmPow,stars=5){
  const tm=team(level,stars); let s=1
  for(;s<5000;s++){const r=canClear(tm,s,SSf,realmPow); if(!r.ok||r.rounds>900)break}
  return s-1}

const CONFIGS=[
  {name:'现状(基线)', hp:1.095,atk:1.075,def:1.085, rp:1.00},
  {name:'仅软化怪物', hp:1.070,atk:1.055,def:1.055, rp:1.00},
  {name:'境界1.15+软化', hp:1.070,atk:1.055,def:1.055, rp:1.15},
  {name:'境界1.20+软化', hp:1.070,atk:1.055,def:1.055, rp:1.20},
  {name:'境界1.25+软化', hp:1.075,atk:1.060,def:1.060, rp:1.25},
  {name:'境界1.30+原怪物', hp:1.095,atk:1.075,def:1.085, rp:1.30},
]
console.log('═══ 各配置下「等级 → 可达关卡」曲线 ═══\n')
const LVS=[9,27,54,90,108,180,270,450]
console.log('  配置'.padEnd(20)+LVS.map(l=>`Lv${l}`.padStart(7)).join(''))
for(const c of CONFIGS){
  const SSf=mkStage(c.hp,c.atk,c.def)
  const row=LVS.map(l=>String(stageAtLevel(l,SSf,c.rp)).padStart(7)).join('')
  console.log('  '+c.name.padEnd(18)+row)
}
console.log('\n  说明：Lv9=斗之气满/首次突破，Lv108=斗帝1重，Lv450=极限挂机')
console.log('  理想曲线：随等级稳定上升、不早早封顶，且高等级仍有明显增益')
