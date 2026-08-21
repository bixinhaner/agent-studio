import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type DwsUserIdentity = {
  agentStudioUserId: string;
  dingtalkCorpId?: string;
  dingtalkUserId: string;
};

export type DwsOutputEvent = {
  stream: "stdout" | "stderr";
  data: string;
};

export type PreparedDwsCommand = {
  args: string[];
  requiresIdentityCheck: boolean;
  validatesIdentityAfterRun: boolean;
};

type DwsCommandExecutorOptions = {
  binaryPath: string;
  bwrapPath: string;
  userHomeRoot: string;
  executionTimeoutMs?: number;
};

const execFileAsync = promisify(execFile);
const DEFAULT_EXECUTION_TIMEOUT_MS = 15 * 60_000;
const MAX_ARGUMENTS = 160;
const MAX_ARGUMENT_LENGTH = 32_000;

export const DWS_OFFICIAL_SKILL_NAMES = new Set([
  "dingtalk-aisearch",
  "dingtalk-aitable",
  "dingtalk-calendar",
  "dingtalk-chat",
  "dingtalk-contact",
  "dingtalk-doc",
  "dingtalk-drive",
  "dingtalk-event",
  "dingtalk-mail",
  "dingtalk-minutes",
  "dingtalk-misc",
  "dingtalk-shared",
  "dingtalk-todo",
  "dingtalk-wiki"
]);

const DWS_PRODUCT_COMMANDS = new Set([
  "agoal",
  "aisearch",
  "aitable",
  "approval",
  "attendance",
  "audit",
  "calendar",
  "chat",
  "contact",
  "devapp",
  "devdoc",
  "ding",
  "doc",
  "drive",
  "event",
  "hrbrain",
  "im",
  "live",
  "log",
  "mail",
  "markdown",
  "minutes",
  "oa",
  "pat",
  "recruit",
  "report",
  "sheet",
  "todo",
  "whiteboard",
  "wiki",
  "workbench"
]);

const SAFE_LOCAL_COMMANDS = new Set(["doctor", "help", "version"]);
const DISCOVERY_COMMANDS = new Set(["schema", "shortcut"]);
const BLOCKED_FLAGS = new Set([
  "--authorize-url",
  "--client-id",
  "--client-secret",
  "--debug",
  "--login-timeout",
  "--mcp-url",
  "--mock",
  "--pre-url",
  "--redirect-url",
  "--refresh-url",
  "--scopes",
  "--token-url",
  "--token"
]);
const GLOBAL_VALUE_FLAGS = new Set(["--fields", "--format", "--jq", "--profile", "--timeout", "-f"]);
const GLOBAL_BOOLEAN_FLAGS = new Set(["--dry-run", "--verbose", "--yes", "-v", "-y"]);

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validateArguments(args: string[]): void {
  if (args.length === 0) throw new Error("DWS command is required");
  if (args.length > MAX_ARGUMENTS) throw new Error("DWS command has too many arguments");
  for (const arg of args) {
    if (!arg || arg.includes("\0") || arg.length > MAX_ARGUMENT_LENGTH) {
      throw new Error("DWS command contains an invalid argument");
    }
    const flagName = arg.split("=", 1)[0];
    if (BLOCKED_FLAGS.has(flagName)) {
      throw new Error(`DWS flag is not available in Agent Studio: ${flagName}`);
    }
  }
}

function removeAndValidateProfile(args: string[], expectedProfile: string): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--profile") {
      const supplied = trimOrUndefined(args[index + 1]);
      if (!supplied) throw new Error("DWS --profile requires a value");
      if (supplied !== expectedProfile) {
        throw new Error("DWS profile must match the current Agent Studio user");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      const supplied = trimOrUndefined(arg.slice("--profile=".length));
      if (supplied !== expectedProfile) {
        throw new Error("DWS profile must match the current Agent Studio user");
      }
      continue;
    }
    normalized.push(arg);
  }
  return normalized;
}

