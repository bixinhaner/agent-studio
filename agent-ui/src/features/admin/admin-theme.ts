import type { ThemeConfig } from "antd";

export const ADMIN_PREMIUM_THEME: ThemeConfig = {
  token: {
    colorPrimary: "#0066ff",
    colorInfo: "#0066ff",
    colorBgLayout: "#f3f4f6", // var(--admin-color-bg)
    colorBgContainer: "#ffffff",
    colorText: "#111827",
    colorTextSecondary: "#6b7280",
    colorBorder: "rgba(0, 0, 0, 0.08)",
    colorBorderSecondary: "rgba(0, 0, 0, 0.04)",
    borderRadius: 12, // More rounded, modern style
    borderRadiusSM: 8,
    borderRadiusLG: 16,
    controlHeight: 40,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    boxShadowSecondary: "0 4px 12px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.03)",
    fontFamily:
      "'PingFang SC', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
  },
  components: {
    Button: {
      colorPrimary: "#0066ff",
      colorPrimaryHover: "#005ce6",
      colorPrimaryActive: "#0052cc",
      primaryShadow: "none",
      fontWeight: 500,
      paddingInlineSM: 12,
      paddingInline: 16,
      paddingInlineLG: 24,
      borderRadius: 8
    },
    Input: {
      activeBorderColor: "#0066ff",
      hoverBorderColor: "rgba(0, 102, 255, 0.5)",
      activeShadow: "0 0 0 3px rgba(0, 102, 255, 0.1)",
      errorActiveShadow: "0 0 0 3px rgba(220, 38, 38, 0.1)",
      paddingBlock: 8,
      paddingInline: 12,
      borderRadius: 8
    },
    Select: {
      activeBorderColor: "#0066ff",
      hoverBorderColor: "rgba(0, 102, 255, 0.5)",
      activeOutlineColor: "transparent",
      optionSelectedBg: "rgba(0, 102, 255, 0.08)",
      borderRadius: 8
    },
    Table: {
      headerBg: "#f9fafb",
      headerColor: "#4b5563",
      headerBorderRadius: 12,
      rowHoverBg: "#f3f4f6",
      cellPaddingBlock: 12,
      cellPaddingInline: 16
    },
    Tabs: {
      itemColor: "#6b7280",
      itemSelectedColor: "#111827",
      itemHoverColor: "#111827",
      inkBarColor: "#0066ff",
      titleFontSize: 14
    },
    Card: {
      paddingLG: 24,
      borderRadiusLG: 16
    },
    Switch: {
      colorPrimary: "#34c759", // Apple-like green for toggle
      colorPrimaryHover: "#30b753"
    },
    Breadcrumb: {
      linkColor: "#6b7280",
      linkHoverColor: "#111827",
      separatorColor: "#9ca3af"
    }
  }
};
