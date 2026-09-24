const modules = import.meta.glob('../assets/sprites/scenes/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const SCENES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  SCENES[id] = url
}

export function sceneFor(id: string): string | undefined {
  return SCENES[id]
}

/** id → url 的表。给 `preload.ts` 做预热用 —— 它要的是"全部"，不是"某一个"。
 *
 *  和 `vnPortrait.ts` 的 `vnPortraitIds()` 是同一套东西的两个方向：
 *  那边给 id 列表（用来对"剧本引用了不存在的立绘"），这边直接给表（用来一次性全下）。 */
export function sceneIds(): Record<string, string> {
  return SCENES
}