function findRootCommandIndex(args: string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const flagName = arg.split("=", 1)[0];
    if (GLOBAL_BOOLEAN_FLAGS.has(flagName)) continue;
    if (GLOBAL_VALUE_FLAGS.has(flagName)) {
      if (!arg.includes("=")) index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unsupported DWS global flag before command: ${flagName}`);
    }
    return index;
  }
  throw new Error("DWS command is required");
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

export function prepareDwsCommand(
  args: string[],
  expectedProfile: string,
  options?: { bindProfile?: boolean; loginTargetCorpId?: string | null }
): PreparedDwsCommand {
  validateArguments(args);
  const normalizedProfile = trimOrUndefined(expectedProfile);
  if (!normalizedProfile || !normalizedProfile.includes(":")) {
    throw new Error("Current Agent Studio user has no usable DingTalk identity");
  }
  const normalizedArgs = removeAndValidateProfile(args, normalizedProfile);
  const rootIndex = findRootCommandIndex(normalizedArgs);
  const rootCommand = normalizedArgs[rootIndex].toLowerCase();
  const subcommand = trimOrUndefined(normalizedArgs[rootIndex + 1])?.toLowerCase();

  if (rootCommand === "auth") {
    if (!subcommand || !["login", "logout", "status"].includes(subcommand)) {
      throw new Error("Only DWS auth login, status, and logout are available in Agent Studio");
    }
    if (subcommand === "login") {
      const targetCorpId =
        options && "loginTargetCorpId" in options
          ? trimOrUndefined(options.loginTargetCorpId)
          : normalizedProfile.split(":", 1)[0];
      const commandArgs = [...normalizedArgs, ...(targetCorpId ? ["--profile", targetCorpId] : [])];
      if (!hasFlag(commandArgs, "--device")) commandArgs.push("--device");
      if (!hasFlag(commandArgs, "--no-browser")) commandArgs.push("--no-browser");
      if (!hasFlag(commandArgs, "--recommend")) commandArgs.push("--recommend");
      return {
        args: commandArgs,
        requiresIdentityCheck: false,
        validatesIdentityAfterRun: true
      };
    }
    if (subcommand === "status" && options?.bindProfile === false) {
      return {
        args: normalizedArgs,
        requiresIdentityCheck: false,
        validatesIdentityAfterRun: false
      };
    }
    const commandArgs = [...normalizedArgs, "--profile", normalizedProfile];
    return {
      args: commandArgs,
      requiresIdentityCheck: false,
      validatesIdentityAfterRun: false
    };
  }

  if (rootCommand === "profile") {
    if (subcommand !== "list" && subcommand !== "ls") {
      throw new Error("Only DWS profile list is available in Agent Studio");
    }
    return {
      args: normalizedArgs,
      requiresIdentityCheck: false,
      validatesIdentityAfterRun: false
    };
  }

  if (SAFE_LOCAL_COMMANDS.has(rootCommand)) {
    return {
      args: normalizedArgs,
      requiresIdentityCheck: false,
      validatesIdentityAfterRun: false
    };
  }

  if (!DWS_PRODUCT_COMMANDS.has(rootCommand) && !DISCOVERY_COMMANDS.has(rootCommand)) {
    throw new Error(`DWS command is not available in Agent Studio: ${rootCommand}`);
  }
  return {
    args: [...normalizedArgs, "--profile", normalizedProfile],
    requiresIdentityCheck: true,
    validatesIdentityAfterRun: false
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function profileListContainsIdentity(payload: unknown, corpId: string | undefined, userId: string): boolean {
  if (Array.isArray(payload)) {
    return payload.some((item) => profileListContainsIdentity(item, corpId, userId));
  }
  const record = asRecord(payload);
  if (!record) return false;
  if ((!corpId || trimOrUndefined(record.corpId) === corpId) && trimOrUndefined(record.userId) === userId) {
    return true;
  }
  return Object.values(record).some((value) => profileListContainsIdentity(value, corpId, userId));
}

type DwsProfileCandidate = {
  profile: string;
  corpId: string;
  userId: string;
  isCurrent: boolean;
  isOrgCurrent: boolean;
};

function collectProfileCandidates(payload: unknown, candidates: DwsProfileCandidate[] = []): DwsProfileCandidate[] {
  if (Array.isArray(payload)) {
    for (const item of payload) collectProfileCandidates(item, candidates);
    return candidates;
  }
  const record = asRecord(payload);
  if (!record) return candidates;
  const corpId = trimOrUndefined(record.corpId);
  const userId = trimOrUndefined(record.userId);
  const profile = trimOrUndefined(record.profile) ?? (corpId && userId ? `${corpId}:${userId}` : undefined);
  if (profile && corpId && userId) {
    candidates.push({
      profile,
      corpId,
      userId,
      isCurrent: record.isCurrent === true,
      isOrgCurrent: record.isOrgCurrent === true
    });
    return candidates;
  }
  for (const value of Object.values(record)) collectProfileCandidates(value, candidates);
  return candidates;
}

function requestedProfileFromArgs(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--profile") return trimOrUndefined(args[index + 1]);
    if (args[index].startsWith("--profile=")) return trimOrUndefined(args[index].slice("--profile=".length));
  }
  return undefined;
}

export function selectDwsProfile(
  payload: unknown,
  identity: Pick<DwsUserIdentity, "dingtalkCorpId" | "dingtalkUserId">,
  requestedProfile?: string
): DwsProfileCandidate | undefined {
  const matches = collectProfileCandidates(payload).filter(
    (candidate) =>
      candidate.userId === identity.dingtalkUserId &&
      (!identity.dingtalkCorpId || candidate.corpId === identity.dingtalkCorpId)
  );
  if (requestedProfile) {
    return matches.find((candidate) => candidate.profile === requestedProfile);
  }
  const orgCurrent = matches.filter((candidate) => candidate.isOrgCurrent);
  if (orgCurrent.length === 1) return orgCurrent[0];
  const current = matches.filter((candidate) => candidate.isCurrent);
  if (current.length === 1) return current[0];
  return matches.length === 1 ? matches[0] : undefined;
}

export function dwsUserHomePath(userHomeRoot: string, agentStudioUserId: string): string {
  const segment = createHash("sha256").update(agentStudioUserId).digest("hex").slice(0, 32);
  return path.join(path.resolve(userHomeRoot), segment);
}

export function buildDwsSandboxArguments(input: {
  binaryPath: string;
  userHome: string;
  workspacePath: string;
  dwsArgs: string[];
}): string[] {
  const guestBinary = "/opt/agent-studio-dws/dws";
  return [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
    "--clearenv",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--ro-bind-try",
    "/usr/lib",
    "/usr/lib",
    "--ro-bind-try",
    "/usr/share/zoneinfo",
    "/usr/share/zoneinfo",
    "--ro-bind-try",
    "/etc/ssl/certs",
    "/etc/ssl/certs",
    "--ro-bind-try",
    "/etc/resolv.conf",
    "/etc/resolv.conf",
    "--ro-bind-try",
    "/etc/hosts",
    "/etc/hosts",
    "--ro-bind-try",
    "/etc/nsswitch.conf",
    "/etc/nsswitch.conf",
    "--ro-bind-try",
    "/etc/passwd",
    "/etc/passwd",
    "--ro-bind-try",
    "/etc/group",
    "/etc/group",
    "--dir",
    "/opt",
    "--dir",
    "/opt/agent-studio-dws",
    "--ro-bind",
    path.resolve(input.binaryPath),
    guestBinary,
    "--dir",
    "/dws-home",
    "--bind",
    path.resolve(input.userHome),
    "/dws-home",
    "--dir",
    "/workspace",
    "--bind",
    path.resolve(input.workspacePath),
    "/workspace",
    "--chdir",
    "/workspace",
    "--setenv",
    "HOME",
    "/dws-home",
    "--setenv",
    "DWS_CONFIG_DIR",
    "/dws-home/.dws",
    "--setenv",
    "DWS_KEYCHAIN_DIR",
    "/dws-home/.local/share/dws-cli",
    "--setenv",
    "DWS_AGENT_PRODUCT",
    "agentstudio",
    "--setenv",
    "DWS_AGENT_HOST",
    "cloud",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--",
    guestBinary,
    ...input.dwsArgs
  ];
}

export class DwsCommandExecutor {
  private readonly options: Required<DwsCommandExecutorOptions>;
  private readonly activeUsers = new Set<string>();

  constructor(options: DwsCommandExecutorOptions) {
    this.options = {
      ...options,
      executionTimeoutMs: options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
    };
  }

  async isReady(): Promise<boolean> {
    const [binary, bwrap] = await Promise.all([
      fs.access(this.options.binaryPath).then(() => true, () => false),
      fs.access(this.options.bwrapPath).then(() => true, () => false)
    ]);
    return binary && bwrap;
  }

  async execute(input: {
    identity: DwsUserIdentity;
    workspacePath: string;
    args: string[];
    onOutput: (event: DwsOutputEvent) => void;
    signal?: AbortSignal;
  }): Promise<number> {
    const workspacePath = path.resolve(input.workspacePath);
    const workspaceStat = await fs.stat(workspacePath).catch(() => undefined);
    if (!workspaceStat?.isDirectory()) throw new Error("DWS workspace is unavailable");
    if (this.activeUsers.has(input.identity.agentStudioUserId)) {
      throw new Error("Another DWS command is already running for this user");
    }

    const userHome = dwsUserHomePath(this.options.userHomeRoot, input.identity.agentStudioUserId);
    await fs.mkdir(userHome, { recursive: true, mode: 0o700 });
    await fs.chmod(userHome, 0o700);

    this.activeUsers.add(input.identity.agentStudioUserId);
    try {
      const profileResolution = await this.resolveExpectedProfile({
        userHome,
        workspacePath,
        identity: input.identity,
        requestedProfile: requestedProfileFromArgs(input.args)
      });
      const selectedProfile = profileResolution.profile;
      const fallbackProfile = `${input.identity.dingtalkCorpId ?? "unbound"}:${input.identity.dingtalkUserId}`;
      const expectedProfile = selectedProfile?.profile ?? fallbackProfile;
      const prepared = prepareDwsCommand(input.args, expectedProfile, {
        bindProfile: Boolean(selectedProfile),
        loginTargetCorpId: input.identity.dingtalkCorpId ?? selectedProfile?.corpId ?? null
      });
      if (prepared.requiresIdentityCheck) {
        if (!selectedProfile) {
          if (profileResolution.hasMatchingIdentity) {
            throw new Error("检测到多个钉钉组织，请先执行 dws profile list，并在请求中明确要使用的组织 profile");
          }
          throw new Error("钉钉尚未授权，请先执行 dws auth login --device --recommend 完成设备授权");
        }
      }

      const exitCode = await this.runStreamed({
        userHome,
        workspacePath,
        args: prepared.args,
        onOutput: input.onOutput,
        signal: input.signal
      });
      if (exitCode === 0 && prepared.validatesIdentityAfterRun) {
        const connected = await this.resolveExpectedProfile({
          userHome,
          workspacePath,
          identity: input.identity
        });
        if (!connected.hasMatchingIdentity) {
          input.onOutput({
            stream: "stderr",
            data: "\n设备授权账号与当前 Agent Studio 用户不一致，请使用当前钉钉账号重新授权。\n"
          });
          return 1;
        }
      }
      return exitCode;
    } finally {
      this.activeUsers.delete(input.identity.agentStudioUserId);
    }
  }

  private async resolveExpectedProfile(input: {
    userHome: string;
    workspacePath: string;
    identity: DwsUserIdentity;
    requestedProfile?: string;
  }): Promise<{ profile?: DwsProfileCandidate; hasMatchingIdentity: boolean }> {
    const sandboxArgs = buildDwsSandboxArguments({
      binaryPath: this.options.binaryPath,
      userHome: input.userHome,
      workspacePath: input.workspacePath,
      dwsArgs: ["profile", "list", "--format", "json"]
    });
    try {
      const result = await execFileAsync(this.options.bwrapPath, sandboxArgs, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024
      });
      const payload = JSON.parse(result.stdout);
      return {
        profile: selectDwsProfile(payload, input.identity, input.requestedProfile),
        hasMatchingIdentity: profileListContainsIdentity(
          payload,
          input.identity.dingtalkCorpId,
          input.identity.dingtalkUserId
        )
      };
    } catch {
      return { hasMatchingIdentity: false };
    }
  }

  private runStreamed(input: {
    userHome: string;
    workspacePath: string;
    args: string[];
    onOutput: (event: DwsOutputEvent) => void;
    signal?: AbortSignal;
  }): Promise<number> {
    const sandboxArgs = buildDwsSandboxArguments({
      binaryPath: this.options.binaryPath,
      userHome: input.userHome,
      workspacePath: input.workspacePath,
      dwsArgs: input.args
    });
    return new Promise<number>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.options.bwrapPath, sandboxArgs, {
          stdio: ["ignore", "pipe", "pipe"]
        }) as ChildProcessWithoutNullStreams;
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let timedOut = false;
      const terminate = () => {
        if (!child.killed) child.kill("SIGTERM");
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        input.onOutput({ stream: "stderr", data: "\nDWS command timed out.\n" });
        terminate();
      }, this.options.executionTimeoutMs);
      const onAbort = () => terminate();
      input.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk) => input.onOutput({ stream: "stdout", data: String(chunk) }));
      child.stderr.on("data", (chunk) => input.onOutput({ stream: "stderr", data: String(chunk) }));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", onAbort);
        if (timedOut) {
          resolve(124);
          return;
        }
        if (input.signal?.aborted) {
          resolve(130);
          return;
        }
        resolve(typeof code === "number" ? code : signal ? 128 : 1);
      });
    });
  }
}
