import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const launcher = "/usr/local/libexec/agent-studio-workload-launch";
const broker = "/usr/local/libexec/agent-studio-workload-guard";
const root = "/sys/fs/cgroup/system.slice/agent-studio-workloads.service";

// Must match memory.max written by scripts/agent-studio-workload-guard.py.
export const WORKLOAD_MEMORY_LIMIT_GIB = 8;
// Leave headroom for the app-server, shells and native buffers inside the job.
export const WORKLOAD_NODE_MAX_OLD_SPACE_MB = 6144;

// The kernel only kills the oversized command, so the agent survives and must
// recognise the SIGKILL as a memory-limit hit instead of retrying blindly.
export const WORKLOAD_MEMORY_HINT = [
  `Internal runtime guidance: this task runs under a hard ${WORKLOAD_MEMORY_LIMIT_GIB} GiB memory limit shared by every command you start, with no swap.`,
  `Never pass --max-old-space-size above ${WORKLOAD_NODE_MAX_OLD_SPACE_MB} to node, and do not raise NODE_OPTIONS memory limits; a larger heap does not add memory, it only turns a catchable "heap out of memory" error into a kernel kill.`,
  "If a command ends with exit code 137, \"Killed\", signal 9 or a JavaScript heap out of memory error, it hit the memory limit. Do not rerun it unchanged.",
  "Instead reduce peak memory: process data in batches or streams, write large outputs incrementally, avoid holding several copies of a large dataset at once, split one large workbook build into smaller steps, and stop finished background processes before starting new heavy ones.",
  "Tell the user briefly when you changed the approach because of the memory limit."
].join("\n");

export function workloadNodeOptions(current: string | undefined): string {
  const base = current?.trim() ?? "";
  if (/--max-old-space-size(=|\s)/.test(base)) return base;
  return [base, `--max-old-space-size=${WORKLOAD_NODE_MAX_OLD_SPACE_MB}`].filter(Boolean).join(" ");
}

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
