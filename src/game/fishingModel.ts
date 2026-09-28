import type { FishId } from './fishingSpecies'

export const FISHING_WORLD = { width: 1408, height: 768 } as const

export type Point = { x: number; y: number }
export type Facing = 'north' | 'south' | 'west' | 'east'
export type FishingPhase = 'roam' | 'moving' | 'ready' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped'
export interface FishingFight {
  reelRate: number
  safeMax: number
  safeZoneWidth: number
  safeZoneSpeed: number
  safeZonePhase: number
}
const DEFAULT_FIGHT: FishingFight = {
  reelRate: 0.26, safeMax: 0.82, safeZoneWidth: 0.56, safeZoneSpeed: 0.18, safeZonePhase: 0,
}
export interface FishingSafeZone { min: number; max: number }
export const FISHING_SAFE_MIN = 0.2

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** The moving target used by both the simulation and the HUD. */
export function fishingSafeZone(fight: FishingFight, now: number): FishingSafeZone {
  const safeMax = clamp(fight.safeMax, FISHING_SAFE_MIN + 0.05, 0.98)
  const width = clamp(fight.safeZoneWidth, 0.05, safeMax - FISHING_SAFE_MIN)
  const travel = Math.max(0, safeMax - FISHING_SAFE_MIN - width)
  const cycle = ((now / 1000 * Math.max(0, fight.safeZoneSpeed) + fight.safeZonePhase) % 2 + 2) % 2
  const pingPong = cycle <= 1 ? cycle : 2 - cycle
  const min = FISHING_SAFE_MIN + travel * pingPong
  return { min, max: min + width }
}

export interface FishingSpot {
  id: string
  label: string
  stand: Point
  float: Point
}

export const FISHING_SPOTS: readonly FishingSpot[] = [
  { id: 'west', label: '西岸', stand: { x: 212, y: 457 }, float: { x: 335, y: 415 } },
  { id: 'west-step', label: '西石阶', stand: { x: 393, y: 564 }, float: { x: 453, y: 475 } },
  { id: 'south', label: '南岸', stand: { x: 700, y: 640 }, float: { x: 697, y: 494 } },
  { id: 'east-step', label: '东石阶', stand: { x: 982, y: 557 }, float: { x: 927, y: 476 } },
  { id: 'east', label: '东岸', stand: { x: 1184, y: 449 }, float: { x: 1055, y: 408 } },
]

// Conservative collision boundary for the painted shore, not a full navigation mesh.
const SHORE: readonly Point[] = [
  { x: 90, y: 438 }, { x: 212, y: 438 }, { x: 370, y: 528 },
  { x: 550, y: 572 }, { x: 700, y: 616 }, { x: 850, y: 570 },
  { x: 1030, y: 524 }, { x: 1184, y: 430 }, { x: 1320, y: 448 },
]
const WALK_BOTTOM = 715
const WALK_MARGIN = 14
const WALK_SPEED = 215

export function shorelineAt(x: number): number {
  const at = Math.max(SHORE[0].x, Math.min(SHORE[SHORE.length - 1].x, x))
  for (let i = 1; i < SHORE.length; i++) {
    if (at <= SHORE[i].x) {
      const a = SHORE[i - 1], b = SHORE[i]
      return a.y + (b.y - a.y) * (at - a.x) / (b.x - a.x)
    }
  }
  return SHORE[SHORE.length - 1].y
}

export function walkTarget(point: Point): Point {
  const x = Math.max(90, Math.min(1320, point.x))
  return { x, y: Math.max(shorelineAt(x) + WALK_MARGIN, Math.min(WALK_BOTTOM, point.y)) }
}

export function walkable(point: Point): boolean {
  return point.x >= 90 && point.x <= 1320 && point.y >= shorelineAt(point.x) + WALK_MARGIN && point.y <= WALK_BOTTOM
}

