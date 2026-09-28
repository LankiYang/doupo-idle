import type { Facing, FishingPhase } from './fishingModel'

export function fishingActionFrame(phase: FishingPhase, until: number, time: number): number {
  if (phase === 'casting') {
    const elapsed = Math.max(0, Math.min(800, time - (until - 800)))
    return elapsed < 120 ? 0 : elapsed < 340 ? 1 : elapsed < 600 ? 2 : 3
  }
  return phase === 'waiting' || phase === 'bite' || phase === 'reeling' || phase === 'caught' ? 3 : 0
}

export function fishingActionDirection(facing: Facing): { row: number; mirror: boolean } {
  return { row: facing === 'north' ? 1 : 0, mirror: facing === 'west' }
}
