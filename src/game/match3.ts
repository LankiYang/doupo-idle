// 消消乐（三消）引擎：纯逻辑、无 React、无网络 —— 可以单独跑测试。
//
// 为什么单独一个文件而不是塞进 WorldBossView：三消的"什么算有效交换""连锁怎么结算"
// 是**规则**，规则错了（比如允许一次无效交换白嫖、或者连锁漏算一拍）界面是看不出来的，
// 只会表现为"分数偶尔不对"。规则要能被独立测。
//
// 盘面用一维数组表示（`y * MATCH_W + x`），空格用 -1 占位。
// 一维的好处：整个盘面是个纯值，交换/消除/掉落全是 slice 出来的新数组 ——
// 没有共享可变状态，React 那边直接 setState 就行，也不会被上一帧的引用污染。
//
// v1.40 起多了**两层**，都与盘面**同构等长**、下标一一对应：
//   `Specials` 特殊块层（0 = 普通块，见下）—— 规则的一部分，归引擎管；
//   `Ids` = 块的身份（第几号块）—— **不是规则**，只是给界面做位移动画的坐标锚。
//   身份层刻意放在引擎里、与 `src` 一起返回：掉落时"哪块掉到哪儿"只有结算过程自己知道，
//   让界面去猜（比对前后盘面找同色）在连锁里必然猜错。

export const MATCH_W = 6
export const MATCH_H = 6
/** 4 色。色数越少越容易连锁，也越容易一眼看出能消哪里 —— 休闲玩法取少不取多 */
export const MATCH_COLORS = 4

export type Board = number[]
export type Rng = () => number

// ── 特殊块 ────────────────────────────────────────────────────────────────
// 用户原话：「优化一些消消乐的道具 你知道的比如什么特殊块 消掉可以清空一行之类的」。
//
// 三条规则，都是从"连成什么形状"来的（没有随机、没有商店、不占存档）：
//   4 连（横）→ 横消：**清掉整行**
//   4 连（竖）→ 竖消：**清掉整列**
//   5 连 / L 形 / T 形 → 爆破：清掉周围 3×3
// 生成的位置优先落在"你刚推过去的那一格"（`c`）—— 特殊块出现在手底下，才连得上因果。
//
// ⚠️ 特殊块**保留自己的颜色**（不是中立块）：它还能被后续的三连卷进去，卷进去就炸。
//    这条让连锁的期望收益上去了 —— **等于改了"每次交换平均消掉几格"这把标尺**，
//    详见文件末尾 MATCH_DAMAGE_PER_TILE 那段。改特殊块强度时要连标尺一起想。
export const SP_NONE = 0
export const SP_ROW = 1
export const SP_COL = 2
export const SP_BOMB = 3
export type Specials = number[]

/** 一个没有任何特殊块的层。**每次都要新建**，别共享同一个数组（会被就地改） */
export const newSpecials = (): Specials => new Array(MATCH_W * MATCH_H).fill(SP_NONE)

/** 块的身份层：`Ids[i]` 是此刻站在第 i 格的"第几号块" */
export type Ids = number[]

export interface MatchGroup {
  /** 这一组涉及的格子（已去重） */
  cells: number[]
  /** 组内的横向连子 / 纵向连子。用来判形状（4 连是横是竖、是不是 L/T 形） */
  hRuns: number[][]
  vRuns: number[][]
}

export interface MatchStep {
  /** 这一拍消掉的格子下标 */
  cleared: number[]
  /** 消掉并掉落补位之后的盘面（界面拿它做逐帧播放） */
  after: Board
  /** 这一拍之后的特殊块层 */
  specialsAfter: Specials
  /**
   * 掉落轨迹：`src[dest]` = 落到 dest 的那块**掉落前**在哪一格，-1 = 这是顶部新补的块。
   * 界面靠它把身份层搬对位置；身份搬错的表现是"两个块叠在一起/一块闪一下"，
   * 而且只在有掉落的那几帧看得见 —— 必须有断言守着（见 verify-match3-special.cjs）。
   */
  src: number[]
}
export interface SwapResult {
  /** 交换后、**还没结算**的盘面。界面拿它做第一帧，否则玩家看不到自己换的那一下 */
  swapped: Board
  /** 全部连锁结算完的最终盘面 */
  board: Board
  steps: MatchStep[]
  /** 连锁拍数：第一拍 = 1，掉下来又凑成三连 = 2 …… */
  combo: number
  /** 总共消掉多少格（伤害就是按它算的） */
  tiles: number
  /** 计分 = Σ(每拍格数 × 拍数)。只用于界面显示，伤害不直接用它 */
  score: number
}
export interface SwapResultEx extends SwapResult {
  /** 交换后、还没结算的特殊块层 */
  swappedSpecials: Specials
  /** 结算完的特殊块层 */
  specials: Specials
  /** 这一局里**新生成**的特殊块（界面拿它放生成特效、播生成音） */
  created: { at: number; kind: number; combo: number }[]
}

