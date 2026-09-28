import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Fish, Hand, MapPin, RotateCcw, Waves, X, ShoppingBag, Coins, Store } from 'lucide-react'
import pondUrl from '../assets/sprites/fishing/pond.webp'
import willowUrl from '../assets/sprites/fishing/willow.webp'
import { AVATAR_URLS, WALK_URLS, FISHING_ACTION_URLS, FISH_URLS } from '../game/fishingAssets'
import { FISH_SPECIES } from '../game/fishingSpecies'
import { BAG_LIMIT, QUALITY, TRIAL_STORAGE_KEY, addCatch, restoreFishingProfile, rollCatch,
  serializeFishingProfile, useBait, type FishQuality, type FishingProfile } from '../game/fishingEconomy'
import {
  FISHING_SPOTS, initialFishingState, goFishing, castFishing, hookFishing, holdFishing,
  leaveFishing, readyAgain, stepFishing, type FishingState,
} from '../game/fishingModel'
import { drawFishingScene, screenToPond, type FishingArt, type FishingCamera } from '../game/fishingScene'
import { FishingBag, FishingShop } from './FishingPanels'

const STATUS: Record<FishingState['phase'], string> = {
  roam: '沿岸寻找钓位', moving: '走向钓位', ready: '已占钓位', casting: '抛竿中',
  waiting: '静候鱼讯', bite: '鱼讯到了，快扬竿', reeling: '稳住鱼线',
  caught: '钓获灵鱼', escaped: '鱼脱钩了',
}

function loadArt(url: string): HTMLImageElement {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  return image
}

function decodeImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') return image.decode()
  if (image.complete) return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error('Image failed to load'))
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => reject(new Error('Image failed to load')), { once: true })
  })
}

function readTrial(): FishingProfile {
  try { return restoreFishingProfile(sessionStorage.getItem(TRIAL_STORAGE_KEY)) }
  catch { return restoreFishingProfile(null) }
}

