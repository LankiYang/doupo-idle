import { useEffect, useState } from 'react'
import { game } from '../game/engine'
import { getPlayerId, setPlayerId, agoText } from '../game/leaderboardApi'
import { downloadSave, getCloudMeta } from '../game/saveApi'
import { SAVE_KEY } from '../game/storageKeys'
import { hasToken, getAuthName, register, login, logout, authReasonText, PW_MIN_HINT, NAME_MIN_HINT } from '../game/authApi'
import { loadNick } from '../game/nickname'

type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null

/** 仅用于显示：把存档码每 4 位分组，方便肉眼核对（复制用原始值） */
function groupCode(id: string): string {
  return (id.match(/.{1,4}/g) || []).join(' ')
}

/** 账号名/存档码都走这一个清洗：服务端字符集是 `[A-Za-z0-9_-]`，且统一小写 */
const cleanLogin = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')

export default function SaveView() {
  const playerId = getPlayerId()
  const [busy, setBusy] = useState(false)
  const [lastUpload, setLastUpload] = useState(() => getCloudMeta().lastUpload)
  const [copied, setCopied] = useState(false)
  // ── 账号（v2.0）────────────────────────────────────────────────────
  // `hasToken()` / `getAuthName()` 读的都是本地令牌，只在挂载时算一次即可：本页自己发起的
  // 注册/登录/退出都会立刻 setSignedIn，而跨标签页改令牌是罕见情形（真发生了刷新一下就好）。
  const [signedIn, setSignedIn] = useState(() => hasToken())
  /** 账号名（没登录 / 老账号没名字时为 null，显示层退回存档码掩码）—— 纯显示用，不是身份 */
  const authName = getAuthName()
  const [authMsg, setAuthMsg] = useState<Msg>(null)
  // 注册区（用户要求「注册和登录分开」，所以这里是两块独立的表单，各有各的态）
  const [regName, setRegName] = useState('')
  const [regPw1, setRegPw1] = useState('')
  const [regPw2, setRegPw2] = useState('')
  const [regCode, setRegCode] = useState(playerId)   // 预填本机码：老玩家**不用手打那 32 位**
  // 登录区
  const [loginName, setLoginName] = useState('')
  const [loginPw, setLoginPw] = useState('')

  useEffect(() => {
    let live = true
    downloadSave().then(s => { if (live && s) setLastUpload(prev => Math.max(prev, s.updatedAt)) })
    return () => { live = false }
  }, [])

  // ── 手动备份 / 从云端恢复 / 粘贴存档码找回：**已于 2026-09-18 全部收掉** ──────
  // 用户原话：「没有手动拉取云端存档操作了，就是实时的，你有多少钱都是从后端读取的，
  // 一个网游的架构，你只需要登陆账号，变成一个真正的网游。」
  // 所以这一页只剩两件事：**认账号**（注册 / 登录 / 退出）和**把存档码交给玩家自己保管**。
  // 进度由启动序列（`pullAuthoritative`）与自动上报接管，不再让玩家操心备份与恢复。
  //
  // ⚠️ 收掉「粘贴存档码以找回」之后，"换设备进老档"的唯一入口就只剩**注册**（绑定自己的码）——
  //    所以注册区必须预填本机码、且明确告诉玩家"填你原来那串码"。少这一条，
  //    没设过密码的老玩家就再也进不来自己的档了（那是收按钮时最容易犯的错）。

  async function copyCode() {
    try { await navigator.clipboard.writeText(playerId); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setAuthMsg({ kind: 'info', text: '自动复制失败，请手动选中存档码复制' }) }
  }

  /** 登录/认领成功后**唯一的**切换动作：挂起保存 → 落身份 → 重载（重载后由启动序列拉云端那份） */
  function enterAs(pid: string) {
    setPlayerId(pid)
    // ⚠️ 换账号**必须**挂起保存：否则 reload 时 beforeunload 会把**当前账号**的存档写回
    //    SAVE_KEY，而启动序列已经认为这份档属于新账号了（saveApi 的 owner 检测会把它挪走，
    //    虽然结果是安全的，但等于白写一次、还会在 .switched 里留下一份半新的档）。
    game.suspendSave()
    // ⚠️ 远程模式下还要**把本机那份副本清掉**（`SAVE_KEY` 此刻装的是上一个人的状态，
    //    由引擎的 `writeCache` 写的）。不清的话，如果重载后第一个 `/state` 拉不到
    //    （断网 / 后端没起来），首屏会拿本机副本渲染 —— 于是**新账号看到上一个人的进度**，
    //    数字全是对的、只是不是他的，这种错玩家一眼看不出是 bug。
    //    清掉之后那种情形渲染的是全新档，「重连中」+ 只读，一眼就知道没连上。
    // ⚠️ **只有远程模式才清**：本地模式下这份就是玩家唯一的档，清掉 = 丢档。
    //    判断依据是"云端有没有那份" —— 远程模式下服务端始终是权威且只多不少
    //    （客户端一个字节都不往回传），所以本机这份纯粹是副本。
    if (game.isRemote()) {
      try { localStorage.removeItem(SAVE_KEY) } catch { /* 隐私模式：写不进去也一样能跑 */ }
    }
    window.location.reload()
  }

  // ── 账号（v2.0）──────────────────────────────────────────────────────
  /**
   * **注册**：取账号名 + 设密码 + 绑定一个存档码。用户明确要求「注册和登录分开」，
   * 所以这是一个独立动作，不会去"顺便登录"谁 —— 失败就只说失败。
   *
   * ⚠️ 存档码输入框**预填了本机当前码**（见 useState 初值）：老玩家换设备时改填自己原来
   *    那串即可，**不用手打 32 位**；把它清空 = 全新玩家，服务端会发一个新码。
   */
  async function doRegister() {
    const name = cleanLogin(regName)
    const code = cleanLogin(regCode)
    if (name.length < NAME_MIN_HINT) { setAuthMsg({ kind: 'err', text: `账号名至少 ${NAME_MIN_HINT} 位（字母、数字、下划线、减号）` }); return }
    if (regPw1.length < PW_MIN_HINT) { setAuthMsg({ kind: 'err', text: `密码至少 ${PW_MIN_HINT} 位` }); return }
    if (regPw1 !== regPw2) { setAuthMsg({ kind: 'err', text: '两次输入的密码不一样' }); return }
    if (code && code.length < 8) { setAuthMsg({ kind: 'err', text: '存档码格式无效（清空它则新建一份进度）' }); return }
    setBusy(true); setAuthMsg(null)
    // `code` 为空 ⇒ 传 undefined ⇒ 服务端发新码（全新玩家）
    // 最后那个参数 = **本机已有的昵称**（v1.53）：注册时把它一起登记进账号记录，
    // "名字跟账号走"从这一刻成立 —— 以后换设备登录，名字自己就跟着回来了。
    // ⚠️ 本机没有名字时传 undefined（**不是**「无名侠客」）：宁可账号里先空着，
    //    也不能把一个默认值当成他的真名写进去（那会把他锁在"无名侠客"上）。
    const r = await register(name, regPw1, code || undefined, loadNick() || undefined)
    setBusy(false)
    if (!r.ok) { setAuthMsg({ kind: 'err', text: authReasonText(r) }); return }
    setRegPw1(''); setRegPw2('')
    setSignedIn(true)
    // ⚠️ 这里**不能** suspendSave：注册/绑码没动进度，而挂起保存后 reload 会让这段时间的
    //    挂机产出不落盘。让 beforeunload 正常存一次即可（账号只是身份，与存档无关）。
    //    ⚠️ 但如果绑定的是**另一个**存档码（老玩家换设备），`enterAs` 会挂起保存 —— 那种
    //    情况下不挂起就会把本机那份新档写回、和启动序列的归属判定打架。
    if (code && code !== playerId) { enterAs(r.playerId); return }
    window.location.reload()
  }

  /**
   * **登录**：账号名**或**存档码 + 密码。与注册分开，**不做**任何自动认领 ——
   * 找不到账号就如实说"账号或密码不对"，并提示去注册。
   */
  async function doLogin() {
    const name = cleanLogin(loginName)
    if (name.length < NAME_MIN_HINT) { setAuthMsg({ kind: 'err', text: '账号名格式无效' }); return }
    if (!loginPw) { setAuthMsg({ kind: 'err', text: '请输入密码' }); return }
    setBusy(true); setAuthMsg(null)
    // 最后那个参数 = 本机已有的昵称（v1.53）。它**只在账号那边还没有昵称时**才被采纳
    // （服务端决定），所以带着它不会盖掉账号记录里那份 —— 「以账号记录为主」就是这条。
    // 反过来，账号里那份会被服务端回执带回来并写进本机缓存（`adoptIdentity`）⇒ 换设备登录一次，
    // 名字自动回到这台机器上，**不经过排行榜那页、也不需要再上一次榜**。
    const r = await login(name, loginPw, loadNick() || undefined)
    setBusy(false)
    if (!r.ok) { setAuthMsg({ kind: 'err', text: authReasonText(r) }); return }
    setAuthMsg({ kind: 'ok', text: '登录成功，正在载入云端的进度…' })
    enterAs(r.playerId)
  }

  async function doLogout() {
    setBusy(true)
    await logout()
    setBusy(false)
    setSignedIn(false)
    setAuthMsg({ kind: 'info', text: '已退出登录。本机仍可继续玩当前这份进度，只是不再使用账号身份。' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto p-3 sm:p-6">
      {/* ── 账号（v2.0）。⚠️ 本面板内**不要出现 `<code>` 标签** —— 回归脚本
          repro-restore-id.cjs 用 `p.locator('code').first()` 取存档码，
          这里插一个更靠前的 <code> 会让它取错元素（老锚点）。 ── */}
      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-1 text-dq-gold">账号</div>

        {signedIn ? (
          <>
            <div className="mb-2 text-sm text-[#a89478]">
              已登录 ·{' '}
              <span className="text-[#e8dcc8]">{authName || playerId.slice(0, 4) + '……' + playerId.slice(-4)}</span>
              {authName && <span className="ml-1 text-xs text-[#5a4a38]">（账号名）</span>}
            </div>
            <div className="mb-3 text-xs text-[#a89478]">
              任何设备登这个账号，拿到的都是同一份进度。换设备时用「账号名 + 密码」登录即可。
            </div>
            <button onClick={doLogout} disabled={busy}
              className="rounded border border-dq-border px-3 py-1.5 text-sm text-[#e8dcc8] hover:border-dq-gold disabled:opacity-40">退出登录</button>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm text-[#a89478]">
              有了账号，进度就跟着账号走 —— <span className="text-dq-gold">任何设备登同一个账号，都是同一份进度</span>。
            </div>

            {/* ── 注册 ─────────────────────────────────────────────── */}
            <div className="mb-1 text-xs text-dq-gold">注册</div>
            <div className="mb-2 flex flex-wrap gap-2">
              <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="账号名（6 位以上）"
                autoComplete="username"
                className="min-w-[9rem] flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
              <input type="password" value={regPw1} onChange={e => setRegPw1(e.target.value)} placeholder="新密码"
                autoComplete="new-password"
                className="min-w-[9rem] flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
              <input type="password" value={regPw2} onChange={e => setRegPw2(e.target.value)} placeholder="再输一次"
                autoComplete="new-password"
                className="min-w-[9rem] flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
              <button onClick={doRegister} disabled={busy || !regName || !regPw1 || !regPw2}
                className="dq-tap-lg inline-flex shrink-0 items-center justify-center rounded bg-dq-gold px-3 py-1.5 text-xs text-black disabled:opacity-40">注册</button>
            </div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <input value={regCode} onChange={e => setRegCode(e.target.value)} placeholder="存档码（留空 = 新建一份进度）"
                className="min-w-[9rem] flex-1 basis-full rounded border border-dq-border bg-black/30 px-2 py-1.5 text-[10px] text-dq-gold outline-none focus:border-dq-gold sm:basis-0" />
              <button onClick={() => setRegCode(playerId)} disabled={regCode === playerId}
                className="dq-tap inline-flex shrink-0 items-center justify-center rounded border border-dq-border px-2 py-1 text-[10px] text-[#e8dcc8] hover:border-dq-gold disabled:opacity-40">填本机码</button>
            </div>
            <div className="mb-3 text-[10px] text-[#5a4a38]">
              账号名与密码都至少 {NAME_MIN_HINT} 位，只能用字母、数字、下划线、减号。
              <br />
              <span className="text-dq-gold">存档码已预填成本机这份</span> —— 直接注册就能把手上的进度绑上账号。
              <span className="text-dq-gold">换设备/清了数据的人，请把这个框改成你原来那串存档码</span>
              （就是从前那串 32 位码，没有它就只能新建）。
              留空则服务端发一份全新进度。
            </div>

            {/* ── 登录（与注册分开，各走各的）────────────────────── */}
            <div className="mb-1 text-xs text-dq-gold">登录</div>
            <div className="flex flex-wrap gap-2">
              <input value={loginName} onChange={e => setLoginName(e.target.value)} placeholder="账号名 / 存档码"
                autoComplete="username"
                className="min-w-[9rem] flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
              <input type="password" value={loginPw} onChange={e => setLoginPw(e.target.value)} placeholder="密码"
                autoComplete="current-password"
                className="min-w-[9rem] flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
              <button onClick={doLogin} disabled={busy || !loginName || !loginPw}
                className="dq-tap-lg inline-flex shrink-0 items-center justify-center rounded border border-dq-border px-3 py-1.5 text-xs text-[#e8dcc8] hover:border-dq-gold disabled:opacity-40">登录</button>
            </div>
            <div className="mt-2 text-[10px] text-[#5a4a38]">
              登录别的账号会切换成本机那份进度，本机当前进度会自动留档（可后悔）。
              账号名忘了也没关系 —— <span className="text-dq-gold">用存档码当账号名照样能登</span>。
            </div>
          </>
        )}

        {authMsg && (
          <div className={`mt-2 text-xs ${authMsg.kind === 'ok' ? 'text-green-400' : authMsg.kind === 'err' ? 'text-red-400' : 'text-[#a89478]'}`}>
            {authMsg.text}
          </div>
        )}
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-1 text-dq-gold">云存档</div>
        <div className="mb-3 text-sm text-[#a89478]">
          进度<span className="text-dq-gold">自动</span>备份到服务器（每 3 分钟 + 关闭页面时），也在打开时自动取回 ——
          <span className="text-dq-gold">没有需要你手动点的按钮</span>。
        </div>

        <div className="flex items-center justify-between rounded border border-dq-border px-3 py-2 text-sm">
          <span className="text-[#a89478]">最近云端备份</span>
          <span className="text-dq-gold">{lastUpload ? agoText(lastUpload) : '尚未备份'}</span>
        </div>
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-1 text-dq-gold">我的存档码</div>
        <div className="mb-2 text-xs text-[#a89478]">
          存档码是这份进度的凭据。注册账号后它就是你的<span className="text-dq-gold">备用登录名</span>（账号名忘了也能用它登）。
          没绑账号之前，谁拿到这串码都能读写这份存档 —— 请自行保密（截图或抄下来）。
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded border border-dq-border bg-black/40 px-2 py-1.5 text-xs text-dq-gold">{groupCode(playerId)}</code>
          <button onClick={copyCode} className="dq-tap-lg inline-flex shrink-0 items-center justify-center rounded bg-dq-gold px-3 py-1.5 text-sm text-black">{copied ? '已复制' : '复制'}</button>
        </div>
      </div>

      <div className="w-full max-w-xl text-center text-[10px] leading-relaxed text-[#5a4a38]">
        进度由服务器保存，打开即取回。注册账号后，任何设备登同一个账号都是同一份进度。
        存档码请自行备份（账号名忘了可以用它登）；密码不设找回，忘记了请联系管理员。
      </div>
    </div>
  )
}