const idx = (x: number, y: number) => y * MATCH_W + x

/** 邻接判定：只能换上下左右，斜着不算 */
export function isAdjacent(a: number, b: number): boolean {
  const ax = a % MATCH_W, ay = Math.floor(a / MATCH_W)
  const bx = b % MATCH_W, by = Math.floor(b / MATCH_W)
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1
}

function randColor(rng: Rng): number {
  return Math.min(MATCH_COLORS - 1, Math.floor(rng() * MATCH_COLORS))
}

/**
 * 找出盘面上所有的连通组：**3 连及以上的横/竖连子**，以及**共享格子的连子合并成的组**。
 *
 * 合并这一步不是可选的：L 形、T 形、十字都是"两个连子共用一个格子"，
 * 不合并的话十字交叉处会被当成两组各消一遍（伤害凭空翻倍），而且形状判不出 L/T。
 *
 * 这是"什么算一组"的**唯一一处**实现 —— findMatches 就是它的去平铺版本，
 * 免得"哪算三连"的规则在两处各写一遍、改一处忘一处。
 */
export function findGroups(b: Board): MatchGroup[] {
  const runs: { cells: number[]; horiz: boolean }[] = []
  // 横向连子
  for (let y = 0; y < MATCH_H; y++) {
    let run = 1
    for (let x = 1; x <= MATCH_W; x++) {
      const v = x < MATCH_W ? b[idx(x, y)] : -2   // 收尾用一个不存在的值，逼出最后一拍
      const same = v >= 0 && v === b[idx(x - 1, y)]
      if (same) { run++; continue }
      if (run >= 3) {
        const cells: number[] = []
        for (let k = x - run; k < x; k++) cells.push(idx(k, y))
        runs.push({ cells, horiz: true })
      }
      run = 1
    }
  }
  // 纵向连子
  for (let x = 0; x < MATCH_W; x++) {
    let run = 1
    for (let y = 1; y <= MATCH_H; y++) {
      const v = y < MATCH_H ? b[idx(x, y)] : -2
      const same = v >= 0 && v === b[idx(x, y - 1)]
      if (same) { run++; continue }
      if (run >= 3) {
        const cells: number[] = []
        for (let k = y - run; k < y; k++) cells.push(idx(x, k))
        runs.push({ cells, horiz: false })
      }
      run = 1
    }
  }
  // 共享格子的连子并成一组（并查集，连子最多十几个，用不上优化）
  const parent = runs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const owner = new Map<number, number>()
  runs.forEach((r, i) => {
    for (const cell of r.cells) {
      const o = owner.get(cell)
      if (o === undefined) owner.set(cell, i)
      else parent[find(i)] = find(o)
    }
  })
  const groups = new Map<number, MatchGroup>()
  runs.forEach((r, i) => {
    const root = find(i)
    let g = groups.get(root)
    if (!g) { g = { cells: [], hRuns: [], vRuns: [] }; groups.set(root, g) }
    for (const cell of r.cells) if (!g.cells.includes(cell)) g.cells.push(cell)
    ;(r.horiz ? g.hRuns : g.vRuns).push(r.cells)
  })
  return [...groups.values()]
}

/**
 * 找出盘面上所有 3 连及以上的格子。返回**去重后的下标**（十字交叉处会被横竖各算一次，
 * 不去重的话伤害会凭空翻倍）。
 */
export function findMatches(b: Board): number[] {
  const hit = new Set<number>()
  for (const g of findGroups(b)) for (const c of g.cells) hit.add(c)
  return [...hit]
}

/** 消除 + 上方掉落 + 顶部补新。返回新盘面，不动入参 */
export function collapse(b: Board, cleared: number[], rng: Rng): Board {
  return collapseTracked(b, newSpecials(), cleared, rng).board
}

/**
 * 与 `collapse` 同一套掉落规则，但**顺带把特殊块层和掉落轨迹一起搬对位置**。
 *
 * 三个数组必须**逐格同步**地搬：只搬盘面不搬特殊块，后果是"清了一行之后场上的特殊块
 * 全跑到别的格子上去了"（玩家眼里就是"我的炸弹自己走了"）。
 */
