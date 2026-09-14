# 焚炎异录 · 后端 API

零依赖的纯 Node `http` 服务，为「群雄榜」与「云存档」提供后端存储。**不属于前端构建**，单独部署在服务器上。

## 部署位置（线上）

| 项 | 值 |
|---|---|
| 运行代码 | `/opt/doupo-game/api/server.js`（本目录是它的版本副本） |
| 监听 | `127.0.0.1:8787`（不直接对外） |
| systemd | `doupo-api.service`（开机自启 + 崩溃重启） |
| 日志 | `/var/log/doupo-api.log` |
| 数据 | `/opt/doupo-game/api/data/`：`leaderboard.json`（榜单）+ `saves/<playerId>.json`（每玩家一份云存档） |
| 对外 | nginx `location /doupo/api/` 反代到 `127.0.0.1:8787`（见 `/etc/nginx/conf.d/default.conf`） |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回 `{ok,total}` |
| GET | `/leaderboard?limit=N` | 群雄榜前 N（按战力降序） |
| GET | `/me?playerId=X` | 某玩家名次 |
| POST | `/score` | 上传战绩 `{playerId,name,power,stage}` |
| GET | `/save?playerId=X` | 取回云存档 `{data,updatedAt}` |
| POST | `/save` | 上传云存档 `{playerId,data}`（data 为存档 JSON 字符串） |

## 身份与防滥用

- **无账号体系**：玩家身份是 localStorage 里的匿名 `playerId`（128 位随机）。云存档场景下 `playerId` 即玩家可携带的「存档码」，**持有即拥有**（能读能写那份存档），属无账号方案的固有取舍。
- 校验：`playerId` 必须 `[A-Za-z0-9_-]{8,64}`（防路径穿越）；存档 data 必须是可解析 JSON 对象且 ≤512KB；名字清洗控制字符。
- 限频：上传战绩冷却 5s、上传存档冷却 10s、单 IP 240 次/分钟。
- ⚠️ 纯前端游戏的客户端可伪造请求，**无法 100% 防刷**（根治需服务端权威模拟）。

## 重新部署 / 改代码后

```bash
# 改了 server.js：把本目录副本同步到运行位置并重启
cp server/server.js /opt/doupo-game/api/server.js
sudo systemctl restart doupo-api
curl -s 127.0.0.1:8787/health    # 探活

# 改了 systemd unit：
sudo cp server/doupo-api.service /etc/systemd/system/doupo-api.service
sudo systemctl daemon-reload && sudo systemctl restart doupo-api
```

## 运维注意

- 云存档是**纯文件读写、无内存缓存**，可直接 `rm data/saves/<id>.json` 删单个存档。
- 榜单是内存 Map + 合并写盘，清理需 `systemctl stop doupo-api` → 改 `leaderboard.json` → `start`（否则优雅退出的 flush 会把内存数据写回）。
- `data/` 里是真实玩家数据，**不可整体清空**。
