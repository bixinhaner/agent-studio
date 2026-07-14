#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 5000;
const LOCK_WAIT_MS = 30_000;
const LOCK_STALE_MS = 120_000;

function fail(message) {
  throw new Error(`OMC handbook: ${message}`);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${name} is invalid`);
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} is missing`);
  return value.trim();
}

function metadataFromIdentity(identity) {
  const root = asObject(identity) ?? {};
  const metadata = asObject(root.metadata) ?? asObject(asObject(root.externalIdentity)?.metadata);
  const handbook = asObject(metadata?.apiHandbook);
  if (!handbook || handbook.packageAvailable !== true) {
    fail("the connected OMC does not publish a downloadable API handbook; upgrade that OMC first");
  }
  const digest = text(handbook.handbookDigest, "handbookDigest");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) fail("handbookDigest is invalid");
  const manifestPath = text(handbook.manifestPath, "manifestPath");
  const chunkPathTemplate = text(handbook.chunkPathTemplate, "chunkPathTemplate");
  if (manifestPath !== "/api/v1/agent/handbook/manifest") fail("manifestPath is not allowed");
  if (chunkPathTemplate !== "/api/v1/agent/handbook/chunks/{index}") fail("chunkPathTemplate is not allowed");
  if (handbook.archiveFormat !== "tar+gzip" || handbook.contentRoot !== "references") {
    fail("archive format is not supported");
  }
  return {
    schemaVersion: text(handbook.schemaVersion, "schemaVersion"),
    catalogVersion: text(handbook.catalogVersion, "catalogVersion"),
    handbookDigest: digest,
    digestHex: digest.slice("sha256:".length),
    totalOperations: integer(handbook.totalOperations, "totalOperations", 1, MAX_FILES),
    manifestPath,
    chunkPathTemplate,
    archiveBytes: integer(handbook.archiveBytes, "archiveBytes", 1, MAX_ARCHIVE_BYTES),
    chunkBytes: integer(handbook.chunkBytes, "chunkBytes", 1, MAX_ARCHIVE_BYTES),
    totalChunks: integer(handbook.totalChunks, "totalChunks", 1, 1024)
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `command failed with exit code ${code}`));
    });
  });
}

async function cliJson(cliPath, args) {
  const output = await run(process.execPath, [cliPath, ...args], { env: process.env });
  try {
    return JSON.parse(output);
  } catch {
    fail(`connector CLI returned invalid JSON for ${args[0]}`);
  }
}

function sameManifest(actual, expected) {
  return actual.schemaVersion === expected.schemaVersion &&
    actual.catalogVersion === expected.catalogVersion &&
    actual.handbookDigest === expected.handbookDigest &&
    actual.totalOperations === expected.totalOperations &&
    actual.archiveBytes === expected.archiveBytes &&
    actual.chunkBytes === expected.chunkBytes &&
    actual.totalChunks === expected.totalChunks &&
    actual.archiveFormat === "tar+gzip" &&
    actual.contentRoot === "references";
}

function parseOctal(buffer, start, length, name) {
  const raw = buffer.subarray(start, start + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]+$/.test(raw)) fail(`tar ${name} is invalid`);
  return Number.parseInt(raw, 8);
}

function headerText(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "");
}

