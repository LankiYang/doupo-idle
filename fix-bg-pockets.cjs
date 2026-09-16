// 焚炎异录 · 精灵图「封闭白底口袋」修复工具
//
// 背景：`remove-bg.cjs` 用的是 **从画布四边 flood fill** 的抠图法 —— 它只删与边缘连通的近背景色像素，
// 刻意"安全保护主体内部浅色"。副作用是**被主体围住的那块背景删不掉**：
// 典型如拉弓角色的弓弧内侧、角色腋下/腿间的空隙，会留成一块纯白，叠在深色战斗背景上极其刺眼。
//
// 本工具补这一步：在已抠好的图上，找出**不与边缘连通**的近背景色连通块，
// 只有同时满足「成块（核心像素够多）」与「颜色紧贴背景色（方差极小）」才判为残留口袋并抹掉，
// 亮片/眼白/金色高光这类**小而带渐变**的浅色不会被误伤。
//
// 用法（源码根）：
//   node fix-bg-pockets.cjs --report                 # 只报告，不动文件
//   node fix-bg-pockets.cjs [文件.png ...]           # 就地修复（先写 .pocketbak 备份）
// 输入应为 `.backup-sprites-png/` 里的**全尺寸 PNG**（webp 是有损/缩放后的产物，不能在它上面改）。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ── 调参（都在"判定一个孤立近背景色块算不算残留口袋"上）────────────────────
const T_OUTER = 72      // 与 remove-bg.cjs 同值：与背景色的距离小于它 = 候选背景
const T_TIGHT = 30      // "紧贴背景色"的核心阈值：只有核心像素够多的块才判为口袋
const MIN_CORE = 200    // 口袋核心像素下限（1024 分辨率下，弓弧内侧约 ~15000，眼白 ~30）
const MAX_CORE_RATIO = 0.35 // 单块占比超过它就不动（那多半是主体本身的大片浅色，如白袍）
// 只处理**白底**素材：本工具的靶子是「AI 出图的白底没抠干净」，所以背景色必须是浅色。
// 这条闸门是被一次误伤逼出来的 —— `blessings/insight` 是**深色圆形底盘**上的金莲，
// 而它生成时的底色恰好是同一种深藏青：不加闸门就会把整块底盘当成"封闭背景口袋"抹成透明，
// 图标从"深盘上的金莲"变成"悬空的镂空金莲"。深底素材一律不碰。
const MIN_BG = 200      // 背景色三个通道都要 ≥ 它，才算"白底"

// ── PNG 解码（与 remove-bg.cjs 同一份实现，保持一致）──
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

