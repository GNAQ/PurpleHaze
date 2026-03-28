import type { ThemeConfig } from 'antd'
import { theme } from 'antd'
import { ph } from './tokens'

export const antdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // 主色
    colorPrimary: ph.purple500,
    colorSuccess: ph.green500,
    colorWarning: ph.warning,
    colorError: ph.error,
    // 文字
    colorTextBase: ph.dark.text,
    colorTextSecondary: ph.dark.textSec,
    // 边框
    colorBorder: 'rgba(188,115,173,0.20)',
    colorBorderSecondary: 'rgba(188,115,173,0.12)',
    colorSplit: 'rgba(188,115,173,0.10)',
    // 背景
    colorBgLayout: ph.dark.bg,
    colorBgContainer: ph.dark.surface1,
    colorBgElevated: ph.dark.surface3,
    colorBgSpotlight: ph.dark.surface2,
    // 圆角
    borderRadius: 10,
    borderRadiusSM: 6,
    borderRadiusLG: 14,
    // 链接
    colorLink: ph.purple400,
    colorLinkHover: ph.purple300,
    // 字体
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    fontFamilyCode: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    // 动效
    motionDurationMid: '0.25s',
    motionDurationSlow: '0.35s',
  },
  components: {
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(188,115,173,0.15)',
      darkItemSelectedColor: ph.purple400,
      darkItemHoverBg: 'rgba(188,115,173,0.08)',
      darkItemHoverColor: ph.purple300,
      itemHeight: 44,
      iconSize: 16,
    },
    Badge: {
      colorSuccess: ph.green500,
    },
    Tag: {
      colorSuccess: ph.green500,
      colorSuccessBg: 'rgba(117,193,129,0.12)',
      colorSuccessBorder: 'rgba(117,193,129,0.25)',
    },
    Tabs: {
      inkBarColor: ph.purple500,
      itemSelectedColor: ph.purple400,
      itemHoverColor: ph.purple300,
      cardBg: ph.dark.surface1,
    },
    Input: {
      activeBorderColor: ph.purple500,
      hoverBorderColor: ph.purple400,
      colorBgContainer: ph.dark.surface0,
    },
    Select: {
      optionSelectedBg: 'rgba(188,115,173,0.15)',
      colorBgContainer: ph.dark.surface0,
    },
    Collapse: {
      headerBg: 'transparent',
      contentBg: 'transparent',
    },
    Divider: {
      colorSplit: 'rgba(188,115,173,0.12)',
    },
    Table: {
      headerBg: ph.dark.surface0,
      rowHoverBg: 'rgba(188,115,173,0.06)',
      colorBgContainer: ph.dark.surface1,
      headerColor: ph.dark.textSec,
      borderColor: 'rgba(188,115,173,0.10)',
    },
    Card: {
      colorBgContainer: ph.dark.surface1,
      colorBorderSecondary: 'rgba(188,115,173,0.15)',
    },
    Modal: {
      contentBg: ph.dark.surface2,
      headerBg: ph.dark.surface2,
      titleColor: ph.dark.text,
    },
    Button: {
      primaryShadow: '0 2px 8px rgba(188,115,173,0.30)',
      defaultBg: ph.dark.surface0,
      defaultBorderColor: 'rgba(188,115,173,0.20)',
    },
    Form: {
      labelColor: ph.dark.textSec,
    },
    Descriptions: {
      labelBg: 'transparent',
      contentColor: ph.dark.text,
      titleColor: ph.dark.text,
    },
    Spin: {
      colorPrimary: ph.purple500,
    },
    Popconfirm: {
      colorWarning: ph.warning,
    },
  },
}