function collapseTracked(b: Board, sp: Specials, cleared: number[], rng: Rng)
  : { board: Board; specials: Specials; src: number[] } {
  const out = b.slice()
  const outSp = sp.slice()
  const src = new Array(b.length).fill(-1)
  for (const i of cleared) { out[i] = -1; outSp[i] = SP_NONE }
  for (let x = 0; x < MATCH_W; x++) {
    let write = MATCH_H - 1
    for (let y = MATCH_H - 1; y >= 0; y--) {
      const from = idx(x, y)
      const v = out[from]
      if (v >= 0) {
        const dest = idx(x, write)
        out[dest] = v
        outSp[dest] = outSp[from]
        src[dest] = from
        write--
      }
    }
    // 剩下的空位全在顶部，补新色。**必须倒着写**，否则 write 会和自己刚写的格子打架
    for (let y = write; y >= 0; y--) {
      const dest = idx(x, y)
      out[dest] = randColor(rng)
      outSp[dest] = SP_NONE
      src[dest] = -1
    }
  }
  return { board: out, specials: outSp, src }
}

/** 这个组该生成什么特殊块（返回 SP_NONE 表示不生成，就是普通三连） */
export function specialKindOf(g: MatchGroup): number {
  const hMax = g.hRuns.reduce((n, r) => Math.max(n, r.length), 0)
  const vMax = g.vRuns.reduce((n, r) => Math.max(n, r.length), 0)
  // L 形 / T 形 / 十字：横竖各有连子，交叉点那个格子最该炸
  if (hMax >= 3 && vMax >= 3) return SP_BOMB
  if (g.cells.length >= 5) return SP_BOMB
  if (hMax >= 4) return SP_ROW
  if (vMax >= 4) return SP_COL
  return SP_NONE
}

/** 特殊块落在哪一格：优先"你刚推过去的那一格"，其次 L/T 的交叉点，最后组中间 */
function specialCellOf(g: MatchGroup, a: number, c: number): number {
  if (g.cells.includes(c)) return c
  if (g.cells.includes(a)) return a
  for (const h of g.hRuns) for (const cell of h) if (g.vRuns.some(v => v.includes(cell))) return cell
  return g.cells[Math.floor(g.cells.length / 2)]
}

/** 特殊块引爆的范围（含它自己那一格） */
export function blastCells(i: number, kind: number): number[] {
  const x = i % MATCH_W, y = Math.floor(i / MATCH_W)
  const out: number[] = []
  if (kind === SP_ROW) {
    for (let k = 0; k < MATCH_W; k++) out.push(idx(k, y))
  } else if (kind === SP_COL) {
    for (let k = 0; k < MATCH_H; k++) out.push(idx(x, k))
  } else if (kind === SP_BOMB) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && nx < MATCH_W && ny >= 0 && ny < MATCH_H) out.push(idx(nx, ny))
      }
    }
  }
  return out
}

/** 这一拍里被"卷进去"的特殊块连锁引爆，把范围扩进 cleared */
function expandBlasts(sp: Specials, seeds: number[]): Set<number> {
  const hit = new Set<number>(seeds)
  const queue = [...seeds]
  while (queue.length) {
    const i = queue.pop()!
    const kind = sp[i]
    if (!kind) continue          // 普通块：它自己消掉就完了，不扩范围
    for (const j of blastCells(i, kind)) {
      if (!hit.has(j)) { hit.add(j); queue.push(j) }
    }
  }
  return hit
}

