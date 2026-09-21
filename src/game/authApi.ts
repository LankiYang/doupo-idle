// 账号客户端（SPEC §4.5.1）。
//
// 形态（2026-09-18 用户拍板）：**账号名 ≠ 存档码**。注册时取一个账号名、设密码，并**绑定自己的
// 存档码**；绑定之后只用「账号名 + 密码」登录，存档码退居幕后（只在注册绑定与"我本机是谁"时出现）。
// 账号维度就是存档维度 —— 换设备登同一个账号，拿到的就是云端的同一份进度。
//
// ⚠️ **零迁移**是硬约束，这条纪律不能因为引入账号名而破：
//    · 阶段 1 用「存档码 + 密码」注册的那批账号在服务端没有 `name` 字段 —— 登录框照样收存档码，
//      服务端也照样认（`pidOfLogin` 先看"输入是不是一个已注册的码"）
//    · 64 位以内的合法输入都算"登录名"，老码 32 位十六进制稳稳在范围内
//
// ⚠️ 令牌是**新键**且带构建前缀：体验服与正式服是两套后端（8787/8788、各自的 sessions.json），
//    令牌不通用。理由见 storageKeys.ts 里 AUTH_TOKEN_KEY 那段。
import { AUTH_TOKEN_KEY } from './storageKeys'
import { loadNick, saveNick } from './nickname'

const API = `${import.meta.env.BASE_URL}api`

/**
 * 口令长度的**提示值**，只用来给输入框一个 `minLength`。
 *
 * ⚠️ **它不是判据** —— 权威判据在服务端（`PW_MIN`），而且服务端在拒绝时会**把 `min` 一起回执回来**。
 *    客户端凡是能用回执里的值，就不要用这个常量下结论：这里复述第二份常量，将来服务端一改，
 *    表现就是"输入框说够了、提交却被拒"（或反过来，本地把人拦在门外）。
 */
export const PW_MIN_HINT = 6
export const PW_MAX = 128

/**
 * 账号名的**提示值**（下限），只用来给输入框一个 `minLength`。与 `PW_MIN_HINT` 同一个数 ——
 * 用户原话「账号密码都限制 6 位数就行」。
 *
 * ⚠️ 与密码那条同理：**它不是判据**，权威判据是服务端的 `ACC_NAME_MIN`。
 */
export const NAME_MIN_HINT = 6

export interface AuthOk {
  ok: true; playerId: string; token: string; exp: number
  /** **账号名**（登录名）。没有名字的老账号（阶段 1 那批）回存档码本身 */
  name?: string
  /**
   * **游戏昵称**（v1.53）—— 与 `name`（登录名）**不是一回事**，别混着用：
   * `name` 小写、进登录查重、改了会把号主锁在门外；`nick` 只影响界面上显示的名字。
   * 权威副本在服务端（账号记录 → 榜上真名），这个字段只是让它搭车回到本机缓存。
   */
  nick?: string
}
export interface AuthFail {
  ok: false
  /** `bad_credentials` | `locked` | `taken` | `weak_password` | `weak_name` | `name_taken` */
  reason: string
  retryAfter?: number
  min?: number
}
export type AuthResp = AuthOk | AuthFail

// ── 令牌存取 ────────────────────────────────────────────────────────────
// `name` 一起存：存档页要显示"已登录 · 某某"，而它已经在登录/注册的回执里了 ——
// 为了显示一个名字再问一次服务端是白绕一趟。老记录（阶段 1 那批）没有 name，读出来是
// undefined，显示层退回显示存档码，**不是错误**。
interface StoredToken { t: string; exp: number; name?: string; nick?: string }

/**
 * 读令牌。**任何形状不对或已过期的，一律当作"没有"** ——
 * 拿一个明知无效的令牌去撞服务端，换回来的 `need_login` 会被上层显示成"要重新登录"，
 * 而它其实只是"本地这份过期了"，两种情况的处理是一样的，不如在本地就咽掉。
 */
function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(AUTH_TOKEN_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o.t !== 'string' || o.t.length < 32) return null
    const exp = typeof o.exp === 'number' ? o.exp : 0
    if (exp > 0 && Date.now() > exp) return null
    return {
      t: o.t, exp,
      name: typeof o.name === 'string' ? o.name : undefined,
      nick: typeof o.nick === 'string' ? o.nick : undefined,
    }
  } catch { return null }
}

function writeToken(tk: StoredToken | null) {
  try {
    if (tk) localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(tk))
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch { /* 隐私模式下写不进去：这次会话仍能用（内存里），只是刷新后要重登 */ }
}

/**
 * 当前登录的**账号名**（没有名字的老账号回存档码本身；没登录回 null）。
 * 只读本地 —— 它只是个显示用的标签，**不是身份**。身份一律以服务端 `/auth/me` 为准。
 */
