import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf("node_modules") >= 0) {
            if (id.indexOf("antd") >= 0 || id.indexOf("@ant-design") >= 0) return "vendor-antd";
            if (id.indexOf("@assistant-ui") >= 0) return "vendor-assistant-ui";
            return undefined;
          }
          return undefined;
        }
      }
    }
  },
  test: {
    environment: "jsdom"
  },
  server: {
    port: 5179,
    host: "0.0.0.0"
  }
});
