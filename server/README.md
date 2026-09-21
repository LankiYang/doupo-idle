# 焚炎异录 · 后端（源码侧）

零依赖的纯 Node `http` 服务，负责群雄榜、云存档、账号、邮件、世界 Boss，以及
**服务端权威运行时**（引擎宿主 + `/state` + `/action`）。**不属于前端构建**，单独部署在服务器上。

> **接口契约不在这份文档里** —— 唯一真相是 `/opt/doupo-game/SPEC.md`
> 的 §4.2（后端 HTTP API）与 §4.5（服务端权威 API 契约）。这份 README 只讲
> "这个目录是什么、改动往哪落"，**不复制接口表**（两份表必然分叉）。

> ★ **加新接口 / 新玩法之前先过一遍 [`design/防作弊开发规范.md`](../design/防作弊开发规范.md)**
> —— 写接口的 body 只认身份与意图、权威态只读取用（`authoritativeOf`，绝不 `acquire()`）、
> 不变量在迁移点与写入点两处 clamp、「复制一套」的列举点清单。**这是规范性文档，不是参考。**

## ⚠️ 唯一真相在部署位置，不在 git

| 项 | 值 |
|---|---|
| 运行代码 | `/opt/doupo-game/api/server.js`（**不在 git**，9 万字节级的活代码） |
| 监听 | `127.0.0.1:8787`（不直接对外） |
| systemd | `doupo-api.service`（开机自启 + 崩溃重启） |
| 日志 | `/var/log/doupo-api.log` |
| 数据 | `/opt/doupo-game/api/data/`：`leaderboard.json`、`saves/<playerId>.json`、`accounts.json`、`mail.json`、`worldboss.json` 等 |
| 对外 | nginx `location /doupo/api/` 反代到 `127.0.0.1:8787`（见 `/etc/nginx/conf.d/default.conf`） |

**`server.js` 的改法**：直接改 `/opt/doupo-game/api/server.js` → 先按红线⑰ 停服（退出中的进程会把
内存态 flush 回写）→ 手工 `cp` 一份 `.bak` → 重启 → `curl` 探活。历史上一直是这么做的，
`/opt/doupo-game/api/` 下那些 `server.js.bak-*` 就是历次改动的回滚点。

### 🚫 本目录的 `server.js` 是**陈旧快照**，不要用它

它是 **2026-09-14** 的一份 9KB 副本，此后线上那份长到 90KB+（账号、邮件、世界 Boss、
引擎宿主全都不在里面）。**任何"把本目录副本 cp 到线上"的操作都会把这些功能整片抹掉。**
留在这里只是为了保存早期形态，**它不是源码、不要改它、不要同步它**。

## 本目录里**是**活源码的东西

| 文件 | 说明 | 部署方式 |
|---|---|---|
| `engine-host.js` | 服务端引擎宿主（§4.4）。**是活源码** | 连同 `dist-engine/engine.cjs` 一起 `cp` 到 `/opt/doupo-game/api/` |
| `doupo-api.service` | systemd unit | `sudo cp server/doupo-api.service /etc/systemd/system/` → `daemon-reload` → `restart` |
| `shim/` | 引擎打包时替换掉浏览器专有模块（`sound`、`react`） | 只在构建期用，不部署 |
| `package.json` | **仅声明本目录是 CommonJS** | 不部署 |

⚠️ **`engine-host.js` 有两份**（源码 / 部署），改完源码必须重新构建引擎并两份一起同步：

```bash
cd /opt/doupo-idle
npx vite build --config vite.engine.config.ts     # → dist-engine/engine.cjs
cp dist-engine/engine.cjs server/engine-host.js /opt/doupo-game/api/
sudo systemctl restart doupo-api
curl -s 127.0.0.1:8787/health                      # 探活
```

⚠️ **重启前先按红线⑰ 拿真实数据文件的副本在别的端口实跑一遍**，别直接重启生产。

## 本目录为什么有自己的 `package.json`

`/opt/doupo-idle/package.json` 是 `"type": "module"`，而本目录的 `.js`（`engine-host.js`）
是 **CommonJS**（`require` / `module.exports`）—— 没有这个边界文件，在源码树里
`require('./server/engine-host.js')` 会直接抛
`ReferenceError: require is not defined in ES module scope`。
线上 `/opt/doupo-game/api/` 下没有 `package.json`，本来就是 CJS，所以那边不受影响。

## 运维注意

- 云存档是**纯文件读写、无内存缓存**，可直接 `rm data/saves/<id>.json` 删单个存档。
- 榜单是内存 Map + 合并写盘，清理需 `systemctl stop doupo-api` → 改 `leaderboard.json` → `start`（否则优雅退出的 flush 会把内存数据写回）。
- **`data/` 里是真实玩家数据，不可整体清空**（含 `accounts.json`、`mail.json`、`worldboss.json`）。
- 运营工具在 `/opt/doupo-game/bin/`（`doupo-grant` / `doupo-mail` / `doupo-boss` / `doupo-activity`），
  **不要直接编辑数据文件**。