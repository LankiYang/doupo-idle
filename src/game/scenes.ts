const modules = import.meta.glob('../assets/sprites/scenes/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const SCENES: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  SCENES[id] = url
}

export function sceneFor(id: string): string | undefined {
  return SCENES[id]
}
