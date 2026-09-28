# 焚炎异录（doupo-idle）

斗破苍穹主题的放置类网页游戏。境界成长、组队战斗、招募抽卡、天梯塔 roguelike、装备养成，
带真实后端（全服群雄榜 + 无账号云存档）。

技术栈：Vite 8 · React 19 · TypeScript 6 · Tailwind 3。音效为 Web Audio 实时合成（零音频素材）。

## 构建与本地运行

```bash
npm install --include=dev          # 必须带 --include=dev，否则 vite/tsc 等 devDeps 会被 omit
npm run dev                        # 本地开发
npm run build -- --base=/doupo/    # 生产构建（必须带 --base，否则子路径下资源 404 白屏）
```

构建脚本 `tsc -b && vite build`，开了 `noUnusedLocals`。

## 目录

```
src/game/        引擎与数据：engine.ts（状态机 + tick + 战斗 + 抽卡 + 存档）
                 data.ts（全部静态数值）/ saveApi.ts、leaderboardApi.ts（后端客户端）
                 rewards.ts（运营奖励取用）
                 fishingModel.ts、fishingScene.ts（灵潭试钓状态和场景）
                 fishingSpecies.ts、fishingEconomy.ts（鱼讯概率与试营业经济）
src/components/  各页签界面；FishingView.tsx、FishingPanels.tsx 为灵潭入口和面板
server/          后端（群雄榜 + 云存档），零依赖 Node http
design/          数值设计文档（各系统的定数推导与版本记录）
```

## 灵潭试钓

在游戏内打开「灵潭」：点击岸边移动或选择钓位，抵达后抛竿；鱼讯出现时扬竿，按住收线并适时松开以控制张力。键盘可用方向键/WASD 移动，空格扬竿或收线。渔具面板可切换男修/女修、购买和装备鱼竿鱼饵，并查看当前鱼讯和品质概率。钓获进入 24 格鱼获背包，可上锁、单独或批量出售换鱼券；银鳞鱼 × 2 + 赤纹鲈 × 1 还可兑换月光虫 × 3。

目前仍是**单人本地试营业**：鱼券、鱼获、渔具和人物选择只存于当前浏览器标签页的 `sessionStorage`（`doupo.fishing.trial.v1`），同标签刷新可恢复，关闭标签、清除站点数据或版本迁移可能清空。它们不进入主游戏存档、云档或灵金，也没有实时玩家、服务端占位或可兑主游戏奖励。不要把客户端试营业账本用于正式交易。多人权威态和部署前置条件见 `design/公屏钓鱼规范.md`。

场景资源在 `src/assets/sprites/fishing/`。男女角色的四向行走使用参考图生成的八帧步态（侧向有摆臂和跨步）；停步使用无竿站姿，占位后切换单独生图的持竿待机、后引、前抛、收线姿势。西向持竿镜像东向，北向有独立背影。人物与竿身不由 Canvas 绘制。五种鱼各用八帧定轴摆尾，水中往返翻面；鱼获有水花、鱼跃和品质提示。保留在 `design/sprite-sources/fishing/` 的审批源图可重建角色图集：

```bash
node sprite-actor-atlas.cjs walk design/sprite-sources/fishing/male-south-walk-swing.png design/sprite-sources/fishing/male-north-walk-swing.png design/sprite-sources/fishing/male-east-walk-raw.png src/assets/sprites/fishing/avatar-male-walk-v2.png
node sprite-actor-atlas.cjs walk design/sprite-sources/fishing/female-south-walk-swing.png design/sprite-sources/fishing/female-north-walk-swing.png design/sprite-sources/fishing/female-east-walk-raw.png src/assets/sprites/fishing/avatar-female-walk-v2.png
node sprite-actor-atlas.cjs actions design/sprite-sources/fishing/male-east-actions-raw.png design/sprite-sources/fishing/male-north-actions-v2-raw.png src/assets/sprites/fishing/avatar-male-fish-actions.png
node sprite-actor-atlas.cjs actions design/sprite-sources/fishing/female-east-actions-raw.png design/sprite-sources/fishing/female-north-actions-raw.png src/assets/sprites/fishing/avatar-female-fish-actions.png
npm run test:art
npm run test:fishing
```

鱼的母图与对应的 `-tail.png` 图集同目录；重建时按 `design/精灵图动画规范.md` 为每条鱼指定尾柄切线和枢轴，生成的 `-sheet.png` 用作运行时图集。柳枝和鱼使用独立透明层；运行时无需生图服务。线上活后端及接口规范不在这个仓库，`server/server.js` 不是可直接部署的权威版本。

## 运营：发放奖励

**发全服奖励不需要改代码、构建或部署。** 奖励清单是服务端的一个 JSON，客户端启动时拉一次、
之后每 3 分钟拉一次，把没领过的条目写进玩家存档（幂等，领取标记存在 `state.gifts`）：

```
<部署根>/rewards/rewards.json      ← 运营改这个文件
<部署根>/bin/doupo-grant           ← 用这个工具改（add / list / rm / items）
```

```bash
./bin/doupo-grant add --id shilian10_20261001 --label 国庆十连福利 --items yuanfen=10
```

客户端实现见 `src/game/rewards.ts` 与 `engine.syncRemoteRewards()`。

**要点**（完整说明见部署根的 `运营手册-发放奖励.md`，机制细节见 `SPEC.md` §4.1）：

- `--id` 是**幂等键**，改 id = 让所有人重领一次；想再发一次就换新 id。
- 加 `--existing-only` 只发老玩家（新号不白拿）；`--until` 做限时。
- **绝不能直接改服务端存档文件**：存档是「本地权威」，玩家一开页面就被他的本地档整份盖回。
  发放只能由客户端在下一次加载时写进自己的存档，再随它自己的自动备份带上云。
- 随版本发布的固定礼包才走 `engine.ts` 的 `GIFTS` 表（需构建+部署）；运营性补发/活动一律走上面的清单。

## 文档

| 文档 | 位置 | 内容 |
|---|---|---|
| SPEC | 部署根 `SPEC.md` | 部署架构、模块职责、接口、运行约束与**已知坑**（改代码前必看） |
| 运营手册·发放奖励 | 部署根 `运营手册-发放奖励.md` | 命令速查、幂等/新号/限时语义、出问题怎么办 |
| 数值设计 | `design/数值设计.md` | 各系统的定数推导与版本记录 |
| 精灵图动画规范 | `design/精灵图动画规范.md` | 参考图生图、分帧质检与运行时约束 |
| 公屏钓鱼规范 | `design/公屏钓鱼规范.md` | 试钓边界、实时房间权威协议与验收闸门 |
| **防作弊开发规范** | `design/防作弊开发规范.md` | **做任何带数字 / 带榜 / 带奖 / 带进度的新功能前必看**：四层防御、写接口只认身份、权威态只读取用、不变量两处 clamp、列举点清单、验证的负对照要求 |
