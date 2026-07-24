#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const result = {
    pluginRoots: [],
    requirements: path.resolve("scripts/plugin-runtime-requirements.json"),
    nodeModules: "",
    pythonRoot: "",
    verbose: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--plugin-root" && next) {
      result.pluginRoots.push(path.resolve(next));
      index += 1;
    } else if (value === "--requirements" && next) {
      result.requirements = path.resolve(next);
      index += 1;
    } else if (value === "--node-modules" && next) {
      result.nodeModules = path.resolve(next);
      index += 1;
    } else if (value === "--python-root" && next) {
      result.pythonRoot = path.resolve(next);
      index += 1;
    } else if (value === "--verbose") {
      result.verbose = true;
    } else {
      throw new Error(`unknown or incomplete argument: ${value}`);
    }
  }
  return result;
}

function walk(root, visit) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const normalized = current.split(path.sep);
    const cacheIndex = normalized.lastIndexOf("cache");
    if (cacheIndex >= 0 && normalized.slice(cacheIndex + 1).length === 3) {
      const manifest = path.join(current, ".codex-plugin", "plugin.json");
      if (fs.existsSync(manifest)) visit({ type: "manifest", path: manifest });
      const skillsRoot = path.join(current, "skills");
      if (fs.existsSync(skillsRoot)) {
        for (const skillEntry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
          const skillRoot = path.join(skillsRoot, skillEntry.name);
          if (
            (skillEntry.isDirectory() || skillEntry.isSymbolicLink()) &&
            fs.existsSync(path.join(skillRoot, "SKILL.md"))
          ) {
            visit({ type: "skill", path: path.join(skillRoot, "SKILL.md"), name: skillEntry.name });
          }
        }
      }
      continue;
    }
    if (cacheIndex < 0 && path.basename(current) === "skills") {
      for (const skillEntry of fs.readdirSync(current, { withFileTypes: true })) {
        const skillRoot = path.join(current, skillEntry.name);
        if (
          (skillEntry.isDirectory() || skillEntry.isSymbolicLink()) &&
          fs.existsSync(path.join(skillRoot, "SKILL.md"))
        ) {
          visit({ type: "skill", path: path.join(skillRoot, "SKILL.md"), name: skillEntry.name });
        }
      }
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(target);
          if (stat.isDirectory() && fs.existsSync(path.join(target, "SKILL.md"))) {
            visit({ type: "skill", path: path.join(target, "SKILL.md"), name: entry.name });
          }
        } catch {
          if (target.includes(`${path.sep}plugins${path.sep}`) || target.includes(`${path.sep}skills${path.sep}`)) {
            visit({ type: "broken-symlink", path: target });
          }
        }
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile() && entry.name === "plugin.json" && path.basename(path.dirname(target)) === ".codex-plugin") {
        visit({ type: "manifest", path: target });
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        visit({ type: "skill", path: target, name: path.basename(path.dirname(target)) });
      }
    }
  }
}

function cachePluginCoordinates(manifestPath) {
  const normalized = manifestPath.split(path.sep);
  const cacheIndex = normalized.lastIndexOf("cache");
  if (cacheIndex < 0) return undefined;
  const tail = normalized.slice(cacheIndex + 1);
  if (tail.length !== 5 || tail[3] !== ".codex-plugin" || tail[4] !== "plugin.json") return undefined;
  return {
    marketplace: tail[0],
    cacheName: tail[1],
    version: tail[2]
  };
}

