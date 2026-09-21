import { useGame, game, fmtNum, pillCraftCost } from '../game/engine'
import { PILLS, REALMS, SHOP_GOODS, SHOP_BUFFS, type ShopGood } from '../game/data'
import { itemSprite, buffSprite, shopGoodSprite } from '../game/icons'
import Ico from './Ico'

function realmForGrade(grade: number): string {
  const idx = REALMS.findIndex(r => r.pillGrade === grade)
  if (idx < 0) return ''
  const from = REALMS[idx]
  const to = REALMS[idx + 1]
  return to ? `${from.name} → ${to.name}` : `${from.name} 境内`
}

/** buff 剩余时间 mm:ss */
function remainText(expireAt: number): string {
  const s = Math.max(0, Math.floor((expireAt - Date.now()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ShopView() {
  const state = useGame()
  const coin = Math.floor(state.inventory.coin ?? 0)
  const now = Date.now()
  const activeBuffs = state.buffs.filter(b => b.expireAt > now)

  const goodCard = (g: ShopGood) => {
    const price = game.shopPrice(g.id)
    const count = state.shop.counts[g.id] ?? 0
    const canAfford = coin >= price
    const buffDef = g.buffId ? SHOP_BUFFS.find(b => b.id === g.buffId) : null
    const liveBuff = buffDef ? activeBuffs.find(b => b.id === buffDef.id) : null
    return (
      <div key={g.id} className="rounded border border-dq-border p-2 text-xs">
        <div className="flex items-start gap-2">
          <Ico name={shopGoodSprite(g)} emoji={g.icon} className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-dq-gold">{g.name}</div>
            <div className="text-[#a89478]">{g.desc}</div>
          </div>
        </div>
        {liveBuff && (
          <div className="mt-1 text-[10px] text-dq-fire">生效中 · 剩 {remainText(liveBuff.expireAt)}（再买续时）</div>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[#a89478]"><Ico name={itemSprite('coin')} className="h-3.5 w-3.5" />{fmtNum(price)}
            {count > 0 && <span className="ml-1 text-[10px] text-[#5a4a38]">今日第 {count + 1} 件</span>}
          </span>
          <button onClick={() => game.buyShopItem(g.id)} disabled={!canAfford}
            className="dq-tap-lg inline-flex shrink-0 items-center justify-center rounded bg-dq-gold px-2.5 py-1 text-black disabled:opacity-30">购买</button>
        </div>
      </div>
    )
  }

  const sections: { title: string; desc: string; goods: ShopGood[] }[] = [
    { title: '限时秘法', desc: '花灵金买临时增益，到期即消失——不增加任何存量资源', goods: SHOP_GOODS.filter(g => g.kind === 'buff') },
    { title: '奇货可居', desc: '养成材料；价格随当日购买递增，次日 0 点回落，不限次数', goods: SHOP_GOODS.filter(g => g.kind === 'material') },
    { title: '随机装备', desc: '随机槽位 + 随机品阶，与战斗掉落同品质池', goods: SHOP_GOODS.filter(g => g.kind === 'equip') },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:p-4">
      <div className="dq-panel rounded-md p-3">
        <div className="flex items-center justify-between">
          <div className="text-dq-gold">商城</div>
          <div className="flex items-center gap-1 text-sm text-[#a89478]">
            <Ico name={itemSprite('coin')} className="h-4 w-4" />
            <span>灵金</span>
            <span className="tabular-nums text-dq-gold">{fmtNum(coin)}</span>
          </div>
        </div>
        {activeBuffs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {activeBuffs.map(b => {
              const def = SHOP_BUFFS.find(x => x.id === b.id)
              if (!def) return null
              return (
                <span key={b.id} className="rounded border border-dq-fire px-1.5 py-0.5 text-[10px] text-dq-fire">
                  <Ico name={buffSprite(b.id)} emoji={def.icon} className="h-3 w-3 align-[-2px]" /> {def.name} {remainText(b.expireAt)}
                </span>
              )
            })}
          </div>
        )}
        <div className="mt-1.5 text-[11px] leading-relaxed text-[#a89478]">
          灵金来自闯关 / 刷关掉落。商品价格随当日购买次数指数递增、次日 0 点回落到基准，不设购买次数上限——靠价格自然限制。
        </div>
      </div>

      {sections.map(sec => (
        <div key={sec.title} className="dq-panel rounded-md p-3">
          <div className="mb-0.5 text-sm text-dq-gold">{sec.title}</div>
          <div className="mb-2 text-[11px] text-[#a89478]">{sec.desc}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{sec.goods.map(goodCard)}</div>
        </div>
      ))}

      <div className="dq-panel rounded-md p-3">
        <div className="mb-0.5 text-sm text-dq-gold">丹房</div>
        <div className="mb-2 text-[11px] text-[#a89478]">
          药园挂机产出 <Ico name={itemSprite('herb')} className="inline h-3.5 w-3.5 align-[-3px]" />灵药（当前 {fmtNum(state.inventory.herb ?? 0)}），消耗灵药 + 灵金炼制丹药，用于角色跨境界突破
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PILLS.map(p => {
            const cost = pillCraftCost(p.grade)
            const have = state.inventory[p.id] ?? 0
            const canAfford = (state.inventory.herb ?? 0) >= cost.herb && (state.inventory.coin ?? 0) >= cost.coin
            return (
              <div key={p.id} className="rounded border border-dq-border p-2 text-center text-xs">
                <Ico name={itemSprite(p.id)} emoji={p.icon} className="mx-auto h-10 w-10" />
                <div className="mt-1 text-dq-gold">{p.name}</div>
                <div className="text-[#a89478]">{realmForGrade(p.grade)}</div>
                <div className="mt-1 text-[#a89478]">拥有 ×{Math.floor(have)}</div>
                <div className="mt-1 flex items-center justify-center gap-1 text-[#a89478]">
                  <Ico name={itemSprite('herb')} className="h-3.5 w-3.5" />{fmtNum(cost.herb)}
                  <span>+</span>
                  <Ico name={itemSprite('coin')} className="h-3.5 w-3.5" />{fmtNum(cost.coin)}
                </div>
                <button onClick={() => game.craftPill(p.grade)} disabled={!canAfford}
                  className="mt-2 w-full rounded bg-dq-gold px-2 py-1 text-black disabled:opacity-30">炼制</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
