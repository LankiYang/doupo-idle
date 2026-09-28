const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { splitSheet, stripEdgeLines, qualityReport } = require('./sprite-sheet.cjs')
const { decodePNG, removeBackground } = require('./remove-bg.cjs')
const { rotateTail, swimAngles } = require('./sprite-tail-rig.cjs')

test('splits the 2x2 sheet in reading order', () => {
  const px = Buffer.alloc(8 * 8 * 3)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    px[(y * 8 + x) * 3] = Math.floor(x / 4) + 2 * Math.floor(y / 4) + 1
  }
  const frames = splitSheet({ width: 8, height: 8, channels: 3, px })
  assert.deepEqual(frames.map(f => f.px[0]), [1, 2, 3, 4])
  assert.throws(() => splitSheet({ width: 8, height: 6, channels: 3, px }), /square/)
})

test('removes a model-made edge line without cutting out the subject', () => {
  const width = 64, height = 64, channels = 3
  const px = Buffer.alloc(width * height * channels, 255)
  for (let y = 20; y < 50; y++) for (let x = 25; x < 40; x++) {
    px.fill(30, (y * width + x) * channels, (y * width + x + 1) * channels)
  }
  for (let y = 62; y < 64; y++) px.fill(150, y * width * channels, (y + 1) * width * channels)
  const frame = removeBackground({ width, height, channels, px })
  assert.deepEqual(stripEdgeLines(frame), ['row:63', 'row:62'])
  assert.equal(frame.rgba[(30 * width + 30) * 4 + 3], 255)
  assert.equal(frame.rgba[(63 * width + 30) * 4 + 3], 0)
})

test('rejects repeated frames and a displaced stationary base', () => {
  const makeFrame = rootX => {
    const width = 64, height = 64, rgba = Buffer.alloc(width * height * 4)
    for (let y = 20; y < 55; y++) for (let x = rootX; x < rootX + 10; x++) {
      rgba[(y * width + x) * 4 + 3] = 255
    }
    return { width, height, rgba }
  }
  const original = makeFrame(20)
  const repeated = qualityReport([original, original, original, original], [[], [], [], []])
  assert.equal(repeated.passed, false)
  assert.match(repeated.issues.join(' '), /almost identical/)
  const shifted = qualityReport([original, makeFrame(32), makeFrame(32), makeFrame(32)], [[], [], [], []])
  assert.equal(shifted.passed, false)
  assert.match(shifted.issues.join(' '), /stationary root/)
})

test('tail rotation changes the left side and keeps every body pixel identical', () => {
  const width = 64, height = 64, channels = 4
  const px = Buffer.alloc(width * height * channels)
  for (let y = 20; y < 44; y++) for (let x = 5; x < 55; x++) {
    px.fill(100, (y * width + x) * 4, (y * width + x) * 4 + 3)
    px[(y * width + x) * 4 + 3] = 255
  }
  const image = { width, height, channels, px }
  const straight = rotateTail(image, 24, 24, 32, 0)
  const bent = rotateTail(image, 24, 24, 32, 15)
  assert.deepEqual(straight.rgba, px)
  assert.notDeepEqual(bent.rgba, px)
  for (let y = 0; y < height; y++) {
    assert.deepEqual(bent.rgba.subarray((y * width + 24) * 4, (y + 1) * width * 4),
      px.subarray((y * width + 24) * 4, (y + 1) * width * 4))
  }
})

test('8-frame swim cycle is smooth and closes at rest', () => {
  const angles = swimAngles(8, 8)
  assert.equal(angles.length, 8)
  assert.equal(angles[0], 0)
  assert.equal(angles[4], 0)
  assert.equal(angles[2], -8)
  assert.equal(angles[6], 8)
  assert.ok(Math.abs(angles[7] - angles[0]) <= 5.66)
  assert.throws(() => swimAngles(25, 9), /frames/)
})

test('outbound and return tail poses differ without changing the body', () => {
  const width = 64, height = 64, channels = 4, px = Buffer.alloc(width * height * channels)
  for (let y = 20; y < 42; y++) for (let x = 4; x < 50; x++) px[(y * width + x) * 4 + 3] = 255
  const image = { width, height, channels, px }
  const outward = rotateTail(image, 24, 24, 31, -5.66, 3)
  const returning = rotateTail(image, 24, 24, 31, -5.66, -3)
  assert.notDeepEqual(outward.rgba, returning.rgba)
  for (let y = 0; y < height; y++) {
    assert.deepEqual(outward.rgba.subarray((y * width + 24) * 4, (y + 1) * width * 4),
      returning.rgba.subarray((y * width + 24) * 4, (y + 1) * width * 4))
  }
})

test('fishing fish atlases have eight visible, distinct transparent frames', () => {
  for (const name of ['silver', 'perch', 'catfish', 'bream']) {
    const image = decodePNG(path.join(__dirname, 'src/assets/sprites/fishing', `fish-${name}-tail.png`))
    assert.equal(image.width, 2048, name)
    assert.equal(image.height, 1024, name)
    const signatures = new Set()
    for (let frame = 0; frame < 8; frame++) {
      const hash = createHash('sha256')
      let visible = 0
      const x = frame % 4 * 512, y = Math.floor(frame / 4) * 512
      assert.equal(image.px[(y * image.width + x) * 4 + 3], 0, `${name} frame ${frame} corner`)
      for (let row = 0; row < 512; row++) {
        const pixels = image.px.subarray(((y + row) * image.width + x) * 4,
          ((y + row) * image.width + x + 512) * 4)
        hash.update(pixels)
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++
      }
      assert.ok(visible > 1000, `${name} frame ${frame} is empty`)
      signatures.add(hash.digest('hex'))
    }
    assert.equal(signatures.size, 8, `${name} has duplicate poses`)
  }
})
