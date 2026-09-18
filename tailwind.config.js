/**
 * 焚炎异录 · 设计令牌（v1.44 美术体系）
 *
 * 定调：**玄墨底 + 鎏金线 + 火纹光**。
 *   · 底（墨） 三层纵深：`bg` 最远 → `ink` 面板 → `ink2` 内嵌槽位
 *   · 线（金） 三档明度：`goldDim` 暗纹 → `gold` 主色 → `goldBright` 高光
 *   · 光（火） 两档：`fire` 主色 → `fireDeep` 阴影侧
 *   · 辅助      `qing` 治疗/成功；品阶色见 `game/data.ts` 的 `RARITY_INFO`
 *
 * ⚠️ 本次是**纯扩充**：`bg / panel / border / gold / fire / qing` 六个既有键
 * 的**取值一分未动** —— 全站 460 余处 `text-dq-gold` / `border-dq-border` 的
 * 语义与观感都保持不变，新键只用来做新的层次。改既有键的值 = 一次性改掉全站配色，
 * 那是另一件事，不该混在这次里做。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dq: {
          // ── 既有六键（取值冻结，勿改）──
          bg: '#0c0806',
          panel: '#1a1310',
          border: '#3a2a1a',
          gold: '#e8b04a',
          fire: '#ff6a1a',
          qing: '#2fb37e',

          // ── 纵深层次（新）──
          ink: '#0e0907',        // 比 bg 略亮：页面"地面"
          ink2: '#120c09',       // 内嵌槽位（输入框、空槽、血条底）
          panel2: '#241a13',     // 面板顶部受光面
          border2: '#5a4228',    // 提亮描边（悬停、选中态）
          borderIn: '#0a0605',   // 内描边（让面板"有厚度"）

          // ── 鎏金三档（新）──
          goldDim: '#8a6a2e',    // 暗纹、分隔线、未激活
          goldBright: '#ffd98a', // 高光、强调数字
          goldInk: '#3a2a12',    // 金字压在浅底时的衬色

          // ── 火纹（新）──
          fireDeep: '#b83a0e',   // 火的阴影侧
          ember: '#ffb066',      // 火星、余烬

          // ── 辅助（新）──
          qingDim: '#1d6b4c',
        },
      },
      /**
       * 圆角：全站此前几乎只有 `rounded`（4px）/ `rounded-none`。
       * 面板给 10px、按钮给 8px、小标签给 4px —— 统一收在这里，
       * 免得每个组件各写各的数字（那正是"没有体系"的样子）。
       */
      borderRadius: {
        dq: '6px',
        dqLg: '10px',
        dqXl: '14px',
      },
      /**
       * 阴影：分**面板抬起**与**金属描边**两类。
       * 面板阴影一定是"内高光 + 内暗线 + 外投影"三层叠加 ——
       * 只写外投影的面板看着像贴纸，有内高光才有厚度。
       */
      boxShadow: {
        dqPanel: 'inset 0 1px 0 rgba(255,214,140,0.13), inset 0 0 0 1px rgba(8,5,4,0.85), 0 3px 10px rgba(0,0,0,0.5)',
        dqRaise: 'inset 0 1px 0 rgba(255,214,140,0.20), inset 0 0 0 1px rgba(8,5,4,0.85), 0 10px 26px -8px rgba(0,0,0,0.85)',
        dqGold: '0 0 0 1px rgba(232,176,74,0.55), 0 0 14px -2px rgba(232,176,74,0.35)',
        dqFire: '0 0 0 1px rgba(255,106,26,0.6), 0 0 18px -2px rgba(255,106,26,0.45)',
        dqIn: 'inset 0 2px 6px rgba(0,0,0,0.75), inset 0 -1px 0 rgba(255,214,140,0.06)',
        dqBtn: 'inset 0 1px 0 rgba(255,214,140,0.22), 0 2px 0 rgba(8,5,4,0.9), 0 4px 10px -3px rgba(0,0,0,0.7)',
      },
      /**
       * 标题字栈：正文继续用系统无衬线（中文衬线在低端安卓上缺字回退很丑），
       * 只有**大标题**用衬线 —— 宋体/明体的横细竖粗正是"古卷"的味道。
       */
      fontFamily: {
        dqTitle: ['"Songti SC"', '"SimSun"', '"Noto Serif SC"', 'serif'],
      },
      keyframes: {
        'dq-rise': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'dq-sheen': {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
      },
      animation: {
        'dq-rise': 'dq-rise 260ms cubic-bezier(0.2, 0.8, 0.25, 1) both',
        'dq-sheen': 'dq-sheen 900ms ease-out',
      },
    },
  },
  plugins: [],
}