import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { RuntimeFileChange } from "./runtime-generated-artifacts.js";

const ARTIFACT_PUBLICATION_SCHEMA_VERSION = 1;
const ARTIFACT_PUBLICATION_MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const ARTIFACT_PUBLICATION_LIMIT = 50;
const ARTIFACT_PUBLICATION_ROLES = new Set(["final", "preview", "intermediate", "source"]);

export const ARTIFACT_PUBLICATION_HINT = [
  "Internal artifact publication requirement: when the user asks to create, edit, convert, or export a file, explicitly publish the final deliverable after validating its content and layout.",
  "Publish from the session workspace with `node .agent-studio/artifact-cli.mjs publish --path <file-path> [--name <user-visible-file-name>]`.",
  "Publish only final files the user should download. Do not publish build scripts, temporary files, preview images, validation reports, or intermediate artifacts unless the user explicitly requests them.",
  "Reference the file in the final response only after publication succeeds. Do not explain the publication tool, manifest, or internal paths to the user."
].join("\n");

export type ArtifactPublicationPaths = {
  cli: string;
  manifest: string;
};

export function artifactPublicationPaths(workspace: string): ArtifactPublicationPaths {
  const root = path.join(path.resolve(workspace), ".agent-studio");
  return {
    cli: path.join(root, "artifact-cli.mjs"),
    manifest: path.join(root, "artifacts", "published.jsonl")
  };
}

function artifactPublicationCliSource(): string {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const roles = new Set(["final", "preview", "intermediate", "source"]);
const args = process.argv.slice(2);
const command = args.shift();
const values = {};
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (!key?.startsWith("--")) continue;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    values[key.slice(2)] = "true";
    continue;
  }
  values[key.slice(2)] = value;
  index += 1;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\\n");
  process.exit(1);
}

if (command !== "publish") fail("Usage: artifact-cli publish --path <file> [--name <display name>] [--role final]");

const workspace = path.resolve(process.env.AGENT_STUDIO_WORKSPACE || process.cwd());
const requestedPath = String(values.path || "").trim();
if (!requestedPath) fail("--path is required");
const absolutePath = path.isAbsolute(requestedPath)
  ? path.resolve(requestedPath)
  : path.resolve(workspace, requestedPath);
const relativePath = path.relative(workspace, absolutePath);
if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
  fail("File must be inside the current workspace");
}
let stat;
try {
  stat = fs.statSync(absolutePath);
} catch {
  fail("File does not exist");
}
if (!stat.isFile()) fail("Path is not a regular file");

