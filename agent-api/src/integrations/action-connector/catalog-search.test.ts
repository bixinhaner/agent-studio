import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(testDirectory, "../../../bundled-skills/omc-operations/scripts/search-catalog.mjs");

describe("OMC compatibility catalog search", () => {
  it("falls back from a strict phrase to the first resource token", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "omc-catalog-search-"));
    const cliPath = path.join(workspace, "fake-cli.mjs");
    const logPath = path.join(workspace, "queries.log");
    await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const query = process.argv.slice(3).join(" ");
appendFileSync(${JSON.stringify(logPath)}, query + "\\n");
if (query === "device") {
  console.log(JSON.stringify({ items: [{ operationId: "get.devices.stats", method: "GET", path: "/api/v1/devices/stats" }], total: 1 }));
} else {
  console.log(JSON.stringify({ items: [], total: 0, catalogVersion: "test" }));
}
`);
    const module = await import(`${pathToFileURL(scriptPath).href}?test=${Date.now()}`) as {
      searchCatalog(input: { cliPath: string; query: string }): Promise<Record<string, unknown>>;
    };

    const result = await module.searchCatalog({ cliPath, query: "device online status" });

    expect(result).toMatchObject({
      requestedQuery: "device online status",
      resolvedQuery: "device",
      attempts: ["device online status", "device"],
      items: [{ operationId: "get.devices.stats" }]
    });
    expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual(["device online status", "device"]);
  });
});
