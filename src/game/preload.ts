// ─── 剧情资源预热（v1.55c）───────────────────────────────────────────────
//
// 用户 2026-09-22：「注意预加载剧情的角色图片，不然临时加载很卡」。
//
// ── 问题是什么 ─────────────────────────────────────────────────────────
// `vnPortrait.ts` / `scenes.ts` 用的是 `import.meta.glob(..., { eager: true })`。
// 很多人以为 `eager` 就等于"图进包了、不会卡" —— **不是**。
// `eager` 只是把 **URL 字符串**编进 bundle；webp 本身仍是独立文件，
// 浏览器要等到 `<img src>` 第一次指向它才发请求。
// 于是第一次换到某个人/某个场景时，会先白一下再出图 —— 那一下就是"卡"。
//
// ── 为什么是"全量预热"而不是"按需预取下一张" ──────────────────────────
// 按需预取的逻辑要判断"下一句是谁、下一个场景是哪个"，而剧本是**可以随时改的数据**，
// 那种预取代码迟早会和剧本对不上（然后退化成"有时候管用"）。
// 这里的账很简单：
//   · 立绘 27 张 ≈ 2.6 MB，场景 24 张 ≈ 1.5 MB，第一批总量约 4 MB
//   · 它是**一次性的**，下完进 HTTP 缓存，之后所有切换都是本地命中
//   · 而按需加载的代价是**每一次换人**都可能卡一下 —— 一章 16 段剧情要换几十次
// 拿一次 4 MB 换掉几十次停顿，在"新手强制进剧情"这条路上是划算的。
//
// ── 但不能和首屏抢带宽 ─────────────────────────────────────────────────
// 所以预热**不立刻开始**：等第一帧画完，再用 `requestIdleCallback` 塞进空闲时间，
// 而且限制并发 —— 浏览器对同源本来就有连接数上限，一次性 `new Image()` 五十几个
// 会把**当前正要看的那张图**挤到后面，首屏反而更慢。
//
// ⚠️ 这个模块**不返回 Promise、不阻塞渲染**。预热失败（离线、被拦截）不影响任何功能，
//    只是退回到"用的时候再下"的老行为 —— 所以这里所有错误都必须吞掉。

import { vnPortraitFor, vnPortraitIds } from './vnPortrait'
import { sceneFor, sceneIds } from './scenes'

/** 已经预热过的 URL。挂在模块上而不是组件上 —— 换屏不该重下一遍 */
const warmed = new Set<string>()

/** `warmStoryAssets()` 是否已经排过队。见那个函数里的说明 */
let warmedOnce = false

/** 页面空闲时执行；不支持 `requestIdleCallback` 就退到定时器 */
function onIdle(fn: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout: 2000 })
  else window.setTimeout(fn, 300)
}

/**
 * 把一批图下进缓存。**限制并发**：同时最多 `limit` 张在飞。
 *
 * 不用 `Promise.all` 一次性全发：那样 51 个请求会一起挤上去，
 * 当前那一屏真正需要的图反而排在后面 —— 预热是为了让画面更顺，不能帮倒忙。
 */
export function preloadImages(urls: string[], limit = 4): void {
  const queue = urls.filter(u => u && !warmed.has(u))
  if (queue.length === 0) return
  queue.forEach(u => warmed.add(u))

  let i = 0
  const next = () => {
    if (i >= queue.length) return
    const url = queue[i++]
    const img = new Image()
    img.onload = next
    // 单张失败不能卡住整条队列 —— 否则一张 404 会让后面几十张全部不下
    img.onerror = next
    img.src = url
  }
  for (let k = 0; k < Math.min(limit, queue.length); k++) next()
}

/**
 * 预热剧情用到的全部图。
 *
 * 顺序是**刻意的**：先立绘、后场景。
 * 立绘是"换人时"才出现的，停顿最刺眼；场景有交叉淡化兜着（旧图还盖在下面），
 * 晚一点到不会露白。所以立绘排前面。
 */
export function warmStoryAssets(): void {
  // 整个页面生命周期只排一次。这个函数会被每一块 StoryStage 的挂载调用，
  // 而剧情从序章到第一章要换几十次屏 —— 不挡一下就会排几十个空闲回调。
  if (warmedOnce) return
  warmedOnce = true
  onIdle(() => {
    // 用**静态** import。曾经写成动态 import 想"把预热逻辑挪出首屏包"，
    // 但 Vite 直接报了 `INEFFECTIVE_DYNAMIC_IMPORT`：这两个模块本来就被 StoryStage
    // 静态引入（立绘 URL 必须同步可得，见 vnPortrait.ts 的说明），
    // 所以动态 import 分不出任何东西，只多出两个 0.08 kB 的空壳 chunk。
    preloadImages(vnPortraitIds().map(id => vnPortraitFor(id)!))
    preloadImages(Object.keys(sceneIds()).map(id => sceneFor(id)!))
  })
}