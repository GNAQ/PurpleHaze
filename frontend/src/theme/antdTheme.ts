import type { ThemeConfig } from 'antd'
import { ph } from './tokens'

export const antdTheme: ThemeConfig = {
  token: {
    // 主色：兰花紫
    colorPrimary: ph.purple500,
    // 成功：鼠尾草绿
    colorSuccess: ph.green500,
    // 警告 / 错误
    colorWarning: ph.warning,
    colorError: ph.error,
    // 文字
    colorTextBase: ph.gray700,
    colorTextSecondary: ph.gray500,
    // 边框 / 分割线
    colorBorder: ph.gray200,
    colorBorderSecondary: ph.gray200,
    colorSplit: ph.gray200,
    // 背景
    colorBgLayout: ph.gray100,
    colorBgContainer: '#ffffff',
    // 圆角
    borderRadius: 8,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    // 链接
    colorLink: ph.purple600,
    colorLinkHover: ph.purple500,
    // 字体（与 index.css 保持一致）
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  },
  components: {
    // ── 侧边菜单 ──────────────────────────────────────────────────────────────
    Menu: {
      itemSelectedBg: ph.purple100,
      itemSelectedColor: ph.purple500,
      itemHoverBg: ph.purple50,
      itemHoverColor: ph.purple600,
      itemActiveBg: ph.purple100,
    },
    // ── Badge（运行态用绿色） ──────────────────────────────────────────────────
    Badge: {
      colorSuccess: ph.green500,
    },
    // ── Tag ───────────────────────────────────────────────────────────────────
    Tag: {
      colorSuccess: ph.green500,
      colorSuccessBg: ph.green100,
      colorSuccessBorder: ph.green200,
    },
    // ── Tabs ──────────────────────────────────────────────────────────────────
    Tabs: {
      inkBarColor: ph.purple500,
      itemSelectedColor: ph.purple500,
      itemHoverColor: ph.purple600,
    },
    // ── Input ─────────────────────────────────────────────────────────────────
    Input: {
      activeBorderColor: ph.purple500,
      hoverBorderColor: ph.purple400,
    },
    // ── Select ────────────────────────────────────────────────────────────────
    Select: {
      optionSelectedBg: ph.purple100,
    },
    // ── Collapse ─────────────────────────────────────────────────────────────
    Collapse: {
      headerBg: 'transparent',
    },
    // ── Divider ───────────────────────────────────────────────────────────────
    Divider: {
      colorSplit: ph.gray200,
    },
    // ── Table ─────────────────────────────────────────────────────────────────
    Table: {
      headerBg: ph.purple50,
      rowHoverBg: ph.purple50,
    },
    // ── Card ──────────────────────────────────────────────────────────────────
    Card: {
      colorBorderSecondary: ph.gray200,
    },
    // ── Modal ─────────────────────────────────────────────────────────────────
    Modal: {
      titleColor: ph.gray700,
    },
  },
}
