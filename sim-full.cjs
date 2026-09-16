// ═══ 完整最优策略模拟：主线 + 天梯塔 + 全部消费系统，多次取样 ═══
const RG = { yellow:{atk:8,def:4,hp:60,atkG:1.2,defG:0.6,hpG:4}, xuan:{atk:12,def:6,hp:85,atkG:1.6,defG:0.8,hpG:5.5},
  di:{atk:18,def:9,hp:120,atkG:2.2,defG:1.1,hpG:7.5}, tian:{atk:26,def:13,hp:170,atkG:3.0,defG:1.5,hpG:10},
  quasi:{atk:38,def:19,hp:240,atkG:4.0,defG:2.0,hpG:14}, sheng:{atk:55,def:27,hp:340,atkG:5.5,defG:2.8,hpG:20} }
const RM = { melee:{atk:1.1,def:1.0,hp:1.0}, aoe:{atk:1.0,def:0.7,hp:0.8}, single:{atk:1.15,def:0.7,hp:0.75},
  heal:{atk:0.6,def:0.8,hp:1.1}, control:{atk:0.85,def:0.9,hp:0.95} }
function D(id,rar,pos,role){const g=RG[rar],m=RM[role];return{id,rarity:rar,position:pos,role,
  baseAtk:Math.round(g.atk*m.atk),baseDef:Math.round(g.def*m.def),baseHp:Math.round(g.hp*m.hp),
  atkGrowth:+(g.atkG*m.atk).toFixed(2),defGrowth:+(g.defG*m.def).toFixed(2),hpGrowth:+(g.hpG*m.hp).toFixed(2)}}
const ALL = [
  D('yellow_disciple','yellow','front','melee'),D('yellow_mercenary','yellow','front','melee'),
  D('yellow_bandit','yellow','back','single'),D('yellow_hunter','yellow','back','single'),
  D('luoxuan','xuan','back','heal'),D('wuang','xuan','front','melee'),D('hanfeng','xuan','front','melee'),
  D('zhayi','xuan','back','single'),D('guqingfeng','xuan','front','melee'),
  D('nalanyanran','di','back','single'),D('guyuan','di','front','melee'),D('haibodong','di','front','melee'),
  D('cailin','di','back','aoe'),D('nalanjie','di','back','single'),D('xiaozhan','di','front','control'),
  D('yuntianhe','di','front','control'),
  D('xiaoxunr','tian','front','melee'),D('yunyun','tian','back','aoe'),D('yaochen','tian','back','heal'),
  D('linmeiniang','tian','back','heal'),D('tuoshe','tian','front','aoe'),
  D('xiaoyan_zong','quasi','front','melee'),D('yunshan','quasi','front','control'),D('ziyan','quasi','back','aoe'),
  D('xiaoyan_di','sheng','front','melee'),D('yunyun_queen','sheng','back','aoe') ]
const CDM = Object.fromEntries(ALL.map(c=>[c.id,c]))
const SUB=9, RP=[1,2,3,3,4,4,5,5,6,7,7,8]
const xpN=lv=>Math.floor(20*Math.pow(lv,1.9))
const needP=lv=>lv%SUB===0
const pG=lv=>RP[Math.min(11,Math.floor((lv-1)/SUB))]
const pC=g=>({herb:g*25,coin:g*40})
const isB=s=>s%5===0
const SS=s=>{const b=isB(s)?1.6:1;return{hp:Math.max(20,Math.floor(45*Math.pow(1.095,s)*b)),
  atk:Math.max(3,Math.floor(5*Math.pow(1.075,s)*b)),def:Math.max(0,Math.floor(1*Math.pow(1.085,s)*b))}}
const LS=f=>{const b=isB(f)?1.6:1;return{hp:Math.max(30,Math.floor(150*Math.pow(1.16,f)*b)),
  atk:Math.max(5,Math.floor(8*Math.pow(1.11,f)*b)),def:Math.max(0,Math.floor(2*Math.pow(1.09,f)*b))}}
const dao=f=>{const b=Math.floor(2+f*0.6);return isB(f)?b*2:b}
const coinR=s=>Math.floor(8+s*5)
const R=2
const REALM_POWER=1.3
const realmMult=lv=>Math.pow(REALM_POWER,Math.floor((lv-1)/SUB))
function cs(e,cd,fire){const sm=1+e.stars*0.08, rm=realmMult(e.level)
  let a=(cd.baseAtk+cd.atkGrowth*e.level)*sm*rm,d=(cd.baseDef+cd.defGrowth*e.level)*sm*rm,h=(cd.baseHp+cd.hpGrowth*e.level)*sm*rm
  if(fire){a*=1+(fire.atk??0)/100;d*=1+(fire.def??0)/100;h*=1+(fire.hp??0)/100}
  return{atk:Math.round(a),def:Math.round(d),hp:Math.round(h)}}
