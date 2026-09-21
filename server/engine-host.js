/**
 * 服务端引擎宿主（SPEC §4.4）。
 *
 * 把「游戏引擎」这个纯逻辑模块，变成「服务端持有、按玩家分片、按在线状态推进」的运行时。
 *
 * 三条不变量（破坏任何一条都会出事）：
 *  ① **一个玩家一个实例，各带自己的存储** —— 绝不共用。**串档比丢档更糟**：丢档还能从
 *     `save-history/` 捞，串档是两个玩家的进度搅在一起，谁也别想摘干净。
 *  ② **只对在线玩家跑 tick**（`ONLINE_TTL` 内有过请求）。离线的人不烧 CPU，
 *     改在他下次上线时结算一次离线收益。挂机游戏本来就是这样：关掉页面就不打了。
 *  ③ **权威态就是 `saves/<pid>.json`**，与云档格式**逐字节同构** ⇒ 回滚时老客户端直接读得懂。
 *
 * ⚠️ 本文件有**两份**：源码那份在 `/opt/doupo-idle/server/`（进 git），部署那份在
 *    `/opt/doupo-game/api/`（不进 git）。改完源码要连 `engine.cjs` 一起复制过去。
 */
const path = require('path')
const fs = require('fs')

// ── 浏览器边界补全：**必须在 require 引擎之前** ──────────────────────────
// 引擎模块的顶层会创建那个浏览器单例，`__DOUPO_SERVER__` 让它别起定时器
// （否则每个 Node 进程白白多出 4 个后台循环）。`window` 是 beforeunload 的挂载点；
// `localStorage` 只是那个单例的兜底存储 —— 它读不到东西、落在 freshState，用完即弃，
// 真正的每玩家存储是下面按实例闭包出来的那个。
globalThis.__DOUPO_SERVER__ = true
globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.localStorage = { getItem: () => null, setItem: () => {} }

// `parseActivities` / `parseRewards` 由引擎入口再导出 —— 服务端用它解析运营配置文件。
// **绝不在宿主里另写一份解析**：两份解析必然分叉（SPEC §4.1 反复吃过这个亏）。
const { GameStore, parseActivities, parseRewards } = require(
  process.env.DOUPO_ENGINE || path.join(__dirname, 'engine.cjs'))

/**
 * 引擎眼里的存档键名。**恒为线上键名**（无前缀）——
 * 前缀是客户端为体验服做的 localStorage 隔离，与服务端无关：权威态按 playerId 分文件。
 */
const SAVE_KEY = 'doupo-idle-save-v1'

const TICK_MS = 1000           // 1Hz。战斗是 2 秒一回合，1Hz 不会漏回合（§4.4.2）
const ONLINE_TTL = 90_000      // 90 秒内有过请求 = 在线（轮询即心跳，不另设端点）
const EVICT_MS = 10 * 60_000   // 离线超过这么久就卸掉实例：省内存，权威态在磁盘上随时能重建
const FLUSH_MS = 5000          // 脏数据落盘的最小间隔（别每拍都写盘）
/**
 * 保留最近多少拍的**状态变更集**（SPEC §4.5.2）。
 *
 * 存在的理由只有一个：客户端可能因为断网/切后台**错过几拍**，回来时带一个偏旧的
 * `since`。环内的能按序合并补上，落在环外的回全量 —— **这个"太旧就自愈成全量"的能力
 * 就是 `since` 存在的全部意义**。16 拍 ≈ 16 秒容错（1Hz）。
 */
const STATE_RING = 16

/** 单个玩家的运行时。只管状态，落盘交给 EngineHost（那里才有 writeSave）。 */
class PlayerHost {
  constructor(pid, readRaw, activities) {
    this.pid = pid
    this.rev = 0
    this.lastSeen = 0
    this.lastFlush = 0
    this.dirty = false
    this._raw = readRaw()   // 权威态的**字符串**（= 云档里的 `data`）；null = 新号
    // ── 增量协议（SPEC §4.5.2）────────────────────────────────────────
    this.srev = 0                        // **内容版本**：只在状态真的变了时才 +1
    this._snap = Object.create(null)     // 键 → 上一拍序列化出来的字符串（比对与全量都复用它）
    this._ring = []                      // [{srev, parts:{键: 序列化字符串}}]，最近 STATE_RING 拍
    this._attach(activities)
  }

