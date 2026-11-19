#!/usr/bin/env node
// Decide which deploy targets a set of changed files affects, so routine
// deploys only rebuild and restart what actually changed. Restarting the chat
// service interrupts conversations, so unknown paths conservatively require it.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEPLOY_TARGETS = ["frontend", "admin", "chat", "caddy"];

const NONE = [];
const BACKEND = ["admin", "chat"];

// First matching rule wins. Patterns are matched against repo-relative paths.
const RULES = [
  // Repo-managed Codex plugins (SKILL.md included) are synced on any backend deploy and read
  // by new conversations directly, so an admin restart is enough; checked before `.md` docs.
  {
    pattern: /^scripts\/shared-runtime\/(codex-plugins\/|sync-codex-plugins\.mjs$)/,
    targets: ["admin"],
    reason: "repository-managed Codex plugins"
  },
  // Documentation, CI, local tooling and desktop packages never run on the server.
  { pattern: /(^|\/)[^/]+\.md$/, targets: NONE, reason: "documentation" },
  { pattern: /^(docs|deliverables|tmp|temp|\.github|packages)\//, targets: NONE, reason: "non-server files" },
  { pattern: /^(\.gitignore|docker-compose\.dev\.yml)$/, targets: NONE, reason: "repository metadata" },

  // Tests and examples are not part of the runtime.
  { pattern: /^agent-(api|ui)\/.*\.test\.(ts|tsx|mjs|js)$/, targets: NONE, reason: "tests" },
  { pattern: /^agent-api\/\.env\.example$/, targets: NONE, reason: "env example" },

  { pattern: /^agent-ui\//, targets: ["frontend"], reason: "frontend" },

  // Read from the live checkout through process.cwd(), so no restart is needed.
  { pattern: /^agent-api\/templates\//, targets: NONE, reason: "runtime templates read from checkout" },
  // Only mounted behind admin routes or run by admin-role schedulers / CLIs.
  { pattern: /^agent-api\/src\/(admin|org-sync|ops)\//, targets: ["admin"], reason: "admin-only backend" },
  // Portal usage statistics are routed to admin by Caddy.
  { pattern: /^agent-api\/src\/portal\/(team|personal)-usage-service\.ts$/, targets: ["admin"], reason: "admin-served portal statistics" },
  { pattern: /^agent-api\//, targets: BACKEND, reason: "backend" },

  { pattern: /^templates\/Caddyfile\.template$/, targets: ["caddy"], reason: "Caddy template" },
  // Server maintenance jobs are installed whenever admin restarts; no chat restart needed.
  { pattern: /^templates\/shared-runtime\//, targets: ["admin"], reason: "shared runtime maintenance jobs" },
  { pattern: /^templates\/pm2-ecosystem\.config\.cjs\.template$/, targets: BACKEND, reason: "PM2 template" },
  { pattern: /^templates\//, targets: NONE, reason: "install templates" },

  { pattern: /^scripts\/shared-runtime\/(thread-cleanup\.sh|chat-watchdog\.sh|gap-scan\.py|codex-home-dedupe\.py|disk-usage-snapshot\.py)$/, targets: ["admin"], reason: "shared runtime maintenance jobs" },
  // Conversation runtime prerequisites are only installed when chat restarts.
  {
    pattern:
      /^scripts\/(runtime-wrappers\/|runtime-fontconfig\/|shared-runtime\/|plugin-runtime-requirements\.json$|ensure-dws-runtime\.sh$|check-plugin-runtime\.mjs$|smoke-shared-plugin-runtime\.mjs$|build-shared-codex-runtime-archive\.sh$)/,
    targets: ["chat"],
    reason: "conversation runtime prerequisites"
  },
  // Deploy tooling takes effect on the next deploy run by itself.
  { pattern: /^scripts\//, targets: NONE, reason: "deploy tooling" }
];

// ---------------------------------------------------------------------------
// Chat reachability. Both services run the same backend, but Caddy only sends
// conversation paths to chat. A backend source file that chat code can never
// load (following runtime imports) only needs an admin restart.

const BACKEND_SRC = "agent-api/src/";
const BACKEND_ENTRY = `${BACKEND_SRC}index.ts`;

// Modules index.ts imports that are only used behind admin-routed paths. They
// are not treated as chat entry points, so what they alone import is admin-only.
// Keep each entry verified against templates/Caddyfile.template (@chat_api) and
// index.ts: chat must never call into them.
export const ADMIN_ONLY_ENTRY_MODULES = [
  // /api/admin/access-requests, /api/access-requests-review, /public-api/access-request*; the
  // service is otherwise only called from the sign-in router's invite acceptance (/api/auth).
  "agent-api/src/access-requests/admin-router.ts",
  "agent-api/src/access-requests/public-router.ts",
  "agent-api/src/access-requests/review-router.ts",
  "agent-api/src/access-requests/service.ts",
  "agent-api/src/access-requests/purchase-proof-storage.ts",
  // /api/auth (createAuthRouter). CREST user resolution used by chat lives in auth/crest-user.ts.
  "agent-api/src/auth/router.ts",
  // Mounted under /api/admin in app-routes.ts.
  "agent-api/src/public-brands/admin-router.ts",
  "agent-api/src/skill-catalog/router.ts",
  // /api/org-team, /api/admin/org-team, /public-api/org-join-requests (customer admin team management).
  "agent-api/src/org-team/router.ts",
  "agent-api/src/org-team/service.ts",
  "agent-api/src/org-team/store.ts"
];

const ADMIN_ONLY_ENTRY_PATTERN = /^agent-api\/src\/(admin|org-sync|ops)\//;

function isBackendSource(file) {
  return file.startsWith(BACKEND_SRC) && /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file);
}

/** Runtime (non type-only) relative imports of a TypeScript module. */
export function runtimeImports(source) {
  const specifiers = [];
  const statement = /(?:^|[\n;])\s*(import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    const [, keyword, clause, specifier] = match;
    if (/^type\s/.test(clause)) continue;
    if (keyword === "export" && !/^(\{|\*)/.test(clause)) continue;
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces && !/^[\w$]+\s*,/.test(clause) && !/^\*/.test(clause)) {
      const names = braces[1].split(",").map((name) => name.trim()).filter(Boolean);
      if (names.length && names.every((name) => /^type\s/.test(name))) continue;
    }
    specifiers.push(specifier);
  }
  for (const match of source.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers.filter((specifier) => specifier.startsWith("."));
}

function resolveImport(fromFile, specifier, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const stem = base.replace(/\.(js|mjs|cjs|ts|tsx)$/, "");
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, base]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

function reachableFrom(files, skipFromEntry) {
  const reachable = new Set([BACKEND_ENTRY]);
  const queue = [BACKEND_ENTRY];
  while (queue.length) {
    const file = queue.pop();
    for (const specifier of runtimeImports(files.get(file) ?? "")) {
      const target = resolveImport(file, specifier, files);
      if (!target || reachable.has(target)) continue;
      if (file === BACKEND_ENTRY && skipFromEntry(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
}

/**
 * Backend source files only admin code loads: reachable from index.ts, but
 * never without passing through an admin-only entry module. Files index.ts
 * never imports (child processes, CLIs, backfills) are not included, so they
 * keep the conservative backend rule.
 * @param {Map<string, string>} files repo-relative path -> source
 */
export function adminOnlyFiles(files) {
  const adminEntries = new Set(ADMIN_ONLY_ENTRY_MODULES);
  const all = reachableFrom(files, () => false);
  const chat = reachableFrom(files, (target) => adminEntries.has(target) || ADMIN_ONLY_ENTRY_PATTERN.test(target));
  return new Set([...all].filter((file) => !chat.has(file)));
}

function backendSourcesAt(repo, head) {
  const listing = execFileSync("git", ["-C", repo, "ls-tree", "-r", head, "--", BACKEND_SRC], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const entries = listing
    .split("\n")
    .map((line) => line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/))
    .filter((match) => match && isBackendSource(match[2]))
    .map((match) => ({ oid: match[1], file: match[2] }));
  // One `git cat-file --batch` call instead of a process per file.
  const output = execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
    input: entries.map((entry) => entry.oid).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024
  });
  const files = new Map();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(10, offset);
    const size = Number(output.subarray(offset, headerEnd).toString("utf8").split(" ")[2]);
    files.set(entry.file, output.subarray(headerEnd + 1, headerEnd + 1 + size).toString("utf8"));
    offset = headerEnd + 1 + size + 1;
  }
  return files;
}

export function classifyPath(file, options = {}) {
  for (const rule of RULES) {
    if (!rule.pattern.test(file)) continue;
    if (rule.reason === "backend" && options.adminOnly?.has(file)) {
      return { targets: ["admin"], reason: "not loaded by chat code" };
    }
    return { targets: rule.targets, reason: rule.reason };
  }
  return { targets: BACKEND, reason: "unclassified path" };
}

/** @returns {{ targets: Record<string, boolean>, reasons: Record<string, string[]> }} */
export function classifyChanges(files, options = {}) {
  const targets = Object.fromEntries(DEPLOY_TARGETS.map((target) => [target, false]));
  const reasons = Object.fromEntries(DEPLOY_TARGETS.map((target) => [target, []]));
  for (const file of files) {
    const { targets: affected, reason } = classifyPath(file, options);
    for (const target of affected) {
      targets[target] = true;
      if (reasons[target].length < 5) reasons[target].push(`${file} (${reason})`);
    }
  }
  return { targets, reasons };
}

function changedFiles(repo, base, head) {
  if (!base) return null;
  try {
    execFileSync("git", ["-C", repo, "cat-file", "-e", `${base}^{commit}`], { stdio: "ignore" });
  } catch {
    return null;
  }
  const output = execFileSync("git", ["-C", repo, "diff", "--name-only", `${base}..${head}`], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

/**
 * Each target is compared against the commit it last deployed, so a target
 * skipped earlier (for example a deferred chat restart) still catches up.
 * A missing or unknown base means the target's state is unknown: deploy it.
 */
export function planDeploy({ repo, head, bases }) {
  const plan = {};
  const reasons = {};
  let adminOnly;
  try {
    adminOnly = adminOnlyFiles(backendSourcesAt(repo, head));
  } catch {
    // Without the import graph every backend change conservatively restarts chat.
    adminOnly = undefined;
  }
  for (const target of DEPLOY_TARGETS) {
    const files = changedFiles(repo, bases[target], head);
    if (files === null) {
      plan[target] = true;
      reasons[target] = [`no recorded deployed commit for ${target}`];
      continue;
    }
    const result = classifyChanges(files, { adminOnly });
    plan[target] = result.targets[target];
    reasons[target] = result.reasons[target];
  }
  return { plan, reasons };
}

function parseArgs(argv) {
  const args = { bases: {} };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1] ?? "";
    if (key === "--repo") args.repo = value;
    else if (key === "--head") args.head = value;
    else if (key.startsWith("--") && key.endsWith("-base")) args.bases[key.slice(2, -5)] = value;
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!args.repo || !args.head) throw new Error("--repo and --head are required");
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { plan, reasons } = planDeploy(parseArgs(process.argv.slice(2)));
  // Shell-readable output: PLAN_<TARGET>=0|1 lines, reasons on stderr.
  for (const target of DEPLOY_TARGETS) {
    process.stdout.write(`PLAN_${target.toUpperCase()}=${plan[target] ? 1 : 0}\n`);
    for (const reason of reasons[target]) process.stderr.write(`  ${target}: ${reason}\n`);
  }
}
