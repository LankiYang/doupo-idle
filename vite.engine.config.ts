// 把游戏引擎编译成 **Node 能直接 import 的模块** —— 服务端权威架构的地基（见 SPEC §4.4）。
//
// 为什么要单独一份构建：`src/` 的常规产物是给浏览器的（vite build → dist/），
// 而服务端要的是「能在 Node 里 new 出 GameStore、推进它、读出状态」的纯逻辑模块。
// 引擎本身几乎不依赖浏览器（实测：全文件只有 6 处，且都不在核心数值/战斗逻辑上），
// 所以这里只需要把少数浏览器专有模块换成空实现，其余原样搬过去 —— 是**搬迁**，不是重写。
//
// ⚠️ 产物出到 `dist-engine/`，被 `.gitignore` 的 `dist-*/` 覆盖（这是公开仓库）。
// ⚠️ 这份 config **不影响** `npm run build` —— 那是给浏览器的常规构建，两条链互不干扰。
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const shim = (f: string) => resolve(root, 'server/shim', f)

/**
 * 浏览器专有模块 → 服务端空实现。
 * 用 `resolveId` 精确拦截（而不是 alias），因为要匹配的是**相对路径** `'./sound'`，
 * alias 的前缀匹配会误伤别的目录。用 Map 而不是对象字面量，避免 `__proto__` 这类键。
 */
const SHIMS = new Map<string, string>([
  ['./sound', shim('sound.ts')],
  // React 同理：引擎里唯一用它的地方是 `useGame()`（浏览器的订阅桥），服务端不渲染。
  // 不 shim 的话产物里会留一条 `require("react")`，Node 侧一 require 就崩。
  ['react', shim('react.ts')],
])

export default defineConfig({
  plugins: [{
    name: 'doupo-server-shim',
    enforce: 'pre',
    resolveId(source) {
      return SHIMS.get(source) ?? null
    },
  }],
  // 别把 `public/` 的图标抄进服务端产物 —— 那是给浏览器的，Node 侧用不上。
  publicDir: false,
  build: {
    ssr: true,
    target: 'node22',
    minify: false,
    outDir: 'dist-engine',
    emptyOutDir: true,
    lib: {
      entry: resolve(root, 'src/game/engine.ts'),
      // 出 **CommonJS**：服务端 `server.js` 本身就是 CJS（`require('http')`），
      // 产物也出 CJS 就能直接 `require`，不必为 ESM/CJS 交界折腾。
      // 产物约 170KB，其中绝大部分是 data.ts 的静态数据表（角色/装备/价目）。
      formats: ['cjs'],
      fileName: () => 'engine.cjs',
    },
  },
})