export const FISH_SPECIES = {
  carp: { name: '灵鲤', size: 70, rarity: '寻常', weight: 42, value: 8, fight: 1 },
  silver: { name: '银鳞鱼', size: 66, rarity: '寻常', weight: 30, value: 11, fight: 1.05 },
  perch: { name: '赤纹鲈', size: 68, rarity: '少见', weight: 17, value: 20, fight: 1.16 },
  catfish: { name: '墨金鲶', size: 67, rarity: '稀有', weight: 8, value: 35, fight: 1.28 },
  bream: { name: '翠鳍鳊', size: 66, rarity: '奇珍', weight: 3, value: 65, fight: 1.4 },
} as const

export type FishId = keyof typeof FISH_SPECIES
export const FISH_IDS = Object.keys(FISH_SPECIES) as FishId[]

const RARITY_POWER = { '寻常': 0, '少见': 1, '稀有': 2, '奇珍': 3 } as const

export function fishChances(rareBoost = 1): { fishId: FishId; chance: number }[] {
  const boost = Math.max(1, Math.min(4, Number.isFinite(rareBoost) ? rareBoost : 1))
  const weights = FISH_IDS.map(fishId => FISH_SPECIES[fishId].weight * boost ** (RARITY_POWER[FISH_SPECIES[fishId].rarity] / 2))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return FISH_IDS.map((fishId, index) => ({ fishId, chance: weights[index] / total }))
}

export function fishFromRoll(roll: number, rareBoost = 1): FishId {
  let remaining = Math.max(0, Math.min(1 - Number.EPSILON, Number.isFinite(roll) ? roll : 0))
  for (const { fishId, chance } of fishChances(rareBoost)) {
    remaining -= chance
    if (remaining < 0) return fishId
  }
  return FISH_IDS[FISH_IDS.length - 1]
}

export interface Swimmer {
  fishId: FishId
  minX: number
  maxX: number
  y: number
  speed: number
  offset: number
}

export const FISH_SWIMMERS: readonly Swimmer[] = [
  { fishId: 'silver', minX: 330, maxX: 795, y: 343, speed: 33, offset: 120 },
  { fishId: 'carp', minX: 425, maxX: 1010, y: 431, speed: 26, offset: 340 },
  { fishId: 'perch', minX: 720, maxX: 1080, y: 390, speed: 29, offset: 300 },
  { fishId: 'catfish', minX: 360, maxX: 980, y: 464, speed: 24, offset: 450 },
  { fishId: 'bream', minX: 585, maxX: 975, y: 316, speed: 31, offset: 90 },
]

export function swimmerPose(swimmer: Swimmer, time: number, reduced: boolean) {
  const span = swimmer.maxX - swimmer.minX
  const distance = swimmer.offset + (reduced ? 0 : time / 1000 * swimmer.speed)
  const phase = ((distance % (span * 2)) + span * 2) % (span * 2)
  return {
    x: swimmer.minX + (phase <= span ? phase : 2 * span - phase),
    y: swimmer.y + (reduced ? 0 : Math.sin(time / 820 + swimmer.offset) * 5),
    facing: phase <= span ? 'right' as const : 'left' as const,
  }
}
