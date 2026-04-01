import type { ThemeConfig } from "antd";

export const ADMIN_PREMIUM_THEME: ThemeConfig = {
  token: {
    colorPrimary: "#0f172a", // Shadcn uses Slate/Zinc dark colors for primary standard 
    colorInfo: "#0f172a",
    colorBgLayout: "#f8fafc", // Very soft slate layout background
    colorBgContainer: "#ffffff",
    colorText: "#0f172a",
    colorTextSecondary: "#64748b",
    colorBorder: "#e2e8f0",  // Crisp fine borders
    colorBorderSecondary: "#f1f5f9",
    borderRadius: 6, // Crucial! 6px is standard Shadcn radius, instead of Antd 12px
    borderRadiusSM: 4,
    borderRadiusLG: 8,
    controlHeight: 36, // Smaller inputs 
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    boxShadowSecondary: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  },
  components: {
    Button: {
      colorPrimary: "#0f172a",
      colorPrimaryHover: "#334155",
      colorPrimaryActive: "#020617",
      primaryShadow: "none",
      fontWeight: 500,
      paddingInlineSM: 12,
      paddingInline: 16,
      paddingInlineLG: 24,
      borderRadius: 6
    },
    Input: {
      activeBorderColor: "#0f172a",
      hoverBorderColor: "#94a3b8",
      activeShadow: "0 0 0 2px rgba(15, 23, 42, 0.1)", 
      errorActiveShadow: "0 0 0 2px rgba(220, 38, 38, 0.1)",
      paddingBlock: 6,
      paddingInline: 12
    },
    Select: {
      activeBorderColor: "#0f172a",
      hoverBorderColor: "#94a3b8",
      activeOutlineColor: "transparent",
      optionSelectedBg: "#f1f5f9"
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#475569",
      headerBorderRadius: 6,
      rowHoverBg: "#f8fafc",
      cellPaddingBlock: 12,
      cellPaddingInline: 16
    },
    Tabs: {
      itemColor: "#64748b",
      itemSelectedColor: "#0f172a",
      itemHoverColor: "#0f172a",
      inkBarColor: "#0f172a"
    },
    Card: {
      paddingLG: 20
    },
    Switch: {
      colorPrimary: "#0f172a",
      colorPrimaryHover: "#334155"
    }
  }
};
