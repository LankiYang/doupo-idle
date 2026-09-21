// 连连看引擎：纯逻辑、无 React、无网络 —— 可以单独跑测试。
//
// 为什么单独一个文件：连连看的"哪两个能连"是**规则**。规则错了（比如允许拐三次、
// 或者让路径从别的块上面穿过去）界面是看不出来的，只会表现为"明明看着能连却点不掉"，
// 而玩家只会以为是自己的问题。规则要能被独立测。
//
// 与三消（`match3.ts`）的关系：**规则层没有任何可复用的地方** ——
//   三消是「相邻交换 → 连成三个 → 连锁掉落补块」；
//   连连看是「任意两点 → 路径可达 → 成对消除 → 消掉就是空，不补」。
//   两套算法、两种盘面演化。共用的只有界面层的动画模式与音效（`sfx.ts`）。
//
// 盘面用一维数组表示（`y * LINK_W + x`），`-1` 是空格。整个盘面是个**纯值**，
// 消除就是 slice 出来的新数组 —— React 那边直接 setState 就行，不会被上一帧的引用污染。
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠️ 这个文件里最容易写错的三条，改任何判定之前先读一遍：
//   ① **路径可以绕到盘面外面走**（标准规则，也是很多"看着能连"的来源）。
//      所以内部一律用「可见盘面 + 一圈隐形外框」的坐标，外框上恒为空，见下面的 pad/toOuter。
//   ② **最多拐 2 次弯**（= 最多三段直线）。拐 3 次是**不算**的。
//   ③ 路径经过的格子**必须为空** —— 只有起点和终点本身可以是块。

export const LINK_W = 8
export const LINK_H = 6
/**
 * 8 种图案。比三消的 4 色多 —— 连连看是"找"的游戏，图案太少一眼就扫完了，
 * 没有搜索的乐趣；太多则变成纯眼力苦役。8 种是这两者之间的取中。
 */
export const LINK_KINDS = 8

export type Board = number[]
export type Rng = () => number

/** 空格。`Board` 里没被块占着的位置 */
export const LINK_EMPTY = -1

/** 格数。UI 与测试都拿它当循环上界，别在各处再写一遍 48 */
export const LINK_CELLS = LINK_W * LINK_H

// ── 坐标：可见盘面 + 一圈隐形外框 ──────────────────────────────────────────
//
// 外框是**逻辑上的**，玩家看不见，但连线可以走上去 —— 这就是"绕出去连"那条规则。
// 对外的下标仍然是可见盘面的一维下标（`y * LINK_W + x`）；进内部时 +1 偏移。
const BW = LINK_W + 2
const BH = LINK_H + 2

/** 可见下标 → 带框下标 */
export function toOuter(i: number): number {
  const x = i % LINK_W
  const y = (i / LINK_W) | 0
  return (y + 1) * BW + (x + 1)
}

/**
 * 带框下标 → 可见下标。**外框上回 `-1`** ——
 * 画连线时正好用得上：`-1` 意味着"这一格在盘面之外"，UI 照常算它的中心点即可，
 * 线会自然地画到盘面边界外面去。
 */
export function toVisible(li: number): number {
  const x = li % BW
  const y = (li / BW) | 0
  if (x === 0 || y === 0 || x === BW - 1 || y === BH - 1) return -1
  return (y - 1) * LINK_W + (x - 1)
}

/** 给可见盘面包上一圈空格。短数组按空格处理（测试夹具常只给几格） */
function pad(b: Board): number[] {
  const out = new Array<number>(BW * BH).fill(LINK_EMPTY)
  for (let i = 0; i < LINK_CELLS; i++) out[toOuter(i)] = b[i] ?? LINK_EMPTY
  return out
}

/**
 * 外框上的点画在**盘面外多远**（单位 = 格宽）。
 *
 * ⚠️ 这个数与另外两处是**同一个数的三处写法**，改要一起改：
 *   · `LinkLinkBoard.tsx` 的 `PAD`（布局外框，= 0.36 —— 比这里大一点点，
 *     为的是把 `dq-ll-line` 的描边（0.13 单位宽）也兜在 SVG 盒子里）
 *   · `index.css` 里 `--cs` 的分母 `8 + 2×PAD = 8.72`
 *
 * v1.49 之前画在 ±0.5（外框格的格心），而布局外框是整整 1 格：那一圈"绕出去"的线
 * 离盘面半格远，手机上一格只有 36px 时光外框就吃掉 20% 的宽度，格子被迫做小
 * （320px 机型上只剩 30px）。现在两边一起收到 0.3 格上下 —— 格子变大，
 * 线仍然画在盘面**外面**，玩家照样看得见"从外侧绕过去了"。
 */
