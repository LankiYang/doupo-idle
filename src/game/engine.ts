// ─── 游戏引擎 v1：境界成长、组队战斗、招募抽卡、离线结算 ──────────────────────
import { useSyncExternalStore } from 'react'
import {
  CHARACTERS, FIRES, PILLS, ITEM_INFO, RARITY_INFO, LAB_BLESSINGS,
  xpToNext, needsPillFor, pillGradeFor, realmLabel, realmMult,
  stageStats, isBossStage, zoneForStage, monsterForStage, stageCoinReward,
  labStats, isLabBoss, labDaolingReward, labHerbReward,
  labPillCost, LAB_ESSENCE_COST, LAB_ESSENCE_AMOUNT, LAB_HERB_COST, LAB_HERB_AMOUNT,
  enemyUnitsForStage, enemyUnitsForFloor, enemyUnitsForStory, scaleStoryEnemiesForParty, DUTY_OF_ROLE, bondBonusesFor,
  MAX_STARS, starUpCost, starMultOf, starTierIndex, starTierOf, DUPE_SHARD,
  shardCostOf, recruitPoolOf, linkGettable, linkClosedText,
  refundOf, refundPillsOf, charInvestment,
  PITY_TIAN, PITY_QUASI, PITY_SHENG, PITY_TIAN_UPGRADE,
  rollEquip, rollEquipQuality, equipAffixSum, EQUIP_BREAKDOWN, EQUIP_REFORGE, rollReforgedAffix, canUndoReforge,
  equipEnhCap, equipEnhCost, equipEnhSpent, equipEnhRefund,
  SHOP_BUFFS, SHOP_GOODS,
  type CharacterDef, type Rarity, type EquipSlot, type EquipItem, type EquipAffix, type BuffKind,
  type EnemyUnit, type Role, type AtkStyle, type BondBonuses, type ControlDebuff,
} from './data'
import { playSound } from './sound'
import { fetchRemoteRewards, type RemoteReward } from './rewards'
import {
  ACTIVITY_METRICS, activeActivities, activityStatus, fetchActivities, todayKey, scaledItems,
  type ActivityDef,
} from './activities'
// 服务端宿主用它解析 `activities/activities.json`（Node 里没有 fetch，见 SPEC §4.5.5）。
// 从引擎入口再导出，是为了让 `dist-engine/engine.cjs` **一个产物就够服务端用** ——
// 否则宿主得自己再写一份解析，而两份解析必然分叉（§4.1 反复吃过这个亏）。
export { parseActivities } from './activities'
// 同上：服务端宿主用它解析 `rewards/rewards.json`（全服福利在服务端权威下必须由服务端发）
export { parseRewards } from './rewards'
// 剧情数据从引擎入口再导出，理由与上面两条一样：**服务端产物只能有一个入口**
// （`dist-engine/engine.cjs`）。离线校验脚本要拿节点表/序章做对账，
// 服务端要拿节点表做前置校验，各自再去 require 一份 story.ts 就是第二份真相。
export { PROLOGUE, CHAPTER1, CHAPTER1_ACTS, SCRIPTS, HANDBOOK, STORY_UNLOCK_NODE, ALL_NODE_IDS } from './story'
import { mailGiftKey, type Mail } from './mail'
import { SAVE_KEY, SAVE_BAK_KEY } from './storageKeys'
import { apiFetch } from './authApi'
import { getRemotePid, isRemoteMode } from './remoteMode'
import {
  PROLOGUE, CHAPTER1, CHAPTER1_ACTS, SCRIPTS, HANDBOOK, STORY_UNLOCK_NODE, ALL_NODE_IDS,
  type StoryNode, type ScriptLine, type PrologueAct, type HandbookStep, type StoryAct,
} from './story'

export interface RosterEntry { level: number; xp: number; stars: number; equip: Partial<Record<EquipSlot, EquipItem>> }

/** 洗练结果。失败一律带 why 给玩家看 —— 洗练是玩家要反复点的按钮，"点了没反应"最难排查 */
export interface ReforgeResult { ok: boolean; why?: string; affix?: EquipAffix }

/**
 * 一次「可换回」的洗练：记住**洗之前那条词条**，玩家可以在它被下一次洗练覆盖前换回去。
 *
 * 只对最高阶武器记账（见 data.ts 的 canUndoReforge）。**它随存档走**（`state.reforgeUndo`）：
 * 这个机制的全部价值就是"别让一次手滑变成永久损失"，只放内存里等于一半时候没有
 * （切后台被系统杀、手抖刷新都会吞掉它）。存档里的老值一律是 null，形状不对也当没有。
 */
export interface ReforgeUndo { itemId: string; idx: number; from: EquipAffix }

/** 强化结果。`levels` 是**实际强化成了几级**：要求 5 级但精血只够 2 级时返回 2，不是 0 */
export interface EnhanceResult { ok: boolean; levels: number; why?: string }

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'accessory', 'ring']
/** 暴击伤害基础倍率：没有戒指/词条时暴击率为 0，此值不生效；有暴击后按此为基准叠加装备的暴击伤害词条。
 *  导出给界面用（结缘页要显示未拥有角色的初始暴击伤害）—— 显示的是这个常量本身，不是复述它的算式。 */
export const BASE_CRIT_DMG = 50
/** 单次掉落判定的基础概率，首领额外加成见 onKill/labOnKill */
const EQUIP_DROP_CHANCE = 0.06
const EQUIP_DROP_CHANCE_BOSS = 0.35
export type TeamSlot = string | null
/** 阵位坐标（拖拽/换位用）：哪一排的第几格 */
export type TeamSlotPos = { row: 'front' | 'back'; index: number }

/** 阵容格数（v1.28：5 → 6）。前排 3 格是承伤位，后排 3 格是输出/治疗位 */
export const TEAM_FRONT_SIZE = 3
export const TEAM_BACK_SIZE = 3

export interface BattleState {
  /** 本场战斗的敌方阵容：开战时一次性定妥（见 data.ts 的 EnemyUnit），战斗中只有 hp / debuff 会变 */
  enemies: EnemyUnit[]
  roundTimer: number
  fighterHp: Record<string, number>
  /** 当前这一波已经打了几个回合（清波归零）。敌方治疗量按它衰减，见 ENEMY_HEAL_RATIO */
  rounds?: number
  /**
   * 我方队员身上的压制（由敌方 `control` 施加，见 CONTROL_DEBUFF）。
   *
   * 这里用 map 而敌方的减益挂在单位上，是因为**我方队伍在清波时不会重建**，
   * 没有"换了一批新对象"来自动清掉旧状态，只能自己按回合递减。
   *
   * 可选字段：战斗状态读档时一律置 null（见 migrate），所以它其实不跨存档；
   * 标成可选只是让 `startBattle` 之外的构造点（测试夹具）不必逐个填。
   */
  fighterDebuff?: Record<string, ControlDebuff>
}

/**
 * 战斗演出事件。
 *
 * 三个指向字段的语义（多单位战斗后需要分得清"谁打了谁"，v1.28 起）：
 * - `who`  **永远指我方**：dmg/heal 时是出手/被治的角色 id，monsterDmg/down 时是挨打的角色 id
 * - `target` 我方出手的敌方单位 uid（dmg）
 * - `from`   敌方出手的单位 uid（monsterDmg）
 *
 * 「who 永远指我方」是刻意的——FighterCard 靠 `e.who === id` 找自己该播的动画，
 * 让它同时兼作敌方标识会把每个受击分支都拆成两半。
 */
export interface CombatEvent { type: 'dmg' | 'heal' | 'monsterDmg' | 'kill' | 'drop' | 'down'; value: number; who?: string; item?: string; time: number; source: 'main' | 'lab' | 'story'; crit?: boolean; boss?: boolean; target?: string; from?: string; atkStyle?: AtkStyle;
  /**
   * `drop` 专用：这一笔是不是**首通奖励**（天梯塔的论道令 / 缘分丹是，每层的灵药不是）。
   * 界面据此把同一类事件渲染成两种说法 —— 少了它，"每层都掉灵药"会被写成"首通奖励 灵药"。
   * 老存档 / 老客户端没有这个字段 ⇒ `undefined` ⇒ 按"非首通"渲染，纯增加、不破坏兼容。
   */
  first?: boolean }

/** 同一回合内相邻出手事件的演出间隔（ms）——UI 只播放 time 已到的事件，形成依次出手的节奏 */
export const SEQ_MS = 220

/**
 * 群攻对**每个目标**的伤害系数（v1.28）。
 *
 * 这是用户明确要求的那条平衡线——"群攻肯定就比单体的攻击要低"：
 * 打 1 个只剩 55%（亏 45%）、打 2 个 110%（基本持平）、打 3 个 165%、打满 6 个 330%。
 * 于是"上群攻还是上单体"变成一道**看敌方人数作答的题**，而不是谁数值高上谁：
 * 前期 1~2 人的关卡带群攻是纯亏，70 关以后 5~6 人则是压倒性划算。
 * 敌方群攻走同一个系数，所以双方对称。
 */
const AOE_TARGET_RATIO = 0.55

/** 单体治疗量 = atk × 此系数（沿用 v1 起的原值，未改） */
const HEAL_RATIO = 1.5

/**
 * `control`（控制减益）的压制效果：**命中即给目标挂上攻/防双减益**。
 *
 * 为什么要给它一个真机制（v1.28.7）：`control` 的数值系数 `{0.85,0.9,0.95}` **全面低于**
 * `melee` 的 `{1.1,1.0,1.0}`，而它唯一的补偿——越过前排直击后排——已被玩家要求取消。
 * 于是它一度只是"数值更低的近战"，连定位名「控制减益」都名不副实。这个效果把名字兑现了。
 *
 * 数值怎么定的：
 * - **减防御对输出的提升其实很微弱**，别被名字骗了：我方伤害公式是 `atk - 敌def × 0.6`，
 *   防御本来就只吃六折、且数值远小于攻击。敌 def 100 / 我 atk 500 时，减防 25% 只让伤害
 *   从 440 涨到 449（**+2%**）。真正有分量的是**减攻击**：敌方输出直接少 20%，
 *   等于我方全队承伤少两成。所以这一版的重心在 atkPct，defPct 更大只是为了让"破防"看得见。
 * - `rounds: 2` 是"施加当回合剩下的时间 + 之后的 1 个完整回合"（回合末统一递减，见 fightRound）。
 *   不取更长是因为它**每次命中都会刷新**：只要 control 活着一直打同一个目标，压制就不会断。
 *
 * **不叠加、只取最高档**（与阵营羁绊同一条思路）：多个 `control` 打同一个目标时取各分项的最大值
 * 并刷新剩余回合，而不是把 20% 叠成 40% —— 叠加会让"带 3 个 control"变成唯一解。
 *
 * **敌我同规则**：敌方 `control`（主线 80 关 / 天梯塔 35 层起出现在后排）同样会压制我方队员，
 * 这份效果对玩家的价值才站得住 —— 与 v1.28.3/v1.28.7 两次"两边必须一样"的教训一脉相承。
 */
const CONTROL_DEBUFF = { atkPct: 20, defPct: 25, rounds: 2 }

/** 施加/刷新一次压制：**只取最高档、不叠加**，同时把持续时间刷满 */
function applyControlDebuff(slot: { debuff?: ControlDebuff }) {
  const cur = slot.debuff
  slot.debuff = {
    atkPct: Math.max(cur?.atkPct ?? 0, CONTROL_DEBUFF.atkPct),
    defPct: Math.max(cur?.defPct ?? 0, CONTROL_DEBUFF.defPct),
    left: CONTROL_DEBUFF.rounds,
  }
}

/**
 * 敌方医师的单体治疗量 = 它的 atk × 此系数。
 *
 * 敌方医师是 30 关起才出现的兵种，作用是拉长战斗：它会把残血的前排坦克一直抬回来，
 * 玩家得靠足够的输出把前排连人带奶一起推平。**任何定位都够不到它**——
 * 它站在后排，而后排在前排被拆完之前是不可攻击的（v1.28.7 起无例外，见 pickTargets）。
 *
 * **防僵持**（两条，缺一不可）：
 * 1. 敌方医师**永不治疗自己**（见 fightRound）——"两个医师互相刷血"这种死循环构造不出来；
 * 2. 治疗量按本波战斗回合数衰减（下式），久战不下的医师会自己力竭。
 *    没有第 2 条时，"我方输出 ≤ 敌方治疗量"的阵容会永久卡住，而这条不依赖任何数值假设。
 */
const ENEMY_HEAL_RATIO = 1.2

/** 敌方治疗量的衰减速度：每打满这么多回合，治疗量减半一次 */
const ENEMY_HEAL_DECAY_ROUNDS = 25

/**
 * 群疗对**每个目标**的回血量系数。
 * 2 人时总量与单体持平，人越多越划算（6 人时总量是单体的 2.7 倍）；
 * 代价是单点急救只有单体医师的 46% —— 对面是单点集火时，群疗救不下人。
 */
const HEAL_AOE_RATIO = 0.75

/** 战斗回合里我方角色的属性：主线（charStats × 商城增益）与天梯塔（labFighterStats × 祝福）都归一到这个形状 */
interface FighterStats { atk: number; def: number; hp: number; critRate: number; critDmg: number }

/** fightRound 的调用参数：把主线与天梯塔的差异（属性来源、祝福效果、清波后的推进方式）全部外置 */
interface FightRoundCfg {
  /** 当前这一波的战斗快照。`rounds` / `fighterDebuff` 会被本回合**写回**（前者给敌方治疗量衰减用），故不是只读视图 */
  b: { enemies: EnemyUnit[]; fighterHp: Record<string, number>; rounds?: number; fighterDebuff?: Record<string, ControlDebuff> }
  /**
   * 事件来源。**三个值互不透传**：CombatView 只捞 `'main'`、LabView 只捞 `'lab'`、
   * 剧情战斗只捞 `'story'`。剧情战斗的那几条飘字要是混进主线日志，
   * 玩家会看到自己在乌坦城打着"云岚宗外门弟子"的同时，主线战场蹦出同一批人的伤害数字。
   */
  source: 'main' | 'lab' | 'story'
  statsOf: (id: string) => FighterStats | null
  /** 无视敌人防御的比例（0~1），来自塔的「破甲式」祝福 */
  pierce: number
  /** 整轮闪避概率（0~100），来自塔的「疾风步」祝福 */
  dodge: number
  /** 造成伤害的吸血比例（0~100），来自塔的「噬血大法」祝福 */
  lifesteal: number
  /** 当前这一波是不是首领（决定击杀事件的演出强度） */
  isBoss: boolean
  /** 击杀事件的显示名：主线是怪物名，塔是「第 N 层」 */
  waveLabel: () => string
  /** 一波敌人清空：结算奖励并刷新下一波。返回 false 表示战斗已结束，不要再继续 */
  onWaveClear: () => boolean
}

export interface LabBattleState {
  floor: number
  enemies: EnemyUnit[]
  roundTimer: number
  fighterHp: Record<string, number>
  /** 见 BattleState.rounds */
  rounds?: number
  /** 见 BattleState.fighterDebuff */
  fighterDebuff?: Record<string, ControlDebuff>
}

/**
 * 剧情战斗（v1.55）。
 *
 * 用户 2026-09-22：「**战斗你可以剧情的战斗不和主线战斗耦合**」。
 *
 * ── 为什么不是复用 `state.battle` ──────────────────────────────────────
 * 主线战斗跑在 `stage`/`farmStage`/`wipeStreak` 这一整套推进机器上：赢了会推关、
 * 输了会记团灭、挂机会自动续。剧情要的恰恰相反 —— 它是**可以重打、不推进任何东西、
 * 打不过也不该影响主线**的一场戏。挂在主线上的直接后果是玩家读完第一幕去打两个
 * 萧家子弟，赢了之后**主线跳了一关**。
 *
 * ── 为什么不复用 `state.lab.battle` ────────────────────────────────────
 * 天梯塔那套带着楼层、祝福、三选一、最高层记录，比需要的重得多，而且
 * 共用会让两者**互相打断**（一边在爬塔时点进剧情，塔的进度就没了）。
 *
 * 所以这里是**第三份**、也是刻意最薄的一份战斗状态：一场、一波敌人、打完就散。
 * 结构上与 `LabBattleState` 同形（`fightRound` 的 `b` 参数接受的就是这个形状），
 * 差别只在于没有 `floor`，代之以 `nodeId` —— 因为剧情战斗的"第几层"这个概念不存在，
 * 它只有"这是哪一格戏"。
 */
export interface StoryBattleState {
  /** 正在打的是哪一格（`CHAPTER1` 里的 id）。打赢即调 `claimStoryNode(nodeId)` */
  nodeId: string
  enemies: EnemyUnit[]
  roundTimer: number
  fighterHp: Record<string, number>
  /** 见 BattleState.rounds */
  rounds?: number
  /** 见 BattleState.fighterDebuff */
  fighterDebuff?: Record<string, ControlDebuff>
}

export interface LabState {
  battle: LabBattleState | null
  autoLab: boolean
  highestFloor: number
  blessings: string[] // 本次爬塔已选祝福，撤退/阵亡清空
  offer: string[] | null // 三选一待选
  offerAt: number // offer 弹出时间戳：超过 LAB_OFFER_TIMEOUT 未选则自动选，避免永久卡住爬塔
}

export interface GameState {
  roster: Record<string, RosterEntry>
  team: { front: TeamSlot[]; back: TeamSlot[] }
  equippedFire: string | null
  inventory: Record<string, number>
  battle: BattleState | null
  autoBattle: boolean
  stage: number
  highestStage: number
  farmStage: number | null // 刷材料模式：固定停留在此关卡反复刷掉落；null = 正常主线推进
  wipeStage: number | null // 当前连续团灭发生在哪一关
  wipeStreak: number // 在 wipeStage 上连续团灭了几次
  lastProgressAt: number // 上次推进关卡的时间戳：用于识别"打不死也死不了"的僵持卡关
  lab: LabState
  kills: number
  pityTian: number // 距上次出天阶+的抽数（保底 PITY_TIAN）
  pityQuasi: number // 距上次出准圣+的抽数（保底 PITY_QUASI）
  pitySheng: number // 距上次出圣阶的抽数（保底 PITY_SHENG）
  /**
   * 终身累计抽数 / 终身累计出圣阶张数（v1.47，给「抽卡手气榜」用）。
   * 两者与上面三个 pity 是**不同性质**的东西：pity 会归零、只反映「距上次」，
   * 这两个只增不减 ⇒ 才能算「平均多少抽出一张圣阶」。
   * 老存档一律没有这两个字段 ⇒ 从 0 起算（**绝不因此判死档**）。
   */
  pullCount: number
  shengCount: number
  notice: string
  lastTick: number
  combatEvents: CombatEvent[]
  equipBag: EquipItem[]
  /** 最高阶武器最近一次洗练的可换回快照（v1.38.2）。老存档没有这个字段 ⇒ null */
  reforgeUndo: ReforgeUndo | null
  buffs: ActiveBuff[] // 商城限时增益（到期自动失效）
  shop: { date: string; counts: Record<string, number> } // 当日各商品已购次数，驱动价格递增、跨天回落
  gifts: Record<string, number> // 一次性发放的领取标记：发放 id → 领取时间戳（防重复发，见 GIFTS）
  /** 活动中心进度（v1.42）。老存档没有这个字段 ⇒ sanitizeActivityState 补一份空的 */
  activities: ActivityState
  /** 新手引导与第一章剧情进度（v1.54）。老存档 ⇒ 见 sanitizeStoryState 的"已完成"兜底 */
  story: StoryState
  /**
   * 进行中的剧情战斗（v1.55）。
   *
   * ⚠️ **这个字段刻意不进存档**：`migrate` 里一律置 null（见那一段的注释）。
   *    剧情战斗是几秒钟的一场戏，不是主线那种会挂机跑半小时的东西；
   *    为它写一整套净化逻辑（敌人数组、双方血量、控制减益…）要几十行，
   *    而换来的只是"关掉页面再打开能接着打" —— 玩家重进这一格就是重打一遍，
   *    感官上根本没有差别。这是**故意用一点体验换掉一整类存档损坏**。
   */
  storyBattle: StoryBattleState | null
}

/**
 * 新手引导 / 第一章剧情的进度（v1.54，文案与节点表在 game/story.ts）。
 *
 * ── 为什么这份状态**进存档**而不是只放 localStorage ──────────────────
 * 本作是服务端权威（SPEC §4.4）：客户端的写入在下一帧就会被权威态覆盖。
 * 引导进度要是只存本地，玩家换个设备就得从头看六幕序章，
 * 而更糟的是**老玩家**会在新设备上被重新拦一次 —— 这正是要避免的事。
 *
 * ── 为什么用 `done: string[]` 而不是位图 / 数字进度 ────────────────────
 * 节点表将来会变长、会分叉（案例的章节地图就是 12 个节点带前置锁，
 * 不是一条直线）。存 id 数组，加节点、插节点、把节点挪到别的章都不用改存档结构。
 * 代价是一个玩家最多存几十个短字符串 —— 相对 2MB 的存档上限可以忽略。
 */
export interface StoryState {
  /** 序章看到第几幕（1-based）。看完六幕 = PROLOGUE.length，组件据此判断"要不要放序章" */
  prologueAct: number
  /** 已完成节点的 id。**顺序不保证**，判断一律用 includes（见 storyDone） */
  done: string[]
  /**
   * 报过道号了没有 —— 「入门登记」那一步是不是已经跨过去。
   *
   * ⚠️ **这里刻意不存名字本身**。名字的唯一权威是账号昵称（`nickname.ts` + 服务端 `POST /nickname`，
   * v1.53 刚把这件事收口）。在存档里再存一份 `name`，两个字段迟早会不一致
   * （玩家在群雄榜改名，剧情里的称呼却还是旧的），而那时没人说得清以哪个为准。
   * 台词里的 `{name}` 由组件现取现用（`loadNick() || getAuthNick()`），取不到就回落到「你」。
   */
  enrolled: boolean
  /** 手册看过了 */
  handbook: boolean
  /**
   * **已永久解禁**：不再被阻断式引导拦截，退回非阻断的 NewbiePath 条。
   * ⚠️ 单向标记，一旦 true 永不复位（判据见 story.ts 的 STORY_UNLOCK_NODE）。
   * 不能拿"当前进度到没到 1-4"来代替它 —— 存档被手改 / 节点表调整都可能让进度倒退，
   * 那会把已经上手的玩家**重新关回引导里**，是最不可接受的一种 bug。
   */
  finished: boolean
}

function freshStoryState(): StoryState {
  return { prologueAct: 1, done: [], enrolled: false, handbook: false, finished: false }
}

/**
 * 读档时的净化。分两种情况，**方向是反的**，别写反：
 *
 *   · 存档里**有** `story` 字段（本版本之后写过的档）⇒ 逐字段净化，坏值回落到默认。
 *   · 存档里**没有** `story` 字段（这个版本之前的老档）⇒ 按"这把号已经玩过了"处理。
 *
 * 第二条为什么这么定：老玩家明天打开游戏，如果被判成新号，会被六幕序章 + 登记 + 手册
 * 连拦三道 —— 对一个玩了很久的人来说，这是最像"游戏坏了"的一种表现。
 * 但也不能一律跳过：**在这个版本上线后才注册、还什么都没干的新号**，
 * 他们的第一份存档同样没有 `story` 字段（注册时存的是当时的 freshState）。
 * 所以判据看"到底动没动过"，三个条件任一成立即视为已玩过：
 *   最高关卡 > 1 / 击杀数 > 0 / 名册超过起始四人。
 * 三条件都不成立 = 真的一步没走，那就让他走一遍引导（这正是我们要的那批人）。
 */
function sanitizeStoryState(raw: unknown, playedBefore: boolean): StoryState {
  const base = freshStoryState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // 没有这个字段：老档走"已解禁"，新号走"从头开始"
    return playedBefore ? { ...base, prologueAct: PROLOGUE.length + 1, handbook: true, finished: true } : base
  }
  const o = raw as Record<string, unknown>
  const act = Number(o.prologueAct)
  return {
    // 幕号 clamp 到 [1, 幕数+1]：写成 1e9 会让序章永远放不完，写成 0/NaN 会让它永远从头开始
    prologueAct: Number.isFinite(act) ? Math.max(1, Math.min(PROLOGUE.length + 1, Math.floor(act))) : base.prologueAct,
    // 只保留**节点表里真的存在**的 id：被删掉的老节点留着只会让 1-12 的"X/12"永远差一格
    done: Array.isArray(o.done) ? [...new Set(o.done.filter((x): x is string => typeof x === 'string' && ALL_NODE_IDS.has(x)))] : [],
    enrolled: o.enrolled === true,
    handbook: o.handbook === true,
    // ⚠️ 只认 === true。坏值一律当没解禁（宁可让引导多拦一次，也不能把没走完的人放出去）
    finished: o.finished === true,
  }
}

/**
 * 「这份老档到底玩过没有」—— 决定没有 `story` 字段的存档要不要走引导。
 *
 * 三个条件任一成立即算玩过（**宁可判成玩过**：错放的代价是把老玩家拦在序章里，
 * 错收的代价只是让一个"注册了但没动过"的号少看一段引导，两者不对等）：
 *   · 最高关 > 1              —— 推过关
 *   · `kills > 0`             —— 打过架
 *   · 名册比起始四人多        —— 抽过卡 / 领过角色
 *
 * ⚠️ 最高关要**照抄 migrate 自己的回落链**（`highestStage ?? stage`），不能只看 `highestStage`。
 *    2026-09-22 拿 49 份线上真档实跑时抓到两份反例：`highestStage` 字段根本没有、
 *    只有 `stage: 7`，`kills` 也没有，名册里就 1 个角色 —— 三条全不成立。
 *    照原样写会把这两个明显玩过的号拦进六幕序章。凡是"从老档里读一个数"，
 *    判据必须跟 migrate 读的是同一个，否则就是同一件事两份实现。
 *
 * ⚠️ 入参 `roster` 用的是**已经净化过的那份**（见 migrate 里 roster 的构造），不是 `parsed.roster`：
 * 畸形档里 `roster` 可能是字符串或数组，直接 `Object.keys` 出来的长度毫无意义。
 */
function playedBeforeStory(parsed: Partial<GameState>, roster: Record<string, RosterEntry>): boolean {
  // 与 migrate 里 `highestStage` 那一段逐字同源
  const hs = Number.isFinite(parsed.highestStage as number) ? (parsed.highestStage as number)
    : (Number.isFinite(parsed.stage as number) ? (parsed.stage as number) : 1)
  if (hs > 1) return true
  const k = Number(parsed.kills)
  if (Number.isFinite(k) && k > 0) return true
  return Object.keys(roster).length > STARTER_IDS.length
}

/**
 * 活动中心的进度（v1.42，见 game/activities.ts）。
 *
 * 这里**没有一张"领取记录表"**：领取状态直接在 claimed 里按活动 id 记时间戳 ——
 * once 型看"有没有"，daily 型看"是不是今天的"。于是这张表**不会随天数增长**
 * （每个 daily 活动每天只是覆盖同一个键），也不需要任何清理逻辑。
 */
export interface ActivityState {
  /** 活动 id → 领取时间戳 */
  claimed: Record<string, number>
  /** 累计计数（cycle=once 的任务用）：metric → 值 */
  total: Record<string, number>
  /** 当日计数（cycle=daily 的任务用）；date 一跨天，day 与 dayOnlineMin 一起清零 */
  date: string
  day: Record<string, number>
  /** 上次签到日期（todayKey）与连续签到天数 */
  lastCheckin: string
  streak: number
  /** 在线时长：累计分钟 / 当日分钟 */
  onlineMin: number
  dayOnlineMin: number
}

function freshActivityState(): ActivityState {
  return {
    claimed: {}, total: {}, date: todayKey(), day: {},
    lastCheckin: '', streak: 0, onlineMin: 0, dayOnlineMin: 0,
  }
}

/** 只认形状对的那部分，坏值一律回落到默认 —— **绝不因为多一个字段把整份存档判死** */
function sanitizeActivityState(raw: unknown): ActivityState {
  const base = freshActivityState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const o = raw as Record<string, unknown>
  const numMap = (v: unknown): Record<string, number> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const k of Object.keys(v as Record<string, unknown>)) {
      const n = Number((v as Record<string, unknown>)[k])
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
    return out
  }
  const nonNeg = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)
  return {
    claimed: numMap(o.claimed),
    total: numMap(o.total),
    // 日期串不认识就当"今天"：真跨天了也只是少清一次当日计数，比把老档判死强
    date: typeof o.date === 'string' && o.date ? o.date : base.date,
    day: numMap(o.day),
    lastCheckin: typeof o.lastCheckin === 'string' ? o.lastCheckin : '',
    streak: nonNeg(o.streak),
    onlineMin: nonNeg(o.onlineMin),
    dayOnlineMin: nonNeg(o.dayOnlineMin),
  }
}

/** 商城限时增益：id 对应 SHOP_BUFFS，expireAt 为失效时间戳 */
export interface ActiveBuff { id: string; expireAt: number }

const ROUND_SEC = 2
/** 天梯塔三选一祝福自动选择倒计时(ms)：超时未选则随机自动选一个，不卡住玩家 */
export const LAB_OFFER_TIMEOUT = 20000
const CHAR_MAP: Record<string, CharacterDef> = Object.fromEntries(CHARACTERS.map(c => [c.id, c]))
/** 重复抽到 / 主动卖出角色换取的武魂精血，按稀有度分级 */
export const ESSENCE_BY_RARITY: Record<Rarity, number> = { yellow: 5, xuan: 10, di: 20, tian: 35, quasi: 60, sheng: 100 }

const STARTER_IDS = ['yellow_disciple', 'yellow_mercenary', 'yellow_bandit', 'yellow_hunter']

/**
 * 一次性发放表（补偿/福利）。运维侧要给全体补资源时在这里追加一条，**不要改已上线条目的 id**：
 * 领取标记跟着存档走（state.gifts），改 id 等于让所有人重领一次。
 *
 * 为什么不做「直接改云端存档文件」：云端档由客户端本地档整份覆盖（saveApi 的 uploadSave 只读本地、
 * 也不比对云端 updatedAt），一改就被玩家自己的自动备份盖掉；而发放写进**存档**后由客户端自己带上云，
 * 玩家下次打开游戏就自动到账，不需要任何人配合操作。
 */
