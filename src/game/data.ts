// ─── 静态数据：境界、角色、地图、丹药、异火 ──────────────────────────────────

export type Rarity = 'yellow' | 'xuan' | 'di' | 'tian' | 'quasi' | 'sheng'
export type Role = 'melee' | 'aoe' | 'single' | 'heal' | 'control' | 'tank' | 'heal_aoe'
export type Position = 'front' | 'back'

/**
 * 职责（v1.28）：把 7 种「攻击方式」归到 3 个「职责」上。
 *
 * 为什么要拆成两维：玩家要的其实是两件正交的事 ——
 *   ① 「战斗 / 坦克 / 医师」是**职责**，决定属性倾向（坦克血厚）
 *   ② 「群攻还是单体」「群回还是单回」是**作用范围**，决定打几个目标
 * 塞进同一个字段会打架：「群攻的坦克」「单体的医师」都该存在，单维度表达不了。
 * 所以 role 仍然承载"怎么打"，额外用这张表派生职责，UI 标注与规则判断都读它。
 */
export type Duty = 'tank' | 'warrior' | 'healer'

export const RARITY_INFO: Record<Rarity, { label: string; color: string; order: number }> = {
  yellow: { label: '黄阶', color: '#c9c2b4', order: 0 },
  xuan: { label: '玄阶', color: '#4ade80', order: 1 },
  di: { label: '地阶', color: '#60a5fa', order: 2 },
  tian: { label: '天阶', color: '#c084fc', order: 3 },
  quasi: { label: '准圣阶', color: '#fb923c', order: 4 },
  sheng: { label: '圣阶', color: '#f87171', order: 5 },
}

const RARITY_GROWTH: Record<Rarity, { atk: number; def: number; hp: number; atkG: number; defG: number; hpG: number }> = {
  yellow: { atk: 8, def: 4, hp: 60, atkG: 1.2, defG: 0.6, hpG: 4 },
  xuan: { atk: 12, def: 6, hp: 85, atkG: 1.6, defG: 0.8, hpG: 5.5 },
  di: { atk: 18, def: 9, hp: 120, atkG: 2.2, defG: 1.1, hpG: 7.5 },
  tian: { atk: 26, def: 13, hp: 170, atkG: 3.0, defG: 1.5, hpG: 10 },
  quasi: { atk: 38, def: 19, hp: 240, atkG: 4.0, defG: 2.0, hpG: 14 },
  sheng: { atk: 55, def: 27, hp: 340, atkG: 5.5, defG: 2.8, hpG: 20 },
}

const ROLE_MULT: Record<Role, { atk: number; def: number; hp: number }> = {
  // 坦克（v1.28）：用一半输出换一倍耐久。存活倍率 ≈ hp倍率 × (战士承伤 ÷ 坦克承伤)，
  // 按中后期怪物 atk 100 / 我方基础 def 20 估算：(100-20*0.6)/(100-32*0.6) = 88/80.8，
  // 再乘 hp 1.9 ⇒ 约 2.07 倍；前期怪物 atk 低时减伤占比更高，约 2.2 倍。
  tank: { atk: 0.7, def: 1.6, hp: 1.9 },
  melee: { atk: 1.1, def: 1.0, hp: 1.0 },
  aoe: { atk: 1.0, def: 0.7, hp: 0.8 },
  single: { atk: 1.15, def: 0.7, hp: 0.75 },
  heal: { atk: 0.6, def: 0.8, hp: 1.1 },
  heal_aoe: { atk: 0.55, def: 0.75, hp: 1.05 },
  // 控制（v1.28.7）：面板**低于近战**是有代价补偿的——命中后给目标挂攻/防双减益（见 engine 的
  // CONTROL_DEBUFF）。减益的价值随"目标活得久、打得疼"上升，所以它前期比近战弱、越到后期越值。
  // ⚠️ 别在没看懂换来的机制之前顺手把它调平到 melee 的 1.1/1.0/1.0——那就是白送一层 buff。
  control: { atk: 0.85, def: 0.9, hp: 0.95 },
}

export const ROLE_LABEL: Record<Role, string> = {
  tank: '坦克',
  melee: '近战输出',
  aoe: '群体法术',
  single: '单体法术',
  heal: '治疗辅助',
  heal_aoe: '群体治疗',
  control: '控制减益',
}

/** 职责映射：7 种攻击方式 → 3 个职责。UI 标注职业、规则判断（如"谁算治疗"）都读这张表 */
export const DUTY_OF_ROLE: Record<Role, Duty> = {
  tank: 'tank',
  melee: 'warrior', aoe: 'warrior', single: 'warrior', control: 'warrior',
  heal: 'healer', heal_aoe: 'healer',
}

export const DUTY_LABEL: Record<Duty, string> = {
  tank: '坦克',
  warrior: '战斗',
  healer: '医师',
}

export const DUTY_COLOR: Record<Duty, string> = {
  tank: '#60a5fa',
  warrior: '#f87171',
  healer: '#4ade80',
}

/** 攻击方式配色：战斗演出里按角色/怪物的招式类型给伤害数字/特效上色，区分打法手感 */
export const ROLE_COLOR: Record<Role, string> = {
  tank: '#93c5fd',
  melee: '#ffd27a',
  single: '#a78bfa',
  aoe: '#ff8a3d',
  control: '#9ca3af',
  heal: '#4ade80',
  heal_aoe: '#86efac',
}

/**
 * 各定位的「打法」一句话说明——直接回答玩家布阵时最想问的："我带上他，他会去打谁？"
 *
 * 目标规则全部藏在引擎里，玩家看不到就只能靠试。把规则写在阵容页上，
 * "要不要带坦克""群攻到底亏不亏"才成为可以预先判断的决策，而不是玄学。
 *
 * ️ 这七句话**必须与 `pickTargets` / `pickFighters` 的实际行为逐字对得上**：
 * 规则一改，这里就是最先过期的地方（v1.28.7 取消 control 越前排时，`control` 那句就作废了）。
 * 除了"打谁"，**出手后的效果**（如 control 的压制）也得写进来，否则玩家只能看到伤害数字，
 * 看不出这个角色跟近战有何区别 —— 那这套说明就白写了。
 */
export const ROLE_TARGET_HINT: Record<Role, string> = {
  tank: '顶在前排扛伤 · 打敌方前排',
  melee: '打敌方前排，稳定拆墙',
  single: '打敌方前排中血最少的（补刀减员）',
  aoe: '打敌方前排全部，但单个目标伤害只有单体的一半多',
  control: '打敌方前排最靠前的一个（不能越过前排），命中后压制它：攻 -20%、防御 -25%',
  heal: '治疗我方血线最低的队员',
  heal_aoe: '治疗我方全体，但每人回复量约为单体的一半',
}

export interface CharacterDef {
  id: string
  name: string
  rarity: Rarity
  position: Position
  role: Role
  desc: string
  baseAtk: number
  baseDef: number
  baseHp: number
  atkGrowth: number
  defGrowth: number
  hpGrowth: number
}

function def(id: string, name: string, rarity: Rarity, position: Position, role: Role, desc: string): CharacterDef {
  const g = RARITY_GROWTH[rarity]
  const m = ROLE_MULT[role]
  return {
    id, name, rarity, position, role, desc,
    baseAtk: Math.round(g.atk * m.atk),
    baseDef: Math.round(g.def * m.def),
    baseHp: Math.round(g.hp * m.hp),
    atkGrowth: +(g.atkG * m.atk).toFixed(2),
    defGrowth: +(g.defG * m.def).toFixed(2),
    hpGrowth: +(g.hpG * m.hp).toFixed(2),
  }
}

// ── 坦克名单（v1.28）──────────────────────────────────────────────────────────
// 选取原则：① 人设是「横练 / 守关 / 挡在前面」的，不是「主角 / 族长 / 法术」；
// ② **每一阶都要有**，否则玩家到了高关卡却只有低阶坦克（属性差 5 倍就是废的）；
// ③ 总数控制在 8 个（54 名的 15%）—— 坦克输出只有战士的 64%，太多会拖慢挂机，
//    玩家自己会算出「最多带 1-2 个」，给多了等于白占角色位。
// 准圣阶**刻意没有坦克**：加若琳（v1.28.6 由玄阶升入）后是 8 个，定位是
// 「群体法术 / 控制 / 群体治疗」，混一个坦克进去会破坏这个品阶的调性；
// 玩家的坦克需求由 黄→玄→地→天→圣 这条连续线覆盖。
// 坦克一律 position='front'（推荐站位，见 Position 字段的重新定义）。
// ─ 群体治疗（heal_aoe）─────────────────────────────────────────────────────
// 单体奶 vs 群奶是玩家明确要的区分：群奶每目标只回 0.55×atk，但**回全体**，
// 在 5-6 人队里总治疗量是单体奶的 2.5-3 倍；代价是单点救急能力弱（奶不动残血的那个）。
//   · 药尘（天阶）—— 炼药宗师，群奶的中期主力
//   · 若琳（准圣阶，v1.28.6 由玄阶升入）—— 迦南学院导师，「亦通战阵」，后期群奶
// 其余 5 名医师保持单体奶（救急定位）。
// ️ 知情项：若琳上移后**玄阶与地阶都没有群奶**了 —— 玩家在抽到药尘（天阶）之前
// 只有单体奶；而她本人现在是准圣阶，等于「后期才有群奶」。若琳当初的定位正是
// 「早期就能让玩家体验到群奶」，这一升阶把这个体验点让了出去（待用户决定是否补人）。

