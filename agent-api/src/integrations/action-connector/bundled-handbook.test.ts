import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../../../bundled-skills/omc-operations");
const loaderPath = path.join(skillRoot, "scripts/ensure-handbook.mjs");

function tarOctal(value: number, length: number): Buffer {
  return Buffer.from(value.toString(8).padStart(length - 1, "0") + "\0", "ascii");
}

function tarArchive(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    tarOctal(0o644, 8).copy(header, 100);
    tarOctal(0, 8).copy(header, 108);
    tarOctal(0, 8).copy(header, 116);
    tarOctal(body.length, 12).copy(header, 124);
    tarOctal(0, 12).copy(header, 136);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    tarOctal([...header].reduce((total, value) => total + value, 0), 8).copy(header, 148);
    blocks.push(header, body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

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

async function fixtureWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), "omc-handbook-loader-"));
  const cliPath = path.join(workspace, "fake-cli.mjs");
  const fixturePath = path.join(workspace, "fixture.json");
  const logPath = path.join(workspace, "requests.log");
  const manifest = {
    schemaVersion: "1.0",
    catalogVersion: "0123456789abcdef",
    totalOperations: 1,
    searchIndex: "api-index.jsonl",
    categories: [{ id: "devices", count: 1, file: "api-categories/devices.json" }]
  };
  const archive = tarArchive({
    "references/manifest.json": JSON.stringify(manifest),
    "references/api-index.jsonl": '{"operationId":"get.devices.stats"}\n',
    "references/common-operations.md": "# Common operations\n",
    "references/api-categories/devices.json": '{"category":"devices"}',
    "references/api-docs/get.devices.stats.json": '{"operationId":"get.devices.stats"}'
  });
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  const chunkBytes = Math.ceil(archive.length / 2);
  const chunks = [archive.subarray(0, chunkBytes), archive.subarray(chunkBytes)].map((data, index) => ({
    handbookDigest: digest,
    index,
    totalChunks: 2,
    bytes: data.length,
    encoding: "base64",
    data: data.toString("base64")
  }));
  const packageManifest = {
    ...manifest,
    handbookDigest: digest,
    manifestPath: "/api/v1/agent/handbook/manifest",
    chunkPathTemplate: "/api/v1/agent/handbook/chunks/{index}",
    archiveFormat: "tar+gzip",
    archiveBytes: archive.length,
    chunkBytes,
    totalChunks: chunks.length,
    contentRoot: "references"
  };
  await writeFile(fixturePath, JSON.stringify({ manifest: packageManifest, chunks }));
  await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(process.env.HANDBOOK_FIXTURE, "utf8"));
const command = process.argv[2];
if (command === "identity") {
  console.log(JSON.stringify({ metadata: { apiHandbook: { ...fixture.manifest, packageAvailable: true } } }));
} else if (command === "request") {
  appendFileSync(process.env.HANDBOOK_LOG, process.argv[4] + "\\n");
  const requestPath = process.argv[4];
  if (requestPath.endsWith("/manifest")) console.log(JSON.stringify(fixture.manifest));
  else console.log(JSON.stringify(fixture.chunks[Number(requestPath.split("/").pop())]));
} else process.exit(2);
`);
  return { workspace, cliPath, fixturePath, logPath, digest };
}

describe("bundled OMC handbook loader", () => {
  it("ships only a generic loader instead of a copied OMC handbook", async () => {
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const entries = await readdir(skillRoot);

    expect(entries).toContain("scripts");
    expect(entries).not.toContain("references");
    expect(skill).toContain("scripts/ensure-handbook.mjs");
    expect(skill).toContain("handbookDigest");
    expect(skill).toContain("`packageAvailable` is `false`");
    expect(skill).toContain("scripts/search-catalog.mjs");
    expect(skill).toContain('node "$CLI" describe');
    expect(skill).toContain("Continue only while discovery yields new relevant evidence");
    expect(skill).toContain("results repeat, or the next query lacks evidence");
    expect(skill).not.toMatch(/at most three|two relevant categories|five candidate documents/);
    expect(skill).toContain("An empty API result means only");
    expect(skill.trimEnd().split("\n").length).toBeLessThanOrEqual(86);
    expect(skill.match(/\S+/g)?.length ?? 0).toBeLessThanOrEqual(665);
    expect(skill).not.toContain("/api/v1/agent/catalog");
    await expect(stat(loaderPath)).resolves.toBeDefined();
  });

  it("downloads, verifies, extracts, and then reuses a digest cache", async () => {
    const fixture = await fixtureWorkspace();
    const first = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(first.code, first.stderr).toBe(0);
    const firstResult = JSON.parse(first.stdout) as {
      status: string;
      handbookRoot: string;
      indexPath: string;
      commonOperationsPath: string;
      manifestPath: string;
      handbookDigest: string;
      catalogVersion: string;
      totalOperations: number;
    };
    expect(firstResult.status).toBe("downloaded");
    expect(firstResult.handbookDigest).toBe(fixture.digest);
    expect(firstResult.catalogVersion).toBe("0123456789abcdef");
    expect(firstResult.totalOperations).toBe(1);
    expect(firstResult.indexPath).toBe(path.join(firstResult.handbookRoot, "api-index.jsonl"));
    expect(firstResult.commonOperationsPath).toBe(path.join(firstResult.handbookRoot, "common-operations.md"));
    expect(firstResult.manifestPath).toBe(path.join(firstResult.handbookRoot, "manifest.json"));
    await expect(readFile(path.join(firstResult.handbookRoot, "api-docs/get.devices.stats.json"), "utf8"))
      .resolves.toContain("get.devices.stats");
    expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toHaveLength(3);

    const second = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(second.code, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      status: "cached",
      indexPath: firstResult.indexPath,
      commonOperationsPath: firstResult.commonOperationsPath,
      manifestPath: firstResult.manifestPath,
      handbookDigest: fixture.digest,
      catalogVersion: "0123456789abcdef",
      totalOperations: 1
    });
    expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("rejects a corrupted package before publishing the cache", async () => {
    const fixture = await fixtureWorkspace();
    const raw = JSON.parse(await readFile(fixture.fixturePath, "utf8"));
    raw.chunks[0].data = Buffer.from("corrupt").toString("base64");
    raw.chunks[0].bytes = 7;
    await writeFile(fixture.fixturePath, JSON.stringify(raw));

    const result = await runLoader(fixture.workspace, fixture.cliPath, fixture.fixturePath, fixture.logPath);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("archive size does not match");
  });
});
