import test from 'node:test'
import assert from 'node:assert/strict'
import { fishingActionDirection, fishingActionFrame } from './fishingAnimation.ts'

test('cast plays all four poses in order and holds the follow-through while waiting', () => {
  const until = 1800
  assert.equal(fishingActionFrame('casting', until, 1000), 0)
  assert.equal(fishingActionFrame('casting', until, 1119), 0)
  assert.equal(fishingActionFrame('casting', until, 1120), 1)
  assert.equal(fishingActionFrame('casting', until, 1340), 2)
  assert.equal(fishingActionFrame('casting', until, 1600), 3)
  assert.equal(fishingActionFrame('casting', until, 1799), 3)
  assert.equal(fishingActionFrame('waiting', until, 2000), 3)
  assert.equal(fishingActionFrame('bite', until, 2000), 3)
  assert.equal(fishingActionFrame('reeling', until, 2000), 3)
  assert.equal(fishingActionFrame('caught', until, 2000), 3)
})

test('shore directions select source art or horizontally mirrored side art', () => {
  assert.deepEqual(fishingActionDirection('east'), { row: 0, mirror: false })
  assert.deepEqual(fishingActionDirection('west'), { row: 0, mirror: true })
  assert.deepEqual(fishingActionDirection('north'), { row: 1, mirror: false })
})
