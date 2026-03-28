/**
 * PurpleHaze Design System Tokens
 *
 * 主色基准：
 *   紫色  #bc73ad  — 低饱和兰花紫
 *   绿色  #75c181  — 柔和鼠尾草绿
 *
 * 深色主题：以 purple900 为基底，卡片/面板用半透明磨砂玻璃效果
 */

export const ph = {
  // ── 紫色族 ──────────────────────────────────────────────────────────────────
  purple900: '#1c0f28',
  purple800: '#3d1a5e',
  purple700: '#7a3b6e',
  purple600: '#a35595',
  purple500: '#bc73ad',   // Primary
  purple400: '#ce95c2',
  purple300: '#ddb8d5',
  purple200: '#ecdbea',
  purple100: '#f5edf4',
  purple50:  '#faf5f9',

  // ── 绿色族 ──────────────────────────────────────────────────────────────────
  green700: '#3d7a47',
  green600: '#52a05e',
  green500: '#75c181',   // Success / Connected / Running
  green400: '#98d1a2',
  green200: '#c8e8cc',
  green100: '#e8f5ea',
  green50:  '#f3fbf4',

  // ── 中性（带紫调的暖灰）────────────────────────────────────────────────────
  gray900: '#1f1b24',
  gray700: '#3d3542',
  gray600: '#5a5261',
  gray500: '#7d7484',
  gray400: '#9b94a3',
  gray200: '#e0dce4',
  gray100: '#f3f0f5',
  gray50:  '#f9f7fb',

  // ── 语义色 ──────────────────────────────────────────────────────────────────
  warning: '#e8a838',
  error:   '#e05363',

  // ── 深色主题专用 ────────────────────────────────────────────────────────────
  dark: {
    /** 页面最底层背景 */
    bg:        '#0b0811',
    /** 侧边栏/输入框背景 */
    surface0:  '#0f0c18',
    /** 卡片表面 */
    surface1:  '#171222',
    /** 悬浮/激活态 */
    surface2:  '#1f1930',
    /** 弹窗/浮层 */
    surface3:  '#2a2240',
    /** 边框 */
    border:    'rgba(188,115,173,0.15)',
    /** 分割线 */
    divider:   'rgba(188,115,173,0.10)',
    /** 主文本 */
    text:      '#e8e0ef',
    /** 二级文本 */
    textSec:   '#9b8fa8',
    /** 三级文本 */
    textTer:   '#6d6179',
    /** 代码/数据文本 */
    textCode:  '#c9b8d8',
  },

  // ── 玻璃效果 ────────────────────────────────────────────────────────────────
  glass: {
    bg:       'rgba(22,17,33,0.72)',
    bgHover:  'rgba(30,23,44,0.82)',
    border:   'rgba(188,115,173,0.18)',
    blur:     '16px',
    blurHeavy:'24px',
  },

  // ── 辉光 ────────────────────────────────────────────────────────────────────
  glow: {
    purple:  '0 0 20px rgba(188,115,173,0.25)',
    green:   '0 0 20px rgba(117,193,129,0.25)',
    error:   '0 0 20px rgba(224,83,99,0.25)',
    subtle:  '0 0 12px rgba(188,115,173,0.12)',
  },
} as const

export type PhColor = string

/** 5-level utilization color scale */
export function utilColor(pct: number): string {
  if (pct < 30) return ph.green500
  if (pct < 50) return '#a8d86c'
  if (pct < 70) return ph.warning
  if (pct < 85) return '#e07838'
  return ph.error
}

/** Temperature color: cool→warm gradient */
export function tempColor(celsius: number): string {
  if (celsius < 40) return ph.green500
  if (celsius < 55) return '#a8d86c'
  if (celsius < 70) return ph.warning
  if (celsius < 80) return '#e07838'
  return ph.error
}