function zD(s){ if(s>=60)return[{i:'pill6',c:0.12,mn:1,mx:2},{i:'xuanjing',c:0.12,mn:1,mx:2},{i:'shard',c:0.01,mn:1,mx:1}]
  if(s>=45)return[{i:'pill5',c:0.15,mn:1,mx:2},{i:'xuanjing',c:0.06,mn:1,mx:1}]
  if(s>=32)return[{i:'pill4',c:0.18,mn:1,mx:2}]
  if(s>=20)return[{i:'pill3',c:0.2,mn:1,mx:2}]
  if(s>=10)return[{i:'pill2',c:0.25,mn:1,mx:2}]; return[{i:'pill1',c:0.3,mn:1,mx:2}] }
// 异火：里程碑首通必得
const FIRE_STAGE={10:{atk:10},25:{atk:20},50:{def:20},100:{atk:35}}
const FIRE_FLOOR={20:{hp:25},40:{atk:15,def:15,hp:15}}
const MAX_STARS=10, STAR_ESS_CAP=5
const starCost=s=>{const n=s+1; return n<=STAR_ESS_CAP?{item:'essence',amt:n*15}:{item:'xuanjing',amt:(n-STAR_ESS_CAP)*8}}
// 角色碎片（v1.25）：**只有准圣/圣阶**重复转碎片（低阶仍退武魂精血），碎片按品阶固定价
// 兑换**未拥有**角色。两张表都要与 src/game/data.ts 的 DUPE_SHARD / SHARD_COST 一致。
// 兑换价 ÷ 转化量恒为 6（圣 60÷10、准圣 30÷5）——同一个品阶要重复抽到 6 次才够换 1 个新的。
const DUPE_SHARD={quasi:5,sheng:10}
const ESSENCE_BY_RARITY={yellow:5,xuan:10,di:20,tian:35,quasi:60,sheng:100}
const SHARD_COST={yellow:2,xuan:4,di:8,tian:16,quasi:30,sheng:60}
const ORD={yellow:0,xuan:1,di:2,tian:3,quasi:4,sheng:5}
const BLESS=[{atkPct:15},{defPct:20},{hpPct:25},{lifesteal:10},{atkPct:10},{pierce:20},{dodge:10},{daolingPct:50},{coinPct:50},{crystalPct:30}]

// 三层保底（v1.21.5 起）：天 10 / 准圣 30 / 圣 60，与 engine.rollRarity 同口径。
// 这里原本是 90/30 的两层老口径，从 v1.21.5 起就没同步过——模拟脚本口径漂了，
// 跑出来的抽卡产出就是错的，据此调数值等于拿错尺子量。
function rollRar(p){p.t++;p.q++;p.s++
  let rar
  if(p.s>=60)rar='sheng'
  else if(p.q>=30)rar='quasi'
  else if(p.t>=10)rar=Math.random()<0.1?'quasi':'tian'
  else{const r=Math.random()
    rar=r<0.005?'sheng':r<0.03?'quasi':r<0.12?'tian':r<0.30?'di':r<0.60?'xuan':'yellow'}
  if(ORD[rar]>=ORD.sheng)p.s=0
  if(ORD[rar]>=ORD.quasi)p.q=0
  if(ORD[rar]>=ORD.tian)p.t=0
  return rar}

