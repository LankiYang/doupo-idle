import { useEffect, useRef, useState, type ReactNode } from 'react'
import { sceneFor } from '../game/scenes'
import { vnPortraitFor } from '../game/vnPortrait'
import { warmStoryAssets } from '../game/preload'
import type { SceneId } from '../game/story'
import type { StageCast } from '../game/vnCast'

/**
 * 视觉小说的**舞台**（v1.54 建，v1.55 加演出）。序章、剧情对话、阻断式弹层全用它 —— 一份实现。
 *
 * 结构照抄参考案例（「圣约学院 · 初始之约」）那一屏，四层：
 *   ① 场景图铺满（`object-cover`，找不到图就退回墨底，绝不留白）
 *   ② 立绘层（v1.55）：左/中/右三个站位，说话的人亮、其余压暗
 *   ③ 顶部：眉标 + 标题 +（可选）右上角一个按钮
 *   ④ 场景区右下角：一排小 chip；底部：对话卡（可滚）+ 一行按钮
 *
 * ── 手机端「一屏」硬约束怎么落在这里 ──────────────────────────────────
 * 用户 2026-09-21 定的口径是「手机尺寸下所有页面都要要求一屏展示，不要做整体的下滑，
 * 可以**恒向滑动**和**弹窗内滑动**」。这个舞台整个是 `fixed inset-0` 的一列
 * （`flex flex-col` + `overflow-hidden`），**文档永远不滚**：
 *   · 场景图那一段吃 `flex-1 min-h-0` —— 剩余空间全给它，自己 `overflow-hidden`
 *   · 对话卡是 `flex-none` + 自己 `overflow-y-auto`，长台词在**卡内**滚
 *   · 立绘层是场景区里的 `absolute`，**完全不参与布局**（v1.55 加的）。
 *     这一条是刻意的：立绘要是有高度，它就会把场景区顶高、把对话卡挤出屏幕 ——
 *     而"加了立绘之后手机上一屏放不下了"是最容易发生、也最难查的一种回归。
 *
 * ⚠️ 三个 `min-h-0` / `flex-none` 一个都不能省（这是本项目在手机端反复踩过的坑，见
 *    `memory/doupo-mobile-onescreen.md`）：高度链上少一层 `min-h-0`，被压缩的那一层
 *    就会按"未压缩的尺寸"铺开内容、再由自己的 `overflow-hidden` 把最后一行切掉 ——
 *    症状是"算出来放得下，玩家看到的还是缺一块"。
 */

/** 场景交叉淡化的时长。同时也是"旧图什么时候可以卸载"的判据，两处必须是同一个数 */
const SCENE_FADE_MS = 620
/** 立绘进出场 / 说话高亮的时长。比场景快一点：立绘是"人动了"，场景是"换了个地方" */
const CAST_FADE_MS = 320

/**
 * 场景**交叉淡化**（v1.55）。
 *
 * 用户 2026-09-22：「地图背景也要随着实际剧情切换而切换」「都要做淡入淡出的一些过渡」。
 *
 * ── 为什么不是"换 src 就完了" ──────────────────────────────────────────
 * 直接换 `src`：新图要解码，解码完成前浏览器显示的是**旧图或空白**，
 * 于是切场景会看到一帧闪。所以这里**同时挂两层**：旧的留在下面不动，
 * 新的从 0 淡到 1 盖上去。
 *
 * ⚠️ 关键细节：**下面那层不跟着淡出**，全程保持 opacity 1。
 *    两层一起动（下面 1→0、上面 0→1）看起来更"对称"，但只要时长差一点点，
 *    中间就会露出一条缝 —— 而这条缝的颜色是舞台底色（深褐），
 *    在夜景切换时会被读成"闪了一下黑"。只让上面那层动，就永远不会露缝。
 *
 * ⚠️ 旧层在淡完之后**必须卸载**：留着不占视觉，但每张场景图是几十 KB 的解码位图，
 *    一路读剧情下去不卸载就是几十张全挂在 DOM 上。这里用定时器在
 *    `SCENE_FADE_MS` 之后丢掉最下面那层。
 */