  _attach(activities) {
    const self = this
    // ⚠️ 存储**按实例闭包**，不碰全局 —— 宿主同时持有多个玩家，而全局只有一个 localStorage。
    //    靠"切换全局"迟早会把 A 的写落进 B 的档（引擎内部有异步回调：远程配置、notice 定时器）。
    const storage = {
      getItem: k => (k === SAVE_KEY ? self._raw : null),
      // 引擎的 `.bak` 写入在服务端**忽略**：服务端有 `save-history/` 做按进度的版本留存，
      // 不需要客户端那套"上一份"；而且往 saves/ 里塞 .bak 会破坏「一人一文件」的形状。
      setItem: (k, v) => {
        if (k !== SAVE_KEY) return
        self._raw = v
        self.dirty = true
      },
    }
    // `autoLoop:false` ⇒ 服务端自己按 1Hz 同步驱动，不要引擎的 100ms 循环与 2 秒落盘。
    // 构造时引擎会 `load()` + `applyOfflineProgress()` —— 后者正是"离线收益结算"。
    // `activities` 从构造参数进：浏览器那侧是自己 fetch 的（见 engine.ts 的 GameOptions）。
    this.store = new GameStore({ storage, autoLoop: false, activities })
  }

  /** 标记在线。`/state` 与 `/action` 都要调 —— 轮询即心跳。 */
  touch() { this.lastSeen = Date.now() }

  get online() { return Date.now() - this.lastSeen < ONLINE_TTL }

  /**
   * 推进一拍（同步）。
   *
   * ⚠️ **顺便标脏，这一行是必需的**：引擎的 `tick()` **自己不落盘** —— 落盘一直是客户端
   * 那个 2 秒定时器的活（`autoLoop:false` 时那个定时器根本不存在）。而 tick 推进的是**真状态**
   * （资源产出、战斗回合、关卡进度）。不标脏的话，玩家挂机一整天的产出只活在内存里，
   * 进程一重启就全没了 —— 而且丢得静悄悄，没有任何报错。
   * 写盘频率由 `FLUSH_MS`（5 秒）节流，所以不会每拍都写。
   */
  step() { this.store.tick(); this.rev++; this.dirty = true }

  /**
   * 算一次**增量**并发布：逐键与上一拍快照比对，不一样的进 `parts`、入环、`srev++`。
   * 返回 `{键: 已序列化的值}`；**什么都没变时返回 `null`**（调用方据此回空增量）。
   *
   * ⚠️ **存的是序列化后的字符串，不是值的引用**。两个理由：① 回执直接拼接，省一次序列化；
   *    ② `state[k]` 是**活的**，引擎之后会就地改它 —— 存引用的话，发出去的就是新值了。
   *
   * ⚠️ **比对是逐键 `JSON.stringify`**，实测 188KB 的档约 0.3ms。**只在 1Hz 的拍上做**，
   *    别挪进更高频的循环。
   */
  publish() {
    const s = this.store.state
    const out = Object.create(null)
    for (const k of Object.keys(s)) {
      let str
      // 兜底 try：真序列化不了（理论上不该发生）就**跳过这个键** —— 不更新快照，
      // 下一拍还会重试并再记一次日志。**不要把它塞成 null**：那会把客户端的状态打坏。
      try { str = JSON.stringify(s[k] === undefined ? null : s[k]) } catch (e) {
        console.error('[host] 状态键无法序列化（跳过本轮）', String(this.pid).slice(0, 4), k, e.message)
        continue
      }
      if (this._snap[k] !== str) { out[k] = str; this._snap[k] = str }
    }
    // 键**消失**了也要说：不说的话客户端会一直留着那个键，两边状态越差越远
    for (const k of Object.keys(this._snap)) {
      if (!(k in s)) { out[k] = 'null'; delete this._snap[k] }
    }
    if (!Object.keys(out).length) return null
    this.srev++
    this._ring.push({ srev: this.srev, parts: out })
    if (this._ring.length > STATE_RING) this._ring.shift()
    return out
  }

