// ─── 图标素材键的推导（v1.44）──────────────────────────────────────────────
//
// 为什么不给 `data.ts` 里每条数据加一个 `spr` 字段：**能推导的一律推导**。
// 两张清单（数据表里的 emoji 与这里的目标路径）一旦各写各的，
// 加一个新丹药就得记得改两处，漏一处就是"这个图标永远显示 emoji"——
// 一个不会报错、只能靠肉眼发现的 bug。
//
// ⚠️ 这里只做**纯映射**，不碰 `data.ts` 里既有的 `icon` 字段。
// 那个字段是 emoji，还被三处**纯文本**路径消费（战斗日志的 "获得 X ×N"、
// 引擎的 setNotice、`out.every(g => g.icon !== '💊')` 那条去重判断）。
// 把 icon 直接改成路径，那些地方会当场打印出一串 `icons/coin`。

/** 八种通用资源 */
const RES: Record<string, string> = {
  coin: 'icons/coin',
  crystal: 'icons/crystal',
  herb: 'icons/herb',
  yuanfen: 'icons/yuanfen',
  daoling: 'icons/daoling',
  essence: 'icons/essence',
  xuanjing: 'icons/xuanjing',
  shard: 'icons/shard',
}

/**
 * 物品 id → 素材键。覆盖三类：八种资源 / `fire_<id>` 异火精华 / `pillN` 丹药。
 * 认不出来就返回 undefined，由 `<Ico>` 回落到 emoji —— **绝不猜、绝不编一个不存在的路径**。
 */
export function itemSprite(id: string | undefined): string | undefined {
  if (!id) return undefined
  if (RES[id]) return RES[id]
  if (id.startsWith('fire_')) return `icons/fire_${id.slice(5)}`
  const m = /^pill([1-8])$/.exec(id)
  if (m) return `icons/pill${m[1]}`
  return undefined
}

/**
 * 塔内祝福的素材键 —— **别在这里再写一份**，走既有的 `game/blessings.ts#blessingIconFor`；
 * 装备槽走 `game/equipIcons.ts#equipIconFor`；消消乐元素块由 `MatchBoard` 直接 import。
 * 这个文件只负责**推导**：给一个 id，算出它在 `sprites/` 下该长哪个路径。
 */

/**
 * 商城限时增益：两个"产量 +100%"直接借用它加成的那个资源。
 * 另外两个是战斗增益，借塔内祝福那两张现成素材（`blessings/sword` 剑、`blessings/bell` 钟），
 * 语义恰好对得上（锋锐阵 / 金钟阵），不必为它们另生两张图。
 */
const BUFF_SPR: Record<string, string> = {
  juling: 'icons/crystal',
  cuisheng: 'icons/herb',
  fengrui: 'blessings/sword',
  jinzhong: 'blessings/bell',
}

/** 商城增益 id → 素材键；认不出返回 undefined（回落 emoji） */
export function buffSprite(id: string): string | undefined {
  return BUFF_SPR[id]
}

/**
 * 商城货架条目 → 素材键。三种货**按语义各取一处**，而不是看 `ShopGood.icon` 那个 emoji：
 *   · 增益货 → 它加成的那个资源 / 借来的祝福纹样（`buffSprite`）
 *   · 材料货 → 那份材料自己（`itemSprite`）
 *   · 随机装备 → 一只宝箱（`icons/gift`）——**没有具体物品可指**，所以单独一张
 */
export function shopGoodSprite(g: { buffId?: string; item?: string; kind: string }): string | undefined {
  if (g.buffId) return BUFF_SPR[g.buffId]
  if (g.item) return itemSprite(g.item)
  if (g.kind === 'equip') return 'icons/gift'
  return undefined
}