const GIFTS: { id: string; label: string; grant: (inv: Record<string, number>) => void }[] = [
  {
    id: 'yuanfen20_20260915',
    label: '缘分丹 ×20',
    grant: inv => { inv.yuanfen = num(inv.yuanfen) + 20 },
  },
  {
    // 全服十连福利：recruit 的 cost === times，所以 10 连正好 10 颗缘分丹，无折扣。
    // id 故意不用 `yuanfenNN_` 前缀，免得跟上面那条只是数字不同、哪天手滑敲错就变成"重发一次"。
    id: 'shilian10_20260915',
    label: '缘分丹 ×10（十连抽福利）',
    grant: inv => { inv.yuanfen = num(inv.yuanfen) + 10 },
  },
]

/**
 * 服务端配置（奖励清单 + 活动配置）的复查间隔，跟云备份的 3 分钟对齐，别给服务器添没必要的心跳。
 * 两者共用一个心跳：它们都是"运营改文件、在线的人等着生效"的同一类东西。
 */
const REMOTE_POLL_MS = 3 * 60 * 1000

// ── 远程模式（v2.0 阶段 3，SPEC §4.6）的常量 ────────────────────────────────
/** `/state` 轮询间隔：可见 1 秒。**轮询就是心跳** —— 服务端按"90 秒内有过 /state 或 /action"判在线。 */
const STATE_POLL_MS = 1000
/**
 * 页面在后台时的轮询间隔。**故意不是 1 秒**：浏览器会把后台标签页的定时器降频到分钟级，
 * 定 1 秒也拿不到 1 秒。15 秒是"能定到的、又不至于每次都撞上降频"的数。
 * 后台被降频到超过 90 秒也不怕 —— 服务端会把这段算成离线，重新在线时补结算挂机产出。
 */
const STATE_POLL_HIDDEN_MS = 15000
/**
 * 两次 `/action` 之间的最小间隔。服务端是 `ACTION_MIN_MS = 120`，这里留 20ms 余量。
 *
 * ⚠️ **客户端不"猜"服务端那个常量**（复述第二份常量 = 必然分叉，见 authApi 里
 *    `PW_MIN_HINT` 那段）。这里只保证"不会比服务端更密、也不把它当成判据"：
 *    真被限频了，回执是 `rate`，静默咽掉即可（那是服务端在防守，不是玩家的错）。
 */
const ACTION_MIN_MS = 140
/** 本机那份副本的写入节流。全量 188KB，按 1Hz 写会把主线程卡住。 */
const CACHE_MIN_MS = 30000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** `/action` 的回执（引擎视角，不是 HTTP 视角）。见 `postAction`。 */
export interface ActionOutcome<T = unknown> {
  /** 这个**动作**被服务端接受并执行了吗。限频/鉴权/网络失败都是 false。 */
  ok: boolean
  /** 引擎的返回值（void 类动作是 null）。 */
  result: T | null
  /** 给人看的失败原因。成功时没有。 */
  why?: string
  /** `rate` | `refused` | `need_login` | `bad_args` | `bad_op` | `error` | `network` | `offline` */
  reason?: string
}

/** 数值兜底：缺失/非数字（存档被改坏）一律当 0，避免 NaN 顺着存档扩散 */
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function freshState(): GameState {
  const roster: Record<string, RosterEntry> = {}
  for (const id of STARTER_IDS) roster[id] = { level: 1, xp: 0, stars: 0, equip: {} }
  return {
    roster,
    team: { front: ['yellow_disciple', 'yellow_mercenary', null], back: ['yellow_bandit', 'yellow_hunter', null] },
    equippedFire: null,
    // ⚠️ v1.60：`crystal` / `essence` / 那件武器**改成开局就发**，不再靠"序章战斗首通"。
    //    用户 2026-09-22 把剧情从引导链路里拿掉（「不要自己单独做个旅程模块的战斗」）之后，
    //    那格战斗不再是新号必经的一步，而后面"第一次修炼 / 第一次装备 / 第一次强化"
    //    三步是**强制**的 —— 它们分别要 20 结晶、一件装备、800 结晶 + 2 精血，
    //    新号开局这几样**全是 0，不发就必然卡死**（卡住的是强制引导，玩家连绕过去的机会都没有）。
    //    这不是推断：`story.ts` 的 `0-1` 那格注释里早就写着"不发就必然卡死"。
    //    ★ 数值**原样照抄**那格的首通奖励（coin 200 / crystal 1000 / essence 5 / 一件黄品武器），
    //      再叠上原本就有的开局 200 铜钱 ⇒ **新手经济一分钱没变**，变的只是"什么时候到手"。
    inventory: { coin: 400, yuanfen: 5, crystal: 1000, herb: 0, essence: 5, daoling: 0 },
    battle: null,
    autoBattle: false,
    stage: 1,
    highestStage: 1,
    farmStage: null,
    wipeStage: null,
    wipeStreak: 0,
    lastProgressAt: Date.now(),
    lab: { battle: null, autoLab: false, highestFloor: 0, blessings: [], offer: null, offerAt: 0 },
    kills: 0,
    pityTian: 0,
    pityQuasi: 0,
    pitySheng: 0,
    pullCount: 0,
    shengCount: 0,
    notice: '',
    lastTick: Date.now(),
    combatEvents: [],
    // v1.60：那件"第一件装备"也改成开局发（原本是序章战斗首通发的）。
    // 走 `rollEquip` —— 与常规掉落**同一个工厂**，属性口径不会漂。
    equipBag: [rollEquip('weapon', 'yellow')],
    reforgeUndo: null,
    buffs: [],
    shop: { date: todayKey(), counts: {} },
    // 全新账号直接视为「已领过」本批发放：这批补的是更新前就存在的老玩家，刚开的新号不该白拿一份
    // （新号想要的话就是改成 {}）。⚠️ migrate 里会显式覆盖 gifts，别删那一行。
    gifts: Object.fromEntries(GIFTS.map(g => [g.id, 0])),
    activities: freshActivityState(),
    // 全新账号：序章从头放起、节点一个没做、还没登记（名字为空 ⇒ 登记那一步会拦住他）。
    // ⚠️ 这里**刻意不预置 finished**：新号就是要走引导的那批人。
    story: freshStoryState(),
    storyBattle: null,
  }
}

/**
 * 角色属性的**未取整**版本。战斗/UI 用的是取整后的 charStats，
 * 但战力评分必须走这里：1 级角色攻击只有十几点，装备词条 2% 与 9% 的差别
 * 在 Math.round 之后会一起归零，导致"换上这件能不能涨"全部判成 0——
 * 一键穿戴会认不出更好的装备、一键分解会把更好的装备当垃圾清掉。
 */
function charStatsRaw(entry: RosterEntry, charDef: CharacterDef, fireId: string | null) {
  const lv = entry.level
  // 星级线性加成（×1.08/星）+ 每满 10 星的品质跃升 + 境界乘法加成（后者是对抗怪物指数成长的关键，见 data.ts REALM_POWER）
  const starMult = starMultOf(entry.stars)
  const rMult = realmMult(lv)
  let atk = (charDef.baseAtk + charDef.atkGrowth * lv) * starMult * rMult
  let def = (charDef.baseDef + charDef.defGrowth * lv) * starMult * rMult
  let hp = (charDef.baseHp + charDef.hpGrowth * lv) * starMult * rMult
  if (fireId) {
    const fire = FIRES.find(f => f.id === fireId)
    if (fire) {
      atk *= 1 + (fire.atkPct ?? 0) / 100
      def *= 1 + (fire.defPct ?? 0) / 100
      hp *= 1 + (fire.hpPct ?? 0) / 100
    }
  }
  // 装备：全部词条是百分比加成（原因见 data.ts 装备系统注释），暴击率/暴击伤害只从装备来
  let critRate = 0, critDmg = BASE_CRIT_DMG
  let equipAtkPct = 0, equipDefPct = 0, equipHpPct = 0
  for (const slot of EQUIP_SLOTS) {
    const item = entry.equip?.[slot]
    if (!item) continue
    equipAtkPct += equipAffixSum(item, 'atkPct')
    equipDefPct += equipAffixSum(item, 'defPct')
    equipHpPct += equipAffixSum(item, 'hpPct')
    critRate += equipAffixSum(item, 'critRate')
    critDmg += equipAffixSum(item, 'critDmg')
  }
  atk *= 1 + equipAtkPct / 100
  def *= 1 + equipDefPct / 100
  hp *= 1 + equipHpPct / 100
  return { atk, def, hp, critRate: Math.min(100, critRate), critDmg }
}

export function charStats(entry: RosterEntry, charDef: CharacterDef, fireId: string | null) {
  const s = charStatsRaw(entry, charDef, fireId)
  return { atk: Math.round(s.atk), def: Math.round(s.def), hp: Math.round(s.hp), critRate: s.critRate, critDmg: s.critDmg }
}

/**
 * 角色"出手会打出什么"的结构化数值（v1.31，见 `game.combatEffectOf`）。
 * 三种有数字的效果（治疗 / 群疗 / 群攻）+ 压制（它是攻防双减益，不是一个伤害数字，所以形状不同）。
 */
export type CombatEffect =
  | { kind: 'heal' | 'heal_aoe' | 'aoe'; value: number }
  | { kind: 'control'; atkPct: number; defPct: number; rounds: number }

/**
 * 按攻击力与定位算效果数值 —— **实战与界面共用这一处**。
 * 结缘页给未拥有的角色看"初始效果"也走这里（`baseCombatEffectOf`），
 * 免得"展示时乘 1.5、战斗时乘 1.5"变成两份各写一遍的实现。
 */
function effectFor(atk: number, role: Role): CombatEffect | null {
  switch (role) {
    // 单奶：回血线最低的那位；群疗：每人回单体量的一半左右（HEAL_AOE_RATIO）
    case 'heal': return { kind: 'heal', value: Math.round(atk * HEAL_RATIO) }
    case 'heal_aoe': return { kind: 'heal_aoe', value: Math.round(atk * HEAL_AOE_RATIO) }
    // 群攻：对**每个**目标的伤害基数（实际还要减目标防御并带 ±15% 浮动，界面须标注）
    case 'aoe': return { kind: 'aoe', value: Math.round(atk * AOE_TARGET_RATIO) }
    case 'control': return {
      kind: 'control',
      atkPct: CONTROL_DEBUFF.atkPct, defPct: CONTROL_DEBUFF.defPct, rounds: CONTROL_DEBUFF.rounds,
    }
    default: return null
  }
}

/** 未拥有角色的初始效果（结缘页那排"初始属性"用的就是 def() 里的 base 值） */
export function baseCombatEffectOf(c: CharacterDef): CombatEffect | null {
  return effectFor(c.baseAtk, c.role)
}

/**
 * 单个角色的战力（与 combatPower 同一套权重，方便"换上这件能涨多少"直接相减）。
 * 暴击折进有效攻击——暴击率/暴击伤害只从装备产出，所以这套评分天然奖励带暴击词条的装备，
 * 不会因为品阶低就一律判死（低阶高暴击词条的戒指仍可能胜出）。
 * 走 charStatsRaw：取整后的属性会让低级角色的装备差距归零，见那里的注释。
 */
export function charPower(entry: RosterEntry, cdef: CharacterDef, fireId: string | null): number {
  const s = charStatsRaw(entry, cdef, fireId)
  const effAtk = s.atk * (1 + (s.critRate / 100) * (s.critDmg / 100))
  return effAtk + s.def * 2 + s.hp * 0.15
}

/**
 * 单件装备的校验/修复：旧版本存档、被手工改坏的存档里可能出现缺 innate / extra 为 null /
 * 槽位或品阶非法的条目。这类条目一旦进内存，就会在 charStats（渲染路径）里抛错导致白屏，
 * 或者让「一键最优穿戴」把装备塞进不存在的槽位（装备凭空消失）。修不了就丢弃该件。
 *
 * v1.38 的强化等级 `lv` 也在这里兜底：**它是"可以缺"的字段**（v1.38 之前掉的每件装备都没有），
 * 缺了补 0、越界夹回区间，但它**不是**丢弃一件装备的理由 —— 修不回来的只有上面那几类结构损伤。
 */
function sanitizeEquipItem(raw: unknown): EquipItem | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Partial<EquipItem>
  if (typeof it.id !== 'string' || !it.id) return null
  if (!EQUIP_SLOTS.includes(it.slot as EquipSlot)) return null
  if (!it.quality || !(it.quality in EQUIP_BREAKDOWN)) return null
  const innate = it.innate
  if (!innate || typeof innate !== 'object' || typeof innate.type !== 'string' || !Number.isFinite(innate.value as number)) return null
  const extra = Array.isArray(it.extra)
    ? it.extra.filter(a => a && typeof a === 'object' && typeof a.type === 'string' && Number.isFinite(a.value as number))
    : []
  return {
    id: it.id, slot: it.slot as EquipSlot, quality: it.quality as Rarity,
    name: typeof it.name === 'string' ? it.name : '装备',
    innate: innate as EquipAffix, extra: extra as EquipAffix[],
    // v1.38 强化等级。**v1.38 之前的每一件装备都没有这个字段**，所以"缺字段"是常态而不是异常：
    // 缺失 → 0 级（白板），超出上限或非有限值一律夹回合法区间。绝不因为它把装备丢掉——
    // 丢弃一件玩家穿着的装备，比让它少几级强化的破坏性大得多。
    lv: Math.max(0, Math.min(
      Number.isFinite(it.lv) ? Math.floor(it.lv as number) : 0,
      equipEnhCap(it.quality as Rarity),
    )),
  }
}

function sanitizeEquipMap(raw: unknown): Partial<Record<EquipSlot, EquipItem>> {
  const out: Partial<Record<EquipSlot, EquipItem>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const slot of EQUIP_SLOTS) {
    const item = sanitizeEquipItem((raw as Record<string, unknown>)[slot])
    if (item && item.slot === slot) out[slot] = item
  }
  return out
}

/**
 * 「可换回」快照的校验/修复。**形状不对就当没有**（返回 null），绝不因此把整份存档判死：
 * 它是一份可有可无的后悔药，坏掉的代价应该是"少了这次换回机会"，不是"打不开游戏"。
 * 装备本身还在不在不在这里查（那要等 equipBag 解析完），交给 reforgeUndoOf。
 */
function sanitizeReforgeUndo(raw: unknown): ReforgeUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<ReforgeUndo>
  if (typeof s.itemId !== 'string' || !s.itemId) return null
  if (!Number.isFinite(s.idx)) return null
  const from = s.from
  if (!from || typeof from !== 'object' || typeof from.type !== 'string' || !Number.isFinite(from.value)) return null
  return {
    itemId: s.itemId, idx: Math.max(0, Math.floor(s.idx as number)),
    from: { type: from.type, value: from.value } as EquipAffix,
  }
}

/**
 * 存档的存储介质。浏览器传 `localStorage`（默认，行为与历史逐字节一致）；
 * 服务端传自己的实现（**每个玩家一份**，见 SPEC §4.4）。
 *
 * ⚠️ 刻意用**构造参数注入**而不是"切换全局 `localStorage`"：服务端要同时持有多个玩家实例，
 * 而全局只有一个。引擎内部有异步回调（远程配置、notice 的 3 秒定时器），
 * 一旦靠全局切换，A 玩家的写就会落进 B 玩家的档里 —— 那是比丢档更糟的串档。
 */
export interface SaveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface GameOptions {
  /** 存储介质。默认全局 `localStorage`（浏览器）。 */
  storage?: SaveStorage
  /**
   * 是否自启客户端循环（100ms tick / 2 秒定时落盘 / beforeunload / 远程配置轮询）。
   * 浏览器默认 **true**（行为不变）；**服务端必须传 false** —— 服务端按自己的 1Hz 同步驱动
   * `tick()`，且不轮询远程配置（它直接读文件，见 SPEC §4.4.2）。
   */
  autoLoop?: boolean
  /**
   * 服务端注入的**活动配置**（SPEC §4.5.5）。浏览器**不传** —— 它靠 `syncActivities()` 自己
   * `fetch`（配置在 `activities/` 目录，运营改文件即全服生效）；Node 里没有 `fetch`，
   * 所以由宿主读文件、用 `parseActivities` 解析后从这里塞进来。
   * 配置变化时宿主应调 `setRemoteActivities()` 重新注入，不能只注入一次。
   */
  activities?: ActivityDef[]
  /**
   * **远程模式**（v2.0 阶段 3，SPEC §4.6）：页面**只渲染服务端下发的状态**，玩家的每个动作
   * 打到 `/action`，客户端**不再算账**。
   *
   * 为什么是这一条在防作弊：客户端权威下，"改前端内存 / 改本地存档"就是刷钱的手段。
   * 远程模式里本机那份存档退化成**只读副本**（渲染首屏用，且**绝不回传**）——
   * 改了它，页面下一秒就被服务端的增量打回；改前端内存同样。
   *
   * 开启后构造函数**只留配置轮询**，下面这些本地循环全部拆掉（每一条都是分叉源）：
   *   100ms `tick()`（它会写 `lastTick` 与产出，与服务端 1Hz 并发）、2 秒 `save()`、
   *   `beforeunload` 保存、`syncRemoteRewards()`（服务端已按 rewards.json 发放）、
   *   构造函数里的 `applyOfflineProgress()`（服务端在 `acquire()` 里补结算，再补一次 = 重复发放）。
   *   ⚠️ `syncActivities()` **保留**：它只把活动**配置**拉进内存（`activityList()` 读的就是它），
   *      停掉活动中心的 tab 会静默空白；它不写任何权威数值。
   */
  remote?: boolean
}

export class GameStore {
  state: GameState
  private storage: SaveStorage
  private listeners = new Set<() => void>()
  /**
   * 服务端下发的活动配置（v1.42）。**不存档**：它是运营侧的数据、随拉随用，
   * 存档里只留玩家自己的进度（state.activities）。放进 state 的后果是每次 save 都把
   * 整份活动清单写进 localStorage、再随云备份传一遍 —— 而它跟玩家进度没有半点关系。
   */
  private remoteActivities: ActivityDef[] = []
  private saveSuspended = false // 恢复云存档时挂起本地保存，避免 reload 的 beforeunload/定时 save 覆盖刚写入的存档
  private justGranted: string[] = [] // 本次加载刚发放的一次性物品（只用于启动提示，不写进存档）
  /**
   * 本次启动是不是全新账号（load 两份存档都没读出来、落在 freshState 上）。
   * 服务端奖励靠它决定"新号发不发"：奖励是补偿性质时新号只登记不发放。
   * 用运行时标记而不是存档字段——存档结构是红线，能不加字段就不加。
   */
  private newAccount = false