export function getAuthName(): string | null {
  const tk = readToken()
  if (!tk) return null
  return tk.name || null
}

/**
 * 当前账号记着的**游戏昵称**（v1.53）；没登录 / 账号还没有昵称 ⇒ null。
 *
 * ⚠️ 与 `getAuthName` **不是一回事**：那是登录名，这是游戏里显示的名字。两者混用会让
 *    "改名"变成"改登录名"（那是另一件事，会把号主锁在门外）。
 */
export function getAuthNick(): string | null {
  const tk = readToken()
  return (tk && tk.nick) || null
}

/** 这个设备上还登着吗（只查本地，不问服务端；问服务端走 `whoAmI`） */
export function hasToken(): boolean { return !!readToken() }

/**
 * 统一出口：**所有**后端请求都从这里走，令牌自动带上。
 *
 * ⚠️ 必须是"所有"。漏掉一处，那个端点在有账号之后就会变成未认证请求，
 *    而它的失败形态（`need_login`、榜单里没有 `me`、邮件列表为空）看起来像"这个功能坏了"，
 *    不像"少带了一个 header" —— 排查会从功能本身开始，而不是从这一行开始。
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const tk = readToken()
  if (!tk) return fetch(url, init)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${tk.t}`)
  return fetch(url, { ...init, headers })
}

function postJson(path: string, body: unknown): Promise<AuthResp> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({ ok: false, reason: 'network' } as AuthFail))
}

// ── 四个动作 ────────────────────────────────────────────────────────────

/**
 * 登录 / 注册成功后的统一收尾：令牌与**昵称**一起落到本地。
 *
 * ★ 昵称这一半就是「**登录的时候就该以账号记录为主**」的落点：服务端回的 `nick` 直接写进
 *   本机缓存 ⇒ 换设备登录一次，名字自己就回来了。
 * ⚠️ **服务端回空时不动本机缓存** —— 空的含义是"账号那边还没有昵称"（例如他刚在本机起了名、
 *   只是还没写进账号记录）。此时把本地那份抹掉，等于又制造一次"我的名字没了"。
 */
function adoptIdentity(r: AuthOk) {
  writeToken({ t: r.token, exp: r.exp, name: r.name, nick: r.nick })
  if (r.nick) saveNick(r.nick)
}

/**
 * 注册：取一个**账号名**、设密码，并**绑定一个存档码**。
 *
 * - `playerId` 传**本机当前的码** ⇒ 账号绑到自己手上的这份进度（老玩家 / 已有存档的玩家）
 * - `playerId` 传 `null`/缺省    ⇒ 全新玩家，服务端生成一个新码再绑上去
 * - `nick` 传**本机已有的昵称** ⇒ 一起登记进账号记录（v1.53，「名字跟账号走」从此成立）
 *
 * ⚠️ 绑定之后**只用账号名就能登**；存档码仍然可以作为登录名使用（服务端两种都认），
 *    所以"账号名忘了"不至于把人锁在门外。
 */
export async function register(name: string, password: string, playerId?: string | null, nick?: string): Promise<AuthResp> {
  const body: Record<string, unknown> = { name, password }
  if (playerId) body.playerId = playerId
  if (nick) body.nick = nick
  const r = await postJson('/auth/register', body)
  if (r.ok) adoptIdentity(r)
  return r
}

/**
 * 登录。`login` 既可以是**账号名**，也可以是**存档码** —— 服务端两种都认，
 * 老玩家（阶段 1 用存档码注册的、服务端没有 name 字段）走的就是存档码那条。
 *
 * `nick` = 本机已有的昵称：**只在账号那边还没有昵称时才被采纳**（服务端决定），
 * 所以带着它不会覆盖账号记录里那份（「以账号记录为主」）。
 */
export async function login(login: string, password: string, nick?: string): Promise<AuthResp> {
  const body: Record<string, unknown> = { name: login, password }
  if (nick) body.nick = nick
  const r = await postJson('/auth/login', body)
  if (r.ok) adoptIdentity(r)
  return r
}

/**
 * 登出。本地令牌**无论如何都要清掉** —— 服务端那边删失败（断网）不该让这台设备继续挂着身份。
 */
