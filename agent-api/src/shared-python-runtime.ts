import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { appConfig } from "./config.js";
import type { SystemSettingsPythonRuntime } from "./system-settings/types.js";

const execFileAsync = promisify(execFile);

export type SharedPythonRuntimePaths = {
  runtimeRoot: string;
  pipCacheRoot: string;
  argosPackageRoot: string;
  argosDownloadRoot: string;
};

export type SharedPythonRuntimeCapabilityStatus = {
  key: "spreadsheets" | "documents" | "images" | "translation";
  label: string;
  status: "ready" | "partial" | "missing";
  available: string[];
  missing: string[];
};

export type SharedPythonRuntimeStatus = {
  enabled: boolean;
  runtimeExists: boolean;
  runtimeBytes: number;
  pythonVersion?: string;
  envKeys: string[];
  capabilities: SharedPythonRuntimeCapabilityStatus[];
  duplicateArtifacts: {
    sessionVirtualenvCount: number;
    argosCacheCount: number;
    argosDataCount: number;
    scanned: boolean;
  };
  checkedAt: string;
};

type CapabilityDefinition = {
  key: SharedPythonRuntimeCapabilityStatus["key"];
  label: string;
  packages: Array<{ importName: string; displayName: string; pathSegments?: string[] }>;
};

const CAPABILITIES: CapabilityDefinition[] = [
  {
    key: "spreadsheets",
    label: "表格处理",
    packages: [
      { importName: "pandas", displayName: "表格分析" },
      { importName: "openpyxl", displayName: "Excel 读写" }
    ]
  },
  {
    key: "documents",
    label: "PDF / Word / PPT",
    packages: [
      { importName: "docx", displayName: "Word 处理" },
      { importName: "pptx", displayName: "PPT 处理" },
      { importName: "pypdf", displayName: "PDF 解析" },
      { importName: "fitz", displayName: "PDF 渲染", pathSegments: ["fitz"] }
    ]
  },
  {
    key: "images",
    label: "图片处理",
    packages: [
      { importName: "PIL", displayName: "图片读写", pathSegments: ["PIL"] }
    ]
  },
  {
    key: "translation",
    label: "离线翻译",
    packages: [
      { importName: "argostranslate", displayName: "Argos 翻译" },
      { importName: "ctranslate2", displayName: "翻译推理" },
      { importName: "sentencepiece", displayName: "分词模型" }
    ]
  }
];

export function defaultPythonRuntimeSettings(): SystemSettingsPythonRuntime {
  return {
    enabled: true,
    injectRuntimeHint: true,
    preferSharedPackages: true,
    sessionTmpEnabled: true,
    cleanupSessionArtifactsOlderThanDays: 14
  };
}

export function effectivePythonRuntimeSettings(
  settings: SystemSettingsPythonRuntime | undefined
): SystemSettingsPythonRuntime {
  return {
    ...defaultPythonRuntimeSettings(),
    ...(settings ?? {})
  };
}

export function sharedPythonRuntimePaths(): SharedPythonRuntimePaths {
  return appConfig.sharedPythonRuntime;
}

function prependPath(value: string, existing?: string): string {
  const current = (existing || "").trim();
  if (!current) return value;
  const parts = current.split(path.delimiter).filter(Boolean);
  return parts.includes(value) ? current : [value, ...parts].join(path.delimiter);
}

export function workspaceTmpDir(workspace?: string): string | undefined {
  const normalized = workspace?.trim();
  return normalized ? path.join(normalized, ".agent-studio", "tmp") : undefined;
}