  // ── 远程模式的状态（SPEC §4.6）────────────────────────────────────────────
  /** 见 `GameOptions.remote`。构造时定下，之后不再变。 */
  private remote = false
  /**
   * 给 React 看的快照。与 `this.state` 只差一处：远程模式下本地提示会临时盖在 `notice` 上。
   *
   * ⚠️ **必须缓存成同一个引用**：`useSyncExternalStore` 每次渲染都调 `getSnapshot()` 并拿
   *    `Object.is` 比对，返回新对象会直接报 "The result of getSnapshot should be cached"
   *    并无限重渲染。所以只在 `emit()` 里换，别在 getter 里现造。
   */
  private view!: GameState
  /** 远程模式下的**本地**提示（"灵金不足"这类）。服务端那份 `state.notice` 不被它改写。 */
  private localNotice = ''
  private localNoticeTimer: ReturnType<typeof setTimeout> | null = null
  /** 服务端内容的游标（`/state` 的 `srev`）。0 = 手上没有全量，下一拍必须全量。 */
  private srev = 0
  /** 服务端时钟 − 本地时钟(ms)。`combatEvents[].time` 用的是**服务端**时钟。 */
  private clockSkew = 0
  /** `/action` 串行队列：同一时刻只允许一个在飞，且两次之间留够间隔。 */
  private actionQueue: Promise<unknown> = Promise.resolve()
  private lastActionAt = 0
  /** 断线 ⇒ **只读**。绝不拿本地状态重建权威（那正是要拆掉的绕过口）。 */
  private remoteDown = false
  /** 服务端明确说 `need_login` ⇒ 只读，提示重新登录。**不**回退到本地算账。 */
  private needLogin = false
  /** 本机副本待写 + 上次写入时刻（节流用）。 */
  private cacheDirty = false
  private lastCacheAt = 0
  /** 本机那份原始存档是否已经让位给 `SAVE_BAK_KEY`（只让一次，见 `writeCache`）。 */
  private cacheStashed = false
  /** 轮询在飞标志：可见性变化会额外触发一次，别让它和定时那一次并行。 */
  private polling = false
  private remoteTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: GameOptions = {}) {
    this.storage = opts.storage ?? localStorage
    this.remote = opts.remote === true
    this.state = this.load()
    this.view = this.state
    // ⚠️ 远程模式下**不补离线收益**：服务端在 `acquire()`（离线转在线）里已经补过一次，
    //    客户端再补一次就是**重复发放**（且用的是本机时钟与本机缓存里的 lastTick）。
    if (!this.remote) this.applyOfflineProgress()
    // 发放提示走 setNotice：它带 3 秒自动清除，直接写 state.notice 会永久挂在顶栏
    if (this.justGranted.length) this.setNotice(`礼包到账：${this.justGranted.join('、')}`)
    // 活动配置：浏览器那侧等下面的 syncActivities() 去 fetch；服务端由宿主直接注入（它没有 fetch）
    if (opts.activities) this.remoteActivities = opts.activities
    // 服务端在这里就返回：它自己按 1Hz 同步调 tick()，不要任何客户端循环（SPEC §4.4.2）
    if (opts.autoLoop === false) return
    if (this.remote) {
      // 远程模式：**只留配置轮询**。活动配置仍然要拉（运营改文件即全服生效），
      // 其余本地循环一律不启（见 `GameOptions.remote` 里逐条的理由）。
      this.syncActivities()
      setInterval(() => this.syncActivities(), REMOTE_POLL_MS)
      return
    }
    setInterval(() => this.tick(), 100)
    setInterval(() => this.save(), 2000)
    window.addEventListener('beforeunload', () => this.save())
    // 服务端配置：启动拉一次，之后定期再拉——运营改完文件，在线玩的人不用刷新也能等到
    this.syncRemoteRewards()
    this.syncActivities()
    setInterval(() => this.syncRemoteRewards(), REMOTE_POLL_MS)
    setInterval(() => this.syncActivities(), REMOTE_POLL_MS)
  }

  private load(): GameState {
    // 依次尝试：主存档 → 上一份备份 → 全新存档。任何一份损坏都自动跳过，绝不因抛错丢进度。
    for (const key of [SAVE_KEY, SAVE_KEY + '.bak']) {
      try {
        const raw = this.storage.getItem(key)
        if (!raw) continue
        const migrated = this.migrate(JSON.parse(raw))
        if (migrated) return migrated
      } catch { /* 这份存档损坏，尝试下一份 */ }
    }
    this.newAccount = true
    return freshState()
  }

  /**
   * 把任意（可能来自旧版本、或部分字段损坏的）存档对象迁移成完整 GameState。
   * 逐字段容错：单条坏数据只丢弃该条，绝不让整体抛错回退到全新存档（那才是真·死档）。
   * 无法挽救（根本不是对象）时返回 null，由 load 尝试下一份备份。
   */
  private migrate(parsed: Partial<GameState> | null): GameState | null {
    if (!parsed || typeof parsed !== 'object') return null
    const base = freshState()

    // 名册：逐条补齐字段、剔除非法条目
    const roster: Record<string, RosterEntry> = {}
    const srcRoster = (parsed.roster && typeof parsed.roster === 'object') ? parsed.roster : {}
    for (const id of Object.keys(srcRoster)) {
      const e = srcRoster[id] as Partial<RosterEntry> | undefined
      if (!e || typeof e !== 'object') continue
      roster[id] = {
        level: Number.isFinite(e.level as number) ? (e.level as number) : 1,
        xp: Number.isFinite(e.xp as number) ? (e.xp as number) : 0,
        // 星级 clamp 到 [0, MAX_STARS]：畸形档里的 1e9 星会让 starMultOf 打出天文数字属性
        stars: Number.isFinite(e.stars as number)
          ? Math.max(0, Math.min(MAX_STARS, Math.floor(e.stars as number)))
          : 0,
        equip: sanitizeEquipMap(e.equip),
      }
    }
    // 空名册会导致无法出战的软锁，兜底塞回一个初始角色
    if (Object.keys(roster).length === 0) roster.yellow_disciple = { ...base.roster.yellow_disciple }

    // 阵容迁移（v1.28：5 格 → 6 格）
    // 老档是 front 3 + back 2，补一个后排空位即可，玩家原有的站位与顺序原样保留（顺序 = 承伤优先级）。
    //
    // 同时**剔除不在名册里的陈旧 id**：这类 id 不进战斗，却会让 activeFighters() 返回非空，
    // 于是 startBattle 放行、而 fighterHp 里根本没有它 ⇒ 开局就判「全员阵亡」。
    // 放生/改名留下的遗留 id 会踩到这个坑，读档时一次性清干净。
    const rawTeam = (parsed.team && Array.isArray(parsed.team.front) && Array.isArray(parsed.team.back))
      ? parsed.team : base.team
    const readRow = (arr: unknown[], size: number): TeamSlot[] => {
      const out: TeamSlot[] = []
      for (let i = 0; i < size; i++) {
        const v = arr[i]
        out.push(typeof v === 'string' && roster[v] ? v : null)
      }
      return out
    }
    const team = { front: readRow(rawTeam.front, TEAM_FRONT_SIZE), back: readRow(rawTeam.back, TEAM_BACK_SIZE) }
    // 同一角色不能占用两个位置（setSlot 有这道保护，读档也得有：手改存档或旧版本可能留下重复，
    // 重复 id 会让 fighterHp 只存一份血、却被算作两次出手）
    const seated = new Set<string>()
    for (const row of ['front', 'back'] as const) {
      for (let i = 0; i < team[row].length; i++) {
        const v = team[row][i]
        if (!v) continue
        if (seated.has(v)) team[row][i] = null
        else seated.add(v)
      }
    }
    const highestStage = Number.isFinite(parsed.highestStage as number) ? (parsed.highestStage as number)
      : (Number.isFinite(parsed.stage as number) ? (parsed.stage as number) : base.highestStage)

    // 一次性发放：领过的（含 freshState 预置标记）直接跳过；发完把 label 记下来，启动时提示一次
    const inventory = { ...base.inventory, ...(parsed.inventory ?? {}) }
    // 角色碎片改名并通用化（v1.25）：圣阶角色碎片 → 角色碎片。**数值原样搬过去**，
    // 玩家攒的碎片不能在改名时蒸发；旧键必须显式删掉，否则上面那句 `...parsed.inventory`
    // 会把它一直带着，存档里永远留着一个没人读的幽灵字段。
    if (num(inventory.shard_sheng) > 0) inventory.shard = num(inventory.shard) + num(inventory.shard_sheng)
    delete inventory.shard_sheng
    const gifts: Record<string, number> = { ...(parsed.gifts as Record<string, number> | undefined) }
    for (const g of GIFTS) {
      if (gifts[g.id] !== undefined) continue
      g.grant(inventory)
      gifts[g.id] = Date.now()
      this.justGranted.push(g.label)
    }

    // 保底计数三层化（v1.21.5）。老档只有 pityCommon（30 抽必出地阶+）和 pityRare（90 抽必出天阶+）。
    // 老档的 pityRare 只在触发时归零，所以它**直接等于玩家的终身抽数**（线上实测 26~71），
    // 而那个 90 抽保底全服无人触及——等于攒了几十次空手。把它继承成圣阶保底进度是对老玩家的补偿：
    // 抽了 52 次的老号下次进游戏就有 52/60 的圣阶进度，新号则从 0 起要抽满 60。
    const legacy = parsed as { pityCommon?: unknown; pityRare?: unknown }
    const pityClamp = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.floor(num(v))))
    const pityTian = Number.isFinite(parsed.pityTian as number) ? pityClamp(parsed.pityTian, PITY_TIAN) : 0
    const pityQuasi = Number.isFinite(parsed.pityQuasi as number) ? pityClamp(parsed.pityQuasi, PITY_QUASI) : 0
    const pitySheng = Number.isFinite(parsed.pitySheng as number)
      ? pityClamp(parsed.pitySheng, PITY_SHENG)
      : pityClamp(legacy.pityRare, PITY_SHENG)

    // 终身累计计数（手气榜）：非负整数，**外加一条结构性约束 `shengCount ≤ pullCount`**。
    // 为什么必须有这条：圣阶数是「平均多少抽一张」的**分母**，而这张榜越低越好 ——
    // 分母被吹大就等于直接空降第一名。抽数少于张数在任何真实玩法下都不可能发生，
    // 所以这不是拍脑袋的上限，是玩法本身的不变量（抗伪造的通用上限留给 ④ /save 收窄那条线）。
    const luckCount = (v: unknown) => (Number.isFinite(v as number) ? Math.max(0, Math.floor(v as number)) : 0)
    const pullCount = luckCount(parsed.pullCount)
    const shengCount = Math.min(luckCount(parsed.shengCount), pullCount)

    // ── ★ v1.60 迁移：把"新手保底"补给**走到一半的存量新号** ────────────────────
    // 背景：那件第一件装备、以及修炼/强化要用的结晶与精血，原本是**序章战斗 `0-1` 的首通奖励**。
    // v1.60 把剧情从引导链路里摘掉之后（用户 2026-09-22「不要自己单独做个旅程模块的战斗」），
    // 保底改由 `freshState()` **开局就发** —— 于是有一个窗口期：在那之前创建、还卡在
    // 教程战斗之前或之中的存档，`equipBag` 是空的、结晶是 0，而新引导里
    // "第一次修炼 → 第一次装备 → 强化" 是**强制**的（分别要 20 结晶 / 一件装备 / 800 结晶 + 2 精血）
    // ⇒ **发不出东西的强制引导 = 玩家出不去**。`story.ts` 里 `0-1` 那格注释早就写着"不发就必然卡死"。
    //
    // ⚠️ 判据刻意**窄**，两条都必须读清楚再改：
    //   · `!story.finished` —— 只补**还在引导里**的号。老玩家由 `sanitizeStoryState` 置了
    //     `finished`，一根汗毛都不会被碰到；这与整张引导表"只对新号"的口径同源。
    //   · `gifts['onboard-kit-v160']` —— **一次性**。幂等键借用现成的 `gifts` 表：
    //     它本来就是"领过的直接跳过"的终身发放记录，随存档与云备份走。
    //     **不新增存档字段** —— 存档结构是红线，而这个需求它本来就能满足。
    //
    // ⚠️ 只补**差额**（`Math.max`），不是无脑加：已经在别处挣到一部分的号不会被重复喂满。
    //    这条也让整个分支**幂等**：就算某次没能写下幂等键，再跑一遍也不会多发。
    // ⚠️ 数值**原样照抄** `freshState()` 那一行（coin 400 / crystal 1000 / essence 5 + 一件黄品武器）
    //    —— 新手经济一分钱没变，变的只是"什么时候到手"。
    const story = sanitizeStoryState(parsed.story, playedBeforeStory(parsed, roster))
    const equipBag: EquipItem[] = Array.isArray(parsed.equipBag)
      ? parsed.equipBag.map(sanitizeEquipItem).filter((x): x is EquipItem => !!x) : []
    if (!story.finished && gifts['onboard-kit-v160'] === undefined) {
      const atLeast = (cur: unknown, want: number) => Math.max(Number.isFinite(cur as number) ? (cur as number) : 0, want)
      inventory.coin = atLeast(inventory.coin, 400)
      inventory.crystal = atLeast(inventory.crystal, 1000)
      inventory.essence = atLeast(inventory.essence, 5)
      if (equipBag.length === 0) equipBag.push(rollEquip('weapon', 'yellow'))
      gifts['onboard-kit-v160'] = Date.now()
    }

    const out: GameState = {
      ...base,
      ...parsed,
      roster,
      team,
      battle: null,
      inventory,
      gifts,
      stage: Number.isFinite(parsed.stage as number) ? (parsed.stage as number) : base.stage,
      highestStage,
      farmStage: (typeof parsed.farmStage === 'number' && parsed.farmStage >= 1 && parsed.farmStage <= highestStage) ? parsed.farmStage : null,
      lastProgressAt: Number.isFinite(parsed.lastProgressAt as number) ? (parsed.lastProgressAt as number) : Date.now(),
      lab: { ...base.lab, ...(parsed.lab ?? {}), battle: null },
      combatEvents: [],
      equipBag,
      // v1.38.2 老存档一律没有这个字段 ⇒ sanitizeReforgeUndo(undefined) = null，键存在但不影响任何老行为
      reforgeUndo: sanitizeReforgeUndo(parsed.reforgeUndo),
      buffs: Array.isArray(parsed.buffs) ? parsed.buffs.filter(b => b && typeof b.expireAt === 'number' && b.expireAt > Date.now()) : [],
      pityTian,
      pityQuasi,
      pitySheng,
      // 手气榜的终身累计计数（v1.47）。**刻意不做回溯播种**：老档一律从 0 起 ——
      // 「抽到过几张圣阶」在存档里根本不存在（pitySheng 会归零、roster 会去重也会被分解/兑换增删），
      // 估算出来的数各人偏差方向还不一致，宁可榜先稀一阵也不摆假数据。
      // 必须放在 `...parsed` 之后：否则畸形值会盖掉这里的净化结果。
      pullCount,
      shengCount,
      shop: (parsed.shop && typeof parsed.shop.counts === 'object' && parsed.shop.counts)
        ? { date: parsed.shop.date, counts: parsed.shop.counts }
        : { date: todayKey(), counts: {} },
      // v1.42 活动中心。老存档一律没有这个字段 ⇒ 补一份空的（进度从零开始，**绝不因此判死档**）
      activities: sanitizeActivityState(parsed.activities),
      // v1.54 新手引导 + 第一章剧情。⚠️ 这一条与上面所有字段**方向相反** ——
      // 别的字段老存档补默认值（从零开始），这一个老存档要补**"已完成"**：
      // 已经有进度的玩家明天打开游戏，绝不能连看六幕序章再被登记卡住。
      // 判据（三个都不成立才当新号）见 sanitizeStoryState 的注释。
      // ⚠️ 它的计算已经提到上面去了（v1.60 迁移要用它判 `finished`），这里只引用，别重算 ——
      //    同一件事两份计算正是"两处各判一次必然漂"的老毛病。
      story,
      // 剧情战斗**不进存档**，读档一律作废重来（见 GameState.storyBattle 的注释）：
      // 它只活几十秒，净化它要处理敌人数组/双方血量/控制减益三份畸形值，
      // 而我们能换到的只是"关掉页面再打开能接着打那半场架"。
      storyBattle: null,
    }
    // 上面 `...parsed` 会把老字段一起带进来，留着只会在存档里堆垃圾（新代码不再读它们）
    delete (out as { pityCommon?: unknown }).pityCommon
    delete (out as { pityRare?: unknown }).pityRare
    return out
  }

  /** 挂起本地保存：恢复云存档前调用，防止 reload 时 beforeunload 的 save 把旧内存态写回覆盖 */
  suspendSave() { this.saveSuspended = true }

  /**
   * 拉取并结算服务端奖励清单（见 rewards.ts）。运营加福利只需改 rewards.json，
   * 不用改代码/构建/部署；清单拉不到（404、离线、JSON 坏了）就当没有奖励，绝不影响游戏本身。
   */
  async syncRemoteRewards(): Promise<void> {
    try {
      this.grantRemote(await fetchRemoteRewards())
    } catch { /* 拉不到就算了，等下一次轮询 */ }
  }

  /**
   * 结算一批奖励。幂等键是 state.gifts（与内置 GIFTS 共用同一张表，随存档与云备份走）：
   * 领过的直接跳过，所以清单里留着老条目是安全的，运营不必手工清理。
   *
   * ⚠️ **public、且服务端必需**（SPEC §4.5.5）：Node 里没有 `fetch`，服务端宿主读
   * `rewards/rewards.json`、用 `parseRewards` 解析后从这里塞进来。**服务端权威下这件事
   * 必须由服务端做** —— 以前靠客户端打开页面时自己拉，现在玩家的存档是服务端在写，
   * 客户端拉完也无处可写（写了自己那份也随即被权威态覆盖）。
   */
  grantRemote(list: RemoteReward[]): void {
    if (list.length === 0) return
    const gifts = { ...(this.state.gifts ?? {}) }
    const inventory = { ...this.state.inventory }
    const labels: string[] = []
    const now = Date.now()
    let touched = false
    for (const r of list) {
      if (gifts[r.id] !== undefined) continue
      if (r.expiresAt > 0 && now > r.expiresAt) continue // 过期就不发，也不登记——活动重开时还能再发
      // 新号遇上"补偿老玩家"性质的奖励：只登记不发放。标 0 而不是时间戳，跟 freshState 对内置
      // GIFTS 的预置标记同一个写法，存档里一眼能看出是"压根没发过"而非"某时刻领过"。
      if (this.newAccount && !r.newPlayersToo) { gifts[r.id] = 0; touched = true; continue }
      for (const k of Object.keys(r.items)) inventory[k] = num(inventory[k]) + r.items[k]
      gifts[r.id] = now
      labels.push(r.label)
      touched = true
    }
    if (!touched) return
    this.state.gifts = gifts
    this.state.inventory = inventory
    this.save() // 立刻落盘：到账要尽快随云备份上传，别等 2 秒定时器（关页面就走不到那一步）
    this.emit()
    if (labels.length) this.setNotice(`礼包到账：${labels.join('、')}`)
  }

  /**
   * 这封邮件领过没有。领取标记与奖励**共用 state.gifts**（键加 `mail:` 前缀隔开，见 mail.ts），
   * 所以整个邮箱功能**一个存档字段都没加** —— 老档不用迁移，也不存在"迁移漏了哪个分支"的风险。
   */
  mailClaimed(id: string): boolean {
    return (this.state.gifts ?? {})[mailGiftKey(id)] !== undefined
  }

  /**
   * 领取一封邮件的附件（纯公告邮件没有附件，点的就是「知道了」——同样记在这里）。
   *
   * 重复点、多标签页同时点、领完刷新再点，都只会到账一次：幂等键就是 gifts 里那个键。
   * 附件数值已由 mail.ts 的白名单校验过（非法的那封根本不会进到列表里）。
   */
  claimMail(mail: Mail): boolean | Promise<boolean> {
    // ⚠️ **只把 id 送上去，附件一个字节都不传**（SPEC §4.5.5）：服务端自己从 mail.json 查那封、
    //    顺带校验收件人确实是本人，然后按**它读到的那份附件**发货。
    //    客户端权威时代这里送的是整个 Mail 对象（含 items），服务端权威下那就是
    //    「客户端能凭空签发 yuanfen: 9999」的洞 —— 这正是本轮要收掉的东西之一。
    if (this.remote) {
      return this.postAction<boolean>('claimMail', { mailId: mail.id }).then(r => r.ok && r.result === true)
    }
    const key = mailGiftKey(mail.id)
    if ((this.state.gifts ?? {})[key] !== undefined) return false
    const gifts = { ...(this.state.gifts ?? {}) }
    const inventory = { ...this.state.inventory }
    const keys = Object.keys(mail.items ?? {})
    for (const k of keys) inventory[k] = num(inventory[k]) + mail.items[k]
    gifts[key] = Date.now()
    this.state.gifts = gifts
    this.state.inventory = inventory
    // 立刻落盘：到账要尽快随云备份上传，别等 2 秒定时器（关页面就走不到那一步）
    this.save()
    this.emit()
    if (keys.length) this.setNotice(`邮件附件已领取：${mail.title}`)
    return true
  }

  // ── 活动中心（v1.42，配置见 game/activities.ts）──────────────────────────────
  //
  // 三条不变量，改这块之前先看这三条：
  //  ① 活动**不是**发奖清单。rewards.json 是"拉到就自动到账"，活动是"玩家自己来点领取"——
  //     所以活动配置只存在内存里（this.remoteActivities），存档里**只留进度**。
  //  ② 领取状态不另立字段，就写在 state.activities.claimed 里（once 看有没有、daily 看是不是今天的），
  //     这张表因此**不随天数增长**，也没有任何清理逻辑。
  //  ③ 判定与发放在**同一处**（claimActivity）：界面上的按钮藏不藏是第二道闸，
  //     v1.41 已经吃过一次"界面藏了、引擎没拒"的教训。

  /** 当日计数与当日在线时长跟着日期走；跨天清零。**全站日期口径只有 activities.todayKey 一处** */
  private ensureActivityDay() {
    // ⚠️ 远程模式下**必须 no-op**：权威日界在服务端（`todayKey()` 用的是运行环境的本地日历，
    //    服务端与浏览器的时区/时钟未必一致）。本地按浏览器日历清一次 day 表，就会与服务端
    //    那份打架 —— 而 `syncActivities()`（远程模式下**特意保留**的那条）也会走到这里。
    if (this.remote) return
    const a = this.state.activities
    const today = todayKey()
    if (a.date !== today) {
      a.date = today
      a.day = {}
      a.dayOnlineMin = 0
    }
  }

  /**
   * 在线时长累加（tick 里调，单位分钟）。
   * **离线时间不算在线**：引擎不跑就不会累加，而加载时的 applyOfflineProgress 只补资源、不碰这里。
   */
  private accrueOnline(minutes: number) {
    if (!(minutes > 0)) return
    this.ensureActivityDay()
    const a = this.state.activities
    a.onlineMin = num(a.onlineMin) + minutes
    a.dayOnlineMin = num(a.dayOnlineMin) + minutes
  }

  /**
   * 记一次计数指标（活动中心「任务类」的进度）。**挂点唯一**：每个指标只在一个动作处调一次。
   *
   * 白名单外的指标名直接忽略 —— 这不是给配置容错（配置那边的校验更早），是给**调用方**兜底：
   * 挂点上敲错一个字母，不该往存档里堆一个永远没人读、还会随云备份传下去的垃圾键。
   */
  bumpMetric(metric: string, n = 1) {
    // ⚠️ 远程模式下**服务端计数**（§4.6）：绝大多数指标（stage.win / recruit / reforge / …）
    //    服务端在自己的动作路径上已经记过了；客户端再记一次 = 双份。
    //    世界 Boss 那两个（boss.hit / match3.tiles）**客户端才有**（消消乐的一笔结算只有它拿得到），
    //    它们走 `/worldboss` 的 `clears`/`tiles` 字段上交，不从这里走（见 WorldBossView）。
    //    ⚠️ 2026-09-18 起，服务端**不再直接采信**这两个上报值（当时前端伪造成天文数字就能一次打满
    //    两个每日活动）：服务端改按**已验证的伤害**反推格数/出手次数，再与上报值取 min —— 上报值
    //    现在只是「我是会带这两个字段的新客户端」的标记 + 一个宽松上界。客户端**一个字都不用改**。
    if (this.remote) return
    if (!(metric in ACTIVITY_METRICS) || !(n > 0)) return
    this.ensureActivityDay()
    const a = this.state.activities
    a.total[metric] = num(a.total[metric]) + n
    a.day[metric] = num(a.day[metric]) + n
    // 不在这里 save()/emit()：调它的那些动作各自都会落盘并重渲，再补一次纯属多余
  }

  /** 服务端活动配置（内存态，不存档）。**只保留进行中且启用中的**，界面拿到的就是能玩的那些 */
  activityList(now: number = Date.now()): ActivityDef[] {
    return activeActivities(this.remoteActivities, now)
  }

  /**
   * 注入一份活动配置。**服务端专用**（见 SPEC §4.5.5）：浏览器走 `syncActivities()`。
   *
   * 比较后才赋值 + 重渲 —— 宿主会定期重读配置文件（运营改文件要即刻生效），
   * 不比较的话每隔几十秒就来一次无意义的重渲。
   */
  setRemoteActivities(list: ActivityDef[]): void {
    if (JSON.stringify(list) === JSON.stringify(this.remoteActivities)) return
    this.remoteActivities = list
    this.emit()
  }

  /** 拉活动配置。拉不到就**沿用上一次的清单**（有旧配置总比活动中心突然空掉强），绝不影响游戏本身 */
  async syncActivities(): Promise<void> {
    try {
      this.setRemoteActivities(await fetchActivities())
    } catch { /* 拉不到就算了，等下一次轮询 */ }
  }

  /** 活动当前的进度值。签到类**没有进度概念**（它的"完成"就是点那一下），走 activityReached */
  activityProgress(a: ActivityDef): number {
    this.ensureActivityDay()
    const s = this.state.activities
    if (a.kind === 'online') return num(a.cycle === 'daily' ? s.dayOnlineMin : s.onlineMin)
    if (a.kind === 'task') return num(a.cycle === 'daily' ? s.day[a.metric] : s.total[a.metric])
    return 0
  }

  /** 进度是否达标。**签到类恒为达标** —— 签到的前置条件就是"今天还没签"（由 claimed 判） */
  activityReached(a: ActivityDef): boolean {
    if (a.kind === 'checkin') return true
    return this.activityProgress(a) >= a.target
  }

  /**
   * 领过没有。once 型领过就永久算领过；daily 型只看**是不是今天领的** ——
   * 于是 claimed 表不会随天数增长（每天只是覆盖同一个键），也不需要清理。
   */
  activityClaimed(a: ActivityDef, now: number = Date.now()): boolean {
    const t = this.state.activities.claimed[a.id]
    if (t === undefined) return false
    return a.cycle === 'once' ? true : todayKey(t) === todayKey(now)
  }

  activityClaimable(a: ActivityDef, now: number = Date.now()): boolean {
    return a.enabled && activityStatus(a, now) === 'active' && !this.activityClaimed(a, now) && this.activityReached(a)
  }

  /** 现在有几个能领的（tab 上的小红点）。配置还没拉回来时是 0 */
  claimableCount(now: number = Date.now()): number {
    return this.activityList(now).filter(a => this.activityClaimable(a, now)).length
  }

  /**
   * 一条活动**此刻领到手**的那份奖励 —— 界面上的奖励文字走这里，不走 `a.items`。
   * 与 `claimActivity` 的实际发放共用 `scaledItems`，所以"看到的"和"到账的"不可能分叉。
   * 界面若直接渲染 `a.items`，后期玩家会看到"写着 2000、实际到账 26000"。
   */
  activityRewardOf(a: ActivityDef): Record<string, number> {
    return scaledItems(a, num(this.state.highestStage))
  }

  /**
   * 领取一份活动奖励。**判定与发放都在这里**，界面只管调它——
   * 重复点、多标签页同时点、领完刷新再点，都只到账一次（幂等键就是 claimed 里的那个时间戳）。
   */
  claimActivity(id: string): { ok: boolean; why?: string } | Promise<{ ok: boolean; why?: string }> {
    // 同上：`{ok:false,why}` 会被服务端翻成 `refused`，这里翻回来
    if (this.remote) {
      return this.postAction<{ ok: boolean; why?: string }>('claimActivity', { id })
        .then(r => r.ok ? (r.result ?? { ok: true }) : { ok: false, why: r.why })
    }
    const now = Date.now()
    const a = this.remoteActivities.find(x => x.id === id)
    if (!a || !a.enabled) return { ok: false, why: '活动不存在或已下架' }
    const st = activityStatus(a, now)
    if (st === 'pending') return { ok: false, why: '活动尚未开启' }
    if (st === 'ended') return { ok: false, why: '活动已结束' }
    if (this.activityClaimed(a, now)) {
      return { ok: false, why: a.cycle === 'daily' ? '今日已领取，明天再来' : '已领取' }
    }
    if (!this.activityReached(a)) return { ok: false, why: '条件尚未达成' }

    const s = this.state.activities
    // 到手的量走 `scaledItems`（v1.47 关卡放大）—— 与界面上写的那个数**必须**是同一份，
    // 所以两边都调这个函数，而不是各乘一次倍数。
    const gain = scaledItems(a, num(this.state.highestStage))
    const inventory = { ...this.state.inventory }
    for (const k of Object.keys(gain)) inventory[k] = num(inventory[k]) + gain[k]
    this.state.inventory = inventory
    s.claimed = { ...s.claimed, [a.id]: now }

    // 签到类：顺手记连续天数。昨天签过就 +1，否则重新从 1 起（跨天判定走同一个 todayKey）
    if (a.kind === 'checkin') {
      s.streak = s.lastCheckin === todayKey(now - 86400000) ? num(s.streak) + 1 : 1
      s.lastCheckin = todayKey(now)
      this.bumpMetric('checkin.days', 1)
    }

    // 立刻落盘：到账要尽快随云备份上传，别等 2 秒定时器（关页面就走不到那一步）
    this.save()
    this.emit()
    this.setNotice(`活动奖励已领取：${a.title}`)
    return { ok: true }
  }

  save() {
    // ⚠️ 远程模式下**引擎不落盘**：本机那份只是"断网时首屏能画出来"的副本，
    //    由 `writeCache()` 节流写（§4.6）。留成 no-op 而不是删掉各调用方 ——
    //    引擎内部十几处"到账立刻落盘"，逐个删既易漏，又会把"这条路径改了权威态"
    //    这个信息一起删掉，以后更难看懂。
    if (this.remote || this.saveSuspended) return
    try {
      const next = JSON.stringify(this.state)
      // 写入前先把上一份完好存档备份到 .bak：主存档万一写坏，下次启动可回退，杜绝死档
      const prev = this.storage.getItem(SAVE_KEY)
      if (prev && prev !== next) this.storage.setItem(SAVE_KEY + '.bak', prev)
      this.storage.setItem(SAVE_KEY, next)
    } catch { /* ignore（如隐私模式/超额）*/ }
  }

  /**
   * 把服务端那份状态写进本机缓存。**只作副本，绝不回传**（远程模式下不再有 `POST /save`）。
   *
   * 它存在的唯一理由：断网时首屏还能画出"上次看到的样子"，而不是一片空白。
   * 节流 30 秒 + `pagehide` 各一次 —— 全量 188KB，按 1Hz 写会把主线程卡住。
   */
  writeCache(force = false) {
    if (!this.remote) return
    const now = Date.now()
    if (!force && (!this.cacheDirty || now - this.lastCacheAt < CACHE_MIN_MS)) return
    this.cacheDirty = false
    this.lastCacheAt = now
    try {
      const next = JSON.stringify(this.state)
      const prev = this.storage.getItem(SAVE_KEY)
      if (prev === next) return
      // ⚠️ **原始那份只让位一次**：第一次写副本前，把这台设备**本来的**存档挪进 .bak。
      //    之后每次写都往 .bak 塞"上一份服务端状态"的话，30 秒后老玩家本机那份就没了 ——
      //    而那是他升级到服务端权威之前**唯一的本机备份**。
      if (prev && !this.cacheStashed) this.storage.setItem(SAVE_BAK_KEY, prev)
      this.cacheStashed = true
      this.storage.setItem(SAVE_KEY, next)
    } catch { /* ignore（隐私模式/超额） */ }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = () => this.view
  private emit() {
    this.state = { ...this.state }
    // 本地提示只盖在**快照**上，不写进 `state`（见 setNotice）
    this.view = this.localNotice ? { ...this.state, notice: this.localNotice } : this.state
    this.listeners.forEach(fn => fn())
  }

  setNotice(text: string) {
    if (this.remote) {
      // ⚠️ 远程模式下 `state.notice` **归服务端所有**：服务端的引擎也会写它（"首通第 N 关！"、
      //    "全队阵亡，撤退疗伤中…"），那些话必须到玩家眼前。所以本地提示不去写 state ——
      //    写了会①下一秒被服务端的增量打回、或者反过来把服务端那句话吞掉，②还会被写进本机副本。
      //    做法：本地提示临时盖在 `view` 的 notice 上 3 秒，`state` 一个字节不动。
      this.localNotice = text
      if (this.localNoticeTimer) clearTimeout(this.localNoticeTimer)
      this.localNoticeTimer = setTimeout(() => {
        this.localNoticeTimer = null
        this.localNotice = ''
        this.emit()
      }, 3000)
      this.emit()
      return
    }
    this.state.notice = text
    setTimeout(() => {
      if (this.state.notice === text) { this.state.notice = ''; this.emit() }
    }, 3000)
  }

  // ── 远程模式：状态同步与动作（SPEC §4.6）────────────────────────────────────
  //
  // 这一段的全部职责：**把服务端那份状态拿过来渲染，把玩家的动作送回去执行**。
  // 客户端在这条链路上不产生任何数值 —— 它连一个 `+=` 都不做。
  //
  // 三条不变量，改这一段之前先看这三条：
  //  ① **值直接赋值，绝不 `JSON.parse`**。服务端的 `wrapParts()` 把已经序列化好的字符串
  //     包成 `Raw`、`json()` 原样内联进回执体，所以 `res.json()` 解出来**已经是解析好的值**
  //     （2026-09-18 在 8790 沙盒实测：`inventory` 是 object、`stage` 是 number、
  //     **`notice` 是 string**）。再 parse 一次会把 `notice` 这类本身就是字符串的键解析坏。
  //  ② **合并增量只覆盖已有键，绝不新增**。`state` 与 `saves/<pid>.json` 的 data 同构是
  //     回滚红线（老客户端读得懂同一份东西），多一个键就会随本机副本漏出去。
  //  ③ **断线/未登录一律只读**，绝不用本地状态重建权威、绝不回退到本地执行动作 ——
  //     那正是这一整轮要拆掉的绕过口。

  /** 远程模式的两条请求共用的前缀（与 authApi/saveApi 同一处口径：带构建前缀）。 */
  private api(path: string): string { return `${import.meta.env.BASE_URL}api${path}` }

  /** 每次玩家意图一个唯一编号，服务端据此保证重放只结算一次。 */
  private requestId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    } catch { /* 降级到时间戳 + 随机数 */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  }

  /** 界面上要用它判断"显示重连中 / 禁用按钮"。**不要**据此做业务判断。 */
  remoteStatus(): { remote: boolean; down: boolean; needLogin: boolean; loaded: boolean } {
    return { remote: this.remote, down: this.remoteDown, needLogin: this.needLogin, loaded: this.srev > 0 }
  }
  isRemote(): boolean { return this.remote }
  /** 时钟偏移（服务端 − 本地）。`combatEvents[].time` 是服务端时钟，界面按需换算。 */
  skewMs(): number { return this.clockSkew }

  /**
   * 用服务端下发的**全量**状态替换本地那份（首次进入、或游标太旧服务端回了全量）。
   * @returns 实际覆盖到的键数
   */
  applyRemoteFull(remote: Record<string, unknown>): number {
    const self = this.state as unknown as Record<string, unknown>
    let n = 0
    for (const k of Object.keys(self)) {
      if (k in remote) { self[k] = remote[k]; n++ }
    }
    this.remoteDown = false
    this.needLogin = false
    this.cacheDirty = true
    this.emit()
    this.writeCache()
    return n
  }

  /**
   * 合并服务端回的一批**变化的键**（`/state` 的增量与 `/action` 的 `changed` 是同一个形状）。
   * @returns 实际合并到的键数
   */
  applyRemoteDelta(changed: Record<string, unknown> | null | undefined): number {
    if (!changed) return 0
    const self = this.state as unknown as Record<string, unknown>
    let n = 0
    for (const k of Object.keys(changed)) {
      // ⚠️ 不认识键就**丢掉并留痕**（不变量②）。服务端理论上不会多发，但这是客户端这一侧
      //    唯一的形状闸 —— 静默接收一个新键，等于把"同构"这条回滚红线交给对端去守。
      if (!(k in self)) { console.warn('[remote] 忽略服务端发来的未知键：' + k); continue }
      self[k] = changed[k]
      n++
    }
    if (n) { this.cacheDirty = true; this.emit() }
    return n
  }

  /**
   * 把一个动作送到服务端执行（SPEC §4.5.3）。**远程模式下所有写操作的唯一出口。**
   *
   * 串行队列：同一时刻只允许一个在飞，两次之间留 `ACTION_MIN_MS`（> 服务端的 120ms）。
   * 为什么必须串行：这些动作之间**大多不可交换**（先买后穿 vs 先穿后买结果不同），
   * 并发发出去等于把顺序交给网络。
   *
   * ⚠️ **绝不自动重试**：网络失败时这个动作**可能已经在服务端执行过了**，重试就是双花
   *    （抽卡抽两次、扣两次钱）。失败就是失败，交给玩家再点一次 —— 他会看到结果。
   * ⚠️ 本函数**从不 reject**：调用方可以放心地 `void game.xxx()` 而不接 rejection。
   */
  postAction<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<ActionOutcome<T>> {
    const offline = (reason: string, why?: string): ActionOutcome<T> =>
      ({ ok: false, result: null, reason, why })

    if (!this.remote) return Promise.resolve(offline('offline', '本地模式不走服务端动作'))
    if (this.needLogin) return Promise.resolve(offline('need_login', '登录状态已失效，请重新登录'))

    const run = async (): Promise<ActionOutcome<T>> => {
      const wait = this.lastActionAt + ACTION_MIN_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastActionAt = Date.now()

      let j: Record<string, unknown>
      try {
        const r = await apiFetch(this.api('/game/action'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op, args, requestId: this.requestId(), playerId: getRemotePid() }),
        })
        j = await r.json()
      } catch {
        this.remoteDown = true
        this.emit()
        this.setNotice('连不上服务器，这次操作没有送出')
        return offline('network', '连不上服务器')
      }

      // 回执里带 `rev`/`srev` ⇒ 服务端在应答（哪怕业务上被拒）⇒ 连接是通的
      if (j.rev !== undefined) this.remoteDown = false
      if (Number.isInteger(j.srev)) this.srev = j.srev as number
      // 被拒也带 `changed`（有的 op 会改了一部分才早退，由服务端决定）。照合并，
      // 不去猜"这次到底动没动过" —— 猜错就会把一个真实的改动当成没发生。
      if (j.changed) this.applyRemoteDelta(j.changed as Record<string, unknown>)

      if (j.ok === true) {
        return { ok: true, result: (j.result ?? null) as T | null }
      }

      const reason = String(j.reason || 'error')
      // 限频**静默**：那是服务端在防守，不是玩家的错，弹一句"你太快了"只会让人以为游戏坏了
      if (reason === 'rate') return offline(reason)
      if (reason === 'need_login') {
        this.needLogin = true
        this.emit()
        this.setNotice('登录状态已失效，请重新登录')
        return offline(reason, '需要重新登录')
      }
      if (reason === 'refused') {
        // 引擎自己的业务拒绝，`why` 是它给的那句话（"缘分丹不足"），**原样显示**
        const why = typeof j.why === 'string' ? j.why : '这个操作没能完成'
        this.setNotice(why)
        return offline(reason, why)
      }
      // `bad_op` / `bad_args` 是**客户端自己的 bug**（op 名字写错、参数形状不对）：
      // 留一条带具体 op 的控制台记录，否则它只会表现成"点了没反应"。
      console.error('[remote] 服务端拒绝了动作', op, reason)
      this.setNotice('这个操作没能完成')
      return offline(reason)
    }

    // 串到队尾。`then(run, run)`：前一个失败了也要接着跑下一个（不是 reject 链）
    const p = this.actionQueue.then(run, run)
    // 队列自身要吞掉结果，否则一次失败会污染后面所有 then
    this.actionQueue = p.then(() => undefined, () => undefined)
    return p
  }

  /**
   * 远程模式下把动作交给服务端、**把引擎那套返回值原样翻回来**；本地模式返回 `null`
   * 表示"你自己往下走"。每个写方法的第一行都长这样：
   *
   * ```ts
   * const fwd = this.delegate<Result>('opName', { a, b })
   * if (fwd) return fwd
   * ```
   *
   * 之所以判断 `if (fwd)` 而不是 `if (this.remote)`：**只有一个地方**知道"远不远程"。
   * 本地那条路因此一个字节都没动 —— 老锚点回归靠的就是这一点。
   *
   * ⚠️ 用它的前提是"服务端的 `result` 就是引擎的返回值"。**形状带 `ok/why` 的那两个
   *    （`redeemShard`/`claimActivity`）不走这里**：服务端会把 `{ok:false,why}` 翻成
   *    `reason:'refused'`，得自己翻译回来（见各自的方法）。
   */
  private delegate<T>(op: string, args: Record<string, unknown>): Promise<T> | null {
    if (!this.remote) return null
    return this.postAction<T>(op, args).then(r => r.result as T)
  }

  /**
   * 拉一次服务端状态。首次（`srev === 0`）必然是全量；之后带游标取增量。
   * 自愈：游标太旧（服务端的状态环被裁掉了）时服务端会回全量，这里照收。
   */
  async pollState(): Promise<void> {
    if (!this.remote || this.polling) return
    this.polling = true
    const wasDown = this.remoteDown || this.needLogin
    let applied = 0
    try {
      const pid = getRemotePid()
      const r = await apiFetch(this.api(`/game/state?playerId=${encodeURIComponent(pid)}&since=${this.srev}`))
      const j = await r.json().catch(() => null)
      if (!j || j.ok !== true) {
        // `need_login`：服务端明确说"这个身份不合法"。**绝不回退到本地算账**（不变量③）——
        // 表现只能是"提示重登 + 只读"。老玩家（没账号的裸存档码）会被正常受理，不走这里。
        if (j && j.reason === 'need_login') this.needLogin = true
        else this.remoteDown = true
        this.emit()
        return
      }
      this.remoteDown = false
      this.needLogin = false
      if (typeof j.serverTime === 'number') this.clockSkew = j.serverTime - Date.now()
      if (Number.isInteger(j.srev)) this.srev = j.srev as number
      if (j.state) applied = this.applyRemoteFull(j.state as Record<string, unknown>)
      else if (j.changed) applied = this.applyRemoteDelta(j.changed as Record<string, unknown>)
    } catch {
      this.remoteDown = true
      this.emit()
      return
    } finally {
      this.polling = false
    }
    // 状态没变、但"在线/离线"这个显示位变了 ⇒ 也得重渲一次，否则"重连中"会一直挂着
    if (applied === 0 && wasDown) this.emit()
  }

  /**
   * 起轮询。**这一步之后玩家才算"在线"** —— 服务端按"90 秒内有过 `/state` 或 `/action`"判，
   * 所以轮询本身就是心跳，没有单独的心跳端点。
   */
  startRemoteLoop() {
    if (!this.remote) return
    // 只允许起**一条**链。`pollState` 自己带在飞保护，但两条链会各排各的定时器
    // ⇒ 请求量翻倍、还都在写同一份 `srev` 游标。这个字段就是"链已经起过"的标记
    // （不复位：这个循环本来就活到页面关掉为止）。
    if (this.remoteTimer !== null) return
    const tick = async () => {
      await this.pollState()
      const hidden = typeof document !== 'undefined' && document.hidden
      this.remoteTimer = setTimeout(() => { void tick() }, hidden ? STATE_POLL_HIDDEN_MS : STATE_POLL_MS)
    }
    void tick()
    if (typeof window === 'undefined') return
    // 关页面/切后台时把副本落一次（节流的那 30 秒可能刚好没到）
    window.addEventListener('pagehide', () => this.writeCache(true))
    document.addEventListener('visibilitychange', () => {
      // 切回前台立刻拉一次：后台期间浏览器会把定时器降频，玩家看到的可能是几十秒前的画面
      if (!document.hidden) void this.pollState()
    })
  }

  // ── 斗气结晶（挂机产出，随打坐弟子数量增长）────────────────────────────────
  crystalPerSec(): number {
    const rosterCount = Object.keys(this.state.roster).length
    return 0.6 + rosterCount * 0.15
  }

  // ── 灵药（药园挂机产出，供炼丹合成丹药）────────────────────────────────────
  herbPerSec(): number {
    const rosterCount = Object.keys(this.state.roster).length
    return 0.3 + rosterCount * 0.05
  }

  /**
   * 结算离线收益：按 `lastTick` 到现在补挂机产出的结晶/灵药（上限 8 小时），**不推进战斗**。
   *
   * ⚠️ **public** —— 服务端在「离线转在线」时调它（SPEC §4.4.2）。
   * 客户端那侧由构造函数调一次（打开页面时），行为与历史一致。
   */
  applyOfflineProgress() {
    const nowMs = Date.now()
    const dt = Math.min((nowMs - this.state.lastTick) / 1000, 8 * 3600)
    if (dt > 1) {
      this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + this.crystalPerSec() * dt
      this.state.inventory.herb = (this.state.inventory.herb ?? 0) + this.herbPerSec() * dt
    }
    this.state.battle = null
    this.state.lastTick = nowMs
  }

  /**
   * ⚠️ **public** —— 服务端按 1Hz 同步驱动它（SPEC §4.4.2）。
   * 浏览器侧由构造函数里的 100ms 循环调用，行为与历史一致；`dt` 按**真实时间差**算，
   * 所以驱动的频率可任意放宽（1 秒一次不会漏回合，战斗回合本身是 2 秒）。
   */
  tick() {
    const nowMs = Date.now()
    const dt = Math.min((nowMs - this.state.lastTick) / 1000, 5)
    // 活动中心的「在线时长」用**另一个 dt**，别跟上面那个混：
    // 上面那个上限 5 秒是给战斗/产出用的（防止关页面很久后一次补一大笔），
    // 而浏览器会把后台标签页的定时器降频到分钟级 —— 用 5 秒的上限累加在线时长，
    // "挂在后台"的时间几乎全丢，可那正是挂机游戏玩家的常态。
    // 这里按 wall-clock 累加、单次最多算 5 分钟：兜住系统休眠/时钟跳变那种"其实不在线"的巨大间隔。
    const onlineDt = Math.min(Math.max(0, nowMs - this.state.lastTick), 5 * 60 * 1000) / 60000
    this.state.lastTick = nowMs
    this.accrueOnline(onlineDt)

    // 限时增益：先剔除已过期的，再按生效中的倍率加成挂机产出
    if (this.state.buffs.some(b => b.expireAt <= nowMs)) {
      this.state.buffs = this.state.buffs.filter(b => b.expireAt > nowMs)
    }
    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + this.crystalPerSec() * this.buffMult('crystal') * dt
    this.state.inventory.herb = (this.state.inventory.herb ?? 0) + this.herbPerSec() * this.buffMult('herb') * dt

    if (this.state.battle) {
      this.state.battle.roundTimer -= dt
      while (this.state.battle && this.state.battle.roundTimer <= 0) {
        this.state.battle.roundTimer += ROUND_SEC
        this.battleRound()
      }
    } else if (this.state.autoBattle) {
      this.startBattle()
    }

    // 天梯塔三选一祝福：超过 20s 未选则自动随机选一个，避免玩家不在/没注意时被永久卡住
    if (this.state.lab.offer && Date.now() - (this.state.lab.offerAt || 0) >= LAB_OFFER_TIMEOUT) {
      this.autoResolveOffer()
    }

    if (this.state.lab.battle && !this.state.lab.offer) {
      this.state.lab.battle.roundTimer -= dt
      while (this.state.lab.battle && !this.state.lab.offer && this.state.lab.battle.roundTimer <= 0) {
        this.state.lab.battle.roundTimer += ROUND_SEC
        this.labBattleRound()
      }
    } else if (this.state.lab.autoLab && !this.state.lab.battle && !this.state.lab.offer) {
      this.startLab()
    }

    // 剧情战斗（v1.55）。三条线**并行不互斥**：玩家可以一边挂主线、一边爬塔、
    // 同时点开一段剧情打 —— 这正是"不和主线战斗耦合"要的效果。
    // 但剧情战斗**不自动续**（没有 autoStory 这种东西）：它是一场戏，打赢就该回剧情。
    if (this.state.storyBattle) {
      this.state.storyBattle.roundTimer -= dt
      while (this.state.storyBattle && this.state.storyBattle.roundTimer <= 0) {
        this.state.storyBattle.roundTimer += ROUND_SEC
        this.storyBattleRound()
      }
    }

    const cutoff = Date.now() - 3000
    this.state.combatEvents = this.state.combatEvents.filter(e => e.time > cutoff)

    this.emit()
  }

  // ── 经验分配（通用斗气结晶 → 指定角色）──────────────────────────────────
  trainChar(id: string, amount: number) {
    const fwd = this.delegate<void>('trainChar', { charId: id, amount })
    if (fwd) return fwd
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return
    const have = this.state.inventory.crystal ?? 0
    const want = Math.min(amount, have)
    if (want <= 0) return
    // 只扣真正被吸收掉的部分（见 gainXp）：卡在丹药上时超出的结晶会吐回来，原实现是直接销毁
    const spent = this.gainXp(id, want)
    this.state.inventory.crystal = have - spent
    this.emit()
  }

  /**
   * 加经验并结算升级，返回**实际吸收掉的量**（≤ amount）。
   *
   * 原实现在卡丹药时写 `entry.xp = need`，把超出 need 的那截经验静默销毁了——
   * 玩家把打坐滑条拉满点到「缺丹药」的角色身上，那部分灵晶就凭空没了。
   * 现在超出的部分不计入消耗，由 trainChar 退回。这条不变量还是放生返还的前提：
   * 1 结晶 = 1 经验，经验只被升级消耗 ⇒ 才能从 level/xp 反推出累计投入（见 data.charInvestment）。
   */
  private gainXp(id: string, amount: number): number {
    const entry = this.state.roster[id]
    if (!entry || amount <= 0) return 0
    let absorbed = amount
    entry.xp += amount
    while (true) {
      const need = xpToNext(entry.level)
      if (entry.xp < need) break
      if (needsPillFor(entry.level)) {
        const grade = pillGradeFor(entry.level)
        const pid = `pill${grade}`
        if ((this.state.inventory[pid] ?? 0) < 1) {
          const overflow = entry.xp - need
          entry.xp = need
          absorbed -= overflow
          break
        }
        this.state.inventory[pid] -= 1
        this.setNotice(`${CHAR_MAP[id]?.name} 服丹突破！${realmLabel(entry.level + 1)}`)
        playSound('breakthrough')
      }
      entry.xp -= need
      entry.level += 1
    }
    return absorbed
  }

  // ── 阵容 ───────────────────────────────────────────────────────────────
  setSlot(row: 'front' | 'back', index: number, charId: string | null) {
    const fwd = this.delegate<void>('setSlot', { row, index, charId })
    if (fwd) return fwd
    if (charId && !this.state.roster[charId]) return
    // 越界保护：UI 传错 index 时静默丢弃，绝不让 team 数组长出空洞
    // （空洞里的 undefined 会绕过 `!!x` 之外的判断，让 activeFighters 与实际血条对不上）
    if (index < 0 || index >= this.state.team[row].length) return
    // 同一角色不能同时占用两个位置
    if (charId) {
      for (const r of ['front', 'back'] as const) {
        this.state.team[r] = this.state.team[r].map(x => (x === charId ? null : x))
      }
    }
    this.state.team[row][index] = charId
    this.emit()
  }

  /**
   * 交换两个阵位上的角色（拖拽换位用）。
   *
   * **不复用两次 `setSlot`**：那样中间必然经过"两人都已下阵"的一帧，而 `setSlot` 每次都 emit ——
   * 自动战斗/战斗页正好在那一帧读阵容，看到的就是残缺阵型。这里先取出两人再写回，只 emit 一次。
   */
  swapSlots(a: TeamSlotPos, b: TeamSlotPos) {
    const fwd = this.delegate<void>('swapSlots', { a, b })
    if (fwd) return fwd
    const ta = this.state.team[a.row], tb = this.state.team[b.row]
    if (a.index < 0 || a.index >= ta.length) return
    if (b.index < 0 || b.index >= tb.length) return
    const va = ta[a.index], vb = tb[b.index]
    ta[a.index] = vb
    tb[b.index] = va
    this.emit()
  }

  /**
   * 把战力最高的**未上阵**角色依次填进空位（玩家点「一键补满空位」时才调用），返回补了几人。
   *
   * 刻意**不动已经在阵上的位置** —— 这是"补位"不是"重排"：玩家精心凑的阵营羁绊如果被一键打散，
   * 那这个按钮就成了陷阱。想换人仍然得自己换。
   */
  fillEmptySlots(): number | Promise<number> {
    const fwd = this.delegate<number>('fillEmptySlots', {})
    if (fwd) return fwd
    const used = new Set(this.activeFighters())
    const pool = Object.keys(this.state.roster)
      .filter(id => !used.has(id) && CHAR_MAP[id])
      .sort((a, b) => this.powerOf(b) - this.powerOf(a))
    let filled = 0
    for (const row of ['front', 'back'] as const) {
      const slots = this.state.team[row]
      for (let i = 0; i < slots.length; i++) {
        // 已占位的格子直接跳过（不覆盖），池子空了也停
        if (slots[i] || filled >= pool.length) continue
        slots[i] = pool[filled++]
      }
    }
    if (filled > 0) this.setNotice(`已补入 ${filled} 名武魂`)
    this.emit()
    return filled
  }

  equipFire(fireId: string | null) {
    const fwd = this.delegate<void>('equipFire', { fireId })
    if (fwd) return fwd
    if (fireId && !this.ownsFire(fireId)) { this.setNotice('尚未获得此异火'); return }
    this.state.equippedFire = fireId
    this.emit()
  }

  ownsFire(fireId: string): boolean {
    return (this.state.inventory[`fire_${fireId}`] ?? 0) > 0
  }

  // ── 战斗：不再手选地图，关卡随击杀持续推进，怪物数值随关卡数指数成长 ──────────
  activeFighters(): string[] {
    return [...this.state.team.front, ...this.state.team.back].filter((x): x is string => !!x)
  }

  /** 当前实际交战的关卡：刷材料模式下是 farmStage，否则是主线推进的 stage */
  private fightStage(): number {
    return this.state.farmStage ?? this.state.stage
  }

  /**
   * 设置/清除「刷材料」关卡——解决卡关后无路可走的问题。
   * 卡在第 N 关打不过时，玩家可回到任意已通关关卡（1..highestStage）反复刷掉落练级；
   * 刷材料期间主线进度暂停（不推进 stage、不发首通奖励），只结算该关的材料/灵金/装备/结晶掉落。
   * 传 null 返回主线最新关卡。切换会清空当前战斗，自动出战随即按新关卡重开。
   */
  setFarmStage(n: number | null) {
    const fwd = this.delegate<void>('setFarmStage', { stage: n })
    if (fwd) return fwd
    if (n === null) {
      this.state.farmStage = null
      this.state.lastProgressAt = Date.now() // 返回主线重置僵持计时，避免立刻误报卡关
    } else {
      this.state.farmStage = Math.max(1, Math.min(Math.floor(n), this.state.highestStage))
    }
    this.state.battle = null
    this.emit()
  }

  // ── 新手引导 / 第一章剧情（数据在 game/story.ts）─────────────────────────
  //
  // 三个写方法都走 `delegate`：本作是服务端权威（SPEC §4.4），
  // 客户端的写入在下一帧就会被权威态覆盖，不转发等于玩家关掉页面进度就没了。

  /**
   * 序章翻到第 `to` 幕（1-based）。看完最后一幕传 `PROLOGUE.length + 1`。
   *
   * ⚠️ **只前进、不后退**（`v <= st.prologueAct` 直接返回）。这个字段记的是
   * "**最远看到过第几幕**"，不是"现在停在第几幕" —— 组件里点「上一幕」翻回去看，
   * 那是**组件自己的视图位置**，不该把进度退回去。否则玩家翻回第 2 幕关掉页面，
   * 下次进来又从头被拦一次。
   */
  setPrologueAct(to: number) {
    const fwd = this.delegate<void>('storyPrologue', { act: to })
    if (fwd) return fwd
    const v = Math.max(1, Math.min(PROLOGUE.length + 1, Math.floor(Number(to)) || 1))
    if (v <= this.state.story.prologueAct) return
    this.state.story.prologueAct = v
    this.save()
    this.emit()
  }

  /**
   * 报上道号 —— 跨过「入门登记」那一步。
   *
   * ⚠️ **名字不从这里写**。名字的唯一权威是账号昵称（`nickname.ts` + `POST /nickname`，
   * v1.53 刚收口），组件在提交时先走那条路，成功后再调这个方法只记一个"他登记过了"。
   * 这里要是也存一份名字，玩家在群雄榜改名之后，剧情里的称呼就会和榜上对不上。
   */
  setEnrolled() {
    const fwd = this.delegate<void>('storyEnroll', {})
    if (fwd) return fwd
    if (this.state.story.enrolled) return
    this.state.story.enrolled = true
    this.save()
    this.emit()
  }

  /** 手册看过一遍了（纯标记，不发任何东西） */
  markHandbook() {
    const fwd = this.delegate<void>('storyHandbook', {})
    if (fwd) return fwd
    if (this.state.story.handbook) return
    this.state.story.handbook = true
    this.save()
    this.emit()
  }

  /**
   * 领下一个剧情节点。
   *
   * ⚠️⚠️ **所有的前置校验都在这里**，不在 UI 上。这个引擎在服务端也跑同一份产物
   * （`dist-engine/engine.cjs`），所以写在这儿的判断就是**服务端的判断** ——
   * 光靠 UI 把按钮点灰是挡不住手改 `POST /action` 的，而剧情节点**发铜钱和结晶**，
   * 那就是一条刷资源的路子。改这个方法之前先想清楚这一点。
   *
   * 幂等：重复调用同一个 id 直接返回，不会发两次奖。
   */
  claimStoryNode(id: string) {
    const fwd = this.delegate<void>('storyNode', { id })
    if (fwd) return fwd
    const node = CHAPTER1.find(n => n.id === id)
    if (!node) return                                  // 不认识的 id：静默丢弃
    const st = this.state.story
    if (st.done.includes(id)) return                   // 幂等
    const { locked, ready } = storyNodeState(node, st)
    if (locked || !ready) return                       // 前置没走完
    st.done.push(id)
    this.state.inventory.coin = num(this.state.inventory.coin) + node.reward.coin
    if (node.reward.crystal > 0) {
      this.state.inventory.crystal = num(this.state.inventory.crystal) + node.reward.crystal
    }
    // 武魂精血 / 保底装备（v1.58，只有序章战斗那一格用得上）。
    // ⚠️ 装备是**在这里现场生成**的，不是从掉落表里抽 —— 强制引导后面有一步
    //    「第一次装备」，靠 6% 的随机掉落去凑那一步等于让玩家干等。
    //    生成走 `rollEquip`（与常规掉落同一个工厂），所以它和打怪掉的那件没有任何区别：
    //    同样的词条规则、同样能强化/洗练/分解，不是一件特制的"新手道具"。
    if (node.reward.essence) {
      this.state.inventory.essence = num(this.state.inventory.essence) + node.reward.essence
    }
    let gotEquip = ''
    if (node.reward.equip) {
      const it = rollEquip(node.reward.equip.slot, node.reward.equip.quality)
      this.state.equipBag.push(it)
      gotEquip = ` · ${it.name}`
    }
    this.setNotice(`${node.id}「${node.title}」完成 · 铜钱 +${node.reward.coin}${node.reward.crystal > 0 ? ` · 斗气结晶 +${node.reward.crystal}` : ''}${node.reward.essence ? ` · 武魂精血 +${node.reward.essence}` : ''}${gotEquip}`)
    // 解禁：走到 STORY_UNLOCK_NODE 就**永久**放开阻断式引导（单向，见 StoryState.finished）
    if (id === STORY_UNLOCK_NODE) st.finished = true
    this.save()
    this.emit()
  }

  // ── 剧情战斗（v1.55）──────────────────────────────────────────────────
  //
  // 与主线完全解耦。**这三个方法都不进 OPS 表**，理由与天梯塔的回合一致：
  // 战斗回合是**本地演的**（每 0.6 秒一回合，写一次存档要 POST 一次 /action，
  // 那既不现实也没必要），只有「领这一格的奖励」才走权威通道 —— 也就是
  // `claimStoryNode`。所以这里能刷到的上限就是"重打一场戏"，一分资源都刷不出来。
  //
  // ⚠️ 这与 `startLab` / `labBattleRound` 是**同一套取舍**，不是漏做了转发。

  /**
   * 开打某一格剧情战斗。
   *
   * ⚠️ 前置校验**必须在这里**（虽然不上服务端，但 UI 与服务端跑的是同一份产物，
   *    而 `claimStoryNode` 那一侧照样会把关：这里放进去、打赢了也领不到奖）。
   */
  startStoryBattle(nodeId: string) {
    const node = CHAPTER1.find(n => n.id === nodeId)
    // 认不出的 id / 不是战斗格 / 没有 combat 规格：静默丢弃，与 claimStoryNode 一致
    if (!node || node.kind !== 'battle' || !node.combat) return
    const st = this.state.story
    if (st.done.includes(nodeId)) return               // 已经过了，不重开
    if (node.requires.some(r => !st.done.includes(r))) return  // 前置没走完
    const fighters = this.activeFighters()
    if (fighters.length === 0) { this.setNotice('请先编排阵容'); return }
    const fighterHp: Record<string, number> = {}
    let atkSum = 0, hpSum = 0, defSum = 0, statted = 0
    for (const id of fighters) {
      const s = this.mainFighterStats(id)
      if (!s) continue
      fighterHp[id] = s.hp
      atkSum += s.atk
      hpSum += s.hp
      defSum += s.def
      statted++
    }
    // 敌人**按我方阵容重新定标**（v1.55d）。
    //
    // 不做这一步的话，`node.combat.power`（2/5/8/14，等价主线第 N 关的怪）在成型阵容面前
    // 是一刀就没的东西 —— 第一回合 `onWaveClear` 就触发，整屏从出现到消失只有 `ROUND_SEC` 两秒。
    // 用户 2026-09-22 报的「战斗过程都没有，战斗都没有动画就结束了」就是它。
    // 两个 `Math.max` 只抬高不压低，所以**新手那一侧的手感分毫未动**，理由见 data.ts。
    const enemies = enemyUnitsForStory(node.combat)
    scaleStoryEnemiesForParty(enemies, {
      atk: atkSum,
      hp: hpSum,
      defAvg: statted > 0 ? defSum / statted : 0,
      count: statted,
    })
    this.state.storyBattle = {
      nodeId,
      enemies,
      roundTimer: ROUND_SEC,
      fighterHp,
      rounds: 0,
      fighterDebuff: {},
    }
    this.emit()
  }

  /**
   * 退出剧情战斗（中途认输 / 打完点「继续剧情」）。
   *
   * 退出**不惩罚**：与主线不同，这里不记团灭、不动 `wipeStreak`、
   * 更不会因为打不过就卡住剧情 —— 剧情战斗是可以无限重来的，它只是一个关。
   */
  stopStoryBattle() {
    if (!this.state.storyBattle) return
    this.state.storyBattle = null
    this.emit()
  }

  private storyAnyAlive(b: StoryBattleState): boolean {
    return Object.values(b.fighterHp).some(hp => hp > 0)
  }

  /**
   * 一个剧情战斗回合。
   *
   * ── 为什么属性走 `mainFighterStats` 而不是另开一个 `storyFighterStats` ──
   * 羁绊算的是"谁站在这套阵容里"，与在哪条线打无关（`bondBonuses` 的注释已经说过这句）。
   * 剧情战斗用的是**同一套上阵阵容**，所以就该拿同一份数。
   * 天梯塔另开一份是因为它要叠祝福，剧情没有祝福 —— 为了"看起来对称"再加一个
   * 逐字相同的别名，只是把 v1.21.4 / v1.29 那两次"同一件事两份实现"的教训再种一遍。
   */
  private storyBattleRound() {
    const b = this.state.storyBattle
    if (!b) return
    // ⚠️ 我方全灭后**不清 state，只是不再出回合**，等玩家自己决定重来还是退出。
    //    这里一开始写成"全灭就 `storyBattle = null`"（照抄主线与塔的做法），
    //    结果是战斗层在玩家眼前**啪地消失**、人已经站在地图上了 ——
    //    看起来像界面崩了，而不是"我打输了"。剧情战斗是可以无限重来的，
    //    它没有"必须自动收场"的理由，所以把决定权留给玩家。
    //    这个 state 不进存档（见 GameState.storyBattle），刷新页面自然就散了。
    if (!this.storyAnyAlive(b)) return

    this.fightRound({
      b,
      source: 'story',
      statsOf: id => this.mainFighterStats(id),
      pierce: 0,
      dodge: 0,
      lifesteal: 0,
      // 剧情战斗没有首领概念（boss 在数据上已经和普通战斗格合并了，见 story.ts 的 NodeKind）。
      // 传 false 同时影响两件事：击杀飘字不放大、装备掉落按普通怪判定。
      isBoss: false,
      waveLabel: () => b.enemies[0]?.name ?? '剧情战斗',
      // 一波打完 = 这一格过了。**不刷下一波**（与主线/塔的关键区别），
      // 因为它就是一场戏：打赢了就该结算走人，而不是变成无限刷怪。
      onWaveClear: () => {
        this.storyOnWin(b)
        return false
      },
    })
  }

  /**
   * 剧情的战斗格打完了。
   *
   * ⚠️ **奖励一律不在这里发**，只调 `claimStoryNode(nodeId)` —— 它才是走服务端权威通道的
   *    那一个（`storyNode` op）。在这里顺手 `coin += ...` 就等于开了一条**纯客户端的刷币路**：
   *    绕过 /action 的限流与校验，改个本地变量就能刷。这条线不能松。
   */
  private storyOnWin(b: StoryBattleState) {
    this.state.storyBattle = null
    this.claimStoryNode(b.nodeId)
  }

  startBattle() {
    const fwd = this.delegate<void>('startBattle', {})
    if (fwd) return fwd
    const fighters = this.activeFighters()
    if (fighters.length === 0) { this.setNotice('请先编排阵容'); return }
    const fighterHp: Record<string, number> = {}
    for (const id of fighters) {
      const s = this.mainFighterStats(id)
      if (s) fighterHp[id] = s.hp
    }
    this.state.battle = { enemies: enemyUnitsForStage(this.fightStage()), roundTimer: ROUND_SEC, fighterHp, rounds: 0, fighterDebuff: {} }
    this.emit()
  }

  stopBattle() {
    const fwd = this.delegate<void>('stopBattle', {})
    if (fwd) return fwd
    this.state.battle = null
    this.state.autoBattle = false
    this.emit()
  }

  toggleAutoBattle() {
    const fwd = this.delegate<void>('toggleAutoBattle', {})
    if (fwd) return fwd
    this.state.autoBattle = !this.state.autoBattle
    if (this.state.autoBattle && !this.state.battle) this.startBattle()
    this.emit()
  }

  // 目标选择已抽到 pickFighters（主线与天梯塔共用），此处不再维护两份 frontAlive/backAlive
  private anyAlive(b: BattleState): boolean {
    return Object.values(b.fighterHp).some(hp => hp > 0)
  }

  /**
   * 场上是否还有「能打怪的人」——活着的、且不是治疗的角色。
   *
   * 治疗角色每轮只加血、不扣怪物血（见 battleRound / labBattleRound 的治疗分支）。
   * 所以**当活人全是治疗时，就没有任何人扣怪物血**：单治疗打到只剩自己、或双治疗互奶，
   * 怪物血量恒定不变；而治疗血厚防高（ROLE_MULT.heal: hp 1.1 / def 0.8）又能自疗，
   * 怪物那点伤害被 `Math.max(0, …)` 夹到 0~1 后打不死它 ⇒ 两边僵持，**战斗永不结束**。
   * 自动出战挂机时这就是永久卡住（玩家报的「战斗会卡住，剩最后一个人的时候」）。
   *
   * 因此治疗分支拿它当闸门：没人可打怪时不再自疗，转为自己出手。
   * 由此成立的不变量：**只要场上还有活人，本轮至少会有一次对怪物的伤害结算**
   * （非治疗角色必然走伤害分支；活人全是治疗时它们也全部走伤害分支）⇒ 战斗必然收敛。
   */
  private hasAliveAttacker(b: { fighterHp: Record<string, number> }): boolean {
    return this.activeFighters().some(id =>
      (b.fighterHp[id] ?? 0) > 0 && !this.isHealer(id))
  }

  /** 该角色是不是治疗（单体医师与群疗都算）。判据走职责而非 role 字面，新增治疗类 role 时不会漏 */
  private isHealer(id: string): boolean {
    const cdef = CHAR_MAP[id]
    return !!cdef && DUTY_OF_ROLE[cdef.role] === 'healer'
  }

  // ─ 目标选择（v1.28 策略核心）────────────────────────────────────────────
  /**
   * 我方角色的出手目标。
   *
   * **一律先打前排，没有任何例外**（v1.28.7 起）：
   * - **坦克 / 近战 / 控制**：打敌方**前排**最靠前的存活者——想碰到后排，就得先把墙拆了
   * - **单体法术（single）**：同样只打前排，但挑其中**血最少的**补刀
   * - **群攻（aoe）**：打敌方**前排全部**存活者，每目标伤害只有单体的 AOE_TARGET_RATIO 倍
   *
   * 「一律先打前排」是基本盘，**7 种定位无一例外**：敌方坦克与后排的价值全建立在这条之上——
   * 如果有一类输出能随手够到后排，摆坦克就没有意义，"布阵"也就无从谈起。
   * 群攻曾经是第一个出口（打全体），`control` 是第二个（越前排）——两扇门现在都关上了：
   * 玩家把脆皮放后排、坦克放前排，敌方就再也扫不到、偷不到后排，站位真正算数。
   *
   * ⚠️ `control` 的越前排特权已于 v1.28.7 按玩家要求取消（此前是"唯一例外"，只给我方）。
   * 代价要知道：`control` 的数值系数是 `{0.85, 0.9, 0.95}`，全面低于 `melee` 的 `{1.1, 1.0, 1.0}`，
   * 那条特权原本是它唯一的补偿。现在它的**目标选择与近战完全相同**，只剩数值更低这一条差别
   * ⇒ 5 名 control 角色（云山 / 萧战 / 云天河 / 魂天帝 / 风闲）实质上是"更弱的近战"。
   * 要么给它们数值/效果上的补偿，要么让 `control` 这个定位名有对应的实际机制，二者都还没有做。
   *
   * 连带影响：敌方后排医师（30 关起）**不再有任何手段可以提前点掉**，只能等前排被拆完。
   * 它不会造成僵持——敌方治疗量随回合衰减（见 ENEMY_HEAL_RATIO / ENEMY_HEAL_DECAY_ROUNDS），
   * 而且它**永不治疗自己**——但带医师的波次会明显变长。
   */
  private pickTargets(role: Role, enemies: EnemyUnit[]): EnemyUnit[] {
    const alive = enemies.filter(e => e.hp > 0)
    if (alive.length === 0) return []
    const front = alive.filter(e => e.position === 'front')
    const back = alive.filter(e => e.position === 'back')
    // 前排还在就只打前排，拆完墙才轮到后排——7 种定位共用这一句，没有例外
    const pool = front.length > 0 ? front : back
    if (role === 'aoe') return pool
    if (role === 'single') return [pool.reduce((a, b) => (b.hp < a.hp ? b : a))]
    return [pool[0]]
  }

  /**
   * 敌方单位的出手目标——返回**我方队员 id** 列表。
   *
   * 规则与我方 `pickTargets` **完全相同**：任何定位都先打前排，前排全灭才轮到后排。
   * 两边共用同一条规则，"布阵有意义"这句话对敌我双方都成立：我方摆前排替后排挡刀，
   * 敌方的后排同样被它的前排挡着，谁都不能绕过去。
   *
   * 敌方 `control` 的越前排特权在 v1.28.3 就已收回（那时我方还留着，是刻意的单向不对称），
   * v1.28.7 我方那份也取消了 —— 现在**不再有"哪一侧能越前排"这个问题**。
   *
   * 保留这段历史是因为它值得记：当时敌方 `control`（80+ 深度出现在后排）能直击我方后排，
   * 而"80+ 深度"在两条路径上的到达门槛完全不同 —— 主线要第 80 关，天梯塔**35 层**就到了
   * （`floorToStageDepth(35) = 80`）。同一条规则在两边表现不一致：玩家在塔里看到
   * "前排还站着、后排却在掉血"，回头打主线又一切正常，只能得出"你两边是不是写了不同的战斗"。
   * 既然现在两边都没有特权，这类"同一个规则、不同时机解锁"造成的观感差也就无从产生了。
   */
  private pickFighters(role: Role, b: { fighterHp: Record<string, number> }): string[] {
    const row = (r: 'front' | 'back') =>
      this.state.team[r].filter((id): id is string => !!id && (b.fighterHp[id] ?? 0) > 0)
    const front = row('front')
    const back = row('back')
    // 前排还在就只打前排 —— 与我方 pickTargets 是同一句话，两边都不许越位
    const pool = front.length > 0 ? front : back
    if (role === 'aoe') return pool
    if (role === 'single') {
      const t = pool.reduce((a, c) => ((b.fighterHp[c] ?? 0) < (b.fighterHp[a] ?? 0) ? c : a))
      return [t]
    }
    const t = pool[0]
    return t ? [t] : []
  }

  /**
   * 治疗目标（我方）。
   * - `heal`（单体医师）→ 血**百分比**最低的那个。按百分比而非绝对值：坦克血厚，
   *   按绝对值算的话医师会永远在奶坦克，后排脆皮被切死时一口奶都吃不到。
   * - `heal_aoe`（群疗）→ 全体存活队员，但每人只回单体治疗量的一半左右（见 HEAL_AOE_RATIO）。
   */
  private pickHealTargets(
    role: Role,
    b: { fighterHp: Record<string, number> },
    statsOf: (id: string) => FighterStats | null,
  ): string[] {
    const alive = this.activeFighters().filter(id => (b.fighterHp[id] ?? 0) > 0)
    if (alive.length === 0) return []
    if (role === 'heal_aoe') return alive
    let lowestId: string | null = null
    let lowestPct = Infinity
    for (const id of alive) {
      const s = statsOf(id)
      if (!s || s.hp <= 0) continue
      const pct = (b.fighterHp[id] ?? 0) / s.hp
      if (pct < lowestPct) { lowestPct = pct; lowestId = id }
    }
    return lowestId ? [lowestId] : []
  }

  /**
   * 一个战斗回合——主线与天梯塔**共用**（v1.28 抽出）。
   *
   * 抽出前这两处是逐字重复的两份代码：治疗分支、伤害结算、怪物反击、团灭判定各写一遍，
   * 每次改动都得记着改两处（v1.25.2 修「战斗卡住」时就是这么小心翼翼过来的）。
   * 多单位战斗把复杂度推高了一档，再复制一份必然发散，所以在此统一。
   *
   * 出手顺序：我方全员依次出手 → 敌方全体依次反击。演出上每个事件按 SEQ_MS 错开，
   * UI 只播放 time 已到的事件，于是形成"依次出手"而非全员同帧。
   *
   * **压制（`control` 的攻/防双减益，v1.28.7）**在这里统一进出：出手时对命中的敌方目标施加/刷新，
   * 结算时把双方身上的压制折进攻防（见 CONTROL_DEBUFF），回合末递减。不在
   * `mainFighterStats`/`labFighterStats` 里做，是因为那两个函数拿不到当前这波的 `b`。
   */
  private fightRound(cfg: FightRoundCfg): void {
    const { b, source, onWaveClear } = cfg
    const t0 = Date.now()
    let seq = 0
    const at = () => t0 + seq * SEQ_MS

    // 受压制的队员：攻/防按百分点下调。**折在这里而不是改 statsOf 的返回值**——
    // 那两个函数每次调用都新建对象且被 UI 复用，改返回值会污染战斗外的显示。
    const statsOf = (id: string): FighterStats | null => {
      const s = cfg.statsOf(id)
      if (!s) return null
      const d = b.fighterDebuff?.[id]
      if (!d) return s
      return { ...s, atk: s.atk * (1 - d.atkPct / 100), def: s.def * (1 - d.defPct / 100) }
    }
    // 受压制的敌人：只有攻击要下调（防御在下面伤害公式里就地折算）
    const enemyAtk = (e: EnemyUnit) => e.atk * (1 - (e.debuff?.atkPct ?? 0) / 100)

    // ── 我方行动 ──
    for (const id of this.activeFighters()) {
      if ((b.fighterHp[id] ?? 0) <= 0) continue
      const cdef = CHAR_MAP[id]
      const stats = statsOf(id)
      if (!cdef || !stats) continue
      const role = cdef.role

      // 治疗：单体医师奶血线最低的，群疗奶全场。
      // 闸门（v1.25.2）：只有场上还有「能打怪的人」时才值得加血——活人全是治疗时若继续自疗，
      // 就没人扣敌人血了 ⇒ 死循环。此时不 continue，落下去按普通出手打敌人。
      if (this.isHealer(id) && this.hasAliveAttacker(b)) {
        const targets = this.pickHealTargets(role, b, statsOf)
        if (targets.length > 0) {
          const per = Math.round(stats.atk * (role === 'heal_aoe' ? HEAL_AOE_RATIO : HEAL_RATIO))
          const tHeal = at()
          for (const tid of targets) {
            const fs = statsOf(tid)
            if (!fs) continue
            b.fighterHp[tid] = Math.min(fs.hp, (b.fighterHp[tid] ?? 0) + per)
            this.state.combatEvents.push({ type: 'heal', value: per, who: tid, time: tHeal, source })
          }
          // 群疗的多条事件共用同一个时间戳（同帧飘字才是"回了一片"的观感），只占一个出手位
          seq++
          continue
        }
      }

      const targets = this.pickTargets(role, b.enemies)
      if (targets.length === 0) continue
      // 群攻对每个目标的伤害要打折："群攻肯定比单体低"（见 AOE_TARGET_RATIO）
      const perTarget = role === 'aoe' ? AOE_TARGET_RATIO : 1
      const tHit = at()
      for (const e of targets) {
        // 被压制的敌人防御按百分点下调（"破防"）——注意防御本来就只吃六折且数值远小于攻击，
        // 这一项对伤害的贡献很小，真正有分量的是它自己打过来时的 atk 下调（见 CONTROL_DEBUFF）
        const pierceDef = e.def * (1 - (e.debuff?.defPct ?? 0) / 100) * 0.6 * (1 - cfg.pierce)
        let dmg = Math.max(1, Math.round((stats.atk * perTarget - pierceDef) * (0.85 + Math.random() * 0.3)))
        const crit = Math.random() * 100 < stats.critRate
        if (crit) dmg = Math.round(dmg * (1 + stats.critDmg / 100))
        if (cfg.lifesteal > 0) {
          b.fighterHp[id] = Math.min(stats.hp, (b.fighterHp[id] ?? 0) + Math.round(dmg * cfg.lifesteal / 100))
        }
        e.hp -= dmg
        this.state.combatEvents.push({ type: 'dmg', value: dmg, who: id, target: e.uid, time: tHit, source, crit })
        // 控制减益：**活着才挂得上**（打死了就没有"压制"可言），而且每次命中都刷新时长，
        // 于是"control 一直咬住同一个目标"= 压制不断档，这正是不给它更高数值的交换条件
        if (role === 'control' && e.hp > 0) applyControlDebuff(e)
      }
      seq++

      // 逐角色结算：出手即刻判定，一波敌人清空则后续角色不再出手
      if (b.enemies.every(e => e.hp <= 0)) {
        this.state.combatEvents.push({ type: 'kill', value: 0, who: cfg.waveLabel(), time: at(), source, boss: cfg.isBoss })
        // 这个出口也要递减（原因见 tickDebuffs）—— 先扣再清波，免得带着半截压制进下一波
        this.tickDebuffs(b)
        if (!onWaveClear()) return
        return
      }
    }

    // ── 敌方反击：每个存活敌人各出手一次 ──
    if (cfg.dodge > 0 && Math.random() * 100 < cfg.dodge) return

    const rounds = b.rounds ?? 0
    const enemyCount = b.enemies.length
    for (const e of b.enemies) {
      if (e.hp <= 0) continue

      // 敌方医师先救人、不参与输出。**只治队友、绝不治自己**——这是防僵持的硬约束：
      // 只要我方集火它，它必然倒下，"两个医师互相刷血"这种死循环根本构造不出来。
      // 治疗量还随本波回合数衰减，久战不下就自己力竭（见 ENEMY_HEAL_RATIO）。
      if (DUTY_OF_ROLE[e.role] === 'healer') {
        const wounded = b.enemies
          .filter(o => o.hp > 0 && o.uid !== e.uid && o.hp < o.maxHp)
          .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0]
        if (wounded) {
          // 敌方医师被压制时**连治疗量一起掉**（它和输出同源于 atk）
          const heal = Math.round((enemyAtk(e) * ENEMY_HEAL_RATIO) / (1 + rounds / ENEMY_HEAL_DECAY_ROUNDS))
          wounded.hp = Math.min(wounded.maxHp, wounded.hp + heal)
          this.state.combatEvents.push({ type: 'heal', value: heal, who: e.uid, target: wounded.uid, time: t0 + seq * SEQ_MS + 120, source })
          seq++
          continue
        }
      }

      const targets = this.pickFighters(e.role, b)
      const perTarget = e.role === 'aoe' ? AOE_TARGET_RATIO : 1
      for (const tid of targets) {
        const stats = statsOf(tid)
        if (!stats) continue
        // 防御减伤按**敌人数**摊薄：多打一时，高防御只能挡住其中一个（见 data.ts 的 ENEMY_SCALE 注释）。
        // 不摊薄的话高防坦克在多敌人关卡会直接免疫伤害，人越多反而越安全，与"人多更难"完全相反。
        const defEff = stats.def / enemyCount
        const mdmg = Math.max(0, Math.round((enemyAtk(e) * perTarget - defEff) * (0.85 + Math.random() * 0.3)))
        b.fighterHp[tid] = Math.max(0, (b.fighterHp[tid] ?? 0) - mdmg)
        const tCounter = t0 + seq * SEQ_MS + 120
        this.state.combatEvents.push({ type: 'monsterDmg', value: mdmg, who: tid, from: e.uid, time: tCounter, source, atkStyle: e.atkStyle })
        if (b.fighterHp[tid] <= 0) {
          this.state.combatEvents.push({ type: 'down', value: 0, who: tid, time: tCounter + 200, source })
        } else if (e.role === 'control') {
          // 敌方控制减益同样只挂活人。我方队员在清波时**不重建**，所以得存在 map 里自己递减
          const fd = (b.fighterDebuff ??= {})
          const slot = { debuff: fd[tid] }
          applyControlDebuff(slot)
          fd[tid] = slot.debuff!
        }
        seq++
      }
    }
    // 本波回合数 +1：敌方治疗量按它衰减（清波时由 onWaveClear 重置为 0）
    b.rounds = rounds + 1
    this.tickDebuffs(b)
  }

  /**
   * 回合末递减双方身上的压制、清掉过期的。
   *
   * ⚠️ **两个出口都要调**（正常走完 + 我方清空一波提前 return）。只挂在末尾的话，
   * "每波都是一回合秒掉"的队伍身上那层压制永远不会到期——它们总是在回合末之前就 return 了。
   * 闪避那条 return 不在此列：那一整轮根本没开打（`b.rounds` 也没 +1），不算一个回合。
   */
  private tickDebuffs(b: FightRoundCfg['b']): void {
    for (const e of b.enemies) {
      if (e.debuff && --e.debuff.left <= 0) e.debuff = undefined
    }
    for (const [id, d] of Object.entries(b.fighterDebuff ?? {})) {
      if (--d.left <= 0) delete b.fighterDebuff![id]
    }
  }

  /**
   * **战斗口径**属性：主线战斗真正用的那一份 = charStats × 阵营羁绊 × 商城限时增益。
   *
   * 界面要回答"这个角色上阵后有多少属性"时必须走这里。`statsOf` 是**裸属性**（不含羁绊）——
   * v1.28 加阵营羁绊时只改了战斗口径，界面仍显示裸属性，羁绊面板又只写一行"全体攻击 +24%"，
   * 于是玩家点开角色发现凑齐 6 个云岚宗数字纹丝不动，报成「阵容组合加成没有实际生效」。
   * 加成其实一直在算（同一角色伤害 335 → 417），坏的是口径：显示 615 / 战斗 763，中间那份从没露过面。
   * 这与真·数值 bug 的表现**一模一样**，所以唯一的解法是让显示与战斗同源，而不是各算各的。
   *
   * starsOverride 与 statsOf 同义：只给升星预览试算，不动存档。
   */
  battleStatsOf(charId: string, starsOverride?: number): FighterStats | null {
    const entry = this.state.roster[charId]
    const cdef = CHAR_MAP[charId]
    if (!entry || !cdef) return null
    const e = starsOverride === undefined ? entry : { ...entry, stars: starsOverride }
    const s = charStats(e, cdef, this.fireIdOf(charId))
    // 羁绊只给上阵角色：没上阵的人本来就不在羁绊统计里，给他套一份"全队加成"
    // 等于凭空造出一个它永远拿不到的数。商城增益是账号级的，上没上阵都照吃。
    const bo = this.activeFighters().includes(charId) ? this.bondBonuses() : bondBonusesFor([])
    return {
      atk: Math.round(s.atk * (1 + bo.atkPct / 100) * this.buffMult('atk')),
      def: Math.round(s.def * (1 + bo.defPct / 100) * this.buffMult('def')),
      hp: Math.round(s.hp * (1 + bo.hpPct / 100)),
      critRate: s.critRate + bo.crit,
      critDmg: s.critDmg,
    }
  }

  /** 主线战斗属性（天梯塔那份见 labFighterStats，两条线都归一到 FighterStats） */
  private mainFighterStats(id: string): FighterStats | null {
    return this.battleStatsOf(id)
  }

  /**
   * 该角色一次出手打出的**效果数值**（v1.31）。
   *
   * 存在的理由与 battleStatsOf 一样：玩家要评估一个角色，光看攻防血是不够的 ——
   * 医师真正的价值是"每次回多少血"、群攻的实际强度是"每个目标挨多少"、
   * control 的价值是"压制掉对方多少攻防"。这些数引擎一直在算，只是从没露过面。
   *
   * ⚠️ 界面**绝不能自己乘系数**：1.5 / 0.75 / 0.55 是 fightRound 里那几个常量的复述，
   * 界面各写一遍就等于把"同一件事两份实现"又种回去（v1.21.4、v1.29 两次同源教训）。
   */
  combatEffectOf(charId: string): CombatEffect | null {
    const cdef = CHAR_MAP[charId]
    const s = this.battleStatsOf(charId)
    if (!cdef || !s) return null
    return effectFor(s.atk, cdef.role)
  }

  /**
   * 当前上阵阵容激活的阵营羁绊。主线与天梯塔**共用同一套统计**——
   * 羁绊算的是"谁站在这套阵容里"，与在哪条线打无关，两条线各算一份迟早会对不上。
   *
   * 每次调用都重算（6 个 id × 10 个阵营的计数，开销可忽略），不做缓存：
   * 缓存要为"换阵容/换角色"预留失效点，而漏失效会造出比这点开销大得多的 bug。
   */
  bondBonuses(): BondBonuses {
    return bondBonusesFor([...this.state.team.front, ...this.state.team.back])
  }

  private battleRound() {
    const b = this.state.battle
    if (!b) return
    const stage = this.fightStage()

    this.fightRound({
      b,
      source: 'main',
      statsOf: id => this.mainFighterStats(id),
      pierce: 0,
      dodge: 0,
      lifesteal: 0,
      isBoss: isBossStage(stage),
      waveLabel: () => monsterForStage(this.fightStage()).name,
      onWaveClear: () => {
        this.onKill()
        // onKill 里可能结束整场战斗（例如触发停战），此时不能再刷新敌人
        if (this.state.battle !== b) return false
        b.enemies = enemyUnitsForStage(this.fightStage())
        b.rounds = 0
        return true
      },
    })

    // 战斗若已在清波/结算流程里结束，就不必再判团灭（此时 b 已脱离 state）
    if (this.state.battle !== b) return
    if (!this.anyAlive(b)) {
      if (this.state.farmStage === null) {
        if (this.state.wipeStage === stage) this.state.wipeStreak += 1
        else { this.state.wipeStage = stage; this.state.wipeStreak = 1 }
        this.setNotice(`全队阵亡，撤退疗伤中…（第 ${stage} 关已连续 ${this.state.wipeStreak} 次）`)
      } else {
        this.setNotice(`在第 ${stage} 关战败，换一个低一点的关卡再试`)
      }
      this.state.battle = null
    }
  }

  /** 装备掉落：命中就在 4 个槽位里随机一个、按权重随机品阶，首领用更高的掉落率 */
  private tryDropEquip(boss: boolean) {
    const chance = boss ? EQUIP_DROP_CHANCE_BOSS : EQUIP_DROP_CHANCE
    if (Math.random() > chance) return
    const slot = EQUIP_SLOTS[Math.floor(Math.random() * EQUIP_SLOTS.length)]
    const quality = rollEquipQuality()
    const item = rollEquip(slot, quality)
    this.state.equipBag.push(item)
    this.setNotice(`获得装备：${item.name}`)
  }

  private onKill() {
    this.state.kills++
    const farming = this.state.farmStage !== null
    const stage = this.fightStage()
    const zone = zoneForStage(stage)
    const boss = isBossStage(stage)
    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + stageStats(stage).hp / 20
    this.state.inventory.coin = (this.state.inventory.coin ?? 0) + Math.floor(stageCoinReward(stage) * (boss ? 1.5 : 1))
    this.tryDropEquip(boss)
    for (const d of zone.drops) {
      if (d.item === 'coin') continue // 铜钱走关卡奖励，不再吃地图表里的固定区间
      if (Math.random() > d.chance) continue
      const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1))
      this.state.inventory[d.item] = (this.state.inventory[d.item] ?? 0) + n
      this.state.combatEvents.push({ type: 'drop', value: n, item: d.item, time: Date.now(), source: 'main' })
    }
    // 刷材料模式：只结算上面的掉落，不推进主线、不发首通奖励（首通奖励仅主线推进时给一次）
    if (farming) return
    // 首通奖励：缘分丹 + 异火里程碑
    // 缘分丹原先只有初始 5 颗、零产出来源，抽卡开局即死，54 名角色里绝大多数终身不可得
    const isFirstClear = stage >= this.state.highestStage
    if (isFirstClear) {
      if (boss) {
        const n = 1 + (stage % 25 === 0 ? 2 : 0) // 每 5 关首领给 1 颗，每 25 关多给 2 颗
        this.state.inventory.yuanfen = (this.state.inventory.yuanfen ?? 0) + n
        this.state.combatEvents.push({ type: 'drop', value: n, item: 'yuanfen', time: Date.now(), source: 'main' })
      }
      for (const f of FIRES) {
        if (f.stageReq === stage && !this.ownsFire(f.id)) {
          this.state.inventory[`fire_${f.id}`] = 1
          this.setNotice(`首通第 ${stage} 关！获得异火「${f.name}」`)
        }
      }
    }
    if (boss && !isFirstClear) {
      this.setNotice(`击破第 ${stage} 关首领！`)
    }
    this.state.stage += 1
    this.state.highestStage = Math.max(this.state.highestStage, this.state.stage)
    // 活动中心：**推进的关卡数**（刷材料模式上面已经 return，反复刷同一关不会灌水）
    this.bumpMetric('stage.win', 1)
    this.state.wipeStage = null
    this.state.wipeStreak = 0
    this.state.lastProgressAt = Date.now()
  }

  // ── 天梯塔：roguelike 爬塔，祝福仅本次爬塔生效，战败/撤退清空重来 ──────────────
  blessingTotals() {
    const t = { atkPct: 0, defPct: 0, hpPct: 0, lifesteal: 0, pierce: 0, dodge: 0, coinPct: 0, daolingPct: 0, crystalPct: 0 }
    for (const id of this.state.lab.blessings) {
      const b = LAB_BLESSINGS.find(x => x.id === id)
      if (!b) continue
      t.atkPct += b.atkPct ?? 0
      t.defPct += b.defPct ?? 0
      t.hpPct += b.hpPct ?? 0
      t.lifesteal += b.lifesteal ?? 0
      t.pierce += b.pierce ?? 0
      t.dodge += b.dodge ?? 0
      t.coinPct += b.coinPct ?? 0
      t.daolingPct += b.daolingPct ?? 0
      t.crystalPct += b.crystalPct ?? 0
    }
    return t
  }

  private labFighterStats(id: string) {
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return null
    const base = charStats(entry, cdef, this.fireIdOf(id))
    const bt = this.blessingTotals()
    const bo = this.bondBonuses()
    return {
      atk: Math.round(base.atk * (1 + bt.atkPct / 100) * (1 + bo.atkPct / 100) * this.buffMult('atk')),
      def: Math.round(base.def * (1 + bt.defPct / 100) * (1 + bo.defPct / 100) * this.buffMult('def')),
      hp: Math.round(base.hp * (1 + bt.hpPct / 100) * (1 + bo.hpPct / 100)),
      critRate: base.critRate + bo.crit,
      critDmg: base.critDmg,
    }
  }

  startLab() {
    const fwd = this.delegate<void>('startLab', {})
    if (fwd) return fwd
    const fighters = this.activeFighters()
    if (fighters.length === 0) { this.setNotice('请先编排阵容'); return }
    this.state.lab.blessings = []
    this.state.lab.offer = null
    const fighterHp: Record<string, number> = {}
    for (const id of fighters) {
      const s = this.labFighterStats(id)
      if (s) fighterHp[id] = s.hp
    }
    this.state.lab.battle = { floor: 1, enemies: enemyUnitsForFloor(1), roundTimer: ROUND_SEC, fighterHp, rounds: 0, fighterDebuff: {} }
    this.emit()
  }

  retreatLab() {
    const fwd = this.delegate<void>('retreatLab', {})
    if (fwd) return fwd
    this.state.lab.battle = null
    this.state.lab.autoLab = false
    this.state.lab.blessings = []
    this.state.lab.offer = null
    this.emit()
  }

  toggleAutoLab() {
    const fwd = this.delegate<void>('toggleAutoLab', {})
    if (fwd) return fwd
    this.state.lab.autoLab = !this.state.lab.autoLab
    if (this.state.lab.autoLab && !this.state.lab.battle) this.startLab()
    this.emit()
  }

  private labAnyAlive(b: LabBattleState): boolean {
    return Object.values(b.fighterHp).some(hp => hp > 0)
  }

  private labBattleRound() {
    const b = this.state.lab.battle
    if (!b) return
    const boss = isLabBoss(b.floor)
    const bt = this.blessingTotals()

    this.fightRound({
      b,
      source: 'lab',
      statsOf: id => this.labFighterStats(id),
      pierce: Math.min(0.9, bt.pierce / 100),
      dodge: bt.dodge,
      lifesteal: bt.lifesteal,
      isBoss: boss,
      waveLabel: () => `第${b.floor}层`,
      onWaveClear: () => {
        this.labOnKill(b, boss)
        // labOnKill 里可能结束整场爬塔（例如领满三选一后撤退），此时不能再刷新下一层
        if (this.state.lab.battle !== b) return false
        b.floor += 1
        b.enemies = enemyUnitsForFloor(b.floor)
        b.rounds = 0
        return true
      },
    })

    if (this.state.lab.battle !== b) return
    if (!this.labAnyAlive(b)) {
      this.setNotice(`爬塔失败于第 ${b.floor} 层，祝福清空，重新出发`)
      this.state.lab.battle = null
      this.state.lab.blessings = []
    }
  }

  private labOnKill(b: LabBattleState, boss: boolean) {
    this.state.kills++
    // 活动中心：**每一层都算**，不限首通 —— 天梯塔每轮都从第 1 层重来，
    // 只在首通时计数的话，"今日通关 3 层"在推不动高层之后永远做不完（做成了死活动）。
    this.bumpMetric('lab.win', 1)
    const bt = this.blessingTotals()
    this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + (labStats(b.floor).hp / 25) * (1 + bt.crystalPct / 100)
    this.state.inventory.coin = (this.state.inventory.coin ?? 0) + Math.floor(10 * (1 + bt.coinPct / 100))
    // 灵药：**常驻掉落，每层都给**（不是首通限定），量随层数线性增长 ——
    // 定标与"为什么不做首领加成"见 data.ts 的 labHerbReward。1~2 层取整后为 0，天然是软门槛。
    const herb = labHerbReward(b.floor)
    if (herb > 0) {
      this.state.inventory.herb = (this.state.inventory.herb ?? 0) + herb
      // ⚠️ 故意**不带 `first`** —— 界面据此区分「获得」与「首通奖励」。带上它，
      //    每一层都会显示"首通奖励 灵药"，而玩家根本没有首通。
      this.state.combatEvents.push({ type: 'drop', value: herb, item: 'herb', time: Date.now(), source: 'lab' })
    }
    this.tryDropEquip(boss)

    const isFirstClear = b.floor > this.state.lab.highestFloor
    if (isFirstClear) {
      this.state.lab.highestFloor = b.floor
      const daoling = Math.floor(labDaolingReward(b.floor) * (1 + bt.daolingPct / 100))
      this.state.inventory.daoling = (this.state.inventory.daoling ?? 0) + daoling
      this.state.combatEvents.push({ type: 'drop', value: daoling, item: 'daoling', time: Date.now(), source: 'lab', first: true })
      // 每 5 层首通给 1 颗缘分丹：与主线并列的抽卡货币来源
      if (isLabBoss(b.floor)) {
        this.state.inventory.yuanfen = (this.state.inventory.yuanfen ?? 0) + 1
        this.state.combatEvents.push({ type: 'drop', value: 1, item: 'yuanfen', time: Date.now(), source: 'lab', first: true })
      }
      for (const f of FIRES) {
        if (f.floorReq === b.floor && !this.ownsFire(f.id)) {
          this.state.inventory[`fire_${f.id}`] = 1
          this.setNotice(`首通 ${b.floor} 层！获得异火「${f.name}」`)
        }
      }
    }

    if (boss) {
      const owned = new Set(this.state.lab.blessings)
      const offer = LAB_BLESSINGS.filter(x => !owned.has(x.id)).map(x => x.id)
      for (let i = offer.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[offer[i], offer[j]] = [offer[j], offer[i]]
      }
      if (offer.length > 0) {
        this.state.lab.offer = offer.slice(0, 3)
        this.state.lab.offerAt = Date.now()
        this.setNotice(`第 ${b.floor} 层告破，三选一祝福降临！`)
      }
    }
  }

  chooseBlessing(id: string) {
    const fwd = this.delegate<void>('chooseBlessing', { id })
    if (fwd) return fwd
    if (!this.state.lab.offer?.includes(id)) return
    this.state.lab.blessings.push(id)
    this.state.lab.offer = null
    this.state.lab.offerAt = 0
    this.emit()
  }

  /** 祝福超时自动选择：从待选项里随机取一个，清空 offer 让爬塔继续 */
  private autoResolveOffer() {
    const offer = this.state.lab.offer
    this.state.lab.offer = null
    this.state.lab.offerAt = 0
    if (!offer || offer.length === 0) return
    const pick = offer[Math.floor(Math.random() * offer.length)]
    this.state.lab.blessings.push(pick)
    const def = LAB_BLESSINGS.find(b => b.id === pick)
    this.setNotice(`⏳ 祝福选择超时，自动选了「${def?.name ?? pick}」`)
  }

  /**
   * 论道令商店兑换。
   *
   * 价目一律读 data.ts 的 labPillCost / LAB_ESSENCE_COST / LAB_HERB_COST —— 界面显示的是同一处，
   * 两边不可能漂。品阶合法性也从 PILLS 表查，而不是拿裸数字拼 `pill${grade}` 当键
   * （拼错会往库存里写一个谁也不认识的 `pill9`，看着扣了令却没东西到手）。
   *
   * 论道令不足时**直接返回、不扣令也不发货**（负对照由 verify-lab-pill-shop 守着）。
   */
  buyLabShop(item: 'pill' | 'essence' | 'herb', grade?: number) {
    const fwd = this.delegate<void>('buyLabShop', { item, grade })
    if (fwd) return fwd
    const inv = this.state.inventory
    if (item === 'pill') {
      const pill = PILLS.find(p => p.grade === grade)
      if (!pill) return
      const cost = labPillCost(pill.grade)
      if ((inv.daoling ?? 0) < cost) { this.setNotice('论道令不足'); return }
      inv.daoling -= cost
      inv[pill.id] = (inv[pill.id] ?? 0) + 1
      this.setNotice(`兑换 ${pill.name} ×1`)
    } else if (item === 'essence') {
      if ((inv.daoling ?? 0) < LAB_ESSENCE_COST) { this.setNotice('论道令不足'); return }
      inv.daoling -= LAB_ESSENCE_COST
      inv.essence = (inv.essence ?? 0) + LAB_ESSENCE_AMOUNT
      this.setNotice(`兑换武魂精血 ×${LAB_ESSENCE_AMOUNT}`)
    } else if (item === 'herb') {
      // 灵药这一档的价目有一条硬约束（1 令 ≤ ≈7.5 灵药，否则丹药直购会被架空）——
      // 完整推导写在 data.ts 的 LAB_HERB_COST 上，改价去那里改。
      if ((inv.daoling ?? 0) < LAB_HERB_COST) { this.setNotice('论道令不足'); return }
      inv.daoling -= LAB_HERB_COST
      inv.herb = (inv.herb ?? 0) + LAB_HERB_AMOUNT
      this.setNotice(`兑换灵药 ×${LAB_HERB_AMOUNT}`)
    }
    this.emit()
  }

  // ── 招募抽卡 ───────────────────────────────────────────────────────────
  /**
   * 抽一档稀有度：三层保底 + 自然概率。
   *
   * 三层计数每次抽取各 +1，**抽到「该层或更高」就重置该层**（标准保底心智模型）：
   *   天阶保底 PITY_TIAN(10) / 准圣保底 PITY_QUASI(30) / 圣阶保底 PITY_SHENG(60)
   * 优先判最高层，所以三层同时到位时按圣阶结算。
   *
   * 为什么是这三个数：缘分丹是抽卡唯一货币，玩家终身只有 40~70 抽（推导见 data.ts 的常量注释），
   * 保底抽数大于终身抽数就等于没做——这正是原先「90 抽必出天阶+」的问题，全服无人触发过。
   *
   * 这里同时是**终身累计计数**（`pullCount` / `shengCount`，手气榜用）的唯一写入点。
   * 刻意放在本函数内、而不是 `recruit()` 的循环里：这样「出了圣阶」与「圣阶保底归零」
   * 在代码上就是同一件事，两个数不可能对不上（对不上 = 榜上的平均值自相矛盾）。
   */
  private rollRarity(): { rarity: Rarity; pity: boolean } {
    this.state.pityTian++
    this.state.pityQuasi++
    this.state.pitySheng++
    this.state.pullCount++

    let rarity: Rarity
    let pity = true
    if (this.state.pitySheng >= PITY_SHENG) {
      rarity = 'sheng'
    } else if (this.state.pityQuasi >= PITY_QUASI) {
      rarity = 'quasi'
    } else if (this.state.pityTian >= PITY_TIAN) {
      rarity = Math.random() < PITY_TIAN_UPGRADE ? 'quasi' : 'tian'
    } else {
      const r = Math.random()
      rarity = r < 0.005 ? 'sheng' : r < 0.03 ? 'quasi' : r < 0.12 ? 'tian' : r < 0.30 ? 'di' : r < 0.60 ? 'xuan' : 'yellow'
      pity = false
    }

    // 抽到哪一档就重置「该档及以下」的计数：出圣阶等于三层全清，出准圣清掉准圣与天阶。
    // 注意不能反过来「出了好东西就把计数清零」——那我们等于白送，保底会泛滥。
    const order = RARITY_INFO[rarity].order
    if (order >= RARITY_INFO.sheng.order) {
      this.state.pitySheng = 0
      this.state.shengCount++ // 与上一行同生共死：手气榜的「出过几张圣阶」就定义在这里
    }
    if (order >= RARITY_INFO.quasi.order) this.state.pityQuasi = 0
    if (order >= RARITY_INFO.tian.order) this.state.pityTian = 0
    return { rarity, pity }
  }

  /** 保底进度：招募页要能看见「还有几抽必出」。看不见的保底 = 玩家只记得自己又空手了 */
  pityState() {
    return {
      tian: { cur: this.state.pityTian, max: PITY_TIAN },
      quasi: { cur: this.state.pityQuasi, max: PITY_QUASI },
      sheng: { cur: this.state.pitySheng, max: PITY_SHENG },
    }
  }

  /**
   * 抽卡。抽到**重复**的角色时按品阶给补偿（v1.25）：
   * - 准圣 / 圣阶 → 转「角色碎片」（攒得住，有确定出口：兑换未拥有的角色）
   * - 黄 / 玄 / 地 / 天 → 仍退武魂精血，与 v1.24.2 及之前一致
   *
   * 分界不是随手划的：低阶重复量压倒性（终身 75 抽里黄+玄重复 40 次，准圣+圣不到 1 次），
   * 低阶也给碎片等于让碎片随抽数线性泛滥。见 data.ts 的 DUPE_SHARD 注释。
   */
  recruit(times: 1 | 10) {
    const fwd = this.delegate<{ id: string; isNew: boolean; rarity: Rarity; pity: boolean; shard: number; essence: number }[]>('recruit', { times })
    if (fwd) return fwd
    const cost = times
    if ((this.state.inventory.yuanfen ?? 0) < cost) { this.setNotice('缘分丹不足'); return [] }
    this.state.inventory.yuanfen -= cost
    const results: { id: string; isNew: boolean; rarity: Rarity; pity: boolean; shard: number; essence: number }[] = []
    for (let i = 0; i < times; i++) {
      const { rarity, pity } = this.rollRarity()
      // 池子走 data.recruitPoolOf：限时联动角色只在活动期内进池（见那里的注释）
      const pool = recruitPoolOf(rarity)
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (!pick) continue
      const isNew = !this.state.roster[pick.id]
      let shard = 0, essence = 0
      if (isNew) {
        this.state.roster[pick.id] = { level: 1, xp: 0, stars: 0, equip: {} }
      } else {
        const frag = DUPE_SHARD[rarity]
        if (frag) {
          shard = frag
          this.state.inventory.shard = (this.state.inventory.shard ?? 0) + shard
        } else {
          essence = ESSENCE_BY_RARITY[rarity]
          this.state.inventory.essence = (this.state.inventory.essence ?? 0) + essence
        }
      }
      results.push({ id: pick.id, isNew, rarity, pity, shard, essence })
    }
    if (results.length > 0) {
      const order = RARITY_INFO
      const best = results.reduce((a, b) => order[b.rarity].order > order[a.rarity].order ? b : a)
      playSound(order[best.rarity].order >= 4 ? 'gachaHigh' : order[best.rarity].order >= 2 ? 'gachaMid' : 'gachaLow')
    }
    // 活动中心：十连记 10 次（"招募次数"就是花掉的缘分丹数，与消耗口径一致）
    this.bumpMetric('recruit', times)
    this.emit()
    return results
  }

  /**
   * 卖出/放生角色：**角色本身的精血**（价格同重复抽到时的转换表）+ **70% 的养成投入**
   * （灵晶 / 突破丹药 / 升星的精血与玄晶）。
   *
   * 投入是从 level/xp/stars 反推的（见 data.charInvestment），不需要在存档里记账，
   * 所以老存档放生照样拿得到完整返还。留 30% 是刻意的：换阵容可以有成本，但不该像
   * 原来那样"练过的角色一放生，练度全打水漂"——玩家于是不敢练新抽到的角色。
   *
   * 上阵中的角色不能卖，防止手滑把正在用的队友卖掉；身上装备原样退回背包。
   */
  releaseChar(id: string) {
    const fwd = this.delegate<void>('releaseChar', { charId: id })
    if (fwd) return fwd
    const cdef = CHAR_MAP[id]
    const entry = this.state.roster[id]
    if (!cdef || !entry) return
    if ([...this.state.team.front, ...this.state.team.back].includes(id)) {
      this.setNotice('上阵中的武魂不能卖出，先把TA换下来')
      return
    }
    const r = this.releaseRefundOf(id)
    if (!r) return
    for (const item of Object.values(entry.equip)) this.state.equipBag.push(item)
    delete this.state.roster[id]

    const inv = this.state.inventory
    inv.essence = (inv.essence ?? 0) + r.essence
    if (r.xuanjing > 0) inv.xuanjing = (inv.xuanjing ?? 0) + r.xuanjing
    if (r.crystal > 0) inv.crystal = (inv.crystal ?? 0) + r.crystal
    for (const [pid, n] of Object.entries(r.pills)) if (n > 0) inv[pid] = (inv[pid] ?? 0) + n

    const parts = [`${r.essence} ${itemLabel('essence').name}`]
    if (r.xuanjing > 0) parts.push(`${r.xuanjing} ${itemLabel('xuanjing').name}`)
    if (r.crystal > 0) parts.push(`${r.crystal} ${itemLabel('crystal').name}`)
    for (const [pid, n] of Object.entries(r.pills)) if (n > 0) parts.push(`${n} ${itemLabel(pid).name}`)
    this.setNotice(`放生了 ${cdef.name}，返还 ${parts.join(' · ')}`)
    this.emit()
  }

  /**
   * 放生返还明细。**UI 预览与 releaseChar 必须都调这一个方法**——两处各算一遍迟早会分叉
   * （同一件事有两份实现，本项目已经栽过三次：战力取整口径、装备词条比较、属性面板）。
   */
  releaseRefundOf(id: string) {
    const cdef = CHAR_MAP[id]
    const entry = this.state.roster[id]
    if (!cdef || !entry) return null
    const invested = charInvestment(entry.level, entry.xp, entry.stars)
    const pills: Record<string, number> = {}
    for (const [pid, n] of Object.entries(invested.pills)) {
      const back = refundPillsOf(n)
      if (back > 0) pills[pid] = back
    }
    // 角色本身的价值按稀有度转换表照给，与「重复抽到转精血」同一把尺子
    const own = ESSENCE_BY_RARITY[cdef.rarity]
    return {
      own,
      essence: own + refundOf(invested.essence),
      xuanjing: refundOf(invested.xuanjing),
      crystal: refundOf(invested.crystal),
      pills,
      invested,
    }
  }

  // ── 升星（v1.28.9：上限 50★、每 10 星一档品质，定数见 data.STAR_TIERS）────────
  starUp(id: string) {
    const fwd = this.delegate<void>('starUp', { charId: id })
    if (fwd) return fwd
    const entry = this.state.roster[id]
    const cdef = CHAR_MAP[id]
    if (!entry || !cdef) return
    if (entry.stars >= MAX_STARS) { this.setNotice(`已达最高星级 ${MAX_STARS}★`); return }
    const cost = starUpCost(entry.stars)
    if ((this.state.inventory[cost.item] ?? 0) < cost.amount) {
      this.setNotice(`需要 ${cost.amount} ${itemLabel(cost.item).name}`)
      return
    }
    const tierBefore = starTierIndex(entry.stars)
    this.state.inventory[cost.item] -= cost.amount
    entry.stars += 1
    const tier = starTierOf(entry.stars)
    // 跨档单独报一次：否则"每 10 星一个品质"这件事在提示里完全看不见
    this.setNotice(starTierIndex(entry.stars) > tierBefore
      ? `${cdef.name} 晋入 ${tier.name}！${entry.stars}★`
      : `${cdef.name} 突破至 ${entry.stars}★（${tier.name}）`)
    this.bumpMetric('starup', 1)
    this.emit()
  }

  /**
   * 角色碎片兑换：花 `shardCostOf(角色)` 枚碎片，换一名**指定的、尚未拥有**的角色
   * （联动角色固定 100 枚，其余按品阶）。
   *
   * 只换未拥有的是刻意的——重复的角色已经有转化机制了，再允许用碎片换重复角色，
   * 系统就变成"碎片 → 角色 → 又抽到重复 → 更多碎片"的空转循环。
   * 代价是集齐之后碎片失去出口，所以 UI 要在那时明确说明，别让玩家白攒。
   *
   * 限时联动（v1.41）：活动结束后这两名不再可兑换。**只拦"还没拥有的"** ——
   * 已经拥有的走上面那条"已在名录中"，不该给玩家看到"活动已结束"这种莫名其妙的理由。
   */
  redeemShard(charId: string): { ok: boolean; why?: string } | Promise<{ ok: boolean; why?: string }> {
    // ⚠️ 这个 op 的返回值**带 `ok/why`**，服务端见 `result.ok === false` 会把它翻成
    //    `reason:'refused'、`result` 变空 —— 所以不能走 `delegate`（那条路只透传
    //    `result`），得把 `why` 翻译回引擎那套形状，界面的 `r.ok / r.why` 才照旧能读。
    if (this.remote) {
      return this.postAction<{ ok: boolean; why?: string }>('redeemShard', { charId })
        .then(r => r.ok ? (r.result ?? { ok: true }) : { ok: false, why: r.why })
    }
    const cdef = CHAR_MAP[charId]
    if (!cdef) return { ok: false, why: '没有这名武魂' }
    if (this.state.roster[charId]) return { ok: false, why: `${cdef.name} 已在名录中` }
    // ⚠️ 判定走 `linkGettable(charId)`，**不是** `isLinkChar(charId) && !linkActive()`：
    //    后者按"有没有活动在进行"判，第二期开起来时会把第一期已结束的韩立/银月一起放回来。
    if (!linkGettable(charId)) {
      // 与界面同一句话（linkClosedText 按时段取词：活动前说"已结束"是假话，红线⑩）
      return { ok: false, why: linkClosedText(charId) }
    }
    const need = shardCostOf(cdef)
    if ((this.state.inventory.shard ?? 0) < need) return { ok: false, why: `角色碎片不足（需要 ${need} 枚）` }
    this.state.inventory.shard -= need
    this.state.roster[charId] = { level: 1, xp: 0, stars: 0, equip: {} }
    this.bumpMetric('redeem', 1)
    this.setNotice(`碎片凝聚成形！获得${RARITY_INFO[cdef.rarity].label}「${cdef.name}」`)
    this.emit()
    return { ok: true }
  }

  // ── 装备：背包（equipBag）与角色已穿戴（roster[id].equip）之间互相移动 ──────────
  equipItem(charId: string, itemId: string) {
    const fwd = this.delegate<void>('equipItem', { charId, itemId })
    if (fwd) return fwd
    const entry = this.state.roster[charId]
    const idx = this.state.equipBag.findIndex(i => i.id === itemId)
    if (!entry || idx < 0) return
    const item = this.state.equipBag[idx]
    this.state.equipBag.splice(idx, 1)
    const prev = entry.equip[item.slot]
    if (prev) this.state.equipBag.push(prev)
    entry.equip[item.slot] = item
    this.emit()
  }

  unequipItem(charId: string, slot: EquipSlot) {
    const fwd = this.delegate<void>('unequipItem', { charId, slot })
    if (fwd) return fwd
    const entry = this.state.roster[charId]
    const item = entry?.equip[slot]
    if (!entry || !item) return
    delete entry.equip[slot]
    this.state.equipBag.push(item)
    this.emit()
  }

  // ── 装备洗练 ──────────────────────────────────────────────────────────────

  /**
   * 在背包和所有武魂的已穿戴里找一件装备。洗练必须支持**穿戴中**的装备——
   * 玩家不会为了洗一件装备先脱下来再穿回去；而且脱下来洗会让 UI 上的战力对照断掉。
   * 返回的是 state 里的对象引用，调用方可以就地改。
   */
  findEquip(itemId: string): EquipItem | null {
    const inBag = this.state.equipBag.find(i => i.id === itemId)
    if (inBag) return inBag
    for (const entry of Object.values(this.state.roster)) {
      for (const slot of EQUIP_SLOTS) {
        const it = entry.equip?.[slot]
        if (it && it.id === itemId) return it
      }
    }
    return null
  }

  /**
   * 扣一笔灵金，余额不够就**什么都不动**并返回 false。
   *
   * 为什么要有这么一个"通用付款"而不是各调用点自己减：**价钱不该在引擎里抄第二份**。
   * 集结讨伐的「付费重启世界 Boss」价格由服务端随状态下发（`wb.restart.cost`），
   * 这个项目反复踩「两份实现必然漂」的坑 —— 引擎里再写一个常数，改了服务端就会对不上账。
   *
   * 扣费成功即落盘并广播。**调用方负责决定"什么时候才该扣"**（见 WorldBossView 的 doRestart：
   * 先请服务端点头、再动钱，被拒时一分钱都不该出去）。
   */
  spendCoin(amount: number): boolean {
    const n = Math.floor(Number(amount) || 0)
    if (n <= 0) return true
    const coin = num(this.state.inventory.coin)
    if (coin < n) return false
    this.state.inventory.coin = coin - n
    this.save()
    this.emit()
    return true
  }

  /**
   * 洗练一条额外词条的消耗。UI 要在按钮上明示——洗练是重复动作，不该每次再弹确认框。
   * 只消耗灵金，且按品阶固定：**洗第 N 次和洗第 1 次同价**，让玩家能自己算"还差多少灵金"。
   */
  reforgeCost(quality: Rarity): { coin: number } {
    return { coin: EQUIP_REFORGE[quality].coin }
  }

  /**
   * 洗练：重掷一件装备的第 idx 条**额外**词条（类型与数值一起重掷）。失败返回原因，不改任何状态。
   *
   * 只洗额外词条，先天词条一律不可洗 —— 理由见 data.ts 的 EQUIP_REFORGE。
   * 扣费在重掷之前完成，任一步失败都不落盘，不会出现"扣了钱没洗成"。
   *
   * v1.38.2：最高阶武器（canUndoReforge）在重掷前把**洗之前那条词条**记进 state.reforgeUndo，
   * 玩家可以换回（见 undoReforge）。其余装备不记账，也不会清掉别人那份快照。
   */
  reforgeEquip(itemId: string, idx: number): ReforgeResult | Promise<ReforgeResult> {
    const fwd = this.delegate<ReforgeResult>('reforgeEquip', { itemId, idx })
    if (fwd) return fwd
    const item = this.findEquip(itemId)
    if (!item) return { ok: false, why: '找不到这件装备' }
    if (!item.extra?.[idx]) return { ok: false, why: '没有这条词条（先天词条不可洗练）' }
    const cost = this.reforgeCost(item.quality)
    if (cost.coin <= 0) return { ok: false, why: '该品阶没有可洗练的词条' }
    const coin = num(this.state.inventory.coin)
    if (coin < cost.coin) return { ok: false, why: `灵金不足（需要 ${cost.coin}）` }
    // 先取一份副本：下面 item.extra[idx] 是就地覆盖，prev 与它同引用的话快照会被写成新值
    const prev = { ...item.extra[idx] }
    this.state.inventory.coin = coin - cost.coin
    item.extra[idx] = rollReforgedAffix(item.quality)
    // 无论这次洗出什么，快照都指向**上一个**结果：可换回的机会始终只有一次，
    // 每洗一次就往后滚一格。想留更早的结果就只能靠这次洗练之前先换回。
    if (canUndoReforge(item)) this.state.reforgeUndo = { itemId: item.id, idx, from: prev }
    this.bumpMetric('reforge', 1)
    this.save()
    this.emit()
    return { ok: true, affix: item.extra[idx] }
  }

  /**
   * 这件装备当前能不能换回上一次洗练前的词条。UI 拿它决定要不要画对比条。
   * 快照是全局唯一一份，所以必须核对 itemId —— 换过别的圣阶武器之后，
   * 旧快照还在存档里躺着，不核对会让 A 的洗练结果显示在 B 上。
   */
  reforgeUndoOf(itemId: string): ReforgeUndo | null {
    const snap = this.state.reforgeUndo
    if (!snap || snap.itemId !== itemId) return null
    return this.findEquip(itemId) ? snap : null
  }

  /**
   * 换回上一次洗练前的词条（v1.38.2，仅最高阶武器）。
   *
   * **费用不退**：退费等于"花一次钱洗到满意为止"，会把洗练的灵金消耗整个架空
   * （洗练本身是固定价、可无限次重复的动作，见 reforgeCost）。换回是一次性的后悔药，
   * 用掉即消失——快照清空后不能再"反悔回新词条"。
   */
  undoReforge(itemId: string): ReforgeResult | Promise<ReforgeResult> {
    const fwd = this.delegate<ReforgeResult>('undoReforge', { itemId })
    if (fwd) return fwd
    const snap = this.state.reforgeUndo
    if (!snap || snap.itemId !== itemId) return { ok: false, why: '没有可换回的洗练记录' }
    const item = this.findEquip(itemId)
    // 装备已经不在了（被分解/被清理）：把这条死记录清掉，免得它一直挡着下一次记账
    if (!item) {
      this.state.reforgeUndo = null
      this.save()
      this.emit()
      return { ok: false, why: '找不到这件装备' }
    }
    if (!item.extra?.[snap.idx]) return { ok: false, why: '没有这条词条（先天词条不可洗练）' }
    item.extra[snap.idx] = { ...snap.from }
    this.state.reforgeUndo = null
    this.save()
    this.emit()
    return { ok: true, affix: item.extra[snap.idx] }
  }

  // ── 装备强化（v1.38）──────────────────────────────────────────────────────

  /**
   * 装备的当前强化等级。**唯一的读取口径**：缺字段（v1.38 之前掉的每一件）、
   * 非有限值、超出该品阶上限，一律在这里收干净。UI 与战斗都走它，别自己读 `item.lv`。
   */
  equipLv(item: EquipItem): number {
    if (!item || !Number.isFinite(item.lv)) return 0
    return Math.max(0, Math.min(Math.floor(item.lv), equipEnhCap(item.quality)))
  }

  /**
   * 强化的当前状态：等级 / 上限 / 下一级价目 / 是否满级（满级时 cost 为 0）。
   * UI 一律读这里，别在组件里自己查 `EQUIP_ENHANCE[item.quality]` ——
   * 上限、价目、倍率三样收在 data.ts 一处就够了，组件再拼一遍就是两份口径。
   */
  enhanceInfo(item: EquipItem) {
    // 取不到装备时给一份"零级、零花费"的空壳，而不是让它在这里抛 `item.quality`。
    // equipLv 早就对空值兜了底（`if (!item …) return 0`），这里漏掉就是同一件事有两个口径；
    // 而本函数在 UI 的取值路径上，任何一次 undefined（分解后残留的引用、列表筛选期间的临时值）
    // 都会把整个详情浮层连根打崩。
    if (!item) return { lv: 0, cap: 0, maxed: true, cost: { crystal: 0, essence: 0 }, toMaxCost: { crystal: 0, essence: 0 }, refund: { crystal: 0, essence: 0 } }
    const lv = this.equipLv(item)
    const cap = equipEnhCap(item.quality)
    const maxed = lv >= cap
    const full = equipEnhSpent(item.quality, cap)
    const done = equipEnhSpent(item.quality, lv)
    return {
      lv, cap, maxed,
      cost: equipEnhCost(item.quality, lv),
      // 「强化至满级」还差多少：Σ 逐级价。**界面只拿它当「强化至满级」按钮的够不够点判据**，
      // 不把总价写给玩家看（用户："这不是需要披露给用户的"）；也不必让玩家自己加。
      toMaxCost: maxed ? { crystal: 0, essence: 0 } : { crystal: full.crystal - done.crystal, essence: full.essence - done.essence },
      // 分解这件会退多少强化材料（界面要在「分解可得」里写出来，别让玩家按投入自己估）
      refund: equipEnhRefund(item.quality, lv),
    }
  }

  /**
   * 强化一件装备。背包里和**穿戴中**的都能强（同 findEquip，理由与洗练一样：
   * 玩家不该为了强化先脱下来）。
   *
   * `times` 默认 1；传大值就是「强化到满级」。**逐级扣费、扣到哪级算哪级** ——
   * 材料只够升 3 级就给 3 级并如实回报 `levels`，不是整批失败。这条语义是刻意的：
   * 强化吃的是玩家挂机几十小时攒的结晶/精血，"差最后一级就一级都不升"只会让按钮变成摆设。
   * `why` 仍然带回失败原因，UI 可以照样显示"精血不足"。
   */
  enhanceEquip(itemId: string, times = 1): EnhanceResult | Promise<EnhanceResult> {
    const fwd = this.delegate<EnhanceResult>('enhanceEquip', { itemId, times })
    if (fwd) return fwd
    const item = this.findEquip(itemId)
    if (!item) return { ok: false, levels: 0, why: '找不到这件装备' }
    const cap = equipEnhCap(item.quality)
    let lv = this.equipLv(item)
    if (lv >= cap) return { ok: false, levels: 0, why: '已满级' }
    const want = Math.max(1, Math.min(Math.floor(times) || 1, cap - lv))
    const inv = this.state.inventory
    let done = 0
    let why: string | undefined
    for (let i = 0; i < want; i++) {
      const cost = equipEnhCost(item.quality, lv)
      if ((inv.crystal ?? 0) < cost.crystal) { why = `斗气结晶不足（需要 ${cost.crystal}）`; break }
      if ((inv.essence ?? 0) < cost.essence) { why = `武魂精血不足（需要 ${cost.essence}）`; break }
      inv.crystal = (inv.crystal ?? 0) - cost.crystal
      inv.essence = (inv.essence ?? 0) - cost.essence
      lv += 1
      done += 1
    }
    if (!done) return { ok: false, levels: 0, why: why ?? '材料不足' }
    item.lv = lv
    // 活动中心：按**真的强化成功了几级**记，而不是"点了几次"（一次点满是 1 次点击、N 级强化）
    this.bumpMetric('enhance', done)
    this.setNotice(`强化成功：${item.name} +${lv}`)
    this.save()
    this.emit()
    return { ok: true, levels: done, why }
  }

  // ── 装备评分与自动穿戴 ─────────────────────────────────────────────────────
  private teamIds(): string[] {
    return [...this.state.team.front, ...this.state.team.back].filter((x): x is string => !!x)
  }

  /** 异火只对上阵首位生效。UI 要显示属性/战力也走这里，别在组件里自己拼这个判断 */
  fireIdOf(charId: string): string | null {
    return this.state.equippedFire && charId === this.state.team.front[0] ? this.state.equippedFire : null
  }

  /**
   * 某角色**裸属性**：当前真实攻击/防御/气血（含星级、境界、异火、装备词条）。**不含阵营羁绊**。
   *
   * UI 一律走这里，别自己写 `baseAtk + atkGrowth * level`——那正是「升星没有属性提升」的原因：
   * 星级/境界/异火/装备全都挂在 charStats 的加成层上，界面自算的那套等于把它们全漏掉，
   * 玩家点了升星看到数字纹丝不动（实际战斗数值已经涨了），只会认为功能坏了。
   *
   * ⚠️ 要显示"这个角色在战斗中是多少"请用 `battleStatsOf`：本函数不含 v1.28 的阵营羁绊，
   * 而上阵角色在战斗里是吃的（同样的坑在 v1.29 又被踩了一次：显示裸值 615 / 战斗 763）。
   */
  statsOf(charId: string, starsOverride?: number) {
    const entry = this.state.roster[charId]
    const cdef = CHAR_MAP[charId]
    if (!entry || !cdef) return null
    // starsOverride 只给界面做「升星后能涨多少」的预览用，不动存档
    const e = starsOverride === undefined ? entry : { ...entry, stars: starsOverride }
    return charStats(e, cdef, this.fireIdOf(charId))
  }

  powerOf(charId: string): number {
    const entry = this.state.roster[charId]
    const cdef = CHAR_MAP[charId]
    if (!entry || !cdef) return 0
    return charPower(entry, cdef, this.fireIdOf(charId))
  }

  /** 把 item 装到该角色对应槽位后它的战力（只试算，不改状态） */
  powerIfEquipped(charId: string, item: EquipItem): number {
    const entry = this.state.roster[charId]
    const cdef = CHAR_MAP[charId]
    if (!entry || !cdef) return 0
    const prev = entry.equip[item.slot]
    entry.equip[item.slot] = item
    const p = charPower(entry, cdef, this.fireIdOf(charId))
    if (prev) entry.equip[item.slot] = prev; else delete entry.equip[item.slot]
    return p
  }

  /** 该装备对某角色的战力增益（≤0 表示不如他现在穿的） */
  equipGain(charId: string, item: EquipItem): number {
    return this.powerIfEquipped(charId, item) - this.powerOf(charId)
  }

  /**
   * 找一对「同槽位、不同角色」的位置做交换，返回战力增益最大的一组（无正增益则返回 null）。
   *
   * 为什么需要它：单件贪心只保证「不存在任何单件移动能再涨战力」——那是**局部最优，不是全局最优**。
   * 跨角色抢同一件装备时会出现先后耦合（好装备先给了甲，乙就只剩次好的，而反过来总战力更高），
   * 单件贪心会被卡在这种次优解上。模糊测试实测：200 轮随机实例里补 2-opt 后仍有 13 轮低于暴力枚举最优。
   * 补一轮同槽位成对交换（2-opt）能消掉绝大多数这种耦合，剩下的是需要三件以上轮换才解开的，代价 <1%。
   * 交换只在同槽位之间进行，所以不需要额外校验槽位兼容性。
   */
  private bestSwap(ids: string[]): { gain: number; a: string; b: string; slot: EquipSlot } | null {
    let bestGain = 1e-9
    let best: { gain: number; a: string; b: string; slot: EquipSlot } | null = null
    for (const slot of EQUIP_SLOTS) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const A = this.state.roster[ids[i]]
          const B = this.state.roster[ids[j]]
          if (!A || !B) continue
          const ea = A.equip[slot]
          const eb = B.equip[slot]
          if (!ea && !eb) continue // 两边都空，交换没有意义
          const before = this.powerOf(ids[i]) + this.powerOf(ids[j])
          if (eb) A.equip[slot] = eb; else delete A.equip[slot]
          if (ea) B.equip[slot] = ea; else delete B.equip[slot]
          const after = this.powerOf(ids[i]) + this.powerOf(ids[j])
          if (ea) A.equip[slot] = ea; else delete A.equip[slot]
          if (eb) B.equip[slot] = eb; else delete B.equip[slot]
          if (after - before > bestGain) { bestGain = after - before; best = { gain: after - before, a: ids[i], b: ids[j], slot } }
        }
      }
    }
    return best
  }

  /**
   * 单槽位精确重分配：固定其余三个槽位，把该槽位的候选装备（池子里的 + 上阵角色正穿着的）
   * 在上阵角色之间重新指派，用状压 DP 求**这一个槽位**的最优解（每人至多一件，允许装备留在池子里）。
   *
   * 为什么需要它：单件贪心只保证"没有任何单件移动能再涨"，同槽位两两交换（2-opt）只保证
   * "没有一对能换得更划算"——**三件以上轮换**这两种都解不开。模糊测试里与全局最优的差距
   * 全部出自这种同槽位循环（最坏 0.8%）。
   *
   * 规模是 候选数 × 2^上阵人数，所以只在小规模下启用（见 COST）：大团队 + 大背包候选极多、
   * 同槽位耦合本来就少，2-opt 已经够，没必要为一个动不了的槽位花几十毫秒。
   * 只在 DP 最优严格优于现状时才落地（单调、可重复点击幂等）。
   */
  private slotReassign(ids: string[], pool: EquipItem[]): boolean {
    const n = ids.length
    const full = 1 << n
    const COST = 20000 // 候选数 × 2^n 的上限（约几毫秒的量级）
    const NEG = -Infinity
    let anyChanged = false
    for (const slot of EQUIP_SLOTS) {
      const cands = pool.filter(it => it.slot === slot)
      for (const id of ids) {
        const it = this.state.roster[id]?.equip[slot]
        if (it) cands.push(it)
      }
      if (cands.length < 2 || cands.length * full > COST) continue

      // empty[c]：第 c 人该槽位空着时的战力（其它槽位固定）；delta[i][c]：把第 i 件给他能涨多少
      const empty: number[] = []
      for (const id of ids) {
        const entry = this.state.roster[id]
        const cdef = CHAR_MAP[id]
        if (!entry || !cdef) { empty.push(NEG); continue }
        const prev = entry.equip[slot]
        delete entry.equip[slot]
        empty.push(charPower(entry, cdef, this.fireIdOf(id)))
        if (prev) entry.equip[slot] = prev
      }
      const delta = cands.map(it => ids.map((id, c) => {
        const entry = this.state.roster[id]
        const cdef = CHAR_MAP[id]
        if (!entry || !cdef || empty[c] === NEG) return NEG
        const prev = entry.equip[slot]
        entry.equip[slot] = it
        const d = charPower(entry, cdef, this.fireIdOf(id)) - empty[c]
        if (prev) entry.equip[slot] = prev; else delete entry.equip[slot]
        return d
      }))

      // 现状的增益和：用于判断这次重指派有没有真的变强（没变强就不动，避免无谓重排）
      const holder = new Map<string, number>()
      for (let c = 0; c < n; c++) {
        const it = this.state.roster[ids[c]]?.equip[slot]
        if (it) holder.set(it.id, c)
      }
      let curVal = 0
      for (let i = 0; i < cands.length; i++) {
        const c = holder.get(cands[i].id)
        if (c !== undefined) curVal += delta[i][c]
      }

      // 状压 DP：dp[mask] = 已把这些候选分配给 mask 中这些人的最大增益和（每个人至多一件）
      let dp: number[] = new Array(full).fill(NEG)
      dp[0] = 0
      const back: Int8Array[] = []
      for (let i = 0; i < cands.length; i++) {
        const nxt = dp.slice()
        const bk = new Int8Array(full).fill(-1)
        for (let mask = 0; mask < full; mask++) {
          const base = dp[mask]
          if (base === NEG) continue
          for (let c = 0; c < n; c++) {
            if (mask & (1 << c)) continue
            const d = delta[i][c]
            if (d === NEG) continue
            const nm = mask | (1 << c)
            if (base + d > nxt[nm]) { nxt[nm] = base + d; bk[nm] = c }
          }
        }
        dp = nxt
        back.push(bk)
      }
      let bestMask = 0
      for (let mask = 1; mask < full; mask++) if (dp[mask] > dp[bestMask]) bestMask = mask
      if (dp[bestMask] <= curVal + 1e-9) continue

      const assign = new Map<string, number>()
      let mask = bestMask
      for (let i = cands.length - 1; i >= 0; i--) {
        const c = back[i][mask]
        if (c < 0) continue
        assign.set(cands[i].id, c)
        mask &= ~(1 << c)
      }
      // 落地：先把"没被指派回原位"的旧装备摘回池子，再把选中的装上（从池子里取）
      for (let c = 0; c < n; c++) {
        const entry = this.state.roster[ids[c]]
        const it = entry?.equip[slot]
        if (it && assign.get(it.id) !== c) { delete entry.equip[slot]; pool.push(it) }
      }
      for (const [itemId, c] of assign) {
        const entry = this.state.roster[ids[c]]
        if (entry.equip[slot]?.id === itemId) continue
        const k = pool.findIndex(it => it.id === itemId)
        if (k < 0) continue
        entry.equip[slot] = pool.splice(k, 1)[0]
      }
      anyChanged = true
    }
    return anyChanged
  }

  /**
   * 一键最优穿戴：候选池 = 背包 + 上阵角色身上已穿的装备（全部脱下后统一重新分配）。
   * 三段式搜索，每段都只做"能涨战力"的改动，直到全部无改进：
   *   ① 逐件贪心（每轮装全局增益最大的一件）
   *   ② 同槽位两两交换（2-opt）——解开"好装备先给了甲、乙只剩次好的"这类两两耦合
   *   ③ 单槽位精确重分配（状压 DP）——解开 ①② 都解不开的"三件以上同槽位轮换"
   * 只作用于上阵角色，非上阵角色身上的装备原样不动。
   *
   * **口径必须统一**：搜索的目标函数、以及最后"这次重排要不要保留"的判据，用的都是
   * `powerOf` 的**未取整**战力。不能拿显示用的 `combatPower`（内部 Math.round）当判据——
   * 低级角色全队战力才几十点，几件装备合起来涨 0.8 也会被取整抹平，于是算法认定"没变强"
   * 而回滚，玩家点「一键穿戴」会看到装备全留在背包里、提示"已是最优"（实测 lv1 小背包复现）。
   * 代价是显示战力偶尔不动——UI 那边对不到 1 点的变化显示"≈ 持平"，见 EquipmentView。
   *
   * 仍是**近似最优**：②③ 只覆盖同一槽位内的重排，跨槽位的联合调整没做（那是通用指派问题），
   * 所以理论上可能不是全局最优。2026-09-14 的 200 轮随机小实例模糊测试（3 人以内、与暴力枚举
   * 对比）在补上 ③ 之后为 200/200 一致，见 design/数值设计.md。
   */
  autoEquipBest(): { changed: number; powerGain: number } | Promise<{ changed: number; powerGain: number }> {
    const fwd = this.delegate<{ changed: number; powerGain: number }>('autoEquipBest', {})
    if (fwd) return fwd
    const ids = this.teamIds()
    if (!ids.length) return { changed: 0, powerGain: 0 }
    const rawPower = () => ids.reduce((s, id) => s + this.powerOf(id), 0)
    const before = rawPower()

    // 位置快照：itemId → 'bag' 或 `${charId}:${slot}`。
    // 用处一：算完发现没比原来强，就原样还原——否则每次点击都会重排成另一组等价解
    //        （战力一样，玩家看到装备全换了一遍还以为亏了）。
    // 用处二：changed 统计成"真正换了位置的件数"，而不是"从裸装装了N件"。
    const snapEquip = new Map<string, Partial<Record<EquipSlot, EquipItem>>>()
    const snapBag = [...this.state.equipBag]
    const where = new Map<string, string>()
    for (const it of snapBag) where.set(it.id, 'bag')
    for (const id of ids) {
      const entry = this.state.roster[id]
      const copy: Partial<Record<EquipSlot, EquipItem>> = {}
      for (const slot of EQUIP_SLOTS) {
        const it = entry?.equip[slot]
        if (!it) continue
        copy[slot] = it
        where.set(it.id, `${id}:${slot}`)
      }
      snapEquip.set(id, copy)
    }

    const pool: EquipItem[] = [...this.state.equipBag]
    for (const id of ids) {
      const entry = this.state.roster[id]
      if (!entry) continue
      for (const slot of EQUIP_SLOTS) {
        const it = entry.equip[slot]
        if (it) { pool.push(it); delete entry.equip[slot] }
      }
    }
    const cur = new Map(ids.map(id => [id, this.powerOf(id)])) // 此刻全员裸装，这就是基准

    for (let iter = 0, maxIter = ids.length * EQUIP_SLOTS.length * 4; iter < maxIter; iter++) {
      let bestGain = 1e-9, bestChar = '', bestIdx = -1, bestPrev: EquipItem | null = null
      for (const id of ids) {
        const entry = this.state.roster[id]
        const cdef = CHAR_MAP[id]
        if (!entry || !cdef) continue
        const fireId = this.fireIdOf(id)
        const curPower = cur.get(id) ?? 0
        for (let i = 0; i < pool.length; i++) {
          const item = pool[i]
          const prev = entry.equip[item.slot] ?? null
          entry.equip[item.slot] = item
          const gain = charPower(entry, cdef, fireId) - curPower
          if (prev) entry.equip[item.slot] = prev; else delete entry.equip[item.slot]
          if (gain > bestGain) { bestGain = gain; bestChar = id; bestIdx = i; bestPrev = prev }
        }
      }
      if (bestIdx >= 0) {
        const item = pool[bestIdx]
        pool.splice(bestIdx, 1)
        if (bestPrev) pool.push(bestPrev) // 被顶替下来的回到池子，还有机会给别人
        this.state.roster[bestChar].equip[item.slot] = item
        cur.set(bestChar, this.powerOf(bestChar))
        continue
      }
      // 单件移动已无增益 → 先试一对同槽位交换（便宜），再试单槽位精确重分配（贵，但能解开三人以上轮换）
      const sw = this.bestSwap(ids)
      if (sw) {
        const A = this.state.roster[sw.a]
        const B = this.state.roster[sw.b]
        const ea = A.equip[sw.slot]
        const eb = B.equip[sw.slot]
        if (eb) A.equip[sw.slot] = eb; else delete A.equip[sw.slot]
        if (ea) B.equip[sw.slot] = ea; else delete B.equip[sw.slot]
        cur.set(sw.a, this.powerOf(sw.a))
        cur.set(sw.b, this.powerOf(sw.b))
        continue
      }
      if (!this.slotReassign(ids, pool)) break
      // 整个槽位被重新指派过，缓存全部作废，重算一遍（每轮至多 上阵人数 次 powerOf）
      for (const id of ids) cur.set(id, this.powerOf(id))
    }

    this.state.equipBag = pool
    const after = rawPower()
    if (after <= before + 1e-9) {
      // 已经是最优（或等价解）：还原，不做无意义的重排
      this.state.equipBag = snapBag
      for (const id of ids) this.state.roster[id].equip = { ...snapEquip.get(id) }
      return { changed: 0, powerGain: 0 }
    }

    let changed = 0
    for (const it of this.state.equipBag) if (where.get(it.id) !== 'bag') changed++
    for (const id of ids) {
      for (const slot of EQUIP_SLOTS) {
        const it = this.state.roster[id].equip[slot]
        if (it && where.get(it.id) !== `${id}:${slot}`) changed++
      }
    }
    this.emit()
    return { changed, powerGain: after - before }
  }

  // ── 装备分解：把堆积的低阶装备换成升星材料 ────────────────────────────────
  /**
   * 分解一件背包装备，产出武魂精血（天阶以上额外给玄晶）。
   *
   * v1.38 起**另外退还该装备已投入强化材料的 70%**（见 data.ts 的 equipEnhRefund）：
   * 满强化圣装是 2400 万结晶 + 4800 精血的投入，一次点错就归零是不可接受的；
   * 但也不是全额退——全额退等于强化材料可以随意搬运，强化就不再是"这件装备"的投入了。
   */
  breakdownEquip(itemId: string): { essence: number; xuanjing: number; refundCrystal: number; refundEssence: number } | null | Promise<{ essence: number; xuanjing: number; refundCrystal: number; refundEssence: number } | null> {
    const fwd = this.delegate<{ essence: number; xuanjing: number; refundCrystal: number; refundEssence: number } | null>('breakdownEquip', { itemId })
    if (fwd) return fwd
    const idx = this.state.equipBag.findIndex(i => i.id === itemId)
    if (idx < 0) return null
    const item = this.state.equipBag[idx]
    const gain = EQUIP_BREAKDOWN[item.quality]
    if (!gain) return null // 品阶无法识别的装备宁可留着也不销毁（理论上进不来，见 sanitizeEquipItem）
    this.state.equipBag.splice(idx, 1)
    // 分解掉的正好是快照记着的那件 → 快照作废。留着的话，下一次洗练会把它顶掉（记账总是覆盖），
    // 但在那之前 undoReforge 会先撞上"找不到这件装备"，白让玩家看见一个点不动的按钮。
    if (this.state.reforgeUndo?.itemId === itemId) this.state.reforgeUndo = null
    this.state.inventory.essence = (this.state.inventory.essence ?? 0) + gain.essence
    if (gain.xuanjing) this.state.inventory.xuanjing = (this.state.inventory.xuanjing ?? 0) + gain.xuanjing
    const refund = this.refundEnhance(item)
    this.emit()
    return { essence: gain.essence, xuanjing: gain.xuanjing, ...refund }
  }

  /**
   * 退还一件装备的强化投入（就地加进背包资源）。**分解的两个入口共用这一处**，
   * 免得"单件分解退、一键分解不退"这种只在某条路径上成立的 bug。
   */
  private refundEnhance(item: EquipItem): { refundCrystal: number; refundEssence: number } {
    const lv = this.equipLv(item)
    if (lv <= 0) return { refundCrystal: 0, refundEssence: 0 }
    const r = equipEnhRefund(item.quality, lv)
    if (r.crystal) this.state.inventory.crystal = (this.state.inventory.crystal ?? 0) + r.crystal
    if (r.essence) this.state.inventory.essence = (this.state.inventory.essence ?? 0) + r.essence
    return { refundCrystal: r.crystal, refundEssence: r.essence }
  }

  /**
   * 垃圾装备 = 所有上阵角色装上都不会变强的背包装备。
   * 只要还有上阵角色该槽位空着、或有人能靠它涨战力，就不算垃圾
   * （避免把有用的备用件、或带暴击词条能翻盘的低阶装备误分解）。
   */
  isJunkEquip(item: EquipItem): boolean {
    const ids = this.teamIds()
    if (!ids.length) return false
    for (const id of ids) {
      const entry = this.state.roster[id]
      if (!entry) continue
      if (!entry.equip[item.slot]) return false
      if (this.equipGain(id, item) > 0) return false
    }
    return true
  }

  /**
   * 一件背包装备**这次会不会被一键分解吃掉** —— 预览与实际执行共用这一处。
   *
   * v1.64（用户：「一键分解装备允许用户自定义分解的装备品质」）：在"垃圾"之上再按品阶收窄。
   * 两道条件是**与**关系，不是或 —— 勾了「圣阶」也只会分解**没用的**圣阶，
   * 「换上会变强」的那件照样保留。玩家选的从来只是"范围"，不是"要不要保护"。
   *
   * ⚠️ **界面不许自己再写一遍这个判断。** 装备分解不可逆（不退费、也找回不了），
   *    "弹窗说分解 100 件、实际吃掉 3746 件"是玩家会截图来骂的那种 bug，
   *    而两份实现只要有一天不同步就会出现它 —— 所以预览(`junkPreview`)与执行(`breakdownJunk`)
   *    必须调用同一个函数，判据也直接比这两个的返回数。
   *
   * `qualities` 缺省 = **不按品阶筛**（老客户端的调用方式，行为与改版前逐字节相同）。
   * 传了空数组 = 一件都不分解（这是玩家主动取消全部勾选的意思，不是"不限"）。
   */
  private isJunkPick(item: EquipItem, qualities?: Rarity[]): boolean {
    if (qualities && !qualities.includes(item.quality)) return false
    if (!EQUIP_BREAKDOWN[item.quality]) return false // 品阶无法识别 → 留着
    return this.isJunkEquip(item)
  }

  /**
   * 「一键分解」这一次会吃掉多少件、产出多少。**只读**，不动任何状态 —— 给确认弹窗用。
   *
   * 与真正执行的 `breakdownJunk` 共用 `isJunkPick`，所以两个数永远相等；
   * 判据里那条"预览 == 实际"就是拿这两个方法的返回值直接比的。
   */
  junkPreview(qualities?: Rarity[]): { count: number; essence: number; xuanjing: number } {
    let count = 0, essence = 0, xuanjing = 0
    for (const item of this.state.equipBag) {
      if (!this.isJunkPick(item, qualities)) continue
      const g = EQUIP_BREAKDOWN[item.quality]
      count++; essence += g.essence; xuanjing += g.xuanjing
    }
    return { count, essence, xuanjing }
  }

  /**
   * 一键分解所有垃圾装备（强化过的会连带退还材料，与单件分解同一条路径）。
   *
   * `qualities` = 玩家在确认框里勾选的品阶（v1.64）。缺省不筛，见 `isJunkPick`。
   * ⚠️ 远程模式下整个动作（连同这个参数）是发给服务端执行的 —— 所以**服务端的 action 表
   *    必须能收下 `qualities`**，且**必须先部署服务端再切客户端**：老服务端会把这个参数
   *    整个丢掉然后照旧全分解，"勾了黄阶却被清空背包"说的就是那个窗口。
   */
  breakdownJunk(qualities?: Rarity[]): { count: number; essence: number; xuanjing: number; refundCrystal: number; refundEssence: number } | Promise<{ count: number; essence: number; xuanjing: number; refundCrystal: number; refundEssence: number }> {
    const fwd = this.delegate<{ count: number; essence: number; xuanjing: number; refundCrystal: number; refundEssence: number }>('breakdownJunk', { qualities })
    if (fwd) return fwd
    let count = 0, essence = 0, xuanjing = 0, refundCrystal = 0, refundEssence = 0
    const keep: EquipItem[] = []
    for (const item of this.state.equipBag) {
      if (!this.isJunkPick(item, qualities)) { keep.push(item); continue }
      const g = EQUIP_BREAKDOWN[item.quality]
      count++; essence += g.essence; xuanjing += g.xuanjing
      const r = this.refundEnhance(item)
      refundCrystal += r.refundCrystal; refundEssence += r.refundEssence
    }
    if (!count) return { count: 0, essence: 0, xuanjing: 0, refundCrystal: 0, refundEssence: 0 }
    this.state.equipBag = keep
    // 与单件分解同理：快照记的那件被一键分解吃掉 → 快照作废。
    // **不能用 keep 里找不找得到来判断** —— 一键分解只动背包，而快照记的完全可以是
    // 某位角色身上穿着的武器（洗练本就支持穿戴中装备），那件永远不在 keep 里。
    if (this.state.reforgeUndo && !this.findEquip(this.state.reforgeUndo.itemId)) this.state.reforgeUndo = null
    this.state.inventory.essence = (this.state.inventory.essence ?? 0) + essence
    if (xuanjing) this.state.inventory.xuanjing = (this.state.inventory.xuanjing ?? 0) + xuanjing
    this.emit()
    return { count, essence, xuanjing, refundCrystal, refundEssence }
  }

  // ── 炼丹（灵药+灵金 → 指定品阶丹药，缓解突破材料瓶颈）───────────────────────
  craftPill(grade: number) {
    const fwd = this.delegate<void>('craftPill', { grade })
    if (fwd) return fwd
    const pill = PILLS.find(p => p.grade === grade)
    if (!pill) return
    const cost = pillCraftCost(grade)
    if ((this.state.inventory.herb ?? 0) < cost.herb || (this.state.inventory.coin ?? 0) < cost.coin) {
      this.setNotice('灵药或灵金不足')
      return
    }
    this.state.inventory.herb -= cost.herb
    this.state.inventory.coin -= cost.coin
    this.state.inventory[pill.id] = (this.state.inventory[pill.id] ?? 0) + 1
    this.bumpMetric('craft', 1)
    this.setNotice(`炼成 ${pill.name} ×1`)
    this.emit()
  }

  // ── 商城：限时增益倍率 + 价格随购买递增（跨天回落）+ 购买 ──────────────────────
  /** 当前生效的某类增益倍率（1 + Σpct/100），已过期的不计入 */
  private buffMult(kind: BuffKind): number {
    const now = Date.now()
    let pct = 0
    for (const b of this.state.buffs) {
      if (b.expireAt <= now) continue
      const def = SHOP_BUFFS.find(x => x.id === b.id)
      if (def && def.kind === kind) pct += def.pct
    }
    return 1 + pct / 100
  }

  /** 跨天则清空当日购买计数，价格回落到基准（纯价格限制，不设次数上限） */
  private ensureShopDay() {
    // 日期口径走 activities.todayKey —— **全站只有这一个**（活动中心的"今日/跨天"也走它）。
    // 两处各写一份的话，哪天给其中一处加了时区处理，"签到说今天签过了、商城说今天还没买"就来了。
    const today = todayKey()
    if (this.state.shop.date !== today) this.state.shop = { date: today, counts: {} }
  }

  /** 商品当前价格 = costMult × 生涯关卡奖励 × growth^当日已购次数 */
  shopPrice(goodId: string): number {
    this.ensureShopDay()
    const g = SHOP_GOODS.find(x => x.id === goodId)
    if (!g) return Infinity
    const base = g.costMult * stageCoinReward(this.state.highestStage)
    const count = this.state.shop.counts[goodId] ?? 0
    return Math.round(base * Math.pow(g.growth, count))
  }

  buyShopItem(goodId: string) {
    const fwd = this.delegate<void>('buyShopItem', { goodId })
    if (fwd) return fwd
    const g = SHOP_GOODS.find(x => x.id === goodId)
    if (!g) return
    const price = this.shopPrice(goodId)
    if ((this.state.inventory.coin ?? 0) < price) { this.setNotice('灵金不足'); return }
    this.state.inventory.coin -= price
    this.state.shop.counts[goodId] = (this.state.shop.counts[goodId] ?? 0) + 1
    this.bumpMetric('shop', 1)
    if (g.kind === 'material' && g.item) {
      this.state.inventory[g.item] = (this.state.inventory[g.item] ?? 0) + (g.amount ?? 1)
      this.setNotice(`购得 ${itemLabel(g.item).name} ×${g.amount ?? 1}`)
    } else if (g.kind === 'buff' && g.buffId) {
      const def = SHOP_BUFFS.find(x => x.id === g.buffId)
      if (def) {
        const now = Date.now()
        const existing = this.state.buffs.find(b => b.id === def.id)
        const from = existing ? Math.max(now, existing.expireAt) : now // 重复购买则续时
        const expireAt = from + def.minutes * 60000
        if (existing) existing.expireAt = expireAt
        else this.state.buffs.push({ id: def.id, expireAt })
        this.setNotice(`${def.name} 生效 ${def.minutes} 分钟`)
      }
    } else if (g.kind === 'equip') {
      const slot = EQUIP_SLOTS[Math.floor(Math.random() * EQUIP_SLOTS.length)]
      const item = rollEquip(slot, rollEquipQuality())
      this.state.equipBag.push(item)
      this.setNotice(`购得装备：${item.name}`)
    }
    this.emit()
  }
}