function trial(horizonDays){
  const st={t:0,roster:{},inv:{coin:200,crystal:0,herb:0,essence:0,daoling:0,shard:0},stage:1,hiStage:1,fire:null,
    labFloor:1,labHi:0,labBless:[],labActive:true}
  const owned=new Set(['yellow_disciple','yellow_mercenary','yellow_bandit','yellow_hunter'])
  const pity={t:0,q:0,s:0}
  for(let i=0;i<5;i++){const rar=rollRar(pity);const c=ALL.filter(x=>x.rarity===rar);owned.add(c[Math.floor(Math.random()*c.length)].id)}
  for(const id of owned) st.roster[id]={level:1,xp:0,stars:0}
  const OW=[...owned]
  // 最优策略：装备当前拥有的最强异火（按攻击加成排序）
  st.fireObj=null
  const fireO=()=>st.fireObj
  const sc=id=>CDM[id].baseAtk+CDM[id].atkGrowth*st.roster[id].level
  function pick(){const hs=OW.filter(id=>CDM[id].role==='heal')
    const rs=OW.filter(id=>CDM[id].role!=='heal').sort((a,b)=>sc(b)-sc(a))
    const t=[];const f=rs.filter(id=>CDM[id].position==='front');if(f.length)t.push(f[0])
    for(const id of rs){if(t.length>=(hs.length?4:5))break;if(!t.includes(id))t.push(id)}
    if(hs.length)t.push(hs.sort((a,b)=>sc(b)-sc(a))[0]); return t.slice(0,5)}
  let team=pick()
  const bt=()=>{const o={atkPct:0,defPct:0,hpPct:0,pierce:0,dodge:0,lifesteal:0,coinPct:0,daolingPct:0,crystalPct:0}
    for(const b of st.labBless)for(const k in b)o[k]=(o[k]??0)+b[k]; return o}
  function craft(){for(const id of team){const e=st.roster[id];if(!needP(e.level))continue
    if(xpN(e.level)-e.xp>st.inv.crystal)continue
    const g=pG(e.level);if((st.inv['pill'+g]??0)>=1)continue
    const c=pC(g);if(st.inv.herb>=c.herb&&st.inv.coin>=c.coin){st.inv.herb-=c.herb;st.inv.coin-=c.coin;st.inv['pill'+g]=(st.inv['pill'+g]??0)+1}}}
  function buyLab(){ // 最优：优先升星（1~5★精血、6~10★玄晶），再买丹药
    for(const id of team){const e=st.roster[id]
      while(e.stars<MAX_STARS){const c=starCost(e.stars)
        if((st.inv[c.item]??0)>=c.amt){st.inv[c.item]-=c.amt;e.stars+=1;continue}
        if(c.item==='essence'&&st.inv.daoling>=10){st.inv.daoling-=10;st.inv.essence+=20;continue}
        break}}
    for(const g of [5,3,1]){while(st.inv.daoling>=g*15){st.inv.daoling-=g*15;st.inv['pill'+g]=(st.inv['pill'+g]??0)+1}}
    // 角色碎片兑换：从高品阶往下扫，凑够就换一名尚未拥有的（模拟玩家的自然偏好：越高阶越想要）。
    // 换完立刻重排阵容——新角色可能比在场的高战，换而不上等于没换。
    for(const q of ['sheng','quasi','tian','di','xuan','yellow']){
      while((st.inv.shard??0)>=SHARD_COST[q]){
        const pool=ALL.filter(c=>c.rarity===q&&!st.roster[c.id])
        if(!pool.length)break
        st.inv.shard-=SHARD_COST[q]
        const p=pool[Math.floor(Math.random()*pool.length)]
        st.roster[p.id]={level:1,xp:0,stars:0}; OW.push(p.id); team=pick()}}
    // 缘分丹抽卡：攒到 10 颗就十连
    while((st.inv.yuanfen??0)>=10){st.inv.yuanfen-=10
      for(let i=0;i<10;i++){const rar=rollRar(pity)
        const cand=ALL.filter(x=>x.rarity===rar); const p=cand[Math.floor(Math.random()*cand.length)]
        if(!st.roster[p.id]){st.roster[p.id]={level:1,xp:0,stars:0};OW.push(p.id)}
        else if(DUPE_SHARD[rar])st.inv.shard+=DUPE_SHARD[rar]
        else st.inv.essence+=ESSENCE_BY_RARITY[rar]}
      team=pick()}}
  function spend(){let gd=0
    while(gd++<200000){let bi=null,be=0
      for(const id of team){const e=st.roster[id],cd=CDM[id]
        if(xpN(e.level)-e.xp>st.inv.crystal)continue
        if(needP(e.level)){const g=pG(e.level);if((st.inv['pill'+g]??0)<1)continue}
        const ef=cd.atkGrowth/Math.max(1,xpN(e.level));if(ef>be){be=ef;bi=id}}
      if(!bi)break
      const e=st.roster[bi];st.inv.crystal-=xpN(e.level)-e.xp
      if(needP(e.level)){const g=pG(e.level);st.inv['pill'+g]-=1}
      e.level+=1;e.xp=0}
    team=pick()}

  const TS=()=>team.map((id,i)=>cs(st.roster[id],CDM[id],i===0?fireO():null))
  let S=TS(),hp=S.map(s=>s.hp),mhp=SS(1).hp
  // 塔：独立战斗，独立血量
  let lS=TS(),lhp=lS.map(s=>s.hp),lmhp=LS(1).hp
  let lastProg=0
  const MT=horizonDays*24*3600
  const marks=[]
  while(st.t<MT){
    st.t+=R
    const n=OW.length
    st.inv.crystal+=(0.6+n*0.15)*R; st.inv.herb+=(0.3+n*0.05)*R

    // ── 主线一回合 ──
    {const m=SS(st.stage);S=TS();const full=S.map(s=>s.hp)
     for(let i=0;i<hp.length;i++)if(hp[i]>full[i])hp[i]=full[i]
     let dmg=0
     for(let i=0;i<team.length;i++){if(hp[i]<=0)continue
       if(CDM[team[i]].role==='heal'){let lo=-1,lp=1
         for(let j=0;j<team.length;j++){if(hp[j]<=0)continue;const p=hp[j]/full[j];if(p<lp){lp=p;lo=j}}
         if(lo>=0)hp[lo]=Math.min(full[lo],hp[lo]+Math.round(S[i].atk*1.5));continue}
       dmg+=Math.max(1,Math.round(S[i].atk-m.def*0.6))}
     mhp-=dmg
     if(mhp<=0){st.inv.crystal+=m.hp/20
       st.inv.coin+=Math.floor(coinR(st.stage)*(isB(st.stage)?1.5:1))
       for(const d of zD(st.stage)){if(Math.random()>d.c)continue
         const k=d.mn+Math.floor(Math.random()*(d.mx-d.mn+1));st.inv[d.i]=(st.inv[d.i]??0)+k}
       const firstClear=st.stage>=st.hiStage
       if(firstClear){
         if(isB(st.stage))st.inv.yuanfen=(st.inv.yuanfen??0)+1+(st.stage%25===0?2:0)
         const f=FIRE_STAGE[st.stage]; if(f)st.fireObj=f}
       st.stage+=1; if(st.stage>st.hiStage){st.hiStage=st.stage;lastProg=st.t}
       mhp=SS(st.stage).hp; craft();buyLab();spend()
     }else{let tg=-1
       for(let i=0;i<team.length;i++)if(CDM[team[i]].position==='front'&&hp[i]>0){tg=i;break}
       if(tg<0)for(let i=0;i<team.length;i++)if(hp[i]>0){tg=i;break}
       if(tg>=0)hp[tg]=Math.max(0,hp[tg]-Math.max(0,Math.round(m.atk-S[tg].def)))
       if(!hp.some(h=>h>0)){craft();spend();S=TS();hp=S.map(s=>s.hp);mhp=SS(st.stage).hp}}}

    // ── 天梯塔一回合（并行推进）──
    if(st.labActive){const B=bt(),m=LS(st.labFloor)
      lS=team.map((id,i)=>{const b=cs(st.roster[id],CDM[id],i===0?fireO():null)
        return{atk:Math.round(b.atk*(1+B.atkPct/100)),def:Math.round(b.def*(1+B.defPct/100)),hp:Math.round(b.hp*(1+B.hpPct/100))}})
      const lf=lS.map(s=>s.hp)
      for(let i=0;i<lhp.length;i++)if(lhp[i]>lf[i])lhp[i]=lf[i]
      let dmg=0
      for(let i=0;i<team.length;i++){if(lhp[i]<=0)continue
        if(CDM[team[i]].role==='heal'){let lo=-1,lp=1
          for(let j=0;j<team.length;j++){if(lhp[j]<=0)continue;const p=lhp[j]/lf[j];if(p<lp){lp=p;lo=j}}
          if(lo>=0)lhp[lo]=Math.min(lf[lo],lhp[lo]+Math.round(lS[i].atk*1.5));continue}
        const pr=Math.min(0.9,B.pierce/100)
        const d=Math.max(1,Math.round(lS[i].atk-m.def*0.6*(1-pr)));dmg+=d
        if(B.lifesteal>0)lhp[i]=Math.min(lf[i],lhp[i]+Math.round(d*B.lifesteal/100))}
      lmhp-=dmg
      if(lmhp<=0){
        st.inv.crystal+=(m.hp/25)*(1+B.crystalPct/100)
        st.inv.coin+=Math.floor(10*(1+B.coinPct/100))
        if(st.labFloor>st.labHi){st.labHi=st.labFloor
          st.inv.daoling+=Math.floor(dao(st.labFloor)*(1+B.daolingPct/100))
          if(isB(st.labFloor))st.inv.yuanfen=(st.inv.yuanfen??0)+1
          const f=FIRE_FLOOR[st.labFloor]
          if(f&&(!st.fireObj||(f.atk??0)+(f.def??0)+(f.hp??0)>(st.fireObj.atk??0)+(st.fireObj.def??0)+(st.fireObj.hp??0)))st.fireObj=f}
        if(isB(st.labFloor)&&st.labBless.length<12){ // 首领三选一：最优取最强攻击/生存
          const pool=BLESS.filter(b=>!st.labBless.includes(b))
          if(pool.length)st.labBless.push(pool[Math.floor(Math.random()*Math.min(3,pool.length))])}
        st.labFloor+=1; lmhp=LS(st.labFloor).hp; buyLab();craft();spend()
      }else{if(!(B.dodge>0&&Math.random()<B.dodge/100)){
          let tg=-1
          for(let i=0;i<team.length;i++)if(CDM[team[i]].position==='front'&&lhp[i]>0){tg=i;break}
          if(tg<0)for(let i=0;i<team.length;i++)if(lhp[i]>0){tg=i;break}
          if(tg>=0)lhp[tg]=Math.max(0,lhp[tg]-Math.max(0,Math.round(m.atk-lS[tg].def)))}
        if(!lhp.some(h=>h>0)){ // 塔战败 → 祝福清空从 1 层重来
          st.labBless=[];st.labFloor=1;lmhp=LS(1).hp;lS=TS();lhp=lS.map(s=>s.hp);buyLab()}}}

    // 真实玩家随时可在阵容/丹房页消费，不必等击杀事件（每 60 秒结算一次主动管理）
    if(st.t%60===0){craft();buyLab();spend()}

    const hrs=st.t/3600
    for(const mk of [1,6,24,72,168,720,2160,4320,8760]){
      if(!marks.find(x=>x.h===mk)&&hrs>=mk){
        marks.push({h:mk,stage:st.hiStage,labHi:st.labHi,lv:Math.max(...team.map(id=>st.roster[id].level)),
          stars:Math.max(...team.map(id=>st.roster[id].stars)),chars:OW.length})}}
  }
  return {st,marks,team,lastProg,owned:OW.length}
}

