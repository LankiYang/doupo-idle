// AI 军师（云韵）后端客户端 —— 流式对话。
//
// 与其它 API 客户端的**关键差别**：这里回的不是一次性的 JSON，而是 SSE 流。
// 所以不能用 EventSource（它只能 GET、不能带请求体、也不能自定义头），
// 必须 `fetch` + 手读 `res.body`。
//
// ⚠️ 身份走的是**与 `/save` 同一条路**（`getPlayerId()` + `apiFetch` 自动带的令牌）。
//    这一点是有意为之：正式服此刻灰度 0% ⇒ 绝大多数玩家是**本地模式、没有账号**，
//    若这个功能只认登录账号，那它就只有那 6 个账号能用。带着 playerId 走，
//    每个有云档的玩家都能用。
//
// ⚠️ **playerId 只发给我们自己的后端，绝不发给模型。** 后端（`api.cjs`）逐个字段手写
//    取档案、绝不 spread，出站请求体里不会有它 —— 这条有端到端判据守着
//    （`temp/probe-ai-http.cjs` 的 D15/D16，直接搜**出站字节流**）。
import { apiFetch } from './authApi'
import { getPlayerId } from './leaderboardApi'

const API = `${import.meta.env.BASE_URL}api`

/**
 * 军师状态。
 *
 * ⚠️ `null` 与 `{enabled:false}` **不是一回事**，别合并：
 *   · `{enabled:false}` = 后端明确说"这个功能没开"（没配 key）
 *   · `null`           = **没问到**（断网 / 后端还是老版本、没这个端点 / 回执形状不认识）
 * 两者的界面处理相同（都是藏掉入口），但混成一个值之后，"实际上是断网却被当成
 * 功能没开"这类问题就再也查不出来了。本项目在 `fetchNick()` 的 ``（还没起名）
 * 与 `null`（没问到）上刚立过同一条规矩。
 */
export interface AiStatus { enabled: boolean; advisor: string }