export const LINK_RING = 0.28

/**
 * 带框下标 → **画线用的坐标**：单位是"一个格宽"，可见格 `(0,0)` 的中心就是 `(0.5, 0.5)`。
 *
 * 为什么由引擎给、而不是界面自己算：换算要用到 `BW`（外框宽度），而那是本模块私有的。
 * 界面自己算就得把 `BW = LINK_W + 2` 再写一份 —— 三条规则里最容易写错的正是外框这一圈，
 * 两份实现一旦漂了，表现是"线画偏一格"，而盘面和判定都是对的，很难怀疑到这儿。
 *
 * 盘面外的点会给出负数或超过 `LINK_W`/`LINK_H` 的值 —— 那正是"线绕到盘面外"要画的位置。
 * 外框那两行**不是**格心（±0.5），而是收进来的 ±`LINK_RING`：见上面对三处数值的说明。
 */
export function linkPointOf(li: number): { x: number; y: number } {
  const cx = li % BW, cy = (li / BW) | 0
  return {
    x: cx <= 0 ? -LINK_RING : cx >= BW - 1 ? LINK_W + LINK_RING : cx - 0.5,
    y: cy <= 0 ? -LINK_RING : cy >= BH - 1 ? LINK_H + LINK_RING : cy - 0.5,
  }
}

// ── 路径判定 ──────────────────────────────────────────────────────────────

/**
 * 在**带框盘面**上找 A → B 的连线。能连 ⇒ 回路径的**拐点序列**（含首尾，带框下标）；
 * 不能连 ⇒ 回 `null`。
 *
 * 返回值刻意是"拐点"而不是"逐格"：画线只需要几个折点，而且拐点数本身就是判定结果的一部分
 * （两个点之间最多 3 段，路径长度恒为 3~4 个点）。
 *
 * 实现分三档，与规则一一对应：0 拐（直连）→ 1 拐（两个候选直角点）→ 2 拐（先沿 A 直行到 P1、
 * 再从 P1 拐到 P2、最后连到 B）。三档都不成立就是不能连，没有别的情形。
 */
export function linkPathOn(ob: number[], A: number, B: number): number[] | null {
  if (A === B) return null
  if (ob[A] === LINK_EMPTY || ob[B] === LINK_EMPTY) return null
  const isEmpty = (li: number) => ob[li] === LINK_EMPTY

  /**
   * p 与 q 同行或同列，且**中间**（不含两端）全空。
   * 端点不查 —— 起点和终点本来就是块，那正是这条路径的意义。
   */
  const clear = (p: number, q: number): boolean => {
    if (p === q) return true
    const px = p % BW, py = (p / BW) | 0
    const qx = q % BW, qy = (q / BW) | 0
    if (px === qx) {
      const lo = Math.min(py, qy) + 1, hi = Math.max(py, qy)
      for (let y = lo; y < hi; y++) if (!isEmpty(y * BW + px)) return false
      return true
    }
    if (py === qy) {
      const lo = Math.min(px, qx) + 1, hi = Math.max(px, qx)
      for (let x = lo; x < hi; x++) if (!isEmpty(py * BW + x)) return false
      return true
    }
    return false   // 斜着不算 —— 只能横竖走
  }

  // ① 0 拐：直连
  if (clear(A, B)) return [A, B]

  const ax = A % BW, ay = (A / BW) | 0
  const bx = B % BW, by = (B / BW) | 0

  // ② 1 拐：拐点在"过 A 的横线 × 过 B 的竖线"或"过 A 的竖线 × 过 B 的横线"上
  for (const P of [by * BW + ax, ay * BW + bx]) {
    if (P === A || P === B) continue
    if (!isEmpty(P)) continue
    if (clear(A, P) && clear(P, B)) return [A, P, B]
  }

  // ③ 2 拐：P1 是 A 沿四条方向能直行到的空格，P2 落在"过 P1 的直线 × 过 B 的另一条直线"上
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    let x = ax + dx, y = ay + dy
    while (x >= 0 && y >= 0 && x < BW && y < BH) {
      const P1 = y * BW + x
      if (!isEmpty(P1)) break                       // 撞到块就这条线到头了
      for (const P2 of [by * BW + x, y * BW + bx]) {
        if (P2 === A || P2 === B) continue
        if (!isEmpty(P2)) continue
        if (clear(P1, P2) && clear(P2, B)) return [A, P1, P2, B]
      }
      x += dx; y += dy
    }
  }
  return null
}