export const CHARACTERS: CharacterDef[] = [
  def('yellow_disciple', '云岚宗杂役弟子', 'yellow', 'front', 'melee', '宗门底层弟子，胜在人数众多'),
  def('yellow_mercenary', '加玛帝国雇佣兵', 'yellow', 'front', 'melee', '刀口舔血的江湖游侠'),
  def('yellow_bandit', '乌坦城马贼', 'yellow', 'back', 'single', '沙漠边城的流寇'),
  def('yellow_hunter', '魔兽山脉猎人', 'yellow', 'back', 'single', '常年游走于魔兽山脉的猎户'),
  def('luoxuan', '洛萱', 'xuan', 'back', 'heal', '乌坦城主之女，性情温婉'),
  def('wuang', '吴昂', 'xuan', 'front', 'melee', '乌坦城年轻一代好手'),
  def('hanfeng', '韩枫', 'xuan', 'front', 'melee', '加玛帝国三皇子，心机深沉'),
  def('zhayi', '扎伊', 'xuan', 'back', 'single', '精通毒术的游方术士'),
  def('nalanyanran', '纳兰嫣然', 'di', 'back', 'single', '云岚宗天才少女，冰雪聪明'),
  def('guyuan', '古元', 'di', 'front', 'melee', '性烈如火的年轻高手'),
  def('haibodong', '海波东', 'di', 'front', 'melee', '黑角域成名高手'),
  def('cailin', '彩鳞', 'di', 'back', 'aoe', '蛇人族美杜莎女王，冷艳高傲，一怒则赤地千里'),
  def('xiaoxunr', '萧薰儿', 'tian', 'front', 'melee', '天火之体，萧炎的青梅竹马'),
  def('yunyun', '云韵', 'tian', 'back', 'aoe', '云岚宗宗主，风之极·陨杀，清冷如霜雪'),
  def('yaochen', '药尘', 'tian', 'back', 'heal_aoe', '炼药宗师，人称药老——一炉丹药可护全队'),
  def('linmeiniang', '小医仙', 'tian', 'back', 'heal', '医毒双绝的谷主'),
  def('xiaoyan_zong', '萧炎（斗宗期）', 'quasi', 'front', 'melee', '历经磨砺，已然一方豪雄'),
  def('yunshan', '云山', 'quasi', 'front', 'control', '前云岚宗宗主，城府极深'),
  def('xiaoyan_di', '萧炎（斗帝终极）', 'sheng', 'front', 'melee', '一代斗帝，威震大陆'),
  def('yunyun_queen', '云韵（宗主终极形态）', 'sheng', 'back', 'aoe', '云岚宗宗主之极，风之极陨杀贯穿九霄'),
  def('guqingfeng', '古清风', 'xuan', 'front', 'melee', '乌坦城城主，古元之父，刀法沉稳'),
  def('nalanjie', '纳兰杰', 'di', 'back', 'single', '纳兰嫣然之兄，云岚宗大长老，秘术阴狠'),
  def('xiaozhan', '萧战', 'di', 'front', 'control', '加玛帝国大长老，萧炎之父，统兵布阵手段老辣'),
  def('yuntianhe', '云天河', 'di', 'front', 'control', '加玛帝国太子，心机深沉，惯于以局制敌'),
  def('ziyan', '紫研', 'quasi', 'back', 'aoe', '太虚古龙一族的小龙皇，娇蛮任性却天赋绝伦'),
  def('tuoshe', '陀舍古猿', 'tian', 'front', 'aoe', '上古妖猿血脉，一声咆哮震裂山河'),

  // ─ v1.27 角色扩充：26 → 54（黄+5 玄+5 地+6 天+4 准圣+4 圣+4）─────────
  // 属性一律由 def() 按 RARITY_GROWTH × ROLE_MULT 算出，同品阶同定位的数值完全一致，
  // 所以"加角色"不需要任何数值调参——这里只有 id / 名字 / 描述是新的。
  def('hundi', '魂天帝', 'sheng', 'front', 'control', '魂族族长，万年布局，只为一句话："我即天命"'),
  def('zhukun', '烛坤', 'sheng', 'front', 'tank', '古龙族龙皇，一拳裂空，龙威压尽万古'),
  def('xiaoxunr_di', '萧薰儿（斗帝终极形态）', 'sheng', 'front', 'melee', '天火之体彻底绽放，与萧炎并肩立于大陆之巅'),
  def('ziyan_long', '紫研（龙皇终极形态）', 'sheng', 'back', 'aoe', '太虚古龙龙皇之姿，龙威所至，万兽臣服'),
  def('tianhuo', '天火尊者', 'quasi', 'back', 'aoe', '陨落心炎之主，终其一生只炼一道火'),
  def('fengxian', '风闲', 'quasi', 'front', 'control', '风尊者，出手无形——敌未动，而势已失'),
  def('xuwu', '虚无吞炎', 'quasi', 'back', 'aoe', '异火榜第二，无质无形，可吞尽万物'),
  def('fengqingr', '凤清儿', 'quasi', 'front', 'melee', '凤凰族族长，涅槃之火焚身，亦焚敌'),
  def('yafei', '雅妃', 'tian', 'back', 'heal', '米特尔家族大小姐，一手调息、一手掌局'),
  def('jiaxingtian', '加刑天', 'tian', 'front', 'melee', '加玛帝国皇帝，御驾亲征时无人敢挡其锋'),
  def('fama', '法犸', 'tian', 'back', 'aoe', '炼药师公会会长，一炉丹药可抵千军'),
  def('nalansu', '纳兰肃', 'tian', 'front', 'tank', '纳兰嫣然之父，云岚宗宿将，枪势沉如山岳'),
  def('qinglin', '青鳞', 'di', 'front', 'melee', '蛇人族少女，碧蛇三花瞳下，万物皆可为仆'),
  def('xiaoyu', '萧玉', 'di', 'back', 'single', '萧炎表姐，迦南学院执法队，出手从不迟疑'),
  def('xiaoding', '萧鼎', 'di', 'back', 'heal', '萧炎二哥，沉稳持重，护族如护己身'),
  def('linxiuya', '林修崖', 'di', 'front', 'tank', '迦南学院首席，斗技繁复如崖上烟云——攻守俱是首席'),
  def('guyao', '古夭', 'di', 'back', 'aoe', '古族天才少女，古帝血脉的觉醒者'),
  def('liuling', '柳翎', 'di', 'back', 'aoe', '迦南学院阵法天才，举手即可成阵'),
  def('ruolin', '若琳', 'quasi', 'back', 'heal_aoe', '迦南学院导师，医者仁心，亦通战阵——出手便是护住全场'),
  def('xiaomei', '萧媚', 'xuan', 'back', 'single', '萧家堂妹，性子刁蛮，箭术却极准'),
  def('wuhao', '吴昊', 'xuan', 'front', 'tank', '迦南学院学员，一身横练，筋骨折不断'),
  def('yunling', '云凌', 'xuan', 'back', 'aoe', '云岚宗内门弟子，雷法初成'),
  def('tieyan', '铁岩', 'xuan', 'front', 'tank', '加玛帝国边军统领，守关十年未退一步'),
  def('yunlan_guard', '云岚宗外门弟子', 'yellow', 'front', 'tank', '刚入宗门，还只会最基础的斗技'),
  def('jiama_soldier', '加玛帝国城卫军', 'yellow', 'front', 'tank', '守城经年，刀柄上磨出的老茧'),
  def('moshou_trapper', '魔兽山脉捕兽人', 'yellow', 'back', 'single', '布陷阱的手艺，比斗气更可靠'),
  def('desert_escort', '沙漠商队护卫', 'yellow', 'front', 'tank', '随驼队走遍大漠，见惯了刀光——护卫的本分是站在货前面'),
  def('hanyue', '寒月', 'yellow', 'back', 'heal', '游方医师，一囊草药可救半条命'),
]

export const ROLE_INFO = ROLE_LABEL

// ── 境界体系 ──────────────────────────────────────────────────────────────
export interface RealmDef { id: string; name: string; order: number; pillGrade: number }

export const REALMS: RealmDef[] = [
  { id: 'qi', name: '斗之气', order: 0, pillGrade: 1 },
  { id: 'zhe', name: '斗者', order: 1, pillGrade: 2 },
  { id: 'shi', name: '斗师', order: 2, pillGrade: 3 },
  { id: 'dashi', name: '大斗师', order: 3, pillGrade: 3 },
  { id: 'ling', name: '斗灵', order: 4, pillGrade: 4 },
  { id: 'wang', name: '斗王', order: 5, pillGrade: 4 },
  { id: 'huang', name: '斗皇', order: 6, pillGrade: 5 },
  { id: 'zong', name: '斗宗', order: 7, pillGrade: 5 },
  { id: 'zun', name: '斗尊', order: 8, pillGrade: 6 },
  { id: 'bansheng', name: '半圣', order: 9, pillGrade: 7 },
  { id: 'sheng', name: '斗圣', order: 10, pillGrade: 7 },
  { id: 'di', name: '斗帝', order: 11, pillGrade: 8 },
]

export const SUB_LEVELS = 9

/**
 * 境界乘法加成：每突破一个大境界，全属性 ×1.2，最多叠加 15 层（封顶 ×15.4）。
 * 存在理由：角色属性随等级是线性增长，而怪物强度随关卡是指数增长（1.095^stage），
 * 纯线性永远追不上指数——不加这一层，理论上限只有 99 关。
 *
 * 参数选择依据（sim-cap.cjs 跑了 5 组×4 次取样对比）：不设上限的版本（如 ×1.3 无封顶）
 * 会让"击杀收益(随关卡指数增长) > 升级成本(等级的多项式增长)"这个反馈环失控，
 * 抽卡运气稍好就雪崩式起飞，1 年后终局关卡在不同存档间能差出 10~100 倍。
 * ×1.2 封顶 15 层是几组参数里终局差距最小的（同期取样仅 1.3 倍差），
 * 对随机性最不敏感——不会出现"手气差就被锁死在低关卡"的情况。
 */
export const REALM_POWER = 1.2
export const REALM_POWER_CAP_INDEX = 15

export function realmIndexOf(level: number): number {
  return Math.floor((level - 1) / SUB_LEVELS)
}

export function realmMult(level: number): number {
  return Math.pow(REALM_POWER, Math.min(REALM_POWER_CAP_INDEX, realmIndexOf(level)))
}

export function levelToRealm(level: number): { realm: RealmDef; sub: number } {
  const cappedIdx = Math.min(REALMS.length - 1, Math.floor((level - 1) / SUB_LEVELS))
  const realm = REALMS[cappedIdx]
  if (cappedIdx === REALMS.length - 1) {
    const sub = level - cappedIdx * SUB_LEVELS
    return { realm, sub }
  }
  const sub = ((level - 1) % SUB_LEVELS) + 1
  return { realm, sub }
}

export function realmLabel(level: number): string {
  const { realm, sub } = levelToRealm(level)
  if (realm.id === 'di') return `${realm.name} ${sub} 重`
  return `${realm.name} ${sub} 段`
}