function segmentWalkable(a: Point, b: Point): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12)
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(1, steps)
    if (!walkable({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false
  }
  return true
}

export function walkRoute(from: Point, to: Point): Point[] {
  const target = walkTarget(to)
  if (segmentWalkable(from, target)) return [target]
  const path = [{ x: from.x, y: 685 }, { x: target.x, y: 685 }, target]
  return path.filter((point, i) => i === path.length - 1 || Math.hypot(point.x - from.x, point.y - from.y) > 1)
}

export interface FishingState {
  position: Point
  facing: Facing
  route: Point[]
  pendingSpot: string | null
  spotId: string | null
  phase: FishingPhase
  until: number
  tension: number
  progress: number
  holding: boolean
  waitMs: number
  fishId: FishId | null
  caughtAt: number
  fight: FishingFight
}

export function initialFishingState(): FishingState {
  return { position: { x: 700, y: 685 }, facing: 'south', route: [], pendingSpot: null, spotId: null,
    phase: 'roam', until: 0, tension: 0.35, progress: 0, holding: false, waitMs: 0, fishId: null, caughtAt: 0,
    fight: { ...DEFAULT_FIGHT } }
}

export function facingToward(from: Point, to: Point, fallback: Facing): Facing {
  const dx = to.x - from.x, dy = to.y - from.y
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north')
}

export function goFishing(state: FishingState, target: Point, spotId: string | null = null): FishingState {
  if (state.phase === 'casting' || state.phase === 'waiting' || state.phase === 'bite' || state.phase === 'reeling') return state
  const spot = FISHING_SPOTS.find(item => item.id === spotId)
  const route = walkRoute(state.position, spot?.stand ?? target)
  return { ...state, route, facing: facingToward(state.position, route[0], state.facing),
    pendingSpot: spot?.id ?? null, spotId: null, phase: 'moving', waitMs: 0, fishId: null, caughtAt: 0 }
}

export function castFishing(state: FishingState, now: number, waitMs: number, fishId: FishId,
  fight: FishingFight = DEFAULT_FIGHT): FishingState {
  if (state.phase !== 'ready') return state
  return { ...state, phase: 'casting', until: now + 800, waitMs: Math.max(2000, Math.min(9000, waitMs)),
    progress: 0, fishId, caughtAt: 0, fight: {
      reelRate: Math.max(0.15, Math.min(0.4, fight.reelRate)),
      safeMax: Math.max(0.75, Math.min(0.95, fight.safeMax)),
      safeZoneWidth: Math.max(0.05, Math.min(0.8, fight.safeZoneWidth)),
      safeZoneSpeed: Math.max(0, Math.min(2, fight.safeZoneSpeed)),
      safeZonePhase: ((fight.safeZonePhase % 1) + 1) % 1,
    } }
}

export function hookFishing(state: FishingState, now: number): FishingState {
  if (state.phase !== 'bite' || now > state.until) return state
  return { ...state, phase: 'reeling', until: now + 12000, tension: 0.4, progress: 0, holding: false }
}

export function holdFishing(state: FishingState, held: boolean): FishingState {
  return state.phase === 'reeling' ? { ...state, holding: held } : state
}

export function leaveFishing(state: FishingState): FishingState {
  return { ...state, phase: 'roam', pendingSpot: null, spotId: null, route: [], holding: false,
    waitMs: 0, fishId: null, caughtAt: 0 }
}

export function readyAgain(state: FishingState): FishingState {
  if (state.phase !== 'caught' && state.phase !== 'escaped') return state
  return { ...state, phase: state.spotId ? 'ready' : 'roam', holding: false, progress: 0,
    tension: 0.35, fishId: null, caughtAt: 0 }
}

export function stepFishing(state: FishingState, now: number, deltaSeconds: number): FishingState {
  const dt = Math.max(0, Math.min(0.05, deltaSeconds))
  if (state.phase === 'moving') {
    const [target, ...rest] = state.route
    if (!target) {
      const spot = FISHING_SPOTS.find(item => item.id === state.pendingSpot)
      return { ...state, phase: spot ? 'ready' : 'roam', spotId: spot?.id ?? null, pendingSpot: null,
        facing: spot ? facingToward(state.position, spot.float, state.facing) : state.facing }
    }
    const dx = target.x - state.position.x, dy = target.y - state.position.y
    const distance = Math.hypot(dx, dy)
    if (distance <= WALK_SPEED * dt) return { ...state, position: target, route: rest,
      facing: rest.length ? facingToward(target, rest[0], state.facing) : state.facing }
    const next = { x: state.position.x + dx / distance * WALK_SPEED * dt,
      y: state.position.y + dy / distance * WALK_SPEED * dt }
    return { ...state, position: next }
  }
  if (state.phase === 'casting' && now >= state.until) return { ...state, phase: 'waiting', until: now + state.waitMs }
  if (state.phase === 'waiting' && now >= state.until) return { ...state, phase: 'bite', until: now + 3200 }
  if (state.phase === 'bite' && now > state.until) return { ...state, phase: 'escaped', holding: false }
  if (state.phase === 'reeling') {
    const tension = Math.max(0, state.tension + (state.holding ? 0.33 : -0.21) * dt + Math.sin(now / 420) * 0.025 * dt)
    const safeZone = fishingSafeZone(state.fight, now)
    const inSafeZone = tension >= safeZone.min && tension <= safeZone.max
    const progress = state.progress + (inSafeZone ? state.fight.reelRate : -0.08) * dt
    if (tension >= 1 || now > state.until) return { ...state, phase: 'escaped', tension, progress, holding: false }
    if (progress >= 1) return { ...state, phase: 'caught', tension, progress: 1, holding: false, caughtAt: now }
    return { ...state, tension, progress: Math.max(0, progress) }
  }
  return state
}