/**
 * 盘面上这两个**可见下标**能不能连。能连 ⇒ 回路径（**带框下标**，可能含 `-1` 之外的值，
 * 用 `toVisible` 换算即可；`-1` 的格子在盘外），不能连 ⇒ 回 `null`。
 *
 * 三条先决条件在这里一次判掉：同一个格子、图案不同、有一格是空的 —— 都不算连。
 */
export function canLink(board: Board, a: number, b: number): number[] | null {
  if (a === b) return null
  if (a < 0 || b < 0 || a >= LINK_CELLS || b >= LINK_CELLS) return null
  if (board[a] === LINK_EMPTY || board[a] !== board[b]) return null
  return linkPathOn(pad(board), toOuter(a), toOuter(b))
}

/** 找**任意一对**能消的（可见下标）。回 `null` 就是这盘没得消了 —— 该重排 */
export function findAnyPair(board: Board): [number, number] | null {
  const ob = pad(board)
  // 只有**同图案**的才可能成对，所以先按图案分桶 —— 否则 48 格里要试 1128 对
  const byKind = new Map<number, number[]>()
  for (let li = 0; li < ob.length; li++) {
    const v = ob[li]
    if (v === LINK_EMPTY) continue
    const arr = byKind.get(v)
    if (arr) arr.push(li)
    else byKind.set(v, [li])
  }
  for (const cells of byKind.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (linkPathOn(ob, cells[i], cells[j])) return [toVisible(cells[i]), toVisible(cells[j])]
      }
    }
  }
  return null
}

/** 这盘还有没有得消 */
export function hasMove(board: Board): boolean {
  return findAnyPair(board) !== null
}

/** 盘面空了 —— 这一盘打光了 */
export function isCleared(board: Board): boolean {
  for (let i = 0; i < LINK_CELLS; i++) if (board[i] !== LINK_EMPTY) return false
  return true
}

// ── 发牌与重排 ────────────────────────────────────────────────────────────

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/**
 * 发一副满盘。每种图案的个数**取偶数**（48 格 8 色 ⇒ 每种正好 6 个）。
 *
 * 偶数是为了**能消光**：某种图案是奇数个时，最后必然剩一个孤块，怎么排都配不成对。
 * 那一个孤块不会让游戏卡死（重排的兜底会重发一整副），但"明明快消完了却总有俩消不掉"
 * 是很明显的别扭感，开局就别给它机会。
 */
export function newLinkBoard(rng: Rng = Math.random): Board {
  const deck: number[] = []
  for (let i = 0; i < LINK_CELLS; i++) deck.push(i % LINK_KINDS)
  shuffle(deck, rng)
  const b: Board = deck.slice()
  // 极小概率一副牌就是无解的（尤其是撞上一堆同色挤在角落）。
  // 这里重发而不是"凑合着用" —— 开局就无解，玩家第一眼看到的是"这游戏坏了"。
  for (let i = 0; i < 40 && !hasMove(b); i++) {
    shuffle(deck, rng)
    for (let k = 0; k < LINK_CELLS; k++) b[k] = deck[k]
  }
  return b
}

/**
 * 重排：**先把还剩下的块原地打乱位置**（图案的多重集一个不变，位置集合也不变），
 * 打完保证有解 —— 没解就不叫重排，叫"换了副牌"，那是在骗玩家。
 *
 * ⚠️ 有一种情况**怎么打乱都没用**：某种图案只剩 1 个。它永远配不成对，
 *    盘面从此不可能消光。所以走了兜底：**直接重发一整副**（等于"这一波结束了，来新的一波"）。
 *    兜底同时兜住另一种"牌太少、怎么摆都连不上"的死局。
 */
export function reshuffle(board: Board, rng: Rng = Math.random): Board {
  const slots: number[] = []
  for (let i = 0; i < LINK_CELLS; i++) if (board[i] !== LINK_EMPTY) slots.push(i)
  if (slots.length >= 2) {
    const colors = slots.map(i => board[i])
    const b: Board = new Array<number>(LINK_CELLS).fill(LINK_EMPTY)
    for (let i = 0; i < 120; i++) {
      shuffle(colors, rng)
      for (let k = 0; k < slots.length; k++) b[slots[k]] = colors[k]
      if (hasMove(b)) return b
    }
  }
  return newLinkBoard(rng)
}

// ── 连击与伤害 ────────────────────────────────────────────────────────────
//
// 连连看一次只消**一对 = 2 格**，而三消一次交换平均消 9 格。如果两边用同一个"每格伤害"，
// 连连看的产出只有三消的四分之一 —— 于是玩家只会去打三消那只，第二只形同不存在。
// 所以每对伤害**必须单独定**，定法是让两边的**产出速度对齐**（见下面的常量）。

