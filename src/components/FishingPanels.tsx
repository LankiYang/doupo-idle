import { useState } from 'react'
import { Fish, Lock, LockOpen, ShoppingBag } from 'lucide-react'
import { AVATAR_PORTRAITS, FISH_URLS } from '../game/fishingAssets'
import { FISH_SPECIES, fishChances, type FishId } from '../game/fishingSpecies'
import { BAITS, BAG_LIMIT, RODS, ROD_IDS, QUALITY, buyBait, buyRod, canExchangeFish,
  castOdds, catchValue, exchangeFish, qualityChances, sellCatch, sellUnlocked, toggleCatchLock,
  type AvatarId, type BaitId, type FishingProfile, type RodId } from '../game/fishingEconomy'

type UpdateProfile = (fn: (profile: FishingProfile) => FishingProfile) => void

const RARITY_COLOR: Record<string, string> = {
  '寻常': 'text-dq-dim', '少见': 'text-dq-qing', '稀有': 'text-dq-goldBright', '奇珍': 'text-dq-ember',
}

function FishStamp({ fishId }: { fishId: FishId }) {
  return <span aria-hidden="true" className="dq-iconplate flex h-12 w-12 shrink-0 items-center justify-center rounded border border-dq-border p-1">
    <span className="block h-full w-full bg-contain bg-no-repeat"
      style={{ backgroundImage: `url(${FISH_URLS[fishId]})`, backgroundSize: '400% 200%', backgroundPosition: '0 0' }} />
  </span>
}

