// 焚炎异录 · 群雄榜后端 API（纯 Node http，零依赖，JSON 原子写，含校验+限频）
// 仅监听 127.0.0.1，对外经 nginx 反代 /doupo/api/ 暴露。
// GET /health | GET /leaderboard?limit=N | GET /me?playerId=X | POST /score
// GET /save?playerId=X | POST /save  （无账号云存档:playerId 即密钥，按玩家分文件存）
// 注意：纯前端游戏客户端可被伪造请求，本服务只做基础校验，无法 100% 防刷。
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')

const HOST = '127.0.0.1'
const PORT = 8787
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json')
const SAVES_DIR = path.join(DATA_DIR, 'saves')   // 云存档:每个玩家一个文件,避免整库重写
const NAME_MAX = 12
const POWER_CAP = 1e15
const STAGE_CAP = 1e7
const BODY_LIMIT = 8 * 1024
const SAVE_MAX = 512 * 1024       // 单份云存档上限 512KB
const SAVE_COOLDOWN = 10000       // 同一玩家两次上传最小间隔(ms)
const SUBMIT_COOLDOWN = 5000
const IP_WINDOW = 60000
const IP_MAX = 240

let entries = new Map()          // playerId -> {playerId,name,power,stage,updatedAt}
const lastSubmit = new Map()     // playerId -> ts
const saveLast = new Map()       // playerId -> ts（云存档上传冷却）
const ipHits = new Map()         // ip -> [ts,...]

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    if (Array.isArray(arr)) entries = new Map(arr.filter(e => e && e.playerId).map(e => [e.playerId, e]))
  } catch { entries = new Map() }
}
let writing = false, pending = false
function schedulePersist() { if (writing) { pending = true; return } writing = true; setImmediate(flush) }
function flush() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const arr = [...entries.values()].sort((a, b) => b.power - a.power)
    const tmp = DATA_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(arr))
    fs.renameSync(tmp, DATA_FILE)
  } catch (e) { console.error('[persist]', e.message) }
  writing = false
  if (pending) { pending = false; schedulePersist() }
}
function sorted() { return [...entries.values()].sort((a, b) => b.power - a.power) }
function rankOf(playerId) {
  const list = sorted()
  const i = list.findIndex(e => e.playerId === playerId)
  return { rank: i < 0 ? null : i + 1, total: list.length, entry: i < 0 ? null : list[i] }
}
function publicRow(e, rank) { return { rank, name: e.name, power: e.power, stage: e.stage, updatedAt: e.updatedAt } }
function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
  res.end(body)
}

function cleanName(v) {
  if (typeof v !== 'string') return '无名侠客'
  let s = ''
  for (const ch of v) { const c = ch.codePointAt(0); if (c >= 32 && c !== 127) s += ch }
  s = s.trim().slice(0, NAME_MAX)
  return s || '无名侠客'
}
function validId(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v) }
function num(v, cap) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= cap ? Math.floor(n) : null }

function ipAllowed(ip) {
  const now = Date.now()
  let arr = ipHits.get(ip)
  if (!arr) { arr = []; ipHits.set(ip, arr) }
  while (arr.length && now - arr[0] > IP_WINDOW) arr.shift()
  if (arr.length >= IP_MAX) return false
  arr.push(now)
  return true
}
function readBody(req, max = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > max) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// 云存档:每个玩家一个 JSON 文件(playerId 已校验为 [A-Za-z0-9_-]，无路径穿越风险)
function savePath(pid) { return path.join(SAVES_DIR, pid + '.json') }
function readSave(pid) {
  try { return JSON.parse(fs.readFileSync(savePath(pid), 'utf8')) } catch { return null }
}
function writeSave(pid, data) {
  if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true })
  const p = savePath(pid)
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ data, updatedAt: Date.now() }))
  fs.renameSync(tmp, p)
}