/** 两对之间超过这个时间就算"倒手"，连击从头数 */
export const LINK_COMBO_WINDOW_MS = 4000
/** 连击每多一对，多这么些伤害 */
export const LINK_COMBO_STEP = 0.04
/** 连击加成封顶 —— 手快有红利，但不至于让手感变成碾压 */
export const LINK_COMBO_MAX = 1.6

/** 第 n 对的伤害倍率。n 从 1 起（第一对 = 1.0） */
export function comboMultiplier(n: number): number {
  const k = Math.max(1, Math.floor(n) || 1)
  return Math.min(LINK_COMBO_MAX, 1 + LINK_COMBO_STEP * (k - 1))
}

/**
 * 消掉**一对**造成多少伤害。
 *
 * ⚠️ 这个数不是拍的，是**让两只 Boss 的产出速度对齐**反推出来的：
 *
 *     每对伤害 × 每分钟对数 = 每格伤害 × 每次交换格数 × 每分钟交换数
 *
 *   左边是连连看（一次一对），右边是三消（一次交换平均 9 格）。
 *   代进三消那套实测标尺（每格 6 万、每次 8.5 格、每分钟 30 次交换）与
 *   连连看的 40 对/分钟（= 一对 1.5 秒），得 ≈ 38 万。
 *
 * **为什么要对齐**：用户定过一条原则（见 `worldboss.ts` 文件头引的那句）——
 *   "留着两套产出速度相当的按钮，玩家只会问'点哪个划算'，而答案毫无意义"。
 *   两只 Boss 之间同理：玩家该选的是"我今天想玩哪种"，不是"哪个更划算"。
 *
 * 分母上的 `LINK_PAIRS_PER_MIN`（一对 1.5 秒）是**这一串里唯一没法实测的假设** ——
 * 找位置的眼力与手速，服务器上量不到，只有真人试玩说了算。它和三消那边的
 * `WB_SWAPS_PER_MIN` 是同一类东西。
 *
 * ⚠️ 服务端 `server.js` 的 `LINK_DAMAGE_PER_PAIR` 是**同一把标尺的另一端**（反推出手次数用）。
 *    改这里必须同时改那边，改完两边要逐字节一致。
 *    （2026-09-20 订正：这里原先写的是 `WB2_DAMAGE_PER_PAIR` —— 服务端从来没有过这个名字，
 *     grep 一下就露馅。**陈旧注释比没有注释更坏**，它看起来像一条核对过的依据。）
 *
 * ⚠️ 2026-09-20 由 19 万翻倍到 38 万（用户「连连看和消消乐基础伤害都翻倍」）。
 *    **这一改与上面那条公式无关**：公式两侧同比例翻、比例不变 ⇒ 两只 Boss 依然对齐，
 *    所以这里是干脆的 ×2，而不是"照公式重标一遍"。
 *    取 38 万而非公式算出的 38.25 万：延续原值"取整到整万"的惯例
 *    （原值 191250 → 19 万，同样是抹掉零头），取整幅度与改动前**一模一样**。
 */
export const LINK_DAMAGE_PER_PAIR = 380000

/**
 * 上面那条公式的分母 —— **手感旋钮**。
 *
 * ⚠️ 手感不对时**只调这一个数**，然后照公式把 `LINK_DAMAGE_PER_PAIR` 重算一遍。
 *    别单独去动每对伤害 —— 那会连带把两只 Boss 的产出比改掉，而玩家看得出来。
 *
 * 为什么敢取 1.5 秒（= 比三消的"一次交换 2 秒"略快）—— 两条**实测**支撑，
 * 见 `temp/calib-linklink.cjs`（跑 `node temp/calib-linklink.cjs 40`）：
 *   · 盘面上**同时有几个落点**两边几乎一样多：连连看 10.6 个可消对 / 三消 13.0 个可消步
 *     （= 0.8 倍）。找的难度相当，所以"略快"不能靠"落点更多"来解释。
 *   · 真正的差别在**动作**：三消要拖拽一次、还要等连锁掉落的动画；连连看只点两下、
 *     消掉就是空、没有动画等待。省下的是这段时间。
 * ⚠️ 但这两个数都只是**代理指标**，真人手速服务器上量不出来 —— 最终还得靠试玩定。
 */
export const LINK_PAIRS_PER_MIN = 40

/** 这一对造成多少伤害。**换算只在这里发生** —— 界面不许自己乘一遍 */
export function damageOf(combo: number): number {
  return Math.round(LINK_DAMAGE_PER_PAIR * comboMultiplier(combo))
}