/**
 * 浏览器侧的全局单例。**服务端不用它** —— 服务端要的是「一个玩家一个实例」，
 * 用的是上面导出的 `GameStore` 类本身（见 SPEC §4.4）。
 *
 * 服务端在 `require` 本模块**之前**把 `globalThis.__DOUPO_SERVER__` 设成 `true`：
 * 这样这个单例不会启动任何定时器 —— 否则 Node 进程会白白多出 4 个后台循环
 * （100ms tick、2 秒落盘、两条 3 分钟的远程配置轮询），而服务端一个都用不上。
 */
const SERVER_SIDE = (globalThis as { __DOUPO_SERVER__?: boolean }).__DOUPO_SERVER__ === true
/**
 * 浏览器那个单例。`remote` 由 `main.tsx` **在 import 本模块之前**通过 `remoteMode.ts` 定下 ——
 * 引擎构造时就要决定开不开 100ms tick / 2s 落盘，晚一步就来不及了（见 remoteMode.ts 头注释）。
 * 服务端那份产物永远 `remote: false`：它自己就是权威，没有"远端"可言。
 */
export const game = new GameStore({ autoLoop: !SERVER_SIDE, remote: !SERVER_SIDE && isRemoteMode() })
;(window as unknown as { __game: GameStore }).__game = game

