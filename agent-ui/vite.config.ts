import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

type BuildVersionInfo = {
  version: 1;
  buildId: string;
  builtAt: string;
  gitSha: string | null;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readGitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function createBuildVersionInfo(): BuildVersionInfo {
  const gitSha = readGitSha();
  const builtAt = new Date().toISOString();
  const buildIdPrefix = gitSha ? gitSha.slice(0, 12) : "local";
  return {
    version: 1,
    buildId: `${buildIdPrefix}-${Date.now().toString(36)}`,
    builtAt,
    gitSha
  };
}

function buildVersionPlugin(info: BuildVersionInfo): Plugin {
  let outDir = "";
  return {
    name: "agent-studio-build-version",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (!outDir) return;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "version.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
    }
  };
}

function pruneOldAssetsPlugin(retentionDays: number): Plugin {
  let assetsDir = "";
  return {
    name: "agent-studio-prune-old-assets",
    apply: "build",
    configResolved(config) {
      assetsDir = path.join(config.build.outDir, "assets");
    },
    closeBundle() {
      if (!assetsDir || retentionDays <= 0 || !fs.existsSync(assetsDir)) return;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(assetsDir, entry.name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Best-effort cleanup only; a failed prune should not block deploy.
        }
      }
    }
  };
}

function assetRetentionDays(): number {
  const raw = process.env.AGENT_STUDIO_ASSET_RETENTION_DAYS?.trim();
  if (!raw) return 30;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
}

const buildVersionInfo = createBuildVersionInfo();

export default defineConfig({
  plugins: [react(), buildVersionPlugin(buildVersionInfo), pruneOldAssetsPlugin(assetRetentionDays())],
  define: {
    __AGENT_STUDIO_BUILD_ID__: JSON.stringify(buildVersionInfo.buildId)
  },
  build: {
    emptyOutDir: true,
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
