// ─── 静态数据：境界、角色、地图、丹药、异火 ──────────────────────────────────

export type Rarity = 'yellow' | 'xuan' | 'di' | 'tian' | 'quasi' | 'sheng'
export type Role = 'melee' | 'aoe' | 'single' | 'heal' | 'control'
export type Position = 'front' | 'back'

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
  melee: { atk: 1.1, def: 1.0, hp: 1.0 },
  aoe: { atk: 1.0, def: 0.7, hp: 0.8 },
  single: { atk: 1.15, def: 0.7, hp: 0.75 },
  heal: { atk: 0.6, def: 0.8, hp: 1.1 },
  control: { atk: 0.85, def: 0.9, hp: 0.95 },
}

const ROLE_LABEL: Record<Role, string> = {
  melee: '近战输出',
  aoe: '群体法术',
  single: '单体法术',
  heal: '治疗辅助',
  control: '控制减益',
}

/** 攻击方式配色：战斗演出里按角色/怪物的招式类型给伤害数字/特效上色，区分打法手感 */
export const ROLE_COLOR: Record<Role, string> = {
  melee: '#ffd27a',
  single: '#a78bfa',
  aoe: '#ff8a3d',
  control: '#9ca3af',
  heal: '#4ade80',
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
  def('cailin', '彩鳞', 'di', 'back', 'aoe', '幼年古龙，稚气未脱却天赋异禀'),
  def('xiaoxunr', '萧薰儿', 'tian', 'front', 'melee', '天火之体，萧炎的青梅竹马'),
  def('yunyun', '云韵', 'tian', 'back', 'aoe', '美杜莎族女王，蛇噬之毒天下无双'),
  def('yaochen', '药尘', 'tian', 'back', 'heal', '炼药宗师，人称药老'),
  def('linmeiniang', '小医仙', 'tian', 'back', 'heal', '医毒双绝的谷主'),
  def('xiaoyan_zong', '萧炎（斗宗期）', 'quasi', 'front', 'melee', '历经磨砺，已然一方豪雄'),
  def('yunshan', '云山', 'quasi', 'front', 'control', '前云岚宗宗主，城府极深'),
  def('xiaoyan_di', '萧炎（斗帝终极）', 'sheng', 'front', 'melee', '一代斗帝，威震大陆'),
  def('yunyun_queen', '云韵（女王终极形态）', 'sheng', 'back', 'aoe', '蛇人一族至高女王，法力通天'),
  def('guqingfeng', '古清风', 'xuan', 'front', 'melee', '乌坦城城主，古元之父，刀法沉稳'),
  def('nalanjie', '纳兰杰', 'di', 'back', 'single', '纳兰嫣然之兄，云岚宗大长老，秘术阴狠'),
  def('xiaozhan', '萧战', 'di', 'front', 'control', '加玛帝国大长老，萧炎之父，统兵布阵手段老辣'),
  def('yuntianhe', '云天河', 'di', 'front', 'control', '加玛帝国太子，心机深沉，惯于以局制敌'),
  def('ziyan', '紫研', 'quasi', 'back', 'aoe', '身负龙凤精血，妖异之火焚尽敌阵'),
  def('tuoshe', '陀舍古猿', 'tian', 'front', 'aoe', '上古妖猿血脉，一声咆哮震裂山河'),
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
    drops: [{ item: 'coin', chance: 1, min: 300, max: 600 }, { item: 'xuanjing', chance: 0.12, min: 1, max: 2 }, { item: 'shard_sheng', chance: 0.04, min: 1, max: 1 }],
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

// ── 物品图鉴（用于展示名称/图标）───────────────────────────────────────────
export const ITEM_INFO: Record<string, { name: string; icon: string }> = {
  coin: { name: '灵金', icon: '🪙' },
  crystal: { name: '斗气结晶', icon: '💎' },
  herb: { name: '灵药', icon: '🌿' },
  yuanfen: { name: '缘分丹', icon: '🎴' },
  daoling: { name: '论道令', icon: '🎫' },
  essence: { name: '武魂精血', icon: '🩸' },
  xuanjing: { name: '玄晶', icon: '🔮' },
  shard_sheng: { name: '圣阶角色碎片', icon: '✨' },
  ...Object.fromEntries(FIRES.map(f => [`fire_${f.id}`, { name: `${f.name}·精华`, icon: f.icon }])),
  ...Object.fromEntries(PILLS.map(p => [p.id, { name: p.name, icon: p.icon }])),
}

// ── 升星：1~5★ 用武魂精血，6~10★ 用玄晶 ──────────────────────────────────
// 原设计上限 5★ 且仅需 225 精血/角色，实测第 1 天就满星，之后精血与玄晶双双溢出报废。
export const MAX_STARS = 10
export const STAR_ESSENCE_CAP = 5

/** 圣阶碎片兑换圣阶角色所需数量（原先碎片有掉落但无任何消耗入口） */
export const SHENG_SHARD_COST = 30

// ─ 抽卡保底：三层，抽到「该层或更高」即重置该层计数 ──────────────────────
// 定数依据：缘分丹是抽卡唯一货币，产出只有「主线每 5 关首领首通 1 颗 + 每 25 关额外 2 颗」，
// 实测线上存档（pityRare 只在触发时归零，所以它直接等于终身抽数）玩家终身只有 26~71 抽。
// **保底抽数必须小于终身抽数才有意义** —— 原先的「90 抽必出天阶+」全服无人触及，等于没做；
// 而且它 60% 概率掉天阶，就算攒到也是白攒。三层数字都按「终身 40~70 抽」这个量级定。
export const PITY_TIAN = 10     // 每 10 抽必出天阶+：消除「十连全白」的挫败
export const PITY_QUASI = 30    // 每 30 抽必出准圣+：55 关玩家终身 40 颗，坚持抽就一定拿得到
export const PITY_SHENG = 60    // 每 60 抽必出圣阶：26 名角色里只有 2 个圣阶，保持「玩到后期的里程碑」定位
/** 天阶保底抽的升格概率：保底也留点惊喜，不是每次都卡着最低档给 */
export const PITY_TIAN_UPGRADE = 0.1

export function starUpCost(stars: number): { item: 'essence' | 'xuanjing'; amount: number } {
  const next = stars + 1
  if (next <= STAR_ESSENCE_CAP) return { item: 'essence', amount: next * 15 }
  return { item: 'xuanjing', amount: (next - STAR_ESSENCE_CAP) * 8 }
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

export interface EquipAffix { type: AffixType; value: number; roll: number }
export interface EquipItem { id: string; slot: EquipSlot; quality: Rarity; name: string; innate: EquipAffix; extra: EquipAffix[] }

function rollAffix(type: AffixType, statMult: number): EquipAffix {
  const roll = Math.random()
  const r = AFFIX_RANGE[type]
  const value = +((r.base + roll * r.span) * statMult).toFixed(1)
  return { type, value, roll }
}

const AFFIX_TYPES: AffixType[] = ['atkPct', 'defPct', 'hpPct', 'critRate', 'critDmg']

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
