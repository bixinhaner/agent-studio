import { existsSync } from "node:fs";
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), existsSync: vi.fn(() => false) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  isolatedWorkloadCommand,
  WORKLOAD_MEMORY_HINT,
  WORKLOAD_MEMORY_LIMIT_GIB,
  WORKLOAD_NODE_MAX_OLD_SPACE_MB,
  workloadNodeOptions,
  workloadScopeIdentity
} from "./workload-isolation.js";

afterEach(() => { vi.unstubAllEnvs(); vi.mocked(existsSync).mockReturnValue(false); });

describe("workload isolation", () => {
  it("leaves local development commands unchanged", () => {
    vi.stubEnv("AGENT_STUDIO_WORKLOAD_ISOLATION", "");
    expect(isolatedWorkloadCommand("codex", ["app-server"]))
      .toEqual({ command: "codex", args: ["app-server"], id: undefined });
    expect(workloadScopeIdentity("thread-a")).toBeUndefined();
  });
  it("does not share a process between different tasks when isolation is required", () => {
    vi.stubEnv("AGENT_STUDIO_WORKLOAD_ISOLATION", "required");
    expect(workloadScopeIdentity("thread-a")).toBe("thread-a");
    expect(workloadScopeIdentity("thread-b")).not.toBe(workloadScopeIdentity("thread-a"));
  });
  it("fails closed when the required Linux launcher is unavailable", () => {
    vi.stubEnv("AGENT_STUDIO_WORKLOAD_ISOLATION", "required");
    // The developer/test host does not have the production root-owned launcher.
    expect(() => isolatedWorkloadCommand("codex", ["app-server"]))
      .toThrow("refusing unbounded execution");
  });
  it("caps the Node heap below the job limit without overriding an explicit cap", () => {
    expect(workloadNodeOptions(undefined)).toBe(`--max-old-space-size=${WORKLOAD_NODE_MAX_OLD_SPACE_MB}`);
    expect(workloadNodeOptions("--enable-source-maps")).toBe(`--enable-source-maps --max-old-space-size=${WORKLOAD_NODE_MAX_OLD_SPACE_MB}`);
    expect(workloadNodeOptions("--max-old-space-size=2048")).toBe("--max-old-space-size=2048");
    expect(WORKLOAD_NODE_MAX_OLD_SPACE_MB).toBeLessThan(WORKLOAD_MEMORY_LIMIT_GIB * 1024);
  });
  it("tells the agent how to recognise and recover from a memory-limit kill", () => {
    expect(WORKLOAD_MEMORY_HINT).toContain(`${WORKLOAD_MEMORY_LIMIT_GIB} GiB`);
    expect(WORKLOAD_MEMORY_HINT).toContain(`--max-old-space-size above ${WORKLOAD_NODE_MAX_OLD_SPACE_MB}`);
    expect(WORKLOAD_MEMORY_HINT).toContain("exit code 137");
    expect(WORKLOAD_MEMORY_HINT).toContain("Do not rerun it unchanged");
  });
  it("keeps the hinted limit in sync with the cgroup broker", () => {
    const guard = readFileSync(new URL("../../scripts/agent-studio-workload-guard.py", import.meta.url), "utf8");
    expect(guard).toContain(`write(group / "memory.max", ${WORKLOAD_MEMORY_LIMIT_GIB} * GIB)`);
    // The app-server must survive an oversized command so the agent can retry.
    expect(guard).toContain('write(group / "memory.oom.group", 0)');
  });
});
