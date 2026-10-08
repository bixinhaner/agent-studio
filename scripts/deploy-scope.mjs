#!/usr/bin/env node
// Decide which deploy targets a set of changed files affects, so routine
// deploys only rebuild and restart what actually changed. Restarting the chat
// service interrupts conversations, so unknown paths conservatively require it.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEPLOY_TARGETS = ["frontend", "admin", "chat", "caddy"];

const NONE = [];
const BACKEND = ["admin", "chat"];

// First matching rule wins. Patterns are matched against repo-relative paths.
const RULES = [
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

  { pattern: /^scripts\/shared-runtime\/(thread-cleanup\.sh|gap-scan\.py|codex-home-dedupe\.py|disk-usage-snapshot\.py)$/, targets: ["admin"], reason: "shared runtime maintenance jobs" },
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

export function classifyPath(file) {
  for (const rule of RULES) {
    if (rule.pattern.test(file)) return { targets: rule.targets, reason: rule.reason };
  }
  return { targets: BACKEND, reason: "unclassified path" };
}

/** @returns {{ targets: Record<string, boolean>, reasons: Record<string, string[]> }} */
export function classifyChanges(files) {
  const targets = Object.fromEntries(DEPLOY_TARGETS.map((target) => [target, false]));
  const reasons = Object.fromEntries(DEPLOY_TARGETS.map((target) => [target, []]));
  for (const file of files) {
    const { targets: affected, reason } = classifyPath(file);
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
  for (const target of DEPLOY_TARGETS) {
    const files = changedFiles(repo, bases[target], head);
    if (files === null) {
      plan[target] = true;
      reasons[target] = [`no recorded deployed commit for ${target}`];
      continue;
    }
    const result = classifyChanges(files);
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
