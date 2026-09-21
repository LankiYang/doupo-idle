import { useEffect, useState } from 'react'
import { useGame, combatPower, fmtNum } from '../game/engine'
import { submitScore, fetchLeaderboard, fetchLeaderboardWithRoster, fetchMe, fetchNick, submitNick, agoText, type LbRow, type RosterDetail } from '../game/leaderboardApi'
import { submitLuck, fetchLuck, fetchLuckMe, type LuckRow, type LuckPullRow, type LuckSubmitResp } from '../game/luckApi'
import { getAuthNick } from '../game/authApi'
import { loadNick, saveNick } from '../game/nickname'
import RankBadge from './RankBadge'

// ⚠️ 昵称的存取已收口到 `game/nickname.ts`（v1.53）。原先这里是**唯一**一份，
//    且只读写本机 localStorage ⇒ 换设备必丢；更糟的是丢的时候这一页会拿兜底值
//    「无名侠客」上报一次，**把榜上那条的名字顶掉**（2026-09-21 的事故）。
//    现在本机那份只是**缓存**，权威副本在服务端：账号记录 `accounts[pid].nick` → 榜上既有的真名。

/** 两张榜：战力榜（原有）/ 手气榜（v1.47）。**默认必须是战力榜** —— 老锚点脚本进这个页签时看的就是它 */
type Board = 'power' | 'luck'

