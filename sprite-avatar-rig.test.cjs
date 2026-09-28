const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { encodePNG, decodePNG } = require('./remove-bg.cjs')
const { makeFrames, bounds, rigAvatarDirections } = require('./sprite-avatar-rig.cjs')

test('avatar rig preserves a transparent canvas and produces eight distinct frames', () => {
  const px = Buffer.alloc(64 * 96 * 4)
  for (let y = 12; y < 90; y++) for (let x = 17; x < 47; x++) {
    const i = (y * 64 + x) * 4
    px[i] = 30; px[i + 1] = 100; px[i + 2] = 130; px[i + 3] = 255
  }
  const image = { width: 64, height: 96, channels: 4, px }
  assert.deepEqual(bounds(image), { left: 17, top: 12, right: 46, bottom: 89 })
  const frames = makeFrames(image)
  assert.equal(frames.length, 8)
  assert.equal(new Set(frames.map(frame => frame.toString('base64'))).size, 8)
  for (const frame of frames) {
    assert.equal(frame.length, 128 * 160 * 4)
    assert.equal(frame[3], 0)
    assert.ok(frame.some((value, index) => index % 4 === 3 && value === 255))
  }
})

test('four directions occupy separate rows with eight distinct frames each', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-directions-'))
  try {
    const sources = [0, 1, 2, 3].map((direction) => {
      const rgba = Buffer.alloc(48 * 64 * 4)
      for (let y = 10; y < 58; y++) for (let x = 10; x < 38; x++) {
        const offset = (y * 48 + x) * 4
        rgba[offset] = 30 + direction * 55
        rgba[offset + 1] = 80
        rgba[offset + 2] = 120
        rgba[offset + 3] = 255
      }
      const file = path.join(dir, `${direction}.png`)
      fs.writeFileSync(file, encodePNG(48, 64, rgba))
      return file
    })
    const output = path.join(dir, 'atlas.png')
    const report = rigAvatarDirections(sources, output)
    assert.deepEqual(report.directions, ['south', 'north', 'west', 'east'])
    assert.deepEqual(report.distinct, [8, 8, 8, 8])
    const image = decodePNG(output)
    assert.equal(image.width, 1024)
    assert.equal(image.height, 640)
    const colors = report.directions.map((_, row) => image.px[((row * 160 + 100) * image.width + 64) * 4])
    assert.equal(new Set(colors).size, 4)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
