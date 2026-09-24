// ─── 立绘调度（v1.55）────────────────────────────────────────────────────
//
// 用户 2026-09-22：「每个角色说话的时候都要有立绘」「角色人物说话切换这些都要做淡入淡出的过渡」。
//
// 剧本里每行只写"谁在说话"，**没有写"这一屏台上站着谁"** —— 那是**推出来的**。
// 推导规则就写在下面这个函数里，只有这一处：台上的人 = 从开场到当前这一行为止，
// 所有出过场、且还没退场的人。
//
// ── 为什么是"推"而不是每行写全 ────────────────────────────────────────
// 每行写全（`cast: [...]`）看起来更直白，但它是**可以写错**的：加一句话忘了同步台上的人，
// 就会出现"这个人明明已经走了，下一句又站着"或者"两个人抢同一个站位"。
// 推导出来的东西不可能自相矛盾 —— 写错的可能性被从"每行"降到了"每行只写谁在说话"。
//
// ── 站位怎么定 ─────────────────────────────────────────────────────────
// 一个站位（左/中/右）同时只站一个人：新来的人**顶掉**原来那个。
// 这是视觉小说的常规做法（舞台就这么大），也是唯一能在不写调度表的前提下
// 处理"萧炎一直站着、对方换了一个人上来说话"的办法 —— 换人时右边那位淡出、
// 新来的淡入，主角不动，观众一眼看懂"换了个对手"。
//
// ⚠️ 这个模块是**纯函数**，不碰 React、不碰引擎。组件与测试都直接调它。

import type { ScriptLine, SpeakerSide } from './story'

export interface StageCast {
  /** 立绘 id（`vnPortrait.ts` 里的键） */
  id: string
  side: SpeakerSide
  /** 这一屏正在说话 —— 组件据此把其余人压暗 */
  speaking: boolean
  /**
   * 显示名。取**这个人最后一次开口时那句台词的 `who`**。
   *
   * 为什么从剧本里带出来，而不是拿 id 去角色表反查：立绘 id 是从卡面素材目录来的，
   * 里面有一批**没有卡的角色**（萧战、萧媚、纳兰杰…），反查会拿到 undefined,
   * 界面上就成了 `xiaozhan` 这种给玩家看的内部 id。剧本里本来就写着"他叫什么"，
   * 带出来是零成本且一定对的。
   */
  name: string
}

/**
 * 第 `index` 行显示时，台上站着谁。
 *
 * `index` 越界（-1 / 超过末行）返回空台 —— 调用方不必自己判边界。
 *
 * ⚠️ `exit` 的时机是**这一行说完之后**，不是这一行开始之前。所以
 *    「他说完最后一句然后退场」写成同一行（`{ speaker, text, exit: true }`）时，
 *    他在自己那句台词期间**还在台上** —— 这才是对的，人不会说到一半消失。
 *    退场从 `index + 1` 行起生效。
 */
export function castAt(lines: ScriptLine[], index: number): StageCast[] {
  /** side → 台上那个人。用 Map 保序（插入序），渲染时按固定站位顺序排，不靠它 */
  const onStage = new Map<SpeakerSide, { id: string; name: string }>()
  /** 谁说过话（决定压暗：同一屏里只有最后一个开口的人是亮的） */
  let lastSpeaker: string | null = null

  const end = Math.min(index, lines.length - 1)
  for (let i = 0; i <= end; i++) {
    const l = lines[i]
    if (!l) break
    // 上一行的退场在这里生效：本行开始之前，那个人已经走了
    const prev = lines[i - 1]
    if (prev?.exit && prev.speaker && onStage.get(prev.side ?? 'center')?.id === prev.speaker) {
      onStage.delete(prev.side ?? 'center')
    }
    if (l.speaker) {
      const side = l.side ?? 'center'
      // 顶掉同一站位上原来的人（换对手 / 换同伴）
      // 名字：这句的 `who` 为空时沿用这个站位上已有的名字（"立绘不动、只有旁白在说"）
      const name = l.who || onStage.get(side)?.name || ''
      onStage.set(side, { id: l.speaker, name })
      lastSpeaker = l.speaker
    } else if (l.who) {
      // ── 只写了 `who`、没写 `speaker` 的行（v1.55c 修）──────────────────
      //
      // 剧本的既定写法是「先给 speaker 让人站定 → 后面几句只给 who 不给 speaker」
      // （见 story.ts 的第四条写法）。这种行**说话的人换了**，但立绘不用重挂 ——
      // 所以必须在这里把"亮着的那位"也换过去。
      //
      // ⚠️ 这里曾经只认 `l.speaker`，于是出现：萧媚在说话，**亮的还是上一位萧炎**。
      //    用户 2026-09-22 报的「说话时机角色切换 也要对应正确」就是这一条。
      //    当时的界面自测也验不出来 —— 它只断言了"台上有立绘、说话的那位 speaking=1"，
      //    没有断言"speaking 的那位**就是正在说话的那个名字**"。数量对不代表指针对。
      //
      // 找不到人（画外音、或说话的人根本没有立绘）就保持原样：
      // 那种情况下台上没有他，亮谁都一样，硬换反而会让某个无关的人突然亮起来。
      for (const c of onStage.values()) {
        if (c.name === l.who) { lastSpeaker = c.id; break }
      }
    }
  }

  // 固定站位顺序渲染，保证 DOM 顺序稳定 —— 顺序一变，React 会重建节点，
  // 淡入淡出的过渡就从"换人"变成"整排闪一下"。
  const order: SpeakerSide[] = ['left', 'center', 'right']
  const out: StageCast[] = []
  for (const side of order) {
    const c = onStage.get(side)
    if (c) out.push({ id: c.id, side, speaking: c.id === lastSpeaker, name: c.name })
  }
  return out
}

/** 第 `index` 行时的场景 —— 沿用到最后一次 `scene` 声明为止。没有声明过则返回 null */
export function sceneAt(lines: ScriptLine[], index: number): ScriptLine['scene'] | null {
  const end = Math.min(index, lines.length - 1)
  for (let i = end; i >= 0; i--) {
    const s = lines[i]?.scene
    if (s) return s
  }
  return null
}

/**
 * 这一段剧本引用到的**全部立绘 id**。
 *
 * 给"引用了不存在的立绘"留一个能自查的口子：`vnPortraitFor(id)` 取不到图时
 * 组件会退回"只有台词、没有人"的演法（不留白、不报错），但那样**看不出来是漏了图**。
 * 开发时拿这个列表和 `vnPortraitIds()` 对一下就知道缺谁。
 */
export function castIdsOf(lines: ScriptLine[]): string[] {
  return [...new Set(lines.map(l => l.speaker).filter((x): x is string => !!x))]
}