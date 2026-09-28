import { FISHING_SPOTS, FISHING_WORLD, type FishingState, type Point } from './fishingModel'
import { FISH_SPECIES, FISH_SWIMMERS, swimmerPose, type FishId } from './fishingSpecies'
import type { AvatarId } from './fishingEconomy'
import { fishingActionDirection, fishingActionFrame } from './fishingAnimation'

export interface FishingArt {
  pond: HTMLImageElement | null
  avatars: Record<AvatarId, HTMLImageElement | null>
  walking: Record<AvatarId, HTMLImageElement | null>
  fishing: Record<AvatarId, HTMLImageElement | null>
  fish: Record<FishId, HTMLImageElement | null>
  willow: HTMLImageElement | null
}

export interface FishingCamera {
  scale: number
  left: number
  top: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function fishingCamera(width: number, height: number, player: Point): FishingCamera {
  const scale = Math.max(width / FISHING_WORLD.width, height / FISHING_WORLD.height)
  const visibleW = width / scale, visibleH = height / scale
  const cx = clamp(player.x, visibleW / 2, FISHING_WORLD.width - visibleW / 2)
  const cy = clamp(470, visibleH / 2, FISHING_WORLD.height - visibleH / 2)
  return { scale, left: width / 2 - cx * scale, top: height / 2 - cy * scale }
}

export function screenToPond(point: Point, camera: FishingCamera): Point {
  return { x: (point.x - camera.left) / camera.scale, y: (point.y - camera.top) / camera.scale }
}

function loaded(image: HTMLImageElement | null): image is HTMLImageElement {
  return !!image && image.complete && image.naturalWidth > 0
}

function drawRipple(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, phase: number) {
  const pulse = (time / 2100 + phase) % 1
  ctx.strokeStyle = `rgba(222, 252, 223, ${0.28 * (1 - pulse)})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(x, y, 9 + pulse * 27, 3 + pulse * 10, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function drawWater(ctx: CanvasRenderingContext2D, time: number, reduced: boolean) {
  const now = reduced ? 0 : time
  for (const [x, y, phase] of [[430, 341, 0], [836, 388, 0.35], [658, 486, 0.65], [970, 322, 0.85]]) {
    drawRipple(ctx, x, y, now, phase)
  }
  for (let i = 0; i < 12; i++) {
    const x = 370 + i * 52, y = 312 + (i * 41) % 160
    const drift = reduced ? 0 : Math.sin(time / 1300 + i * 1.7) * 5
    ctx.fillStyle = `rgba(223, 255, 218, ${0.13 + (reduced ? 0 : Math.sin(time / 800 + i) * 0.05)})`
    ctx.beginPath()
    ctx.ellipse(x + drift, y, 8 + i % 3 * 4, 1.5, -0.08, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawFish(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, frame: number,
  x: number, y: number, size: number, facing: 'left' | 'right') {
  if (!loaded(image)) return
  ctx.save()
  ctx.translate(x, y)
  if (facing === 'left') ctx.scale(-1, 1)
  ctx.drawImage(image, (frame % 4) * 512, Math.floor(frame / 4) * 512, 512, 512,
    -size / 2, -size / 2, size, size)
  ctx.restore()
}

function drawSwimmers(ctx: CanvasRenderingContext2D, art: FishingArt, time: number, reduced: boolean) {
  ctx.save()
  ctx.globalAlpha = 0.57
  ctx.filter = 'saturate(0.85) brightness(0.9)'
  for (const [index, swimmer] of FISH_SWIMMERS.entries()) {
    const pose = swimmerPose(swimmer, time, reduced)
    const frame = reduced ? 0 : (Math.floor(time / 120) + index * 2) % 8
    drawFish(ctx, art.fish[swimmer.fishId], frame, pose.x, pose.y,
      FISH_SPECIES[swimmer.fishId].size, pose.facing)
  }
  ctx.restore()
}

function drawSpot(ctx: CanvasRenderingContext2D, spot: typeof FISHING_SPOTS[number], selected: boolean, time: number) {
  const { x, y } = spot.stand
  const pulse = Math.sin(time / 350) * 2
  ctx.fillStyle = selected ? 'rgba(255, 196, 91, 0.24)' : 'rgba(20, 50, 35, 0.3)'
  ctx.strokeStyle = selected ? '#ffe1a0' : 'rgba(239, 229, 182, 0.86)'
  ctx.lineWidth = selected ? 3 : 2
  ctx.beginPath()
  ctx.ellipse(x, y + 3, 31 + pulse, 13 + pulse * 0.4, 0, 0, Math.PI * 2)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = selected ? '#fff4d0' : '#f1e7c3'
  ctx.font = '600 19px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.shadowColor = '#19140c'; ctx.shadowBlur = 8
  ctx.fillText(spot.label, x, y - 19)
  ctx.shadowBlur = 0
}

function drawFloat(ctx: CanvasRenderingContext2D, state: FishingState, time: number) {
  const spot = FISHING_SPOTS.find(item => item.id === state.spotId)
  if (!spot || !['casting', 'waiting', 'bite', 'reeling'].includes(state.phase)) return
  const cast = state.phase === 'casting' ? clamp((time - (state.until - 800)) / 800, 0, 1) : 1
  if (cast < 0.5) return
  const progress = clamp((cast - 0.5) * 2, 0, 1)
  const bob = { x: state.position.x + (spot.float.x - state.position.x) * progress,
    y: state.position.y - 95 + (spot.float.y - state.position.y + 95) * progress +
      Math.sin(time / 180) * (state.phase === 'bite' ? 5 : 1.5) }
  ctx.fillStyle = state.phase === 'bite' ? '#ff7041' : '#ffefe0'
  ctx.beginPath(); ctx.arc(bob.x, bob.y, state.phase === 'bite' ? 7 : 5, 0, Math.PI * 2); ctx.fill()
  if (state.phase === 'bite') drawRipple(ctx, bob.x, bob.y, time, 0.2)
}

function drawPlayer(ctx: CanvasRenderingContext2D, art: FishingArt, state: FishingState,
  avatar: AvatarId, time: number, reduced: boolean) {
  const { x, y } = state.position
  ctx.fillStyle = 'rgba(13, 15, 9, 0.42)'
  ctx.beginPath(); ctx.ellipse(x, y + 2, 37, 10, 0, 0, Math.PI * 2); ctx.fill()
  const isFishing = !!state.spotId && state.phase !== 'moving'
  const actionImage = art.fishing[avatar]
  if (isFishing && loaded(actionImage)) {
    const { row, mirror } = fishingActionDirection(state.facing)
    const frame = fishingActionFrame(state.phase, state.until, time)
    ctx.save()
    if (mirror) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0) }
    ctx.drawImage(actionImage, frame * 256, row * 160, 256, 160,
      x - 78, y - 152, 256, 160)
    ctx.restore()
    return
  }
  const image = state.phase === 'moving' ? art.walking[avatar] : art.avatars[avatar]
  if (!loaded(image)) return
  const frame = state.phase === 'moving' && !reduced ? Math.floor(time / 105) % 8 : 0
  const row = { south: 0, north: 1, west: 2, east: 3 }[state.facing]
  ctx.drawImage(image, frame * 128, row * 160, 128, 160, x - 64, y - 152, 128, 160)
}

function drawCatch(ctx: CanvasRenderingContext2D, art: FishingArt, state: FishingState, time: number, reduced: boolean) {
  if (state.phase !== 'caught' || !state.fishId) return
  const spot = FISHING_SPOTS.find(item => item.id === state.spotId)
  if (!spot) return
  const age = reduced ? 1600 : Math.max(0, time - state.caughtAt)
  const flight = clamp(age / 1050, 0, 1)
  const start = spot.float, end = { x: state.position.x + 55, y: state.position.y - 120 }
  if (age < 1100) {
    const burst = clamp(age / 800, 0, 1)
    ctx.save()
    ctx.globalAlpha = 1 - burst
    ctx.strokeStyle = '#e5fff0'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.ellipse(start.x, start.y, 13 + 55 * burst, 5 + 20 * burst, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#dcfff2'
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9
      const radius = 16 + 68 * burst
      ctx.beginPath()
      ctx.arc(start.x + Math.cos(angle) * radius, start.y - Math.abs(Math.sin(angle)) * 48 * burst,
        2.5 + i % 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  const x = start.x + (end.x - start.x) * flight
  const y = start.y + (end.y - start.y) * flight - Math.sin(flight * Math.PI) * 82
  ctx.save()
  ctx.shadowColor = '#fff2aa'; ctx.shadowBlur = age < 1400 ? 18 : 9
  drawFish(ctx, art.fish[state.fishId], Math.floor(time / 115) % 8, x, y, 76, 'right')
  ctx.restore()
  if (age < 1600) {
    ctx.save()
    ctx.globalAlpha = 1 - clamp(age / 1600, 0, 1)
    ctx.fillStyle = '#ffe5a1'
    for (let i = 0; i < 5; i++) {
      const angle = time / 480 + i * Math.PI * 2 / 5
      ctx.beginPath(); ctx.arc(end.x + Math.cos(angle) * 56, end.y + Math.sin(angle) * 36, 2.5, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
}

function drawFoliage(ctx: CanvasRenderingContext2D, art: FishingArt, time: number, reduced: boolean) {
  if (!loaded(art.willow)) return
  for (const [x, y, size, phase, flip] of [[180, 158, 360, 0, 1], [1180, 138, 310, 1.5, -1]]) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(reduced ? 0 : Math.sin(time / 1600 + phase) * 0.035)
    ctx.scale(flip, 1)
    ctx.drawImage(art.willow, -size * 0.58, -size * 0.22, size, size)
    ctx.restore()
  }
}

export function drawFishingScene(ctx: CanvasRenderingContext2D, art: FishingArt, state: FishingState,
  avatar: AvatarId, time: number, width: number, height: number, reduced: boolean): FishingCamera {
  const camera = fishingCamera(width, height, state.position)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#254c42'; ctx.fillRect(0, 0, width, height)
  ctx.save()
  ctx.translate(camera.left, camera.top)
  ctx.scale(camera.scale, camera.scale)
  if (loaded(art.pond)) ctx.drawImage(art.pond, 0, 0, FISHING_WORLD.width, FISHING_WORLD.height)
  drawSwimmers(ctx, art, time, reduced)
  drawWater(ctx, time, reduced)
  for (const spot of FISHING_SPOTS) drawSpot(ctx, spot, spot.id === (state.spotId ?? state.pendingSpot), reduced ? 0 : time)
  drawPlayer(ctx, art, state, avatar, time, reduced)
  drawFloat(ctx, state, time)
  drawCatch(ctx, art, state, time, reduced)
  drawFoliage(ctx, art, time, reduced)
  ctx.restore()
  return camera
}
