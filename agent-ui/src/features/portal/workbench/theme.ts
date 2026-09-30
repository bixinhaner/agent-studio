import { theme as antdTheme, type ThemeConfig } from "antd";

export function createPortalAntdTheme(
  primaryColor = "#FF4614",
  accentColor = "#FF833D",
  mode: "light" | "dark" = "light"
): ThemeConfig {
  const dark = mode === "dark";
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: primaryColor,
      colorPrimaryHover: accentColor,
      colorPrimaryActive: primaryColor,
      colorBgLayout: dark ? "#0f1115" : "#fafafa",
      colorBgContainer: dark ? "#171a21" : "#ffffff",
      colorBgElevated: dark ? "#1d2129" : "#ffffff",
      colorText: dark ? "#e7e9ee" : "#111827",
      colorTextSecondary: dark ? "#9aa3b2" : "#6b7280",
      colorBorder: dark ? "#2b303b" : "#e5e7eb",
      colorBorderSecondary: dark ? "#232833" : "#f3f4f6",
      borderRadius: 16,
      borderRadiusLG: 20,
      borderRadiusSM: 8,
      controlHeight: 40,
      motionDurationFast: "0.12s",
      motionDurationMid: "0.2s",
      motionDurationSlow: "0.32s",
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      boxShadow: dark ? "0 4px 20px rgba(0, 0, 0, 0.35)" : "0 4px 20px rgba(0, 0, 0, 0.04)",
      boxShadowSecondary: dark ? "0 12px 36px rgba(0, 0, 0, 0.45)" : "0 12px 36px rgba(0, 0, 0, 0.06)"
    },
    components: {
      Button: {
        controlHeight: 40,
        paddingInline: 16,
        defaultBorderColor: dark ? "#2b303b" : "#e5e7eb",
        defaultBg: dark ? "rgba(29, 33, 41, 0.9)" : "rgba(255, 255, 255, 0.8)"
      },
      Input: {
        colorBgContainer: dark ? "rgba(23, 26, 33, 0.9)" : "rgba(255, 255, 255, 0.8)",
        activeBorderColor: primaryColor,
        hoverBorderColor: accentColor
      },
      Modal: {
        contentBg: dark ? "rgba(29, 33, 41, 0.98)" : "rgba(255, 255, 255, 0.95)"
      }
    }
  };
}

export const PORTAL_ANTD_THEME: ThemeConfig = createPortalAntdTheme();
