import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  inspectManagedPlugins,
  readManagedPluginSyncReport,
  type ManagedPluginStatus,
  type ManagedPluginSyncReport
} from "./codex-plugins/managed-plugins.js";
import { appConfig } from "./config.js";
import type { SystemSettingsPythonRuntime } from "./system-settings/types.js";

// The shared runtime ("共享运行环境") gives every conversation the same preinstalled
// Python packages, command-line tools, browsers and download caches, so agents do not
// reinstall or re-download them per thread. Settings are still stored under the
// `pythonRuntime` key for compatibility with releases that predate the rename.

const execFileAsync = promisify(execFile);

export type SharedRuntimePaths = {
  pythonRoot: string;
  pipCacheRoot: string;
  argosPackageRoot: string;
  argosDownloadRoot: string;
  cacheRoot: string;
  stateRoot: string;
};

export type SharedRuntimeCacheKey = "pip" | "playwright" | "npm" | "uv" | "uvPython" | "huggingface" | "argos";

type CacheDefinition = {
  key: SharedRuntimeCacheKey;
  label: string;
  description: string;
  envKey: string;
  dir: (paths: SharedRuntimePaths) => string;
};

const CACHES: CacheDefinition[] = [
  {
    key: "pip",
    label: "pip 下载缓存",
    description: "Python 包下载过一次后全站复用",
    envKey: "PIP_CACHE_DIR",
    dir: (paths) => paths.pipCacheRoot
  },
  {
    key: "playwright",
    label: "浏览器（Playwright）",
    description: "网页浏览、截图使用的 Chromium，每个版本只存一份",
    envKey: "PLAYWRIGHT_BROWSERS_PATH",
    dir: (paths) => path.join(paths.cacheRoot, "ms-playwright")
  },
  {
    key: "npm",
    label: "npm 下载缓存",
    description: "Node 包下载缓存",
    envKey: "npm_config_cache",
    dir: (paths) => path.join(paths.cacheRoot, "npm")
  },
  {
    key: "uv",
    label: "uv 下载缓存",
    description: "uv 安装 Python 包时的缓存",
    envKey: "UV_CACHE_DIR",
    dir: (paths) => path.join(paths.cacheRoot, "uv")
  },
  {
    key: "uvPython",
    label: "uv Python 版本",
    description: "uv 按需下载的其他 Python 版本",
    envKey: "UV_PYTHON_INSTALL_DIR",
    dir: (paths) => path.join(paths.cacheRoot, "uv-python")
  },
  {
    key: "huggingface",
    label: "模型下载缓存",
    description: "Hugging Face 模型文件（不含登录凭据）",
    envKey: "HF_HUB_CACHE",
    dir: (paths) => path.join(paths.cacheRoot, "huggingface")
  },
  {
    key: "argos",
    label: "离线翻译模型",
    description: "Argos 翻译语言包",
    envKey: "ARGOS_PACKAGE_DIR",
    dir: (paths) => paths.argosPackageRoot
  }
];

type CapabilityCheck =
  | { kind: "python"; module: string; label: string }
  | { kind: "command"; command: string; label: string }
  | { kind: "browser"; label: string };

type CapabilityDefinition = {
  key: string;
  label: string;
  description: string;
  checks: CapabilityCheck[];
};

const py = (module: string, label: string): CapabilityCheck => ({ kind: "python", module, label });
const cmd = (command: string, label: string): CapabilityCheck => ({ kind: "command", command, label });

