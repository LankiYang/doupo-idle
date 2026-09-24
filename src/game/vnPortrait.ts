// ─── VN 立绘（v1.55）────────────────────────────────────────────────────
//
// 和 `portraits.ts`（卡面）是**两份不同的东西**，别合并：
//   · `characters/*.webp`  —— 1024×1024 **不透明**卡面，阵容/招募/战斗/装备在用
//   · `vn/*.webp`          —— 同一构图，但**抠成透明底**，只给视觉小说的立绘层用
//
// 为什么要抠：立绘要压在**场景图**上（乌坦城、云岚宗、魔兽山脉…），
// 卡面那张不透明的方图压上去就是一个黑方块。
// 生成方式见 `temp/gen-story-portraits.sh`（绿幕生图 → 四角泛洪 → 绿主导键控）。
//
// ⚠️ 这里用 `eager`，**但 `eager` 不等于"图已经在本地了"**。
//    它只把 **URL 字符串**编进 bundle；webp 本身仍是独立文件，
//    浏览器要等 `<img src>` 第一次指向它才发请求。
//    这个误解一直挂到 v1.55c，代价是**每次换人先白一下** ——
//    用户 2026-09-22 报的「注意预加载剧情的角色图片，不然临时加载很卡」就是它。
//    真正的解法在 `game/preload.ts`：进了剧情就在空闲时间把 27 张全部下进缓存。
//    `eager` 保留的理由是**URL 必须同步可得** —— 立绘要在同一帧里挂上去，
//    异步查表会让 `Portrait` 先渲染成 null 再补上，那反而是一次可见的闪烁。
//
//    加人之前先想清楚：这批图是给剧情用的，不是全角色图鉴 —— 每多一张，
//    预热那一批就多一份流量（当前 27 张约 2.6 MB，账在 preload.ts 里）。

const modules = import.meta.glob('../assets/sprites/vn/*.webp', { eager: true, import: 'default' }) as Record<string, string>

const VN: Record<string, string> = {}
for (const [filePath, url] of Object.entries(modules)) {
  const id = filePath.split('/').pop()!.replace('.webp', '')
  VN[id] = url
}

/** 立绘 id 取不到图时返回 undefined —— 调用方负责退回"只有台词、没有人"的那种演法 */
export function vnPortraitFor(id: string): string | undefined {
  return VN[id]
}

/** 这一份里到底有谁。给"剧本引用了不存在的立绘"这种错留一个能在控制台自查的口子 */
export function vnPortraitIds(): string[] {
  return Object.keys(VN).sort()
}