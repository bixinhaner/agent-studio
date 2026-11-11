import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashSkillDirectory } from "../../codex-skills/codex-skill-service.js";
import { connectorAppIds, listConnectorApps, loadConnectorApp, registerConnectorApp, type ConnectorAppDb } from "./app-registration.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const appsRoot = path.join(apiRoot, "connector-apps");
const bundledSkillsDir = path.join(apiRoot, "bundled-skills");

function stubDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const table = (name: string) => ({
    upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const key = `${name}:${where.id}`;
      rows.set(key, rows.has(key) ? { ...rows.get(key), ...update } : { ...create });
      return rows.get(key);
    }
  });
  const db = {
    codexManagedSkill: table("skill"),
    skillPackage: table("package"),
    skillPackageItem: table("item"),
    skillPackageRuntimeBinding: table("binding"),
    agentMode: table("mode"),
    agentModeSkillPackage: table("modeSkill"),
    agentModeInstructionSource: table("instructions"),
    integrationInstance: { findMany: async () => [] }
  } as unknown as ConnectorAppDb;
  return { db, rows };
}

describe("connector apps", () => {
  it("every app in the repository is valid and points at a bundled skill", async () => {
    const directories = await listConnectorApps(appsRoot);
    expect(directories.map((directory) => path.basename(directory))).toContain("netopt-operations");
    for (const directory of directories) {
      const app = await loadConnectorApp(directory);
      const { db } = stubDb();
      await expect(registerConnectorApp(db, app, { bundledSkillsDir })).resolves.toMatchObject({ slug: app.slug });
    }
  });

  it("registers the skill, package and mode with stable ids and the published checksum", async () => {
    const app = await loadConnectorApp(path.join(appsRoot, "netopt-operations"));
    const { db, rows } = stubDb();
    const result = await registerConnectorApp(db, app, { bundledSkillsDir });
    const ids = connectorAppIds("netopt-operations");

    expect(ids.mode).toBe("mode_netopt_operations");
    expect(result).toEqual({
      slug: "netopt-operations",
      agentModeId: "mode_netopt_operations",
      checksum: await hashSkillDirectory(path.join(bundledSkillsDir, "netopt-operations")),
      connector: null
    });
    expect(rows.get(`skill:${ids.managedSkill}`)).toMatchObject({ skillName: "netopt-operations", publishedPath: path.join(bundledSkillsDir, "netopt-operations"), checksum: result.checksum });
    expect(rows.get(`binding:${ids.binding}`)).toMatchObject({ bindingPayload: { skillName: "netopt-operations", managedSkillId: ids.managedSkill } });
    expect(rows.get(`modeSkill:${ids.modeSkill}`)).toEqual({ id: ids.modeSkill, agentModeId: ids.mode, skillPackageId: ids.skillPackage });
    const instructions = JSON.parse(String(rows.get(`instructions:${ids.instructions}`)?.sourceRef));
    expect(instructions).toMatchObject({ version: 1, kind: "inline" });
    expect(instructions.content).toContain("# Network Optimization Assistant");

    // Running again (every deploy) only refreshes the same rows.
    await registerConnectorApp(db, app, { bundledSkillsDir });
    expect(rows.size).toBe(7);
  });

  it("refuses an app whose skill is not bundled", async () => {
    const app = await loadConnectorApp(path.join(appsRoot, "netopt-operations"));
    const { db } = stubDb();
    await expect(registerConnectorApp(db, { ...app, skill: { ...app.skill, name: "missing-skill" } }, { bundledSkillsDir })).rejects.toThrow(/bundled skill missing-skill not found/);
  });
});