/** 段位小突破所需经验（斗气结晶） */
export function xpToNext(level: number): number {
  return Math.floor(20 * Math.pow(level, 1.9))
}

/** 升到 level+1 是否跨大境界边界，需要消耗丹药 */
export function needsPillFor(level: number): boolean {
  return level % SUB_LEVELS === 0
}

/** 跨境界所需丹药品阶 = 当前所在境界的品阶（用高一品的丹药突破到下一大境界） */
export function pillGradeFor(level: number): number {
  const { realm } = levelToRealm(level)
  return realm.pillGrade
}

// ── 丹药 ──────────────────────────────────────────────────────────────────
export interface PillDef { grade: number; id: string; name: string; icon: string }
export const PILLS: PillDef[] = [
  { grade: 1, id: 'pill1', name: '一品培元丹', icon: '💊' },
  { grade: 2, id: 'pill2', name: '二品聚气丹', icon: '💊' },
  { grade: 3, id: 'pill3', name: '三品玄灵丹', icon: '💊' },
  { grade: 4, id: 'pill4', name: '四品星辰丹', icon: '💊' },
  { grade: 5, id: 'pill5', name: '五品天元丹', icon: '💊' },
  { grade: 6, id: 'pill6', name: '六品陨落丹', icon: '💊' },
  { grade: 7, id: 'pill7', name: '七品半圣丹', icon: '💊' },
  { grade: 8, id: 'pill8', name: '八品帝纹丹', icon: '💊' },
]

// ── 异火 ──────────────────────────────────────────────────────────────────
export interface FireDef {
  id: string; name: string; icon: string; desc: string
  atkPct?: number; defPct?: number; hpPct?: number
  source: string
  /** 解锁条件：主线关卡首通 */
  stageReq?: number
  /** 解锁条件：天梯塔层首通 */
  floorReq?: number
}
/**
 * 异火全部改为「里程碑首通必得」。
 * 原设计里三千焱炎火/陨落心炎是 2~3% 的窄窗口掉落（实测多数存档一把都拿不到），
 * 骨灵冷火挂在未实现的宗门商店、佛怒火莲挂在未实现的圣阶任务（永久不可得），
 * 净莲妖火要求 60 层但实测上限不到 50 层 —— 6 种异火实际只能拿到 1 种。
 */
export const FIRES: FireDef[] = [
  { id: 'sanqian', name: '三千焱炎火', icon: '🔥', desc: '攻击 +10%', atkPct: 10, source: '主线第 10 关首通', stageReq: 10 },
  { id: 'yunluo', name: '陨落心炎', icon: '🔥', desc: '攻击 +20%', atkPct: 20, source: '主线第 25 关首通', stageReq: 25 },
  { id: 'gling', name: '骨灵冷火', icon: '🔥', desc: '防御 +20%', defPct: 20, source: '主线第 50 关首通', stageReq: 50 },
  { id: 'fonu', name: '佛怒火莲', icon: '🔥', desc: '攻击 +35%', atkPct: 35, source: '主线第 100 关首通', stageReq: 100 },
  { id: 'gulong', name: '古龙精血炎', icon: '🔥', desc: '气血上限 +25%', hpPct: 25, source: '天梯塔 20 层首通', floorReq: 20 },
  { id: 'jinglian', name: '净莲妖火', icon: '🔥', desc: '全属性 +15%', atkPct: 15, defPct: 15, hpPct: 15, source: '天梯塔 40 层首通', floorReq: 40 },
]

// ── 地图 ──────────────────────────────────────────────────────────────────
export type AtkStyle = 'melee' | 'ranged' | 'magic'
export interface MonsterDef { id: string; name: string; hp: number; atk: number; def: number; tier?: 'boss'; atkStyle?: AtkStyle }
export interface DropDef { item: string; chance: number; min: number; max: number }
export interface MapDef {
  id: string; name: string; levelReq: number
  monsters: MonsterDef[]
  drops: DropDef[]
}

/** 攻击方式配色：怪物反击的伤害数字按招式类型上色（近战暖红/远程青蓝/法术紫） */
export const ATK_STYLE_COLOR: Record<AtkStyle, string> = {
  melee: '#ff6a6a',
  ranged: '#5fd4ff',
  magic: '#c77dff',
}

export const MAPS: MapDef[] = [
  {
    id: 'wutan', name: '乌坦城', levelReq: 1,
    monsters: [
      { id: 'guard', name: '城卫兵', hp: 60, atk: 6, def: 1, atkStyle: 'melee' },
      { id: 'thug', name: '黑市打手', hp: 65, atk: 7, def: 1, atkStyle: 'melee' },
      { id: 'mystic', name: '城中术士', hp: 55, atk: 8, def: 0, atkStyle: 'magic' },
      { id: 'bandit_lord', name: '马贼头目', hp: 130, atk: 11, def: 3, tier: 'boss', atkStyle: 'melee' },
    ],
    drops: [{ item: 'coin', chance: 1, min: 10, max: 30 }],
  },
  {
    id: 'jama', name: '加玛帝国', levelReq: 10,
    monsters: [
      { id: 'royal_guard', name: '禁军', hp: 260, atk: 18, def: 6, atkStyle: 'melee' },
      { id: 'spy', name: '皇城密探', hp: 220, atk: 22, def: 4, atkStyle: 'ranged' },
      { id: 'alchemy_guard', name: '炼药塔守卫', hp: 280, atk: 17, def: 8, atkStyle: 'magic' },
      { id: 'prince_guard', name: '三皇子亲卫', hp: 480, atk: 26, def: 9, tier: 'boss', atkStyle: 'melee' },
    ],
    drops: [{ item: 'coin', chance: 1, min: 25, max: 60 }],
  },
  {
    id: 'beast', name: '魔兽山脉', levelReq: 20,
    monsters: [
      { id: 'beast', name: '妖兽', hp: 620, atk: 38, def: 14, atkStyle: 'melee' },
      { id: 'python_spirit', name: '巨蟒精', hp: 560, atk: 42, def: 10, atkStyle: 'ranged' },
      { id: 'rock_rhino', name: '岩甲犀', hp: 780, atk: 34, def: 22, atkStyle: 'melee' },
      { id: 'beast_king', name: '魔兽王', hp: 1100, atk: 55, def: 20, tier: 'boss', atkStyle: 'melee' },
    ],
    drops: [{ item: 'coin', chance: 1, min: 45, max: 100 }, { item: 'fire_yunluo', chance: 0.02, min: 1, max: 1 }],
  },
  {
    id: 'yunlan', name: '云岚宗', levelReq: 32,
    monsters: [
      { id: 'disciple', name: '宗门弟子', hp: 1700, atk: 78, def: 32, atkStyle: 'melee' },
      { id: 'yunlan_elder', name: '云岚长老', hp: 1900, atk: 88, def: 28, atkStyle: 'magic' },
      { id: 'hidden_guard', name: '藏兵阁死士', hp: 1600, atk: 95, def: 24, atkStyle: 'ranged' },
      { id: 'yunshan_elite', name: '云山亲传', hp: 3200, atk: 105, def: 45, tier: 'boss', atkStyle: 'magic' },
    ],
    drops: [{ item: 'coin', chance: 1, min: 80, max: 180 }, { item: 'fire_sanqian', chance: 0.03, min: 1, max: 1 }],
  },
  {
    id: 'heijiao', name: '黑角域', levelReq: 45,
    monsters: [
      { id: 'tribe', name: '蛮族战士', hp: 4800, atk: 160, def: 70, atkStyle: 'melee' },
      { id: 'shaman', name: '蛮荒巫医', hp: 4200, atk: 175, def: 55, atkStyle: 'magic' },
      { id: 'warbeast', name: '角兽战将', hp: 5400, atk: 150, def: 85, atkStyle: 'melee' },
      { id: 'chief', name: '部落酋长', hp: 8600, atk: 210, def: 95, tier: 'boss', atkStyle: 'melee' },
    ],
    drops: [{ item: 'coin', chance: 1, min: 150, max: 320 }, { item: 'xuanjing', chance: 0.06, min: 1, max: 1 }],
  },
  {
    id: 'zhongzhou', name: '中州', levelReq: 60,
    monsters: [
      { id: 'genius', name: '各族天骄', hp: 13000, atk: 320, def: 150, atkStyle: 'magic' },
      { id: 'family_disciple', name: '世家供奉弟子', hp: 12000, atk: 340, def: 130, atkStyle: 'ranged' },
      { id: 'ancient_heir', name: '上古魔兽后裔', hp: 15000, atk: 300, def: 170, atkStyle: 'melee' },
      { id: 'elder', name: '八大家族供奉', hp: 22000, atk: 420, def: 200, tier: 'boss', atkStyle: 'magic' },
    ],
    // 角色碎片：4% → 1%（v1.25）。当年 4% 是配"30 枚换圣阶"定的，现在兑换面扩到全阶、
    // 价格按抽卡期望重定，掉落必须跟着重定——按碾压中州实测 600~900 杀/h，4% 等于 28 枚/h，
    // ~1 小时就能换一个圣阶，比抽卡的期望成本（51.9 抽）便宜太多，碎片会变成主路径。
    // 1% ≈ 7 枚/h；v1.25.1 兑换价翻倍后换一个圣阶要 60 枚 ≈ 挂机 8.5 小时。
    // 一句话：这是"长期挂机的补充"，不是抽卡的替代品。
    drops: [{ item: 'coin', chance: 1, min: 300, max: 600 }, { item: 'xuanjing', chance: 0.12, min: 1, max: 2 }, { item: 'shard', chance: 0.01, min: 1, max: 1 }],
  },
]

// ── 关卡连续推进（沿用咸鱼之王思路：不手选地图，击杀后自动进入下一关，怪物随关卡数指数成长）──
export const BOSS_STAGE_INTERVAL = 5
export const BOSS_STAGE_MULT = 1.6

export function stageStats(stage: number): { hp: number; atk: number; def: number } {
  const boss = isBossStage(stage) ? BOSS_STAGE_MULT : 1
  const hp = Math.max(20, Math.floor(45 * Math.pow(1.095, stage) * boss))
  const atk = Math.max(3, Math.floor(5 * Math.pow(1.075, stage) * boss))
  const def = Math.max(0, Math.floor(1 * Math.pow(1.085, stage) * boss))
  return { hp, atk, def }
}

