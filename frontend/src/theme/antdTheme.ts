import type { ThemeConfig } from 'antd'
import { theme } from 'antd'
import { ph, themeTokens } from './tokens'
import type { ThemeMode } from '../store/themeStore'

export function getAntdTheme(mode: ThemeMode): ThemeConfig {
  const t = themeTokens(mode)
  const isDark = mode === 'dark'

  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      // 主色
      colorPrimary: ph.purple500,
      colorSuccess: ph.green500,
      colorWarning: ph.warning,
      colorError: ph.error,
      // 文字
      colorTextBase: t.text,
      colorTextSecondary: t.textSec,
      // 边框
      colorBorder: t.border,
      colorBorderSecondary: isDark ? 'rgba(188,115,173,0.12)' : 'rgba(122,59,110,0.10)',
      colorSplit: t.divider,
      // 背景
      colorBgLayout: t.bg,
      colorBgContainer: t.surface1,
      colorBgElevated: t.surface3,
      colorBgSpotlight: t.surface2,
      // 圆角
      borderRadius: 10,
      borderRadiusSM: 6,
      borderRadiusLG: 14,
      // 链接
      colorLink: isDark ? ph.purple400 : ph.purple600,
      colorLinkHover: isDark ? ph.purple300 : ph.purple500,
      // 字体
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
      fontFamilyCode: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      // 动效
      motionDurationMid: '0.25s',
      motionDurationSlow: '0.35s',
    },
    components: {
      Menu: isDark ? {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(188,115,173,0.15)',
        darkItemSelectedColor: ph.purple400,
        darkItemHoverBg: 'rgba(188,115,173,0.08)',
        darkItemHoverColor: ph.purple300,
        itemHeight: 44,
        iconSize: 16,
      } : {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemSelectedBg: 'rgba(188,115,173,0.12)',
        itemSelectedColor: ph.purple700,
        itemHoverBg: 'rgba(188,115,173,0.06)',
        itemHoverColor: ph.purple600,
        itemHeight: 44,
        iconSize: 16,
      },
      Badge: {
        colorSuccess: ph.green500,
      },
      Tag: {
        colorSuccess: ph.green500,
        colorSuccessBg: isDark ? 'rgba(117,193,129,0.12)' : 'rgba(117,193,129,0.10)',
        colorSuccessBorder: isDark ? 'rgba(117,193,129,0.25)' : 'rgba(117,193,129,0.20)',
      },
      Tabs: {
        inkBarColor: ph.purple500,
        itemSelectedColor: isDark ? ph.purple400 : ph.purple700,
        itemHoverColor: isDark ? ph.purple300 : ph.purple600,
        cardBg: t.surface1,
      },
      Input: {
        activeBorderColor: ph.purple500,
        hoverBorderColor: ph.purple400,
        colorBgContainer: t.surface0,
      },
      Select: {
        optionSelectedBg: isDark ? 'rgba(188,115,173,0.15)' : 'rgba(188,115,173,0.10)',
        colorBgContainer: t.surface0,
      },
      Collapse: {
        headerBg: 'transparent',
        contentBg: 'transparent',
      },
      Divider: {
        colorSplit: t.divider,
      },
      Table: {
        headerBg: t.surface0,
        rowHoverBg: isDark ? 'rgba(188,115,173,0.06)' : 'rgba(188,115,173,0.04)',
        colorBgContainer: t.surface1,
        headerColor: t.textSec,
        borderColor: t.divider,
      },
      Card: {
        colorBgContainer: t.surface1,
        colorBorderSecondary: t.border,
      },
      Modal: {
        contentBg: t.surface2,
        headerBg: t.surface2,
        titleColor: t.text,
      },
      Button: {
        primaryShadow: isDark
          ? '0 2px 8px rgba(188,115,173,0.30)'
          : '0 2px 8px rgba(188,115,173,0.20)',
        defaultBg: t.surface0,
        defaultBorderColor: t.border,
      },
      Form: {
        labelColor: t.textSec,
      },
      Descriptions: {
        labelBg: 'transparent',
        contentColor: t.text,
        titleColor: t.text,
      },
      Spin: {
        colorPrimary: ph.purple500,
      },
      Popconfirm: {
        colorWarning: ph.warning,
      },
    },
  }
}

/** @deprecated Use getAntdTheme(mode) instead */
export const antdTheme = getAntdTheme('dark')
