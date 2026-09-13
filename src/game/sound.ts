// ─── 程序化音效：Web Audio API 合成，不依赖外部音频文件 ──────────────────────
// 挂机游戏战斗是持续后台运行的，不能给每次出手都配音效（几秒内几十次会吵死人），
// 只在有意义的节点响：暴击、击杀、首领击杀、境界突破、抽卡揭示（按稀有度分级）。
import { useEffect, useRef } from 'react'
import type { CombatEvent } from './engine'

export type SoundType = 'crit' | 'kill' | 'bossKill' | 'breakthrough' | 'gachaLow' | 'gachaMid' | 'gachaHigh'

const MUTE_KEY = 'doupo-idle-muted'
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } })()

export function isMuted(): boolean { return muted }
export function setMuted(v: boolean): void {
  muted = v
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0') } catch { /* ignore */ }
}
export function toggleMuted(): boolean { setMuted(!muted); return muted }

let ctx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try { ctx = new Ctor() } catch { return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ })
  return ctx
}

interface ToneOpts { type?: OscillatorType; gain?: number; endFreq?: number }

function tone(freq: number, startOffset: number, duration: number, opts: ToneOpts = {}) {
  const c = getCtx()
  if (!c || muted) return
  const t0 = c.currentTime + startOffset
  const osc = c.createOscillator()
  const gainNode = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + duration)
  const peak = opts.gain ?? 0.15
  gainNode.gain.setValueAtTime(0.0001, t0)
  gainNode.gain.linearRampToValueAtTime(peak, t0 + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gainNode)
  gainNode.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.03)
}

/** 部分音效限流，防止挂机时同类事件密集触发变成噪音轰炸 */
const COOLDOWN_MS: Partial<Record<SoundType, number>> = { crit: 260 }
const lastPlayedAt: Partial<Record<SoundType, number>> = {}

export function playSound(type: SoundType) {
  if (muted) return
  const cd = COOLDOWN_MS[type]
  const now = Date.now()
  if (cd && lastPlayedAt[type] !== undefined && now - lastPlayedAt[type]! < cd) return
  lastPlayedAt[type] = now

  switch (type) {
    case 'crit':
      tone(880, 0, 0.07, { type: 'square', gain: 0.1 })
      tone(1320, 0.03, 0.06, { type: 'square', gain: 0.07 })
      break
    case 'kill':
      tone(523, 0, 0.08, { type: 'triangle', gain: 0.13 })
      tone(784, 0.07, 0.14, { type: 'triangle', gain: 0.13 })
      break
    case 'bossKill':
      tone(392, 0, 0.1, { type: 'triangle', gain: 0.15 })
      tone(523, 0.09, 0.1, { type: 'triangle', gain: 0.15 })
      tone(659, 0.18, 0.1, { type: 'triangle', gain: 0.15 })
      tone(784, 0.27, 0.28, { type: 'triangle', gain: 0.17 })
      break
    case 'breakthrough':
      tone(440, 0, 0.09, { type: 'sawtooth', gain: 0.08 })
      tone(659, 0.08, 0.09, { type: 'sawtooth', gain: 0.08 })
      tone(880, 0.16, 0.09, { type: 'sawtooth', gain: 0.09 })
      tone(1108, 0.24, 0.32, { type: 'sine', gain: 0.13 })
      break
    case 'gachaLow':
      tone(440, 0, 0.12, { type: 'sine', gain: 0.09 })
      break
    case 'gachaMid':
      tone(523, 0, 0.08, { type: 'sine', gain: 0.1 })
      tone(784, 0.07, 0.15, { type: 'sine', gain: 0.11 })
      break
    case 'gachaHigh':
      tone(392, 0, 0.09, { type: 'sine', gain: 0.11 })
      tone(523, 0.08, 0.09, { type: 'sine', gain: 0.12 })
      tone(659, 0.16, 0.09, { type: 'sine', gain: 0.13 })
      tone(880, 0.24, 0.09, { type: 'sine', gain: 0.14 })
      tone(1046, 0.32, 0.38, { type: 'sine', gain: 0.15 })
      break
  }
}

/**
 * 战斗音效钩子：给一批战斗事件（某个战斗系统里 source==='main' 或 'lab' 的事件）接上音效。
 * 用"处理过的最大事件时间戳"去重，避免同一事件因为父组件重渲染被重复播放。
 */
export function useCombatSound(events: CombatEvent[]) {
  const lastTimeRef = useRef(0)
  useEffect(() => {
    let maxTime = lastTimeRef.current
    for (const e of events) {
      if (e.time <= lastTimeRef.current) continue
      if (e.time > maxTime) maxTime = e.time
      if (e.type === 'kill') playSound(e.boss ? 'bossKill' : 'kill')
      else if (e.type === 'dmg' && e.crit) playSound('crit')
    }
    lastTimeRef.current = maxTime
  }, [events])
}