/** 从某格出发把整条连锁结算干净。返回每一步的中间盘面，供界面逐帧播 */
function resolveEx(from: Board, fromSp: Specials, forced: number[] | null, a: number, c: number, rng: Rng)
  : { board: Board; specials: Specials; steps: MatchStep[]; combo: number; tiles: number; score: number; created: { at: number; kind: number; combo: number }[] } {
  const steps: MatchStep[] = []
  const created: { at: number; kind: number; combo: number }[] = []
  let cur = from, sp = fromSp, combo = 0, tiles = 0, score = 0
  let seeds = forced
  // 上限只是防御性的：正常盘面连锁不会超过十几拍，无限循环说明规则写错了
  while (combo < 50) {
    const matched = findMatches(cur)
    if (!matched.length && !seeds) break
    combo++
    // 这一拍要消的种子 = 自然凑成的三连 + 强制引爆（交换特殊块的那两格）
    const seedAll = seeds ? [...new Set([...matched, ...seeds])] : matched
    seeds = null
    const hit = expandBlasts(sp, seedAll)
    // 生成新的特殊块：只看**自然连成的组**（引爆不生成，否则一行炸一行、停不下来），
    // 且那个格子本来没有特殊块（有的话这一拍该做的是把它引爆，不是覆盖掉）
    const nsp = sp.slice()
    for (const g of findGroups(cur)) {
      const kind = specialKindOf(g)
      if (!kind) continue
      const at = specialCellOf(g, a, c)
      if (sp[at] !== SP_NONE || !hit.has(at)) continue
      hit.delete(at)                       // 它不消，就地变成特殊块
      nsp[at] = kind
      created.push({ at, kind, combo })
    }
    const cleared = [...hit]
    tiles += cleared.length
    score += cleared.length * combo
    const nx = collapseTracked(cur, nsp, cleared, rng)
    cur = nx.board; sp = nx.specials
    steps.push({ cleared, after: cur, specialsAfter: sp, src: nx.src })
  }
  return { board: cur, specials: sp, steps, combo, tiles, score, created }
}

/** 这次交换能不能消掉东西（不能就是无效交换，界面要弹回去） */
export function swapWouldMatch(b: Board, a: number, c: number): boolean {
  if (!isAdjacent(a, c)) return false
  const t = b.slice()
  const tmp = t[a]; t[a] = t[c]; t[c] = tmp
  return findMatches(t).length > 0
}

/**
 * 带上特殊块看这步能不能换。
 *
 * ⚠️ 与 `swapWouldMatch` **必须分开**：那个是"换完凑不凑得出三连"的纯色判据，
 *    是公开契约（回归脚本拿它当"有效步"的判据），不能悄悄把特殊块的规则塞进去 ——
 *    特殊块换任何相邻块都算有效（交换即引爆），它是**另一条规则**。
 */
export function canSwapEx(b: Board, sp: Specials, a: number, c: number): boolean {
  if (!isAdjacent(a, c)) return false
  if (sp[a] !== SP_NONE || sp[c] !== SP_NONE) return true
  return swapWouldMatch(b, a, c)
}

function swapArr<T>(arr: T[], a: number, c: number): T[] {
  const t = arr.slice()
  const tmp = t[a]; t[a] = t[c]; t[c] = tmp
  return t
}

/**
 * 交换两个相邻格并结算（带特殊块）。
 * 无效交换（不相邻 / 换完凑不出三连 / 两边都不是特殊块）返回 null。
 */
export function trySwapEx(b: Board, sp: Specials, a: number, c: number, rng: Rng = Math.random): SwapResultEx | null {
  if (!canSwapEx(b, sp, a, c)) return null
  const t = swapArr(b, a, c)
  const tsp = swapArr(sp, a, c)
  // 两个格子里只要有特殊块，交换本身就是"点火"：这两格一定会被卷进第一拍
  const forced = (sp[a] !== SP_NONE || sp[c] !== SP_NONE) ? [a, c] : null
  return { swapped: t, swappedSpecials: tsp, ...resolveEx(t, tsp, forced, a, c, rng) }
}

/**
 * 交换两个相邻格并结算（**不带特殊块**的那条老路）。
 * 无效交换返回 null —— 调用方据此把格子弹回原位。
 *
 * 这是给"规则单测"用的公开契约：喂进来的盘面没有特殊块层，行为与 v1.39 逐字一致。
 * 界面走的是 `trySwapEx`。
 */
export function trySwap(b: Board, a: number, c: number, rng: Rng = Math.random): SwapResult | null {
  return trySwapEx(b, newSpecials(), a, c, rng)
}

/** 盘面上还有没有能消的一步。没有了就得重排，不然玩家对着死盘干瞪眼 */
export function hasMove(b: Board): boolean {
  for (let y = 0; y < MATCH_H; y++) {
    for (let x = 0; x < MATCH_W; x++) {
      const i = idx(x, y)
      if (x + 1 < MATCH_W && swapWouldMatch(b, i, idx(x + 1, y))) return true
      if (y + 1 < MATCH_H && swapWouldMatch(b, i, idx(x, y + 1))) return true
    }
  }
  return false
}

/**
 * 界面用的"还有能走的一步吗"：**场上有特殊块就一定有解**（特殊块换任一相邻块都能引爆）。
 * 拿纯色判据去判会把"只剩一个炸弹、四周全是死色"的盘判成死盘、然后白白重排整盘。
 */
