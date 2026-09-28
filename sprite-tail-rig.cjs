// Keep the body pixel-identical while rotating a left-side tail around its joint.
// Usage: node sprite-tail-rig.cjs source.png output/prefix --pivot=155,255 --cut=155 --frames=8
const fs = require('fs')
const path = require('path')
const { decodePNG, encodePNG } = require('./remove-bg.cjs')

function rotateTail(image, cut, pivotX, pivotY, degrees, finFlex = 0) {
  const { width: w, height: h, channels, px } = image
  if (channels !== 4 || cut <= 0 || cut >= w || pivotX < 0 || pivotX >= w || pivotY < 0 || pivotY >= h) {
    throw new Error('Expected a transparent RGBA PNG and valid cut/pivot coordinates')
  }
  const out = Buffer.from(px)
  if (degrees === 0 && finFlex === 0) return { width: w, height: h, rgba: out }
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  for (let y = 0; y < h; y++) for (let x = 0; x < cut; x++) {
    const dest = (y * w + x) * 4
    out[dest] = 255; out[dest + 1] = 255; out[dest + 2] = 255; out[dest + 3] = 0
    const dx = x - pivotX
    const tipWeight = Math.max(0, Math.min(1, (pivotX - x) / Math.max(1, pivotX)))
    const dy = y - pivotY - finFlex * tipWeight
    const sx = Math.round(pivotX + cos * dx + sin * dy)
    const sy = Math.round(pivotY - sin * dx + cos * dy)
    if (sx < 0 || sx >= Math.min(w, cut + 12) || sy < 0 || sy >= h) continue
    px.copy(out, dest, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4)
  }
  return { width: w, height: h, rgba: out }
}

function swimAngles(count, amplitude) {
  if (!Number.isInteger(count) || count < 4 || count > 24 || !Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 20) {
    throw new Error('frames must be 4-24 and amplitude must be 0-20 degrees')
  }
  return Array.from({ length: count }, (_, i) => {
    const value = Number((-amplitude * Math.sin(2 * Math.PI * i / count)).toFixed(2))
    return value === 0 ? 0 : value
  })
}

function rigTail(input, prefix, { cut, pivotX, pivotY, count = 8, amplitude = 8 }) {
  const image = decodePNG(input)
  if (image.width !== image.height) throw new Error('Expected a square source frame')
  const angles = swimAngles(count, amplitude)
  const finFlex = angles.map((_, i) => {
    const value = Number((3 * Math.cos(2 * Math.PI * i / count)).toFixed(2))
    return value === 0 ? 0 : value
  })
  const frames = angles.map((degrees, i) => rotateTail(image, cut, pivotX, pivotY, degrees, finFlex[i]))
  const output = path.resolve(prefix)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const side = image.width
  const columns = Math.min(4, count), rows = Math.ceil(count / columns)
  const atlas = Buffer.alloc(side * side * 4 * columns * rows)
  frames.forEach((frame, i) => {
    fs.writeFileSync(`${output}-frame-${i}.png`, encodePNG(side, side, frame.rgba))
    for (let y = 0; y < side; y++) {
      frame.rgba.copy(atlas, (((Math.floor(i / columns) * side + y) * side * columns) + (i % columns) * side) * 4,
        y * side * 4, (y + 1) * side * 4)
    }
  })
  fs.writeFileSync(`${output}-sheet.png`, encodePNG(side * columns, side * rows, atlas))
  const report = { frameCount: count, columns, rows, fps: count, angles, finFlex, pivot: [pivotX, pivotY], cut, bodyPixelsIdentical: true }
  fs.writeFileSync(`${output}-report.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  return report
}

module.exports = { rotateTail, swimAngles, rigTail }

if (require.main === module) {
  const [input, prefix, ...options] = process.argv.slice(2)
  const pivotArg = options.find(arg => arg.startsWith('--pivot='))
  const cutArg = options.find(arg => arg.startsWith('--cut='))
  const framesArg = options.find(arg => arg.startsWith('--frames='))
  const amplitudeArg = options.find(arg => arg.startsWith('--amplitude='))
  const pivot = /^--pivot=(\d+),(\d+)$/.exec(pivotArg ?? '')
  const cut = /^--cut=(\d+)$/.exec(cutArg ?? '')
  if (!input || !prefix || !pivot || !cut) {
    console.error('Usage: node sprite-tail-rig.cjs source.png output/prefix --pivot=x,y --cut=x [--frames=8] [--amplitude=8]')
    process.exitCode = 1
  } else {
    try {
      console.log(rigTail(input, prefix, { pivotX: Number(pivot[1]), pivotY: Number(pivot[2]), cut: Number(cut[1]),
        count: framesArg ? Number(framesArg.slice(9)) : 8, amplitude: amplitudeArg ? Number(amplitudeArg.slice(12)) : 8 }))
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