const CAPABILITIES: CapabilityDefinition[] = [
  {
    key: "spreadsheets",
    label: "表格处理",
    description: "读写 Excel / CSV，包括老版 .xls",
    checks: [py("pandas", "表格分析 pandas"), py("openpyxl", "Excel 读写"), py("xlrd", "老版 .xls")]
  },
  {
    key: "documents",
    label: "文档处理",
    description: "Word、PPT、PDF、Outlook 邮件和老版 Office 文件",
    checks: [
      py("docx", "Word"),
      py("pptx", "PPT"),
      py("pypdf", "PDF 解析"),
      py("fitz", "PDF 渲染"),
      py("olefile", "老版 Office"),
      py("extract_msg", "Outlook .msg")
    ]
  },
  {
    key: "charts",
    label: "画图",
    description: "生成折线图、柱状图等图表",
    checks: [py("matplotlib", "matplotlib"), py("plotly", "plotly")]
  },
  {
    key: "images",
    label: "图片处理",
    description: "缩放、拼图、格式转换、SVG 转图片",
    checks: [
      py("PIL", "Pillow"),
      py("cv2", "OpenCV"),
      py("cairosvg", "SVG 转换"),
      cmd("identify", "ImageMagick identify"),
      cmd("convert", "ImageMagick convert"),
      cmd("montage", "ImageMagick montage")
    ]
  },
  {
    key: "web",
    label: "网页浏览与解析",
    description: "打开网页、截图、解析 HTML",
    checks: [py("bs4", "BeautifulSoup"), py("lxml", "lxml"), py("playwright", "Playwright"), { kind: "browser", label: "Chromium 浏览器" }]
  },
  {
    key: "media",
    label: "音视频",
    description: "转码、抽帧、读取媒体信息",
    checks: [cmd("ffmpeg", "ffmpeg"), cmd("ffprobe", "ffprobe"), py("imageio_ffmpeg", "imageio-ffmpeg")]
  },
  {
    key: "archives",
    label: "压缩包",
    description: "打包和解开 zip、7z、rar",
    checks: [cmd("zip", "zip"), cmd("7z", "7z"), cmd("bsdtar", "bsdtar"), py("py7zr", "py7zr"), py("rarfile", "rarfile")]
  },
  {
    key: "data",
    label: "数据与格式",
    description: "科学计算、SQLite、XML 校验",
    checks: [py("numpy", "numpy"), py("scipy", "scipy"), cmd("sqlite3", "sqlite3"), cmd("xmllint", "xmllint")]
  },
  {
    key: "translation",
    label: "离线翻译",
    description: "不出网的文档翻译",
    checks: [py("argostranslate", "Argos 翻译"), py("ctranslate2", "翻译推理"), py("sentencepiece", "分词模型")]
  },
  {
    key: "installers",
    label: "安装工具",
    description: "共享环境缺包时用 uv 快速补装",
    checks: [cmd("uv", "uv")]
  }
];

export type SharedRuntimeCapabilityStatus = {
  key: string;
  label: string;
  description: string;
  status: "ready" | "partial" | "missing";
  available: string[];
  missing: string[];
};

export type SharedRuntimeCacheStatus = {
  key: SharedRuntimeCacheKey;
  label: string;
  description: string;
  envKey: string;
  path: string;
  exists: boolean;
  bytes: number;
};

export type SharedRuntimeCleanupRun = {
  finishedAt: string;
  dryRun: boolean;
  tmpRetentionDays: number;
  workspaceCopyRetentionDays: number;
  removedThreadTmp: number;
  removedWorkspaceCopies: number;
  skippedInUse: number;
  freedBytes: number;
};

export type SharedRuntimeGapItem = {
  kind: "python" | "command";
  name: string;
  threads: number;
  occurrences: number;
  covered: boolean;
};

export type SharedRuntimeGapReport = {
  generatedAt: string;
  windowDays: number;
  rolloutsScanned: number;
  rolloutsWithGaps: number;
  items: SharedRuntimeGapItem[];
  installs: Array<{ tool: string; calls: number; threads: number }>;
  duplicateCaches: Array<{ name: string; threads: number; bytes: number }>;
};

export type DiskUsageArea = {
  key: string;
  label: string;
  bytes: number | null;
  /** Change against the oldest snapshot of the last 7 days; null until two days are recorded. */
  change7dBytes: number | null;
};

export type DiskUsageHistoryEntry = {
  /** UTC day of the snapshot, one entry per day. */
  date: string;
  recordedAt: string;
  usedBytes: number;
  totalBytes: number;
};

export type DiskUsageReport = {
  generatedAt: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  /** Average daily growth of used bytes over the last 7 days of snapshots. */
  dailyGrowthBytes: number | null;
  /** Days until the disk is full at dailyGrowthBytes; null when not growing. */
  daysUntilFull: number | null;
  areas: DiskUsageArea[];
  history: DiskUsageHistoryEntry[];
};

export type CodexHomeDedupeRun = {
  finishedAt: string;
  homes: number;
  filesLinked: number;
  reclaimedBytes: number;
  pluginBytesBefore: number;
  pluginUniqueBytes: number;
  /** Size of all plugin files counted per home, i.e. without de-duplication. */
  pluginLogicalBytes: number;
  /** Space the plugin files actually occupy after this run. */
  pluginAllocatedBytes: number;
  catalogRetentionDays: number;
  catalogFilesRemoved: number;
  catalogFreedBytes: number;
  errors: number;
};

