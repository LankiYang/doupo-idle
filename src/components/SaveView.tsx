import { useEffect, useState } from 'react'
import { game } from '../game/engine'
import { getPlayerId, setPlayerId, agoText } from '../game/leaderboardApi'
import { uploadSave, downloadSave, applyCloudSave, getCloudMeta, summarizeSave, type CloudSave } from '../game/saveApi'

type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null

/** 仅用于显示：把存档码每 4 位分组，方便肉眼核对（复制/恢复都用原始值） */
function groupCode(id: string): string {
  return (id.match(/.{1,4}/g) || []).join(' ')
}

export default function SaveView() {
  const playerId = getPlayerId()
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [lastUpload, setLastUpload] = useState(() => getCloudMeta().lastUpload)
  const [pending, setPending] = useState<{ save: CloudSave; viaCode: boolean; pid: string } | null>(null)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    downloadSave().then(s => { if (live && s) setLastUpload(prev => Math.max(prev, s.updatedAt)) })
    return () => { live = false }
  }, [])

  async function doBackup() {
    setBusy(true); setMsg(null)
    const r = await uploadSave(true)
    setBusy(false)
    if (r.ok) { const t = r.updatedAt || Date.now(); setLastUpload(t); setMsg({ kind: 'ok', text: '✓ 已备份到云端' }) }
    else if (r.reason === 'cooldown') setMsg({ kind: 'info', text: '刚刚备份过，请稍后再试' })
    else setMsg({ kind: 'err', text: '备份失败（网络/服务暂不可用），本地存档不受影响' })
  }

  async function fetchRestore(viaCode: boolean) {
    setBusy(true); setMsg(null)
    const pid = viaCode ? code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : playerId
    if (viaCode && pid.length < 8) { setBusy(false); setMsg({ kind: 'err', text: '存档码格式无效' }); return }
    const save = await downloadSave(pid)
    setBusy(false)
    if (!save) { setMsg({ kind: 'err', text: viaCode ? '没找到该存档码对应的云存档' : '云端还没有你的存档（先点「立即备份」）' }); return }
    setPending({ save, viaCode, pid })
  }

  function confirmRestore() {
    if (!pending) return
    game.suspendSave() // 先挂起本地保存，避免 reload 时 beforeunload 的 save 用旧内存态覆盖云存档
    // 身份与存档必须一起搬：用存档码恢复时同步 playerId，
    // 否则恢复来的进度会挂在新生成的 id 下继续上传，原存档码的云端档从此停更、榜单记录错位
    if (pending.viaCode) setPlayerId(pending.pid)
    if (!applyCloudSave(pending.save.data)) { setMsg({ kind: 'err', text: '写入本地失败' }); setPending(null); return }
    setPending(null)
    window.location.reload() // 重载后由加固版 load() 校验应用；云端数据若损坏会自动回退 .bak
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(playerId); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setMsg({ kind: 'info', text: '自动复制失败，请手动选中存档码复制' }) }
  }

  let localRaw: string | null = null
  try { localRaw = localStorage.getItem('doupo-idle-save-v1') } catch { /* ignore */ }
  const localSum = localRaw ? summarizeSave(localRaw) : null
  const cloudSum = pending ? summarizeSave(pending.save.data) : null
  const msgColor = msg ? (msg.kind === 'ok' ? 'text-green-400' : msg.kind === 'err' ? 'text-red-400' : 'text-[#a89478]') : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-1 text-dq-gold">云存档</div>
        <div className="mb-3 text-sm text-[#a89478]">
          进度会自动备份到服务器（每 3 分钟 + 关闭页面时）。换设备或清了浏览器数据，用下方「存档码」即可找回。
        </div>

        <div className="mb-3 flex items-center justify-between rounded border border-dq-border px-3 py-2 text-sm">
          <span className="text-[#a89478]">最近云端备份</span>
          <span className="text-dq-gold">{lastUpload ? agoText(lastUpload) : '尚未备份'}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={doBackup} disabled={busy}
            className="rounded bg-dq-gold px-3 py-1.5 text-sm text-black disabled:opacity-40">立即备份</button>
          <button onClick={() => fetchRestore(false)} disabled={busy}
            className="rounded border border-dq-border px-3 py-1.5 text-sm text-[#e8dcc8] hover:border-dq-gold disabled:opacity-40">从云端恢复</button>
        </div>
        {msg && <div className={`mt-2 text-xs ${msgColor}`}>{msg.text}</div>}
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-4">
        <div className="mb-1 text-dq-gold">我的存档码</div>
        <div className="mb-2 text-xs text-[#a89478]">
          这就是你的「身份钥匙」，谁拿到都能读取/覆盖这份存档——请自行保密备份（截图或抄下来）。换了设备/浏览器，用它找回进度。
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded border border-dq-border bg-black/40 px-2 py-1.5 text-xs text-dq-gold">{groupCode(playerId)}</code>
          <button onClick={copyCode} className="shrink-0 rounded bg-dq-gold px-3 py-1.5 text-sm text-black">{copied ? '已复制' : '复制'}</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="粘贴存档码以找回"
            className="min-w-0 flex-1 rounded border border-dq-border bg-black/30 px-2 py-1.5 text-xs text-dq-gold outline-none focus:border-dq-gold" />
          <button onClick={() => fetchRestore(true)} disabled={busy || code.trim().length < 8}
            className="shrink-0 rounded border border-dq-border px-3 py-1.5 text-xs text-[#e8dcc8] hover:border-dq-gold disabled:opacity-40">找回</button>
        </div>
      </div>

      {pending && (
        <div className="dq-panel w-full max-w-xl rounded-md border border-dq-fire p-4">
          <div className="mb-2 text-dq-fire">确认恢复云存档？</div>
          <div className="space-y-1 text-sm">
            <div className="text-[#a89478]">
              云端：<span className="text-[#e8dcc8]">第 {cloudSum?.stage ?? '?'} 关 · {cloudSum?.chars ?? '?'} 名角色 · 灵金 {cloudSum ? cloudSum.coin : '?'}</span>
              <span className="ml-2 text-[#5a4a38]">备份于 {agoText(pending.save.updatedAt)}</span>
            </div>
            {localSum && (
              <div className="text-[#a89478]">
                当前本地：<span className="text-[#e8dcc8]">第 {localSum.stage} 关 · {localSum.chars} 名角色 · 灵金 {localSum.coin}</span>
              </div>
            )}
          </div>
          <div className="mt-2 text-xs text-[#a89478]">
            恢复将用云端存档<span className="text-dq-fire">覆盖当前本地进度</span>；当前本地会自动备份，恢复后若反悔可再用「从云端恢复」前的本地备份回退。
            {pending.viaCode && (
              <span className="mt-1 block text-dq-gold">
                本机「存档码」也会同步成这份存档的码，之后进度都备份到该码名下。
              </span>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={confirmRestore} className="rounded bg-dq-fire px-3 py-1.5 text-sm text-black">确认恢复</button>
            <button onClick={() => setPending(null)} className="rounded border border-dq-border px-3 py-1.5 text-sm text-[#e8dcc8] hover:border-dq-gold">取消</button>
          </div>
        </div>
      )}

      <div className="w-full max-w-xl text-center text-[10px] leading-relaxed text-[#5a4a38]">
        无账号体系：存档以匿名存档码标识，服务器只存你上传的存档数据。存档码丢失则无法找回，请务必自行备份。
      </div>
    </div>
  )
}