export function isBossStage(stage: number): boolean {
  return stage % BOSS_STAGE_INTERVAL === 0
}

/** 关卡所在的主题区域（决定怪物立绘/场景背景/掉落表，纯风味，不再决定数值） */
export function zoneForStage(stage: number): MapDef {
  let zone = MAPS[0]
  for (const m of MAPS) {
    if (stage >= m.levelReq) zone = m
  }
  return zone
}

export function monsterForStage(stage: number): MonsterDef {
  const zone = zoneForStage(stage)
  if (isBossStage(stage)) return zone.monsters.find(m => m.tier === 'boss') ?? zone.monsters[zone.monsters.length - 1]
  const normals = zone.monsters.filter(m => m.tier !== 'boss')
  return normals[stage % normals.length]
}

/** 关卡击杀铜钱奖励（丹药是主要经济消耗，铜钱走平滑线性增长即可） */
export function stageCoinReward(stage: number): number {
  return Math.floor(8 + stage * 5)
}

// ── 天梯塔（论道塔）：roguelike 式无限爬塔，战败/撤退清空祝福重来 ──────────────
export const LAB_BOSS_INTERVAL = 5
export const LAB_BOSS_MULT = 1.6

export function labStats(floor: number): { hp: number; atk: number; def: number } {
  const boss = floor % LAB_BOSS_INTERVAL === 0 ? LAB_BOSS_MULT : 1
  return {
    hp: Math.max(30, Math.floor(150 * Math.pow(1.16, floor) * boss)),
    atk: Math.max(5, Math.floor(8 * Math.pow(1.11, floor) * boss)),
    def: Math.max(0, Math.floor(2 * Math.pow(1.09, floor) * boss)),
  }
}

export function isLabBoss(floor: number): boolean {
  return floor % LAB_BOSS_INTERVAL === 0
}

/** 首通论道令奖励（只在突破生涯最高层时发放） */
export function labDaolingReward(floor: number): number {
  const base = Math.floor(2 + floor * 0.6)
  return isLabBoss(floor) ? base * 2 : base
}

export type BlessingCategory = 'offense' | 'defense' | 'economy'

export interface BlessingDef {
  id: string; name: string; icon: string; desc: string; category: BlessingCategory
  atkPct?: number; defPct?: number; hpPct?: number; lifesteal?: number
  pierce?: number; dodge?: number; coinPct?: number; daolingPct?: number; crystalPct?: number
}

export const LAB_BLESSINGS: BlessingDef[] = [
  { id: 'sword', name: '剑意冲霄', icon: '⚔️', desc: '塔内攻击 +15%', category: 'offense', atkPct: 15 },
  { id: 'bell', name: '金钟罩', icon: '🔔', desc: '塔内防御 +20%', category: 'defense', defPct: 20 },
  { id: 'dragonblood', name: '气血如龙', icon: '🐉', desc: '塔内气血上限 +25%', category: 'defense', hpPct: 25 },
  { id: 'lifesteal', name: '噬血大法', icon: '🩸', desc: '每次攻击回复造成伤害 10% 的生命', category: 'defense', lifesteal: 10 },
  { id: 'eagle', name: '鹰眼诀', icon: '🦅', desc: '攻击威力 +10%（凝神一击）', category: 'offense', atkPct: 10 },
  { id: 'pierce', name: '破甲式', icon: '🔨', desc: '无视怪物 20% 防御', category: 'offense', pierce: 20 },
  { id: 'wind', name: '疾风步', icon: '💨', desc: '10% 概率闪避怪物反击', category: 'defense', dodge: 10 },
  { id: 'mouse', name: '寻宝鼠', icon: '🐭', desc: '论道令获取 +50%', category: 'economy', daolingPct: 50 },
  { id: 'gold', name: '点金手', icon: '✋', desc: '铜钱获取 +50%', category: 'economy', coinPct: 50 },
  { id: 'insight', name: '顿悟', icon: '💡', desc: '塔内斗气结晶获取 +30%', category: 'economy', crystalPct: 30 },
]

// ── 天梯塔怪物梯队（每 20 层一档，风味用，不影响数值）───────────────────────
export interface TowerTier { id: string; name: string; bossName: string; from: number; atkStyle: AtkStyle }
export const TOWER_TIERS: TowerTier[] = [
  { id: 'tower_t1', name: '陨铁傀儡', bossName: '石魄守卫', from: 1, atkStyle: 'melee' },
  { id: 'tower_t2', name: '秘纹傀儡', bossName: '虚空行者', from: 20, atkStyle: 'ranged' },
  { id: 'tower_t3', name: '混沌造物', bossName: '深渊魔像', from: 40, atkStyle: 'magic' },
  { id: 'tower_t4', name: '天罚之影', bossName: '塔颠帝影', from: 60, atkStyle: 'magic' },
]

export function towerTierForFloor(floor: number): TowerTier {
  let tier = TOWER_TIERS[0]
  for (const t of TOWER_TIERS) {
    if (floor >= t.from) tier = t
  }
  return tier
}

export function towerMonsterName(floor: number): string {
  const tier = towerTierForFloor(floor)
  return isLabBoss(floor) ? tier.bossName : tier.name
}

export function towerMonsterSpriteId(floor: number): string {
  const tier = towerTierForFloor(floor)
  return isLabBoss(floor) ? `${tier.id}_boss` : tier.id
}

// ── 敌方阵容（v1.28）：一关不再是一只血包，而是 1~6 个各有职责的敌人 ──────────
/**
 * 战斗中的敌方单位。
 *
 * 为什么要独立结构：我方单位的数值来自「存档等级 × 品阶 × 定位 × 装备 × 异火」，
 * 每次出手现算即可（charStats）；敌方没有养成数据，必须在**开战时一次性定妥**——
 * 否则同一场战斗里敌人血量会因为某个函数被重算而漂移（例如怪物反击时再算一次 stageStats）。
 */
export interface EnemyUnit {
  uid: string // 同一场战斗内唯一：UI 的 key、事件定位都用它（同名同 id 的敌人不止一个）
  name: string
  position: Position
  duty: Duty
  role: Role
  atkStyle: AtkStyle
  hp: number
  maxHp: number
  atk: number
  def: number
  /**
   * 被 `control`（控制减益）压制中：攻/防各下调 atkPct / defPct 个百分点，`left` 是剩余回合数。
   *
   * 挂在单位自己身上而不是战斗状态里的 map，是因为**敌人在清波时会整批换成新对象**
   * （`b.enemies = enemyUnitsForStage(...)`），而新旧敌人的 uid 都从 `e0` 开始复用 ——
   * 若把减益存进以 uid 为键的 map，上一波的压制会莫名其妙落到下一波的敌人头上。
   * 挂在对象上，新敌人自带 `undefined`，这个问题根本不存在。
   *
   * 可选字段：`enemyUnitsForStage` / `enemyUnitsForFloor` 造敌人时不必逐个填它
   * （刚开打的敌人本来就没有压制），全篇统一用 `e.debuff?.xxx ?? 默认值` 读。
   */
  debuff?: ControlDebuff
}

/** `control` 施加的压制：攻/防下调的百分点 + 剩余回合数 */
export interface ControlDebuff { atkPct: number; defPct: number; left: number }

/** 多敌人时的名字后缀（甲/乙/丙…），让「打掉一个」在战报里说得清是哪个 */
const ENEMY_ORDINAL = ['甲', '乙', '丙', '丁', '戊', '己']

/**
 * 人数缩放参数：人数越多，每个单位的血/攻/防越被摊薄。集中在此，便于用难度模拟脚本扫参。
 *
 * 三条曲线为什么这么定（以 base 为单敌人基线）：
 * - **总血量 +15%/人**：人多不只是"一份血被分成几份"，总量真的更多——这是关卡难度随人数上升的主来源。
 * - **总输出 +3%/人**：压得极低，因为总血量上涨已经按比例拉长了战斗时长，总承伤会跟着涨；
 *   这里再放大就会变成叠乘（实测 6 人关若按 +20%/人 则总承伤 ×2.6，老玩家当场卡关）。
 * - **总防御 +4%/人**：同样是摊薄而非放大。注意**防御是被人数除掉的**（见 makeEnemyUnits）——
 *   这一条是"人多"的真实威胁来源：我方的高防御只能挡住其中一个，挡不住全部。
 */
export const ENEMY_SCALE = { hp: 0.15, atk: 0.03, def: 0.04 }

/** 职责血量权重：坦克血厚、医师略薄、战士居中。分配总血量时按此加权，坦克自然成为"挡在前面的墙" */
const DUTY_HP_WEIGHT: Record<Duty, number> = { tank: 1.9, warrior: 1, healer: 0.85 }

/**
 * 敌方人数曲线：关卡越深，人以群分。
 *
 * 分段依据是线上真实存档的进度分布（8 人停在 1-9、6 人在 50-79、2 人在 80-119、最高 90）。
 * 开头 4 关坚持 1 人，是教学节奏：新手这时往往只有两三个角色，
 * 先让他们看懂"单体对拼"，再逐步见识群攻、坦克、医师。
 */
export function enemyCountFor(stage: number): number {
  if (stage <= 4) return 1
  if (stage <= 14) return 2
  if (stage <= 29) return 3
  if (stage <= 49) return 4
  if (stage <= 79) return 5
  return 6
}

/** 天梯塔人数曲线：塔的层数涨得比主线快得多（塔 20 层 ≈ 主线 46 关），故单独一条更陡的曲线 */
export function enemyCountForFloor(floor: number): number {
  if (floor <= 2) return 1
  if (floor <= 5) return 2
  if (floor <= 10) return 3
  if (floor <= 20) return 4
  if (floor <= 35) return 5
  return 6
}

/** 塔层换算成"等价主线深度"：让职责构成的分段阈值在两条线上共用（塔 5 层 ≈ 主线 11 关） */
export function floorToStageDepth(floor: number): number {
  return Math.floor(floor * 2.3)
}

