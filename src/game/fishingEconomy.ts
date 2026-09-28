import { FISH_SPECIES, fishFromRoll, type FishId } from './fishingSpecies.ts'
import type { FishingFight } from './fishingModel.ts'

export const BAG_LIMIT = 24
export const TRIAL_STORAGE_KEY = 'doupo.fishing.trial.v1'

export const RODS = {
  bamboo: { name: '青竹竿', price: 0, rareBoost: 1, qualityBonus: 0, reelRate: 0.26, safeMax: 0.82,
    detail: '入门竿 · 基础控线' },
  iron: { name: '玄铁竿', price: 120, rareBoost: 1.3, qualityBonus: 0.03, reelRate: 0.31, safeMax: 0.87,
    detail: '收线更快 · 容错更宽' },
  spirit: { name: '灵木竿', price: 360, rareBoost: 1.55, qualityBonus: 0.07, reelRate: 0.36, safeMax: 0.92,
    detail: '更易遇见稀鱼 · 强化控线' },
} as const
export type RodId = keyof typeof RODS
export const ROD_IDS = Object.keys(RODS) as RodId[]

export const BAITS = {
  plain: { name: '素钩', price: 0, pack: 0, rareBoost: 1, qualityBonus: 0, waitFactor: 1,
    detail: '不限次数 · 常规鱼讯' },
  fragrant: { name: '香饵', price: 24, pack: 5, rareBoost: 1.45, qualityBonus: 0.03, waitFactor: 0.78,
    detail: '每包 5 次 · 鱼讯更快' },
  moon: { name: '月光虫', price: 72, pack: 5, rareBoost: 2.2, qualityBonus: 0.08, waitFactor: 0.55,
    detail: '每包 5 次 · 稀鱼更易上钩' },
} as const
export type BaitId = keyof typeof BAITS
export const BAIT_IDS = Object.keys(BAITS) as BaitId[]

export const QUALITY = {
  plain: { name: '凡品', multiplier: 1 },
  fine: { name: '良品', multiplier: 1.5 },
  prized: { name: '珍品', multiplier: 2.5 },
} as const
export type FishQuality = keyof typeof QUALITY
export type AvatarId = 'male' | 'female'

export interface CatchRecord {
  id: number
  fishId: FishId
  quality: FishQuality
  locked: boolean
}

export interface FishingProfile {
  avatar: AvatarId
  coins: number
  catches: CatchRecord[]
  nextId: number
  ownedRods: RodId[]
  rodId: RodId
  baitId: BaitId
  baitStock: Record<'fragrant' | 'moon', number>
}

export function initialFishingProfile(): FishingProfile {
  return { avatar: 'male', coins: 0, catches: [], nextId: 1, ownedRods: ['bamboo'], rodId: 'bamboo',
    baitId: 'plain', baitStock: { fragrant: 0, moon: 0 } }
}

export function qualityChances(bonus = 0): Record<FishQuality, number> {
  const increase = Math.max(0, Math.min(0.25, Number.isFinite(bonus) ? bonus : 0))
  return { prized: 0.05 + increase, fine: 0.25 + increase / 2, plain: 0.7 - increase * 1.5 }
}

export function qualityFromRoll(roll: number, bonus = 0): FishQuality {
  const chance = qualityChances(bonus)
  const value = Math.max(0, Math.min(1 - Number.EPSILON, Number.isFinite(roll) ? roll : 0))
  return value < chance.prized ? 'prized' : value < chance.prized + chance.fine ? 'fine' : 'plain'
}

export function effectiveBait(profile: FishingProfile): BaitId {
  return profile.baitId !== 'plain' && profile.baitStock[profile.baitId] > 0 ? profile.baitId : 'plain'
}

export function castOdds(profile: FishingProfile) {
  const rod = RODS[profile.rodId], bait = BAITS[effectiveBait(profile)]
  return { rareBoost: rod.rareBoost * bait.rareBoost, qualityBonus: rod.qualityBonus + bait.qualityBonus,
    waitFactor: bait.waitFactor }
}

export function rollCatch(profile: FishingProfile, fishRoll: number, qualityRoll: number):
  { fishId: FishId; quality: FishQuality; fight: FishingFight; waitFactor: number } {
  const odds = castOdds(profile)
  const fishId = fishFromRoll(fishRoll, odds.rareBoost)
  const rod = RODS[profile.rodId]
  const difficulty = FISH_SPECIES[fishId].fight
  const safeZoneWidth = Math.max(0.2, Math.min(0.42,
    0.38 - (difficulty - 1) * 0.4 + (rod.safeMax - RODS.bamboo.safeMax) * 0.3))
  const safeZoneSpeed = Math.max(0.38, Math.min(0.75,
    0.42 + (difficulty - 1) * 0.55 - (rod.safeMax - RODS.bamboo.safeMax) * 0.35))
  return { fishId, quality: qualityFromRoll(qualityRoll, odds.qualityBonus),
    fight: { reelRate: rod.reelRate / difficulty, safeMax: rod.safeMax,
      safeZoneWidth, safeZoneSpeed,
      safeZonePhase: (fishRoll * 0.73 + qualityRoll * 0.27) % 1 },
    waitFactor: odds.waitFactor }
}

