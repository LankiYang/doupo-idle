// 云存档客户端：自动备份 + 手动恢复 + 存档码找回（无账号，playerId 即密钥）
// 安全要点：上传只读本地、不改本地；恢复前先把当前本地存档备份到 .bak，再写回并 reload，
// 走已加固的 load()/migrate() 校验——云端数据万一损坏会自动回退到 .bak，杜绝死档。
import { getPlayerId } from './leaderboardApi'

const API = `${import.meta.env.BASE_URL}api`
const SAVE_KEY = 'doupo-idle-save-v1'
const BAK_KEY = 'doupo-idle-save-v1.bak'
const META_KEY = 'doupo-idle-cloud-meta'

export interface CloudMeta { lastUpload: number; lastHash: string }
export interface CloudSave { data: string; updatedAt: number }
export interface SaveSummary { stage: number; chars: number; coin: number }

function readMeta(): CloudMeta {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) || '{}'); return { lastUpload: m.lastUpload || 0, lastHash: m.lastHash || '' } } catch { return { lastUpload: 0, lastHash: '' } }
}
function writeMeta(m: CloudMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* ignore */ } }

/** 轻量指纹：判断存档是否变化，避免无谓上传 */
function fingerprint(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h + ':' + s.length
}

export function summarizeSave(raw: string): SaveSummary | null {
  try {
    const s = JSON.parse(raw)
    return {
      stage: s.highestStage ?? s.stage ?? 0,
      chars: s.roster && typeof s.roster === 'object' ? Object.keys(s.roster).length : 0,
      coin: Math.floor(s.inventory?.coin ?? 0),
    }
  } catch { return null }
}

/** 上传当前本地存档；force=false 时若内容未变则跳过 */
export async function uploadSave(force = false): Promise<{ ok: boolean; reason?: string; updatedAt?: number }> {
  let data: string | null = null
  try { data = localStorage.getItem(SAVE_KEY) } catch { return { ok: false, reason: 'no-storage' } }
  if (!data) return { ok: false, reason: 'no-save' }
  const fp = fingerprint(data)
  const meta = readMeta()
  if (!force && meta.lastHash === fp) return { ok: false, reason: 'unchanged' }
  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), data }),
    })
    if (r.status === 429) return { ok: false, reason: 'cooldown' }
    if (!r.ok) return { ok: false, reason: 'http' + r.status }
    const j = await r.json()
    writeMeta({ lastUpload: j.updatedAt || Date.now(), lastHash: fp })
    return { ok: true, updatedAt: j.updatedAt }
  } catch { return { ok: false, reason: 'network' } }
}

/** 拉取某 playerId 的云存档（默认自己；传入存档码即跨设备找回） */
export async function downloadSave(playerId = getPlayerId()): Promise<CloudSave | null> {
  try {
    const r = await fetch(`${API}/save?playerId=${encodeURIComponent(playerId)}`)
    if (!r.ok) return null
    const j = await r.json()
    return typeof j?.data === 'string' ? { data: j.data, updatedAt: j.updatedAt } : null
  } catch { return null }
}

/**
 * 应用云存档：先把当前本地存档备份到 .bak（恢复可逆），再写回主存档。
 * 调用方随后 reload，由 load() 校验；若云存档损坏会自动回退 .bak。
 */
export function applyCloudSave(data: string): boolean {
  try {
    const cur = localStorage.getItem(SAVE_KEY)
    if (cur && cur !== data) localStorage.setItem(BAK_KEY, cur)
    localStorage.setItem(SAVE_KEY, data)
    return true
  } catch { return false }
}

export function getCloudMeta(): CloudMeta { return readMeta() }

let started = false
/** 全局自动云备份：启动即传一次，之后每 3 分钟（仅在存档变化时）+ 切后台/关页面尽力传一次 */
export function startCloudSync(intervalMs = 180000) {
  if (started) return
  started = true
  void uploadSave()
  setInterval(() => { void uploadSave() }, intervalMs)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void uploadSave() })
  window.addEventListener('pagehide', () => {
    try {
      const data = localStorage.getItem(SAVE_KEY)
      if (data && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ playerId: getPlayerId(), data })], { type: 'application/json' })
        navigator.sendBeacon(`${API}/save`, blob)
      }
    } catch { /* best-effort */ }
  })
}