export function useGame(): GameState {
  return useSyncExternalStore(game.subscribe, game.getSnapshot)
}

// ── 关于 `ITEM_INFO[*].icon` 里那些 emoji（v1.44）────────────────────────────
// **不删，故意的。** 它们现在的身份是「素材缺失时的回落字形」，由 `<Ico emoji={...}>` 消费；
// 同时 `itemLabel().icon` 还被若干**纯文本**路径拼接（战斗日志、setNotice、活动奖励串），
// 在那里塞一个 `icons/coin` 路径会当场打印出路径本身。
// UI 上要显示图标请走 `<Ico name={itemSprite(id)} emoji={itemLabel(id).icon} />`，别自己拼字符串。
export function itemLabel(id: string): { name: string; icon: string } {
  return ITEM_INFO[id] ?? { name: id, icon: '📦' }
}

/**
 * 大数缩写（万/亿/兆）。境界乘法加成引入后，后期伤害与资源会到 1e8 以上，
 * 直接显示原始数字会撑破布局也读不出量级。
 */
export function fmtNum(n: number): string {
  const v = Math.floor(n)
  if (v < 10000) return String(v)
  if (v < 1e8) return (v / 1e4).toFixed(v < 1e6 ? 1 : 0) + '万'
  if (v < 1e12) return (v / 1e8).toFixed(v < 1e10 ? 1 : 0) + '亿'
  return (v / 1e12).toFixed(1) + '兆'
}