  /**
   * 客户端说"我手上是 `since` 这一版"，返回它缺的变更集（已按序合并、同键后者胜）。
   *
   * **返回 `null` 一律表示"回全量"**，三种情形：
   *  · `since <= 0` —— 首次/重连，本来就没有基线；
   *  · `since > this.srev` —— 客户端比服务端还新（服务端重启过，srev 从 0 重来）；
   *  · 环已经被裁到 `since` 之后 —— 客户端缺的那一段服务端也没了。
   * 第三种是**自愈**：宁可信客户端"我什么都不缺"是假的，也不能让它带着一个缺口一直跑下去。
   */
  deltaSince(since) {
    if (!Number.isInteger(since) || since <= 0) return null
    if (since > this.srev) return null
    if (since === this.srev) return Object.create(null)   // 已是最新 ⇒ 空增量（省的是传输，不是计算）
    const first = this._ring[0]
    if (!first || first.srev > since + 1) return null
    const out = Object.create(null)
    // _ring 按 srev 升序 push ⇒ 顺序 Object.assign，后面的自然覆盖前面的（同键后者胜）
    for (const e of this._ring) if (e.srev > since) Object.assign(out, e.parts)
    return out
  }

  /**
   * 全量快照：直接复用 `_snap`（它每拍都刷到最新）⇒ **全量也不额外序列化一次**。
   * 返回的仍是 `{键: 已序列化的字符串}`，与 `publish()`/`deltaSince()` 同一种形状 ——
   * 三种回执在调用方那里走同一条包装路径，不必各写一份。
   */
  snapshot() {
    if (!Object.keys(this._snap).length) this.publish()
    return this._snap
  }

  /**
   * 有脏数据、且过了节流窗口时才该落盘；`force` 忽略节流。
   *
   * ⚠️ **返回的是 `_raw`，而它只在引擎调 `save()` 时才被刷新**（`_attach` 注入的 storage
   *    把 `setItem(SAVE_KEY, v)` 落到 `_raw`）。`tick()` **不调** `save()`，且
   *    `autoLoop:false` 关掉了那个 2 秒保存定时器 ⇒ **tick 产出不会自己进 `_raw`**。
   *    所以调用方**必须**先让引擎重新序列化一次，见 `EngineHost.flushHost`。
   *
   *    2026-09-18 的原始版本正是漏了这一步，而它的表现**不是**"没有文件"：
   *      · `grantRemote()` 里有一次 `save()`（`engine.ts:784`），而 `rewardsFile` 是
   *        **固定路径**（`server.js:66` 的 `/opt/doupo-game/rewards/rewards.json`，不在
   *        数据目录下、线上一直存在）⇒ `acquire()` 时就把它刷新了一遍。
   *      · 于是**每个玩家一上线就落一份档**（= 上线那一刻的状态），然后 `data` 冻在那里，
   *        每 5 秒被**原样重写**一次（只有外层 `updatedAt` 在动）。
   *      · ⇒ **"文件存在"和"mtime 变了"都是假绿**，判据只能是 **`data` 的内容有没有推进**。
   *        挂机 10 分钟的结晶、在线时长、战斗推进，在驱逐/重启时全部丢掉。
   *      · （rewards 清单为空或该路径读不到时，连那一次都不会有 ⇒ 新号一个字节都不写。）
   *
   *    当时没被测出来，是因为夹具做过 `claimMail`/`enhanceEquip` 这类**带 `save()` 的动作**
   *    —— 它们把 `_raw` 刷新了。这正是红线㉑「夹具的环境假设比数值常量更阴」的形状：
   *    **纯 tick 的那条路没人走**。
   */
  takeDirty(force) {
    if (!this.dirty) return null
    if (!force && Date.now() - this.lastFlush < FLUSH_MS) return null
    return this._raw
  }

  markFlushed() { this.dirty = false; this.lastFlush = Date.now() }
}

class EngineHost {
  /**
   * @param {object} o
   * @param {string} o.dataDir              权威态目录（`saves/` 就在它下面）
   * @param {(pid: string, data: string) => void} o.writeSave
   *        注入 server.js 既有的原子写，**不另写一份** —— 两份写盘逻辑必然分叉。
   * @param {string} [o.activitiesFile]     活动配置（`activities/activities.json`）
   * @param {string} [o.rewardsFile]        运营奖励清单（`rewards/rewards.json`）
   */
  constructor({ dataDir, writeSave, activitiesFile, rewardsFile }) {
    this.dataDir = dataDir
    this.writeSave = writeSave
    this.players = new Map()
    this.timer = null
    // 运营配置：**全服一份**，不必每玩家读一遍文件。缓存按 mtime+size 失效 ⇒ 运营改文件即生效
    this.activitiesFile = activitiesFile || ''
    this.rewardsFile = rewardsFile || ''
    this._actCache = { key: '', parsed: null }
    this._rewCache = { key: '', parsed: null }
  }

