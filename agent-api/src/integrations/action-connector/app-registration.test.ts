import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashSkillDirectory } from "../../codex-skills/codex-skill-service.js";
import { connectorAppIds, listConnectorApps, loadConnectorApp, registerConnectorApp, type ConnectorAppDb } from "./app-registration.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const appsRoot = path.join(apiRoot, "connector-apps");
const bundledSkillsDir = path.join(apiRoot, "bundled-skills");

function stubDb(existing: Array<Record<string, unknown>> = []) {
  const rows = new Map<string, Record<string, unknown>>();
  const policies: Array<Record<string, string>> = [];
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
    integrationInstance: { findMany: async () => existing },
    integrationInstanceConfig: { findUnique: async () => null },
    integrationInstanceSecret: { findUnique: async () => null },
    role: { findMany: async () => [{ id: "role_super" }, { id: "role_admin" }] },
    resourcePolicy: {
      findFirst: async ({ where }: { where: Record<string, string> }) => policies.find((p) => p.subjectId === where.subjectId && p.resourceId === where.resourceId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { policies.push(data as Record<string, string>); return data; }
    }
  } as unknown as ConnectorAppDb;
  return { db, rows, policies };
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

  it("lets the system administrator roles see an existing connector without overriding their policies", async () => {
    const app = await loadConnectorApp(path.join(appsRoot, "netopt-operations"));
    const { db, policies } = stubDb([{ id: "conn1", type: "action_connector", slug: "netopt-operations", name: "网规网优助手", status: "active" }]);
    policies.push({ subjectType: "role", subjectId: "role_admin", resourceType: "integration_instance", resourceId: "conn1", effect: "deny" });
    const result = await registerConnectorApp(db, app, { bundledSkillsDir });
    expect(result.connector).toEqual({ id: "conn1", created: false });
    expect(policies.map((p) => [p.subjectId, p.effect])).toEqual([["role_admin", "deny"], ["role_super", "allow"]]);
    await registerConnectorApp(db, app, { bundledSkillsDir });
    expect(policies).toHaveLength(2);
  });

  it("refuses an app whose skill is not bundled", async () => {
    const app = await loadConnectorApp(path.join(appsRoot, "netopt-operations"));
    const { db } = stubDb();
    await expect(registerConnectorApp(db, { ...app, skill: { ...app.skill, name: "missing-skill" } }, { bundledSkillsDir })).rejects.toThrow(/bundled skill missing-skill not found/);
  });
});