/**
 * 综合战力：汇总当前上阵（前排+后排，最多 5 人）每个人的攻防血算出一个总分，供排行榜使用。
 * 权重（攻×1、防×2、血×0.15）按现有数值表校准过——攻击原始数值最小、防御次之、气血最大，
 * 直接相加会被气血一个数值主导，调整后三项对总分的贡献大致都在 25%~45% 区间，不会被单一维度掩盖。
 * 暴击率/暴击伤害折算进"有效攻击"，让堆暴击词条的装备也能反映到战力上。
 */
export function combatPower(state: GameState): number {
  const teamIds = [...state.team.front, ...state.team.back].filter((x): x is string => !!x)
  let total = 0
  for (const id of teamIds) {
    const cdef = CHAR_MAP[id]
    const entry = state.roster[id]
    if (!cdef || !entry) continue
    const fireId = state.equippedFire && id === state.team.front[0] ? state.equippedFire : null
    total += charPower(entry, cdef, fireId)
  }
  return Math.round(total)
}

export function charLabel(id: string) {
  return CHAR_MAP[id]
}

export function rarityInfo(r: Rarity) {
  return RARITY_INFO[r]
}

/**
 * 炼丹成本：按品阶指数增长（每级 ×2），而不是原先的线性（grade*25/40）。
 *
 * 原因：丹药是唯一卡境界突破的资源，但线性成本相对灵药/灵金的挂机产出速度完全跟不上——
 * 实测最贵的 8 品丹药只需 200 灵药 + 320 灵金，20 人满编挂机 2.6 分钟就能攒够，
 * 相当于炼丹房从头到尾没起到过"资源取舍"的作用。
 * 指数曲线按 4 人初始阵容的产出速度（0.5 灵药/秒）校准，
 * 让每个品阶第一次用到的时间点大致对应：1 品 ~2 分钟 → 8 品 ~2 小时，
 * 是一次要花时间攒的真实投入，而不是顺手一点的按钮。
 */