function compareVersions(left, right) {
  const parse = (value) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v "$1" >/dev/null 2>&1`, "check-plugin-runtime", command]).status === 0;
}

function checkPythonImports(imports, pythonRoot) {
  if (imports.length === 0) return [];
  const script = [
    "import importlib, json",
    `names = ${JSON.stringify(imports)}`,
    "missing = []",
    "for name in names:",
    "    try:",
    "        importlib.import_module(name)",
    "    except Exception:",
    "        missing.append(name)",
    "print(json.dumps(missing))"
  ].join("\n");
  const env = { ...process.env };
  if (pythonRoot) {
    env.PYTHONPATH = [pythonRoot, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  }
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8", env });
  if (result.status !== 0) return imports;
  return JSON.parse(result.stdout || "[]");
}

function checkNodePackage(definition, nodeModules) {
  const packageRoot = path.join(nodeModules, ...definition.name.split("/"));
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return `${definition.name}: package.json is missing`;
  }
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return `${definition.name}: package.json is invalid`;
  }
  if (definition.minimumVersion && compareVersions(String(packageJson.version || "0"), definition.minimumVersion) < 0) {
    return `${definition.name}: ${packageJson.version || "unknown"} is below ${definition.minimumVersion}`;
  }
  if (definition.entrypoints?.length && !definition.entrypoints.some((entrypoint) => fs.existsSync(path.join(packageRoot, entrypoint)))) {
    return `${definition.name}: expected entrypoint is missing`;
  }
  return undefined;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(args.requirements, "utf8"));
  const manifests = new Map();
  const discoveredSkills = new Set();
  const brokenSymlinks = [];
  for (const root of args.pluginRoots) {
    walk(root, (entry) => {
      if (entry.type === "broken-symlink") {
        brokenSymlinks.push(entry.path);
        return;
      }
      if (entry.type === "skill") {
        discoveredSkills.add(entry.name);
        return;
      }
      const coordinates = cachePluginCoordinates(entry.path);
      if (!coordinates) return;
      try {
        const manifest = JSON.parse(fs.readFileSync(entry.path, "utf8"));
        const name = String(manifest.name || coordinates.cacheName);
        manifests.set(`${name}@${coordinates.version}`, {
          name,
          version: coordinates.version,
          path: entry.path
        });
      } catch {
        manifests.set(`invalid:${entry.path}`, {
          name: coordinates.cacheName,
          version: coordinates.version,
          path: entry.path,
          invalid: true
        });
      }
    });
  }

  const installedNames = new Set([
    ...[...manifests.values()].map((item) => item.name),
    ...discoveredSkills
  ]);
  const requiredDefinitions = Object.entries(registry.plugins).filter(([name]) => installedNames.has(name));
  const requiredCommands = [...new Set(requiredDefinitions.flatMap(([, item]) => item.commands || []))];
  const requiredPythonImports = [...new Set(requiredDefinitions.flatMap(([, item]) => item.pythonImports || []))];
  const requiredNodePackages = new Map();
  for (const [, item] of requiredDefinitions) {
    for (const definition of item.nodePackages || []) {
      requiredNodePackages.set(definition.name, definition);
    }
  }

  const problems = [];
  for (const item of manifests.values()) {
    if (item.invalid) problems.push(`invalid plugin manifest: ${item.path}`);
  }
  for (const symlink of brokenSymlinks) {
    problems.push(`broken plugin/runtime symlink: ${symlink}`);
  }
  for (const command of requiredCommands) {
    if (!commandExists(command)) problems.push(`missing command: ${command}`);
  }
  for (const importName of checkPythonImports(requiredPythonImports, args.pythonRoot)) {
    problems.push(`missing Python import: ${importName}`);
  }
  if (requiredNodePackages.size > 0 && !args.nodeModules) {
    problems.push("shared Node runtime path was not provided");
  } else {
    for (const definition of requiredNodePackages.values()) {
      const problem = checkNodePackage(definition, args.nodeModules);
      if (problem) problems.push(problem);
    }
  }

  const report = {
    brokenSymlinks,
    checkedPluginVersions: manifests.size,
    installedPluginCount: installedNames.size,
    installedPlugins: requiredDefinitions.map(([name]) => name).sort(),
    problems,
    runtimeCheckedPlugins: requiredDefinitions.map(([name]) => name).sort()
  };
  if (args.verbose) {
    report.discoveredSkills = [...discoveredSkills].sort();
    report.allInstalledPlugins = [...installedNames].sort();
  }
  console.log(JSON.stringify(report, null, 2));
  return problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
