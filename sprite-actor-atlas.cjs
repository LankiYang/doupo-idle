// Convert approved white-background pose sheets into aligned, transparent runtime atlases.
const fs = require('node:fs')
const path = require('node:path')
const { decodePNG, encodePNG } = require('./remove-bg.cjs')

const FRAME_H = 160
const WALK_W = 128
const ACTION_W = 256

function cell(image, column, row, columns, rows, trimBottom = 0) {
  const width = image.width / columns, height = image.height / rows
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Sheet grid does not divide evenly')
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height - Math.max(5, trimBottom); y++) for (let x = 0; x < width; x++) {
    if (x < 5 || x >= width - 5 || y < 5) continue
    const si = ((row * height + y) * image.width + column * width + x) * image.channels
    const di = (y * width + x) * 4
    const r = image.px[si], g = image.px[si + 1], b = image.px[si + 2]
    const darkness = 255 - Math.min(r, g, b)
    const whiteAlpha = Math.round(Math.max(0, Math.min(1, (darkness - 8) / 28)) * 255)
    const alpha = image.channels === 4 ? Math.min(image.px[si + 3], whiteAlpha) : whiteAlpha
    if (alpha > 0) { pixels[di] = r; pixels[di + 1] = g; pixels[di + 2] = b }
    pixels[di + 3] = alpha
  }
  const frame = { width, height, pixels }
  keepMainSilhouette(frame)
  return frame
}

function keepMainSilhouette(frame) {
  const { width, height, pixels } = frame
  const visited = new Uint8Array(width * height)
  let largest = []
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || pixels[start * 4 + 3] < 80) continue
    const component = [start]
    visited[start] = 1
    for (let i = 0; i < component.length; i++) {
      const at = component[i], x = at % width, y = Math.floor(at / width)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const next = ny * width + nx
        if (visited[next] || pixels[next * 4 + 3] < 80) continue
        visited[next] = 1; component.push(next)
      }
    }
    if (component.length > largest.length) largest = component
  }
  const keep = new Uint8Array(width * height)
  for (const pixel of largest) keep[pixel] = 1
  for (let i = 0; i < keep.length; i++) if (!keep[i]) pixels.fill(0, i * 4, i * 4 + 4)
}

function bounds(frame) {
  let left = frame.width, top = frame.height, right = -1, bottom = -1
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    if (frame.pixels[(y * frame.width + x) * 4 + 3] < 80) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < 0) throw new Error('Blank sprite cell')
  return { left, top, right, bottom }
}

function footAnchor(frame, box) {
  const height = box.bottom - box.top + 1
  const start = Math.floor(box.bottom - height * 0.36)
  const end = Math.floor(box.bottom - height * 0.04)
  let sum = 0, count = 0
  for (let y = start; y <= end; y++) for (let x = box.left; x <= box.right; x++) {
    if (frame.pixels[(y * frame.width + x) * 4 + 3] < 160) continue
    sum += x; count++
  }
  if (!count) throw new Error('Sprite has no lower-body anchor')
  return sum / count
}

function alignedFrame(frame, width, action = false) {
  const box = bounds(frame)
  const scale = Math.min(138 / (box.bottom - box.top + 1), (width - 12) / (box.right - box.left + 1))
  const output = Buffer.alloc(width * FRAME_H * 4)
  const center = footAnchor(frame, box)
  const anchor = action ? 78 : width / 2
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < width; x++) {
    const sx = Math.round(center + (x - anchor) / scale)
    const sy = Math.round(box.bottom + (y - 152) / scale)
    if (sx < 0 || sx >= frame.width || sy < 0 || sy >= frame.height) continue
    const si = (sy * frame.width + sx) * 4, di = (y * width + x) * 4
    frame.pixels.copy(output, di, si, si + 4)
  }
  return output
}

function atlas(frames, columns, frameWidth) {
  const rows = frames.length / columns
  if (!Number.isInteger(rows)) throw new Error('Frame count does not fit atlas')
  const width = columns * frameWidth, output = Buffer.alloc(width * rows * FRAME_H * 4)
  frames.forEach((frame, index) => {
    const col = index % columns, row = Math.floor(index / columns)
    for (let y = 0; y < FRAME_H; y++) frame.copy(output,
      ((row * FRAME_H + y) * width + col * frameWidth) * 4,
      y * frameWidth * 4, (y + 1) * frameWidth * 4)
  })
  return encodePNG(width, rows * FRAME_H, output)
}

function readSheet(file, columns, rows, frameWidth, action = false, trimBottom = 0) {
  const image = decodePNG(file)
  return Array.from({ length: columns * rows }, (_, index) =>
    alignedFrame(cell(image, index % columns, Math.floor(index / columns), columns, rows, trimBottom), frameWidth, action))
}

function makeWalk(south, north, east, output, trimEast = 0) {
  const rows = [readSheet(south, 4, 2, WALK_W), readSheet(north, 4, 2, WALK_W),
    readSheet(east, 4, 2, WALK_W, false, trimEast)]
  const mirror = frame => {
    const result = Buffer.alloc(frame.length)
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < WALK_W; x++) {
      const from = (y * WALK_W + x) * 4, to = (y * WALK_W + WALK_W - 1 - x) * 4
      frame.copy(result, to, from, from + 4)
    }
    return result
  }
  const ordered = [...rows[0], ...rows[1], ...rows[2].map(mirror), ...rows[2]]
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, atlas(ordered, 8, WALK_W))
  return { frames: ordered.length, width: 1024, height: 640 }
}

function makeActions(east, north, output) {
  const frames = [...readSheet(east, 2, 2, ACTION_W, true), ...readSheet(north, 2, 2, ACTION_W, true)]
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, atlas(frames, 4, ACTION_W))
  return { frames: frames.length, width: 1024, height: 320 }
}

module.exports = { cell, bounds, footAnchor, alignedFrame, readSheet, makeWalk, makeActions }

if (require.main === module) {
  try {
    const [mode, ...args] = process.argv.slice(2)
    if (mode === 'walk' && (args.length === 4 || args.length === 5)) console.log(makeWalk(args[0], args[1], args[2], args[3], Number(args[4] || 0)))
    else if (mode === 'actions' && args.length === 3) console.log(makeActions(...args))
    else throw new Error('Usage: node sprite-actor-atlas.cjs walk south.png north.png east.png output.png [trimEastBottom] | actions east.png north.png output.png')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
