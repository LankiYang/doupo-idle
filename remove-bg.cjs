// 焚炎异录 · 精灵图背景抠除工具
// 方案：flood-fill 连通区域抠图 —— 只删除与画布边缘连通的近背景色像素，安全保护主体内部浅色
// 用法：node remove-bg.cjs [文件路径...]  （无参数则处理 sprites 目录全部）
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ── PNG 解码 → RGB
function decodePNG(file) {
  const buf = fs.readFileSync(file)
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error('unsupported bitDepth ' + bitDepth)
  if (colorType !== 2 && colorType !== 6) throw new Error('unsupported colorType ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null
    const cur = px.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = x >= channels && prev ? prev[x - channels] : 0
      let v = row[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + Math.floor((a + b) / 2)) & 0xff
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      cur[x] = v
    }
  }
  return { width, height, channels, px }
}

// ── RGB → RGBA PNG 编码
function encodePNG(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of td) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, td, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function colorDist(c1, c2) {
  const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

// ── 主体抠图流程 ──
function removeBackground(file, opts) {
  const { T_INNER = 36, T_OUTER = 72 } = opts ?? {}
  const img = decodePNG(file)
  const { width: W, height: H, channels: ch, px } = img
  const get = (i) => [px[i], px[i + 1], px[i + 2]]

  // 1) 背景色 = 四角平均
  const corners = [get(0), get((W - 1) * ch), get((H - 1) * W * ch), get(((H - 1) * W + W - 1) * ch)]
  const bg = [0, 1, 2].map(k => Math.round(corners.reduce((s, c) => s + c[k], 0) / 4))

  // 2) 与背景色相近的像素标记为候选背景（并计算距离）
  const N = W * H
  const dist = new Float32Array(N)
  const isBg = new Uint8Array(N) // 1=候选背景
  for (let i = 0, j = 0; i < N; i++, j += ch) {
    const d = colorDist([px[j], px[j + 1], px[j + 2]], bg)
    dist[i] = d
    if (d < T_OUTER) isBg[i] = 1
  }

  // 3) flood fill 从四边深入，只经过候选背景像素
  const isBackdrop = new Uint8Array(N)
  const queue = []
  const push = (idx) => { if (!isBackdrop[idx] && isBg[idx]) { isBackdrop[idx] = 1; queue.push(idx) } }
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
  let q = 0
  while (q < queue.length) {
    const idx = queue[q++]
    const x = idx % W, y = (idx / W) | 0
    if (x > 0) push(idx - 1)
    if (x < W - 1) push(idx + 1)
    if (y > 0) push(idx - W)
    if (y < H - 1) push(idx + W)
  }

  // 4) 生成 RGBA：背景区按距离羽化出 alpha，主体区 alpha=255
  const rgba = Buffer.alloc(N * 4)
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const p = i * ch
    rgba[j] = px[p]; rgba[j + 1] = px[p + 1]; rgba[j + 2] = px[p + 2]
    if (isBackdrop[i]) {
      const d = dist[i]
      let alpha = 0
      if (d > T_INNER) alpha = Math.round(((d - T_INNER) / (T_OUTER - T_INNER)) * 255)
      rgba[j + 3] = alpha
    } else {
      rgba[j + 3] = 255
    }
  }

  return { width: W, height: H, rgba }
}

// ── 入口 ──
const targets = process.argv.slice(2)
const SPRITES = 'C:/Users/admin/Desktop/咸鱼之王/doupo-idle/src/assets/sprites'
let files = []
if (targets.length > 0) {
  files = targets
} else {
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.png')) files.push(p)
    }
  }
  walk(SPRITES)
}

for (const f of files) {
  try {
    // 若已存在 .bak（原始未抠图版本），从 .bak 重新处理，避免二次叠加
    const src = fs.existsSync(f + '.bak') ? f + '.bak' : f
    const { width, height, rgba } = removeBackground(src)
    // 备份原图（仅首次）
    if (!fs.existsSync(f + '.bak')) fs.copyFileSync(f, f + '.bak')
    // 覆盖
    fs.writeFileSync(f, encodePNG(width, height, rgba))
    // 统计 alpha 分布
    const N = width * height
    let transparent = 0, semi = 0
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] === 0) transparent++
      else if (rgba[i] < 255) semi++
    }
    console.log(`✅ ${path.basename(f)} — 全透明 ${(transparent / N * 100).toFixed(1)}% · 半透明边缘 ${(semi / N * 100).toFixed(1)}% · ${(fs.statSync(src).size / 1024).toFixed(0)}KB → ${(fs.statSync(f).size / 1024).toFixed(0)}KB`)
  } catch (e) {
    console.log(`❌ ${path.basename(f)}: ${e.message}`)
  }
}