export default function LeaderboardView() {
  const state = useGame()
  // 本机缓存的那一份（权威副本在服务端）；登录过的账号还会在令牌里带着一份
  // （`getAuthNick`）—— 那是启动时**不必等网络**就能立刻拿到的那一份。
  const [nickname, setNickname] = useState(() => loadNick() || getAuthNick() || '')
  // 只有**确实没有名字**时才进编辑态。
  // ⚠️ 不能只看本机缓存：换设备时本机一定是空的，而服务端那边多半有名字 ——
  //    那种情况要去把名字取回来，不是让玩家重新起一个（他一按下确定就会把榜上那条顶掉，
  //    正是 2026-09-21 那天发生的事）。下面 `useEffect` 里还有第二重判定（要问服务端）。
  const [editing, setEditing] = useState(() => !(loadNick() || getAuthNick()))
  const [draft, setDraft] = useState(() => loadNick() || getAuthNick() || '')
  const [board, setBoard] = useState<Board>('power')

  // ── 战力榜（原样保留）────────────────────────────────────────────────
  const [rows, setRows] = useState<LbRow[]>([])
  const [total, setTotal] = useState(0)
  const [myRank, setMyRank] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  // ── 阵容详情（战力榜，v1.49）──────────────────────────────────────────
  /** **按需拉**：服务端为它要额外读一遍每个人的权威档，所以没点「阵容」就不发这一发 */
  const [rosters, setRosters] = useState<(RosterDetail | null)[] | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterErr, setRosterErr] = useState(false)
  /** 当前展开的是哪一名（同时只展开一行 —— 手机上摊开六个人的阵容已经够长了） */
  const [openRank, setOpenRank] = useState<number | null>(null)

  // ── 手气榜 ───────────────────────────────────────────────────────────
  const [luckRows, setLuckRows] = useState<LuckRow[]>([])
  /** 还没出圣阶的人 —— **只列抽数，不计入排名**（榜单只有「有排名的」才是"榜"） */
  const [luckPulls, setLuckPulls] = useState<LuckPullRow[]>([])
  const [luckTotal, setLuckTotal] = useState(0)
  const [luckMyRank, setLuckMyRank] = useState<number | null>(null)
  const [luckStatus, setLuckStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [luckBaseline, setLuckBaseline] = useState(52) // 服务端下发后会覆盖（参照线只有一处来源）
  const [luckMin, setLuckMin] = useState(1)
  /** 未上榜的原因（来自提交响应）。数据是服务端算的，所以「为什么没上去」也只有服务端知道 */
  const [luckNote, setLuckNote] = useState('')
  const [luckMine, setLuckMine] = useState<{ avg: number; pullCount: number; shengCount: number } | null>(null)

  const power = combatPower(state)
  const stage = state.highestStage
  const floor = state.lab.highestFloor

  // 上传当前真实战绩并拉取全服榜单（提交失败/冷却不影响拉取）
  //
  // `nameOverride`：这一次提交要用的名字。**刚取回名字时必须显式传** —— 那是异步取回来的，
  // 那一刻 state 还没更新，闭包里的 `nickname` 仍然是空串；照着它提交，就等于又拿兜底值
  // 把榜上的名字顶了一次（把修好的事又做坏一遍）。
  async function refresh(doSubmit: boolean, nameOverride?: string) {
    setStatus('loading')
    // 榜单会重新排序 ⇒ 上一轮的阵容按下标对齐会**错位**，必须一起作废（下拉重拉一次的成本很小）
    setRosters(null); setOpenRank(null); setRosterErr(false)
    // ⚠️ 名字为空时**不带这个字段**（`submitScore` 内部就是这么做的）：含义是
    //    "我这次没有新名字要说"，服务端会沿用它自己那份权威昵称 —— 而不是"改名叫无名侠客"。
    if (doSubmit) await submitScore((nameOverride ?? nickname).trim(), power, stage, floor)
    const [b, me] = await Promise.all([fetchLeaderboard(100), fetchMe()])
    if (!b) { setStatus('error'); return }
    setRows(b.entries)
    setTotal(b.total)
    setMyRank(me?.rank ?? null)
    setStatus('ok')
  }

  // 手气榜：**只把 playerId 发过去**，数字由服务端从权威档算（见 luckApi.ts 的头注）
  async function refreshLuck(doSubmit: boolean, nameOverride?: string) {
    setLuckStatus('loading')
    if (doSubmit) {
      const sub = await submitLuck((nameOverride ?? nickname).trim())
      setLuckNote(noteOf(sub))
      if (sub && sub.ok) setLuckMine({ avg: sub.avg, pullCount: sub.pullCount, shengCount: sub.shengCount })
    }
    const [b, me] = await Promise.all([fetchLuck(100), fetchLuckMe()])
    if (!b) { setLuckStatus('error'); return }
    setLuckRows(b.entries)
    // 服务端已经扫过全服权威档，`pulls` = 还没出圣阶的人（只列抽数、没有名次）。
    // 老服务端没有这个字段 ⇒ 兜成空数组，界面退化成改动前的样子（**不报错、不白屏**）
    setLuckPulls(Array.isArray(b.pulls) ? b.pulls : [])
    setLuckTotal(b.total)
    if (Number.isFinite(b.baseline)) setLuckBaseline(b.baseline)
    if (Number.isFinite(b.minSheng)) setLuckMin(b.minSheng)
    setLuckMyRank(me?.rank ?? null)
    // 就算没上榜，也把「我抽了多少抽 / 出了几张」带回来 —— 这两个数以前只在 POST 的回执里，
    // 而玩家没切到过这张榜时就根本没有那次 POST（这与"榜一直空着"是同一个根因）。
    // ⚠️ 只在服务端真给了有限数时才覆盖，免得把上面 POST 刚设好的值抹成 0。
    if (me && Number.isFinite(me.pullCount)) {
      setLuckMine({ avg: me.entry?.avg ?? 0, pullCount: me.pullCount as number, shengCount: me.shengCount ?? 0 })
    }
    setLuckStatus('ok')
  }

  /**
   * ★ 进入榜单页的顺序：**先把名字取回来，再上报战绩**（v1.53）。
   *
   * 反过来的话，"本机没有名字"这件事会先被报上去一次 —— 那一次正是把榜上名字顶掉的那一下。
   * ⚠️ `fetchNick()` 回 `''`（服务端也说还没起名）与回 `null`（**没问到**）必须分开：
   *    前者该让玩家起名（保持编辑态），后者只应保持现状 —— 断网时弹一个起名框出来是误报。
   */
  useEffect(() => {
    let alive = true
    ;(async () => {
      let nm = nickname
      if (!nm) {
        // ① 登录令牌里那份（本地就有，不必等网络）② 服务端那份（`GET /nickname`）
        const auth = getAuthNick()
        if (auth) { nm = auth; setNickname(nm); saveNick(nm); setEditing(false) }
        else {
          const got = await fetchNick()
          if (!alive) return
          if (got) { nm = got; setNickname(nm); saveNick(nm); setEditing(false) }
        }
      }
      if (!alive) return
      await refresh(true, nm) // ⚠️ 必须传 `nm`，见 `refresh` 的注释
    })()
    return () => { alive = false }
  }, []) // 进入榜单即取名字+上传+刷新（战力榜这一路，其余与改动前相同）

  /** 首次切到手气榜时才提交/拉取它 —— 不打开这张榜就不产生任何额外请求 */
  const switchBoard = (b: Board) => {
    if (b === board) return
    setBoard(b)
    if (b === 'luck' && luckStatus === 'idle') refreshLuck(true)
  }

  /**
   * ★ 改名（v1.53）：走 `POST /nickname` —— 名字的**唯一写入口**。服务端会把它写进
   * **账号记录**（有账号时）并同步两张榜上那条的名字。不再是"顺手在 `/score` 里带一个名字"。
   *
   * 本地先用输入值显示（点了确定就该立刻看到），但**最终以服务端回执为准**：服务端会做清洗，
   * 回执里那个名字才是真生效了的那个。
   * ⚠️ 空输入 = **没改**，不是"改名叫空" —— 别拿它去覆盖（服务端也会拒）。
   */
  const confirmName = async () => {
    const trimmed = draft.trim().slice(0, 12)
    if (!trimmed) { setEditing(false); setDraft(nickname); return }
    setNickname(trimmed); saveNick(trimmed); setEditing(false)
    const final = await submitNick(trimmed)
    if (final && final !== trimmed) { setNickname(final); saveNick(final) }
    await refresh(false, final || trimmed)
    if (luckStatus !== 'idle') await refreshLuck(false, final || trimmed)
  }

  const busy = board === 'power' ? status === 'loading' : luckStatus === 'loading'

  /**
   * 点某行的「阵容」：同一行再点一次收起；**第一次展开时才去拉**，拉到了就缓存住。
   * 拉失败**不清空 `rosters`**（保持 `null`）⇒ 再点一次会自动重试，而不是把人钉死在"看不到"上。
   */
  const toggleRoster = async (rank: number) => {
    if (openRank === rank) { setOpenRank(null); return }
    setOpenRank(rank)
    if (rosters !== null || rosterLoading) return
    setRosterLoading(true)
    setRosterErr(false)
    const b = await fetchLeaderboardWithRoster(100)
    setRosterLoading(false)
    if (!b || !Array.isArray(b.rosters)) { setRosterErr(true); return }
    setRosters(b.rosters)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        {board === 'power' ? (
          <>
            <div className="mb-1 text-dq-gold">江湖群雄榜</div>
            <div className="mb-3 text-sm text-[#a89478]">全服玩家实时战力排名（按当前阵容综合战力，进入本页自动上传你的战绩）</div>
          </>
        ) : (
          <>
            <div className="mb-1 text-dq-gold">手气榜 · 抽卡手气</div>
            <div className="mb-3 text-sm text-[#a89478]">平均多少抽才出一张圣阶 —— 越低手气越好（自本榜上线起统计）</div>
          </>
        )}

        <div className="mb-3 flex justify-center gap-1" role="tablist">
          {([['power', '战力榜'], ['luck', '手气榜']] as [Board, string][]).map(([id, label]) => (
            <button key={id} data-board-tab={id} data-board-tab-active={board === id ? '1' : undefined}
              onClick={() => switchBoard(id)} role="tab" aria-selected={board === id}
              className={`dq-tap-lg inline-flex items-center justify-center rounded px-4 py-1 text-xs ${board === id ? 'bg-dq-gold text-black' : 'border border-dq-border text-[#a89478] hover:border-dq-gold hover:text-dq-gold'}`}>
              {label}
            </button>
          ))}
        </div>

        {editing ? (
          <div className="flex justify-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={12}
              placeholder="给自己起个名号"
              className="w-40 rounded border border-dq-border bg-black/30 px-2 py-1 text-center text-sm text-dq-gold outline-none focus:border-dq-gold" />
            <button onClick={confirmName} className="dq-tap-lg inline-flex items-center justify-center rounded bg-dq-gold px-3 py-1 text-sm text-black">确定</button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <div className="text-lg text-dq-gold">{nickname || '无名侠客'}</div>
            <button onClick={() => { setDraft(nickname); setEditing(true) }}
              className="dq-tap inline-flex items-center justify-center rounded border border-dq-border px-2 py-0.5 text-xs text-[#a89478] hover:border-dq-gold">改名</button>
          </div>
        )}

        {board === 'power' ? (
          <div className="mt-3 flex items-center justify-center gap-6 text-sm">
            <div><span className="text-[#a89478]">我的战力 </span><span className="text-dq-fire">{fmtNum(power)}</span></div>
            <div><span className="text-[#a89478]">我的排名 </span>
              <span className="text-dq-gold">{myRank ? `第 ${myRank} 名` : '未上榜'}</span>
              <span className="text-[#5a4a38]"> / {total}</span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center gap-6 text-sm">
            <div><span className="text-[#a89478]">我的手气 </span>
              {luckMine && luckMine.shengCount > 0
                ? <span className="text-dq-fire">{luckMine.avg.toFixed(1)} 抽/张</span>
                : luckMine && luckMine.pullCount > 0
                  ? <span className="text-[#a89478]">已抽 {luckMine.pullCount} 抽 / 圣阶 0 张</span>
                  : <span className="text-[#5a4a38]">—</span>}
            </div>
            <div><span className="text-[#a89478]">我的排名 </span>
              <span className="text-dq-gold">{luckMyRank ? `第 ${luckMyRank} 名` : '未上榜'}</span>
              <span className="text-[#5a4a38]"> / {luckTotal}</span>
            </div>
          </div>
        )}

        {board === 'luck' && luckNote && (
          <div data-luck-note className="mt-2 text-xs text-[#a89478]">{luckNote}</div>
        )}

        <button onClick={() => (board === 'power' ? refresh(true) : refreshLuck(true))} disabled={busy}
          className="dq-tap-lg mt-3 inline-flex items-center justify-center rounded border border-dq-border px-3 py-1 text-xs text-[#a89478] hover:border-dq-gold hover:text-dq-gold disabled:opacity-40">
          {busy ? '上传中…' : '上传并刷新'}
        </button>
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-3">
        {board === 'power' ? (
          <>
            {status === 'error' && (
              <div className="py-6 text-center text-sm text-[#a89478]">
                榜单服务暂时连不上，请稍后重试
                <div className="mt-2"><button onClick={() => refresh(false)} className="dq-tap inline-flex items-center justify-center rounded border border-dq-border px-3 py-1 text-xs hover:border-dq-gold">重试</button></div>
              </div>
            )}
            {status === 'loading' && rows.length === 0 && (
              <div className="py-6 text-center text-sm text-[#a89478]">加载中…</div>
            )}
            {status === 'ok' && rows.length === 0 && (
              <div className="py-6 text-center text-sm text-[#a89478]">还没有玩家上榜，你将是第一个</div>
            )}
            {rows.length > 0 && (
              <div className="space-y-1">
                {rows.map((r, idx) => {
                  const me = myRank != null && r.rank === myRank
                  const open = openRank === r.rank
                  // ⚠️ 用**下标**取阵容，不用 `rank - 1` —— 服务端回的是「与 entries 同序等长」，
                  //    下标是那份约定的直接表达；名次万一有缺号也不会串行
                  const det = rosters ? rosters[idx] ?? null : null
                  return (
                    <div key={r.rank}>
                      <div className={`flex items-center gap-3 rounded px-2 py-1.5 text-sm ${me ? 'border border-dq-gold bg-dq-gold/10' : ''}`}>
                        <div className={`flex w-8 shrink-0 justify-center ${r.rank <= 3 ? 'text-dq-fire' : 'text-[#a89478]'}`}>
                          <RankBadge rank={r.rank} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate ${me ? 'text-dq-gold' : 'text-[#e8dcc8]'}`}>{r.name}{me && '（我）'}</div>
                          <div className="text-[10px] text-[#5a4a38]">主线第 {r.stage} 关 · 天梯 {r.floor} 层 · {agoText(r.updatedAt)}</div>
                        </div>
                        <div className="tabular-nums text-[#a89478]">{fmtNum(r.power)}</div>
                        <button data-roster-toggle={r.rank} onClick={() => toggleRoster(r.rank)} aria-expanded={open}
                          className="dq-tap shrink-0 rounded border border-dq-border px-2 py-0.5 text-[10px] text-[#a89478] hover:border-dq-gold hover:text-dq-gold">
                          {open ? '收起' : '阵容'}
                        </button>
                      </div>
                      {open && (
                        <div data-roster-detail={r.rank} className="mb-1 ml-8 mr-1 rounded border border-dq-border bg-black/20 px-2 py-1.5">
                          {rosterLoading && !rosters ? (
                            <div className="py-1 text-center text-[10px] text-[#5a4a38]">读取中…</div>
                          ) : rosterErr ? (
                            <div className="py-1 text-center text-[10px] text-[#a89478]">
                              阵容读取失败，收起后再点一次重试
                            </div>
                          ) : !det ? (
                            // 纯本地玩家（从没上传过云档）—— 宁可空着，也不拿他自报的战力去凑一套阵容出来
                            <div className="py-1 text-center text-[10px] text-[#5a4a38]">这位玩家还没有云端存档，看不到阵容</div>
                          ) : (
                            <div className="space-y-1">
                              {(['front', 'back'] as const).map(pos => {
                                const list = det.team.filter(c => c.slot === pos)
                                if (!list.length) return null
                                return (
                                  <div key={pos} data-roster-line={pos} className="flex items-start gap-2">
                                    <div className="w-8 shrink-0 pt-0.5 text-[10px] text-[#5a4a38]">{pos === 'front' ? '前排' : '后排'}</div>
                                    <div className="flex flex-1 flex-wrap gap-1">
                                      {list.map((c, i) => (
                                        <div key={`${c.name}-${i}`} data-roster-slot
                                          className="flex items-center gap-1 rounded border border-dq-border px-1.5 py-0.5 text-[10px]">
                                          <span className="text-[#e8dcc8]">{c.name}</span>
                                          <span className="text-[#a89478]">Lv{c.level}</span>
                                          {c.stars > 0 && <span className="text-dq-gold">★{c.stars}</span>}
                                          <span data-roster-power className="tabular-nums text-dq-fire">{fmtNum(c.power)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {det && (
                            // 榜单上的战力是**他上次进这张榜时**上传的，阵容却是**当前云端档**。
                            // 两者可能差出一截（有人一天没进榜、阵容早已换过）—— 与其让人以为哪里算错了，不如说清楚
                            <div className="mt-1 text-[9px] text-[#5a4a38]">
                              阵容取自其最新云端存档，与上方战力（上次上榜时上传）可能略有出入
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-2 text-center text-[11px] text-[#5a4a38]">
              全服长期均衡约 <span className="text-dq-gold">{luckBaseline}</span> 抽 / 张，比这个数低就是手气好
            </div>
            {luckStatus === 'error' && (
              <div className="py-6 text-center text-sm text-[#a89478]">
                榜单服务暂时连不上，请稍后重试
                <div className="mt-2"><button onClick={() => refreshLuck(false)} className="dq-tap inline-flex items-center justify-center rounded border border-dq-border px-3 py-1 text-xs hover:border-dq-gold">重试</button></div>
              </div>
            )}
            {(luckStatus === 'idle' || luckStatus === 'loading') && luckRows.length === 0 && (
              <div className="py-6 text-center text-sm text-[#a89478]">加载中…</div>
            )}
            {luckStatus === 'ok' && luckRows.length === 0 && luckPulls.length === 0 && (
              <div className="py-6 text-center text-sm text-[#a89478]">
                还没有人手气上榜
                <div className="mt-1 text-[11px] text-[#5a4a38]">抽满 {60} 抽必出一张圣阶，第 {luckMin} 张就能上榜</div>
              </div>
            )}
            {luckRows.length > 0 && (
              <div className="space-y-1">
                {luckRows.map(r => {
                  const me = luckMyRank != null && r.rank === luckMyRank
                  return (
                    <div key={r.rank} data-luck-row
                      className={`flex items-center gap-3 rounded px-2 py-1.5 text-sm ${me ? 'border border-dq-gold bg-dq-gold/10' : ''}`}>
                      <div className={`flex w-8 shrink-0 justify-center ${r.rank <= 3 ? 'text-dq-fire' : 'text-[#a89478]'}`}>
                        <RankBadge rank={r.rank} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate ${me ? 'text-dq-gold' : 'text-[#e8dcc8]'}`}>{r.name}{me && '（我）'}</div>
                        <div className="text-[10px] text-[#5a4a38]">共 {r.shengCount} 张 · {r.pullCount} 抽 · {agoText(r.updatedAt)}</div>
                      </div>
                      <div data-luck-avg className="tabular-nums text-dq-gold">{r.avg.toFixed(1)} 抽/张</div>
                    </div>
                  )
                })}
              </div>
            )}
            {/* 还没出圣阶的人：**把抽数摆出来，但没有名次** —— 榜单只要有排名的那些，
                这一段是为了让页签不至于"空着"，也让人看得见自己离上榜还有多远 */}
            {luckPulls.length > 0 && (
              <div className="mt-3 border-t border-dq-border pt-2">
                <div className="mb-1 px-2 text-[11px] text-[#a89478]">
                  还没出圣阶 · <span className="text-[#5a4a38]">只列抽数，不计入排名</span>
                </div>
                <div className="space-y-0.5">
                  {luckPulls.map((r, i) => (
                    <div key={`${r.name}-${i}`} data-luck-pull-row
                      className="flex items-center gap-3 rounded px-2 py-1 text-xs">
                      <div className="min-w-0 flex-1 truncate text-[#a89478]">{r.name}</div>
                      <div data-luck-pull-count className="shrink-0 tabular-nums text-[#e8dcc8]">已抽 {r.pullCount} 抽</div>
                      <div className="w-14 shrink-0 text-right text-[10px] text-[#5a4a38]">{agoText(r.updatedAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="w-full max-w-xl text-center text-[10px] leading-relaxed text-[#5a4a38]">
        {board === 'power'
          ? '榜单为匿名提交（设备本地 id 标识），换设备/清缓存会视为新玩家；战力由本地计算上传，仅作休闲排名。点「阵容」可看该玩家上阵的角色与等级战力。'
          : '手气榜由服务器按你的抽卡记录统计，客户端不上报任何数字；只统计本榜上线之后的抽卡，此前的不计入。'}
      </div>
    </div>
  )
}

/** 把服务端的「为什么没上榜」翻成人话 */
function noteOf(sub: LuckSubmitResp | null): string {
  if (!sub) return ''
  if (sub.ok) return ''
  if (sub.reason === 'nosheng') {
    const got = sub.shengCount ?? 0
    const need = sub.minSheng ?? 1
    return `还差 ${Math.max(0, need - got)} 张圣阶才能上榜（当前 ${got} 张 / ${sub.pullCount ?? 0} 抽）`
  }
  if (sub.reason === 'noauth') return '还没有读到你的云端存档，登录并游玩一会儿后再来看看'
  return ''
}