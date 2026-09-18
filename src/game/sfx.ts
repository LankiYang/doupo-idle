// 消消乐音效：**全程序合成**（WebAudio），一个音频素材都不引。
//
// 为什么不用素材文件：这个项目到现在没有任何音频资产，为四个"嘟/啪"去生成、压缩、
// 加载四段 mp3，收益远不如代价（体积、首屏、解码、格式兼容）。振荡器 + 包络三行就是一个音。
//
// 三条浏览器规矩，踩过一次就够：
//   ① **没有用户手势就出不了声**：AudioContext 建出来是 `suspended`，
//      必须在点击里 `resume()`。所以 `unlock()` 挂在第一次点格子上，不在模块加载时建。
//   ② 别在模块顶层摸 `localStorage`/`window` —— 那会让这个文件在非浏览器环境直接炸，
//      而引擎层的文件是可以被单测 require 的。一律懒取。
//   ③ 音效**永远不许影响玩法**：任何一步出错（没有 AudioContext、被策略拦、解码失败）
//      都只能"没声"，不能把消除打断 —— 所以这里所有对外函数都是 try/catch 包住的空实现。

import { SFX_MUTE_KEY } from './storageKeys'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let mutedCache: boolean | null = null

function readMuted(): boolean {
  if (mutedCache !== null) return mutedCache
  try { mutedCache = localStorage.getItem(SFX_MUTE_KEY) === '1' } catch { mutedCache = false }
  return mutedCache
}

export function isMuted(): boolean { return readMuted() }

export function setMuted(v: boolean): void {
  mutedCache = v
  try {
    if (v) localStorage.setItem(SFX_MUTE_KEY, '1')
    else localStorage.removeItem(SFX_MUTE_KEY)
  } catch { /* 存不下就只是记不住，不影响这一次 */ }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.45
    master.connect(ctx.destination)
  } catch { ctx = null; master = null }
  return ctx
}

/** 首次手势时解锁。**只 resume、不建音**：建音放在真正要响的那一刻 */
export function unlock(): void {
  try {
    const c = audio()
    if (c && c.state === 'suspended') void c.resume()
  } catch { /* 没声就没声 */ }
}

/** 一个带包络的振荡器音。`slideTo` 给"往下掉"的那类音（无效交换、爆炸尾音） */
function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
  try {
    const c = audio()
    if (!c || !master || readMuted()) return
    const t0 = c.currentTime + delay
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur)
    // 起落都用指数：线性包络听起来像"咔"的一声开关，指数才像打击
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g); g.connect(master)
    osc.start(t0); osc.stop(t0 + dur + 0.03)
  } catch { /* 没声就没声 */ }
}

/** 滤波白噪声：爆炸/重排那一下的"沙"。正弦做不出噪声的质感 */
function noise(dur: number, gain: number, cutoff: number, delay = 0, sweepTo?: number): void {
  try {
    const c = audio()
    if (!c || !master || readMuted()) return
    const t0 = c.currentTime + delay
    const len = Math.max(1, Math.floor(c.sampleRate * dur))
    const buf = c.createBuffer(1, len, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = c.createBufferSource()
    src.buffer = buf
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(cutoff, t0)
    if (sweepTo) lp.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(lp); lp.connect(g); g.connect(master)
    src.start(t0); src.stop(t0 + dur + 0.02)
  } catch { /* 没声就没声 */ }
}

/** 选中一格：很轻的一下，只是让玩家听见"点上了" */
export function playPick(): void {
  tone(660, 0.05, 'triangle', 0.07)
}

/** 有效交换：短促的"嗒" */
export function playSwap(): void {
  tone(520, 0.06, 'triangle', 0.09)
  tone(780, 0.05, 'sine', 0.05, 0.03)
}

/** 无效交换：往下掉的一声闷响。**不是错误音**（消不掉只是这步不行，不是玩家做错了） */
export function playBad(): void {
  tone(190, 0.16, 'square', 0.07, 0, 110)
}

/**
 * 消除一拍。连击越高音越亮 —— 这是"连击"最便宜的听觉表达，
 * 玩家不用看数字也能听出自己连到第几拍了（视觉那行大字是给还在看屏幕的人的）。
 */
export function playClear(combo: number, tiles: number): void {
  const step = Math.min(11, Math.max(0, combo - 1))
  const base = 440 * Math.pow(2, step / 12)
  tone(base, 0.10, 'triangle', 0.11)
  tone(base * 1.5, 0.08, 'sine', 0.06, 0.02)
  if (tiles >= 5) tone(base * 2, 0.12, 'sine', 0.05, 0.05)
}

/** 特殊块被引爆 */
export function playBlast(): void {
  noise(0.22, 0.15, 1400, 0, 200)
  tone(120, 0.24, 'sawtooth', 0.09, 0, 48)
}

/** 合成了一个特殊块：往上的两音小铃，与"消除"区分开 */
export function playCreate(): void {
  tone(880, 0.09, 'sine', 0.09)
  tone(1320, 0.13, 'sine', 0.07, 0.06)
}

/** 三连击以上：一段上行琶音，一局里只响一次（在连锁收尾时） */
export function playCombo(n: number): void {
  const notes = [0, 4, 7, 12, 16].map(s => 523.25 * Math.pow(2, (s + Math.min(2, n - 3)) / 12))
  notes.forEach((f, i) => tone(f, 0.12, 'sine', 0.07, i * 0.055))
}

/** 无解重排 */
export function playReshuffle(): void {
  noise(0.3, 0.08, 700, 0, 1800)
  tone(300, 0.3, 'sine', 0.05, 0, 620)
}