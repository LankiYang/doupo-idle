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

  // ─ v1.41 联动：凡人修仙传（**限时**，见下方 LINK_* 常量）─────────────────────
  // ⚠️ 这两名与其他角色有一处不同：**只在活动期内可获取**。活动结束后从抽卡池与兑换区
  //    一起移出（收口在 recruitPoolOf / redeemShard），已经拥有的永久保留。
  //    属性照旧由 def() 算出，同品阶同定位与其他角色完全一致 —— 联动不做数值优势。
  //    定位是补圣阶的两块空缺：圣阶原本没有单体（single）也没有单体医师（heal）。
  def('hanli', '韩立', 'sheng', 'back', 'single', '凡人修仙传联动 · 一介凡人，步步为营，青竹蜂云剑下从无侥幸'),
  def('yinyue', '银月', 'sheng', 'back', 'heal', '凡人修仙传联动 · 银月狼族，月华入体，只为一人疗伤'),

  // ─ v1.63 联名：燕云十六声（**限时**，见下方 LINK_SEASONS 第二期）─────────────
  // 三名**全部圣阶**，用户点名的定位：控制 / 坦克 / 法师。
  // ⚠️ 与凡人那两名同一条规矩：只在活动期内可获取，活动结束后从抽卡池与兑换区一起
  //    移出（收口在 recruitPoolOf / redeemShard），**但武魂名录里继续留名**——
  //    玩家原话：「联名结束了只是抽不到和兑换不到了，武魂名录里应该还继续展示」。
  //    属性照旧由 def() 算出，同品阶同定位与其他角色完全一致 —— 联名不做数值优势。
  //    定位是补圣阶的空缺：圣阶原本没有坦克（tank）也没有控制（control）。
  // ★ 江晏：初版是 melee，2026-09-23 用户改成 **control**（原话「把江晏这个角色更新成控制」）。
  //   改一个词就够 —— 面板由 ROLE_MULT 自动重算，压制机制由引擎按 role 判定，
  //   两处都不需要为这一个角色开特例（`engine.ts` 的「命中后挂 CONTROL_DEBUFF」只认 role）。
  //   ⚠️ 代价要知道：control 的 atk 倍率 0.85 vs melee 1.1 ⇒ 他面板攻击降约 23%，
  //      换来的是每次命中给目标挂攻 -20% / 防 -25%（持续 2 回合、命中即刷新）。
  //      这是**交换**，不是"顺手调弱"——别在没读懂这层交换之前把它调回 melee 的倍率。
  def('jiangyan', '江晏', 'sheng', 'front', 'control', '燕云十六声联动 · 玄色斗篷里裹着一线生机，雪夜废墟中也未曾松手'),
  def('bingshen', '丙申', 'sheng', 'front', 'tank', '燕云十六声联动 · 草笠垂符立于荆棘深处，旧袍磨破了也不退半步'),
  def('xiaocha', '玄骨上人·萧诧', 'sheng', 'back', 'aoe', '燕云十六声联动 · 玄骨上人，笑谈间魂火成阵，暖灯石室里最冷的那个人'),
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

/**
 * 段位小突破所需经验（斗气结晶）。
 *
 * ★ 2026-09-21 用户：「提升斗气结晶消耗的增长速度」（连同装备强化一起）。
 *   指数 1.9 → 2.1。差距全落在后期：10 级 1588→2517（1.59x）、
 *   100 级 12.6 万→31.7 万（2.51x）、200 级 47.1 万→135.9 万（2.89x）。
 *
 *   ⚠️ **别再把它往下调。** 中间有一版退到 2.0（那版 `20·L²` 恒为整数、
 *      数字好看，100 级正好 20 万），被用户当场纠正：「不是改少啊 还是保持高增速」。
 *      这个需求要的是**高增速本身**，不是"数字好读"。同理也别往 1.95 试探。
 *
 * ⚠️ 这条曲线是**角色养成主线**，爆炸半径比装备强化大得多，连带三处：
 *   1. `charInvestment` 反推历史投入 ⇒ **放生返还的结晶同步变多**（46 级 31.0 万→62.3 万）。
 *      这是自洽的：老档反推走的是同一个函数，不需要迁移数据。
 *   2. 结晶**产出端没动**，所以中后期会明显变慢 —— 若玩家反馈卡住，
 *      该调的是结晶掉落（`trainChar` 的产出侧），不是把指数退回去。
 *   3. 文档 `design/数值设计.md` §2 / §12 的公式与累计表已同步更新。
 */