export function useBait(profile: FishingProfile): FishingProfile {
  const bait = effectiveBait(profile)
  if (bait === 'plain') return { ...profile, baitId: 'plain' }
  const remaining = profile.baitStock[bait] - 1
  return { ...profile, baitId: remaining ? bait : 'plain',
    baitStock: { ...profile.baitStock, [bait]: remaining } }
}

export function catchValue(record: CatchRecord): number {
  return Math.floor(FISH_SPECIES[record.fishId].value * QUALITY[record.quality].multiplier)
}

export function addCatch(profile: FishingProfile, fishId: FishId, quality: FishQuality): FishingProfile {
  if (profile.catches.length >= BAG_LIMIT) return profile
  return { ...profile, nextId: profile.nextId + 1,
    catches: [{ id: profile.nextId, fishId, quality, locked: false }, ...profile.catches] }
}

export function toggleCatchLock(profile: FishingProfile, id: number): FishingProfile {
  return { ...profile, catches: profile.catches.map(record => record.id === id ? { ...record, locked: !record.locked } : record) }
}

export function sellCatch(profile: FishingProfile, id: number): FishingProfile {
  const record = profile.catches.find(item => item.id === id && !item.locked)
  if (!record) return profile
  return { ...profile, coins: profile.coins + catchValue(record),
    catches: profile.catches.filter(item => item.id !== id) }
}

export function sellUnlocked(profile: FishingProfile): FishingProfile {
  return { ...profile, coins: profile.coins + profile.catches.filter(item => !item.locked)
    .reduce((sum, item) => sum + catchValue(item), 0), catches: profile.catches.filter(item => item.locked) }
}

export function buyRod(profile: FishingProfile, rodId: RodId): FishingProfile {
  const price = RODS[rodId].price
  if (profile.ownedRods.includes(rodId) || profile.coins < price) return profile
  return { ...profile, coins: profile.coins - price, ownedRods: [...profile.ownedRods, rodId], rodId }
}

export function buyBait(profile: FishingProfile, baitId: Exclude<BaitId, 'plain'>): FishingProfile {
  const bait = BAITS[baitId]
  if (profile.coins < bait.price) return profile
  return { ...profile, coins: profile.coins - bait.price,
    baitStock: { ...profile.baitStock, [baitId]: profile.baitStock[baitId] + bait.pack }, baitId }
}

export function canExchangeFish(profile: FishingProfile): boolean {
  const available = profile.catches.filter(item => !item.locked)
  return available.filter(item => item.fishId === 'silver').length >= 2 &&
    available.some(item => item.fishId === 'perch')
}

export function exchangeFish(profile: FishingProfile): FishingProfile {
  const available = profile.catches.filter(item => !item.locked)
  const silver = available.filter(item => item.fishId === 'silver').slice(0, 2)
  const perch = available.find(item => item.fishId === 'perch')
  if (silver.length < 2 || !perch) return profile
  const consumed = new Set([...silver.map(item => item.id), perch.id])
  return { ...profile, catches: profile.catches.filter(item => !consumed.has(item.id)),
    baitStock: { ...profile.baitStock, moon: profile.baitStock.moon + 3 }, baitId: 'moon' }
}

function quantity(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0
}

export function restoreFishingProfile(raw: string | null): FishingProfile {
  const base = initialFishingProfile()
  if (!raw) return base
  try {
    const saved = JSON.parse(raw)
    if (saved?.version !== 1 || !saved.profile || typeof saved.profile !== 'object') return base
    const source = saved.profile
    const ownedRods = ROD_IDS.filter(id => id === 'bamboo' || (Array.isArray(source.ownedRods) && source.ownedRods.includes(id)))
    const seen = new Set<number>()
    const catches: CatchRecord[] = Array.isArray(source.catches) ? source.catches
      .filter((item: CatchRecord) => item && Number.isSafeInteger(item.id) && item.id > 0 && item.id <= 1_000_000 &&
        Object.hasOwn(FISH_SPECIES, item.fishId) && Object.hasOwn(QUALITY, item.quality) &&
        !seen.has(item.id) && !!seen.add(item.id))
      .slice(0, BAG_LIMIT)
      .map((item: CatchRecord) => ({ id: item.id, fishId: item.fishId, quality: item.quality, locked: item.locked === true })) : []
    const nextId = Math.max(quantity(source.nextId, 1_000_000), ...catches.map(item => item.id + 1), 1)
    const baitStock = { fragrant: quantity(source.baitStock?.fragrant, 999), moon: quantity(source.baitStock?.moon, 999) }
    const baitId = BAIT_IDS.find(id => id === source.baitId) ?? 'plain'
    return { avatar: source.avatar === 'female' ? 'female' : 'male', coins: quantity(source.coins, 1_000_000),
      catches, nextId, ownedRods, rodId: ownedRods.includes(source.rodId) ? source.rodId : 'bamboo',
      baitId: baitId !== 'plain' && baitStock[baitId] < 1 ? 'plain' : baitId, baitStock }
  } catch { return base }
}

export function serializeFishingProfile(profile: FishingProfile): string {
  return JSON.stringify({ version: 1, profile })
}
