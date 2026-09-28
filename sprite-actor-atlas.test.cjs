const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { decodePNG } = require('./remove-bg.cjs')

const folder = path.join(__dirname, 'src/assets/sprites/fishing')

function metrics(image, column, row, frameWidth) {
  let pixels = 0, transparent = 0, lowerX = 0, lowerCount = 0
  const visible = new Uint8Array(frameWidth * 160)
  for (let y = 0; y < 160; y++) for (let x = 0; x < frameWidth; x++) {
    const at = ((row * 160 + y) * image.width + column * frameWidth + x) * 4
    const alpha = image.px[at + 3]
    if (alpha < 80) {
      transparent++
      if (!alpha) assert.equal(image.px[at] + image.px[at + 1] + image.px[at + 2], 0)
    } else {
      pixels++; visible[y * frameWidth + x] = 1
      if (y >= 110 && y < 151 && x < (frameWidth === 256 ? 130 : 128)) {
        lowerX += x; lowerCount++
      }
    }
  }
  return { pixels, transparent, anchor: lowerX / lowerCount, visible }
}

for (const gender of ['male', 'female']) {
  test(`${gender} generated walk atlas has 4 directions with visible motion and stable feet`, () => {
    const image = decodePNG(path.join(folder, `avatar-${gender}-walk-v2.png`))
    assert.equal(image.width, 1024); assert.equal(image.height, 640)
    for (let row = 0; row < 4; row++) {
      const frames = Array.from({ length: 8 }, (_, column) => metrics(image, column, row, 128))
      for (const frame of frames) {
        assert.ok(frame.pixels > 1800 && frame.transparent > 10000, 'visible isolated figure')
        assert.ok(Math.abs(frame.anchor - 64) < 22, `foot anchor ${frame.anchor}`)
      }
      assert.ok(Math.max(...frames.map(frame => frame.anchor)) - Math.min(...frames.map(frame => frame.anchor)) < 16)
      const differences = frames.slice(1).map(frame => frame.visible.reduce((sum, value, index) =>
        sum + (value !== frames[0].visible[index] ? 1 : 0), 0))
      assert.ok(differences.filter(count => count > 120).length >= 4, `motion row ${row}: ${differences}`)
      if (row < 2) {
        const upperChanges = frames.slice(1).map(frame => {
          let count = 0
          for (let y = 46; y < 100; y++) for (let x = 0; x < 128; x++) {
            const at = y * 128 + x
            if (frame.visible[at] !== frames[0].visible[at]) count++
          }
          return count
        })
        assert.ok(Math.max(...upperChanges) > (row === 0 ? 90 : 45), `arm silhouette row ${row}: ${upperChanges}`)
      }
    }
  })

  test(`${gender} fishing poses are transparent, anchored, and distinct`, () => {
    const image = decodePNG(path.join(folder, `avatar-${gender}-fish-actions.png`))
    assert.equal(image.width, 1024); assert.equal(image.height, 320)
    for (let row = 0; row < 2; row++) {
      const frames = Array.from({ length: 4 }, (_, column) => metrics(image, column, row, 256))
      for (const frame of frames) {
        assert.ok(frame.pixels > 1700 && frame.transparent > 28000, 'visible isolated fishing pose')
        assert.ok(Math.abs(frame.anchor - 78) < 23, `fishing foot anchor ${frame.anchor}`)
      }
      assert.ok(Math.max(...frames.map(frame => frame.anchor)) - Math.min(...frames.map(frame => frame.anchor)) < 18)
      for (const frame of frames.slice(1)) {
        const changed = frame.visible.reduce((sum, value, index) =>
          sum + (value !== frames[0].visible[index] ? 1 : 0), 0)
        assert.ok(changed > 450, `distinct fishing pose ${changed}`)
      }
    }
  })
}
