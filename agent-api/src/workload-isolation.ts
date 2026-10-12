import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const launcher = "/usr/local/libexec/agent-studio-workload-launch";
const broker = "/usr/local/libexec/agent-studio-workload-guard";
const root = "/sys/fs/cgroup/system.slice/agent-studio-workloads.service";

export function workloadIsolationRequired(): boolean {
  return process.env.AGENT_STUDIO_WORKLOAD_ISOLATION === "required";
}

export function workloadScopeIdentity(identity: string): string | undefined {
  return workloadIsolationRequired() ? identity : undefined;
}

export function isolatedWorkloadCommand(binary: string, args: string[]) {
  if (!workloadIsolationRequired()) return { command: binary, args, id: undefined };
  if (process.platform !== "linux" || !existsSync(launcher)) {
    throw new Error("Workload isolation is unavailable; refusing unbounded execution");
  }
  const id = randomUUID().replaceAll("-", "");
  return { command: launcher, args: [id, binary, ...args], id };
}

export function workloadOutOfMemory(id: string | undefined): boolean {
  if (!id) return false;
  try {
    return /^oom_kill [1-9][0-9]*$/m.test(readFileSync(`${root}/job-${id}/memory.events`, "utf8"));
  } catch {
    return false;
  }
}

export async function releaseWorkload(id: string | undefined): Promise<void> {
  if (!id) return;
  await execFileAsync("/usr/bin/sudo", ["-n", broker, "release", id], { timeout: 10_000 });
}