export function pillCraftCost(grade: number): { herb: number; coin: number } {
  const herb = Math.round(60 * Math.pow(2, grade - 1))
  return { herb, coin: Math.round(herb * 1.6) }
}

// ── 卡关引导：读实际库存/进度算出具体可执行的建议，而不是空泛提示 ──────────────
/**
 * `kind` 是**这条建议在讲哪件事**的显式标记，不是给人看的文案。
 * 它存在的唯一理由是下面那条去重判断 —— 老写法是 `out.every(g => g.icon !== '💊')`，
 * 靠**比较一个 emoji 字符串**来判断"已经有一条丹药建议了"。图标体系一升级（emoji → 素材键），
 * 那个比较会**静默失效**：不报错、不崩溃，只是从此每局多推一条重复建议。
 * 用 `kind` 之后，改图标与改判断彻底无关。
 */
export type GuideKind = 'stuck' | 'stalemate' | 'pill' | 'crystal' | 'yuanfen' | 'craft'
export interface Guide {
  kind: GuideKind
  /** 生图素材键（如 `icons/crystal`）。抽象建议（卡关/僵持）没有具体形象，留空由视图给 lucide 图标 */
  spr?: string
  text: string
  tab: 'roster' | 'shop' | 'recruit'
}

// ── 引导：**一条**贯穿全程的步骤表（v1.58）──────────────────────────────
/**
 * 引导的**唯一来源**。用户 2026-09-22：
 *   「我们要对整个旅程剧情做一个改动，要**无脑式**的引导，而且要融入主线战斗模块，
 *     把原有的那个新手引导**代替**，全部用**蒙层引导**，用户必须按照步骤一步一步来……
 *     一步步阻塞引导教玩家怎么开始战斗，然后第一次修炼，第一次装备，装备升级，
 *     然后活动领取，然后战斗爬塔，融入整个旅程，而且要强制引导，蒙层式点击。」
 *
 * ── 它取代了什么（两份旧实现，都已删除，别再各自复活）──────────────────
 *   · `storyGate()` 的四票否决：序章 / 立誓 / 手册 / 第一章 —— 现在**就是**这张表的前三步
 *     与最后几步，`storyGate` 退化成这张表上的一个投影（服务端还在调它，见下）。
 *   · `newbieSteps()` 的三步常驻条（战斗 / 修炼 / 招募）：那是一条**不拦人**的进度条，
 *     玩家可以一直不理它。现在是同一条流水线里的三个**阻塞**步骤。
 *
 * ── 三条设计约束，改这张表之前先读 ──────────────────────────────────────
 *   ① **完成判据全部从既有存档状态推导，不新增存档字段**。存档结构是红线，
 *      而"这一步做没做"几乎都能从别处看出来（打过架有 `kills`、修炼过有 `level`、
 *      穿过装备看 `roster[].equip`、强化过看 `item.lv`、领过活动看 `activities.claimed`、
 *      爬过塔看 `lab.highestFloor`）。加一个 `onboardStep: number` 字段看着省事，
 *      代价是它**一定会和真实进度脱钩**（玩家在别处把这件做了，序号还停在原地）。
 *   ② **顺序即体验顺序，不能换**。如"第一次装备"必须排在"战斗"之后 ——
 *      这条在 v1.60 之前是靠"序章战斗发一件保底"满足的；用户 2026-09-22 把剧情从引导链路里
 *      摘掉之后（「不要自己单独做个旅程模块的战斗」），保底改由 `freshState()` **开局就发**
 *      （见那里的注释：数值一个字没改，只是提前到手）。顺序本身仍然是硬的：
 *      后面的"穿戴 / 强化"两步全建立在"背包里有那件装备"之上。
 *   ③ **爬塔排在最后，且必须排在解禁点（第一章 1-4）**之前。不是因为叙事，是因为
 *      `story.finished` 一置位，`onboardCurrent` 就**永久**返回 null（见下）。
 *      把爬塔排到 1-4 后面的话，这张表根本轮不到它就被整个关掉了。
 *
 * ── `finished` 一票否决 ────────────────────────────────────────────────
 * 玩家一旦走到解禁点（1-4），这张表**永久**返回 null。老玩家（`sanitizeStoryState`
 * 给他们置了 finished）因此一根汗毛都不会被碰到 —— 这是"只对新号"那条口径的落点。
 */
