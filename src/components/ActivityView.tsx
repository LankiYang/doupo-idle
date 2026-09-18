// 活动中心（v1.42）。活动**配置**来自服务端（/doupo/activities/activities.json，见 game/activities.ts），
// 这一页只负责把"进行中的活动"画出来、并把领取动作交给引擎。
//
// 这一页刻意不做的两件事：
//  ① 不自己算进度、不自己判断能不能领 —— 全走 game.activityProgress / activityClaimable。
//     "界面藏了按钮"从来不是拦截（v1.41 的教训），判定与发放在引擎的 claimActivity 里。
//  ② 不给活动分类排序 —— 配置里的 order 已经在解析时就排好了（见 parseActivities）。
import { useGame, game, fmtNum, itemLabel } from '../game/engine'
import { ACTIVITY_METRICS, type ActivityDef } from '../game/activities'
import { itemSprite } from '../game/icons'
import Ico from './Ico'

/**
 * 奖励清单。抽出来是因为这一页有两处要画同一份清单（签到卡的常驻行、任务卡的"达标后给什么"），
 * 原先两处各写一遍 `${icon}${name}×${n}` 再 join —— 图标一换代就得改两个地方。
 */
function RewardList({ items }: { items: Record<string, number> }) {
  return (
    <>
      {Object.entries(items).map(([k, n]) => (
        <span key={k} className="mr-2 inline-flex items-center gap-1">
          <Ico name={itemSprite(k)} emoji={itemLabel(k).icon} className="h-3.5 w-3.5" />
          <span>{itemLabel(k).name}×{n}</span>
        </span>
      ))}
    </>
  )
}

/** 活动类型的角标文案 */
const KIND_LABEL: Record<ActivityDef['kind'], string> = {
  online: '在线时长',
  checkin: '签到',
  task: '任务',
}

/** 剩余时间：不足一天按「X 小时 Y 分」，一天以上按「X 天 Y 小时」 */
function fmtRemain(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  if (h < 24) return `${h} 小时 ${Math.floor((total % 3600) / 60)} 分`
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`
}

function ActivityCard({ a }: { a: ActivityDef }) {
  const state = useGame()
  const now = Date.now()
  const claimed = game.activityClaimed(a, now)
  const reached = game.activityReached(a)
  const claimable = game.activityClaimable(a, now)
  const progress = game.activityProgress(a)
  const metric = a.kind === 'task' ? ACTIVITY_METRICS[a.metric] : null
  const unit = a.kind === 'online' ? '分钟' : (metric?.unit ?? '')
  // 签到类没有"进度"，画成 0/100 会因为 claimed 立刻变成满格 —— 那正是它该有的语义
  const pct = a.kind === 'checkin'
    ? (claimed ? 100 : 0)
    : (a.target > 0 ? Math.min(100, (progress / a.target) * 100) : 0)

  const btnText = claimable
    ? (a.kind === 'checkin' ? '签到' : '领取')
    : claimed ? (a.cycle === 'daily' ? '今日已领' : '已领取') : '未达成'

  return (
    <div className="rounded border border-dq-border p-2.5 text-xs" data-activity-id={a.id}
      data-act-state={claimable ? 'claimable' : claimed ? 'done' : 'locked'}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded border border-dq-border px-1.5 py-0.5 text-[10px] text-[#a89478]">
          {KIND_LABEL[a.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-dq-gold">{a.title}</div>
          {a.desc && <div className="text-[11px] leading-relaxed text-[#a89478]">{a.desc}</div>}
        </div>
        {a.endAt > 0 && (
          <span className="shrink-0 text-[10px] text-[#a89478]">剩 {fmtRemain(a.endAt - now)}</span>
        )}
      </div>

      {/* 签到类显示连续天数（进度条对"点一下"没有信息量，天数才有） */}
      {a.kind === 'checkin' && (
        <div className="mt-1.5 text-[11px] text-[#a89478]">
          连续签到 <span className="tabular-nums text-dq-gold">{state.activities.streak || 0}</span> 天
          {claimed && <span className="ml-2 text-dq-fire">今日已签到</span>}
        </div>
      )}

      <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-black/40">
        <div className="h-full rounded bg-dq-gold transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[#a89478]">
          {a.kind === 'checkin'
            ? <RewardList items={a.items} />
            : <>
                <span className="tabular-nums text-dq-gold">{fmtNum(Math.floor(progress))}</span>
                <span className="text-[#5a4a38]"> / {fmtNum(a.target)} {unit}</span>
                <span className="ml-1.5">
                  <RewardList items={a.items} />
                </span>
              </>}
        </span>
        <button onClick={() => game.claimActivity(a.id)} disabled={!claimable}
          data-act-claim={a.id}
          className="shrink-0 rounded bg-dq-gold px-3 py-1 text-black disabled:opacity-30">{btnText}</button>
      </div>
      {!reached && a.kind === 'task' && metric && (
        <div className="mt-1 text-[10px] text-[#5a4a38]">还差 {fmtNum(a.target - Math.floor(progress))} {unit}（{metric.label}）</div>
      )}
    </div>
  )
}

export default function ActivityView() {
  const now = Date.now()
  const list = game.activityList(now)
  const claimable = game.claimableCount(now)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:p-4">
      <div className="dq-panel rounded-md p-3">
        <div className="flex items-center justify-between">
          <div className="text-dq-gold">活动中心</div>
          <div className="text-sm text-[#a89478]">
            可领取 <span className="tabular-nums text-dq-gold">{claimable}</span> 项
          </div>
        </div>
        <div className="mt-1.5 text-[11px] leading-relaxed text-[#a89478]">
          活动由运营侧配置，无需更新客户端即会生效。达成条件后点「领取」到账；标注「每日」的活动次日 0 点重置。
        </div>
      </div>

      {list.length === 0 ? (
        <div className="dq-panel rounded-md p-6 text-center text-xs text-[#a89478]" data-act-empty>
          当前没有进行中的活动，过些时候再来看看
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map(a => <ActivityCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  )
}