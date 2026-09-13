const modules = import.meta.glob('../assets/sprites/monsters/*.png', { eager: true, import: 'default' }) as Record<string, string>

const MONSTER_SPRITES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.png', '')
  MONSTER_SPRITES[id] = url
}

export function monsterSpriteFor(id: string): string | undefined {
  return MONSTER_SPRITES[id]
}
