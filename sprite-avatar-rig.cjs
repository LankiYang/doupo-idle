// Deterministic, subtle eight-frame movement from one approved transparent pose.
// Usage: node sprite-avatar-rig.cjs source.png output.png
const fs = require('fs')
const path = require('path')
const { decodePNG, encodePNG } = require('./remove-bg.cjs')

const FRAME_W = 128
const FRAME_H = 160
const COLUMNS = 4
const OFFSETS = [0, -2, -3, -1, 0, 2, 3, 1]
const BOBS = [0, -1, -3, -2, -1, -2, -3, -1]
const HEMS = [1, 2, 3, 1, -1, -2, -3, -1]
const STRIDES = [0, 2, 4, 2, 0, -2, -4, -2]
const DIRECTIONS = ['south', 'north', 'west', 'east']

function bounds(image) {
  const { width, height, channels, px } = image
  if (channels !== 4) throw new Error('Source must be a transparent RGBA PNG')
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (px[(y * width + x) * 4 + 3] <= 48) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Source contains no opaque sprite')
  return { left, top, right, bottom }
}

function makeFrames(image) {
  const box = bounds(image)
  const contentW = box.right - box.left + 1, contentH = box.bottom - box.top + 1
  const scale = Math.min(88 / contentW, 134 / contentH)
  const drawW = Math.round(contentW * scale), drawH = Math.round(contentH * scale)
  return OFFSETS.map((shift, index) => {
    const frame = Buffer.alloc(FRAME_W * FRAME_H * 4)
    const top = FRAME_H - 8 - drawH + BOBS[index]
    const left = Math.floor((FRAME_W - drawW) / 2) + shift
    for (let y = 0; y < drawH; y++) for (let x = 0; x < drawW; x++) {
      const hem = y > drawH * 0.65 ? HEMS[index] * (y / drawH - 0.65) / 0.35 : 0
      const foot = y > drawH * 0.84 ? STRIDES[index] * (x < drawW / 2 ? -1 : 1) *
        (y / drawH - 0.84) / 0.16 : 0
      const sx = Math.min(box.right, Math.max(box.left, Math.round(box.left + (x - hem - foot) / scale)))
      const sy = Math.min(box.bottom, Math.max(box.top, Math.round(box.top + y / scale)))
      const dx = left + x, dy = top + y
      if (dx < 0 || dx >= FRAME_W || dy < 0 || dy >= FRAME_H) continue
      image.px.copy(frame, (dy * FRAME_W + dx) * 4,
        (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4)
    }
    return frame
  })
}

function rigAvatar(source, output) {
  const frames = makeFrames(decodePNG(source))
  const atlas = Buffer.alloc(FRAME_W * COLUMNS * FRAME_H * 2 * 4)
  for (let i = 0; i < frames.length; i++) for (let y = 0; y < FRAME_H; y++) {
    frames[i].copy(atlas,
      (((Math.floor(i / COLUMNS) * FRAME_H + y) * FRAME_W * COLUMNS) + (i % COLUMNS) * FRAME_W) * 4,
      y * FRAME_W * 4, (y + 1) * FRAME_W * 4)
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
  fs.writeFileSync(output, encodePNG(FRAME_W * COLUMNS, FRAME_H * 2, atlas))
  return { frames: frames.length, columns: COLUMNS, frameWidth: FRAME_W, frameHeight: FRAME_H,
    distinct: new Set(frames.map(frame => frame.toString('base64'))).size }
}

function rigAvatarDirections(sources, output) {
  if (sources.length !== DIRECTIONS.length) throw new Error('Expected sources in south, north, west, east order')
  const rows = sources.map(source => makeFrames(decodePNG(source)))
  const atlas = Buffer.alloc(FRAME_W * 8 * FRAME_H * rows.length * 4)
  for (let row = 0; row < rows.length; row++) for (let column = 0; column < 8; column++) {
    const frame = rows[row][column]
    for (let y = 0; y < FRAME_H; y++) frame.copy(atlas,
      (((row * FRAME_H + y) * FRAME_W * 8) + column * FRAME_W) * 4,
      y * FRAME_W * 4, (y + 1) * FRAME_W * 4)
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
  fs.writeFileSync(output, encodePNG(FRAME_W * 8, FRAME_H * rows.length, atlas))
  return { directions: DIRECTIONS, framesPerDirection: 8, columns: 8,
    frameWidth: FRAME_W, frameHeight: FRAME_H,
    distinct: rows.map(frames => new Set(frames.map(frame => frame.toString('base64'))).size) }
}

module.exports = { bounds, makeFrames, rigAvatar, rigAvatarDirections }

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length !== 2 && args.length !== 5) {
    console.error('Usage: node sprite-avatar-rig.cjs source.png output.png')
    console.error('   or: node sprite-avatar-rig.cjs south.png north.png west.png east.png output.png')
    process.exitCode = 1
  } else {
    try {
      const report = args.length === 2 ? rigAvatar(args[0], args[1]) : rigAvatarDirections(args.slice(0, 4), args[4])
      if (args.length === 2 ? report.distinct !== 8 : report.distinct.some(count => count !== 8)) {
        throw new Error('The eight frames are not distinct')
      }
      console.log(report)
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