/**
 * 敌方职责构成：难度不只体现在数值上，更体现在**结构**上。
 *
 * 渐进解锁（阈值按关卡深度）：
 * - 15 关起 出坦克 —— 逼玩家面对"打不动的前排"，学会把单体爆发留到正确的目标上
 * - 30 关起 出治疗 —— 前排挡着，谁都够不到它（v1.28.7 起取消了越前排），只能硬拆前排
 * - 50 关起 出群攻 —— 敌方火力开始能同时压低我方多人血线，单奶跟不上
 * - 80 关起 出控制 —— 最深处的关卡才全员到齐
 *
 * ️ 深度阈值的数字在两条路径上的**到达门槛差很多**：
 * 主线要打到第 80 关，天梯塔只要 35 层（`floorToStageDepth(35) = 80`）。
 * 放在后排的控制早在 v1.28.3 就收回了越前排特权（我方那份也于 v1.28.7 取消），
 * 现在敌我两边都只能先打前排，不会再出现"塔里被偷后排、主线却没事"的观感差。
 *
 * 返回顺序即站位：前排在先。人数不够时，**优先砍掉优先级最低的后排**（群攻 > 治疗 > 控制 保留）。
 */
function enemyCompFor(count: number, depth: number): { duty: Duty; role: Role; position: Position }[] {
  const back: { duty: Duty; role: Role }[] = []
  if (depth >= 80) back.push({ duty: 'warrior', role: 'control' })
  if (depth >= 30) back.push({ duty: 'healer', role: 'heal' })
  if (depth >= 50) back.push({ duty: 'warrior', role: 'aoe' })

  const out: { duty: Duty; role: Role; position: Position }[] = []
  const frontCount = Math.max(1, count - back.length)
  out.push(depth >= 15
    ? { duty: 'tank', role: 'tank', position: 'front' }
    : { duty: 'warrior', role: 'melee', position: 'front' })
  while (out.length < frontCount) out.push({ duty: 'warrior', role: 'melee', position: 'front' })
  // slice 的终点在循环开始前求值一次：这里正是"后排只剩几个空位就放几个"
  for (const b of back.slice(0, count - out.length)) out.push({ ...b, position: 'back' })
  return out.slice(0, count)
}

/** 按构成与基线数值生成一场战斗的敌方单位列表 */
function makeEnemyUnits(
  comp: { duty: Duty; role: Role; position: Position }[],
  base: { hp: number; atk: number; def: number },
  name: string,
  atkStyle: AtkStyle,
): EnemyUnit[] {
  const n = comp.length
  const hpMul = 1 + (n - 1) * ENEMY_SCALE.hp
  const atkMul = 1 + (n - 1) * ENEMY_SCALE.atk
  const defMul = 1 + (n - 1) * ENEMY_SCALE.def
  const wSum = comp.reduce((s, c) => s + DUTY_HP_WEIGHT[c.duty], 0)

  return comp.map((c, i) => {
    const hp = Math.max(1, Math.floor((base.hp * hpMul * DUTY_HP_WEIGHT[c.duty]) / wSum))
    return {
      uid: `e${i}`,
      name: n > 1 ? `${name}·${ENEMY_ORDINAL[i]}` : name,
      position: c.position,
      duty: c.duty,
      role: c.role,
      atkStyle,
      hp,
      maxHp: hp,
      atk: Math.max(1, Math.floor((base.atk * atkMul) / n)),
      def: Math.max(0, Math.floor((base.def * defMul) / n)),
    }
  })
}

/** 主线第 stage 关的敌方阵容 */
export function enemyUnitsForStage(stage: number): EnemyUnit[] {
  const base = stageStats(stage)
  const def = monsterForStage(stage)
  return makeEnemyUnits(enemyCompFor(enemyCountFor(stage), stage), base, def.name, def.atkStyle ?? 'melee')
}

/** 天梯塔第 floor 层的敌方阵容 */
export function enemyUnitsForFloor(floor: number): EnemyUnit[] {
  const base = labStats(floor)
  const style = towerTierForFloor(floor).atkStyle
  return makeEnemyUnits(enemyCompFor(enemyCountForFloor(floor), floorToStageDepth(floor)), base, towerMonsterName(floor), style)
}

// ── 阵营羁绊（v1.28）───────────────────────────────────────────────────────
/**
 * 阵营与羁绊：上阵的同阵营角色达到人数阈值，就给**全队**加成（取自走棋的羁绊玩法）。
 *
 * 设计意图是让"上谁"不再只是挑单个最强的角色，而要看**能不能凑出羁绊**——
 * 三个中等强度的云岚宗角色凑齐档位，未必输给三个各自为战的强力散修。
 * 这和前排/后排、"先拆墙"的目标规则一起，构成"布阵有意义"的两条腿：
 * 一条回答"谁挨打"，一条回答"带谁上"。
 *
 * 阈值统一按 2 / 4 / 6 三档设计，但**每个阵营按自己的成员数裁剪档位**——
 * 只有 2 个成员的焚炎谷给不出 6 人档，界面上就不该画一个永远凑不齐的档位。
 * 加成只对我方生效（敌方不吃羁绊），所以它是玩家侧的成长空间，不是难度来源。
 */
export type FactionId =
  | 'yunlan' | 'xiao' | 'jiama' | 'moshou' | 'gu'
  | 'long' | 'hundian' | 'fenyangu' | 'danta' | 'sanxiu'

export interface FactionTier {
  /** 需要几名同阵营角色同时上阵才触发 */
  count: number
  /** 加成数值：atk/def/hp 是百分比，crit 是直接加在暴击率的百分点上 */
  atk?: number
  def?: number
  hp?: number
  crit?: number
  /** 界面展示用的一句话 */
  desc: string
}

export interface FactionDef {
  id: FactionId
  name: string
  color: string
  /** 这个阵营的取向，阵容页上做副标题 */
  motto: string
  tiers: FactionTier[]
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  yunlan: {
    id: 'yunlan', name: '云岚宗', color: '#7dd3fc', motto: '攻势凌厉',
    tiers: [
      { count: 2, atk: 6, desc: '全体攻击 +6%' },
      { count: 4, atk: 13, desc: '全体攻击 +13%' },
      { count: 6, atk: 24, desc: '全体攻击 +24%' },
    ],
  },
  xiao: {
    id: 'xiao', name: '萧家', color: '#f87171', motto: '血脉深厚',
    tiers: [
      { count: 2, hp: 8, desc: '全体气血 +8%' },
      { count: 4, hp: 17, desc: '全体气血 +17%' },
      { count: 6, hp: 30, desc: '全体气血 +30%' },
    ],
  },
  jiama: {
    id: 'jiama', name: '加玛帝国', color: '#fbbf24', motto: '铁壁坚守',
    tiers: [
      { count: 2, def: 10, desc: '全体防御 +10%' },
      { count: 4, def: 22, desc: '全体防御 +22%' },
      { count: 6, def: 38, desc: '全体防御 +38%' },
    ],
  },
  moshou: {
    id: 'moshou', name: '魔兽山脉', color: '#4ade80', motto: '致命一击',
    tiers: [
      { count: 2, crit: 5, desc: '全体暴击 +5%' },
      { count: 4, crit: 11, desc: '全体暴击 +11%' },
      { count: 5, crit: 20, desc: '全体暴击 +20%' },
    ],
  },
  gu: {
    id: 'gu', name: '古族', color: '#c084fc', motto: '远古血脉',
    tiers: [
      { count: 2, atk: 8, desc: '全体攻击 +8%' },
      { count: 3, atk: 18, desc: '全体攻击 +18%' },
    ],
  },
  long: {
    id: 'long', name: '太虚古龙', color: '#38bdf8', motto: '龙皇之躯',
    tiers: [
      { count: 2, hp: 10, desc: '全体气血 +10%' },
      { count: 3, hp: 22, desc: '全体气血 +22%' },
    ],
  },
  hundian: {
    id: 'hundian', name: '魂殿', color: '#94a3b8', motto: '阴冷侵蚀',
    tiers: [
      { count: 2, atk: 10, desc: '全体攻击 +10%' },
      { count: 3, atk: 22, desc: '全体攻击 +22%' },
    ],
  },
  fenyangu: {
    id: 'fenyangu', name: '焚炎谷', color: '#fb7185', motto: '烈焰灼心',
    tiers: [
      { count: 2, crit: 9, desc: '全体暴击 +9%' },
    ],
  },
  danta: {
    id: 'danta', name: '丹塔', color: '#34d399', motto: '药理回春',
    tiers: [
      { count: 2, atk: 7, desc: '全体攻击（含治疗量）+7%' },
      { count: 3, atk: 16, desc: '全体攻击（含治疗量）+16%' },
    ],
  },
  sanxiu: {
    id: 'sanxiu', name: '散修', color: '#a8a29e', motto: '各自为战',
    tiers: [
      { count: 3, atk: 4, def: 4, hp: 4, desc: '全体攻击/防御/气血 +4%' },
      { count: 5, atk: 8, def: 8, hp: 8, desc: '全体攻击/防御/气血 +8%' },
      { count: 6, atk: 14, def: 14, hp: 14, desc: '全体攻击/防御/气血 +14%' },
    ],
  },
}

/**
 * 角色 → 阵营。刻意单独成表，而不是给 def() 再加第 7 个参数：
 * 那要一次改 54 行签名，改动面大、写错也看不出来。这里的漏配由文件末尾的启动自检兜住。
 */
export const FACTION_OF: Record<string, FactionId> = {
  // 云岚宗：云韵、云山、纳兰一族都是云岚宗的人（玩家点名的例子）
  yellow_disciple: 'yunlan', nalanyanran: 'yunlan', yunyun: 'yunlan', yunshan: 'yunlan',
  yunyun_queen: 'yunlan', nalanjie: 'yunlan', nalansu: 'yunlan', yunling: 'yunlan',
  yunlan_guard: 'yunlan',
  // 萧家
  xiaoxunr: 'xiao', xiaoyan_zong: 'xiao', xiaoyan_di: 'xiao', xiaozhan: 'xiao',
  xiaoxunr_di: 'xiao', xiaoyu: 'xiao', xiaoding: 'xiao', xiaomei: 'xiao',
  // 加玛帝国
  yellow_mercenary: 'jiama', haibodong: 'jiama', yafei: 'jiama',
  jiaxingtian: 'jiama', fama: 'jiama', jiama_soldier: 'jiama',
  // 魔兽山脉（含蛇人族：彩鳞、青鳞本属蛇人族，同出魔兽山脉）
  yellow_hunter: 'moshou', cailin: 'moshou', fengqingr: 'moshou',
  qinglin: 'moshou', moshou_trapper: 'moshou',
  // 古族
  guyuan: 'gu', guqingfeng: 'gu', guyao: 'gu',
  // 太虚古龙
  ziyan: 'long', zhukun: 'long', ziyan_long: 'long',
  // 魂殿
  hanfeng: 'hundian', hundi: 'hundian', xuwu: 'hundian',
  // 焚炎谷
  tianhuo: 'fenyangu', fengxian: 'fenyangu',
  // 丹塔（炼药师一脉）
  yaochen: 'danta', ruolin: 'danta', hanyue: 'danta',
  // 散修：无门无派，凑够人也有一套均衡加成
  yellow_bandit: 'sanxiu', luoxuan: 'sanxiu', wuang: 'sanxiu', zhayi: 'sanxiu',
  linmeiniang: 'sanxiu', yuntianhe: 'sanxiu', tuoshe: 'sanxiu', linxiuya: 'sanxiu',
  liuling: 'sanxiu', wuhao: 'sanxiu', tieyan: 'sanxiu', desert_escort: 'sanxiu',
}