function verifyChecksum(header) {
  const expected = parseOctal(header, 148, 8, "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) fail("tar checksum does not match");
}

function parsePax(data) {
  const result = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    if (space < 0) fail("PAX record is invalid");
    const length = Number.parseInt(data.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) fail("PAX record length is invalid");
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

function safeEntryPath(name) {
  if (!name || name.includes("\\") || path.posix.isAbsolute(name)) fail(`tar path is invalid: ${name || "<empty>"}`);
  const normalized = path.posix.normalize(name);
  if (normalized !== name || normalized === "references" || !normalized.startsWith("references/")) {
    fail(`tar path escapes references: ${name}`);
  }
  return normalized;
}

async function extractArchive(archive, targetDirectory, expected) {
  let raw;
  try {
    raw = gunzipSync(archive, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch (error) {
    fail(`cannot decompress archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  let offset = 0;
  let files = 0;
  let operations = 0;
  let nextPax = {};
  const seen = new Set();
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    verifyChecksum(header);
    const size = parseOctal(header, 124, 12, "size");
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > raw.length) fail("tar entry exceeds archive size");
    if (type === "x") {
      nextPax = parsePax(raw.subarray(dataStart, dataEnd));
    } else {
      if (type !== "0" && type !== "\0") fail("tar contains a non-regular entry");
      const prefix = headerText(header, 345, 155);
      const basicName = [prefix, headerText(header, 0, 100)].filter(Boolean).join("/");
      const entryName = safeEntryPath(typeof nextPax.path === "string" ? nextPax.path : basicName);
      nextPax = {};
      if (seen.has(entryName)) fail(`tar contains duplicate path: ${entryName}`);
      seen.add(entryName);
      files += 1;
      if (files > MAX_FILES) fail("tar contains too many files");
      if (/^references\/api-docs\/[^/]+\.json$/.test(entryName)) operations += 1;
      const destination = path.join(targetDirectory, ...entryName.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, raw.subarray(dataStart, dataEnd), { mode: 0o600 });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (operations !== expected.totalOperations) {
    fail(`archive contains ${operations} operation documents, expected ${expected.totalOperations}`);
  }
  const manifestPath = path.join(targetDirectory, "references", "manifest.json");
  let sourceManifest;
  try {
    sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    fail("archive manifest is missing or invalid");
  }
  if (sourceManifest.schemaVersion !== expected.schemaVersion ||
      sourceManifest.catalogVersion !== expected.catalogVersion ||
      sourceManifest.totalOperations !== expected.totalOperations) {
    fail("archive manifest does not match connected OMC metadata");
  }
}

async function validCache(cacheDirectory, expected) {
  try {
    const marker = JSON.parse(await readFile(path.join(cacheDirectory, ".complete.json"), "utf8"));
    await stat(path.join(cacheDirectory, "references", "manifest.json"));
    return marker.handbookDigest === expected.handbookDigest &&
      marker.catalogVersion === expected.catalogVersion &&
      marker.totalOperations === expected.totalOperations;
  } catch {
    return false;
  }
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(lockPath, cacheDirectory, expected) {
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await validCache(cacheDirectory, expected)) return false;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() - started > LOCK_WAIT_MS) fail("timed out waiting for another handbook download");
      await sleep(100);
    }
  }
}

async function downloadHandbook(cliPath, cacheDirectory, expected) {
  const manifest = asObject(await cliJson(cliPath, [
    "request", "GET", expected.manifestPath,
    JSON.stringify({ operationId: "get.agent.handbook.manifest", reason: "Load this OMC version's API handbook" })
  ]));
  if (!manifest || !sameManifest(manifest, expected)) fail("published manifest does not match request context");

  const chunks = [];
  let totalBytes = 0;
  for (let index = 0; index < expected.totalChunks; index += 1) {
    const chunkPath = expected.chunkPathTemplate.replace("{index}", String(index));
    const chunk = asObject(await cliJson(cliPath, [
      "request", "GET", chunkPath,
      JSON.stringify({ operationId: "get.agent.handbook.chunks.by_index", reason: "Load this OMC version's API handbook" })
    ]));
    if (!chunk || chunk.handbookDigest !== expected.handbookDigest || chunk.index !== index ||
        chunk.totalChunks !== expected.totalChunks || chunk.encoding !== "base64") {
      fail(`chunk ${index} metadata does not match`);
    }
    const decoded = Buffer.from(text(chunk.data, `chunk ${index} data`), "base64");
    if (decoded.length !== chunk.bytes || decoded.length > expected.chunkBytes) fail(`chunk ${index} size does not match`);
    chunks.push(decoded);
    totalBytes += decoded.length;
    if (totalBytes > expected.archiveBytes) fail("download exceeds declared archive size");
  }
  const archive = Buffer.concat(chunks);
  if (archive.length !== expected.archiveBytes) fail("downloaded archive size does not match");
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== expected.digestHex) fail("downloaded archive digest does not match");

  const temporary = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    await extractArchive(archive, temporary, expected);
    await writeFile(path.join(temporary, ".complete.json"), JSON.stringify({
      schemaVersion: expected.schemaVersion,
      catalogVersion: expected.catalogVersion,
      handbookDigest: expected.handbookDigest,
      totalOperations: expected.totalOperations
    }), { mode: 0o600 });
    await rm(cacheDirectory, { recursive: true, force: true });
    await rename(temporary, cacheDirectory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureHandbook({ cliPath, workspace = process.cwd() }) {
  const absoluteCli = path.resolve(workspace, text(cliPath, "--cli"));
  const identity = await cliJson(absoluteCli, ["identity"]);
  const metadata = metadataFromIdentity(identity);
  const cacheRoot = path.join(workspace, ".agent-studio", "omc-handbooks");
  const cacheDirectory = path.join(cacheRoot, metadata.digestHex);
  await mkdir(cacheRoot, { recursive: true });
  if (await validCache(cacheDirectory, metadata)) {
    return { status: "cached", handbookRoot: path.join(cacheDirectory, "references"), handbookDigest: metadata.handbookDigest };
  }

  const lockPath = `${cacheDirectory}.lock`;
  const ownsLock = await acquireLock(lockPath, cacheDirectory, metadata);
  if (!ownsLock) {
    return { status: "cached", handbookRoot: path.join(cacheDirectory, "references"), handbookDigest: metadata.handbookDigest };
  }
  try {
    if (!(await validCache(cacheDirectory, metadata))) await downloadHandbook(absoluteCli, cacheDirectory, metadata);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
  return { status: "downloaded", handbookRoot: path.join(cacheDirectory, "references"), handbookDigest: metadata.handbookDigest };
}

function cliArgument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  ensureHandbook({ cliPath: cliArgument(process.argv.slice(2), "--cli") })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