export async function ensureRuntimeWorkspaceTmp(workspace?: string): Promise<string | undefined> {
  const tmpDir = workspaceTmpDir(workspace);
  if (!tmpDir) return undefined;
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

export function buildSharedPythonRuntimeEnv(input: {
  settings?: SystemSettingsPythonRuntime;
  paths?: SharedPythonRuntimePaths;
  workspace?: string;
  baseEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Record<string, string> {
  const settings = effectivePythonRuntimeSettings(input.settings);
  if (!settings.enabled) return {};

  const paths = input.paths ?? sharedPythonRuntimePaths();
  const baseEnv = input.baseEnv ?? process.env;
  const env: Record<string, string> = {
    AGENT_STUDIO_SHARED_PYTHON_RUNTIME: "1",
    PYTHONPATH: prependPath(paths.runtimeRoot, baseEnv.PYTHONPATH),
    PIP_CACHE_DIR: paths.pipCacheRoot,
    ARGOS_PACKAGE_DIR: paths.argosPackageRoot,
    ARGOS_DOWNLOAD_DIR: paths.argosDownloadRoot
  };
  if (settings.sessionTmpEnabled) {
    const tmpDir = workspaceTmpDir(input.workspace);
    if (tmpDir) {
      env.TMPDIR = tmpDir;
      env.TEMP = tmpDir;
      env.TMP = tmpDir;
    }
  }
  return env;
}

export function sharedPythonRuntimeHint(settings: SystemSettingsPythonRuntime | undefined): string | undefined {
  const effective = effectivePythonRuntimeSettings(settings);
  if (!effective.enabled || !effective.injectRuntimeHint) return undefined;
  if (!effective.preferSharedPackages) return undefined;
  return [
    "内部运行提示：共享 Python Runtime 已通过环境变量注入。",
    "执行 Python、文档、表格、图片或翻译任务时，优先直接使用已可 import 的共享包。",
    "不要为常见库创建会话级 virtualenv 或重复 pip install；只有共享运行时缺少任务必需依赖时才创建临时隔离环境。"
  ].join("\n");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function duBytes(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("du", ["-sk", "--", filePath], { timeout: 5000, maxBuffer: 1024 * 32 });
    const value = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value * 1024 : 0;
  } catch {
    return 0;
  }
}

async function pythonVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("python3", ["--version"], { timeout: 3000, maxBuffer: 1024 * 8 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function packagePath(runtimeRoot: string, importName: string, pathSegments?: string[]): string {
  return path.join(runtimeRoot, ...(pathSegments ?? importName.split(".")));
}

async function capabilityStatus(
  runtimeRoot: string,
  definition: CapabilityDefinition
): Promise<SharedPythonRuntimeCapabilityStatus> {
  const results = await Promise.all(
    definition.packages.map(async (item) => ({
      item,
      ok: await exists(packagePath(runtimeRoot, item.importName, item.pathSegments))
    }))
  );
  const available = results.filter((result) => result.ok).map((result) => result.item.displayName);
  const missing = results.filter((result) => !result.ok).map((result) => result.item.displayName);
  return {
    key: definition.key,
    label: definition.label,
    status: missing.length === 0 ? "ready" : available.length > 0 ? "partial" : "missing",
    available,
    missing
  };
}

async function countFindMatches(args: string[]): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("find", args, { timeout: 5000, maxBuffer: 1024 * 128 });
    return stdout.split(/\n/).filter(Boolean).length;
  } catch {
    return undefined;
  }
}

async function duplicateArtifacts(sessionRoot: string): Promise<SharedPythonRuntimeStatus["duplicateArtifacts"]> {
  const rootExists = await exists(sessionRoot);
  if (!rootExists) {
    return { sessionVirtualenvCount: 0, argosCacheCount: 0, argosDataCount: 0, scanned: true };
  }
  const [venvCount, argosCacheCount, argosDataCount] = await Promise.all([
    countFindMatches([sessionRoot, "-xdev", "-type", "d", "(", "-name", ".venv*", "-o", "-name", "venv", "-o", "-name", "env", ")", "-print"]),
    countFindMatches([sessionRoot, "-xdev", "-type", "d", "-name", ".argos_cache", "-print"]),
    countFindMatches([sessionRoot, "-xdev", "-type", "d", "-name", ".argos_data", "-print"])
  ]);
  return {
    sessionVirtualenvCount: venvCount ?? 0,
    argosCacheCount: argosCacheCount ?? 0,
    argosDataCount: argosDataCount ?? 0,
    scanned: venvCount !== undefined && argosCacheCount !== undefined && argosDataCount !== undefined
  };
}

export async function inspectSharedPythonRuntime(input: {
  settings?: SystemSettingsPythonRuntime;
  paths?: SharedPythonRuntimePaths;
  sessionWorkspaceRoot?: string;
}): Promise<SharedPythonRuntimeStatus> {
  const settings = effectivePythonRuntimeSettings(input.settings);
  const paths = input.paths ?? sharedPythonRuntimePaths();
  const runtimeExists = await exists(paths.runtimeRoot);
  const capabilities = await Promise.all(CAPABILITIES.map((definition) => capabilityStatus(paths.runtimeRoot, definition)));
  return {
    enabled: settings.enabled,
    runtimeExists,
    runtimeBytes: runtimeExists ? await duBytes(paths.runtimeRoot) : 0,
    pythonVersion: await pythonVersion(),
    envKeys: settings.enabled
      ? ["PYTHONPATH", "PIP_CACHE_DIR", "ARGOS_PACKAGE_DIR", "ARGOS_DOWNLOAD_DIR", "TMPDIR"]
      : [],
    capabilities,
    duplicateArtifacts: await duplicateArtifacts(input.sessionWorkspaceRoot ?? appConfig.sessionWorkspaceRoot),
    checkedAt: new Date().toISOString()
  };
}