/** 已上阵的某个阵营：人数与当前生效的档位（未达最低档时 tier 为 null） */
export interface ActiveBond {
  faction: FactionDef
  count: number
  tier: FactionTier | null
}

export interface BondBonuses {
  atkPct: number
  defPct: number
  hpPct: number
  /** 直接加到暴击率上的百分点 */
  crit: number
  /** 全部有上阵成员的阵营（含未激活的），供界面展示"还差几个" */
  active: ActiveBond[]
}

/**
 * 统计一套阵容的羁绊加成。传的是**上阵角色 id 列表**（空位不算人）。
 * 同一阵营多档只取**已满足的最高档**，不累加 —— 6 人云岚宗拿 +24%，不是 6+13+24。
 */
export function bondBonusesFor(ids: (string | null)[]): BondBonuses {
  const count: Partial<Record<FactionId, number>> = {}
  for (const id of ids) {
    if (!id) continue
    const f = FACTION_OF[id]
    if (f) count[f] = (count[f] ?? 0) + 1
  }
  const out: BondBonuses = { atkPct: 0, defPct: 0, hpPct: 0, crit: 0, active: [] }
  for (const def of Object.values(FACTIONS)) {
    const n = count[def.id] ?? 0
    if (n <= 0) continue
    const tier = [...def.tiers].reverse().find(t => n >= t.count) ?? null
    out.active.push({ faction: def, count: n, tier })
    if (!tier) continue
    out.atkPct += tier.atk ?? 0
    out.defPct += tier.def ?? 0
    out.hpPct += tier.hp ?? 0
    out.crit += tier.crit ?? 0
  }
  // 阵容页按"已激活优先、人数多优先"排，让玩家一眼看到自己凑出了什么
  out.active.sort((a, b) => (Number(!!b.tier) - Number(!!a.tier)) || (b.count - a.count))
  return out
}

// ── 物品图鉴（用于展示名称/图标）───────────────────────────────────────────
export const ITEM_INFO: Record<string, { name: string; icon: string }> = {
  coin: { name: '灵金', icon: '🪙' },
  crystal: { name: '斗气结晶', icon: '💎' },
  herb: { name: '灵药', icon: '🌿' },
  yuanfen: { name: '缘分丹', icon: '🎴' },
  daoling: { name: '论道令', icon: '🎫' },
  essence: { name: '武魂精血', icon: '🩸' },
  xuanjing: { name: '玄晶', icon: '🔮' },
  shard: { name: '角色碎片', icon: '✨' },
  ...Object.fromEntries(FIRES.map(f => [`fire_${f.id}`, { name: `${f.name}·精华`, icon: f.icon }])),
  ...Object.fromEntries(PILLS.map(p => [p.id, { name: p.name, icon: p.icon }])),
}

// ── 升星：每 10 星一个品质档（v1.28.9 重做，见下方常量块） ──────────────────────────────────
// 原设计上限 5★ 且仅需 225 精血/角色，实测第 1 天就满星 —— 那段沿革已并入下方常量块。
// ── 升星常量（v1.28.9 重做：每 10 星一个品质档，共 5 档）────────────────────
//
// 沿革：v1.7 上限 5★ 且只要 225 精血，第 1 天就满星、精血与玄晶双双溢出报废，于是把上限提到 10★。
// v1.28.9 又重演了同一件事 —— 线上 22 份云存档里 26/257 个角色已满 10★（5 名玩家手里有满星角色），
// 而碾压关的精血产出有 228~342/h，1~5★ 那 225 精血**挂机 1 小时就够**。
// **根因不是"上限太小"，是每一档的成本太平** —— 所以这次不是单纯拉长，而是把成本按档拉开：
//
//   · 1~10★   成本与属性一分不动（老档既有进度不作废、已满 10★ 的角色只会更强不会更弱）
//   · 11★ 起  每档的每星价是上一档的 3 倍，用玄晶（它只有装备分解一个来源，约 9~60/h）
//
// 档位按「**每满 10 星提升一个品质**」划分：0~9 铜 / 10~19 银 / 20~29 金 / 30~39 赤 / 40~50 彩。
// 跨档时属性再给一次 +10% 跃升，让"品质提升"不只是换个颜色。按当前产出，练满一个角色
// 约需 500 小时挂机（3.2 万玄晶），作为终局长期目标。
export const MAX_STARS = 50
export const STAR_ESSENCE_CAP = 5
/** 每档 10 星 */
export const STARS_PER_TIER = 10

export interface StarTier {
  name: string
  /** 星级字形的颜色（阵容页按它上色 —— 这是 v1.28.9 玩家直接要的「星级的颜色」） */
  color: string
}

/** 五档品质。与角色自身的品阶（黄玄地天准圣圣）是**两条独立的轴**，别混 */
export const STAR_TIERS: StarTier[] = [
  { name: '铜星', color: '#c98a4b' },
  { name: '银星', color: '#cbd5e1' },
  { name: '金星', color: '#f5c542' },
  { name: '赤星', color: '#ef5350' },
  { name: '彩星', color: '#d946ef' },
]

/** 11★ 起每档的**每星**玄晶价，索引 = 档位−1（银/金/赤/彩），每档 ×3 */
export const STAR_TIER_XUANJING = [80, 240, 720, 2160]
/** 每跨过一个品质档，属性额外 +10%（10★ 的角色因此比旧版更强，不会更弱） */
export const STAR_TIER_JUMP = 0.1

/** 星级品质档位（0-based）。clamp 到 [0, 档数−1]，畸形存档里的天文数字不会越界 */
export function starTierIndex(stars: number): number {
  const s = Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0
  return Math.max(0, Math.min(STAR_TIERS.length - 1, Math.floor(s / STARS_PER_TIER)))
}

export function starTierOf(stars: number): StarTier {
  return STAR_TIERS[starTierIndex(stars)]
}

/**
 * 星级系数。**这是唯一的星级属性口径** —— 面板、战斗、战力评分都走它，
 * 别在别处再拼一个 `1 + stars * 0.08`（v1.21.4 那次"升星面板不涨属性"就是两份实现打架）。
 *
 * 跃升次数取 `starTierIndex` 而不是 `floor(stars/10)`：后者在 50★ 会给第 6 次跃升，
 * 而颜色只到第 5 档（50★ 是彩星档的圆满、不是新的一档），两条口径必须同源。
 */
export function starMultOf(stars: number): number {
  const s = Number.isFinite(stars) ? Math.max(0, Math.min(MAX_STARS, Math.floor(stars))) : 0
  return 1 + s * 0.08 + STAR_TIER_JUMP * starTierIndex(s)
}

export function starUpCost(stars: number): { item: 'essence' | 'xuanjing'; amount: number } {
  const next = stars + 1
  if (next <= STAR_ESSENCE_CAP) return { item: 'essence', amount: next * 15 }
  // 6~10★：与 v1.7 起的旧价逐字一致（8/16/24/32/40），老玩家的成本认知不作废
  if (next <= STARS_PER_TIER) return { item: 'xuanjing', amount: (next - STAR_ESSENCE_CAP) * 8 }
  const idx = Math.min(STAR_TIER_XUANJING.length - 1, Math.floor((next - 1) / STARS_PER_TIER) - 1)
  return { item: 'xuanjing', amount: STAR_TIER_XUANJING[idx] }
}

/**
 * 角色碎片（v1.25）：抽到**重复**的高阶角色时转化而来，可兑换任意品阶的**未拥有**角色。
 * 原名「圣阶角色碎片」——那时只能换圣阶，现在全阶可换，名字跟着用途走。
 *
 * **只有准圣/圣阶重复转碎片**，低阶重复仍退武魂精血（与 v1.24.2 一致）。这是刻意的：
 * 抽卡的重复量绝大部分来自低阶——5 万玩家模拟显示终身 75 抽里 76% 的重复是黄+玄
 * （黄 24.2 次 / 玄 16.2 次，对比准圣 0.89 次 / 圣 0.09 次）。低阶也转碎片的话，
 * 碎片会随抽数线性泛滥，兑换池等于白送。
 *
 * 两张表的比例是硬约束而不是拍脑袋——**兑换价 ÷ 转化量恒为 6**（圣 60÷10、准圣 30÷5），
 * 意思是「同一个品阶，重复抽到 6 次才能换 1 个新的」。低于 6 会出现"抽到几个重复就能
 * 立刻换一个新角色"，兑换从兜底变成主路径；高于 6 则碎片攒着没盼头。
 * 低阶兑换价 2/4/8/16 按 2 倍阶梯补全，正好接上准圣 30、圣 60。
 *
 * v1.25 首版是 1/2/4/8/15/30（比值 3），v1.25.1 按「价格全部再翻倍」整体 ×2。
 * 翻倍直接打击的是**中州挂机**那条线：它是碎片的主力来源，1% 掉落 ≈ 杀 700 只/h 时
 * 7 枚/h，换一个圣阶从 ~4 小时拉长到 ~8.5 小时。抽卡重复那条线本来就攒不满一次兑换
 * （见 design/数值设计.md §14.4），翻倍对它的影响只是"更不可能"。
 */