export type ManagedCodexPluginStatus = ManagedPluginStatus & {
  lastSync: ManagedPluginSyncReport["plugins"][number] | null;
};

export type SharedRuntimeStatus = {
  enabled: boolean;
  runtimeExists: boolean;
  runtimeBytes: number;
  cacheBytes: number;
  pythonVersion?: string;
  envKeys: string[];
  capabilities: SharedRuntimeCapabilityStatus[];
  caches: SharedRuntimeCacheStatus[];
  cleanup: {
    tmpRetentionDays: number;
    workspaceCopyRetentionDays: number;
    lastRun: SharedRuntimeCleanupRun | null;
  };
  gaps: SharedRuntimeGapReport | null;
  storage: {
    disk: DiskUsageReport | null;
    codexHomeDedupe: CodexHomeDedupeRun | null;
  };
  /** Codex plugins kept in the repository and installed by the deploy. */
  codexPlugins: {
    lastSyncAt: string | null;
    plugins: ManagedCodexPluginStatus[];
  };
  checkedAt: string;
};

/** Thread workspace copies are always removed after this many idle days by the server cleaner. */
export const WORKSPACE_COPY_RETENTION_DAYS = 3;
export const MIN_TMP_RETENTION_DAYS = 3;
export const MAX_TMP_RETENTION_DAYS = 90;

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

export function tmpRetentionDays(settings: SystemSettingsPythonRuntime | undefined): number {
  const value = effectivePythonRuntimeSettings(settings).cleanupSessionArtifactsOlderThanDays;
  return Math.min(MAX_TMP_RETENTION_DAYS, Math.max(MIN_TMP_RETENTION_DAYS, Math.round(value)));
}

export function sharedRuntimePaths(): SharedRuntimePaths {
  return appConfig.sharedRuntime;
}

export function sharedRuntimeBinDir(paths: SharedRuntimePaths): string {
  return path.join(paths.pythonRoot, "bin");
}

function prependPath(value: string, existing?: string): string {
  const current = (existing || "").trim();
  if (!current) return value;
  const parts = current.split(path.delimiter).filter(Boolean);
  return parts.includes(value) ? current : [value, ...parts].join(path.delimiter);
}