export function FishingBag({ profile, update }: { profile: FishingProfile; update: UpdateProfile }) {
  const [filter, setFilter] = useState<'all' | 'locked' | 'prized'>('all')
  const entries = profile.catches.filter(item => filter === 'all' || (filter === 'locked' ? item.locked : item.quality === 'prized'))
  const sale = profile.catches.filter(item => !item.locked)
  const total = sale.reduce((sum, item) => sum + catchValue(item), 0)
  return <section className="dq-panel min-h-full rounded-none text-[#e8dcc8]" data-fishing-panel="bag" aria-label="鱼获背包">
    <div className="mx-auto max-w-4xl px-3 py-4 pb-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-dq-border pb-3">
        <div><h2 className="dq-title text-lg">鱼获背包</h2>
          <p className="text-xs text-dq-dim">{profile.catches.length}/{BAG_LIMIT} 尾 · 上锁鱼获不会被出售或兑换</p></div>
        <button type="button" disabled={!sale.length} onClick={() => update(sellUnlocked)}
          className="dq-btn dq-btn-gold text-xs">全部出售 · {total} 鱼券</button>
      </div>
      <div className="flex gap-1 border-b border-dq-border py-3" role="group" aria-label="筛选鱼获">
        {([['all', '全部'], ['locked', '已锁'], ['prized', '珍品']] as const).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={`dq-tab min-h-9 text-xs ${filter === id ? 'dq-tab-on text-dq-goldBright' : 'text-dq-dim hover:text-[#e8dcc8]'}`}>{label}</button>)}
      </div>
      {!entries.length ? <p className="py-12 text-center text-sm text-dq-dim">{filter === 'all' ? '背包空着，去钓一竿。' : '暂无符合条件的鱼获。'}</p> :
        <div className="divide-y divide-dq-border">{entries.map(record => {
          const fish = FISH_SPECIES[record.fishId]
          return <div key={record.id} data-catch-id={record.id} className="flex min-h-20 items-center gap-2 py-2">
            <FishStamp fishId={record.fishId} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-[#f4e8cf]">{fish.name}
              <span className={`ml-2 text-xs ${RARITY_COLOR[fish.rarity]}`}>{fish.rarity}</span></div>
              <p className="text-xs text-dq-dim">{QUALITY[record.quality].name} · {catchValue(record)} 鱼券</p></div>
            <button type="button" title={record.locked ? '解锁鱼获' : '锁定鱼获'} aria-label={record.locked ? `解锁${fish.name}` : `锁定${fish.name}`}
              onClick={() => update(current => toggleCatchLock(current, record.id))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dq-border2 bg-dq-panel2 text-dq-goldBright hover:border-dq-gold">
              {record.locked ? <Lock size={16} /> : <LockOpen size={16} />}</button>
            <button type="button" disabled={record.locked} onClick={() => update(current => sellCatch(current, record.id))}
              className="dq-btn dq-btn-gold h-9 shrink-0 px-2.5 text-xs">出售</button>
          </div>
        })}</div>}
    </div>
  </section>
}

export function FishingShop({ profile, update }: { profile: FishingProfile; update: UpdateProfile }) {
  const odds = castOdds(profile)
  const qualities = qualityChances(odds.qualityBonus)
  return <section className="dq-panel min-h-full rounded-none text-[#e8dcc8]" data-fishing-panel="shop" aria-label="灵潭渔具商店">
    <div className="mx-auto max-w-4xl space-y-5 px-3 py-4 pb-8 sm:px-6">
      <div className="border-b border-dq-border pb-3"><h2 className="dq-title text-lg">灵潭渔具</h2>
        <p className="text-xs text-dq-dim">鱼券仅在本地试钓使用，不与主游戏灵金互通。</p></div>
      <div><h3 className="mb-2 text-sm font-semibold text-dq-goldBright">人物</h3>
        <div className="flex gap-2">{(['male', 'female'] as AvatarId[]).map(id =>
          <button key={id} type="button" aria-pressed={profile.avatar === id} onClick={() => update(current => ({ ...current, avatar: id }))}
            className={`flex min-h-12 min-w-28 items-center gap-2 rounded-md border px-2 py-1 text-sm ${profile.avatar === id
              ? 'border-dq-gold bg-dq-gold/10 text-dq-goldBright shadow-dqGold'
              : 'border-dq-border2 bg-dq-panel2 text-dq-dim hover:border-dq-goldDim'}`}>
            <img src={AVATAR_PORTRAITS[id]} alt="" className="h-11 w-9 object-contain" />{id === 'male' ? '男修' : '女修'}</button>)}</div>
      </div>
      <div><h3 className="mb-1 text-sm font-semibold text-dq-goldBright">鱼竿</h3>
        <div className="divide-y divide-dq-border">{ROD_IDS.map(id => {
          const rod = RODS[id], owned = profile.ownedRods.includes(id), equipped = profile.rodId === id
          return <div key={id} className="flex min-h-16 items-center justify-between gap-3 py-2">
            <div className="min-w-0"><p className="text-sm text-[#f2e6cb]">{rod.name}</p><p className="text-xs text-dq-dim">{rod.detail}</p></div>
            <button type="button" disabled={equipped || (!owned && profile.coins < rod.price)}
              onClick={() => update(current => owned ? { ...current, rodId: id } : buyRod(current, id as RodId))}
              className="dq-btn dq-btn-gold h-9 min-w-20 shrink-0 px-2 text-xs">
              {equipped ? '使用中' : owned ? '装备' : `${rod.price} 鱼券`}</button>
          </div>
        })}</div>
      </div>
      <div><h3 className="mb-1 text-sm font-semibold text-dq-goldBright">鱼饵</h3>
        <div className="divide-y divide-dq-border">{(['plain', 'fragrant', 'moon'] as BaitId[]).map(id => {
          const bait = BAITS[id], stock = id === 'plain' ? Infinity : profile.baitStock[id]
          return <div key={id} className="flex min-h-16 items-center justify-between gap-3 py-2">
            <div className="min-w-0"><p className="text-sm text-[#f2e6cb]">{bait.name}<span className="ml-2 text-xs text-dq-dim">{id === 'plain' ? '无限' : `剩余 ${stock}`}</span></p>
              <p className="text-xs text-dq-dim">{bait.detail}</p></div>
            <div className="flex shrink-0 gap-1">
              {id !== 'plain' && <button type="button" disabled={profile.coins < bait.price}
                onClick={() => update(current => buyBait(current, id))}
                className="dq-btn dq-btn-gold h-9 px-2 text-xs">{bait.price} 鱼券</button>}
              <button type="button" disabled={profile.baitId === id || stock < 1}
                onClick={() => update(current => ({ ...current, baitId: id }))}
                className="dq-btn h-9 px-2 text-xs">
                {profile.baitId === id ? '已选' : '选用'}</button>
            </div>
          </div>
        })}</div>
      </div>
      <div className="border-t border-dq-border pt-4"><h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-dq-goldBright"><ShoppingBag size={16} />鱼获兑换</h3>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-dq-dim">
          <span>银鳞鱼 × 2 + 赤纹鲈 × 1 → 月光虫 × 3</span>
          <button type="button" disabled={!canExchangeFish(profile)} onClick={() => update(exchangeFish)}
            className="dq-btn dq-btn-gold h-9 px-3 text-xs">兑换</button>
        </div>
      </div>
      <div className="border-t border-dq-border pt-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-dq-goldBright"><Fish size={16} />当前鱼讯概率</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">{fishChances(odds.rareBoost).map(({ fishId, chance }) =>
          <div key={fishId} className="flex justify-between gap-2 text-[#e8dcc8]"><span>{FISH_SPECIES[fishId].name}</span><span>{(chance * 100).toFixed(1)}%</span></div>)}</div>
        <p className="mt-2 text-xs text-dq-dim">凡品 {(qualities.plain * 100).toFixed(0)}% · 良品 {(qualities.fine * 100).toFixed(0)}% · 珍品 {(qualities.prized * 100).toFixed(0)}%</p>
      </div>
    </div>
  </section>
}
