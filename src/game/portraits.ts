const modules = import.meta.glob('../assets/sprites/characters/*.png', { eager: true, import: 'default' }) as Record<string, string>

const PORTRAITS: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.png', '')
  PORTRAITS[id] = url
}

export function portraitFor(id: string): string | undefined {
  return PORTRAITS[id]
}
