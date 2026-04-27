import { spawn } from "child_process";
import { Codex as BaseCodex } from "@openai/codex-sdk";
import readline from "readline";

const INTERNAL_ORIGINATOR_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const TYPESCRIPT_SDK_ORIGINATOR = "codex_sdk_ts";
const PATCHED_EXEC_RUN = Symbol.for("agent-studio.codex-sdk.exec.run.patched");
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

type CodexConfigOverrides = Record<string, unknown>;

type PatchedExecArgs = {
  input: string;
  apiKey?: string;
  approvalPolicy?: string;
  additionalDirectories?: string[];
  baseUrl?: string;
  images?: string[];
  model?: string;
  modelReasoningEffort?: string;
  networkAccessEnabled?: boolean;
  outputSchemaFile?: string;
  sandboxMode?: string;
  signal?: AbortSignal;
  skipGitRepoCheck?: boolean;
  threadId?: string | null;
  webSearchEnabled?: boolean;
  webSearchMode?: string;
  workingDirectory?: string;
};

type PatchedExec = {
  executablePath?: string;
  envOverride?: Record<string, string>;
  configOverrides?: CodexConfigOverrides;
  run?(args: PatchedExecArgs): AsyncGenerator<string>;
  [PATCHED_EXEC_RUN]?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTomlKey(key: string): string {
  return TOML_BARE_KEY.test(key) ? key : JSON.stringify(key);
}

function toTomlValue(value: unknown, path: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Codex config override at ${path} must be a finite number`);
    }
    return `${value}`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => toTomlValue(item, `${path}[${index}]`)).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const parts: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      if (!key) {
        throw new Error("Codex config override keys must be non-empty strings");
      }
      if (child === undefined) continue;
      parts.push(`${formatTomlKey(key)} = ${toTomlValue(child, `${path}.${key}`)}`);
    }
    return `{${parts.join(", ")}}`;
  }
  if (value === null) {
    throw new Error(`Codex config override at ${path} cannot be null`);
  }
  throw new Error(`Unsupported Codex config override value at ${path}: ${typeof value}`);
}

function flattenConfigOverrides(value: unknown, prefix: string, overrides: string[]): void {
  if (!isPlainObject(value)) {
    if (!prefix) {
      throw new Error("Codex config overrides must be a plain object");
    }
    overrides.push(`${prefix}=${toTomlValue(value, prefix)}`);
    return;
  }

  const entries = Object.entries(value);
  if (!prefix && entries.length === 0) return;
  if (prefix && entries.length === 0) {
    overrides.push(`${prefix}={}`);
    return;
  }

  for (const [key, child] of entries) {
    if (!key) {
      throw new Error("Codex config override keys must be non-empty strings");
    }
    if (child === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child)) {
      flattenConfigOverrides(child, path, overrides);
      continue;
    }
    overrides.push(`${path}=${toTomlValue(child, path)}`);
  }
}

function serializeConfigOverrides(configOverrides: CodexConfigOverrides): string[] {
  const overrides: string[] = [];
  flattenConfigOverrides(configOverrides, "", overrides);
  return overrides;
}

async function* runPatchedExec(this: PatchedExec, args: PatchedExecArgs): AsyncGenerator<string> {
  const commandArgs = ["exec", "--experimental-json"];
  if (this.configOverrides) {
    for (const override of serializeConfigOverrides(this.configOverrides)) {
      commandArgs.push("--config", override);
    }
  }
  if (args.baseUrl) {
    commandArgs.push("--config", `openai_base_url=${toTomlValue(args.baseUrl, "openai_base_url")}`);
  }
  if (args.model) {
    commandArgs.push("--model", args.model);
  }
  if (args.sandboxMode) {
    commandArgs.push("--sandbox", args.sandboxMode);
  }
  if (args.workingDirectory) {
    commandArgs.push("--cd", args.workingDirectory);
  }
  if (args.additionalDirectories?.length) {
    for (const dir of args.additionalDirectories) {
      commandArgs.push("--add-dir", dir);
    }
  }
  if (args.skipGitRepoCheck) {
    commandArgs.push("--skip-git-repo-check");
  }
  if (args.outputSchemaFile) {
    commandArgs.push("--output-schema", args.outputSchemaFile);
  }
  if (args.modelReasoningEffort) {
    commandArgs.push("--config", `model_reasoning_effort="${args.modelReasoningEffort}"`);
  }
  if (args.networkAccessEnabled !== undefined) {
    commandArgs.push("--config", `sandbox_workspace_write.network_access=${args.networkAccessEnabled}`);
  }
  if (args.webSearchMode) {
    commandArgs.push("--config", `web_search="${args.webSearchMode}"`);
  } else if (args.webSearchEnabled === true) {
    commandArgs.push("--config", 'web_search="live"');
  } else if (args.webSearchEnabled === false) {
    commandArgs.push("--config", 'web_search="disabled"');
  }
  if (args.approvalPolicy) {
    commandArgs.push("--config", `approval_policy="${args.approvalPolicy}"`);
  }
  if (args.threadId) {
    // `codex exec resume` only reads the follow-up prompt from stdin when the
    // prompt positional is explicitly set to `-`.
    commandArgs.push("resume", args.threadId);
  }
  if (args.images?.length) {
    for (const image of args.images) {
      commandArgs.push("--image", image);
    }
  }
  if (args.threadId) {
    commandArgs.push("-");
  }

  const env: Record<string, string> = {};
  if (this.envOverride) {
    Object.assign(env, this.envOverride);
  } else {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }
  if (!env[INTERNAL_ORIGINATOR_ENV]) {
    env[INTERNAL_ORIGINATOR_ENV] = TYPESCRIPT_SDK_ORIGINATOR;
  }
  if (args.apiKey) {
    env.CODEX_API_KEY = args.apiKey;
  }

  const child = spawn(this.executablePath || "", commandArgs, {
    env,
    signal: args.signal
  });
  let spawnError: Error | null = null;
  child.once("error", (error) => {
    spawnError = error;
  });

  if (!child.stdin) {
    child.kill();
    throw new Error("Child process has no stdin");
  }
  child.stdin.write(args.input);
  child.stdin.end();

  if (!child.stdout) {
    child.kill();
    throw new Error("Child process has no stdout");
  }

  const stderrChunks: Buffer[] = [];
  if (child.stderr) {
    child.stderr.on("data", (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    });
  }

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      yield line;
    }
    if (spawnError) {
      throw spawnError;
    }
    const { code, signal } = await exitPromise;
    if (code !== 0 || signal) {
      const stderrBuffer = Buffer.concat(stderrChunks);
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      throw new Error(`Codex Exec exited with ${detail}: ${stderrBuffer.toString("utf8")}`);
    }
  } finally {
    rl.close();
    child.removeAllListeners();
    try {
      if (!child.killed) child.kill();
    } catch {
      // ignore cleanup errors
    }
  }
}

function patchCodexExec(exec: PatchedExec | undefined): void {
  if (!exec || exec[PATCHED_EXEC_RUN]) return;
  exec.run = runPatchedExec.bind(exec);
  exec[PATCHED_EXEC_RUN] = true;
}

export class Codex extends BaseCodex {
  constructor(options: ConstructorParameters<typeof BaseCodex>[0] = {}) {
    super(options);
    patchCodexExec((this as unknown as { exec?: PatchedExec }).exec);
  }
}
