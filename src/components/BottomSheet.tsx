import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * 手机端的底部弹窗（共享件）。
 *
 * 为什么是弹窗而不是"把面板缩排进页面"：手机上没有第二栏可用，而**一屏**是这个平台的硬约束
 * （用户 2026-09-21：「手机尺寸下所有页面都要要求一屏展示，不要做整体的下滑」）。
 * 面板留在文档流里 = 页面必然变高 = 必然整页竖滚。挪进弹窗，主屏就只剩"当前正在发生的事"，
 * 面板改由按钮唤出 —— 这也是移动端选择器的惯例。
 *
 * ⚠️ 弹窗**背后保留着主屏**（不是跳转到另一页）：玩家点开榜单时仍看得见盘面/战场与状态，
 *    跳走就把这个参照丢了。
 *
 * ⚠️ `hideOn` 是**兜底**，不是布局手段：两处调用方的断点不一样（战斗页 `sm`=640、
 *    世界 boss 页 `md`=768），共用一个写死的断点会让其中一页在该断点区间里
 *    既没有触发按钮、又留着一层能糊住布局的遮罩。传进来的值必须与**那一页**
 *    切换手机/桌面布局的断点一致。
 *    正常情况下面板根本不会亮：能打开它的按钮本身就带同一个断点前缀，早一起隐藏了。
 *
 * ⚠️ `max-h-[80vh]` 与内联的 `80dvh` 是**一对**：手机上 `vh` 是"地址栏收起"时的大视口，
 *    按它算 80% 会高过真正看得见的高度（就是 App 外壳 `100dvh` 那条注释里的病）。
 *    支持 dvh 的浏览器用内联值，不支持的把这条**无效声明丢掉**、退回类名上的 `80vh`。
 *    别改成只写类名：Tailwind 生成顺序不保证 `max-h-[80dvh]` 压得住 `max-h-[80vh]`。
 */
export default function BottomSheet({ title, onClose, children, hideOn = 'sm' }: {
  title: string
  onClose: () => void
  children: ReactNode
  hideOn?: 'sm' | 'md'
}) {
  return (
    <div className={`fixed inset-0 z-40 flex flex-col justify-end bg-black/70 ${hideOn === 'md' ? 'md:hidden' : 'sm:hidden'}`}
      onClick={onClose}>
      <div className="max-h-[80vh] overflow-auto rounded-t-xl border-t border-dq-border bg-dq-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ maxHeight: '80dvh' }}
        onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-dq-gold">{title}</span>
          <button onClick={onClose} aria-label="关闭" className="dq-tap inline-flex items-center justify-center rounded px-2 text-[#a89478] hover:text-dq-gold">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}