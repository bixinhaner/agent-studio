import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom"
  },
  server: {
    port: 5179,
    host: "0.0.0.0"
  }
});
