// 服务端（Node）侧的空音效实现。
//
// 为什么需要它：`engine.ts` 里 `import { playSound } from './sound'`，而 `sound.ts`
// 是浏览器专有的（WebAudio）+ React hook。服务端没有音频设备、也不该有 —— 音效调用是彻底的 no-op。
// 只导出 engine.ts 真正用到的那一个符号。
//
// ⚠️ 这不是"改写引擎"，只是把它落不到的浏览器边界补成空气。
//    真正的音频实现仍在 src/game/sound.ts，浏览器那侧一个字节都没动。
export type SoundType =
  | 'crit' | 'kill' | 'bossKill' | 'breakthrough'
  | 'gachaLow' | 'gachaMid' | 'gachaHigh'

export function playSound(_type: SoundType): void { /* 服务端无音频 */ }