export async function logout(): Promise<void> {
  const tk = readToken()
  writeToken(null)
  if (!tk) return
  try {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk.t}` },
      body: '{}',
    })
  } catch { /* 服务端没收到也无妨：那份会话最长 180 天后自然过期 */ }
}

/**
 * 令牌换身份。启动时用它判断"这个设备还登着吗"。
 *
 * 返回 `null` 的几种可能（**上层不需要区分**，都走"当作没登录"那条路）：
 * 本地没有令牌 / 令牌已过期（本地就咽掉了）/ 服务端认不出它（sessions 被清、或服务端重启换了机器）
 * / 服务端那边压根没有这个端点或正挂着（见下）。
 *
 * ⚠️ **只有"服务端明确否认"才清令牌** —— 这是本函数最容易写错的地方。
 *    `{ok:false}` + HTTP 200 才是"你这个令牌无效"；而下面这些**都不是**，一律**留着**：
 *      · 404 —— 服务端回滚到了还没有账号体系的版本（端点整个不存在）
 *      · 5xx / 网关的 HTML 错误页 —— 服务端故障
 *      · 回执形状不认识 —— 接口改版
 *    第一版把"非 ok:true"一律当成无效 ⇒ 服务端一故障、一回滚，**所有设过密码的玩家
 *    每次打开都掉登录**，而且令牌已被删掉，服务端修好也救不回来（只能重新登录）。
 *    与红线㉘同型：一个其实是"服务端不在"的响应，被当成了"你的凭证有问题"。
 */
export async function whoAmI(timeoutMs = 2500): Promise<string | null> {
  if (!hasToken()) return null
  // ⚠️ **必须有超时。** 第一版没有，而这个函数在**启动路径的第一跳**上：
  //    服务端"接受了连接但一直不响应"时，它会把整个启动**永久挂住** ——
  //    实测（后端挂起）：页面 20 秒仍是**完全空白**（正文 0 字符），玩家看到的就是白屏。
  //    超时后按"没登录"处理，与断网/服务端故障同一条路：**不动令牌**，用本机档继续玩。
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await apiFetch(`${API}/auth/me`, { signal: ac.signal })
    if (!res.ok) return null                                  // 端点不在 / 服务端故障 ⇒ 留着令牌
    const r = await res.json().catch(() => null)
    if (r && r.ok && typeof r.playerId === 'string') {
      // 把服务端回的 name 补进本地令牌记录（老记录没有它）——这样存档页显示的账号名
      // 永远来自服务端，而不是"上次登录时本地记的那个"。**身份仍然只有 playerId 一个**。
      // ⚠️ 写回要**保留现有的 t/exp**（不能拿回执里的值重建：/auth/me 不回令牌），
      //    所以这里重新读一次本地记录，形状不对就**什么都不做**（不动令牌，保守）。
      const cur = readToken()
      if (cur) {
        // `nick` 一起带回来（v1.53）：启动时就把本机缓存补上，换设备后第一次进榜单页
        // 才不会因为"本机没名字"而拿兜底值去顶榜上的名字。
        const nk = (typeof r.nick === 'string' && r.nick) ? r.nick : cur.nick
        writeToken({
          t: cur.t, exp: cur.exp,
          name: typeof r.name === 'string' ? r.name : cur.name,
          nick: nk,
        })
        // ⚠️ **只在本地确实没有名字时才补**：本地那份可能是玩家刚改、还没同步上去的，
        //    用服务端那份盖掉它 = 把他刚改的名字打回去。
        if (nk && !loadNick()) saveNick(nk)
      }
      return r.playerId
    }
    if (r && r.ok === false) { writeToken(null); return null } // 服务端明确否认 ⇒ 清
    return null                                                // 形状不认识 ⇒ 保守留着
  } catch { return null }   // 断网 / 超时：**不动令牌**（网络恢复后它多半还是有效的）
  finally { clearTimeout(timer) }
}

/** 把服务端的 reason 变成给玩家看的话。**必须如实** —— 别把"账号不存在"和"密码错"分开说。 */
export function authReasonText(r: AuthFail): string {
  switch (r.reason) {
    case 'bad_credentials':
      // 服务端刻意不区分"没这个账号"与"密码不对"（分开说等于告诉试探者账号存不存在）。
      // 客户端也不许自己补一句"是不是名字打错了"。
      return '账号或密码不对。'
    case 'locked':
      return `密码连续输错太多次，请 ${Math.max(1, Math.ceil((r.retryAfter || 0) / 60))} 分钟后再试。`
    case 'taken':
      return '这个存档码已经绑定过账号了。如果那是你自己的，请直接登录；忘了密码请联系管理员。'
    case 'name_taken':
      return '这个账号名已经有人用了，换一个吧。'
    case 'weak_password':
      return `密码太短了，至少要 ${r.min || PW_MIN_HINT} 位。`
    case 'weak_name':
      return `账号名太短了，至少要 ${r.min || NAME_MIN_HINT} 位。`
    case 'network':
      return '连不上服务器，请检查网络后重试。'
    default:
      return '操作没能完成，请稍后再试。'
  }
}