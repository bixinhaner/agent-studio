#!/usr/bin/env node
// Syncs the Codex plugins kept in this repository (scripts/shared-runtime/codex-plugins)
// into the server's local plugin marketplace and installs them into the base CODEX_HOME.
// Every conversation's Codex home links to the base home's plugin cache, so one install
// updates all conversations. Writes a status file for the admin console.
//
// Usage: sync-codex-plugins.mjs --source DIR --codex-home DIR --state FILE
//          [--codex-bin codex] [--marketplace agentstudio-office] [--check]

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Codex writes its own install metadata next to plugin files; it is not plugin content.
const IGNORED_NAMES = new Set([".codex-remote-plugin-install.json", ".DS_Store"]);

function parseArgs(argv) {
  const args = { codexBin: "codex", marketplace: "agentstudio-office", check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    const take = () => {
      if (!next) throw new Error(`missing value for ${value}`);
      index += 1;
      return next;
    };
    if (value === "--source") args.source = path.resolve(take());
    else if (value === "--codex-home") args.codexHome = path.resolve(take());
    else if (value === "--state") args.state = path.resolve(take());
    else if (value === "--codex-bin") args.codexBin = take();
    else if (value === "--marketplace") args.marketplace = take();
    else if (value === "--check") args.check = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.source || !args.codexHome) throw new Error("--source and --codex-home are required");
  return args;
}

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith("._")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

/** Content digest of a plugin directory; equal digests mean the install matches the source. */
export function pluginDigest(root) {
  if (!fs.existsSync(root)) return null;
  const hash = crypto.createHash("sha256");
  for (const file of listFiles(root)) {
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readPluginVersion(pluginRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    return typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : null;
  } catch {
    return null;
  }
}

/** Reads `source` of `[marketplaces.<name>]` from config.toml without a TOML dependency. */
export function marketplaceRoot(codexHome, marketplace) {
  let config;
  try {
    config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  } catch {
    return null;
  }
  let inSection = false;
  for (const line of config.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inSection = header[1].trim() === `marketplaces.${marketplace}` || header[1].trim() === `marketplaces."${marketplace}"`;
      continue;
    }
    const source = inSection && line.match(/^\s*source\s*=\s*"([^"]+)"/);
    if (source) return source[1];
  }
  return null;
}

function installedVersions(codexHome, marketplace, name) {
  const root = path.join(codexHome, "plugins", "cache", marketplace, name);
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function ensureMarketplaceEntry(root, name) {
  const manifestPath = path.join(root, ".agents", "plugins", "marketplace.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
  if (plugins.some((plugin) => plugin?.name === name)) return;
  plugins.push({
    name,
    source: { source: "local", path: `./plugins/${name}` },
    policy: { installation: "AVAILABLE", authentication: "ON_USE" },
    category: "Productivity"
  });
  manifest.plugins = plugins;
  fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);
}

/** Replaces `<marketplace>/plugins/<name>` with the source copy; returns a restore function. */
function replaceMarketplacePlugin(root, name, sourceDir) {
  const pluginsDir = path.join(root, "plugins");
  const target = path.join(pluginsDir, name);
  const staging = path.join(pluginsDir, `.${name}.staging-${process.pid}`);
  const previous = path.join(pluginsDir, `.${name}.previous-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(sourceDir, staging, { recursive: true, filter: (file) => !path.basename(file).startsWith("._") });
  const hadPrevious = fs.existsSync(target);
  if (hadPrevious) fs.renameSync(target, previous);
  fs.renameSync(staging, target);
  return {
    commit: () => fs.rmSync(previous, { recursive: true, force: true }),
    restore: () => {
      fs.rmSync(target, { recursive: true, force: true });
      if (hadPrevious) fs.renameSync(previous, target);
    }
  };
}

export function syncPlugins(args, runCodex = defaultRunCodex) {
  const root = marketplaceRoot(args.codexHome, args.marketplace);
  const results = [];
  const sourceNames = fs.existsSync(args.source)
    ? fs
        .readdirSync(args.source, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const name of sourceNames) {
    const sourceDir = path.join(args.source, name);
    const version = readPluginVersion(sourceDir);
    const before = installedVersions(args.codexHome, args.marketplace, name);
    const result = { name, version, previousVersions: before, installedVersion: before.at(-1) ?? null, status: "current" };
    results.push(result);
    try {
      if (!version) throw new Error("plugin.json has no version");
      if (!root) throw new Error(`marketplace ${args.marketplace} is not configured in ${args.codexHome}/config.toml`);
      const sourceDigest = pluginDigest(sourceDir);
      const installedDir = path.join(args.codexHome, "plugins", "cache", args.marketplace, name, version);
      if (pluginDigest(installedDir) === sourceDigest && pluginDigest(path.join(root, "plugins", name)) === sourceDigest) {
        result.installedVersion = version;
        continue;
      }
      if (args.check) {
        result.status = "outdated";
        continue;
      }
      ensureMarketplaceEntry(root, name);
      const swap = replaceMarketplacePlugin(root, name, sourceDir);
      try {
        runCodex(args, ["plugin", "add", `${name}@${args.marketplace}`]);
        if (pluginDigest(installedDir) !== sourceDigest) {
          throw new Error(`installed files under ${installedDir} do not match the repository copy`);
        }
      } catch (error) {
        swap.restore();
        throw error;
      }
      swap.commit();
      result.installedVersion = version;
      result.status = "updated";
    } catch (error) {
      result.status = "failed";
      result.detail = error instanceof Error ? error.message : String(error);
      const now = installedVersions(args.codexHome, args.marketplace, name);
      result.installedVersion = now.at(-1) ?? null;
    }
  }
  return { checkedAt: new Date().toISOString(), marketplace: args.marketplace, marketplaceRoot: root, plugins: results };
}

function defaultRunCodex(args, codexArgs) {
  execFileSync(args.codexBin, codexArgs, {
    env: { ...process.env, CODEX_HOME: args.codexHome },
    cwd: args.codexHome,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000
  });
}

function writeState(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const report = syncPlugins(args);
  if (args.state && !args.check) writeState(args.state, report);
  for (const plugin of report.plugins) {
    const versions = plugin.previousVersions.join(",") || "none";
    console.log(`${plugin.name}: ${plugin.status} (repo ${plugin.version ?? "?"}, installed before ${versions})${plugin.detail ? ` - ${plugin.detail}` : ""}`);
  }
  process.exit(report.plugins.some((plugin) => plugin.status === "failed" || plugin.status === "outdated") ? 1 : 0);
}
