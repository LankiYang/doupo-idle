import assert from 'node:assert/strict'
import test from 'node:test'
import { FISH_IDS, fishChances, fishFromRoll } from './fishingSpecies.ts'
import { BAG_LIMIT, addCatch, buyBait, buyRod, canExchangeFish, castOdds, catchValue,
  effectiveBait, exchangeFish, initialFishingProfile, qualityChances, qualityFromRoll,
  restoreFishingProfile, rollCatch, sellCatch, sellUnlocked, serializeFishingProfile,
  toggleCatchLock, useBait } from './fishingEconomy.ts'

test('species and quality probabilities are normalized, ordered and change with gear', () => {
  const base = initialFishingProfile()
  const upgraded = buyBait(buyRod({ ...base, coins: 1000 }, 'spirit'), 'moon')
  for (const profile of [base, upgraded]) {
    const odds = castOdds(profile)
    const species = fishChances(odds.rareBoost)
    const quality = qualityChances(odds.qualityBonus)
    assert.ok(Math.abs(species.reduce((total, item) => total + item.chance, 0) - 1) < 1e-12)
    assert.ok(Math.abs(Object.values(quality).reduce((total, value) => total + value, 0) - 1) < 1e-12)
    let start = 0
    for (const { fishId, chance } of species) {
      assert.equal(fishFromRoll(start + chance / 2, odds.rareBoost), fishId)
      start += chance
    }
  }
  assert.deepEqual(FISH_IDS, ['carp', 'silver', 'perch', 'catfish', 'bream'])
  assert.ok(fishChances(castOdds(upgraded).rareBoost).at(-1).chance > fishChances()[4].chance)
  assert.ok(fishChances(castOdds(upgraded).rareBoost).at(-1).chance < 0.15)
  assert.ok(qualityChances(castOdds(upgraded).qualityBonus).prized > qualityChances().prized)
  assert.equal(qualityFromRoll(0), 'prized')
  assert.equal(qualityFromRoll(0.05), 'fine')
  assert.equal(qualityFromRoll(0.3), 'plain')
  assert.equal(qualityFromRoll(1), 'plain')
  const catchRoll = rollCatch(upgraded, 0.99, 0)
  assert.equal(catchRoll.fishId, 'bream')
  assert.equal(catchRoll.quality, 'prized')
  assert.ok(catchRoll.fight.reelRate < rollCatch(base, 0, 0).fight.reelRate)
  assert.ok(catchRoll.waitFactor < 1)
})

test('purchases, equipment, bait use and insufficient funds', () => {
  const base = initialFishingProfile()
  assert.equal(buyRod(base, 'iron'), base)
  assert.equal(buyBait(base, 'fragrant'), base)
  const iron = buyRod({ ...base, coins: 120 }, 'iron')
  assert.equal(iron.coins, 0)
  assert.equal(iron.rodId, 'iron')
  assert.equal(buyRod(iron, 'iron'), iron)
  const bait = buyBait({ ...iron, coins: 24 }, 'fragrant')
  assert.equal(bait.baitStock.fragrant, 5)
  assert.equal(effectiveBait(bait), 'fragrant')
  let spent = bait
  for (let i = 0; i < 5; i++) spent = useBait(spent)
  assert.equal(spent.baitStock.fragrant, 0)
  assert.equal(spent.baitId, 'plain')
  assert.equal(effectiveBait(spent), 'plain')
  assert.equal(castOdds(spent).waitFactor, 1)
})

test('bag capacity, quality value, locking and sales', () => {
  let profile = initialFishingProfile()
  profile = addCatch(profile, 'carp', 'plain')
  profile = addCatch(profile, 'bream', 'prized')
  assert.equal(catchValue(profile.catches[0]), 162)
  assert.equal(profile.nextId, 3)
  profile = toggleCatchLock(profile, 2)
  assert.equal(sellCatch(profile, 2), profile)
  profile = sellUnlocked(profile)
  assert.equal(profile.coins, 8)
  assert.deepEqual(profile.catches.map(item => item.id), [2])
  profile = toggleCatchLock(profile, 2)
  profile = sellCatch(profile, 2)
  assert.equal(profile.coins, 170)
  assert.equal(profile.catches.length, 0)
  for (let i = 0; i < BAG_LIMIT; i++) profile = addCatch(profile, 'silver', 'fine')
  assert.equal(addCatch(profile, 'carp', 'plain'), profile)
  assert.equal(profile.catches.length, BAG_LIMIT)
})

test('exchange consumes only unlocked recipe fish and grants moon bait', () => {
  let profile = initialFishingProfile()
  for (const fish of ['silver', 'perch', 'silver', 'silver']) profile = addCatch(profile, fish, 'plain')
  profile = toggleCatchLock(profile, 4)
  assert.ok(canExchangeFish(profile))
  const exchanged = exchangeFish(profile)
  assert.deepEqual(exchanged.catches.map(item => item.id), [4])
  assert.equal(exchanged.baitStock.moon, 3)
  assert.equal(exchanged.baitId, 'moon')
  assert.equal(canExchangeFish(exchanged), false)
  assert.equal(exchangeFish(exchanged), exchanged)
  assert.equal(canExchangeFish(toggleCatchLock(profile, 3)), false)
})

test('versioned session recovery rejects invalid data and preserves valid trial state', () => {
  assert.deepEqual(restoreFishingProfile(null), initialFishingProfile())
  assert.deepEqual(restoreFishingProfile('{'), initialFishingProfile())
  assert.deepEqual(restoreFishingProfile('{"version":2,"profile":{}}'), initialFishingProfile())
  const original = addCatch(buyBait({ ...initialFishingProfile(), avatar: 'female', coins: 100 }, 'fragrant'), 'perch', 'fine')
  assert.deepEqual(restoreFishingProfile(serializeFishingProfile(original)), original)
  const restored = restoreFishingProfile(JSON.stringify({ version: 1, profile: {
    avatar: 'other', coins: -50, ownedRods: 'spirit', rodId: 'spirit', baitId: 'moon',
    baitStock: { moon: -2 }, catches: [
      { id: 7, fishId: 'carp', quality: 'plain', locked: true },
      { id: 7, fishId: 'bream', quality: 'prized' },
      { id: 8, fishId: '__proto__', quality: 'plain' },
      { id: 9, fishId: 'silver', quality: 'invalid' },
    ],
  } }))
  assert.equal(restored.avatar, 'male')
  assert.equal(restored.coins, 0)
  assert.deepEqual(restored.ownedRods, ['bamboo'])
  assert.equal(restored.rodId, 'bamboo')
  assert.equal(restored.baitId, 'plain')
  assert.deepEqual(restored.catches.map(item => item.id), [7])
  assert.equal(restored.nextId, 8)
})