export default function FishingView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hud, setHud] = useState<FishingState>(initialFishingState)
  const [profile, setProfile] = useState<FishingProfile>(readTrial)
  const [actionSpritesReady, setActionSpritesReady] = useState(false)
  const [panel, setPanel] = useState<'bag' | 'shop' | null>(null)
  const [lastQuality, setLastQuality] = useState<FishQuality>('plain')
  const [notice, setNotice] = useState('')
  const stateRef = useRef(hud)
  const profileRef = useRef(profile)
  const panelRef = useRef(panel)
  const pendingQualityRef = useRef<FishQuality>('plain')
  const cameraRef = useRef<FishingCamera>({ scale: 1, left: 0, top: 0 })

  const change = (fn: (state: FishingState) => FishingState) => {
    stateRef.current = fn(stateRef.current)
    setHud(stateRef.current)
  }

  const updateProfile = (fn: (current: FishingProfile) => FishingProfile) => {
    const next = fn(profileRef.current)
    if (next !== profileRef.current) {
      profileRef.current = next
      setProfile(next)
      if (next.catches.length < BAG_LIMIT) setNotice('')
    }
  }

  const showPanel = (next: 'bag' | 'shop' | null) => { panelRef.current = next; setPanel(next) }

  useEffect(() => {
    try { sessionStorage.setItem(TRIAL_STORAGE_KEY, serializeFishingProfile(profile)) }
    catch { /* Storage can be disabled; the trial still works until this tab closes. */ }
  }, [profile])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const art: FishingArt = {
      pond: loadArt(pondUrl), avatars: { male: loadArt(AVATAR_URLS.male), female: loadArt(AVATAR_URLS.female) },
      walking: { male: loadArt(WALK_URLS.male), female: loadArt(WALK_URLS.female) },
      fishing: { male: loadArt(FISHING_ACTION_URLS.male), female: loadArt(FISHING_ACTION_URLS.female) },
      willow: loadArt(willowUrl),
      fish: Object.fromEntries(Object.entries(FISH_URLS).map(([id, url]) => [id, loadArt(url)])) as FishingArt['fish'],
    }
    let mounted = true
    const actionSprites = Object.values(art.fishing).filter((image): image is HTMLImageElement => image !== null)
    void Promise.all(actionSprites.map(decodeImage)).then(() => {
      if (mounted) setActionSpritesReady(true)
    }).catch(() => {
      if (mounted) setNotice('钓鱼动作素材载入失败，请刷新后重试')
    })
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0, height = 0, dpr = 1, frameId = 0
    let lastFrame = performance.now(), lastHud = lastFrame
    const drawCurrentFrame = () => {
      if (width <= 0 || height <= 0) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cameraRef.current = drawFishingScene(ctx, art, stateRef.current, profileRef.current.avatar,
        Date.now(), width, height, motion.matches)
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const nextWidth = rect.width
      const nextHeight = rect.height
      const nextDpr = Math.min(2, window.devicePixelRatio || 1)
      const nextCanvasWidth = Math.max(1, Math.round(nextWidth * nextDpr))
      const nextCanvasHeight = Math.max(1, Math.round(nextHeight * nextDpr))
      const layoutChanged = width !== nextWidth || height !== nextHeight || dpr !== nextDpr
      const backingStoreChanged = canvas.width !== nextCanvasWidth || canvas.height !== nextCanvasHeight

      width = nextWidth
      height = nextHeight
      dpr = nextDpr

      // Setting either backing-store dimension clears the canvas. Only do it when
      // the target pixels changed, then paint the replacement frame in the same
      // ResizeObserver delivery so a blank frame cannot reach the compositor.
      if (canvas.width !== nextCanvasWidth) canvas.width = nextCanvasWidth
      if (canvas.height !== nextCanvasHeight) canvas.height = nextCanvasHeight
      if (layoutChanged || backingStoreChanged) drawCurrentFrame()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const render = (time: number) => {
      const previous = stateRef.current
      stateRef.current = stepFishing(previous, Date.now(), (time - lastFrame) / 1000)
      if (previous.phase !== 'caught' && stateRef.current.phase === 'caught' && stateRef.current.fishId) {
        const fishId = stateRef.current.fishId
        const quality = pendingQualityRef.current
        const next = addCatch(profileRef.current, fishId, quality)
        if (next !== profileRef.current) { profileRef.current = next; setProfile(next) }
        setLastQuality(quality)
      }
      lastFrame = time
      drawCurrentFrame()
      if (previous.phase !== stateRef.current.phase || time - lastHud > 100) {
        setHud(stateRef.current)
        lastHud = time
      }
      frameId = requestAnimationFrame(render)
    }
    frameId = requestAnimationFrame(render)

    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      if (event.code === 'Escape' && panelRef.current) { panelRef.current = null; setPanel(null); return }
      if (panelRef.current) return
      const state = stateRef.current
      const delta = { ArrowLeft: [-90, 0], KeyA: [-90, 0], ArrowRight: [90, 0], KeyD: [90, 0],
        ArrowUp: [0, -90], KeyW: [0, -90], ArrowDown: [0, 90], KeyS: [0, 90] }[event.code]
      if (delta) {
        event.preventDefault()
        stateRef.current = goFishing(state, { x: state.position.x + delta[0], y: state.position.y + delta[1] })
        setHud(stateRef.current)
      } else if (event.code === 'Space') {
        if (state.phase !== 'bite' && state.phase !== 'reeling') return
        event.preventDefault()
        stateRef.current = state.phase === 'bite' ? hookFishing(state, Date.now()) : holdFishing(state, true)
        setHud(stateRef.current)
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      stateRef.current = holdFishing(stateRef.current, false)
      setHud(stateRef.current)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      mounted = false
      cancelAnimationFrame(frameId)
      observer.disconnect()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [])

  const onPondPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (stateRef.current.phase === 'bite') {
      change(state => hookFishing(state, Date.now()))
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const point = screenToPond({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current)
    const spot = FISHING_SPOTS.find(item => Math.hypot(item.stand.x - point.x, item.stand.y - point.y) < 49)
    change(state => goFishing(state, spot?.stand ?? point, spot?.id))
  }

  const cast = (retry = false) => {
    if (!actionSpritesReady) { setNotice('钓鱼动作载入中，请稍候'); return }
    const state = retry ? readyAgain(stateRef.current) : stateRef.current
    if (state.phase !== 'ready') return
    if (profileRef.current.catches.length >= BAG_LIMIT) { setNotice('背包已满，先出售或兑换鱼获'); showPanel('bag'); return }
    const outcome = rollCatch(profileRef.current, Math.random(), Math.random())
    const next = castFishing(state, Date.now(), (3000 + Math.random() * 4000) * outcome.waitFactor,
      outcome.fishId, outcome.fight)
    pendingQualityRef.current = outcome.quality
    updateProfile(useBait)
    change(() => next)
    showPanel(null)
    setNotice('')
  }
  const hook = () => change(state => hookFishing(state, Date.now()))
  const setHold = (held: boolean) => change(state => holdFishing(state, held))
  const busy = ['casting', 'waiting', 'bite', 'reeling'].includes(hud.phase)
  const spot = FISHING_SPOTS.find(item => item.id === (hud.pendingSpot ?? hud.spotId))
  const fishName = hud.fishId ? FISH_SPECIES[hud.fishId].name : '灵鱼'
  const status = hud.phase === 'caught' ? `钓起一条${QUALITY[lastQuality].name}${fishName}` :
    hud.phase === 'moving' && !hud.pendingSpot ? '沿岸行走' : STATUS[hud.phase]

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-dq-bg" data-fishing-phase={hud.phase} data-facing={hud.facing} data-avatar={profile.avatar}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-dq-border bg-dq-panel px-3 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-dq-gold sm:text-lg">灵潭钓场</h1>
          <p className="truncate text-xs text-dq-dim">{spot ? `${spot.label} · ` : ''}{status}</p>
        </div>
        <span className="shrink-0 border-l border-dq-border pl-3 text-xs text-dq-dim">本机试营业 · 不计主档</span>
      </header>

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-dq-border bg-dq-panel px-2 py-1" aria-label="灵潭页面">
        <button type="button" aria-pressed={!panel} onClick={() => showPanel(null)}
          className={`dq-tab inline-flex h-9 shrink-0 items-center gap-1 text-xs ${!panel ? 'dq-tab-on text-dq-goldBright' : 'text-dq-dim hover:text-[#e8dcc8]'}`}><Waves size={14} />钓场</button>
        <button type="button" aria-pressed={panel === 'bag'} disabled={busy} onClick={() => showPanel('bag')}
          className={`dq-tab inline-flex h-9 shrink-0 items-center gap-1 text-xs ${panel === 'bag' ? 'dq-tab-on text-dq-goldBright' : 'text-dq-dim hover:text-[#e8dcc8]'} disabled:opacity-40`}><ShoppingBag size={14} />鱼获 {profile.catches.length}</button>
        <button type="button" aria-pressed={panel === 'shop'} disabled={busy} onClick={() => showPanel('shop')}
          className={`dq-tab inline-flex h-9 shrink-0 items-center gap-1 text-xs ${panel === 'shop' ? 'dq-tab-on text-dq-goldBright' : 'text-dq-dim hover:text-[#e8dcc8]'} disabled:opacity-40`}><Store size={14} />渔具</button>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-xs text-dq-goldBright" data-fishing-coins={profile.coins}><Coins size={14} />{profile.coins} 鱼券</span>
      </nav>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas ref={canvasRef} onPointerDown={onPondPointer} aria-label="灵潭地图，点岸边移动，点钓位前往"
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none" />
        {hud.phase === 'bite' && (
          <div className="dq-panel pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 border-dq-fire px-4 py-1.5 text-sm font-bold text-dq-ember shadow-lg">
            鱼讯！扬竿
          </div>
        )}
        {hud.phase === 'reeling' && (
          <div className="dq-panel pointer-events-none absolute left-1/2 top-4 w-52 -translate-x-1/2 p-2 text-xs text-[#e8dcc8]">
            <div className="mb-1 flex justify-between"><span>鱼线张力</span><span>{Math.round(hud.tension * 100)}%</span></div>
            <div className="dq-slot h-2"><div className="h-full bg-dq-fire" style={{ width: `${hud.tension * 100}%` }} /></div>
            <div className="dq-slot mt-1.5 h-1"><div className="h-full bg-dq-qing" style={{ width: `${hud.progress * 100}%` }} /></div>
          </div>
        )}
        {hud.phase === 'caught' && (
          <div key={hud.caughtAt} role="status" className="dq-panel fishing-catch-banner pointer-events-none absolute left-1/2 top-[12%] flex max-w-[calc(100%-24px)] items-center gap-3 border-2 border-dq-goldBright px-5 py-3 text-dq-goldBright shadow-[0_6px_26px_#15100bcc]">
            <Fish size={28} className="shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-col text-center leading-tight"><strong className="whitespace-nowrap text-lg">钓获 · {QUALITY[lastQuality].name}{fishName}</strong><span className="mt-1 text-xs text-dq-dim">已收入鱼获背包</span></div>
          </div>
        )}
        {panel && <div className="absolute inset-0 z-20 overflow-y-auto">
          {panel === 'bag' ? <FishingBag profile={profile} update={updateProfile} /> :
            <FishingShop profile={profile} update={updateProfile} />}
        </div>}
      </div>

      <div className="shrink-0 border-t border-dq-border bg-dq-panel px-2 py-2 sm:px-5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 sm:pb-1">
          {FISHING_SPOTS.map(item => (
            <button key={item.id} type="button" disabled={busy}
              onClick={() => change(state => goFishing(state, item.stand, item.id))}
              className={`dq-btn min-h-9 shrink-0 px-2.5 text-xs ${item.id === (hud.spotId ?? hud.pendingSpot)
                ? 'dq-btn-gold' : ''}`}>
              <MapPin size={13} />{item.label}
            </button>
          ))}
          <div className="min-w-2 flex-1" />
          {hud.spotId && <button type="button" title="离开钓位" onClick={() => change(leaveFishing)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dq-border2 bg-dq-panel2 text-dq-dim hover:border-dq-gold hover:text-dq-goldBright"><X size={16} /></button>}
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-dq-border pt-2">
          <span className="min-w-0 truncate text-xs text-dq-dim sm:text-sm">
            {notice || (hud.phase === 'caught' ? `${QUALITY[lastQuality].name}${fishName}已收入背包` : hud.phase === 'escaped' ? '收好鱼线，再抛一竿' :
              hud.phase === 'reeling' ? '按住收线，松开降张力' : hud.phase === 'roam' ? '点岸边移动，选择一个钓位' : status)}
          </span>
          {hud.phase === 'ready' && <button type="button" disabled={!actionSpritesReady} onClick={() => cast()} className="dq-btn dq-btn-gold min-w-24"><Waves size={16} />{actionSpritesReady ? '抛竿' : '加载中'}</button>}
          {hud.phase === 'bite' && <button type="button" onClick={hook} className="dq-btn dq-btn-fire min-w-24"><Fish size={16} />扬竿</button>}
          {hud.phase === 'reeling' && <button type="button" aria-pressed={hud.holding}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setHold(true) }}
            onPointerUp={() => setHold(false)} onPointerCancel={() => setHold(false)}
            className="dq-btn dq-btn-gold min-w-24 select-none touch-none"><Hand size={16} />按住收线</button>}
          {(hud.phase === 'caught' || hud.phase === 'escaped') && <button type="button" onClick={() => cast(true)} className="dq-btn dq-btn-gold min-w-24"><RotateCcw size={16} />再抛一竿</button>}
        </div>
      </div>
    </section>
  )
}