const role = String(values.role || "final").trim().toLowerCase();
if (!roles.has(role)) fail("Role must be final, preview, intermediate, or source");
const displayName = String(values.name || path.basename(relativePath)).trim();
if (!displayName || displayName.includes("/") || displayName.includes("\\\\")) {
  fail("Display name must be a file name");
}
const manifest = path.resolve(
  process.env.AGENT_STUDIO_ARTIFACT_MANIFEST ||
    path.join(workspace, ".agent-studio", "artifacts", "published.jsonl")
);
const manifestRelative = path.relative(workspace, manifest);
if (!manifestRelative || manifestRelative.startsWith("..") || path.isAbsolute(manifestRelative)) {
  fail("Artifact manifest must be inside the current workspace");
}
fs.mkdirSync(path.dirname(manifest), { recursive: true });
const realWorkspace = fs.realpathSync(workspace);
const realManifestDirectory = fs.realpathSync(path.dirname(manifest));
const realManifestDirectoryRelative = path.relative(realWorkspace, realManifestDirectory);
if (realManifestDirectoryRelative.startsWith("..") || path.isAbsolute(realManifestDirectoryRelative)) {
  fail("Artifact manifest directory must be inside the current workspace");
}
try {
  const manifestStat = fs.lstatSync(manifest);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    fail("Artifact manifest must be a regular file");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const entry = {
  schemaVersion: ${ARTIFACT_PUBLICATION_SCHEMA_VERSION},
  publishedAt: new Date().toISOString(),
  path: relativePath.split(path.sep).join("/"),
  displayName,
  role
};
fs.appendFileSync(manifest, JSON.stringify(entry) + "\\n", { encoding: "utf8", mode: 0o600 });
process.stdout.write(JSON.stringify({ ok: true, artifact: entry }) + "\\n");
`;
}

export async function ensureArtifactPublicationTool(workspace: string): Promise<ArtifactPublicationPaths> {
  const paths = artifactPublicationPaths(workspace);
  await fs.mkdir(path.dirname(paths.manifest), { recursive: true });
  const source = artifactPublicationCliSource();
  const existing = await fs.readFile(paths.cli, "utf8").catch(() => undefined);
  if (existing !== source) {
    const temporaryPath = `${paths.cli}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, source, { encoding: "utf8", mode: 0o755 });
    await fs.rename(temporaryPath, paths.cli);
  } else {
    await fs.chmod(paths.cli, 0o755);
  }
  return paths;
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function collectPublishedArtifactChanges(input: {
  workspacePath: string;
  changedAfter?: Date;
}): Promise<RuntimeFileChange[]> {
  const workspace = path.resolve(input.workspacePath);
  const { manifest } = artifactPublicationPaths(workspace);
  const manifestStat = await fs.lstat(manifest).catch(() => undefined);
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) return [];
  const [realWorkspace, realManifest] = await Promise.all([
    fs.realpath(workspace).catch(() => undefined),
    fs.realpath(manifest).catch(() => undefined)
  ]);
  if (!realWorkspace || !realManifest || !isPathInside(realWorkspace, realManifest)) return [];

  const sinceMs = input.changedAfter?.getTime() ?? 0;
  const startOffset = Math.max(0, manifestStat.size - ARTIFACT_PUBLICATION_MAX_MANIFEST_BYTES);
  const handle = await fs.open(manifest, "r").catch(() => undefined);
  if (!handle) return [];
  let manifestText = "";
  try {
    const length = manifestStat.size - startOffset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, startOffset);
    manifestText = buffer.toString("utf8");
  } finally {
    await handle.close();
  }
  if (startOffset > 0) {
    const firstNewline = manifestText.indexOf("\n");
    manifestText = firstNewline >= 0 ? manifestText.slice(firstNewline + 1) : "";
  }
  const lines = manifestText.split(/\r?\n/);
  const published = new Map<string, RuntimeFileChange>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let payload: Record<string, unknown> | undefined;
    try {
      payload = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (payload?.schemaVersion !== ARTIFACT_PUBLICATION_SCHEMA_VERSION) continue;
    const publishedAt = trimOrUndefined(payload.publishedAt);
    const publishedAtMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
    if (!Number.isFinite(publishedAtMs) || (sinceMs > 0 && publishedAtMs + 2000 < sinceMs)) continue;
    const role = trimOrUndefined(payload.role)?.toLowerCase();
    if (!role || !ARTIFACT_PUBLICATION_ROLES.has(role) || role !== "final") continue;
    const filePath = trimOrUndefined(payload.path);
    if (!filePath) continue;
    const absolutePath = path.resolve(workspace, filePath);
    if (!isPathInside(workspace, absolutePath) || absolutePath === workspace) continue;
    const stat = await fs.stat(absolutePath).catch(() => undefined);
    if (!stat?.isFile()) continue;

    const requestedDisplayName = trimOrUndefined(payload.displayName);
    const displayName =
      requestedDisplayName &&
      requestedDisplayName !== "." &&
      requestedDisplayName !== ".." &&
      path.basename(requestedDisplayName) === requestedDisplayName
        ? requestedDisplayName
        : undefined;
    published.set(absolutePath, {
      path: absolutePath,
      kind: "published_artifact",
      metadata: {
        publicationSchemaVersion: ARTIFACT_PUBLICATION_SCHEMA_VERSION,
        publicationRole: role,
        publishedAt,
        ...(displayName ? { displayName } : {})
      }
    });
  }
  return Array.from(published.values()).slice(-ARTIFACT_PUBLICATION_LIMIT);
}