function SceneLayer({ scene }: { scene: SceneId }) {
  // 栈里**最多两层**：最后一个是当前显示的，前一个是正在被盖住的。
  // 用自增 id 做 key，而不是用 scene 名 —— 同一张图连着出现两次（比如来回走）
  // 也要重新播一次淡化，用名字做 key 的话 React 会认为"没变"，过渡就吞掉了。
  const [stack, setStack] = useState<{ key: number; scene: SceneId }[]>(() => [{ key: 0, scene }])
  const seq = useRef(1)

  useEffect(() => {
    setStack(prev => {
      if (prev[prev.length - 1]?.scene === scene) return prev
      return [...prev.slice(-1), { key: seq.current++, scene }]
    })
  }, [scene])

  useEffect(() => {
    if (stack.length < 2) return
    const t = window.setTimeout(() => setStack(prev => prev.slice(-1)), SCENE_FADE_MS)
    return () => window.clearTimeout(t)
  }, [stack])

  return (
    <>
      {stack.map((l, i) => {
        const top = i === stack.length - 1
        return top
          ? <FadeInImage key={l.key} scene={l.scene} />
          : <SceneImg key={l.key} scene={l.scene} className="opacity-100" />
      })}
    </>
  )
}

/** 挂载后才把 opacity 推到 1，这样浏览器才有"从 0 开始"的过渡起点 */
function FadeInImage({ scene }: { scene: SceneId }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    // 下一帧再开 —— 在同一个 tick 里设初始值和目标值，浏览器会合并成一次样式计算，
    // 过渡不触发（就是"新图直接跳出来"的那个 bug）。
    const r = window.requestAnimationFrame(() => setOn(true))
    return () => window.cancelAnimationFrame(r)
  }, [])
  return <SceneImg scene={scene} className={on ? 'opacity-100' : 'opacity-0'} />
}