function encodePNG(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
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

/**
 * 找出所有「不与画布边缘连通的近背景色块」，逐块给出判定依据。
 * 返回的 blocks 里每一项都带 core（紧贴背景色的核心像素数）与 span，
 * 便于 --report 时人工复核后再决定动不动。
 */
function findPockets(file) {
  const { width: W, height: H, channels: ch, px } = decodePNG(file)
  const N = W * H
  const at = (i) => [px[i * ch], px[i * ch + 1], px[i * ch + 2], ch === 4 ? px[i * ch + 3] : 255]

  // 背景色：优先取"已经透明了的那片"的 RGB（抠图时 RGB 是原样保留的），没有再退回四角
  let bg = null
  {
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < N; i++) {
      const p = at(i)
      if (p[3] < 32) { r += p[0]; g += p[1]; b += p[2]; n++ }
    }
    if (n > N * 0.01) bg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
    else {
      const cs = [at(0), at(W - 1), at((H - 1) * W), at(N - 1)]
      bg = [0, 1, 2].map(k => Math.round(cs.reduce((s, c) => s + c[k], 0) / 4))
    }
  }

  const dist = new Float32Array(N)
  const loose = new Uint8Array(N)   // 候选背景（含边缘羽化带）：alpha>=128 且 距离 < T_OUTER
  const tight = new Uint8Array(N)   // 紧贴背景色：alpha>=250 且 距离 < T_TIGHT
  for (let i = 0; i < N; i++) {
    const p = at(i)
    const d = Math.sqrt((p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2)
    dist[i] = d
    if (p[3] >= 250 && d < T_TIGHT) tight[i] = 1
    if (p[3] >= 128 && d < T_OUTER) loose[i] = 1
  }

  // 从四边 flood fill：能走到的都是"外部背景"（正常抠图已删的那片），不是口袋
  const outside = new Uint8Array(N)
  const stack = []
  const pushOut = (i) => { if (!outside[i] && loose[i]) { outside[i] = 1; stack.push(i) } }
  for (let x = 0; x < W; x++) { pushOut(x); pushOut((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { pushOut(y * W); pushOut(y * W + W - 1) }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0
    if (x > 0) pushOut(i - 1)
    if (x < W - 1) pushOut(i + 1)
    if (y > 0) pushOut(i - W)
    if (y < H - 1) pushOut(i + W)
  }

  // 剩下的近背景色连通块 = 被主体围住的口袋（4 连通，避免从轮廓对角缝里漏出去）
  const seen = new Uint8Array(N)
  const blocks = []
  for (let s = 0; s < N; s++) {
    if (seen[s] || !loose[s] || outside[s]) continue
    const cells = []
    const st = [s]; seen[s] = 1
    let core = 0, coreMaxD = 0
    while (st.length) {
      const i = st.pop()
      cells.push(i)
      if (tight[i]) { core++; if (dist[i] > coreMaxD) coreMaxD = dist[i] }
      const x = i % W, y = (i / W) | 0
      const nb = []
      if (x > 0) nb.push(i - 1)
      if (x < W - 1) nb.push(i + 1)
      if (y > 0) nb.push(i - W)
      if (y < H - 1) nb.push(i + W)
      for (const j of nb) if (!seen[j] && loose[j] && !outside[j]) { seen[j] = 1; st.push(j) }
    }
    // 注意：不能用 Math.min(...xs) —— 块可能有十万级像素，展开成实参会爆栈
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (const i of cells) {
      const x = i % W, y = (i / W) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    blocks.push({
      cells, size: cells.length, core, coreMaxD,
      box: [x0, y0, x1, y1],
    })
  }
  blocks.sort((a, b) => b.core - a.core)
  return { W, H, px, ch, N, blocks, bg }
}

function judge(b, N) {
  if (b.core >= MIN_CORE && b.core / N <= MAX_CORE_RATIO) return true
  return false
}

function run(files) {
  for (const f of files) {
    const { W, H, px, ch, N, blocks, bg } = findPockets(f)
    const name = path.relative(process.cwd(), f)
    const bgHex = '#' + bg.map(v => v.toString(16).padStart(2, '0')).join('')
    if (!bg.every(v => v >= MIN_BG)) {
      console.log(`— ${name}：底色 ${bgHex} 不是白底，跳过（深底素材的主体色与背景同色，会误伤）`)
      continue
    }
    const pockets = blocks.filter(b => judge(b, N))
    if (!pockets.length) {
      console.log(`— ${name}：无残留口袋（底色 ${bgHex} · 孤立浅色块 ${blocks.length} 个，核心最大 ${blocks[0]?.core ?? 0} px）`)
      continue
    }
    const cells = pockets.flatMap(b => b.cells)
    console.log(`✔ ${name}：抹掉 ${pockets.length} 块，共 ${cells.length} px（${(cells.length / N * 100).toFixed(2)}%）· 底色 ${bgHex}`)
    for (const b of pockets) {
      console.log(`    · 尺寸 ${b.size} px / 紧贴背景色的核心 ${b.core} px（最远距离 ${b.coreMaxD.toFixed(1)}）· 包围盒 ${b.box.join(',')}`)
    }
    if (process.env.DRY_RUN) continue
    const rgba = Buffer.from(px)
    if (ch === 3) { // 三通道：扩成 RGBA
      const out = Buffer.alloc(N * 4)
      for (let i = 0; i < N; i++) { out[i * 4] = px[i * 3]; out[i * 4 + 1] = px[i * 3 + 1]; out[i * 4 + 2] = px[i * 3 + 2]; out[i * 4 + 3] = 255 }
      for (const i of cells) out[i * 4 + 3] = 0
      if (!fs.existsSync(f + '.pocketbak')) fs.copyFileSync(f, f + '.pocketbak')
      fs.writeFileSync(f, encodePNG(W, H, out))
    } else {
      for (const i of cells) rgba[i * 4 + 3] = 0
      if (!fs.existsSync(f + '.pocketbak')) fs.copyFileSync(f, f + '.pocketbak')
      fs.writeFileSync(f, encodePNG(W, H, rgba))
    }
  }
}

// ── 入口
// 默认**只报告**；要真改文件必须显式 `--apply`（一次误伤教出来的习惯：
// 这类工具一旦"无参数=就地改"，跑错一次源图就没了，而源图是唯一的）。
const args = process.argv.slice(2)
const apply = args.includes('--apply')
if (!apply) process.env.DRY_RUN = '1'
const targets = args.filter(a => !a.startsWith('--'))
if (targets.length) {
  run(targets)
} else {
  const SPRITES = process.env.SPRITES || path.join(__dirname, '.backup-sprites-png')
  const dirs = ['monsters', 'blessings', 'fx', 'equip']
  const files = []
  for (const d of dirs) {
    const dir = path.join(SPRITES, d)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) files.push(path.join(dir, f))
  }
  console.log(`扫描 ${files.length} 张（${apply ? '就地修复' : '只报告'}）\n`)
  run(files)
}