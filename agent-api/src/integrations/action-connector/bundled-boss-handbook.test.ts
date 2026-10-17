import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { BOSS_API_PROFILE } from "./api-profile.fixtures.js";
import { tarArchive } from "./handbook-archive.fixtures.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../../../bundled-skills/boss-operations");
const loaderPath = path.join(skillRoot, "scripts/ensure-handbook.mjs");

function runLoader(workspace: string, cliPath: string, fixturePath: string, logPath: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [loaderPath, "--cli", cliPath], {
      cwd: workspace,
      env: { ...process.env, HANDBOOK_FIXTURE: fixturePath, HANDBOOK_LOG: logPath },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function fixtureWorkspace(identityOverrides: Record<string, unknown> = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "boss-handbook-loader-"));
  const cliPath = path.join(workspace, "fake-cli.mjs");
  const fixturePath = path.join(workspace, "fixture.json");
  const logPath = path.join(workspace, "requests.log");
  const manifest = { schemaVersion: "1.0", catalogVersion: "boss-v1", totalOperations: 1, searchIndex: "api-index.jsonl", categories: [] };
  const archive = tarArchive({
    "references/manifest.json": JSON.stringify(manifest),
    "references/api-index.jsonl": '{"operationId":"payment.list_recharges"}\n',
    "references/common-operations.md": "# Common operations\n",
    "references/api-docs/payment.list_recharges.json": '{"operationId":"payment.list_recharges"}'
  });
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  const chunkBytes = Math.ceil(archive.length / 2);
  const chunks = [archive.subarray(0, chunkBytes), archive.subarray(chunkBytes)].map((data, index) => ({
    handbookDigest: digest, index, totalChunks: 2, bytes: data.length, encoding: "base64", data: data.toString("base64")
  }));
  const packageManifest = {
    ...manifest,
    handbookDigest: digest,
    manifestPath: BOSS_API_PROFILE.handbook.manifestPath,
    chunkPathTemplate: BOSS_API_PROFILE.handbook.chunkPathTemplate,
    archiveFormat: "tar+gzip",
    archiveBytes: archive.length,
    chunkBytes,
    totalChunks: chunks.length,
    contentRoot: "references"
  };
  await writeFile(fixturePath, JSON.stringify({ manifest: packageManifest, identity: { ...packageManifest, packageAvailable: true, ...identityOverrides }, profile: BOSS_API_PROFILE, chunks }));
  await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(process.env.HANDBOOK_FIXTURE, "utf8"));
const command = process.argv[2];
if (command === "identity") console.log(JSON.stringify({ metadata: { apiHandbook: fixture.identity } }));
else if (command === "profile") console.log(JSON.stringify(fixture.profile));
else if (command === "request") {
  appendFileSync(process.env.HANDBOOK_LOG, process.argv[4] + " " + JSON.parse(process.argv[5]).operationId + "\\n");
  const requestPath = process.argv[4];
  if (requestPath.endsWith("/manifest")) console.log(JSON.stringify(fixture.manifest));
  else console.log(JSON.stringify(fixture.chunks[Number(requestPath.split("/").pop())]));
} else process.exit(2);
`);
  return { workspace, cliPath, fixturePath, logPath, digest };
}

describe("bundled BOSS handbook loader", () => {
  it("ships a handbook-required BOSS Skill without OMC paths", async () => {
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const loader = await readFile(loaderPath, "utf8");
    expect(await readdir(skillRoot)).toEqual(expect.arrayContaining(["SKILL.md", "agents", "scripts"]));
    expect(skill).toMatch(/^---\nname: boss-operations\n/);
    expect(skill).toContain("The handbook is mandatory");
    expect(skill).toContain("scripts/ensure-handbook.mjs");
    expect(skill).toContain("unknown, never zero");
    expect(skill).toContain("Investigations are read-only");
    expect(skill.match(/\S+/g)?.length ?? 0).toBeLessThanOrEqual(1_000);
    for (const text of [skill, loader]) expect(text).not.toMatch(/OMC|omc-|\/api\/v1\//);
  });

  it("downloads through the connector profile's paths and operation IDs, then reuses the cache", async () => {
    const fixture = await fixtureWorkspace();
    const first = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(first.code, first.stderr).toBe(0);
    const result = JSON.parse(first.stdout) as { status: string; handbookRoot: string; handbookDigest: string };
    expect(result).toMatchObject({ status: "downloaded", handbookDigest: fixture.digest, catalogVersion: "boss-v1", totalOperations: 1 });
    expect(result.handbookRoot.endsWith(path.join(".agent-studio", "boss-handbooks", fixture.digest.slice(7), "references"))).toBe(true);
    expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toEqual([
      "/api/agent/ai-assistant/handbook/manifest boss.handbook.manifest",
      "/api/agent/ai-assistant/handbook/chunks/0 boss.handbook.chunk",
      "/api/agent/ai-assistant/handbook/chunks/1 boss.handbook.chunk"
    ]);
    const second = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(JSON.parse(second.stdout)).toMatchObject({ status: "cached", handbookDigest: fixture.digest });
    expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toHaveLength(3);
  }, 15_000);

  it.each([
    [{ packageAvailable: false }, "handbook is required"],
    [{ manifestPath: "/api/v1/agent/handbook/manifest" }, "manifestPath is not allowed by the connector API profile"],
    [{ chunkPathTemplate: "/api/agent/other/{index}" }, "chunkPathTemplate is not allowed by the connector API profile"]
  ])("refuses an identity that the profile does not allow: %o", async (overrides, message) => {
    const fixture = await fixtureWorkspace(overrides);
    const result = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`BOSS handbook: `);
    expect(result.stderr).toContain(message);
  });
});
