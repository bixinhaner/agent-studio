import { existsSync } from "node:fs";
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), existsSync: vi.fn(() => false) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedWorkloadCommand, workloadScopeIdentity } from "./workload-isolation.js";

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
});
