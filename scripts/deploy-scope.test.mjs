import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { adminOnlyFiles, classifyChanges, planDeploy, runtimeImports } from "./deploy-scope.mjs";

test("frontend-only and documentation changes never touch the APIs", () => {
  const { targets } = classifyChanges([
    "agent-ui/src/features/monitoring/OperationsAnalyticsView.tsx",
    "docs/deploy.md",
    "AGENTS.md",
    "agent-api/src/admin/operations-insights.test.ts"
  ]);
  assert.deepEqual(targets, { frontend: true, admin: false, chat: false, caddy: false });
});

test("admin-only backend modules restart admin but keep chat running", () => {
  const { targets } = classifyChanges([
    "agent-api/src/admin/operations-insights.ts",
    "agent-api/src/org-sync/service.ts",
    "agent-api/src/ops/report.ts",
    "agent-api/src/portal/team-usage-service.ts",
    "agent-api/src/portal/personal-usage-service.ts"
  ]);
  assert.deepEqual(targets, { frontend: false, admin: true, chat: false, caddy: false });
});

test("shared backend, migrations and unknown paths conservatively restart chat", () => {
  for (const file of [
    "agent-api/src/index.ts",
    "agent-api/src/operations/codex-quota-snapshot-service.ts",
    "agent-api/prisma/schema.prisma",
    "agent-api/package-lock.json",
    "templates/pm2-ecosystem.config.cjs.template",
    "some-new-top-level/file.ts"
  ]) {
    const { targets } = classifyChanges([file]);
    assert.equal(targets.chat, true, file);
    assert.equal(targets.admin, true, file);
  }
});

test("runtime prerequisites restart chat only and Caddy template refreshes Caddy only", () => {
  assert.deepEqual(classifyChanges(["scripts/plugin-runtime-requirements.json"]).targets, {
    frontend: false,
    admin: false,
    chat: true,
    caddy: false
  });
  assert.deepEqual(classifyChanges(["scripts/shared-runtime/python-requirements.txt"]).targets, {
    frontend: false,
    admin: false,
    chat: true,
    caddy: false
  });
  assert.deepEqual(classifyChanges(["templates/Caddyfile.template", "scripts/deploy-agent-studio.sh"]).targets, {
    frontend: false,
    admin: false,
    chat: false,
    caddy: true
  });
});

test("shared runtime maintenance jobs reinstall with an admin restart only", () => {
  assert.deepEqual(
    classifyChanges([
      "scripts/shared-runtime/thread-cleanup.sh",
      "scripts/shared-runtime/chat-watchdog.sh",
      "scripts/shared-runtime/gap-scan.py",
      "scripts/shared-runtime/codex-home-dedupe.py",
      "scripts/shared-runtime/disk-usage-snapshot.py",
      "templates/shared-runtime/agent-studio-runtime-gap-scan.timer.template",
      "templates/shared-runtime/agent-studio-chat-watchdog.timer.template",
      "templates/shared-runtime/agent-studio-disk-usage-snapshot.service.template"
    ]).targets,
    { frontend: false, admin: true, chat: false, caddy: false }
  );
});

test("repository-managed Codex plugins, including SKILL.md, deploy with an admin restart only", () => {
  assert.deepEqual(
    classifyChanges([
      "scripts/shared-runtime/codex-plugins/visualize/skills/visualize/SKILL.md",
      "scripts/shared-runtime/codex-plugins/visualize/.codex-plugin/plugin.json",
      "scripts/shared-runtime/sync-codex-plugins.mjs"
    ]).targets,
    { frontend: false, admin: true, chat: false, caddy: false }
  );
});

