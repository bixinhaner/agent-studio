import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { apiProfileSchema } from "./api-profile.js";

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../../../bundled-skills/netopt-operations");
const loaderPath = path.join(skillRoot, "scripts/ensure-handbook.mjs");
// The package a business system's agent host generates from its capability registry.
const hostHandbookModule = path.resolve(testDirectory, "../../../../packages/local-bridge/service/handbook.cjs");
const { buildHandbook } = require(hostHandbookModule);

function run(cwd: string, args: string[], env: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("bundled network optimization Skill", () => {
  it("ships the Skill with both channels and the evidence rules", async () => {
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    expect(await readdir(skillRoot)).toEqual(expect.arrayContaining(["SKILL.md", "agents", "scripts"]));
    expect(skill).toMatch(/^---\nname: netopt-operations\n/);
    for (const text of ["local_workspace_info", "scripts/ensure-handbook.mjs", "CONFIRMATION_REQUIRED", "unknown, not zero", "## Progress updates", "Never present your own recomputation as the official figure"]) {
      expect(skill).toContain(text);
    }
    expect(await readFile(loaderPath, "utf8")).not.toMatch(/BOSS|boss/);
  });

  it("loads the handbook an agent host builds from a capability registry, under the default connector profile", async () => {
    const profile = apiProfileSchema.parse({ sourceName: "网规网优助手", skillName: "netopt-operations" });
    const workspace = await mkdtemp(path.join(tmpdir(), "netopt-handbook-loader-"));
    const manifestPath = path.join(workspace, "capabilities.json");
    await writeFile(manifestPath, JSON.stringify({
      sourceName: "网规网优助手",
      commonOperations: "# 常用操作\n",
      categories: [{ id: "project", title: "项目" }],
      operations: [
        { operationId: "netopt.project.overview", method: "GET", path: "/api/v1/netopt/projects/{projectId}/overview", category: "project", title: "项目概览" },
        { operationId: "netopt.followup.create", method: "POST", path: "/api/v1/netopt/projects/{projectId}/followups", category: "project", title: "登记整改跟进", risk: "low" }
      ]
    }));
    const cliPath = path.join(workspace, "fake-cli.cjs");
    await writeFile(cliPath, `
const book = require(${JSON.stringify(hostHandbookModule)}).buildHandbook(JSON.parse(require("node:fs").readFileSync(process.env.CAPABILITIES, "utf8")));
const command = process.argv[2];
if (command === "identity") console.log(JSON.stringify({ externalIdentity: { metadata: { apiHandbook: book.meta } } }));
else if (command === "profile") console.log(process.env.PROFILE);
else if (command === "request") console.log(JSON.stringify(book.discovery(process.argv[3], process.argv[4], JSON.parse(process.argv[5]).query || {})));
else process.exit(2);
`);
    const env = { CAPABILITIES: manifestPath, PROFILE: JSON.stringify(profile) };
    const first = await run(workspace, [loaderPath, "--cli", cliPath], env);
    expect(first.code, first.stderr).toBe(0);
    const result = JSON.parse(first.stdout) as { status: string; handbookRoot: string; indexPath: string; totalOperations: number; handbookDigest: string };
    expect(result).toMatchObject({ status: "downloaded", totalOperations: 2, handbookDigest: buildHandbook(JSON.parse(await readFile(manifestPath, "utf8"))).meta.handbookDigest });
    expect(result.handbookRoot).toContain(path.join(".agent-studio", "netopt-handbooks"));
    expect((await readFile(result.indexPath, "utf8")).trim().split("\n")).toHaveLength(2);
    const doc = JSON.parse(await readFile(path.join(result.handbookRoot, "api-docs", "netopt.followup.create.json"), "utf8"));
    expect(doc).toMatchObject({ risk: "low", confirmationRequired: true, method: "POST" });
    expect(JSON.parse((await run(workspace, [loaderPath, "--cli", cliPath], env)).stdout)).toMatchObject({ status: "cached" });
  }, 20_000);
});
