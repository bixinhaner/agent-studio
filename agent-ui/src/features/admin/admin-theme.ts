import type { ThemeConfig } from "antd";

export const ADMIN_PREMIUM_THEME: ThemeConfig = {
  token: {
    colorPrimary: "#2458e8",
    colorInfo: "#2458e8",
    colorBgLayout: "#eef3f8",
    colorBgContainer: "rgba(255,255,255,0.82)",
    colorText: "#10203a",
    colorTextSecondary: "#5d6a7f",
    colorBorder: "rgba(128,145,168,0.22)",
    colorBorderSecondary: "rgba(148,163,184,0.16)",
    borderRadius: 18,
    borderRadiusSM: 14,
    borderRadiusLG: 24,
    controlHeight: 42,
    boxShadow: "0 16px 36px rgba(15, 23, 42, 0.08)",
    boxShadowSecondary: "0 26px 70px rgba(15, 23, 42, 0.12)",
    fontFamily:
      "'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Display', 'Segoe UI Variable Text', 'IBM Plex Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
  },
  components: {
    Button: {
      colorPrimary: "#2458e8",
      colorPrimaryHover: "#1d47c5",
      colorPrimaryActive: "#16389a",
      primaryShadow: "none",
      fontWeight: 600,
      paddingInlineSM: 14,
      paddingInline: 18,
      paddingInlineLG: 26,
      borderRadius: 999
    },
    Input: {
      activeBorderColor: "#2458e8",
      hoverBorderColor: "#8ca1c8",
      activeShadow: "0 0 0 4px rgba(36, 88, 232, 0.12)",
      errorActiveShadow: "0 0 0 4px rgba(220, 38, 38, 0.12)",
      paddingBlock: 8,
      paddingInline: 14
    },
    Select: {
      activeBorderColor: "#2458e8",
      hoverBorderColor: "#8ca1c8",
      activeOutlineColor: "transparent",
      optionSelectedBg: "rgba(36, 88, 232, 0.08)"
    },
    Table: {
      headerBg: "rgba(241,245,249,0.9)",
      headerColor: "#425168",
      headerBorderRadius: 16,
      rowHoverBg: "rgba(239,244,255,0.84)",
      cellPaddingBlock: 12,
      cellPaddingInline: 16
    },
    Tabs: {
      itemColor: "#5d6a7f",
      itemSelectedColor: "#10203a",
      itemHoverColor: "#10203a",
      inkBarColor: "#2458e8"
    },
    Card: {
      paddingLG: 24
    },
    Switch: {
      colorPrimary: "#2458e8",
      colorPrimaryHover: "#1d47c5"
    }
  }
};