test("each target diffs from its own deployed commit so deferred restarts catch up", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "deploy-scope-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const commit = (file, message) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), message);
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    const first = commit("agent-api/src/index.ts", "one");
    const chatChange = commit("agent-api/src/live-runtime-session.ts", "two");
    const head = commit("agent-api/src/admin/router.ts", "three");

    const { plan } = planDeploy({
      repo,
      head,
      // chat restart was deferred at `first`; admin and frontend already run `chatChange`.
      bases: { frontend: chatChange, admin: chatChange, chat: first, caddy: chatChange }
    });
    assert.deepEqual(plan, { frontend: false, admin: true, chat: true, caddy: false });

    const unknown = planDeploy({ repo, head, bases: { frontend: head, admin: head, chat: "deadbeef", caddy: "" } });
    assert.deepEqual(unknown.plan, { frontend: false, admin: false, chat: true, caddy: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runtime imports ignore type-only imports and keep side-effect and dynamic imports", () => {
  const source = [
    'import { a } from "./a.js";',
    'import type { B } from "./b.js";',
    'import {\n  type C,\n  type D\n} from "./c.js";',
    'import { type E, e } from "./e.js";',
    'import "./side-effect.js";',
    'export { f } from "./f.js";',
    'export type { G } from "./g.js";',
    'export * from "./h.js";',
    'const lazy = await import("./lazy.js");',
    'import express from "express";',
    'export const value = 1; const from = "./not-an-import.js";'
  ].join("\n");
  assert.deepEqual(runtimeImports(source).sort(), ["./a.js", "./e.js", "./f.js", "./h.js", "./lazy.js", "./side-effect.js"]);
});

test("backend files only admin entry modules load are admin-only; shared and unimported files are not", () => {
  const files = new Map([
    ["agent-api/src/index.ts", [
      'import { createAccessRequestService } from "./access-requests/service.js";',
      'import { createAuthRouter } from "./auth/router.js";',
      'import { resolveCrestUser } from "./auth/crest-user.js";',
      'import { threads } from "./portal/router.js";'
    ].join("\n")],
    ["agent-api/src/access-requests/service.ts", 'import { invites } from "../persistence/invites.js";\nimport { proof } from "./proof.js";'],
    ["agent-api/src/access-requests/proof.ts", ""],
    ["agent-api/src/auth/router.ts", 'import { resolveCrestUser } from "./crest-user.js";\nimport { entry } from "./email-entry.js";'],
    ["agent-api/src/auth/email-entry.ts", ""],
    ["agent-api/src/auth/crest-user.ts", 'import type { CrestExchangeIdentity } from "./router.js";'],
    ["agent-api/src/portal/router.ts", 'import { invites } from "../persistence/invites.js";'],
    ["agent-api/src/persistence/invites.ts", ""],
    ["agent-api/src/files/preview-child.ts", ""]
  ]);

  assert.deepEqual([...adminOnlyFiles(files)].sort(), [
    "agent-api/src/access-requests/proof.ts",
    "agent-api/src/access-requests/service.ts",
    "agent-api/src/auth/email-entry.ts",
    "agent-api/src/auth/router.ts"
  ]);

  const adminOnly = adminOnlyFiles(files);
  assert.deepEqual(classifyChanges(["agent-api/src/access-requests/service.ts", "agent-api/src/auth/router.ts"], { adminOnly }).targets,
    { frontend: false, admin: true, chat: false, caddy: false });
  for (const file of ["agent-api/src/persistence/invites.ts", "agent-api/src/files/preview-child.ts", "agent-api/src/index.ts"]) {
    assert.equal(classifyChanges([file], { adminOnly }).targets.chat, true, `${file} should restart chat`);
  }
});

test("the deploy plan reads the import graph at the deployed commit", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "deploy-scope-graph-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const commit = (file, content) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", file);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    commit("agent-api/src/access-requests/helper.ts", "export const x = 1;");
    const base = commit("agent-api/src/index.ts", 'import { createAccessRequestService } from "./access-requests/service.js";');
    commit("agent-api/src/access-requests/service.ts", 'import { x } from "./helper.js";');
    const head = commit("agent-api/src/access-requests/helper.ts", "export const x = 2;");

    const { plan, reasons } = planDeploy({ repo, head, bases: { frontend: base, admin: base, chat: base, caddy: base } });
    assert.deepEqual(plan, { frontend: false, admin: true, chat: false, caddy: false });
    assert.match(reasons.admin.join("\n"), /not loaded by chat code/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