function SceneImg({ scene, className }: { scene: SceneId; className: string }) {
  const bg = sceneFor(scene)
  // 缺图不能留白（那看着像加载失败）：退回墨底 + 一层渐变，至少还是个舞台。
  // `data-story-scene="none"` 让自测脚本能一眼看出"这张图没找到"，而不是以为舞台坏了。
  return bg
    ? <img src={bg} alt="" data-story-scene={scene}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[620ms] ease-out ${className}`} />
    : <div data-story-scene="none"
        className={`absolute inset-0 bg-gradient-to-b from-dq-panel to-dq-bg transition-opacity duration-[620ms] ease-out ${className}`} />
}

/**
 * 立绘层（v1.55）。
 *
 * 用户 2026-09-22：「每个角色说话的时候都要有立绘」「注意抠图只保留人物主体」。
 * 抠好的透明立绘见 `game/vnPortrait.ts`（生成脚本 `temp/cutout-portraits.sh`）。
 *
 * ── 站位怎么摆 ─────────────────────────────────────────────────────────
 * 三个人是 `absolute bottom-0`，宽度按站位给（左 `left-[2%]`、中 `left-1/2 -translate-x-1/2`、
 * 右 `right-[2%]`），高度统一 `h-[86%]`、`object-contain object-bottom`。
 *
 * ⚠️ **不用 `flex` 排**。用 flex 的话三个人的框会随"谁在台上"变化而重新分配宽度，
 *    一个人退场时剩下的会**平移**到新位置 —— 那不是"换人"，那是整排滑了一下。
 *    绝对定位让每个人的位置**只由站位决定**，与旁边站着谁无关。
 *
 * ⚠️ 立绘是**底部对齐**的（`object-bottom`）。抠图之后人物在画布里的垂直位置各不相同
 *    （有的脚在 1023 行，有的在 900 行），居中对齐会让几个人**悬在不同高度**上，
 *    看着像有人飘着。底部对齐把这件事压住了 —— 剩下的差异只能靠裁图解决，不是这里的事。
 */
function CastLayer({ cast }: { cast: StageCast[] }) {
  return (
    <div data-story-cast className="pointer-events-none absolute inset-0">
      {cast.map(c => <Portrait key={`${c.side}:${c.id}`} {...c} />)}
    </div>
  )
}

function Portrait({ id, side, speaking }: StageCast) {
  const src = vnPortraitFor(id)
  // 立绘取不到：**什么都不渲染**（不是留个空框）。
  // 台词照常出，观众读到的是"这一段是旁白/画外音"——比一个破图框好，
  // 也不会让人以为游戏坏了。要查缺了谁用 `castIdsOf()` 对 `vnPortraitIds()`。
  if (!src) return null
  const pos = side === 'left' ? 'left-[1%] sm:left-[4%]'
    : side === 'right' ? 'right-[1%] sm:right-[4%]'
      : 'left-1/2 -translate-x-1/2'
  return (
    <img src={src} alt="" data-story-portrait={id} data-story-side={side} data-story-speaking={speaking ? '1' : '0'}
      // 时长走常量而不是写死 `duration-[320ms]`：这个数在文件头上被引用过（"比场景快一点"），
      // 两处各写一遍迟早对不上。
      style={{ transitionDuration: `${CAST_FADE_MS}ms` }}
      className={`absolute bottom-0 h-[86%] w-[62%] object-contain object-bottom transition-all ease-out sm:w-[46%] ${pos} ${
        speaking
          ? 'scale-100 opacity-100'
          // 没在说话的人：压暗 + 降饱和 + 缩一点点。
          // 三样一起给是因为**单靠透明度**在深色夜景上几乎看不出来（立绘本就偏暗），
          // 加上降饱和之后，亮的那位才是唯一有颜色的那个，一眼就能找到。
          : 'scale-[0.96] opacity-45 saturate-[0.55]'
      }`} />
  )
}

export default function StoryStage({ scene, kicker, title, topRight, chips, cast, children, footer, onTap }: {
  scene: SceneId
  /** 眉标，案例里是「CONTRACT ASSESSMENT · 3 / 3」那个位置 */
  kicker?: string
  title?: string
  /** 右上角的一个按钮（「跳过介绍」/「任务手册」这类） */
  topRight?: ReactNode
  chips?: ReactNode
  /** 台上站着谁（v1.55）。不传 / 空数组 = 纯景，一人不出。由 `vnCast.castAt()` 推出来 */
  cast?: StageCast[]
  /** 对话卡里的内容 */
  children: ReactNode
  /** 最底下那一行按钮 */
  footer?: ReactNode
  /**
   * **点整屏任意一处 = 这一个动作**（剧情阅读器的"翻下一页"）。
   *
   * 用户 2026-09-22：「在推剧情的时候允许用户点击屏幕就很能切换下一页」——
   * 手机上翻页最自然的手势就是"点屏幕"，而底栏那颗「继续」在拇指够得到的位置之外时，
   * 每翻一页都要挪一次手。
   *
   * ⚠️ 落在 `button / a / input / label` 上的点击**不算**：那些是玩家真正在点的东西，
   *    交给它们自己处理。用 `closest()` 判而不是给每颗按钮挂 `stopPropagation` ——
   *    后者要维护一张"哪些按钮要拦"的名单，漏一个就是"点了一下同时翻页 + 干了别的事"。
   */
  onTap?: () => void
}) {
  // 预热剧情用到的全部立绘与场景（v1.55c）。
  //
  // 用户 2026-09-22：「注意预加载剧情的角色图片，不然临时加载很卡」。
  // 挂在舞台上而不是各个调用方，是因为**每一块剧情屏都用它** ——
  // 写在这里等于"进了剧情就预热"，调用方不需要知道这件事，也不会漏掉某一条路径。
  //
  // 函数内部自己保证只排一次队、且不阻塞渲染（见 `game/preload.ts`）。
  useEffect(() => { warmStoryAssets() }, [])

  return (
    // `z-50`：要盖住 BottomSheet(40) 与邮箱抽屉。阻断式引导就该在最上面。
    // `onClick` = 「点屏翻页」（见 `onTap`）：整块舞台都接，除了真正在点的那些控件。
    <div data-story-stage
      onClick={onTap && (e => {
        const t = e.target as HTMLElement | null
        if (t && t.closest('button, a, input, select, textarea, label')) return
        onTap()
      })}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-dq-bg">
      {/* ── ① 场景图（交叉淡化）+ ② 立绘层 ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <SceneLayer scene={scene} />
        {/* 压暗：字要压在图上，不压暗读不清。上面轻、下面重，正好接住对话卡。
            ⚠️ 这层在**立绘下面**：立绘要压着渐变，否则人会被压暗层糊掉半截（脚那一段最明显）。 */}
        <div className="absolute inset-0 bg-gradient-to-b from-dq-bg/70 via-dq-bg/30 to-dq-bg/85" />
        {cast && cast.length > 0 && <CastLayer cast={cast} />}

        {/* ── ③ 顶部眉标与标题 ── */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 sm:p-5">
          <div className="min-w-0">
            {kicker && <div data-story-kicker className="text-[10px] tracking-[0.22em] text-dq-ember sm:text-xs">{kicker}</div>}
            {title && <h2 data-story-title className="dq-title mt-1 truncate text-xl text-dq-goldBright sm:text-3xl">{title}</h2>}
          </div>
          {topRight && <div className="shrink-0">{topRight}</div>}
        </div>

        {/* ── ④ 右下角那排 chip ── */}
        {chips && (
          <div className="absolute inset-x-0 bottom-2 flex flex-wrap justify-end gap-1.5 px-3 sm:bottom-3 sm:px-5">
            {chips}
          </div>
        )}
      </div>

      {/* ── ⑤ 对话卡 ── */}
      {/* **高度是常数**，不是 `max-h` 由内容撑（v1.55d）。
          用户 2026-09-22：「把对话框的高度固定，不要让高度变化 然后整个屏幕都变」。
          实测：`max-h` 之下卡片高度逐屏在变 —— 序章 156px、立誓 240px、修行手册 398px。
          而上面那层场景区是 `flex-1`（吃剩余空间）⇒ 它等于 `整屏 − 卡片 − 底栏`，
          卡片一变，**场景图与立绘就跟着缩放**，读起来整屏都在抖。
          改成固定 `h-[38dvh]` 之后，场景区高与卡片高都是常数，动的只有卡里的字。
          长台词仍然在**卡内**滚（`overflow-y-auto`），不违反"整页不滚"那一条。
          ⚠️ 与 `max-h` 的差别不只是"会不会变"：`max-h` 时短句是贴字高的，
             固定高度后短句底下会留白 —— 这是有意的，留白换来的是整屏不抖。
          选 38/32dvh 的依据：手机 896 高 ⇒ 卡片 340px、场景区 ~500px；
             桌面 900 高 ⇒ 卡片 288px。修行手册那种长列表在这两档都要滚一点，
             其余各幕实测都在卡内放得下。 */}
      <div data-story-card
        className="h-[38dvh] flex-none overflow-y-auto border-t border-dq-border2 bg-dq-panel/95 px-3 py-3 backdrop-blur-sm sm:h-[32dvh] sm:px-6 sm:py-4">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>

      {/* ── 底栏按钮 ── */}
      {footer && (
        <div data-story-footer
          className="flex flex-none items-center justify-between gap-2 border-t border-dq-border bg-dq-ink px-3 py-2 sm:px-6 sm:py-3">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * 舞台上的一枚小 chip（「在场人物 · 身份」那种）。
 * 单独抽出来是为了让三个调用方的观感一致 —— 这种小件各写各的必然长得不一样。
 */
export function StageChip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} type="button"
      className={`dq-tap rounded-full border px-2.5 py-1 text-[10px] backdrop-blur-sm sm:text-xs ${
        active ? 'border-dq-gold bg-dq-gold/25 text-dq-goldBright'
          : 'border-dq-border2 bg-black/55 text-[#d8c8ac] hover:text-dq-goldBright'}`}>
      {children}
    </button>
  )
}

/**
 * 舞台底栏上的主按钮（「继续 ›」/「走进契约日」这种）。
 * `dq-btn-gold` 自带内高光 + 外投影，与全站的主按钮同一套质感。
 *
 * ⚠️ `wide`（2026-09-22 加）：**手机上占满整行**。用户说「手机端的时候，引导要更简单
 *    更明显」—— 底栏现在只有它一颗（旁边那行灰色小字在手机上收掉了），
 *    占满之后"现在该按的就是这颗"不需要再找。桌面端 `sm:flex-none` 还原成自然宽度：
 *    鼠标屏上一颗占满整行的按钮反而显得笨重，而且底栏左右两块的分工（说明 / 动作）
 *    在大屏上是读得出来的。
 */
export function StagePrimary({ children, onClick, disabled, breath, wide, anchor }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; breath?: boolean; wide?: boolean
  /**
   * 传了就带上 `data-script-primary="1"`。
   *
   * 这是**给蒙层引导当落点**用的（`onboardSteps` 里剧情那几格的第一个锚点）：
   * 阅读器开着的时候，该点的就是底栏这颗主按钮（「继续 ›」/「开战 ›」/「收下 ›」），
   * 而地图上那一格这时候在遮罩底下，点它等于退回地图。
   * ⚠️ 做成**可选**而不是让每个 `StagePrimary` 都带上：序章 / 立誓 / 手册那三屏的主按钮
   * 同屏只可能有一个，带上也无害，但"哪儿都有的属性"很快就没人当它是锚点了。
   */
  anchor?: '1'
}) {
  return (
    <button onClick={onClick} disabled={disabled} type="button" data-script-primary={anchor}
      className={`dq-btn dq-btn-gold dq-tap px-4 py-2 text-sm font-bold sm:text-base ${breath ? 'dq-breath' : ''} ${
        wide ? 'flex-1 justify-center sm:flex-none' : ''}`}>
      {children}
    </button>
  )
}

/**
 * 逐字流出（打字机，v1.55）。
 *
 * 用户 2026-09-22：「说话的时候文字流式输出，营造一种氛围」。
 *
 * ── 为什么这个组件要"预留高度"，而不是让文字自然撑开 ──────────────────
 * 最朴素的写法是 `text.slice(0, n)`，字一个个冒出来、行一行行往下长。
 * 在**竖屏手机上**这是个灾难：文字每长出一行，对话卡的高度就变一次，
 * 底下那排按钮跟着上下跳 —— 而本作有"手机端一屏"的硬约束，
 * 高度一变就可能触发整页滚动条的闪现。
 *
 * 所以这里渲染**两份**：
 *   · 一份 `invisible`，内容是**完整的那句**，负责把盒子一次撑到最终大小
 *   · 一份 `absolute`，内容是 `slice(0, n)`，负责演出
 * 结果是**从第一个字开始，版面就已经是读完之后的版面**，全程零重排。
 *
 * ── 点一下要能立刻读完 ────────────────────────────────────────────────
 * 玩家在流字期间点「继续」，应该是**先把这句读完**，而不是跳到下一句 ——
 * 这是视觉小说的惯例，也是唯一不会让人漏掉半句的做法。两条路都给了：
 *   · 点文字本身（组件内的 `onClick`）—— 手感更松
 *   · 底栏那颗「继续」（父组件把 `reveal` 递增）—— 玩家真正会去点的地方
 * 所以父组件要传一个 `reveal` 计数器：它变化时这里直接跳到全文。
 *
 * ⚠️ `prefers-reduced-motion` 下**直接全出**：逐字动画对前庭敏感的人是真难受。
 */
export function Typewriter({ text, onDone, speed = 32, reveal = 0, className = '' }: {
  text: string
  onDone?: () => void
  /** 每字毫秒。中文一个字的含义比一个字母多，比英文的常见值（18~24）慢一档才读得舒服 */
  speed?: number
  /** 父组件递增这个数 = 「别再等了，把这句全放出来」。见上方"点一下要能立刻读完" */
  reveal?: number
  className?: string
}) {
  const reduce = usePrefersReducedMotion()
  const [n, setN] = useState(() => (reduce ? text.length : 0))
  const doneRef = useRef(false)
  /** 把 onDone 放进 ref：它每次渲染都是新的函数，放进 effect 依赖会让计时器反复重置 */
  const cb = useRef(onDone)
  cb.current = onDone

  useEffect(() => {
    doneRef.current = false
    if (reduce) { setN(text.length); return }
    setN(0)
    const id = window.setInterval(() => {
      setN(prev => {
        if (prev >= text.length) { window.clearInterval(id); return prev }
        return prev + 1
      })
    }, speed)
    return () => window.clearInterval(id)
  }, [text, speed, reduce])

  // `reveal` 只在**递增**时生效。写成 `useEffect(..., [reveal])` 而不判 0，
  // 会让挂载时的第一次运行也跳全文 —— 那样打字机效果就永远看不到了。
  useEffect(() => {
    if (reveal > 0) setN(text.length)
  }, [reveal, text])

  // 读完 → 回调（只回调一次）
  useEffect(() => {
    if (n >= text.length && !doneRef.current) {
      doneRef.current = true
      cb.current?.()
    }
  }, [n, text])

  const finished = n >= text.length
  return (
    <div className={`relative ${className}`}
      data-typewriter={finished ? 'done' : 'running'}
      onClick={finished ? undefined : () => setN(text.length)}>
      {/* 撑高度那份：invisible 而不是 hidden —— `hidden` 不参与布局，撑不出高度 */}
      <p aria-hidden className="invisible whitespace-pre-wrap">{text}</p>
      <p className="absolute inset-0 whitespace-pre-wrap">{text.slice(0, n)}</p>
    </div>
  )
}

/** 系统是否要求减少动态效果。SSR / 老浏览器取不到 `matchMedia` 时按"不减少"处理 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(mq.matches)
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

/** 说话人的名牌：名字 + 身份注脚。空名字 = 旁白，名牌整个不出现 */
export function SpeakerTag({ who, role }: { who: string; role?: string }) {
  if (!who) return null
  return (
    <div className="mb-1 flex items-baseline gap-2">
      <span data-story-speaker className="dq-title text-lg text-dq-goldBright sm:text-xl">{who}</span>
      {role && <span className="text-[11px] text-[#a89478] sm:text-xs">{role}</span>}
    </div>
  )
}