console.log('═══ 完整最优策略（主线+天梯塔并行刷，1 年周期），5 次取样 ═══\n')
const runs=[]
for(let i=0;i<5;i++) runs.push(trial(365))
const fmtH=h=>h<24?`${h}时`:`${h/24}天`
const HS=[1,6,24,72,168,720,2160,4320,8760]
console.log('  时间      主线关卡      塔层        最高等级     最高星级    拥有角色')
for(const h of HS){
  const rs=runs.map(r=>r.marks.find(m=>m.h===h)).filter(Boolean)
  if(!rs.length)continue
  const avg=k=>(rs.reduce((a,b)=>a+b[k],0)/rs.length).toFixed(0)
  console.log(`  ${fmtH(h).padEnd(8)}  第 ${avg('stage').padStart(3)} 关     ${avg('labHi').padStart(3)} 层     ${avg('lv').padStart(4)} 级      ${avg('stars').padStart(2)} ★      ${avg('chars').padStart(2)} / 54`)
}
console.log('\n  ── 1 年后终局 ──')
for(const [i,r] of runs.entries()){
  const st=r.st
  console.log(`  第${i+1}次：角色 ${Object.keys(st.roster).length}/54  主线第${st.hiStage}关  塔${st.labHi}层  ` +
    `等级${Math.max(...r.team.map(id=>st.roster[id].level))}  星级${Math.max(...r.team.map(id=>st.roster[id].stars))}★  ` +
    `异火${st.fireObj?'有':'无'}  玄晶${Math.floor(st.inv.xuanjing??0)}  碎片${Math.floor(st.inv.shard??0)}`)
}
const avgStage=(runs.reduce((a,r)=>a+r.st.hiStage,0)/runs.length).toFixed(0)
const avgLab=(runs.reduce((a,r)=>a+r.st.labHi,0)/runs.length).toFixed(0)
console.log(`\n  平均终局：主线第 ${avgStage} 关 / 天梯塔 ${avgLab} 层`)
console.log(`  最后一次关卡推进发生在第 ${(runs.reduce((a,r)=>a+r.lastProg,0)/runs.length/86400).toFixed(0)} 天`)
