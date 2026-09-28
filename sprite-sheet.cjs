// Convert a generated 2x2 RGB PNG into four transparent, quality-checked frames.
// Usage: node sprite-sheet.cjs input.png output/prefix
const fs = require('fs')
const path = require('path')
const { decodePNG, encodePNG, removeBackground } = require('./remove-bg.cjs')

function splitSheet(image) {
  const { width, height, channels, px } = image
  if (width !== height || width % 2 || channels !== 3) {
    throw new Error('Expected a square 2x2 RGB PNG with even dimensions')
  }
  const side = width / 2
  return [0, 1, 2, 3].map(i => {
    const data = Buffer.alloc(side * side * channels)
    const x = (i % 2) * side
    const y = Math.floor(i / 2) * side
    for (let row = 0; row < side; row++) {
      px.copy(data, row * side * channels, ((y + row) * width + x) * channels,
        ((y + row) * width + x + side) * channels)
    }
    return { width: side, height: side, channels, px: data }
  })
}

function stripEdgeLines(frame) {
  const { width: w, height: h, rgba } = frame
  const removed = []
  const clearRow = y => {
    let filled = 0
    for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 127) filled++
    if (filled < w * 0.8) return
    for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = 0
    removed.push(`row:${y}`)
  }
  const clearColumn = x => {
    let filled = 0
    for (let y = 0; y < h; y++) if (rgba[(y * w + x) * 4 + 3] > 127) filled++
    if (filled < h * 0.8) return
    for (let y = 0; y < h; y++) rgba[(y * w + x) * 4 + 3] = 0
    removed.push(`column:${x}`)
  }
  for (let n = 0; n < Math.min(4, w, h); n++) {
    clearRow(n)
    clearRow(h - 1 - n)
    clearColumn(n)
    clearColumn(w - 1 - n)
  }
  return removed
}

function frameStats(frame) {
  const { width: w, height: h, rgba } = frame
  let minX = w, minY = h, maxX = -1, maxY = -1, pixels = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] <= 127) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    pixels++
  }
  if (!pixels) throw new Error('A frame has no visible subject')
  const rootStart = maxY - Math.round((maxY - minY) * 0.2)
  let rootSum = 0, rootPixels = 0
  for (let y = rootStart; y <= maxY; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] <= 127) continue
    rootSum += x; rootPixels++
  }
  return { bbox: [minX, minY, maxX, maxY], pixels, rootX: Math.round(rootSum / rootPixels), rootY: maxY }
}

function rootOverlap(a, b, startY) {
  let intersection = 0, union = 0
  for (let y = startY; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const k = (y * a.width + x) * 4 + 3
    const aa = a.rgba[k] > 127, bb = b.rgba[k] > 127
    if (aa && bb) intersection++
    if (aa || bb) union++
  }
  return union ? intersection / union : 0
}

function changedPixels(a, b) {
  let changed = 0
  for (let k = 0; k < a.rgba.length; k += 4) {
    const aa = a.rgba[k + 3] > 127, bb = b.rgba[k + 3] > 127
    if (aa !== bb || (aa && bb &&
      Math.abs(a.rgba[k] - b.rgba[k]) + Math.abs(a.rgba[k + 1] - b.rgba[k + 1]) +
      Math.abs(a.rgba[k + 2] - b.rgba[k + 2]) > 60)) changed++
  }
  return changed
}

function qualityReport(frames, cleanedEdges) {
  const stats = frames.map(frameStats)
  const base = stats[0]
  const rootStart = base.rootY - Math.round((base.bbox[3] - base.bbox[1]) * 0.2)
  const comparisons = frames.slice(1).map((frame, i) => ({
    rootDriftX: stats[i + 1].rootX - base.rootX,
    rootDriftY: stats[i + 1].rootY - base.rootY,
    rootOverlap: Number(rootOverlap(frames[0], frame, rootStart).toFixed(3)),
    changedFromPrevious: changedPixels(frames[i], frame),
  }))
  const issues = []
  for (const [i, item] of comparisons.entries()) {
    if (Math.abs(item.rootDriftX) > 8 || Math.abs(item.rootDriftY) > 8 || item.rootOverlap < 0.8) {
      issues.push(`Frame ${i + 2}: stationary root moved or changed shape`)
    }
    if (item.changedFromPrevious < base.pixels * 0.01) issues.push(`Frame ${i + 2}: almost identical to previous frame`)
    if (stats[i + 1].pixels < base.pixels * 0.75 || stats[i + 1].pixels > base.pixels * 1.25) {
      issues.push(`Frame ${i + 2}: subject size differs substantially`)
    }
  }
  return { passed: issues.length === 0, frames: stats, cleanedEdges, comparisons, issues,
    note: 'Only checks stationary-base alignment and gross changes. Visually review anatomy, palette and loop timing.' }
}

function processSheet(input, prefix) {
  const cropped = splitSheet(decodePNG(input))
  const frames = cropped.map(frame => removeBackground(frame))
  const cleanedEdges = frames.map(stripEdgeLines)
  const report = qualityReport(frames, cleanedEdges)
  const output = path.resolve(prefix)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  frames.forEach((frame, i) => fs.writeFileSync(`${output}-frame-${i}.png`, encodePNG(frame.width, frame.height, frame.rgba)))
  const side = frames[0].width
  const atlas = Buffer.alloc(side * side * 4 * 4)
  frames.forEach((frame, i) => {
    for (let y = 0; y < side; y++) {
      frame.rgba.copy(atlas, (((Math.floor(i / 2) * side + y) * side * 2) + (i % 2) * side) * 4,
        y * side * 4, (y + 1) * side * 4)
    }
  })
  fs.writeFileSync(`${output}-sheet.png`, encodePNG(side * 2, side * 2, atlas))
  fs.writeFileSync(`${output}-report.json`, JSON.stringify(report, null, 2) + '\n', 'utf8')
  return report
}

module.exports = { splitSheet, stripEdgeLines, frameStats, qualityReport, processSheet }

if (require.main === module) {
  const [input, prefix] = process.argv.slice(2)
  if (!input || !prefix) {
    console.error('Usage: node sprite-sheet.cjs input.png output/prefix')
    process.exitCode = 1
  } else {
    try {
      const report = processSheet(input, prefix)
      console.log(JSON.stringify(report, null, 2))
      if (!report.passed) process.exitCode = 1
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