  _readRaw(pid) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'saves', pid + '.json'), 'utf8'))
      if (w && typeof w.data === 'string') return w.data
    } catch { /* 没有云档 ⇒ 新号 */ }
    return null
  }

  /**
   * **只读地**取该玩家的权威态（给 `/score` 用）。
   *
   * ⚠️ **绝不调 `acquire()`**：那会构造引擎、标在线、跑一次离线结算。而"进榜单页看了一眼"
   *    不该让一个没在玩的人变成**在线** —— 在线 = 引擎按 1Hz 给他跑 tick（白烧 CPU），
   *    还会把他从"离线累积"切成"实时结算"。只读是刻意的。
   *
   * 取态顺序：**内存里的在线实例最新**（引擎正在 tick 它）；否则读 `saves/<pid>.json`
   * （那份有 5 秒落盘节流 + 客户端 3 分钟上传，可能落后几拍）；都没有 ⇒ `null`（新号 / 纯老客户端）。
   *
   * ⚠️ 返回的是**状态对象**（不是引擎实例）：调用方只允许拿它做**纯函数**的派生
   *    （`combatPower` / `highestStage` / `lab.highestFloor`），**不要往里写**。
   *    离线那条路返回的是 `JSON.parse` 的裸对象，**没有**引擎构造时做的补键与 clamp ——
   *    所以调用方必须容忍字段缺失、并自己兜住异常。
   */
  authoritativeOf(pid) {
    const h = this.players.get(pid)
    if (h) return h.store.state
    const raw = this._readRaw(pid)
    if (typeof raw !== 'string' || !raw) return null
    try {
      const s = JSON.parse(raw)
      return s && typeof s === 'object' ? s : null
    } catch { return null }
  }

  /**
   * 读一份运营配置并以 `parse` 规范化。**三种"读不到"必须区别对待**：
   *  · 文件不存在  ⇒ 保持现状（**不是**清空 —— 没配活动不等于把玩家正在做的活动撤掉）
   *  · mtime 没变  ⇒ 直接用缓存（不必重新解析）
   *  · 解析抛错    ⇒ 保留上一份并打日志（配置写坏了不该让活动中心/福利突然全消失）
   */
  _loadOps(file, cache, parse, label) {
    if (!file) return
    let st
    try { st = fs.statSync(file) } catch { return }
    const key = st.mtimeMs + ':' + st.size
    if (cache.key === key) return
    try {
      cache.parsed = parse(JSON.parse(fs.readFileSync(file, 'utf8')))
      cache.key = key
    } catch (e) {
      console.error('[host] 运营配置解析失败（保留上一份）', label, e.message)
    }
  }

  /** 把当前运营配置推给一个实例。幂等 —— 配置没变时引擎内部会自己早退，不会反复重渲。 */
  _applyOps(h) {
    if (this._actCache.parsed) h.store.setRemoteActivities(this._actCache.parsed)
    if (this._rewCache.parsed) h.store.grantRemote(this._rewCache.parsed)
  }

  /** 重读运营配置并推给所有在线实例。由 `tickAll` 每拍调一次（两次 statSync，开销可忽略）。 */
  refresh() {
    this._loadOps(this.activitiesFile, this._actCache, parseActivities, 'activities.json')
    this._loadOps(this.rewardsFile, this._rewCache, parseRewards, 'rewards.json')
    for (const h of this.players.values()) this._applyOps(h)
  }

  /**
   * 取（或建）该玩家的实例 —— **这是"上线"的唯一入口**。
   *
   * ⚠️ 两条路必须分开处理：
   *   · 首次 acquire：实例在构造函数里已经结算过离线收益，**不要再结算**（会重复补）。
   *   · 实例还在、但人刚从离线回来：tick 早停了、`lastTick` 停在最后一次 tick，
   *     **必须补一次** `applyOfflineProgress()` —— 否则这段挂机产出凭空消失。
   */
  acquire(pid) {
    let h = this.players.get(pid)
    if (!h) {
      // 活动配置走构造参数（那一刻就要有，否则玩家上线第一眼的活动中心是空的）；
      // 奖励清单走 _applyOps（它会结算发放，本来就得在实例活着的时候做）。
      h = new PlayerHost(pid, () => this._readRaw(pid), this._actCache.parsed || undefined)
      this.players.set(pid, h)
      this._applyOps(h)
      h.touch()
      // 首次发布：_snap 是空的 ⇒ 全部键都算"变了"，整份入环（srev=1）。
      // 无害且必要 —— 保证环从 1 开始连续，客户端 since=0 那条路仍然走全量。
      h.publish()
      return h
    }
    // 离线转在线：这一补可能改了状态（挂机产出），必须立刻发布，
    // 否则客户端要等到下一拍 tick 才看得到（那 1 秒里它拿的是空增量 ⇒ 数字停一下）。
    if (!h.online) { h.store.applyOfflineProgress(); h.publish() }
    h.touch()
    return h
  }

  /**
   * 把该玩家的权威态写回 `saves/<pid>.json`。
   *
   * ★ 顺序是**硬要求**（2026-09-18 修）：先问一次「该落盘吗」，**再让引擎重新序列化**，
   *   最后才取那份字符串。写成「直接取 `takeDirty()` 就写」会落一份**上一拍的旧档**
   *   （新号更是 `null`）—— 见 `PlayerHost.takeDirty` 的注释。
   *
   * 为什么刷新放在这里而不是 `PlayerHost.step()`：`save()` 是**整份** 188KB 的
   *   `JSON.stringify`，而 `publish()` 已经每拍逐键 stringify 过一次了。放进 step
   *   等于把这份成本翻一倍、每拍付一次；放在这里只在这个 5 秒节流窗口付一次。
   */
  flushHost(h, force) {
    // 第一问：dirty 且过了节流窗口？（只看标志与时间，不看内容）
    if (h.takeDirty(force) === null) return false
    // 第二：让引擎把**当前**状态序列化进 `_raw`（`save()` 不改 state，不会掺进新变化）
    h.store.save()
    const dirty = h.takeDirty(force)
    if (dirty === null) return false
    try {
      this.writeSave(h.pid, dirty)
      h.markFlushed()
      return true
    } catch (e) {
      // 落盘失败**不清 dirty** ⇒ 下一拍会重试，别把进度静默吞掉
      console.error('[host] 落盘失败', String(h.pid).slice(0, 4), e.message)
      return false
    }
  }

  /**
   * 丢弃某个玩家的实例，**不落盘**。
   *
   * 给 `POST /save` 用：那份**上传**才是权威，而这个实例的内存态是上传之前的，
   * 它下一次 `flushHost` 会把上传盖回去（阶段 3 之后实例会一直活着，1Hz tick，
   * 所以这不再是理论问题）。**刻意不 flush** —— flush 写的正是要丢弃的那份内存态。
   * 下一次 `/state` 会按磁盘重建实例（`acquire` 的首次路径，会结算一次离线收益）。
   */
  drop(pid) { return this.players.delete(pid) }

  start() {
    if (this.timer) return
    this.refresh()
    this.timer = setInterval(() => this.tickAll(), TICK_MS)
    // 别让这个定时器挡住进程退出 —— 退出前我们会显式 shutdown()
    if (this.timer.unref) this.timer.unref()
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  /** 一拍：重读运营配置、推进在线玩家、按节流落盘、驱逐长期离线的实例。 */
  tickAll() {
    this.refresh()
    const now = Date.now()
    for (const [pid, h] of this.players) {
      if (h.online) {
        h.step()
        // 算增量入环。⚠️ **必须在 step 之后、且每拍都要做** —— 跳过任何一拍，
        // 客户端带 since 来取时就会缺那一段（它只会收到"新变化"），
        // 表现是"某个数字卡住不涨"，而且**再也不自愈**。
        h.publish()
        this.flushHost(h, false)
      } else if (now - h.lastSeen > EVICT_MS) {
        // 离线够久：**先落盘再卸** —— 否则这段进度只活在内存里，一卸就没了
        this.flushHost(h, true)
        this.players.delete(pid)
      } else {
        // 刚掉线：立刻写一次（再不上线就没人替他写了）。没有脏数据时是空操作，不会每拍都写。
        this.flushHost(h, true)
      }
    }
  }

  /** 进程退出前把所有脏数据写下去 —— 不写就是丢进度。返回写了几个人。 */
  shutdown() {
    this.stop()
    let n = 0
    for (const h of this.players.values()) if (this.flushHost(h, true)) n++
    return n
  }

  get size() { return this.players.size }
  get onlineCount() { let n = 0; for (const h of this.players.values()) if (h.online) n++; return n }
}

module.exports = { EngineHost, PlayerHost, TICK_MS, ONLINE_TTL, SAVE_KEY }