function appendPath(value: string, existing?: string): string {
  const current = (existing || "").trim();
  if (!current) return value;
  const parts = current.split(path.delimiter).filter(Boolean);
  return parts.includes(value) ? current : [...parts, value].join(path.delimiter);
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

export function buildSharedRuntimeEnv(input: {
  settings?: SystemSettingsPythonRuntime;
  paths?: SharedRuntimePaths;
  workspace?: string;
  baseEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Record<string, string> {
  const settings = effectivePythonRuntimeSettings(input.settings);
  if (!settings.enabled) return {};

  const paths = input.paths ?? sharedRuntimePaths();
  const baseEnv = input.baseEnv ?? process.env;
  const env: Record<string, string> = {
    AGENT_STUDIO_SHARED_RUNTIME: "1",
    AGENT_STUDIO_SHARED_PYTHON_RUNTIME: "1",
    PYTHONPATH: prependPath(paths.pythonRoot, baseEnv.PYTHONPATH),
    // Appended so preinstalled console scripts (uv, playwright) only fill gaps in PATH.
    PATH: appendPath(sharedRuntimeBinDir(paths), baseEnv.PATH),
    ARGOS_DOWNLOAD_DIR: paths.argosDownloadRoot
  };
  for (const cache of CACHES) {
    env[cache.envKey] = cache.dir(paths);
  }
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

export function sharedRuntimeHint(settings: SystemSettingsPythonRuntime | undefined): string | undefined {
  const effective = effectivePythonRuntimeSettings(settings);
  if (!effective.enabled || !effective.injectRuntimeHint) return undefined;
  if (!effective.preferSharedPackages) return undefined;
  return [
    "Internal runtime guidance: a shared runtime is preconfigured through environment variables.",
    "Python packages for spreadsheets, documents, charts (matplotlib, plotly), images (Pillow, OpenCV, cairosvg), HTML parsing (bs4, lxml), archives (py7zr, rarfile), scipy and offline translation are already importable.",
    "Command-line tools ImageMagick (identify, convert, montage), ffmpeg, ffprobe, zip, 7z, bsdtar, sqlite3, xmllint and uv are installed. Playwright with Chromium is installed under PLAYWRIGHT_BROWSERS_PATH; do not download browsers again.",
    "Package and model caches are shared, so repeated installs are fast. Do not create a session-specific virtual environment or reinstall common libraries. Install a missing dependency only when the task needs it."
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
    const { stdout } = await execFileAsync("du", ["-sk", "--", filePath], { timeout: 10000, maxBuffer: 1024 * 32 });
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

async function pythonModuleInstalled(pythonRoot: string, module: string): Promise<boolean> {
  const base = path.join(pythonRoot, ...module.split("."));
  return (await exists(base)) || (await exists(`${base}.py`));
}

function commandSearchDirs(paths: SharedRuntimePaths): string[] {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const codexRuntime = appConfig.sharedCodexRuntime.runtimeRoot;
  if (codexRuntime) dirs.unshift(path.join(codexRuntime, "dependencies", "bin", "override"));
  dirs.push(sharedRuntimeBinDir(paths));
  return [...new Set(dirs)];
}

async function commandInstalled(dirs: string[], command: string): Promise<boolean> {
  for (const dir of dirs) {
    try {
      await fs.access(path.join(dir, command), fsConstants.X_OK);
      return true;
    } catch {
      // try next directory
    }
  }
  return false;
}

async function browserInstalled(paths: SharedRuntimePaths): Promise<boolean> {
  try {
    const entries = await fs.readdir(path.join(paths.cacheRoot, "ms-playwright"));
    return entries.some((name) => name.startsWith("chromium"));
  } catch {
    return false;
  }
}

async function checkPasses(check: CapabilityCheck, paths: SharedRuntimePaths, dirs: string[]): Promise<boolean> {
  if (check.kind === "python") return pythonModuleInstalled(paths.pythonRoot, check.module);
  if (check.kind === "command") return commandInstalled(dirs, check.command);
  return browserInstalled(paths);
}

async function capabilityStatus(
  definition: CapabilityDefinition,
  paths: SharedRuntimePaths,
  dirs: string[]
): Promise<SharedRuntimeCapabilityStatus> {
  const results = await Promise.all(
    definition.checks.map(async (check) => ({ check, ok: await checkPasses(check, paths, dirs) }))
  );
  const available = results.filter((result) => result.ok).map((result) => result.check.label);
  const missing = results.filter((result) => !result.ok).map((result) => result.check.label);
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    status: missing.length === 0 ? "ready" : available.length > 0 ? "partial" : "missing",
    available,
    missing
  };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function cleanupPolicyPath(paths: SharedRuntimePaths): string {
  return path.join(paths.stateRoot, "cleanup-policy.json");
}

/**
 * Publishes the effective retention to the server cleaner (a root systemd timer that
 * cannot read the database). Writes only when the value changed.
 */
export async function syncSharedRuntimeCleanupPolicy(
  settings: SystemSettingsPythonRuntime | undefined,
  paths: SharedRuntimePaths = sharedRuntimePaths()
): Promise<boolean> {
  const target = cleanupPolicyPath(paths);
  const days = tmpRetentionDays(settings);
  const current = await readJson<{ tmpRetentionDays?: number }>(target);
  if (current?.tmpRetentionDays === days) return false;
  await fs.mkdir(paths.stateRoot, { recursive: true });
  const body = JSON.stringify(
    { tmpRetentionDays: days, workspaceCopyRetentionDays: WORKSPACE_COPY_RETENTION_DAYS, updatedAt: new Date().toISOString() },
    null,
    2
  );
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${body}\n`, { mode: 0o644 });
  await fs.rename(temp, target);
  return true;
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readCleanupRun(paths: SharedRuntimePaths): Promise<SharedRuntimeCleanupRun | null> {
  const raw = await readJson<Record<string, unknown>>(path.join(paths.stateRoot, "cleanup-last-run.json"));
  if (!raw || typeof raw.finishedAt !== "string") return null;
  return {
    finishedAt: raw.finishedAt,
    dryRun: raw.dryRun === true,
    tmpRetentionDays: toNumber(raw.tmpRetentionDays),
    workspaceCopyRetentionDays: toNumber(raw.workspaceCopyRetentionDays),
    removedThreadTmp: toNumber(raw.removedThreadTmp),
    removedWorkspaceCopies: toNumber(raw.removedWorkspaceCopies),
    skippedInUse: toNumber(raw.skippedInUse),
    freedBytes: toNumber(raw.freedBytes)
  };
}

async function readGapReport(paths: SharedRuntimePaths, dirs: string[]): Promise<SharedRuntimeGapReport | null> {
  const raw = await readJson<Record<string, unknown>>(path.join(paths.stateRoot, "runtime-gaps.json"));
  if (!raw || typeof raw.generatedAt !== "string") return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const parsedItems = await Promise.all(
    items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => (item.kind === "python" || item.kind === "command") && typeof item.name === "string")
      .slice(0, 40)
      .map(async (item) => {
        const kind = item.kind as "python" | "command";
        const name = String(item.name);
        const covered =
          kind === "python" ? await pythonModuleInstalled(paths.pythonRoot, name) : await commandInstalled(dirs, name);
        return { kind, name, threads: toNumber(item.threads), occurrences: toNumber(item.occurrences), covered };
      })
  );
  const list = <T>(value: unknown, map: (item: Record<string, unknown>) => T): T[] =>
    Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, 20).map(map)
      : [];
  return {
    generatedAt: raw.generatedAt,
    windowDays: toNumber(raw.windowDays),
    rolloutsScanned: toNumber(raw.rolloutsScanned),
    rolloutsWithGaps: toNumber(raw.rolloutsWithGaps),
    items: parsedItems,
    installs: list(raw.installs, (item) => ({ tool: String(item.tool ?? ""), calls: toNumber(item.calls), threads: toNumber(item.threads) })),
    duplicateCaches: list(raw.duplicateCaches, (item) => ({
      name: String(item.name ?? ""),
      threads: toNumber(item.threads),
      bytes: toNumber(item.bytes)
    }))
  };
}

const DAY_MS = 86_400_000;
const DISK_TREND_DAYS = 7;
const MAX_DISK_HISTORY = 180;

function dateMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

async function readDiskUsage(paths: SharedRuntimePaths): Promise<DiskUsageReport | null> {
  const raw = await readJson<Record<string, unknown>>(path.join(paths.stateRoot, "disk-usage.json"));
  if (!raw || typeof raw.generatedAt !== "string") return null;
  const filesystem = raw.filesystem && typeof raw.filesystem === "object" ? (raw.filesystem as Record<string, unknown>) : {};
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && dateMs(item.date) !== undefined)
    .map((item) => ({
      date: String(item.date),
      recordedAt: typeof item.recordedAt === "string" ? item.recordedAt : `${String(item.date)}T00:00:00Z`,
      usedBytes: toNumber(item.usedBytes),
      totalBytes: toNumber(item.totalBytes),
      areas: item.areas && typeof item.areas === "object" ? (item.areas as Record<string, unknown>) : {}
    }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_DISK_HISTORY);

  const latest = history.at(-1);
  const latestMs = latest ? dateMs(latest.date)! : undefined;
  const baseline =
    latestMs === undefined
      ? undefined
      : history.find((entry) => entry !== latest && dateMs(entry.date)! >= latestMs - DISK_TREND_DAYS * DAY_MS);
  const spanDays = baseline && latestMs !== undefined ? (latestMs - dateMs(baseline.date)!) / DAY_MS : 0;
  const dailyGrowthBytes = baseline && latest && spanDays > 0 ? Math.round((latest.usedBytes - baseline.usedBytes) / spanDays) : null;
  const availableBytes = toNumber(filesystem.availableBytes);

  const areas = (Array.isArray(raw.areas) ? raw.areas : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && typeof item.key === "string")
    .slice(0, 20)
    .map((item): DiskUsageArea => {
      const key = String(item.key);
      const bytes = typeof item.bytes === "number" && Number.isFinite(item.bytes) ? item.bytes : null;
      const before = baseline?.areas[key];
      return {
        key,
        label: String(item.label ?? key),
        bytes,
        change7dBytes: bytes !== null && typeof before === "number" ? bytes - before : null
      };
    });

  return {
    generatedAt: raw.generatedAt,
    totalBytes: toNumber(filesystem.totalBytes),
    usedBytes: toNumber(filesystem.usedBytes),
    availableBytes,
    dailyGrowthBytes,
    daysUntilFull: dailyGrowthBytes && dailyGrowthBytes > 0 ? Math.floor(availableBytes / dailyGrowthBytes) : null,
    areas,
    history: history.map(({ date, recordedAt, usedBytes, totalBytes }) => ({ date, recordedAt, usedBytes, totalBytes }))
  };
}

async function readCodexHomeDedupe(paths: SharedRuntimePaths): Promise<CodexHomeDedupeRun | null> {
  const raw = await readJson<Record<string, unknown>>(path.join(paths.stateRoot, "codex-home-dedupe-last-run.json"));
  if (!raw || typeof raw.finishedAt !== "string") return null;
  return {
    finishedAt: raw.finishedAt,
    homes: toNumber(raw.homes),
    filesLinked: toNumber(raw.filesLinked),
    reclaimedBytes: toNumber(raw.reclaimedBytes),
    pluginBytesBefore: toNumber(raw.pluginBytesBefore),
    pluginUniqueBytes: toNumber(raw.pluginUniqueBytes),
    pluginLogicalBytes: toNumber(raw.pluginLogicalBytes),
    pluginAllocatedBytes: toNumber(raw.pluginAllocatedBytes),
    catalogRetentionDays: toNumber(raw.catalogRetentionDays),
    catalogFilesRemoved: toNumber(raw.catalogFilesRemoved),
    catalogFreedBytes: toNumber(raw.catalogFreedBytes),
    errors: toNumber(raw.errors)
  };
}

async function inspectCodexPlugins(paths: SharedRuntimePaths, codexHome?: string): Promise<SharedRuntimeStatus["codexPlugins"]> {
  const [lastSync, plugins] = await Promise.all([
    readManagedPluginSyncReport(paths.stateRoot),
    codexHome ? inspectManagedPlugins({ codexHome }).catch(() => []) : Promise.resolve([])
  ]);
  return {
    lastSyncAt: lastSync?.checkedAt ?? null,
    plugins: plugins.map((plugin) => ({
      ...plugin,
      lastSync: lastSync?.plugins.find((entry) => entry.name === plugin.name) ?? null
    }))
  };
}

export async function inspectSharedRuntime(input: {
  settings?: SystemSettingsPythonRuntime;
  paths?: SharedRuntimePaths;
  /** Base CODEX_HOME whose plugin cache every conversation links to. */
  codexHome?: string;
}): Promise<SharedRuntimeStatus> {
  const settings = effectivePythonRuntimeSettings(input.settings);
  const paths = input.paths ?? sharedRuntimePaths();
  const dirs = commandSearchDirs(paths);
  const runtimeExists = await exists(paths.pythonRoot);
  const [runtimeBytes, version, capabilities, caches, lastRun, gaps, disk, codexHomeDedupe, codexPlugins] = await Promise.all([
    runtimeExists ? duBytes(paths.pythonRoot) : Promise.resolve(0),
    pythonVersion(),
    Promise.all(CAPABILITIES.map((definition) => capabilityStatus(definition, paths, dirs))),
    Promise.all(
      CACHES.map(async (cache): Promise<SharedRuntimeCacheStatus> => {
        const dir = cache.dir(paths);
        const cacheExists = await exists(dir);
        return {
          key: cache.key,
          label: cache.label,
          description: cache.description,
          envKey: cache.envKey,
          path: dir,
          exists: cacheExists,
          bytes: cacheExists ? await duBytes(dir) : 0
        };
      })
    ),
    readCleanupRun(paths),
    readGapReport(paths, dirs),
    readDiskUsage(paths),
    readCodexHomeDedupe(paths),
    inspectCodexPlugins(paths, input.codexHome)
  ]);
  return {
    enabled: settings.enabled,
    runtimeExists,
    runtimeBytes,
    cacheBytes: caches.reduce((sum, cache) => sum + cache.bytes, 0),
    pythonVersion: version,
    envKeys: settings.enabled
      ? ["PYTHONPATH", "PATH", ...CACHES.map((cache) => cache.envKey), "ARGOS_DOWNLOAD_DIR", ...(settings.sessionTmpEnabled ? ["TMPDIR"] : [])]
      : [],
    capabilities,
    caches,
    cleanup: {
      tmpRetentionDays: tmpRetentionDays(settings),
      workspaceCopyRetentionDays: WORKSPACE_COPY_RETENTION_DAYS,
      lastRun
    },
    gaps,
    storage: { disk, codexHomeDedupe },
    codexPlugins,
    checkedAt: new Date().toISOString()
  };
}
