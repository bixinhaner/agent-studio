import type { ThemeConfig } from "antd";

export const PORTAL_ANTD_THEME: ThemeConfig = {
  token: {
    colorPrimary: "#FF4614",
    colorPrimaryHover: "#FA5C32",
    colorPrimaryActive: "#E63B0F",
    colorBgLayout: "#fafafa",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorText: "#111827",
    colorTextSecondary: "#6b7280",
    colorBorder: "#e5e7eb",
    colorBorderSecondary: "#f3f4f6",
    borderRadius: 16,
    borderRadiusLG: 20,
    borderRadiusSM: 8,
    controlHeight: 40,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
    boxShadowSecondary: "0 12px 36px rgba(0, 0, 0, 0.06)",
  },
  components: {
    Button: {
      controlHeight: 40,
      paddingInline: 16,
      defaultBorderColor: "#e5e7eb",
      defaultBg: "rgba(255, 255, 255, 0.8)",
    },
    Input: {
      colorBgContainer: "rgba(255, 255, 255, 0.8)",
      activeBorderColor: "#FF4614",
      hoverBorderColor: "rgba(255, 70, 20, 0.4)",
    },
    Modal: {
      contentBg: "rgba(255, 255, 255, 0.95)",
    },
  }
};
