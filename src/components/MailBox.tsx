import { useState, useEffect, useCallback } from 'react'
// ⚠️ 图标必须起别名：`Mail` 这个名字已经被 `../game/mail` 的**类型**占着
//    （`useState<Mail[]>`、`claim = (m: Mail)`），两个同名 import 会让 `tsc -b` 报
//    "Duplicate identifier" 与 "'Mail' refers to a value, but is being used as a type"。
//    换了 emoji → lucide 之后才撞上的。
import { Mail as MailIcon } from 'lucide-react'
import { useGame, game, itemLabel, fmtNum } from '../game/engine'
import { itemSprite } from '../game/icons'
import Ico from './Ico'
import { fetchMails, type Mail } from '../game/mail'
import { agoText } from '../game/leaderboardApi'

/** 与云备份、奖励清单同一个节奏：不额外给服务器添心跳 */
const POLL_MS = 180000

/**
 * 站内邮箱（v1.33 建、v1.45 挪位）：入口在**顶部那一排按钮的右上角**（tab 行最右端），
 * 点开从右侧滑出抽屉。
 *
 * 为什么不做成一个 tab：tab 行是"游戏内容"，邮箱是**运营触点** —— 玩家不该为了看一封公告
 * 先记住它排在第几个页签。但它也不该像 v1.33 那样贴在屏幕右边缘：那是一块只为一个入口
 * 常驻的浮层，会压住页面内容。现在它占的是**本来就空着的那一排**的最右端，
 * 未读角标在它自己的右上角，一眼可见，且不占任何一页的版面。
 *
 * ⚠️ `data-mail-entry` / `data-mail-badge` 的位置断言是老锚点（`verify-mail.cjs` 里
 *    "入口在 tab 行最右端"那两条）—— 改布局要连着改它们，**不要**把它们放宽成恒真。
 *
 * 邮件列表由服务端给（全服 + 发给本人的定向，见 mail.ts），**领取状态在本地**
 * （state.gifts 的 `mail:` 键）—— 与存档的客户端权威模型一致，也不给存档加字段。
 */
export default function MailBox() {
  // 只为订阅引擎广播而调用（不取返回值）：领取状态存在 state.gifts 里、由引擎 emit 通知，
  // 少了这一行，点完「领取」角标不会消失 —— 组件根本不知道存档变了。
  useGame()
  const [open, setOpen] = useState(false)
  const [mails, setMails] = useState<Mail[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setMails(await fetchMails())
      setFailed(false)
    } catch {
      // 拉不到就保留上一次的列表：网络抖一下不该让已经看到的公告凭空消失
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // useGame() 订阅了引擎广播，所以 claimMail 里那次 emit 会让这里重算未读数
  const unclaimed = mails.filter(m => !game.mailClaimed(m.id))

  const claim = (m: Mail) => {
    game.claimMail(m)
    // 不给列表加本地状态：领没领由 state.gifts 一处说了算，
    // 两边各记一份迟早会出现"标了已领但背包没加"或反过来的情况
  }

  return (
    <>
      {/* 顶部那一排按钮的右上角（tab 行最右端）。未读角标贴它自己的右上角 */}
      <button onClick={() => { setOpen(true); void refresh() }} data-mail-entry
        data-mail-unread={unclaimed.length}
        title="邮箱"
        className="relative flex shrink-0 items-center gap-1 rounded pl-2.5 pr-5 text-xs text-dq-gold transition-colors hover:bg-black/25 sm:pl-3 sm:text-sm">
        <MailIcon size={14} className="leading-none" />
        <span className="leading-none">邮箱</span>
        {unclaimed.length > 0 && (
          /* ⚠️ 角标与文字**不许叠**：按钮右侧常留 pr-5（20px）那一条给角标（无未读时也留着，
             免得未读数从 0 变 1 时整排按钮抖一下）。角标贴的是按钮自己的右上角，16px 宽 < 20px。 */
          <span data-mail-badge
            className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-dq-fire px-1 text-[10px] font-bold leading-4 text-black">
            {unclaimed.length > 99 ? '99+' : unclaimed.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" data-mail-panel>
          {/* 遮罩点击关闭。邮箱是只读+领取，误触不会改任何东西，所以不必二次确认 */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-dq-border bg-dq-panel shadow-2xl sm:w-[420px]">
            <div className="flex items-center gap-2 border-b border-dq-border px-3 py-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-dq-gold"><MailIcon size={15} />邮箱</span>
              {unclaimed.length > 0 && <span className="text-xs text-dq-fire">未读 {unclaimed.length}</span>}
              <span className="flex-1" />
              <button onClick={() => void refresh()} data-mail-refresh
                className="rounded border border-dq-border px-2 py-0.5 text-xs text-[#a89478] hover:border-dq-gold">
                {loading ? '刷新中…' : '刷新'}
              </button>
              <button onClick={() => setOpen(false)} data-mail-close
                className="rounded border border-dq-border px-2 py-0.5 text-xs text-[#a89478] hover:border-dq-gold">关闭</button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {failed && mails.length === 0 && (
                <div className="p-4 text-center text-xs text-[#a89478]">
                  邮箱暂时连不上（公告拉不到不影响游戏本身），稍后再试
                </div>
              )}
              {!failed && mails.length === 0 && !loading && (
                <div className="p-6 text-center text-xs text-[#a89478]" data-mail-empty>暂时没有邮件</div>
              )}
              {mails.map(m => {
                const claimed = game.mailClaimed(m.id)
                const keys = Object.keys(m.items)
                return (
                  <div key={m.id} data-mail-id={m.id} data-mail-claimed={claimed ? '1' : '0'}
                    className={`mb-2 rounded border p-2.5 ${claimed ? 'border-dq-border/60 opacity-70' : 'border-dq-gold/50 bg-black/20'}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-dq-gold">{m.title}</span>
                      {!claimed && <span className="shrink-0 rounded bg-dq-fire px-1 text-[10px] leading-4 text-black">未读</span>}
                      <span className="flex-1" />
                      <span className="shrink-0 text-[10px] text-[#a89478]">{agoText(m.createdAt)}</span>
                    </div>
                    {m.sender && <div className="mt-0.5 text-[10px] text-[#a89478]">—— {m.sender}</div>}
                    {m.body && <div className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-[#e8dcc8]">{m.body}</div>}
                    {keys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {keys.map(k => {
                          const info = itemLabel(k)
                          return (
                            <span key={k} data-mail-item={k}
                              className="rounded border border-dq-border bg-black/30 px-1.5 py-0.5 text-[11px]">
                              <Ico name={itemSprite(k)} emoji={info.icon} className="h-4 w-4 align-[-3px]" /> {info.name} ×{fmtNum(m.items[k])}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {claimed ? (
                        <span className="text-[11px] text-[#a89478]">{keys.length ? '✓ 已领取' : '✓ 已读'}</span>
                      ) : (
                        <button onClick={() => claim(m)} data-mail-claim
                          className={`rounded px-3 py-1 text-xs text-black ${keys.length ? 'bg-dq-gold hover:opacity-90' : 'bg-[#a89478] hover:opacity-90'}`}>
                          {keys.length ? '领取附件' : '知道了'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}