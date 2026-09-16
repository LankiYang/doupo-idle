import type { EquipSlot } from './data'

const modules = import.meta.glob('../assets/sprites/equip/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const ICONS: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  ICONS[id] = url
}

export function equipSlotIcon(slot: EquipSlot): string | undefined {
  return ICONS[`slot_${slot}`]
}