const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
  if (!ipAllowed(ip)) return send(res, 429, { error: 'too many requests' })
  const u = new URL(req.url, 'http://localhost')
  const route = u.pathname.replace(/\/+$/, '') || '/'

  try {
    if (req.method === 'GET' && route === '/health') return send(res, 200, { ok: true, total: entries.size })

    if (req.method === 'GET' && route === '/leaderboard') {
      const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get('limit') || '100', 10) || 100))
      const list = sorted().slice(0, limit).map((e, i) => publicRow(e, i + 1))
      return send(res, 200, { entries: list, total: entries.size })
    }

    if (req.method === 'GET' && route === '/me') {
      const pid = u.searchParams.get('playerId') || ''
      if (!validId(pid)) return send(res, 200, { entry: null, rank: null, total: entries.size })
      const r = rankOf(pid)
      return send(res, 200, { entry: r.entry ? publicRow(r.entry, r.rank) : null, rank: r.rank, total: r.total })
    }

    if (req.method === 'POST' && route === '/score') {
      const raw = await readBody(req)
      let body
      try { body = JSON.parse(raw) } catch { return send(res, 400, { error: 'invalid json' }) }
      const pid = body.playerId
      if (!validId(pid)) return send(res, 400, { error: 'invalid playerId' })
      const power = num(body.power, POWER_CAP)
      if (power === null) return send(res, 400, { error: 'invalid power' })
      const stage = body.stage === undefined ? 0 : (num(body.stage, STAGE_CAP) ?? 0)
      const now = Date.now()
      const last = lastSubmit.get(pid) || 0
      if (now - last < SUBMIT_COOLDOWN) return send(res, 429, { error: 'cooldown' })
      lastSubmit.set(pid, now)
      const name = cleanName(body.name)
      entries.set(pid, { playerId: pid, name, power, stage, updatedAt: now })
      schedulePersist()
      const r = rankOf(pid)
      return send(res, 200, { rank: r.rank, total: r.total })
    }

    if (req.method === 'GET' && route === '/save') {
      const pid = u.searchParams.get('playerId') || ''
      if (!validId(pid)) return send(res, 400, { error: 'invalid playerId' })
      const s = readSave(pid)
      if (!s || typeof s.data !== 'string') return send(res, 404, { error: 'not found' })
      return send(res, 200, { data: s.data, updatedAt: s.updatedAt })
    }

    if (req.method === 'POST' && route === '/save') {
      const raw = await readBody(req, SAVE_MAX + 2048)
      let body
      try { body = JSON.parse(raw) } catch { return send(res, 400, { error: 'invalid json' }) }
      const pid = body.playerId
      if (!validId(pid)) return send(res, 400, { error: 'invalid playerId' })
      if (typeof body.data !== 'string' || body.data.length === 0 || body.data.length > SAVE_MAX) {
        return send(res, 400, { error: 'invalid save data' })
      }
      // 健全性:必须是可解析的 JSON 对象，避免存进垃圾
      let parsed
      try { parsed = JSON.parse(body.data) } catch { return send(res, 400, { error: 'save not json' }) }
      if (!parsed || typeof parsed !== 'object') return send(res, 400, { error: 'save not object' })
      const now = Date.now()
      const last = saveLast.get(pid) || 0
      if (now - last < SAVE_COOLDOWN) return send(res, 429, { error: 'cooldown' })
      saveLast.set(pid, now)
      writeSave(pid, body.data)
      return send(res, 200, { ok: true, updatedAt: now })
    }

    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: 'server error' })
  }
})

// 定期清理限频表，避免长期运行内存增长
setInterval(() => {
  const now = Date.now()
  for (const [pid, ts] of lastSubmit) if (now - ts > SUBMIT_COOLDOWN * 2) lastSubmit.delete(pid)
  for (const [pid, ts] of saveLast) if (now - ts > SAVE_COOLDOWN * 2) saveLast.delete(pid)
  for (const [ip, arr] of ipHits) {
    const live = arr.filter(t => now - t <= IP_WINDOW)
    if (live.length) ipHits.set(ip, live); else ipHits.delete(ip)
  }
}, 60000).unref()

load()
server.listen(PORT, HOST, () => {
  console.log(`[doupo-api] listening on ${HOST}:${PORT}, loaded ${entries.size} entries`)
})

function shutdown() {
  console.log('[doupo-api] shutting down')
  try { flush() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
