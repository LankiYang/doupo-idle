const modules = import.meta.glob('../assets/sprites/blessings/*.png', { eager: true, import: 'default' }) as Record<string, string>

const BLESSING_ICONS: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.png', '')
  BLESSING_ICONS[id] = url
}

export function blessingIconFor(id: string): string | undefined {
  return BLESSING_ICONS[id]
}