export const DUPE_SHARD: Partial<Record<Rarity, number>> = {
  quasi: 5, sheng: 10,
}
export const SHARD_COST: Record<Rarity, number> = {
  yellow: 2, xuan: 4, di: 8, tian: 16, quasi: 30, sheng: 60,
}

// ─ 抽卡保底：三层，抽到「该层或更高」即重置该层计数 ──────────────────────
// 定数依据：缘分丹是抽卡唯一货币，产出只有「主线每 5 关首领首通 1 颗 + 每 25 关额外 2 颗」，
// 实测线上存档（pityRare 只在触发时归零，所以它直接等于终身抽数）玩家终身只有 26~71 抽。
// **保底抽数必须小于终身抽数才有意义** —— 原先的「90 抽必出天阶+」全服无人触及，等于没做；
// 而且它 60% 概率掉天阶，就算攒到也是白攒。三层数字都按「终身 40~70 抽」这个量级定。
export const PITY_TIAN = 10     // 每 10 抽必出天阶+：消除「十连全白」的挫败
export const PITY_QUASI = 30    // 每 30 抽必出准圣+：55 关玩家终身 40 颗，坚持抽就一定拿得到
export const PITY_SHENG = 60    // 每 60 抽必出圣阶：54 名角色里有 6 个圣阶，保持「玩到后期的里程碑」定位
/** 天阶保底抽的升格概率：保底也留点惊喜，不是每次都卡着最低档给 */
export const PITY_TIAN_UPGRADE = 0.1

// ── 放生返还 ──────────────────────────────────────────────────────────────
/** 放生返还比例：退回角色的养成投入，留 30% 当作换阵容的成本 */
export const RELEASE_REFUND = 0.7

/**
 * 按比例返还并向下取整。**必须带 eps**：`90 × 0.7` 在 IEEE754 里是 62.99999999999999，
 * 直接 Math.floor 会少退 1。投入越"整"越容易踩到（30 → 21 是准的，90 → 63 就掉成 62）。
 */
export function refundOf(invested: number): number {
  return Math.floor(invested * RELEASE_REFUND + 1e-6)
}

/**
 * 丹药的返还取整走四舍五入而不是向下取整：丹药是整颗的，而一个角色对某一品阶通常只吃
 * 1~3 颗，向下取整会让"花了 1 颗"变成"退 0 颗"——玩家看到的是"丹药根本没退"。
 */
export function refundPillsOf(count: number): number {
  return Math.round(count * RELEASE_REFUND)
}

/** 反推投入时的等级闸门：畸形存档里 level 可能是 1e9，不设上限会把循环拖死 */
const INVEST_LEVEL_CAP = 2000

export interface CharInvestment {
  crystal: number // 打坐修炼消耗的斗气结晶
  pills: Record<string, number> // 突破消耗的丹药：id → 颗数
  essence: number // 升星 1~5★ 消耗的武魂精血
  xuanjing: number // 升星 6★ 起消耗的玄晶
}

/**
 * 反推一个角色已经吃进去的养成资源。**只由 level / xp / stars 三个字段决定**——
 * 不在存档里额外记账，所以老存档放生也能算出完整投入，迁移零风险、也不会算漏。
 *
 * 灵晶之所以能这么反推，靠的是两条不变量：
 *   1. 1 结晶 = 1 经验（trainChar 原样把结晶数交给 gainXp）；
 *   2. 经验只被升级消耗（xpToNext 是唯一出口）。
 * 于是「∑ 各级所需经验 + 当前余量」= 累计投入的结晶，最后那一截还没换升级的余量也算投入
 * （结晶确实已经花掉了）。
 * ⚠️ 不变量 1 依赖 trainChar 不再吞掉溢出结晶——见引擎 gainXp 的返回值。
 */
export function charInvestment(level: number, xp: number, stars: number): CharInvestment {
  const lv = Number.isFinite(level) ? Math.floor(level) : 1
  const cap = Math.min(Math.max(1, lv), INVEST_LEVEL_CAP)
  const cur = Number.isFinite(xp) ? Math.max(0, xp) : 0
  const st = Math.min(Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0, MAX_STARS)

  const pills: Record<string, number> = {}
  let crystal = cur
  for (let L = 1; L < cap; L++) {
    crystal += xpToNext(L)
    // 每跨一个大境界吃 1 颗，品阶由「当前所在境界」决定（与 gainXp 里的判定逐字一致）
    if (needsPillFor(L)) {
      const pid = `pill${pillGradeFor(L)}`
      pills[pid] = (pills[pid] ?? 0) + 1
    }
  }

  let essence = 0
  let xuanjing = 0
  for (let s = 0; s < st; s++) {
    const c = starUpCost(s)
    if (c.item === 'essence') essence += c.amount
    else xuanjing += c.amount
  }

  return { crystal, pills, essence, xuanjing }
}

// ── 装备系统 ──────────────────────────────────────────────────────────────
// 设计取舍（相对参考项目 vue-idle-game 的关键改动）：源项目角色成长是简单线性，
// 词条可以用"+11 攻击力"这种绝对数值。咱们的角色数值有 REALM_POWER 乘法加成，
// 同一件装备穿在 10 级和 1000 级角色身上如果给固定数值，要么毫无意义要么严重超模。
// 所以全部词条改为百分比加成（挂在 charStats 的加成层，和异火同一套叠加逻辑），
// 装备本身不再需要"装备等级"和角色等级绑定计算——纯粹看品阶决定词条数值范围与条数。

export type EquipSlot = 'weapon' | 'armor' | 'accessory' | 'ring'
export type AffixType = 'atkPct' | 'defPct' | 'hpPct' | 'critRate' | 'critDmg'

export const SLOT_INFO: Record<EquipSlot, { label: string; innate: AffixType; nameWords: string[] }> = {
  weapon: { label: '兵刃', innate: 'atkPct', nameWords: ['裂空剑', '焚炎枪', '噬魂刀', '霜寒戟', '雷鸣锤', '烈日弓', '斩魄刃', '碎星锏'] },
  armor: { label: '战甲', innate: 'defPct', nameWords: ['玄铁战甲', '龙鳞战袍', '玄冰铠', '赤焰战衣', '幽影披风', '磐石重甲', '不灭战衣', '玄武护甲'] },
  accessory: { label: '玉佩', innate: 'hpPct', nameWords: ['养气玉佩', '聚灵珠', '龙纹玉牌', '星辰坠', '琉璃珮', '镇魂玉', '归元珠', '不朽符箓'] },
  ring: { label: '戒指', innate: 'critRate', nameWords: ['聚灵戒', '龙魄戒', '疾风指环', '玄光戒指', '噬星戒', '幻影指环', '天罚戒', '虚空指环'] },
}

export const AFFIX_LABEL: Record<AffixType, string> = {
  atkPct: '攻击', defPct: '防御', hpPct: '气血', critRate: '暴击率', critDmg: '暴击伤害',
}

/** 词条原始数值范围（品阶倍率乘算前），命中越高说明这条词条"品质"越好 */
const AFFIX_RANGE: Record<AffixType, { base: number; span: number }> = {
  atkPct: { base: 1.5, span: 2.5 },
  defPct: { base: 1.5, span: 2.5 },
  hpPct: { base: 1.5, span: 2.5 },
  critRate: { base: 0.8, span: 1.5 },
  critDmg: { base: 3, span: 6 },
}

export interface EquipQualityDef { statMult: number; extraAffixCount: number }
/** 品阶复用角色稀有度的六档体系与配色（颜色语义在整个界面里统一，玩家不用学两套颜色） */
export const EQUIP_QUALITY: Record<Rarity, EquipQualityDef> = {
  yellow: { statMult: 0.8, extraAffixCount: 0 },
  xuan: { statMult: 1.0, extraAffixCount: 1 },
  di: { statMult: 1.3, extraAffixCount: 1 },
  tian: { statMult: 1.7, extraAffixCount: 2 },
  quasi: { statMult: 2.2, extraAffixCount: 2 },
  sheng: { statMult: 3.0, extraAffixCount: 3 },
}
/** 装备掉落品阶权重（未归一，掉落判定见 engine.ts） */
export const EQUIP_QUALITY_WEIGHT: Record<Rarity, number> = {
  yellow: 40, xuan: 30, di: 16, tian: 9, quasi: 4, sheng: 1,
}

/** roll 是这条词条的"品质位"：自然掉落恒在 [0,1)，洗练后**可以超过 1**（见 EQUIP_REFORGE） */
export interface EquipAffix { type: AffixType; value: number; roll: number }
export interface EquipItem { id: string; slot: EquipSlot; quality: Rarity; name: string; innate: EquipAffix; extra: EquipAffix[] }

function rollAffix(type: AffixType, statMult: number): EquipAffix {
  const roll = Math.random()
  const r = AFFIX_RANGE[type]
  const value = +((r.base + roll * r.span) * statMult).toFixed(1)
  return { type, value, roll }
}

const AFFIX_TYPES: AffixType[] = ['atkPct', 'defPct', 'hpPct', 'critRate', 'critDmg']