export interface OnboardStep {
  key: string
  /**
   * `screen` = 整屏内容（序章 / 立誓 / 手册），由 `StoryGate` 渲染；
   * `do` = **页面上的一件事**，由蒙层 `Onboarding` 挖洞高亮出来，玩家只能点它。
   */
  kind: 'screen' | 'do'
  /** `screen` 步骤渲染哪一屏 */
  screen?: StoryGate
  /**
   * `do` 步骤：去哪个页签（与 App.tsx 的 tab id 一致）
   */
  tab?: string
  /**
   * `do` 步骤：跳过去时**顺带选中**哪个东西（走 App 现成的 `navigate(tab, focus)`）。
   *
   * 为什么需要这个：`RosterView` 的右栏在没有选中角色时**根本不渲染**（`selected` 初始为 null），
   * "打坐修炼"那一行就不在屏幕上 —— 蒙层挖不到洞，玩家被卡在一句"点它"上而它不存在。
   * 这不是蒙层的毛病，是那一页在等一个意图；`navigate` 的第二参数本来就是为这件事准备的。
   */
  focus?: string
  /**
   * `do` 步骤：高亮哪个元素。**按顺序找，页面上第一个存在的胜出** ——
   * 最典型的用法是把"打开之后的那个按钮"排在前面、"入口"排在后面：
   * 剧情阅读器开着时高亮底栏主按钮，没开时高亮地图上那一格。
   * 全都找不到时蒙层会退回高亮**页签按钮**（`[data-tab=…]`），把玩家先送到那一页。
   */
  anchors: string[]
  /** 气泡标题 */
  title: string
  /** 气泡正文：一句人话，**说清"点哪里"**，不解释系统 */
  body: string
  /**
   * **这一步不用点任何东西，看着它跑完就行**（蒙层收成一块浅压暗 + 一句说明，不挖洞）。
   *
   * 唯一的用户本来是**剧情战斗**那一格；v1.60 把剧情从引导链路里摘掉之后，
   * **当前这张表里没有任何一步用它** —— 保留是因为"看着它跑完"这件事本身还会回来
   * （任何一步的 `done` 需要等一段自动过程时就是它），删了下次还得重写一遍下面这段坑。
   * 老用法（若哪天真要接回剧情战斗）：按了「开战」之后那几秒是**自动打的**，要到打赢才 `done`。
   * 这期间如果不特殊处理，蒙层会拿这一格的第二个锚点（地图上那一格）去挖洞 ——
   * 而战斗层正盖在它上面，挖出来的洞里是战斗画面、点下去打到的是战斗层。
   * 玩家看到的是一块"说这儿能点、点了没反应"的洞。
   *
   * ⚠️ **它只在"还有人站着"的时候为真**（见 `onboardSteps` 里那一格）。全员脱力之后战斗层
   *    停在原地不回退（见 `storyBattleRound`），那时必须把洞还给「再来一次」——
   *    否则玩家打输了、战斗卡住、蒙层又挡着那颗按钮，**就出不去了**。
   */
  watch?: boolean
  /**
   * **这一步已经开始跑了，结果还没出来** —— 蒙层收成一块浅压暗 + 一句说明，不挖洞。
   *
   * 与 `watch` 的分工：`watch` 认的是**剧情战斗那一层**（`[data-story-battle]` 在不在），
   * 而这个是**任何一步**都可能有的"它自己在跑"，由 `onboardSteps` 从存档状态现算。
   *
   * ⚠️⚠️ 为什么必须有它 —— 2026-09-22 真浏览器实测出来的死锁（用户原话
   *    「第 4 步开始战斗有点问题，**点几下都没反应**」）：
   *    `battle` 这一步的完成判据是"打完一关"（`kills >= 1`），而挂机战斗要 1~2 秒
   *    才打出第一个人头。**这 1~2 秒里蒙层还赖在那颗按钮上**，而它此刻写着
   *    「自动出战中（点击停止）」⇒ 玩家以为"点了没反应"，手再快一点，第二下就落在
   *    **同一颗按钮**上，**把挂机关了** ⇒ `kills` 永远到不了 1 ⇒ 新号**永久卡在第 4 步**。
   *    实测日志：点两下之后 `autoBattle: true → false`，蒙层步仍是 `battle`。
   *
   * 结论（以后复用）：**判据一旦要"等一个过程"，就必须同时把蒙层从"挖洞"切到
   *    "看着它跑"** —— 否则那颗按钮在等待期间仍然可点，而它此刻点下去是反效果。
   */
  running?: boolean
  /**
   * `running` 为真时气泡里那句话。不填就沿用 `body`。
   *
   * ⚠️ 别偷懒照抄 `body`："点它"和"等它跑完"指的不是同一件事 ——
   *    照抄等于继续叫玩家去点那颗**此刻点下去就是反效果**的按钮。
   */
  runningBody?: string
  done: boolean
}

/** 任意一名角色的任意一个槽位上有装备 */
function anyEquipped(state: GameState): boolean {
  return Object.values(state.roster).some(e => Object.values(e.equip ?? {}).some(Boolean))
}

/** 任意一件**已穿戴**的装备被强化过（`lv >= 1`）—— 只认身上那几件，背包里强化的不算 */
function anyEquippedEnhanced(state: GameState): boolean {
  return Object.values(state.roster).some(e =>
    Object.values(e.equip ?? {}).some(it => (it?.lv ?? 0) >= 1))
}

/**
 * 整张表，按顺序。只读 `state`，不写 —— 与 `storyNodes` 同一个路数。
 *
 * ⚠️ v1.60：这张表**只由下面这几条手写步骤组成**，不再掺剧情节点。
 *    用户 2026-09-22 原话：「**旅程也不要了，就只剩蒙层引导**」⇒ 第一章那几格
 *    （1-1 ~ 1-4）**不再是引导步骤**，它们回到普通页签内容里，玩家想去再去。
 *    `story.finished` 仍然是一票否决的解禁点，但它的作用从"关掉剧情那几格"
 *    变成"**整张表到此为止**"（见 `onboardCurrent`）。
 */
export function onboardSteps(state: GameState): OnboardStep[] {
  const st = storyOf(state)

  const steps: OnboardStep[] = [
    { key: 'prologue', kind: 'screen', screen: 'prologue', anchors: [],
      title: '序章', body: '', done: st.prologueAct > PROLOGUE.length },
    { key: 'oath', kind: 'screen', screen: 'enroll', anchors: [],
      title: '立誓', body: '', done: st.enrolled },
    { key: 'handbook', kind: 'screen', screen: 'handbook', anchors: [],
      title: '修行手册', body: '', done: st.handbook },

    // ① 战斗：**挂机主循环**，也是玩家被教的第一件事。
    //    ⚠️ v1.60 起这里**不再经过剧情那一格**。用户 2026-09-22 原话：
    //       「引导去 tab 里面的战斗模块，**不要自己单独做个旅程模块的战斗**」
    //       ⇒ 教的是**战斗页那颗按钮**（「开启自动出战」），与剧情里那场"看的"架无关。
    { key: 'battle', kind: 'do', tab: 'combat',
      anchors: ['[data-onb="battle"]'],
      title: '让战斗自己跑起来',
      body: '点一下开战。之后它会一直替你打，你关掉页面也在打。',
      // ⚠️ 一点下去就必须把蒙层切成"看着它跑"：这颗按钮此刻写着「自动出战中（点击停止）」，
      //    再点一下就是**关掉挂机** —— 玩家"以为没反应"的那第二下正好落在这儿（见 `running` 的注释）。
      running: state.autoBattle && state.kills < 1,
      runningBody: '看着它打完这一关，马上就好。这期间别碰那颗按钮 —— 再点一下是「停止出战」。',
      done: state.kills >= 1 },

    // ② 第一次修炼
    //    ⚠️ `focus` 不能省：阵容页右栏没选中角色时整块不渲染（见 `OnboardStep.focus`）。
    //       给的是**队伍里第一个**（开局那四个人之一），他一定在名录里。
    { key: 'train', kind: 'do', tab: 'roster',
      focus: state.team.front.find(Boolean) ?? Object.keys(state.roster)[0],
      anchors: ['[data-onb="train"]'],
      title: '第一次修炼',
      body: '给一名角色打坐，把等级提上去。',
      done: Object.values(state.roster).some(e => e.level >= 2) },

    // ③ 第一次装备（`freshState()` 开局发的那件就在背包里）
    { key: 'equip', kind: 'do', tab: 'equipment',
      anchors: ['[data-onb="equip"]', '[data-onb="auto-equip"]'],
      title: '穿上第一件装备',
      body: '点「穿戴」，它就会挂到这名角色身上。',
      done: anyEquipped(state) },

    // ④ 装备强化：**两步**（先点开那件装备 → 再点强化）。
    //    锚点顺序就是这两步的先后：详情浮层开着时 `enhance` 在、没开时只有槽位图标在。
    { key: 'enhance', kind: 'do', tab: 'equipment',
      anchors: ['[data-onb="enhance"]', '[data-onb="open-item"]'],
      title: '把装备强化一级',
      // v1.61：用户「提升装备的意义简短讲」⇒ 补一句**为什么**，但只说一句，
      // 不解释系统（浓度对齐这张表其余各步的 body）。
      body: '点开这件装备，再按「强化 +1」。强化把装备词条的加成往上提，是涨战力最直接的一条路。',
      done: anyEquippedEnhanced(state) },

    // ⑤ 活动领奖。⚠️ 见下面 `activityNothingToClaim`：**没奖可领时这一步自动让路** ——
    //    活动是运营配置，配置没下发 / 全是未达标的时候，硬要玩家点一个点不动的按钮就是死锁。
    //    ⚠️ 锚点复用领奖按钮**本来就有的** `data-act-claim`（活动页判据早就挂在那儿），
    //       不再加一个 `data-onb` —— 同一个按钮两个钩子，改了文案没改另一个就该出事。
    //       按钮不可领时是 `disabled`，蒙层挑目标时会跳过禁用元素（见 Onboarding 的 picker）。
    { key: 'activity', kind: 'do', tab: 'activity',
      anchors: ['[data-act-claim]'],
      title: '把能领的奖励领了',
      body: '活动里的奖励过期不补，能领就领掉。',
      done: state.activities.claimed !== undefined && Object.keys(state.activities.claimed).length > 0
        || activityNothingToClaim() },

    // ⑥ 爬塔（放在最后：它是唯一一个"会自己往上打很久"的，收尾用）
    //
    // ⚠️ v1.61：`done` 收窄成**真的打完了一层**。用户 2026-09-22 原话：
    //    「天梯塔也是可以**等打完一关再跳下一步**」。
    //    原来那个 `autoLab || !!battle` 是**一点就过** —— 玩家刚点下「开始爬塔」，
    //    蒙层就跳走了，那一课等于没上（与 `battle` 那步原来"没打完就等着"是同一类毛病，
    //    只是方向相反：那边等太久，这边不等）。
    // ⚠️ 收窄带来一个新的死锁，必须同时兜住：爬塔战败时 `autoLab` **不会自己关**
    //    （只有玩家主动 `retreatLab` 才置 false），tick 会一直重开下一场 ⇒
    //    "打不过第 1 层"的新号会永远停在 `battle: null / highestFloor: 0 / autoLab: true`，
    //    而蒙层又挡着他去点撤退。这一条由**蒙层那边的"跑太久就永久让路"**兜
    //    （见 `Onboarding` 的 `RUNNING_GIVEUP_MS`）：它跨本地/远程两种模式一致
    //    （不依赖引擎实例的内存态，远程模式下客户端那个实例根本收不到战败事件），
    //    不用新增存档字段，也不会把玩家关死。
    { key: 'lab', kind: 'do', tab: 'lab',
      anchors: ['[data-onb="lab-start"]'],
      title: '去爬天梯塔',
      body: '点「开始爬塔」，它会一层层往上打。',
      running: (state.lab.autoLab || !!state.lab.battle) && state.lab.highestFloor < 1,
      runningBody: '等它打完第一层，它会自己往上走。这期间别碰那颗按钮 —— 再点一下是「停止爬塔」。',
      done: state.lab.highestFloor >= 1 },
  ]
  return steps
}

/**
 * 活动那一步该不该**自动让路**。
 *
 * 它是这张表里唯一一步"能不能做取决于**运营配置**"的：活动清单是服务端下发的，
 * 而"有没有可领的"取决于当下有没有配签到类活动、任务类达标没有。
 * 强制引导里放一个**玩家无论怎么点都过不去**的步骤，等于把新号关在蒙层里出不来 ——
 * 比"少教一件事"严重得多。
 *
 * 判据只看**可领数**（`claimableCount`，与页签上那个小红点同源）：
 * 清单还没拉回来 / 一条能领的都没有 ⇒ 这一步直接算过。
 * ⚠️ 已经领过的不算"没事可做"的判据 —— 领过本身就是 `done` 的另一半。
 *
 * ⚠️ **不收 `state`**：答案只取决于"这一刻有没有奖可领"，而那个数在引擎实例上
 *    （`remoteActivities` 是内存态，存档里没有它）。收一个用不到的 `state` 进来，
 *    只会让下一个读这段的人以为答案和存档有关。
 */
function activityNothingToClaim(): boolean {
  try { return game.claimableCount() === 0 } catch { return true }
}

/** 当前该做的那一步（第一个没完成的）。全部走完 / 已解禁 ⇒ null */
export function onboardCurrent(state: GameState): OnboardStep | null {
  const st = storyOf(state)
  // 一票否决：走过解禁点的人**永久**放行，哪怕存档被手改成"没走完"的形状
  if (st.finished) return null
  return onboardSteps(state).find(s => !s.done) ?? null
}


// ─── 新手引导 / 第一章剧情：只读选择器 ───────────────────────────────────
//
// 这一组全部是**纯函数**（只读 state，不写），和 `onboardSteps` 同一个路数：
// 组件不许自己判"这个节点能不能打"，一律来这里问 —— 判据写两份必然漂，
// 而剧情卡在"点了没反应"是最难排查的一类 bug（案例里那个"姓名不填就没反应"
// 是**故意**的，我们的必须是**唯一一处**故意的）。

/** 现在必须挡住玩家的那一道门。`null` = 不挡，玩家自由活动。 */
export type StoryGate = 'prologue' | 'enroll' | 'handbook' | 'chapter'

/**
 * 现在有没有**一整屏内容**要放（序章 / 立誓 / 手册）。`null` = 没有，自由活动。
 *
 * ── v1.58 起它只是 `onboardSteps` 的一个投影 ────────────────────────────
 * 以前这道门自己判四票（序章 / 立誓 / 手册 / 第一章，见 v1.55d 的注释），
 * 而"第一章那一票"与 `NewbiePath` 那条常驻条是**两套并存**的引导 ——
 * 用户 2026-09-22 要求把它们收成一条蒙层流水线（原话见 `OnboardStep`），
 * 于是判断只剩一处：**当前那一步是不是 `kind: 'screen'`**。
 *
 * ⚠️ **`finished` 一票否决仍然成立**，只是搬进了 `onboardCurrent`：玩家一旦过了解禁点，
 *    整张表永久返回 null，哪怕存档被手改回"没走完"的形状。
 *    ⚠️ 解禁点仍是 `claimStoryNode('1-4')` 置位的 `finished` —— 它是**服务端权威通道**
 *    上唯一那个"引导结束"的写入口（见 GameState.story 的注释），别在客户端另加一个。
 */
export function storyGate(state: GameState): StoryGate | null {
  // v1.58：**这张门不再自己判**，它退化成了引导步骤表的一个投影 ——
  // "现在有没有一整屏内容要放" = 当前那一步是不是 `kind: 'screen'`。
  //
  // ⚠️ 名字与返回值都**保持原样**：服务端在用它（`server.js` 的 `engStory.gate`，
  //    军师要拿它说"你还在新手引导里、先去把剧情过了"），改签名会让那条链路静默失效
  //    —— 而 server.js 每句引擎 require 都裹着 try/catch，失效的表现是**接口照常 200、
  //    只是问什么都答不到点上**（红线 150：这类"沉默的能力缺失"是本项目最难查的一种）。
  const cur = onboardCurrent(state)
  return cur && cur.kind === 'screen' ? (cur.screen ?? null) : null
}

export interface StoryNodeView extends StoryNode {
  /** 玩家已经领过这个节点 */
  done: boolean
  /** 前置没走完 ⇒ 卡片上显示「待开放」，点不进去 */
  locked: boolean
  /**
   * 条件已满足、**现在就能打/能读** —— 等同于「前置都做完了」。
   *
   * ⚠️ 对话和战斗**在这一点上完全一样**，没有战力门槛。以前 `auto`/`boss` 类多一条
   *    "主线要打到第 N 关"，那条已在 v1.55 拆掉（理由见 `storyNodeState`）。
   *    所以 `ready === !locked`，留着 `ready` 这个字段是因为 UI 上它和 `locked`
   *    是两个不同的空状态（"待开放" vs "现在可做"），合并会让组件那边的判断变得难读。
   */
  ready: boolean
}

/** 节点的开放判定 —— **引擎与 UI 共用这一处**，服务端校验时走的也是它 */
function storyNodeState(node: StoryNode, st: StoryState): { done: boolean; locked: boolean; ready: boolean } {
  const done = st.done.includes(node.id)
  // 前置：`requires` 里有一个没做完，就是「待开放」。空数组 = 无条件开放
  const locked = node.requires.some(r => !st.done.includes(r))
  // ⚠️ 这里**曾经有一条主线关卡门槛**（`highestStage > node.stage`），v1.55 拆掉了。
  //
  // 用户 2026-09-22：「剧情的战斗不和主线战斗耦合」。那条门槛是耦合最硬的一处 ——
  // 它把"剧情能推到哪"直接绑在"主线打到第几关"上，于是：
  //   · 把主线推到 60 关的人回来打第一幕，打的是 60 关数值的敌人 ——
  //     而这一幕的戏是"萧炎还是个三段的废物、被族人按在地上打"，数值和台词对不上；
  //   · 卡在第 3 关的人**永远做不完第一章**，而剧情恰恰是那批人最该看的东西。
  // 现在剧情只认 `requires`（前一格做没做），战斗强度由 `node.combat.power` 自己定，
  // 与玩家的主线进度无关。代价是"练度不够会打不过" —— 那正是剧情战斗该有的样子。
  return { done, locked, ready: !locked }
}

export function storyNodes(state: GameState): StoryNodeView[] {
  return CHAPTER1.map(n => ({ ...n, ...storyNodeState(n, storyOf(state)) }))
}

/**
 * 取这份状态的剧情进度，**兜底一份全新的**。
 *
 * 为什么需要兜底：`state.story` 只可能从 `freshState()` / `migrate()` 两条路进来，两条都给了值，
 * 所以正常运行时它一定在。但**服务端宿主、离线脚本、旧版本写下的本机缓存**都可能塞进来一个
 * 没有这个字段的对象（2026-09-18 那次 `/save` 兼容期就是这么翻车的）。
 * 剧情读不到时崩整个页面，是最不值得的一种崩法 —— 兜底成"从头开始"顶多多看一遍序章。
 */
function storyOf(state: GameState): StoryState {
  return state.story ?? freshStoryState()
}

/** 当前该做的那个节点：第一个「前置完成但还没领」的。全领完了返回 null */
export function storyCurrent(state: GameState): StoryNodeView | null {
  return storyNodes(state).find(n => n.ready && !n.done) ?? null
}

export function storyProgress(state: GameState): { done: number; total: number } {
  const total = CHAPTER1.length
  const set = new Set(storyOf(state).done)
  return { done: CHAPTER1.filter(n => set.has(n.id)).length, total }
}

/** 第一章的四幕（起承转合）。章节地图按它分组渲染 */
export function storyActs(): StoryAct[] { return CHAPTER1_ACTS }

export interface StoryActView extends StoryAct {
  /** 这一幕有几格 */
  total: number
  /** 做完了几格 */
  done: number
  /** 这一幕整个做完了 */
  cleared: boolean
  /** 现在该做的就是这一幕的（UI 上高亮那一组，其余压暗） */
  active: boolean
}

/**
 * 分幕进度 —— 章节地图的分组渲染**只认这一处**。
 *
 * 为什么不让组件自己 `filter(n => n.act === a.no)`：那样"某一幕是空的"
 * （删节点之后很容易出现）会被渲染成一个空标题条，而组件自己没有依据判断
 * "这一幕该不该显示" —— 只有把 total 一起算出来，那一幕才藏得掉。
 */
export function storyActViews(state: GameState): StoryActView[] {
  const nodes = storyNodes(state)
  const cur = nodes.find(n => n.ready && !n.done)
  return CHAPTER1_ACTS.map(a => {
    const mine = nodes.filter(n => n.act === a.no)
    const done = mine.filter(n => n.done).length
    return {
      ...a,
      total: mine.length,
      done,
      cleared: mine.length > 0 && done === mine.length,
      active: cur !== undefined && cur.act === a.no,
    }
  })
}

/** 进行中的剧情战斗（没有则 null）。UI 据此决定要不要显示战斗层 */
export function storyBattleOf(state: GameState): StoryBattleState | null {
  return state.storyBattle ?? null
}

/** 序章全部幕（组件按 `story.prologueAct` 取当前那一幕） */
export function prologueActs(): PrologueAct[] { return PROLOGUE }

/**
 * 手册五步。**带完成判定**，判定**全部转问 `onboardSteps`**。
 *
 * ⚠️ 别在这儿自己再数一遍（"看 registered / 看阵容坐了几个人"）：手册是引导路线的
 *    **目录**，它和后面的路线是同一件事的两张皮 —— 各判各的，一定会漂，
 *    而漂出来的现象是"手册上打着勾、下一页的蒙层还拦着你不放"，最难解释的一种。
 *
 * 落点靠 `HANDBOOK[i]` 与 `HANDBOOK_KEYS[i]` **同序**对应（story.ts 那边有注释盯着）。
 * 判据取不到（这一步不在当前表里，例如老玩家 `finished` 之后表整体返回 null）
 * ⇒ **算完成**：手册只对新号展示，老号那几页不该挂着红点。
 */
const HANDBOOK_KEYS = ['oath', 'node:0-1', 'battle', 'train', 'equip'] as const

export function handbookSteps(state: GameState): (HandbookStep & { done: boolean })[] {
  const byKey = new Map(onboardSteps(state).map(s => [s.key, s.done]))
  return HANDBOOK.map((h, i) => ({ ...h, done: byKey.get(HANDBOOK_KEYS[i]) ?? true }))
}

/**
 * 一段剧本，`{name}` 已替换。名字取不到就回落到「你」——台词里空着比写错强。
 *
 * 签名里**不带 state**：剧本是纯数据（story.ts 的 SCRIPTS），跟玩家进度无关。
 * 带个 state 进来只会让调用方以为"台词会随进度变"，那是另一套设计，这里没有。
 */
export function storyScript(nodeId: string, playerName: string): ScriptLine[] {
  const lines = SCRIPTS[nodeId]
  if (!lines) return []
  const nm = playerName.trim() || '你'
  return lines.map(l => ({ ...l, who: l.who.replace(/\{name\}/g, nm), text: l.text.replace(/\{name\}/g, nm) }))
}

/** 这个节点有没有剧本（`story` 类节点才有）。给组件判断"点进去是读对话还是去打架" */
export function hasScript(nodeId: string): boolean {
  return (SCRIPTS[nodeId]?.length ?? 0) > 0
}

/** 解禁点（组件要拿它做"引导将在这一格结束"的提示） */
export function storyUnlockNode(): string { return STORY_UNLOCK_NODE }

export interface NewbieStep {
  key: 'battle' | 'train' | 'recruit'
  spr: string
  text: string
  tab: 'combat' | 'roster' | 'recruit'
  done: boolean
  ready: boolean
  hint?: string
  action: string
  focus?: string
}

export function newbieSteps(state: GameState): NewbieStep[] | null {
  const battleDone = state.kills >= 1
  const trainDone = Object.values(state.roster).some(entry => entry.level >= 2)
  const pulled = Object.keys(state.roster).length > STARTER_IDS.length
    || (state.inventory.essence ?? 0) > 0
    || (state.inventory.shard ?? 0) > 0
    || state.pityTian > 0 || state.pityQuasi > 0 || state.pitySheng > 0

  if (battleDone && trainDone && pulled) return null

  const focus = state.team.front.find(Boolean) ?? state.team.back.find(Boolean) ?? Object.keys(state.roster)[0]
  const entry = focus ? state.roster[focus] : undefined
  const crystal = Math.floor(state.inventory.crystal ?? 0)
  const need = entry ? xpToNext(entry.level) : 0
  const dan = Math.floor(state.inventory.yuanfen ?? 0)

  return [
    {
      key: 'battle', spr: 'blessings/sword', tab: 'combat',
      text: '点一下开战，先赢下一场', done: battleDone, ready: true,
      action: state.autoBattle ? '自动出战中…' : '开启自动出战',
    },
    {
      key: 'train', spr: 'icons/crystal', tab: 'roster',
      text: '用斗气结晶给一名角色打坐修炼，升到 2 级', done: trainDone,
      ready: Boolean(entry) && crystal >= need,
      hint: entry && crystal < need ? `斗气结晶 ${crystal}/${need} · 挂机自动累积` : undefined,
      action: entry ? `去给${CHAR_MAP[focus]?.name ?? '他'}修炼` : '去阵容页', focus,
    },
    {
      key: 'recruit', spr: 'icons/yuanfen', tab: 'recruit',
      text: '去招募抽一次，看能遇到谁', done: pulled,
      ready: dan >= 1,
      hint: dan < 1 ? `缘分丹 ${dan}/1 · 每 5 关首领首通给 1 颗` : undefined,
      action: dan >= 10 ? '去招募（十连必出天阶）' : '去招募',
    },
  ]
}

export function newbieCurrent(state: GameState): NewbieStep | null {
  return newbieSteps(state)?.find(step => !step.done) ?? null
}

export function nextGuides(state: GameState): Guide[] {
  const out: Guide[] = []

  if (state.farmStage === null) {
    if (state.wipeStreak >= 2) {
      out.push({ kind: 'stuck', text: `连续卡在第 ${state.stage} 关 ${state.wipeStreak} 次了，去「选择关卡」回旧关练级或强化队伍`, tab: 'roster' })
    } else if (state.battle && Date.now() - state.lastProgressAt > 3 * 60 * 1000) {
      // 僵持卡关：伤害有 1 点保底、治疗又抵得住反击，于是既打不死也死不了，
      // wipeStreak 恒为 0 —— 这是后期最难受的状态，但原先完全不给任何提示
      const mins = Math.floor((Date.now() - state.lastProgressAt) / 60000)
      out.push({ kind: 'stalemate', text: `第 ${state.stage} 关磨了 ${mins} 分钟没推进，去「选择关卡」回旧关练级再回来`, tab: 'roster' })
    }
  }

  // 有角色卡在突破口，且丹药不够
  for (const id of Object.keys(state.roster)) {
    const entry = state.roster[id]
    if (needsPillFor(entry.level) && entry.xp >= xpToNext(entry.level)) {
      const grade = pillGradeFor(entry.level)
      const have = state.inventory[`pill${grade}`] ?? 0
      if (have < 1) {
        out.push({ kind: 'pill', spr: `icons/pill${grade}`, text: `${CHAR_MAP[id]?.name ?? id} 卡在突破口，需要 ${grade} 品丹药，去商城丹房炼一颗`, tab: 'shop' })
        break
      }
    }
  }

  const crystal = state.inventory.crystal ?? 0
  if (crystal >= 150) {
    out.push({ kind: 'crystal', spr: 'icons/crystal', text: `攒了 ${Math.floor(crystal)} 点斗气结晶还没用，去阵容页给角色打坐修炼`, tab: 'roster' })
  }

  const yuanfen = state.inventory.yuanfen ?? 0
  if (yuanfen >= 5) {
    out.push({ kind: 'yuanfen', spr: 'icons/yuanfen', text: `攒了 ${yuanfen} 颗缘分丹，去招募抽个新武将说不定能带飞`, tab: 'recruit' })
  }

  const herb = state.inventory.herb ?? 0
  const coin = state.inventory.coin ?? 0
  // ⚠️ 判据用 `kind`，不是图标 —— 见 `GuideKind` 的注释：比字符串的老写法会被图标升级静默打断
  if (out.every(g => g.kind !== 'pill')) {
    for (const pill of PILLS) {
      const cost = pillCraftCost(pill.grade)
      if (herb >= cost.herb && coin >= cost.coin && (state.inventory[pill.id] ?? 0) < 1) {
        out.push({ kind: 'craft', spr: `icons/pill${pill.grade}`, text: `灵药灵金够炼一颗${pill.name}了，去商城丹房备着`, tab: 'shop' })
        break
      }
    }
  }

  return out.slice(0, 3)
}

export { CHAR_MAP }
