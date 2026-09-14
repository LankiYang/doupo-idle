import { useEffect, useState } from 'react'
import { useGame, combatPower, fmtNum } from '../game/engine'
import { submitScore, fetchLeaderboard, fetchMe, agoText, type LbRow } from '../game/leaderboardApi'

const NAME_KEY = 'doupo-idle-nickname'

function loadNickname(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}
function saveNickname(name: string) {
  try { localStorage.setItem(NAME_KEY, name) } catch { /* ignore */ }
}

export default function LeaderboardView() {
  const state = useGame()
  const [nickname, setNickname] = useState(loadNickname)
  const [editing, setEditing] = useState(!loadNickname())
  const [draft, setDraft] = useState(loadNickname)
  const [rows, setRows] = useState<LbRow[]>([])
  const [total, setTotal] = useState(0)
  const [myRank, setMyRank] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  const power = combatPower(state)
  const stage = state.highestStage
  const floor = state.lab.highestFloor

  // 上传当前真实战绩并拉取全服榜单（提交失败/冷却不影响拉取）
  async function refresh(doSubmit: boolean) {
    setStatus('loading')
    if (doSubmit) await submitScore(nickname.trim() || '无名侠客', power, stage, floor)
    const [board, me] = await Promise.all([fetchLeaderboard(100), fetchMe()])
    if (!board) { setStatus('error'); return }
    setRows(board.entries)
    setTotal(board.total)
    setMyRank(me?.rank ?? null)
    setStatus('ok')
  }

  useEffect(() => { refresh(true) }, []) // 进入榜单即上传+刷新

  const confirmName = () => {
    const trimmed = draft.trim().slice(0, 12) || '无名侠客'
    setNickname(trimmed)
    saveNickname(trimmed)
    setEditing(false)
    submitScore(trimmed, power, stage, floor).then(() => refresh(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        <div className="mb-1 text-dq-gold">江湖群雄榜</div>
        <div className="mb-3 text-sm text-[#a89478]">全服玩家实时战力排名（按当前阵容综合战力，进入本页自动上传你的战绩）</div>

        {editing ? (
          <div className="flex justify-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={12}
              placeholder="给自己起个名号"
              className="w-40 rounded border border-dq-border bg-black/30 px-2 py-1 text-center text-sm text-dq-gold outline-none focus:border-dq-gold" />
            <button onClick={confirmName} className="rounded bg-dq-gold px-3 py-1 text-sm text-black">确定</button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <div className="text-lg text-dq-gold">{nickname || '无名侠客'}</div>
            <button onClick={() => { setDraft(nickname); setEditing(true) }}
              className="rounded border border-dq-border px-2 py-0.5 text-xs text-[#a89478] hover:border-dq-gold">改名</button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-center gap-6 text-sm">
          <div><span className="text-[#a89478]">我的战力 </span><span className="text-dq-fire">{fmtNum(power)}</span></div>
          <div><span className="text-[#a89478]">我的排名 </span>
            <span className="text-dq-gold">{myRank ? `第 ${myRank} 名` : '未上榜'}</span>
            <span className="text-[#5a4a38]"> / {total}</span>
          </div>
        </div>

        <button onClick={() => refresh(true)} disabled={status === 'loading'}
          className="mt-3 rounded border border-dq-border px-3 py-1 text-xs text-[#a89478] hover:border-dq-gold hover:text-dq-gold disabled:opacity-40">
          {status === 'loading' ? '上传中…' : '上传并刷新'}
        </button>
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-3">
        {status === 'error' && (
          <div className="py-6 text-center text-sm text-[#a89478]">
            榜单服务暂时连不上，请稍后重试
            <div className="mt-2"><button onClick={() => refresh(false)} className="rounded border border-dq-border px-3 py-1 text-xs hover:border-dq-gold">重试</button></div>
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
            {rows.map(r => {
              const me = myRank != null && r.rank === myRank
              return (
                <div key={r.rank}
                  className={`flex items-center gap-3 rounded px-2 py-1.5 text-sm ${me ? 'border border-dq-gold bg-dq-gold/10' : ''}`}>
                  <div className={`w-8 shrink-0 text-center ${r.rank <= 3 ? 'text-dq-fire' : 'text-[#a89478]'}`}>
                    {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${me ? 'text-dq-gold' : 'text-[#e8dcc8]'}`}>{r.name}{me && '（我）'}</div>
                    <div className="text-[10px] text-[#5a4a38]">主线第 {r.stage} 关 · 天梯 {r.floor} 层 · {agoText(r.updatedAt)}</div>
                  </div>
                  <div className="tabular-nums text-[#a89478]">{fmtNum(r.power)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="w-full max-w-xl text-center text-[10px] leading-relaxed text-[#5a4a38]">
        榜单为匿名提交（设备本地 id 标识），换设备/清缓存会视为新玩家；战力由本地计算上传，仅作休闲排名。
      </div>
    </div>
  )
}
