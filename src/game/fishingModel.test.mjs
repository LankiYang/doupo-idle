import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FISHING_SPOTS, initialFishingState, walkRoute, walkTarget, walkable,
  goFishing, castFishing, stepFishing, hookFishing, holdFishing, leaveFishing, readyAgain, facingToward,
} from './fishingModel.ts'
import { FISH_IDS, fishChances, fishFromRoll, FISH_SWIMMERS, swimmerPose } from './fishingSpecies.ts'

test('every marked fishing stand is walkable and water clicks are clamped ashore', () => {
  for (const spot of FISHING_SPOTS) assert.ok(walkable(spot.stand), spot.id)
  assert.ok(walkable(walkTarget({ x: 700, y: 300 })))
  assert.ok(!walkable({ x: 700, y: 300 }))
})

test('cross-shore route stays on the bank', () => {
  const from = FISHING_SPOTS[0].stand
  const path = walkRoute(from, FISHING_SPOTS[4].stand)
  let prev = from
  for (const next of path) {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      assert.ok(walkable({ x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t }))
    }
    prev = next
  }
})

test('four-way facing follows each path segment and keeps direction at rest', () => {
  const origin = { x: 700, y: 685 }
  assert.equal(facingToward(origin, { x: 700, y: 580 }, 'south'), 'north')
  assert.equal(facingToward(origin, { x: 700, y: 710 }, 'north'), 'south')
  assert.equal(facingToward(origin, { x: 500, y: 685 }, 'south'), 'west')
  assert.equal(facingToward(origin, { x: 900, y: 685 }, 'south'), 'east')
  assert.equal(facingToward(origin, origin, 'east'), 'east')
  let state = goFishing(initialFishingState(), FISHING_SPOTS[0].stand, 'west')
  assert.equal(state.facing, 'west')
  for (let i = 0; i < 200 && state.phase === 'moving'; i++) state = stepFishing(state, i * 50, 0.05)
  assert.equal(state.phase, 'ready')
  assert.equal(state.facing, 'east')
  let south = goFishing(initialFishingState(), FISHING_SPOTS[2].stand, 'south')
  for (let i = 0; i < 100 && south.phase === 'moving'; i++) south = stepFishing(south, i * 50, 0.05)
  assert.equal(south.facing, 'north')
})

test('all fish species can be caught and ambient swimmers reverse at bounds', () => {
  assert.equal(FISH_IDS.length, 5)
  let lower = 0
  for (const { fishId, chance } of fishChances()) {
    assert.equal(fishFromRoll(lower + chance / 2), fishId)
    lower += chance
  }
  assert.ok(Math.abs(lower - 1) < 1e-12)
  assert.equal(fishFromRoll(0.99), FISH_IDS.at(-1))
  assert.deepEqual(FISH_SWIMMERS.map(swimmer => swimmer.fishId).sort(), [...FISH_IDS].sort())
  for (const fishId of FISH_IDS) {
    const cast = castFishing({ ...initialFishingState(), phase: 'ready', spotId: 'south' }, 100, 2000, fishId)
    assert.equal(cast.fishId, fishId)
    let reeling = hookFishing({ ...cast, phase: 'bite', until: 3000 }, 1000)
    for (let i = 0; i < 180 && reeling.phase === 'reeling'; i++) {
      reeling = holdFishing(reeling, reeling.tension < 0.65)
      reeling = stepFishing(reeling, 1000 + i * 50, 0.05)
    }
    assert.equal(reeling.phase, 'caught')
    assert.equal(reeling.fishId, fishId)
  }
  for (const swimmer of FISH_SWIMMERS) {
    const start = swimmerPose(swimmer, 0, true)
    const toEnd = (swimmer.maxX - swimmer.minX - swimmer.offset) / swimmer.speed * 1000
    const end = swimmerPose(swimmer, toEnd, false)
    const returning = swimmerPose(swimmer, toEnd + 1000, false)
    assert.equal(start.facing, 'right')
    assert.ok(Math.abs(end.x - swimmer.maxX) < 0.001)
    assert.equal(returning.facing, 'left')
    assert.ok(returning.x < end.x)
  }
})

test('a trial cast reaches bite, can be missed, and never grants game rewards', () => {
  let state = goFishing(initialFishingState(), FISHING_SPOTS[2].stand, 'south')
  for (let i = 0; i < 100 && state.phase === 'moving'; i++) state = stepFishing(state, i * 50, 0.05)
  assert.equal(state.phase, 'ready')
  assert.equal(state.spotId, 'south')
  state = castFishing(state, 10000, 2000, 'silver')
  assert.equal(state.fishId, 'silver')
  assert.equal(stepFishing(state, 10800, 0).phase, 'waiting')
  state = stepFishing(state, 10800, 0)
  state = stepFishing(state, 12800, 0)
  assert.equal(state.phase, 'bite')
  assert.equal(stepFishing(state, 16001, 0).phase, 'escaped')
  assert.equal(hookFishing(state, 16001).phase, 'bite')
  assert.equal(readyAgain({ ...state, phase: 'escaped' }).phase, 'ready')
  assert.equal(leaveFishing(state).phase, 'roam')
  assert.deepEqual(Object.keys(state).sort(), [
    'caughtAt', 'facing', 'fight', 'fishId', 'holding', 'pendingSpot', 'phase', 'position', 'progress', 'route', 'spotId', 'tension', 'until', 'waitMs',
  ])
})

test('reeling requires controlled hold and release', () => {
  let state = hookFishing({ ...initialFishingState(), phase: 'bite', until: 1000 }, 100)
  for (let i = 0; i < 180 && state.phase === 'reeling'; i++) {
    state = holdFishing(state, state.tension < 0.65)
    state = stepFishing(state, 100 + i * 50, 0.05)
  }
  assert.equal(state.phase, 'caught')
  assert.ok(state.caughtAt > 0)
  const overload = stepFishing(holdFishing({ ...state, phase: 'reeling', tension: 0.99, until: 20000 }, true), 200, 0.05)
  assert.equal(overload.phase, 'escaped')
})