export async function fetchAiStatus(timeoutMs = 2500): Promise<AiStatus | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await apiFetch(`${API}/ai/status`, { signal: ac.signal, cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    if (!j || j.ok !== true || typeof j.enabled !== 'boolean') return null
    return { enabled: j.enabled, advisor: typeof j.advisor === 'string' ? j.advisor : 'yunyun' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 一次最多带给服务端多少**轮**（一问一答算一轮）。
 * ⚠️ 与后端 `api/ai.cjs` 的 `MAX_HISTORY = 40`（= 20 轮）**必须对齐** ——
 * 前端带 10 条而服务端肯收 40 条，等于没放宽；反之则白发一段字数。
 * 改这里要**同时**改 `AdvisorView` 的 `KEEP_TURNS`（本地存几轮）与后端那个常量。
 */
export const MAX_TURNS = 20

/**
 * 一句历史发言。
 * ⚠️ 本地存的是 `text`；**发给服务端的字段名是 `content`**（组装请求体时映射，见 askAdvisor）。
 *   这两个名字不一样是有历史原因的（后端 `sanitizeHistory` 优先认 `content`），
 *   而 2026-09-22 那次"军师完全没有上下文"就是这个差异造成的：直接发了 `text`，
 *   服务端一条都认不出、整段历史被**静默**丢掉。
 */
export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface ChatHandlers {
  /** 收到一小段文字（**增量**，调用方自己往后面拼） */
  onText: (t: string) => void
  /** 正常收尾。`usage` 后端的口径是 `{in, out}`（token 数），可能没有 */
  onDone: (usage?: { in?: number; out?: number }) => void
  /**
   * 失败。`reason` 一律是**服务端的原文**（`rate` / `daily_quota` / `not_owned` /
   * `ai_disabled` / `no_save` / `bad_id` / `need_login` / `internal` / …），
   * 外加客户端自己造的 `network`。**不要在客户端另造一套词** —— 两组词一分叉，
   * "到底是谁拒绝的"就永远说不清了。
   *
   * `retryAfter`（秒）只在限频时给：**必须带出来**，否则界面只能说"稍候再问"，
   * 而玩家不知道要等 3 秒还是 3 分钟 —— 他会一直点。（实测：第一版就把它丢了。）
   */
  onError: (reason: string, detail?: string, retryAfter?: number) => void
}

/**
 * 问一句，流式收回复。
 *
 * 返回一个 `abort()` —— 玩家关掉聊天框时**必须调它**：服务端那边也挂了
 * `res.on('close')` 会停止生成，但客户端主动断开更干脆（少一次来回）。
 * 不回 `Promise` 的成败：结果全部从 `handlers` 走，调用方只关心"文字怎么追加"。
 */
export function askAdvisor(
  charId: string,
  question: string,
  history: ChatTurn[],
  handlers: ChatHandlers,
): () => void {
  const ac = new AbortController()
  ;(async () => {
    let res: Response
    try {
      res = await apiFetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ 两个都别改错：
        //   ① **字段名发 `content`** —— 服务端 `sanitizeHistory` 认的是它。这里原来直接把内部的
        //      `{role, text}` 发出去了 ⇒ 服务端**一条都认不出**、整段历史被静默丢掉
        //      （2026-09-22 实测 2 条进 0 条出）⇒ 军师**完全没有上下文**，而接口一切正常。
        //      （服务端现在两种都认，是为了玩家浏览器里缓存的旧 JS 也还能用。）
        //   ② 带最近 `MAX_TURNS * 2` 条 = 20 轮：聊到第 21 句才开始忘最早那句。
        body: JSON.stringify({
          playerId: getPlayerId(), charId, question,
          history: history.slice(-MAX_TURNS * 2).map(t => ({ role: t.role, content: t.text })),
        }),
        signal: ac.signal,
      })
    } catch {
      if (!ac.signal.aborted) handlers.onError('network')
      return
    }

    // ⚠️ **必须分辨两种 200**：正常是 `text/event-stream`，而所有"没开始流"的
    //    拒绝路径（rate / daily_quota / ai_disabled / no_save …）回的都是一次性 JSON。
    //    只看 `res.ok` 的话，这些会被当成"sse 流"去读 body、一个 `data:` 帧都解析不出来，
    //    界面表现是"军师不回话，但也不报错" —— 最难查的那种。
    const ctype = res.headers.get('Content-Type') || ''
    if (!ctype.includes('text/event-stream') || !res.body) {
      let reason = 'network', detail: string | undefined, retryAfter: number | undefined
      try {
        const j = await res.json()
        if (j && typeof j.reason === 'string') reason = j.reason
        if (j && typeof j.detail === 'string') detail = j.detail
        // ⚠️ `retryAfter` 一起读出来：限频那条回包里有它，丢了界面就只能说"稍候再问"。
        if (j && typeof j.retryAfter === 'number') retryAfter = j.retryAfter
        // 完全没有 reason 的（网关的 HTML 错误页、404 页）也算 network：
        // 那是"没连上后端"，不是"后端拒绝了你"。
      } catch { /* 不是 JSON ⇒ 保持 network */ }
      handlers.onError(reason, detail, retryAfter)
      return
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let finished = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const seg = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const line = seg.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let o: { t?: unknown; done?: unknown; error?: unknown; detail?: unknown; retryAfter?: unknown; usage?: { in?: number; out?: number } }
          try { o = JSON.parse(line.slice(6)) } catch { continue }   // 半帧/坏帧：跳过，不打断整段对话
          if (typeof o.t === 'string') handlers.onText(o.t)
          else if (o.done) { finished = true; handlers.onDone(o.usage) }
          else if (typeof o.error === 'string') {
            finished = true
            handlers.onError(o.error, typeof o.detail === 'string' ? o.detail : undefined,
              typeof o.retryAfter === 'number' ? o.retryAfter : undefined)
          }
        }
      }
    } catch {
      // 读取中途断了（网络抖 / 被 abort）
      if (!ac.signal.aborted && !finished) handlers.onError('network')
      return
    }
    // 流结束了却既没有 done 也没有 error —— 连接被**从中间掐断**（nginx 超时、服务端崩了）。
    // 不补这一条的话，界面会停在"文字流到一半、光标一直闪"，而玩家以为它还在想。
    if (!finished && !ac.signal.aborted) handlers.onError('network')
  })()

  return () => { try { ac.abort() } catch { /* 已经结束了 */ } }
}