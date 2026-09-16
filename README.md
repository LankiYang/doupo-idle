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
src/components/  8 个页签的界面
server/          后端（群雄榜 + 云存档），零依赖 Node http
design/          数值设计文档（各系统的定数推导与版本记录）
```

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