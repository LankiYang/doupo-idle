import type { Role, AtkStyle } from './data'

const modules = import.meta.glob('../assets/sprites/fx/*.png', { eager: true, import: 'default' }) as Record<string, string>

const FX: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.png', '')
  FX[id] = url
}

/** 我方出手命中怪物时的打击特效：按角色流派区分 */
export function impactFxForRole(role: Role): string | undefined {
  switch (role) {
    case 'melee': return FX.fx_slash
    case 'single': return FX.fx_pierce
    case 'aoe': return FX.fx_magic
    case 'control': return FX.fx_pierce
    case 'heal': return FX.fx_heal
  }
}

/** 怪物反击命中我方时的打击特效：按怪物招式区分 */
export function impactFxForMonster(style: AtkStyle): string | undefined {
  switch (style) {
    case 'melee': return FX.fx_claw
    case 'ranged': return FX.fx_pierce
    case 'magic': return FX.fx_magic
  }
}

export function healFx(): string | undefined {
  return FX.fx_heal
}