export function xpToNext(level: number): number {
  return Math.floor(20 * Math.pow(level, 2.1))
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

/**
 * 天梯塔每层的灵药掉落（2026-09-19 用户：「在高层天梯塔掉落灵药 稍微高一点 你算一下」）。
 *
 * **定位：灵药的第二条来源。第一条永远是药园挂机**（`herbPerSec = 0.3 + 角色数×0.05`；
 * 2026-09-19 实测线上 25~56 人的真实存档 = **5580~11160/h**）。所以这条例子的分母是
 * **「挂机产出/小时」**，而不是终身总量 —— 与论道令商店那档（`LAB_HERB_COST`，分母是
 * "终身一次性货币"）**不是同一套定标方式**，别把两边的数拿来互相换算。
 *
 * 形状取 **随层数线性**：`floor × LAB_HERB_PER_FLOOR`。三个理由：
 *   · 塔每趟都从第 1 层重开（`startLab()`），所以"高层更肥"天然就是对强者的奖励，
 *     不必再写一个"第 N 层起才掉"的硬门槛；
 *   · 第 1~2 层向下取整后自然掉 0 ⇒ 等于自带一个**软门槛**；
 *   · 塔里另外两条常驻产出是「结晶 = 怪物血量/25」（指数）与「铜钱 = 定额 10」（常数），
 *     中间夹一条线性刚好，"稍微高一点"的量级与它俩都不冲突。
 *
 * ⚠️ **刻意不做首领层加成**：结晶那条在首领层更肥，是因为它读的 `labStats().hp` 里
 *    已经带了首领的 ×1.6；灵药若再单独乘一次，同一件事就有了两种说法。
 *
 * ⚠️ **这是常驻掉落、不是首通限定** —— 引擎推的 combatEvent 故意**不带 `first` 标记**，
 *    界面才会按「获得」而不是「首通奖励」渲染（见 LabView 的战报行）。标错了，
 *    每层都会显示"首通奖励"，可玩家并没有首通。
 *
 * ⚠️ 灵药**不是丹药的唯一成本**：`pillCraftCost` 里铜钱 = 灵药 × 1.6。塔里发的灵药要
 *    变成丹药，玩家还得拿得出 1.6 倍的铜钱；铜钱跟不上时灵药只会堆在背包里（线上
 *    真有一个 5270 万的存量）。**这条共闸就是数值不会失控的安全阀** —— 定标时别只
 *    盯着灵药那一侧。
 *
 * ── 系数 0.2 怎么来的（2026-09-19 实测，不是手算）──────────────────────────
 * 手算等于把引擎的回合节奏复述一遍（红线⑳），所以直接拿**线上产物**跑了 `calib-lab-herb.cjs`：
 * 把最高层玩家（生涯 124 层、56 人阵容）的真实存档喂进去，自动爬塔 **900 秒**，
 * 结果是 **推掉 153 层 = 612 层/h**（≈ 每小时 5 趟 1→124，两趟之间自动重开）。
 *
 * 关键推论：**每小时的层数几乎与实力无关**（每趟重开 ⇒ 推得慢的人只是重开得少、
 * 每趟短），所以 `灵药/h ≈ 612/N × Σ(floor(k·f), f=1..N)`，**随生涯层数 N 线性增长**。
 * 这正是"高层更肥"想要的方向 —— 强者拿得多，弱者也不会颗粒无收。
 *
 * 取 k=0.2 时（每层：[10 层]=2、[50 层]=10、[89 层]=17、[124 层]=24 灵药）：
 *   生涯 124 层 ≈ **7,400 灵药/h**（他自己挂机 11,160/h 的 66%）
 *   生涯  89 层 ≈ **5,260 灵药/h**（42 人挂机 8,640/h 的 61%）
 *   生涯  30 层 ≈ **1,650 灵药/h**（30 人挂机 6,480/h 的 25%）
 * 即"爬塔大约能把灵药收入再抬六成到七成"，但换不来同比例的丹药（铜钱那道闸见上）。
 * ⚠️ k 是**唯一**的调节旋钮：改它就同时改了所有层的值，别再加第二条曲线。
 */
export const LAB_HERB_PER_FLOOR = 0.2

/** 天梯塔第 floor 层击杀的灵药掉落（常驻，每层都给；1~2 层取整后为 0） */
export function labHerbReward(floor: number): number {
  return Math.floor(floor * LAB_HERB_PER_FLOOR)
}

// ─ 论道令商店价目（v1.35 补齐 8 品阶）──────────────────────────────────────
//
// **唯一权威**：界面显示与引擎扣费都读这一处。原先 `grade * 15` 在 LabView.tsx 和
// engine.ts 里**各写了一遍**，且商店只挂 1/3/5 品 —— 于是卡在 6/7/8 品突破点上的人
// 在论道令商店里买不到任何能用的东西。两份实现必然漂，这次收口。
//
// 定标依据：**论道令只在首通新层时发放**（engine 的 isFirstClear 分支），是终身一次性
// 资源、不是可刷的，所以价目必须按「终身总量」倒推 —— 而不是看着差不多就写个数：
//
//     首通到 30 层 → 累计  402 令      首通到 50 层 → 累计 1030 令
//     首通到 78 层 → 累计 2363 令（线上最高层）
//
// 曲线取 ×2 等比（与炼丹房 pillCraftCost 的 ×2 同形），基价 8，于是：
//   · 30 层玩家（402）能补齐到 5~6 品，**摸不到 7/8 品** —— 留出上升空间
//   · 50 层玩家（1030）**刚好换一颗 8 品**（1024），是个记得住的里程碑
//   · 78 层玩家（2363）能换 8 品 ×2
//
// ⚠️ 定位：论道令商店是**救急通道**，不是丹药的主来源。一个有 30 名角色的玩家一辈子要
//    360 颗丹药（每人 12 颗），终身论道令只够买其中一小部分 —— 这是**刻意**的，
//    主来源是炼丹房（灵药+灵金、可无限刷）。若把论道令定到能批量供货，炼丹房就废了。
//
// ⚠️ 低品阶便宜**没有风险**：每个品阶的终身需求有天然上限。
//    每个大境界卡一次突破，12 个境界的 pillGrade 依次是
//    1,2,3,3,4,4,5,5,6,7,7,8 ⇒ 每名角色终身需要
//    1 品×1、2 品×1、3 品×2、4 品×2、5 品×2、6 品×1、7 品×2、8 品×1（合计 12 颗）。
//    买超了也只是囤着，不会挤出任何别的东西。
export const LAB_PILL_BASE_COST = 8

/** 论道令商店：某品阶丹药的单价（grade 从 1 起；未定义品阶返回 Infinity，闸门在引擎） */
export function labPillCost(grade: number): number {
  const pill = PILLS.find(p => p.grade === grade)
  if (!pill) return Number.POSITIVE_INFINITY
  return LAB_PILL_BASE_COST * Math.pow(2, pill.grade - 1)
}

/** 论道令商店：武魂精血一档的价与量（同样收口，界面不再自己写一遍数字） */
export const LAB_ESSENCE_COST = 10
export const LAB_ESSENCE_AMOUNT = 20

/**
 * 论道令商店：灵药一档的价与量（2026-09-17 用户定：「论道商店允许购买灵药」）。
 *
 * ⚠️ **这一档有一条硬约束：1 令换到的灵药不能超过 ≈7.5 个**，否则「买灵药 → 炼丹房合成」
 *    会全面优于「直接买丹药」，128 令的 5 品丹、1024 令的 8 品丹就没人再买了 —— 而
 *    「终身论道令只够买一小部分丹药、丹药主来源是炼丹房」正是这个商店的定标前提（见上）。
 *    推导：1 品丹直购 `labPillCost(1) = 8 令`，炼一颗只要 `pillCraftCost(1).herb = 60 灵药`
 *    ⇒ 两条路等价当且仅当 60 / r = 8，即 **r = 7.5**。高于它，灵药路线反超。
 *    （炼丹还要额外花灵金，所以 r = 7.5 时直购仍严格更优。）
 *
 * 取 **r = 5**（本档 500 / 100），留出安全边际：炼一颗 1 品丹要 12 令，直购只要 8 令。
 * 参照物是精血那档（10 令 → 20 精血）。灵药比精血好刷得多（`herbPerSec = 0.3 + 角色数×0.05`
 * ⇒ 20 名角色约 4680/h；精血实测 228~342/h），所以换算成"买到的挂机时长"这一档是偏紧的 ——
 * **这是刻意的**：它是给溢出论道令的回收口，不是灵药的主来源（主来源永远是药园挂机）。
 *
 * 想调价只改这两个数，别去引擎或界面里再写一份（两份实现必然漂，见上面那段教训）。
 */
export const LAB_HERB_COST = 100
export const LAB_HERB_AMOUNT = 500

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

// ── 剧情战斗（v1.55）────────────────────────────────────────────────────
/**
 * 剧情战斗的强度规格。**写在 story.ts 的节点上**，由引擎读。
 *
 * 为什么剧情战斗要有自己的一套规格（用户 2026-09-22：「战斗你可以剧情的战斗
 * 不和主线战斗耦合」）：
 *   · 原先剧情节点直接挂在**主线关卡**上（`stage: 5` = 去打第 5 关）。
 *     那等于把剧情推进的速度交给玩家的练度 —— 一个把主线推到 60 关的人回来做第一章，
 *     打「萧家子弟」用的是 60 关的数值；而一个卡在 3 关的人则**永远做不完第一章**。
 *   · 更糟的是叙事上说不通：第一幕是"萧炎还是个三段的废物、被族人按在地上打"，
 *     而战斗用的是他一路练到 60 关的那支队。
 *
 * 解耦之后：剧情战斗的数值只看 `power`（一个编剧能直接写的档位），
 * **与玩家的主线进度、farmStage、连败计数一概无关**，胜负也不写回主线那套
 * （不掉关卡、不加 kill、不进 wipeStreak）。
 */
export interface StoryCombatSpec {
  /** 敌人名字。会进战报与敌方名牌，写成剧情里那个人（「萧家子弟」而不是「第 3 关的怪」） */
  name: string
  /**
   * 强度锚点：**取主线第几关的数值基线**（复用 `stageStats`，不另开一套成长曲线）。
   * 编剧只需要知道"这一场大概相当于第几关的强度"，不用碰任何数值公式。
   */
  power: number
  /** 人数 1~6。构成由 `enemyCompFor` 按 depth 推，与主线同一套规则 */
  count: number
  atkStyle?: AtkStyle
  /**
   * 用哪张怪物立绘（`sprites/monsters/` 的 id）。不传 = 没有立绘，战斗界面画一团地光顶替。
   *
   * ⚠️ 这一条**必须落在节点上**（`story.ts` 的 `combat.sprite`），不能在战斗界面按名字反查：
   *    "萧家子弟"和主线某关的怪可能重名，反查出来的图会让剧情里打的是另一批人。
   *    现成可用的：`family_disciple`（萧家子弟）/ `yunlan_elder` / `thug`（黑市打手）/
   *    `prince_guard`（吴家护卫）。完整清单见该目录。
   */
  sprite?: string
}

/** 剧情战斗的敌方阵容 */
export function enemyUnitsForStory(spec: StoryCombatSpec): EnemyUnit[] {
  const base = stageStats(spec.power)
  return makeEnemyUnits(enemyCompFor(spec.count, spec.power), base, spec.name, spec.atkStyle ?? 'melee')
}

/**
 * 剧情战斗的**目标回合数**（v1.55d）。
 *
 * 用户 2026-09-22：「战斗过程都没有，战斗都没有动画就结束了，注意数值」。
 *
 * 为什么需要这个数：敌人的基准数值来自 `stageStats(node.combat.power)`，那是**主线第 N 关**
 * 的怪（本作四个战斗格 power = 2/5/8/14 ⇒ 血 53/70/92/160、防 0~3）。而这套数值对
 * **已经推过主线的号**是离谱地低 —— 主线 130 关的玩家，单体攻击力是五位数起步，
 * 而伤害公式是 `max(1, atk − def×0.6)`（见 `fightRound`）⇒ **一刀就是几百倍于敌人总血**。
 * 于是 `onWaveClear` 在第一回合就触发、`storyOnWin` 立刻把 `storyBattle` 清掉，
 * 玩家看到的是「点开战 → 静止两秒（`ROUND_SEC`）→ 已经站在地图上了」。
 * 一句话：**这一屏在成型的号上等于不存在**，而剧情恰恰是老玩家回头才补的东西。
 *
 * 取 4 的依据：`ROUND_SEC = 2`、一回合内各角色按 `SEQ_MS = 220` 依次出手 ⇒
 * 4 回合 ≈ 8 秒，够看清"谁打谁、掉了多少"，又不至于让回看剧情的人等得不耐烦。
 * 这个数改了要同步看 `STORY_ENEMY_HP_BUDGET`（下面那条注释解释了为什么）。
 */
export const STORY_TARGET_ROUNDS = 4

/**
 * 敌人四个回合里**总共**打掉我方多少血（v1.55d）。
 *
 * 光把敌人血量撑起来只解决了一半 —— 基准 atk 同样低得离谱（power 14 的怪也才 13），
 * 打在高练度角色身上会被 `max(1, …)` 夹到 **1 点**：对面掉血、我方血条纹丝不动，
 * 读起来还是"没有过程"。所以攻击也要跟着放大。
 *
 * 取 0.30：血条每回合都肉眼可见地动（战术上"挨打了"），但**四个回合下来打不死人**。
 * 剧情战斗输了不掉任何东西、可以无限重来，但让玩家在看戏的路上先打输一次，是纯粹的打扰。
 */
export const STORY_ENEMY_HP_BUDGET = 0.30

/**
 * 敌人**单次**出手打掉我方单人多少血（按单人平均血量的比例，v1.55d）。
 *
 * 这是给上面那个总预算兜底的上限：伤害是**逐个结算**的（`pickFighters` 挑目标），
 * 不是均匀分摊到每个人头上。运气差的时候同一个角色会连着挨打，只算总预算的话，
 * 总账没超、人先没了。0.10 ⇒ 最坏情况（每回合被两个敌人盯上、四个回合）也才 4×2×0.10 = 80% 血，
 * 仍然死不了。
 */
const STORY_ENEMY_HIT_CAP = 0.10

/**
 * 把剧情战斗的敌人**按我方阵容重新定标**（v1.55d）。原地改 `enemies`。
 *
 * ── 基准为什么从**敌人自己身上读**，而不是再算一遍 `stageStats(power)` ──────
 * 第一版就是自己算的，结果低练阵容**直接打不过**：`stageStats(5)` 因为 5 是 5 的倍数
 * 被判成 Boss 关、一刀乘 1.6（hp 70 → 113），而 `enemyUnitsForStory` 那边实际用的是
 * `enemyCompFor` 算出来的 48。于是"下限"反而比真实基准高了一倍多。
 * 教训与红线里那条一样：**同一件事不许有两份实现** —— 基准值已经算好挂在 `maxHp` / `atk` 上了，
 * 这里只该拿来用。
 *
 * 传入的是**已经算好的我方四项合计**（由 `engine.startStoryBattle` 用 `mainFighterStats`
 * 求和后给），而不是一个 `(id) => stats` 的查表函数 —— 后者会让这个纯数值函数反过来
 * 依赖引擎的羁绊/装备口径，那正是"两份实现"的入口。
 *
 * ⚠️ 血量的 `Math.max` 是**保留下限**：阵容的输出弱到打不动基准敌人时（比如 1-15 对新手），
 *    仍然用基准值。也就是说这一改**只抬高、从不压低**，新手那一侧的手感分毫未动。
 */
export function scaleStoryEnemiesForParty(
  enemies: EnemyUnit[],
  party: { atk: number; hp: number; defAvg: number; count: number },
): void {
  const n = enemies.length
  if (n === 0) return
  const hpBase = enemies[0].maxHp
  const atkBase = enemies[0].atk

  // 血量：让全员一轮的裸攻击正好打掉 `1 / STORY_TARGET_ROUNDS`。
  // ×0.9 是给暴击与 ±15% 的随机波动留余量 —— 不留的话算出来是 4 回合、实际打 3 回合。
  const hpEach = Math.max(hpBase, Math.round((party.atk * STORY_TARGET_ROUNDS * 0.9) / n))

  // 攻击：伤害公式是 `max(1, atk − def×0.6)`，所以先把防御那一份加回去，
  // 算出来的才是"能打出预期伤害"的 atk（不然高防阵容会把伤害整个吃掉，每回合掉 1 点）。
  const defPart = party.defAvg * 0.6
  const perRoundBudget = (party.hp * STORY_ENEMY_HP_BUDGET) / STORY_TARGET_ROUNDS / n
  const perHitCap = (party.hp / Math.max(1, party.count)) * STORY_ENEMY_HIT_CAP
  const atkEach = Math.max(atkBase, Math.round(Math.min(perRoundBudget, perHitCap) + defPart))

  for (const e of enemies) {
    e.maxHp = hpEach
    e.hp = hpEach
    e.atk = atkEach
  }
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
  | 'fanren' | 'yanyun'

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
  // 联名阵营（v1.41）：两名成员 → **2 人档**；加成 8%（与散修 5 人档同值）：
  // 门槛是"两个位子都给联动角色"，条件比任何阵营都硬。
  // v1.63 起第三名联名角色萧诧也归这里（3 人档），见下方 LINK_SEASONS 第二期。
  fanren: {
    id: 'fanren', name: '凡人修仙', color: '#5eead4', motto: '步步为营',
    tiers: [
      { count: 2, atk: 8, hp: 8, desc: '全体攻击/气血 +8%' },
      { count: 3, atk: 16, hp: 16, desc: '全体攻击/气血 +16%' },
    ],
  },
  // 联名阵营（v1.63）：燕云十六声。两名成员 → 只有 2 人档，数值与凡人同档
  // （同样是"两个位子都给联名角色"的硬门槛，不给联名做数值优势）。
  // ⚠️ 它和凡人一样是**癞子阵营**，但两者**一次只能有一个生效**（见 WILDCARD_FACTIONS）。
  yanyun: {
    id: 'yanyun', name: '燕云', color: '#d9b45b', motto: '同袍同泽',
    tiers: [
      { count: 2, atk: 8, hp: 8, desc: '全体攻击/气血 +8%' },
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
  // 凡人修仙（v1.41 联动）：自成一派；v1.63 起第三名联名角色萧诧也归这里
  hanli: 'fanren', yinyue: 'fanren', xiaocha: 'fanren',
  // 燕云（v1.63 联名）：江晏、丙申两名
  jiangyan: 'yanyun', bingshen: 'yanyun',
}

/** 已上阵的某个阵营：人数与当前生效的档位（未达最低档时 tier 为 null） */
export interface ActiveBond {
  faction: FactionDef
  /** 计入档位的**有效人数**（含被凡人癞子补上的部分，见 `fromWild`） */
  count: number
  tier: FactionTier | null
  /** 上面那个 count 里有多少个是癞子替它凑的（v1.47）。0 = 这个阵营没吃到补位 */
  fromWild: number
}

export interface BondBonuses {
  atkPct: number
  defPct: number
  hpPct: number
  /** 直接加到暴击率上的百分点 */
  crit: number
  /** 全部有上阵成员的阵营（含未激活的），供界面展示"还差几个" */
  active: ActiveBond[]
  /** 这一次补给了哪个阵营（没补 / 场上没癞子时为 null）。界面用它说清"+N 是补上的" */
  wildcardHost: FactionId | null
  /** 是**哪个**癞子阵营补的（与 wildcardHost 同生共死）。界面用它写"凡人凑的"/"燕云凑的" */
  wildcardFrom: FactionId | null
  /**
   * 场上有、但**这一次没拿到补位权**的另一个癞子阵营（v1.63：燕云与凡人不叠加）。
   * 界面拿它说一句"两者只生效其一" —— 不说的话玩家会以为加成漏算了。
   */
  wildcardIdle: FactionId | null
}

/**
 * 癞子阵营：成员不只能凑自己那 2 人档，还能**替一个别的阵营补人数** ——
 * 玩家原话「有点像斗地主的癞子」（v1.47 凡人；v1.63 起燕云也具备这个能力，
 * 用户原话：「这两个角色属于燕云阵营，**也和凡人一样**能和其他阵营组队」）。
 *
 * 补的对象是**当前人数最多的那个非癞子阵营**，自动选、不给玩家挑：
 * 想让癞子补谁，就把谁凑成场上人最多的那个。
 *
 * ⚠️ 比较"谁人最多"时**不把癞子自己算进去**。2 凡人 + 2 萧家时两者并列，
 *    把凡人纳入比较会退化成一个没有答案的平局。**先在同一条船上比（非癞子之间），
 *    再补** —— 这样每个阵容都有唯一确定的解释。并列时取 `FACTIONS` 里声明在前的，
 *    声明顺序本身就是规则。
 *
 * ⚠️ **两个癞子同时在场时只有一个能补位**（用户原话：「但不能和凡人叠加」）。
 *    若两边都补，一个 2 人阵营能凭"2 真实 + 2 癞子"直接吃满最高档 —— 那等于把
 *    "凑阵营"这件事整个作废。规则是选**自身人数多的那个**当补位者，
 *    并列时取本数组**声明在前的**（凡人），所以任何一套阵容的解释都是唯一的。
 *    ⚠️ 这条是**决定函数**，别为了"看起来更慷慨"把它简化成两个都补：
 *    `temp/verify-link-yanyun.cjs` 里有反向闸专门钉住它。
 *
 * ⚠️ 这是**纯计算**：不入存档、不新增字段，所以没有任何迁移。
 *    代价是"谁补给了谁"每次都由当场阵容重算 —— 换阵容时它自己会变，这正是想要的。
 */
export const WILDCARD_FACTIONS: FactionId[] = ['fanren', 'yanyun']

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

  // 癞子：**先选出唯一的补位者**（自身人数多的胜，并列取声明在前的），再决定它补给谁。
  // 场上没癞子 ⇒ 两个变量都是 null ⇒ 谁也不补。
  let from: FactionId | null = null
  let fromN = 0
  for (const w of WILDCARD_FACTIONS) {
    const n = count[w] ?? 0
    if (n <= 0) continue
    // 必须**严格大于**才换人 ⇒ 并列时保留下标靠前的那个（= 声明在前），规则唯一
    if (from === null || n > fromN) { from = w; fromN = n }
  }
  let host: FactionId | null = null
  let hostN = 0
  if (from) {
    for (const def of Object.values(FACTIONS)) {
      if (WILDCARD_FACTIONS.includes(def.id)) continue
      const n = count[def.id] ?? 0
      // 必须**严格大于**才换人 ⇒ 首次出现的那个被保留 ⇒ 并列时取声明在前的
      if (n <= 0 || n <= hostN) continue
      host = def.id
      hostN = n
    }
  }
  // 场上有、但这次**没拿到补位权**的那个癞子。界面上要说一句，否则玩家会以为加成漏算了
  const idle = WILDCARD_FACTIONS.find(w => w !== from && (count[w] ?? 0) > 0) ?? null

  const out: BondBonuses = {
    atkPct: 0, defPct: 0, hpPct: 0, crit: 0, active: [],
    wildcardHost: host, wildcardFrom: from, wildcardIdle: idle,
  }
  for (const def of Object.values(FACTIONS)) {
    const own = count[def.id] ?? 0
    if (own <= 0) continue
    // 癞子自己按**实际人数**算档（补位是它给别人的能力，不给自家加人）；
    // 它补的那个阵营按「实际 + 补位者人数」算，于是可能直接跳档。
    const fromWild = def.id === host ? fromN : 0
    const n = own + fromWild
    const tier = [...def.tiers].reverse().find(t => n >= t.count) ?? null
    out.active.push({ faction: def, count: n, tier, fromWild })
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

// ── 升星：每 10 星一个品质档（v1.28.9 重做、v1.34 按实测产出重定标，见下方常量块） ──────────────────────────────────
// 原设计上限 5★ 且仅需 225 精血/角色，实测第 1 天就满星 —— 那段沿革已并入下方常量块。
// ── 升星常量（v1.28.9 重做、v1.34 重定标：每 10 星一个品质档，共 5 档）────────────────────
//
// 沿革：v1.7 上限 5★ 且只要 225 精血，第 1 天就满星、精血与玄晶双双溢出报废，于是把上限提到 10★。
// v1.28.9 又重演了同一件事 —— 线上 22 份云存档里 26/257 个角色已满 10★（5 名玩家手里有满星角色），
// 而碾压关的精血产出有 228~342/h，1~5★ 那 225 精血**挂机 1 小时就够**。
// **根因不是"上限太小"，是每一档的成本太平** —— 所以这次不是单纯拉长，而是把成本按档拉开：
//
//   · 1~10★   成本与属性一分不动（老档既有进度不作废、已满 10★ 的角色只会更强不会更弱）
//   · 11★ 起  每档的每星价是上一档的 3 倍，用玄晶
//
// 档位按「**每满 10 星提升一个品质**」划分：0~9 铜 / 10~19 银 / 20~29 金 / 30~39 赤 / 40~50 彩。
// 跨档时属性再给一次 +10% 跃升，让"品质提升"不只是换个颜色。
//
// **v1.34 重定标：上面那版的产出分母是错的。**
// v1.28.9 按「玄晶只有装备分解一个来源、6~9/h（首领关速刷约 60/h）」把 50★ 定成 3.2 万玄晶
// ≈ 500 小时。实测（`temp/measure-xuanjing.cjs`，真引擎 + 时钟加速 50×，中州普通关碾压
// 895 杀/h）真实产出是**约 154 玄晶/h** —— 怪物表直接掉落 141.6/h + 装备分解 12/h。
// 那个估算**只算了装备分解，漏掉了中州 `drops` 里每杀 12%×1~2 颗的直接掉落**，
// 低估 17~26 倍，于是"500 小时终局"实际只有约 **200 小时**、0→10★ 更是只要 1 小时。
//
// 这一版两个都按实测重定：
//   · 价格  11★ 起每星 **200 / 600 / 1800 / 5400**（档内恒定、每档 ×3）⇒ 升满累计
//           **8 万玄晶 ≈ 520 小时**，回到"终局长期目标"的原意
//   · 加成  每星 **8% / 6% / 4% / 3% / 2%** 逐档递减。原先恒定 8% 而成本每档 ×3，
//           等于后期花 27 倍的价钱买同一份加成；递减后 50★ 从 ×5.40 落到 **×3.70**
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

/** 11★ 起每档的**每星**玄晶价，索引 = 档位−1（银/金/赤/彩），每档 ×3。v1.34 按实测产出重定标 */
export const STAR_TIER_XUANJING = [200, 600, 1800, 5400]
/** 每档的**每星**属性加成，索引 = 档位（铜/银/金/赤/彩）。v1.34 起逐档递减，见上方常量块 */
export const STAR_TIER_PER_STAR = [0.08, 0.06, 0.04, 0.03, 0.02]
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
 * 每星加成**逐档递减**（`STAR_TIER_PER_STAR`），跨档再吃一次 `STAR_TIER_JUMP`。
 * 递减是为了让"每点属性的单价"随档位单调上升 —— 原先恒定 8% 而价格每档 ×3，
 * 后期花 27 倍价钱买同一份加成，性价比是断崖。
 *
 * 跃升次数取 `starTierIndex` 而不是 `floor(stars/10)`：后者在 50★ 会给第 6 次跃升，
 * 而颜色只到第 5 档（50★ 是彩星档的圆满、不是新的一档），两条口径必须同源。
 */
export function starMultOf(stars: number): number {
  const s = Number.isFinite(stars) ? Math.max(0, Math.min(MAX_STARS, Math.floor(stars))) : 0
  const tier = starTierIndex(s)
  let gain = 0
  for (let i = 0; i < tier; i++) gain += STARS_PER_TIER * STAR_TIER_PER_STAR[i]
  gain += (s - tier * STARS_PER_TIER) * STAR_TIER_PER_STAR[tier]
  return 1 + gain + STAR_TIER_JUMP * tier
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

// ── 限时联动（v1.41 起 · **按期管理**，v1.63 改成多期）─────────────────────
/**
 * 一次限时联名 = 一个 `LinkSeason`：几名角色 + 一个绝对时间窗。
 *
 * 规则（每一期都一样）：
 *   · 活动期内这几名武魂进抽卡池、可兑换，兑换价固定 `LINK_SHARD_COST`；
 *   · 活动结束后从**抽卡池与兑换区**一起移出，已拥有的永久保留；
 *   · **武魂名录（图鉴）里任何时候都继续留名** —— 玩家原话：
 *     「联名结束了只是抽不到和兑换不到了，武魂名录里应该还继续展示」。
 *
 * ⚠️ 判定必须按「**这名角色自己那一期**是不是开着」，不能按「有没有活动在进行」（v1.63 改）。
 *    原来只有一个全局的 `LINK_START_MS` + `linkActive()`：那种写法在第二期开起来时会
 *    把**上一期已经结束的角色一起放回池子**（`linkActive()` 为真 ⇒ 所有联动角色都算可获取）。
 *    现在收口到 `linkGettable(id)` 一个函数，池子、兑换、界面全部走它。
 *
 * ⚠️ 时间窗是**全服统一的绝对时刻**，不是"每个玩家各自的 24 小时"：公告上要写得出一个
 *    确定的截止时间，全服才在同一件事上。
 *
 * ⚠️ 判定读的是**客户端时钟**（`Date.now()`）。本项目没有"服务端下发时间"的通道，
 *    而抽卡本来就是纯客户端的（缘分丹与保底都在本地存档里）。把手机时间调回活动期的人
 *    能继续抽到联动角色 —— 已知并接受：这是单机放置游戏，他得自己改系统时间；
 *    要堵这个口就得把抽卡搬到服务端，代价远大于收益。
 */
export interface LinkSeason {
  /** 期次标识。**会被写进本地存储**（"这一期海报弹过了"），改动它等于让所有人都重看一次海报 */
  id: string
  /** 联名对象的名字：横幅与海报浮层上写的就是它 */
  title: string
  /** 这一期进池的武魂 */
  charIds: string[]
  /** 起始时刻（毫秒时间戳）。`<= 0` 视为"未定档"，整期都不生效（方便先加数据、后定时间） */
  startMs: number
  /** 时长。用户点名的「限时时间24h」 */
  durationMs: number
  /** 招募页横幅 / 海报浮层上那句"谁加入了招募" */
  tagline: string
  /** 海报浮层底部的一句补充说明，每期可以不一样 */
  note: string
}

/** 一期 24 小时。只是当前各期的取值，不是"每期都必须 24h"的硬规定 */
const LINK_24H = 24 * 3600 * 1000

/**
 * 全部联名期次。
 *
 * ⚠️ **历史期一并不许删**：`isLinkChar` / `shardCostOf` / 图鉴上的「联动」角标都靠它认人 ——
 *    删掉第一期，韩立与银月会当场失去"联动角色"身份（兑换价从 100 掉回 60、角标消失）。
 *    期次是"这名角色属于哪次联名"的**永久身份**，不是"现在开不开"的状态。
 */
export const LINK_SEASONS: LinkSeason[] = [
  {
    id: 'fanren',
    title: '凡人修仙传',
    charIds: ['hanli', 'yinyue'],
    // 2026-09-20 02:00 (UTC+8) —— **联名返场**：首期（09-18 01:00 ~ 09-19 01:00）结束后，
    // 韩立立绘与联名海报重画了一版（首期那句 "unremarkable ordinary looks" 是照原著
    // "平平无奇"写的，玩家反馈不好看），并把活动**原样再开 24 小时**让没赶上的玩家补上。
    // 结束时刻 = 2026-09-21 02:00 (UTC+8)，公告里写的就是这个绝对时刻。
    startMs: Date.UTC(2026, 8, 19, 18, 0),
    durationMs: LINK_24H,
    tagline: '韩立 / 银月 加入招募（圣阶）',
    note: '两名圣阶武魂 · 活动期 24 小时 · 结束后移出抽卡池与兑换',
  },
  {
    id: 'yanyun',
    title: '燕云十六声',
    charIds: ['jiangyan', 'bingshen', 'xiaocha'],
    // 2026-09-23 10:30 ~ 2026-09-24 10:30 (UTC+8)。公告与海报上写的都是这两个绝对时刻。
    startMs: Date.UTC(2026, 8, 23, 2, 30),
    durationMs: LINK_24H,
    tagline: '江晏 / 丙申 / 萧诧 加入招募（圣阶）',
    note: '三名圣阶武魂 · 活动期 24 小时 · 结束后移出抽卡池与兑换，武魂名录继续展示',
  },
]

/** 联动兑换价：**固定 100 枚**（不随品阶走），用户点名的数字。 */
export const LINK_SHARD_COST = 100

/** 这名角色属于哪一期联名（不是联动角色 ⇒ null）。**历史期也算"属于"**，见 LINK_SEASONS 的说明 */
export function linkSeasonOf(id: string): LinkSeason | null {
  return LINK_SEASONS.find(s => s.charIds.includes(id)) ?? null
}
export function isLinkChar(id: string): boolean {
  return linkSeasonOf(id) !== null
}
/** 这一期的结束时刻 */
export function seasonEndMs(s: LinkSeason): number { return s.startMs + s.durationMs }
/** 某一期**此刻**是否进行中。`now` 可注入 —— 判据要能把时钟拨到活动前 / 活动后 */
export function seasonActive(s: LinkSeason, now: number = Date.now()): boolean {
  return s.startMs > 0 && now >= s.startMs && now < seasonEndMs(s)
}
/** 正在进行的那一期（没有则 null）。界面拿它渲染横幅、倒计时与海报浮层 */
export function activeLinkSeason(now: number = Date.now()): LinkSeason | null {
  return LINK_SEASONS.find(s => seasonActive(s, now)) ?? null
}
/** 现在有没有任何一期在进行中 */
export function linkActive(now: number = Date.now()): boolean {
  return activeLinkSeason(now) !== null
}
/**
 * 这名武魂**此刻能否通过抽卡 / 兑换拿到**（非联动角色恒为 true）。
 *
 * ★ 所有"能不能获得"的判定都必须走这里，别再自己写 `isLinkChar(x) && linkActive()` ——
 *   那个写法在第二期开起来时会把上一期已经结束的角色一起放回池子。
 */
export function linkGettable(id: string, now: number = Date.now()): boolean {
  const s = linkSeasonOf(id)
  return !s || seasonActive(s, now)
}
/** 剩余时间（没有进行中的活动时为 0） */
export function linkRemainMs(now: number = Date.now()): number {
  // 只在活动期内给正数：活动还没开始时按「结束时刻 - 现在」算会得到 24 小时出头，
  // 调用方拿它做倒计时就会显示成"活动已开、还剩 24 小时"，是个会骗人的数。
  const s = activeLinkSeason(now)
  return s ? Math.max(0, seasonEndMs(s) - now) : 0
}
/**
 * 兑换价：联动角色固定 100 枚，其余按品阶。
 * **引擎与界面都必须走这一个函数** —— 两处各算一遍迟早分叉，这个项目已经栽过三次。
 */
export function shardCostOf(c: CharacterDef): number {
  return isLinkChar(c.id) ? LINK_SHARD_COST : SHARD_COST[c.rarity]
}
/**
 * 某个品阶**当前**的抽卡池。联动角色只在**自己那一期**的窗口内进池子。
 * 抽卡一律走这里、不要自己 `CHARACTERS.filter` —— 那是"活动结束后还能抽到联动角色"的唯一来源。
 */
export function recruitPoolOf(rarity: Rarity, now: number = Date.now()): CharacterDef[] {
  return CHARACTERS.filter(c => c.rarity === rarity && linkGettable(c.id, now))
}
/**
 * 联动角色**未拥有、且当前拿不到**时给玩家看的那句话。
 *
 * 分两种措辞是因为"活动开始前"说"已结束"是假话 —— 图鉴里随时能点到这些卡，
 * 而活动前后都是拿不到的（红线⑩：给玩家的话必须如实）。
 *
 * v1.63 起**按这名角色自己那一期**取词：第二期开着的时候点开韩立，
 * 说的应该是"凡人修仙传联动已结束"，而不是笼统的"限时联动已结束"。
 */
export function linkClosedText(id: string, now: number = Date.now()): string {
  const s = linkSeasonOf(id)
  if (!s) return '这名武魂暂不可获得'
  return now < s.startMs
    ? `${s.title}联动尚未开启 · 这名武魂暂不可获得`
    : `${s.title}联动已结束 · 这名武魂暂不可获得`
}

// ─ 抽卡保底：三层，抽到「该层或更高」即重置该层计数 ──────────────────────
// 定数依据：缘分丹是抽卡唯一货币，产出只有「主线每 5 关首领首通 1 颗 + 每 25 关额外 2 颗」，
// 实测线上存档（pityRare 只在触发时归零，所以它直接等于终身抽数）玩家终身只有 26~71 抽。
// **保底抽数必须小于终身抽数才有意义** —— 原先的「90 抽必出天阶+」全服无人触及，等于没做；
// 而且它 60% 概率掉天阶，就算攒到也是白攒。三层数字都按「终身 40~70 抽」这个量级定。
export const PITY_TIAN = 10     // 每 10 抽必出天阶+：消除「十连全白」的挫败
export const PITY_QUASI = 30    // 每 30 抽必出准圣+：55 关玩家终身 40 颗，坚持抽就一定拿得到
export const PITY_SHENG = 60    // 每 60 抽必出圣阶：54 名常驻里有 6 个圣阶（联动期另有 2 名限时进池），保持「玩到后期的里程碑」定位
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
// **词条数值的基准完全由品阶决定**，不看角色等级。
//
// v1.38 起装备有自己的**强化等级 `lv`**（用户："装备新增装备升级功能…装备等级要在外部外显"）。
// 它与上面那条取舍并不冲突：强化是给**这件装备的词条**乘一个系数（见 EQUIP_ENHANCE），
// 不是把词条改成"随角色等级缩放的绝对数值"——所以同一件 +12 天阶穿在 10 级和 1000 级角色身上
// 依然是同一个百分比加成，超模风险一个字都没多。
// 早期那版注释写的是"装备本身不再需要装备等级"，指的是**不要角色等级绑定**那件事，别误读成"永远不做强化"。

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
/**
 * `lv` 是 v1.38 的**强化等级**（0 ~ 该品阶的上限，见 EQUIP_ENHANCE）。
 *
 * ⚠️ 它必须由 `sanitizeEquipItem` 兜底成 0 —— v1.38 之前掉落的每一件装备都没有这个字段，
 * 而 `equipAffixSum` 在渲染路径上，缺字段时一旦算出 NaN 就是白屏。**不加字段改不了需求，
 * 但"缺字段不能死档"是红线**：所有读取处一律走 `equipEnhMult`（它对非有限值返回 1 倍）。
 */
export interface EquipItem { id: string; slot: EquipSlot; quality: Rarity; name: string; innate: EquipAffix; extra: EquipAffix[]; lv: number }

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

/**
 * 「洗练可换回」的适用面：**最高阶（圣阶）的武器**。
 *
 * 用户要求：「最高阶的武器洗练允许玩家保留旧的还是选择新的，两个在一起对比，做一个这个机制」。
 * 落地的语义是**默认采用新结果 + 给一次换回原词条的机会**，而不是"没选就不生效"：
 * 洗练是玩家会连点的动作，每洗一条都卡一个必须确认的弹窗，会把连洗变成折磨；
 * 而圣阶武器的洗练单价 20 万灵金、洗出想要的那条期望约 15 次（见 EQUIP_REFORGE 的注释），
 * 一次手滑洗掉一条极品词条是这个游戏里最贵的一种不可逆 —— 所以才给它一次反悔。
 *
 * **只在最高阶武器上开**：低阶装备本来就该被洗掉或分解，多一步选择只是负担。
 * 判定收口在这一个函数里：将来要扩到"所有圣阶装备"或"所有装备"，只改这一处；
 * 引擎与组件都不许自己判 `quality`/`slot`（两份口径迟早分叉）。
 */
export function canUndoReforge(item: { quality: Rarity; slot: EquipSlot } | null | undefined): boolean {
  return !!item && item.quality === 'sheng' && item.slot === 'weapon'
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
  return { id: `eq${Date.now()}_${equipSeq}`, slot, quality, name: `${RARITY_INFO[quality].label}·${word}`, innate, extra, lv: 0 }
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
 *
 * **含强化倍率**（v1.38）：这是"这件装备实际给了多少"的唯一出口，engine 的 charStatsRaw
 * 五个词条全走这里，所以强化一旦挂上就自动进了属性、战力、一键穿戴、分解判定的每一处，
 * 不存在"某处忘了乘"的分叉。要拿**白板数值**（界面逐条显示词条）请直接读 item.innate/extra，
 * 别从这里反推。
 *
 * 对畸形装备要能兜住：旧版本存档 / 手工改坏的存档可能缺 innate 或 extra、
 * v1.38 之前的每一件都缺 lv，而 charStats 是渲染路径上的函数，抛一次就是白屏；
 * 返回 0（或 1 倍）顶多让这件装备暂时没加成。
 */
export function equipAffixSum(item: EquipItem, type: AffixType): number {
  if (!item || !item.innate) return 0
  let sum = item.innate.type === type ? item.innate.value : 0
  for (const a of item.extra ?? []) if (a && a.type === type) sum += a.value
  return sum * equipEnhMult(item.lv)
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

// ── 装备强化（v1.38，用户："装备新增装备升级功能…强化消耗斗气结晶和武魂精血，按照品质消耗"）──
/**
 * 强化三件事：**每级给这件装备的词条乘 1 + 5%**、**上限按品阶**、**价目按品阶**。
 *
 * 1) 为什么是乘词条、而不是加一条新属性：
 *    装备词条全是百分比（见文件顶部的取舍），乘上去天然跟着品阶与洗练走——
 *    洗得好的胚子强化收益也高，两套系统是叠乘关系而不是各说各话。
 *    倍率**线性不叠乘**（`1 + 0.05 × lv`，不是 `1.05^lv`）：满级必须是玩家能心算的数，
 *    "圣装 +24 = 词条 ×2.2"一句话说得清；改成复利就变成 ×3.2，界面上也没法向玩家解释。
 *
 * 2) 上限按品阶 = 4 × 阶序（黄4 / 玄8 / 地12 / 天16 / 准圣20 / 圣24）。
 *    于是满级倍率恰好是 1.2 / 1.4 / 1.6 / 1.8 / 2.0 / 2.2 —— 与六档品阶同构，落差可控。
 *    低阶装备不是"不能强化"，而是**强到底也比不过一件白板高阶**（黄满 ×1.2 的 statMult 仍是 0.96，
 *    玄白板就是 1.0），这样"低级装备该分解"的判断不会被强化搅乱。
 *
 * 3) 价目按品阶分档、**每级单价随等级加速上涨**（第 n 级 = 基价 × n^1.5，n 从 1 起）。
 *    2026-09-21 用户「提升斗气结晶消耗的增长速度」之前是**线性**的 `基价 × n`；
 *    改动理由、实测放大倍数、以及精血为什么没跟着动，都写在 `enhCrystalAt` 的注释里。
 *    ⚠️ 中途曾退到 1.3 又被用户打回：「不是改少啊 还是保持高增速」——
 *    这条需求要的是高增速本身，别再往 1.3 折中。
 *    为什么强化敢涨价、而洗练必须固定价：洗练是**无限次**的重复动作，价格会涨的话
 *    "再洗几次"就永远算不出预算（见 EQUIP_REFORGE 的注释）；强化是**有上限**的有限进度，
 *    UI 直接把"下一级要多少"摆在按钮旁，涨价反而是"越到后面越贵"的自然表达。
 *
 * 4) 数值定标：只用**已实测的线上存档存量**反推，不拍脑袋（见 design/数值设计.md §21）。
 *    顶层玩家（125 关）结晶持有 1500 万~6500 万、武魂精血持有 4500~12000，
 *    而精血终身只被升星吃掉 1350~2700 —— 这两样正是**大量闲置、几乎没出口**的资源，
 *    拿它们当强化货币等于给挂机收益开了个新出口，而不去抢升星要的玄晶。
 *    满强化总价（结晶 = Σ 基价×n^1.5，**逐级取整再累加**；精血 = 基价 × cap(cap+1)/2）：
 *      黄 1.36 万 / 20 精血      玄 21.0 万 / 108      地 132 万 / 390
 *      天 663 万 / 1088          准圣 2663 万 / 2730    圣 9505 万 / 6000
 *    ⚠️ 结晶这六个数是 2026-09-21「提升增长速度」**之后**的值。改动前是线性的
 *       （黄 0.8 万 / 玄 9.0 万 / 地 46.8 万 / 天 204 万 / 准圣 735 万 / 圣 2400 万），
 *       放大倍数从 1.70x（黄）一路到 3.96x（圣）—— **品阶越高被抬得越多**。
 *
 *    **精血价上线当天由用户上调过一档**（用户："精血消耗再稍微加高一点点"）：基价由 1/2/3/6/10/16
 *    提到 2/3/5/8/13/20，结晶价不动。精血虽是闲置资源，但它也是升星的燃料，
 *    强化若吃得太少就等于"白送"，调高后顶层强满一件圣装要 6000 精血（约其手上的一半存量）。
 *
 *    ⚠️ **校准点被这次提速打破了，需要重新定标** —— 照实记下来，免得下一个人以为它还算数。
 *       原文是「顶层 1500 万够两件圣装、或一套天阶四件还剩一半；中低层 3 万刚好一件地阶」。
 *       核对（按改动**前**的线性价）：天阶四件 816 万 ✓ 对得上；但"两件圣装"要 4800 万 ✗、
 *       "3 万够一件地阶"要 46.8 万 ✗ —— 这两条在提速**之前**就已失准，是更早一版数值留下的。
 *       提速后差距进一步拉开：1500 万连**一件圣装的六分之一**都不够（需 9505 万），
 *       只剩 2.26 件天阶（凑不齐四件），地阶涨到 132 万。
 *       ⚠️ 要恢复"每一档都够得着、但都要攒"的手感，**该改 `EQUIP_ENHANCE` 各档基价** ——
 *       退指数等于取消这次需求，用户已明确否掉（「不是改少啊 还是保持高增速」）。
 */
export interface EquipEnhanceDef {
  /** 强化等级上限（0 ~ cap） */
  cap: number
  /** 第 1 级的斗气结晶价；**第 n 级 = 此值 × n^1.5**（加速上涨，见 enhCrystalAt） */
  crystal: number
  /** 第 1 级的武魂精血价；第 n 级 = 此值 × n */
  essence: number
}
export const EQUIP_ENHANCE: Record<Rarity, EquipEnhanceDef> = {
  yellow: { cap: 4, crystal: 800, essence: 2 },
  xuan: { cap: 8, crystal: 2_500, essence: 3 },
  di: { cap: 12, crystal: 6_000, essence: 5 },
  tian: { cap: 16, crystal: 15_000, essence: 8 },
  quasi: { cap: 20, crystal: 35_000, essence: 13 },
  sheng: { cap: 24, crystal: 80_000, essence: 20 },
}

/** 每级给词条加的倍率（线性：满级倍率 = 1 + 0.05 × cap） */
export const EQUIP_ENH_PER_LV = 0.05

/** 分解强化过的装备时退还的**已投入材料**比例（与放生返还同一个数，语义也同一个：留 30% 当换装成本） */
export const EQUIP_ENH_REFUND = 0.7

/** 该品阶的强化上限 */
export function equipEnhCap(quality: Rarity): number {
  return EQUIP_ENHANCE[quality]?.cap ?? 0
}

/**
 * 强化倍率。**对缺失/畸形字段返回 1**：v1.38 之前掉落的装备一条 `lv` 都没有，
 * 而本函数在 charStats 的渲染路径上，返回 1 顶多是"这件暂时没强化加成"，抛错就是整页白屏。
 */
export function equipEnhMult(lv: number | undefined): number {
  const n = Number.isFinite(lv) ? Math.max(0, Math.floor(lv as number)) : 0
  return 1 + EQUIP_ENH_PER_LV * n
}

/**
 * 强化第 k 级（k 从 1 起）的**斗气结晶**价。
 *
 * ★ 2026-09-21 用户：「提升斗气结晶消耗的增长速度」。
 *   原来每一级是 `基价 × k` —— 级差恒等于基价，是**匀速**增长（等差）。
 *   改成 `基价 × k^1.5` 之后，级差本身随 k 变大 ⇒ 真正"越往后越贵"。
 *   实测放大倍数：圣装满强化累计 2400 万 → 9505 万（3.96x）、天阶 3.25x、
 *   玄阶 2.33x、黄装只 1.70x —— **改动全部落在后期**，前期几乎无感。
 *
 *   ⚠️ **别再把它往下调。** 中间有一版退到 1.3（圣装砍到 5449 万），
 *      被用户当场纠正：「不是改少啊 还是保持高增速」。1.0 就等于退回线性
 *      = 取消这次需求；1.3 这种"折中"也不要再试。
 *
 * ⚠️ 武魂精血那一半**没动**（用户只说了斗气结晶），仍是 `def.essence × k` 线性。
 *    两边刻意不同步：真要动精血，改 `equipEnhCost` 里那一项即可。
 * ⚠️ `equipEnhCost` 与 `equipEnhSpent` **必须共用这一个函数**。累计投入是"分解退还七成"
 *    的依据，两处各算各的（哪怕数学上等价）迟早会因为取整差出一点，
 *    表现是"退还的比显示投入的少几颗"——最难查的那类。所以累计走逐级累加，不套求和公式。
 */
export function enhCrystalAt(base: number, k: number): number {
  return Math.round(base * Math.pow(k, 1.5))
}

/** 从 lv 强化到 lv+1 要花多少（已满级返回 0，调用方无需自己判断上限） */
export function equipEnhCost(quality: Rarity, lv: number): { crystal: number; essence: number } {
  const def = EQUIP_ENHANCE[quality]
  const n = Number.isFinite(lv) ? Math.max(0, Math.floor(lv)) : 0
  if (!def || n >= def.cap) return { crystal: 0, essence: 0 }
  return { crystal: enhCrystalAt(def.crystal, n + 1), essence: def.essence * (n + 1) }
}

/** 强化到 lv 级**累计**投入了多少（斗气结晶 Σ 逐级价，精血 Σ 基价×i）—— 分解退还的依据 */
export function equipEnhSpent(quality: Rarity, lv: number): { crystal: number; essence: number } {
  const def = EQUIP_ENHANCE[quality]
  const n = Number.isFinite(lv) ? Math.max(0, Math.min(Math.floor(lv), equipEnhCap(quality))) : 0
  if (!def || n <= 0) return { crystal: 0, essence: 0 }
  let crystal = 0
  // 逐级累加而不是套 Σk^1.5 的闭式：每一级都被 Math.round 过，闭式会与逐级买到的总价差几颗
  for (let i = 1; i <= n; i++) crystal += enhCrystalAt(def.crystal, i)
  return { crystal, essence: def.essence * ((n * (n + 1)) / 2) }
}

/**
 * 分解时退还的强化材料（投入的 70%，向下取整）。
 *
 * 为什么必须退：满强化的圣装投入 2400 万结晶 + 4800 精血，一次误点"分解"就全没了——
 * 那是玩家挂机几十小时的产出，界面上的二次确认挡不住"我以为这是件垃圾"。
 * 为什么只退 70%：全额退等于强化材料可以随身携带，"强化一件便宜的、分解、再强化贵的"
 * 就成了零成本搬运，强化也就不再是**这件装备**的投入了。留 30% 当换装成本，与放生返还同一个口径。
 */
export function equipEnhRefund(quality: Rarity, lv: number): { crystal: number; essence: number } {
  const s = equipEnhSpent(quality, lv)
  return { crystal: refundOf(s.crystal), essence: refundOf(s.essence) }
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
