/**
 * PurpleHaze Design System Tokens
 *
 * 主色基准：
 *   紫色  #bc73ad  — 低饱和兰花紫
 *   绿色  #75c181  — 柔和鼠尾草绿
 *
 * 支持深色/浅色主题，通过 themeTokens(mode) 获取当前主题的语义色
 */

import type { ThemeMode } from '../store/themeStore'

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

  // ── 浅色主题专用 ────────────────────────────────────────────────────────────
  light: {
    /** 页面最底层背景 */
    bg:        '#f6f3f9',
    /** 侧边栏/输入框背景 */
    surface0:  '#eee9f3',
    /** 卡片表面 */
    surface1:  '#ffffff',
    /** 悬浮/激活态 */
    surface2:  '#f0ecf5',
    /** 弹窗/浮层 */
    surface3:  '#ffffff',
    /** 边框 */
    border:    'rgba(122,59,110,0.15)',
    /** 分割线 */
    divider:   'rgba(122,59,110,0.10)',
    /** 主文本 */
    text:      '#2a2035',
    /** 二级文本 */
    textSec:   '#6d6179',
    /** 三级文本 */
    textTer:   '#9b94a3',
    /** 代码/数据文本 */
    textCode:  '#5a3d6e',
  },

  // ── 玻璃效果 ────────────────────────────────────────────────────────────────
  glass: {
    bg:       'rgba(22,17,33,0.72)',
    bgHover:  'rgba(30,23,44,0.82)',
    border:   'rgba(188,115,173,0.18)',
    blur:     '16px',
    blurHeavy:'24px',
  },

  glassLight: {
    bg:       'rgba(255,255,255,0.72)',
    bgHover:  'rgba(255,255,255,0.85)',
    border:   'rgba(122,59,110,0.12)',
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

  glowLight: {
    purple:  '0 4px 16px rgba(188,115,173,0.15)',
    green:   '0 4px 16px rgba(117,193,129,0.15)',
    error:   '0 4px 16px rgba(224,83,99,0.15)',
    subtle:  '0 2px 8px rgba(188,115,173,0.08)',
  },
} as const

/** Resolved semantic theme tokens — use via useThemeTokens() hook or themeTokens(mode) */
export interface ThemeTokens {
  bg: string
  surface0: string
  surface1: string
  surface2: string
  surface3: string
  border: string
  divider: string
  text: string
  textSec: string
  textTer: string
  textCode: string
  glassBg: string
  glassBgHover: string
  glassBorder: string
  glassBlur: string
  glowPurple: string
  glowGreen: string
  glowError: string
  glowSubtle: string
  /** Hover tint for interactive elements */
  hoverTint: string
  /** Active/selected tint */
  activeTint: string
  /** Header/sidebar background */
  chromeAlpha: string
}

export function themeTokens(mode: ThemeMode): ThemeTokens {
  if (mode === 'dark') {
    return {
      ...ph.dark,
      glassBg: ph.glass.bg,
      glassBgHover: ph.glass.bgHover,
      glassBorder: ph.glass.border,
      glassBlur: ph.glass.blur,
      glowPurple: ph.glow.purple,
      glowGreen: ph.glow.green,
      glowError: ph.glow.error,
      glowSubtle: ph.glow.subtle,
      hoverTint: 'rgba(188,115,173,0.06)',
      activeTint: 'rgba(188,115,173,0.10)',
      chromeAlpha: 'rgba(11,8,17,0.88)',
    }
  }
  return {
    ...ph.light,
    glassBg: ph.glassLight.bg,
    glassBgHover: ph.glassLight.bgHover,
    glassBorder: ph.glassLight.border,
    glassBlur: ph.glassLight.blur,
    glowPurple: ph.glowLight.purple,
    glowGreen: ph.glowLight.green,
    glowError: ph.glowLight.error,
    glowSubtle: ph.glowLight.subtle,
    hoverTint: 'rgba(122,59,110,0.05)',
    activeTint: 'rgba(122,59,110,0.08)',
    chromeAlpha: 'rgba(255,255,255,0.85)',
  }
}

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
