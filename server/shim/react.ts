/**
 * 服务端的 React 空实现。
 *
 * 引擎里只有**一处**用到 React：`useGame()` 里的 `useSyncExternalStore`（engine.ts:2794）——
 * 那是给浏览器渲染用的订阅桥，服务端不渲染任何东西、也不订阅（它按 1Hz 自己驱动 tick）。
 *
 * 为什么不是"把 react 打包进产物"：一是白搭几百 KB，二是那等于声称"服务端能跑 React"——
 * 而它不能。换成空实现，让"服务端不碰 UI"这件事在**构建层面**成立，而不是靠约定。
 */
export function useSyncExternalStore<T>(_subscribe: () => void, getSnapshot: () => T): T {
  return getSnapshot()
}