/**
 * 洗练：重掷一条**额外词条**，类型和数值一起重掷。
 *
 * 为什么需要它 —— 词条之间的价值差实测下来极大。以 80 关上下的中后期角色为例
 * （战力 7157：攻 2432 / 防 1479 / 血 10197 / 暴击率 15.8% / 暴伤 62%），
 * 不同词条在 charPower 里的边际贡献差了 3.5 倍：
 *   防御 +101 / 攻击 +91 / 气血 +52 / 暴击率 +30 / 暴击伤害 +29（天阶一条，战力）
 * 于是同样一件"圣·3 条额外词条"，三跳全滚防御值 +534 战力、全滚暴伤只值 +153 ——
 * **同一件圣装差 3.5 倍**，而玩家毫无补救手段（分解只是止损，等于把好胚子扔掉）。
 * 洗练就是那个补救手段，也是装备系统里唯一"把随机变成主动"的口子。
 *
 * 两条设计取舍：
 * 1. **只洗额外词条，不洗先天词条**。先天词条是槽位的身份（兵刃必给攻击、戒指必给暴击率），
 *    洗掉它"戒指"这个概念就不成立了；额外词条才是随机的部分，也才是玩家抱怨的部分。
 *    副作用是黄阶（0 条额外词条）天然不可洗——本来也是分解料。
 * 2. **阶越高，洗出的区间越好**。roll 取自 [floor, 1 + bonus]：
 *    floor 抬高保底，bonus 让上限**突破自然掉落**（自然掉落 roll 永远 ≤1，洗练可到 1.45）。
 *    均值恰好能一句话说清 —— 玄 ×1.35 / 地 ×1.50 / 天 ×1.66 / 准圣 ×1.84，
 *    **圣阶洗完后平均正好等于"自然掉落的满值"（×2.00）**，运气好还能再往上 45%。
 *    低品阶洗了几乎无感、高品阶才值得投入，于是"要不要洗"本身也是阶越高越划算。
 *
 * 消耗**只用灵金**，且是**固定价**：同一件装备，洗第 1 次和第 100 次一样贵，价格只由品阶决定，
 * **不随洗练次数增长**（对比商城的指数涨价）。灵金是挂机海量产出却几乎没有出口的资源（只被商城
 * 的指数涨价消耗），拿它当唯一消耗正好；斗气结晶留给增益阵，也不去抢升星要的玄晶/精血。
 * 固定价还有一个体验上的理由：玩家要能算出"我还差多少灵金就能洗出想要的词条"——价格一旦会涨，
 * 这个数就永远算不出来，"再洗几次"的决策也就无从做起，而洗练恰恰是要反复点的动作。
 *
 * 不设洗练次数上限：**"类型 1/5 随机 × 数值再随机"本身就是成本闸门**。圣阶想洗出指定的
 * 攻击或防御、并且接近区间上限，期望约 15 次 ≈ 300 万灵金，这个量级足够劝退"无脑洗满"。
 */
export const EQUIP_REFORGE: Record<Rarity, { floor: number; bonus: number; coin: number }> = {
  yellow: { floor: 0, bonus: 0, coin: 0 },
  xuan: { floor: 0.25, bonus: 0.10, coin: 1_500 },
  di: { floor: 0.32, bonus: 0.18, coin: 5_000 },
  tian: { floor: 0.40, bonus: 0.26, coin: 18_000 },
  quasi: { floor: 0.48, bonus: 0.36, coin: 60_000 },
  sheng: { floor: 0.55, bonus: 0.45, coin: 200_000 },
}

/**
 * 重掷一条额外词条（返回新词条，不修改入参）。这里不做任何合法性判断，
 * 品阶与索引的校验由调用方（engine.reforgeEquip）负责 —— 它才知道这件装备存不存在、
 * 玩家付不付得起。
 */
export function rollReforgedAffix(quality: Rarity): EquipAffix {
  const rf = EQUIP_REFORGE[quality]
  // roll 先取整到 3 位再算数值：这样 value 能由 roll **精确还原**（value = (base + roll*span) * 品阶倍率）。
  // 反过来先算值、再把 roll 存成近似值，就会出现"按存下来的 roll 倒推不出存下来的 value"——
  // 界面用 roll 决定词条的品质色阶，两份数据自相矛盾迟早会被人当成显示 bug 从头查一遍。
  const roll = +(rf.floor + Math.random() * (1 + rf.bonus - rf.floor)).toFixed(3)
  const type = AFFIX_TYPES[Math.floor(Math.random() * AFFIX_TYPES.length)]
  const r = AFFIX_RANGE[type]
  return { type, value: +((r.base + roll * r.span) * EQUIP_QUALITY[quality].statMult).toFixed(1), roll }
}

let equipSeq = 0
export function rollEquip(slot: EquipSlot, quality: Rarity): EquipItem {
  const q = EQUIP_QUALITY[quality]
  const info = SLOT_INFO[slot]
  const innate = rollAffix(info.innate, q.statMult)
  const extra: EquipAffix[] = []
  for (let i = 0; i < q.extraAffixCount; i++) {
    const type = AFFIX_TYPES[Math.floor(Math.random() * AFFIX_TYPES.length)]
    extra.push(rollAffix(type, q.statMult))
  }
  const word = info.nameWords[Math.floor(Math.random() * info.nameWords.length)]
  equipSeq += 1
  return { id: `eq${Date.now()}_${equipSeq}`, slot, quality, name: `${RARITY_INFO[quality].label}·${word}`, innate, extra }
}

/** 按权重抽一个品阶（用于常规掉落） */
export function rollEquipQuality(): Rarity {
  const total = Object.values(EQUIP_QUALITY_WEIGHT).reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (const rarity of Object.keys(EQUIP_QUALITY_WEIGHT) as Rarity[]) {
    r -= EQUIP_QUALITY_WEIGHT[rarity]
    if (r <= 0) return rarity
  }
  return 'yellow'
}

/**
 * 汇总一件装备全部词条到某个类型的加成总和（百分比数值，未除以 100）。
 * 对畸形装备要能兜住：旧版本存档 / 手工改坏的存档可能缺 innate 或 extra，
 * 而 charStats 是渲染路径上的函数，抛一次就是白屏；返回 0 顶多让这件装备暂时没加成。
 */
export function equipAffixSum(item: EquipItem, type: AffixType): number {
  if (!item || !item.innate) return 0
  let sum = item.innate.type === type ? item.innate.value : 0
  for (const a of item.extra ?? []) if (a && a.type === type) sum += a.value
  return sum
}

/**
 * 装备分解产物（给堆积的低阶装备一个出口）。
 * 产出指向玩家真正会缺的东西：武魂精血（1~5★ 升星）为主，天阶以上额外给玄晶（6~10★ 升星）。
 * 刻意不产出缘分丹——那是抽卡经济的地基，从"挂机就掉"的高频出口漏出去容易失控。
 * 量级校准：按掉落权重（黄40/玄30/地16/天9/准圣4/圣1）折合约 7.6 精血/件，
 * 1200 次击杀期望掉 70 件 ≈ 530 精血，约等于练满 1.8 个角色的 1~5★（单个满 300），
 * 相对 10~13 名角色的总需求仍是慢速补充，不会让升星失去意义。
 */
export const EQUIP_BREAKDOWN: Record<Rarity, { essence: number; xuanjing: number }> = {
  yellow: { essence: 3, xuanjing: 0 },
  xuan: { essence: 6, xuanjing: 0 },
  di: { essence: 10, xuanjing: 0 },
  tian: { essence: 16, xuanjing: 1 },
  quasi: { essence: 28, xuanjing: 2 },
  sheng: { essence: 45, xuanjing: 3 },
}

// ── 商城：限时增益（花灵金买临时 buff，到期消失，不增加任何存量资源）──────────────
export type BuffKind = 'crystal' | 'herb' | 'atk' | 'def'
export interface BuffDef { id: string; name: string; icon: string; desc: string; kind: BuffKind; pct: number; minutes: number }
export const SHOP_BUFFS: BuffDef[] = [
  { id: 'juling', name: '聚灵阵', icon: '💎', desc: '斗气结晶挂机产出 +100%', kind: 'crystal', pct: 100, minutes: 30 },
  { id: 'cuisheng', name: '催生阵', icon: '🌿', desc: '灵药挂机产出 +100%', kind: 'herb', pct: 100, minutes: 30 },
  { id: 'fengrui', name: '锋锐阵', icon: '🗡️', desc: '全队攻击 +20%', kind: 'atk', pct: 20, minutes: 30 },
  { id: 'jinzhong', name: '金钟阵', icon: '🛡️', desc: '全队防御 +25%', kind: 'def', pct: 25, minutes: 30 },
]

// ── 商城：商品（价格 = costMult × 生涯关卡奖励 × growth^当日已购次数，每日 0 点回落）──
// 不设购买次数上限，纯靠指数递增的价格限制——买得越多越贵，天然挡住"批量白嫖资源"。
export type ShopGoodKind = 'material' | 'buff' | 'equip'
export interface ShopGood {
  id: string; name: string; icon: string; desc: string
  kind: ShopGoodKind
  costMult: number   // 基准价倍率（× stageCoinReward(生涯最高关)）
  growth: number     // 每买一次，价格 ×growth
  item?: string      // material：资源 id
  amount?: number    // material：数量
  buffId?: string    // buff：对应 SHOP_BUFFS.id
}
export const SHOP_GOODS: ShopGood[] = [
  // 限时秘法
  { id: 'buff_juling', name: '聚灵阵', icon: '💎', desc: '斗气结晶挂机产出 +100%，30 分钟', kind: 'buff', costMult: 12, growth: 1.5, buffId: 'juling' },
  { id: 'buff_cuisheng', name: '催生阵', icon: '🌿', desc: '灵药挂机产出 +100%，30 分钟', kind: 'buff', costMult: 12, growth: 1.5, buffId: 'cuisheng' },
  { id: 'buff_fengrui', name: '锋锐阵', icon: '🗡️', desc: '全队攻击 +20%，30 分钟', kind: 'buff', costMult: 14, growth: 1.5, buffId: 'fengrui' },
  { id: 'buff_jinzhong', name: '金钟阵', icon: '🛡️', desc: '全队防御 +25%，30 分钟', kind: 'buff', costMult: 14, growth: 1.5, buffId: 'jinzhong' },
  // 奇货可居（养成材料）
  { id: 'essence', name: '武魂精血 ×30', icon: '🩸', desc: '升星 1~5★ 材料', kind: 'material', costMult: 18, growth: 1.7, item: 'essence', amount: 30 },
  { id: 'xuanjing', name: '玄晶 ×10', icon: '🔮', desc: '升星 6~10★ 材料', kind: 'material', costMult: 22, growth: 1.7, item: 'xuanjing', amount: 10 },
  { id: 'yuanfen', name: '缘分丹 ×1', icon: '🎴', desc: '抽卡货币，稀缺，慎买', kind: 'material', costMult: 60, growth: 2.0, item: 'yuanfen', amount: 1 },
  // 随机装备
  { id: 'equip', name: '随机装备 ×1', icon: '🎁', desc: '随机槽位 + 随机品阶（与战斗掉落同品质池）', kind: 'equip', costMult: 40, growth: 1.6 },
]

// 启动自检：任何角色漏配阵营都当场暴露，而不是悄悄吃不到羁绊（新增角色时最容易忘的就是这里）
for (const c of CHARACTERS) {
  if (!FACTION_OF[c.id]) console.warn(`[阵营] 角色 ${c.id} 未配置阵营，将吃不到任何羁绊加成`)
}