export function hasMoveEx(b: Board, sp: Specials): boolean {
  if (sp.some(k => k !== SP_NONE)) return true
  return hasMove(b)
}

/**
 * 生成一个盘面，保证**不含任何现成三连**。
 *
 * 逐格填、每格避开"会和左边两格或上边两格连成三个"的颜色。4 色时最多被禁两色，
 * 可选颜色恒 ≥ 2，所以一次就能填满，不需要回头修补。
 *
 * ⚠️ 这里**不能**用"随机填 → 不合格就整盘重来"：4 色 6×6 单次生成无三连的概率只有
 * 几个百分点（72 个三连窗口、每个约 1/16），重试 60 次仍有约 1% 的概率全军覆没 ——
 * 一旦走到兜底分支就会返回一张**没校验过**的盘面，表现为"玩家一进页面盘面自己就消了"。
 * 这个 bug 是单测里 300 次开局出现 4 次才被抓出来的，肉眼绝对看不见。
 */
function fillBoard(rng: Rng): Board {
  const b: Board = new Array(MATCH_W * MATCH_H).fill(0)
  for (let y = 0; y < MATCH_H; y++) {
    for (let x = 0; x < MATCH_W; x++) {
      const ban = new Set<number>()
      if (x >= 2 && b[idx(x - 1, y)] === b[idx(x - 2, y)]) ban.add(b[idx(x - 1, y)])
      if (y >= 2 && b[idx(x, y - 1)] === b[idx(x, y - 2)]) ban.add(b[idx(x, y - 1)])
      const pool: number[] = []
      for (let c = 0; c < MATCH_COLORS; c++) if (!ban.has(c)) pool.push(c)
      b[idx(x, y)] = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
    }
  }
  return b
}

/**
 * 开一个新盘面：**没有现成三连**（否则玩家还没动手盘面自己就消了），且**有可走的一步**
 * （否则开局就是死盘）。
 *
 * "有解"这一条没法在生成时顺带保证，只能生成完再看一眼 —— 好在死盘极罕见
 * （4 色 6×6 随机两万张里一张都没有），重试几次必然能拿到。
 */
export function newBoard(rng: Rng = Math.random): Board {
  for (let t = 0; t < 50; t++) {
    const b = fillBoard(rng)
    if (hasMove(b)) return b
  }
  // 走到这里几乎不可能。真到了也得返回一张**干净的**盘面：
  // 死盘由界面层兜（MatchBoard 里有"无可消则重排"），而带三连的盘面没有兜底，会当场自己消。
  return fillBoard(rng)
}

/** 开一局新的：盘面 + 全空的特殊块层 + 从 0 号开始的身份层（一局之内身份号只增不减） */
export function newMatch(rng: Rng = Math.random): { board: Board; specials: Specials; ids: Ids; nextId: number } {
  const board = newBoard(rng)
  return { board, specials: newSpecials(), ids: board.map((_, i) => i), nextId: board.length }
}

/**
 * 按掉落轨迹搬运身份层：落下来的块身份不变（那正是位移动画的锚），顶部新补的块领新号。
 *
 * 界面就靠这个把"同一块"从旧格子挪到新格子 —— 块的身份一致，CSS 的 transform 过渡
 * 才会把它**滑**过去，而不是原地换张图。
 */
export function stepIds(ids: Ids, src: number[], nextId: number): { ids: Ids; nextId: number } {
  let n = nextId
  const out = src.map(from => (from >= 0 ? ids[from] : n++))
  return { ids: out, nextId: n }
}

/**
 * 把一次交换得到的格数换算成伤害。
 *
 * 现在取 30000。这个数和服务端血条是**同一把标尺**的两端：
 *    血量 = 人数 × 分钟 × 每分钟交换次数 × 每次交换平均格数 × 每格伤害
 * ️ 血条本身现在是**用户直接定的 2 亿**（2026-09-17「改boss数值 改到2亿」），
 *    不再由这条式子算出；但改这个数**仍然等于改标尺**，会连带改变"这个血量能打多久"的换算 ——
 *    要改就跟服务端的 WB_BOSS_HP 一起改，别只动一边。
 *
 * ⚠️ v1.40 加了特殊块之后，"每次交换平均格数"这一项**变大了**（炸弹一行就是 6 格）。
 *    标尺的四个数里改了任何一个，另外三个都要重新对一遍 —— 别只盯着这个常数看。
 *    实测值与结论见 temp/calib-match3-special.cjs 的输出（也记在 SPEC 里）。
 */
export const MATCH_DAMAGE_PER_TILE = 30000