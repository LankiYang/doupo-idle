import { useState } from 'react'
import { useGame, combatPower, fmtNum } from '../game/engine'
import { buildLeaderboard } from '../game/leaderboard'

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
  const [draft, setDraft] = useState(nickname)

  const power = combatPower(state)
  const displayName = nickname || '无名侠客'
  const rows = buildLeaderboard(power, displayName)
  const myRow = rows.find(r => r.isMe)!

  const confirmName = () => {
    const trimmed = draft.trim().slice(0, 10) || '无名侠客'
    setNickname(trimmed)
    saveNickname(trimmed)
    setEditing(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-3 sm:p-6">
      <div className="dq-panel w-full max-w-xl rounded-md p-4 text-center">
        <div className="mb-1 text-dq-gold">江湖群雄榜</div>
        <div className="mb-3 text-sm text-[#a89478]">按当前阵容综合战力排名，攻防血与暴击词条都算在内</div>

        {editing ? (
          <div className="flex justify-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={10}
              placeholder="给自己起个名号"
              className="w-40 rounded border border-dq-border bg-black/30 px-2 py-1 text-center text-sm text-dq-gold outline-none focus:border-dq-gold" />
            <button onClick={confirmName} className="rounded bg-dq-gold px-3 py-1 text-sm text-black">确定</button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <div className="text-lg text-dq-gold">{displayName}</div>
            <button onClick={() => { setDraft(nickname); setEditing(true) }}
              className="rounded border border-dq-border px-2 py-0.5 text-xs text-[#a89478] hover:border-dq-gold">改名</button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-center gap-6 text-sm">
          <div><span className="text-[#a89478]">我的战力 </span><span className="text-dq-fire">{fmtNum(power)}</span></div>
          <div><span className="text-[#a89478]">当前排名 </span><span className="text-dq-gold">第 {myRow.rank} 名</span> / {rows.length}</div>
        </div>
      </div>

      <div className="dq-panel w-full max-w-xl rounded-md p-3">
        <div className="space-y-1">
          {rows.map(r => (
            <div key={r.rank}
              className={`flex items-center gap-3 rounded px-2 py-1.5 text-sm ${r.isMe ? 'border border-dq-gold bg-dq-gold/10' : ''}`}>
              <div className={`w-8 shrink-0 text-center ${r.rank <= 3 ? 'text-dq-fire' : 'text-[#a89478]'}`}>
                {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
              </div>
              <div className={`min-w-0 flex-1 truncate ${r.isMe ? 'text-dq-gold' : 'text-[#e8dcc8]'}`}>{r.name}{r.isMe && '（我）'}</div>
              <div className="tabular-nums text-[#a89478]">{fmtNum(r.power)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
