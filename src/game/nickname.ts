// 游戏昵称的本机缓存（v1.53，SPEC §7）。
//
// 用户 2026-09-21 原话：「**要修 名字账号唯独绑定统一 登录的时候就该以账号记录为主**」。
//
// ── 为什么会有这个文件 ────────────────────────────────────────────────
// 昵称原先只存在 `LeaderboardView.tsx` 里的一个 `NAME_KEY` 常量后面：既不跟账号走，
// 也不跟存档走。换设备后本机没有这个名字，而进榜单页时客户端会拿**兜底值**「无名侠客」
// 上报一次 `/score` —— 把榜上那条的名字**覆盖**掉（当天早上真实发生）。
//
// ── 现在的规矩（三条，改这个文件之前先读一遍）────────────────────────
//   ① **权威副本在服务端**：账号记录 `accounts[pid].nick` → 榜上既有的真名 → 空。
//      本地这份只是**缓存**，丢了不是事故，去 `GET /nickname` 要回来即可。
//   ② **没有名字时，绝不拿兜底值去覆盖**：上报战绩时名字为空就**不带那个字段**，
//      服务端那边有权威昵称就沿用（`applyNick` 的闸门）。
//   ③ **写完本地要能马上读到**（改名后立刻显示），但真正的生效判据是服务端回了 `ok`。
import { NICK_KEY } from './storageKeys'

/**
 * 与界面输入框的 `maxLength`、服务端的 `NAME_MAX` 同一个数（12）。超长一律截断。
 *
 * 2026-09-21 起**导出**：新手引导的「入门登记」要把道号写进存档（`state.story.name`），
 * 引擎读档净化时得按同一个上限截 —— 以前这个数只在**本文件内部**用，
 * 引擎那边再写一个 12 就是第二份真相，改一处漏一处。
 */
export const NICK_MAX = 12

/** 本机缓存的昵称；没有/读不到/超长 ⇒ 空串（空串 = "还没有名字"，**不是**「无名侠客」） */
export function loadNick(): string {
  try {
    const v = localStorage.getItem(NICK_KEY)
    return typeof v === 'string' ? v.trim().slice(0, NICK_MAX) : ''
  } catch { return '' }
}

/** 写本机缓存。空串 ⇒ **删掉这个键**（"没有名字"要被如实表示，而不是存一个空串） */
export function saveNick(name: string): void {
  try {
    const v = (name || '').trim().slice(0, NICK_MAX)
    if (v) localStorage.setItem(NICK_KEY, v)
    else localStorage.removeItem(NICK_KEY)
  } catch { /* 隐私模式写不进去：这次会话仍能用（内存里），只是刷新后要重新取一次 */ }
}