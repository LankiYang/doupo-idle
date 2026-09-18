// ── 区域怪 / 爬塔怪立绘（sprites/monsters/）─────────────────────────
// v1.44：从 256×256 透明底**像素画**换成 512×512 透明底**半写实插画**
// （与 56 张角色立绘同一套画风语言）。三条随之而来的约定：
//   · **朝左是烧进素材里的**（生图时就是严格左侧身），所以 `EnemySquad` 里
//     那条 CSS 镜像 `[transform:scaleX(-1)]` 必须拿掉 —— 留着敌人会朝右。
//   · 渲染用 `object-contain`，**不再需要** `image-rendering: pixelated`。
//   · 出图管线：`gen-image.cjs`（白底）→ `remove-bg.cjs`（四边 flood fill 抠底）
//     → `fix-bg-pockets.cjs --apply`（补主体围住的封闭白底口袋）→ ImageMagick 缩 512 转 webp。
const modules = import.meta.glob('../assets/sprites/monsters/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const MONSTER_SPRITES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  MONSTER_SPRITES[id] = url
}

export function monsterSpriteFor(id: string): string | undefined {
  return MONSTER_SPRITES[id]
}

// ── 世界 Boss 立绘（sprites/boss/）─────────────────────────────────
// 与上面那批**分开放**：区域怪是 512×512 透明底立绘、`object-contain` 摆进卡片；
// 世界 Boss 是 1024×1024 的整幅插画（**自带背景**），渲染成铺满整块的 `object-cover`。
// 混进同一个目录的话，将来谁加一张图都说不清该按哪种渲染方式走。
const bossModules = import.meta.glob('../assets/sprites/boss/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const BOSS_SPRITES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(bossModules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  BOSS_SPRITES[id] = url
}

/** 客户端手上到底有几张 Boss 立绘（= 能显示到第几形态）。服务端 `forms` 的档数应当等于它 */
export const BOSS_FORM_MAX = Object.keys(BOSS_SPRITES).length

/**
 * 第 `form` 形态的立绘。**找不到就就近退回**（先往下、再往上、最后 wb_t1），绝不留白 ——
 * 服务端多出一档而这份产物里没有那张图时，玩家看到的是"立绘凭空消失"，
 * 那是最像 bug 的一种表现，而它其实只是两端没同步。宁可显示上一档的样子。
 */
export function bossSpriteFor(form: number): string | undefined {
  const f = Math.max(1, Math.floor(Number(form)) || 1)
  return BOSS_SPRITES[`wb_t${f}`] ?? BOSS_SPRITES[`wb_t${Math.max(1, f - 1)}`] ?? BOSS_SPRITES.wb_t1
}
