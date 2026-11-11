import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { hashSkillDirectory } from "../../codex-skills/codex-skill-service.js";
import { IntegrationInstanceRepository, type IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import { actionConnectorConfigSchema } from "../center/action-connector-adapter.js";

/**
 * A connector app is everything Bailey needs to serve one kind of business system through an
 * Action Connector: the bundled Skill, the skill package that carries it, the Agent Mode that
 * enables it, and (once, on request) the connector itself. Each app lives in
 * `agent-api/connector-apps/<slug>/` as `app.json` plus the mode instructions in `AGENTS.md`.
 *
 * Registration is idempotent and owns rows with deterministic ids derived from the slug, so it
 * can run on every deploy to keep the Skill's published checksum and instructions current. An
 * existing connector is never modified: its policy and API profile belong to administrators.
 */
const slug = z.string().trim().regex(/^[a-z][a-z0-9-]{1,60}$/, "must be lower-case letters, digits and dashes");

export const connectorAppSchema = z.object({
  slug,
  skill: z.object({
    name: slug,
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(40).default("1.0.0"),
    activationPrompt: z.string().trim().min(1).max(4000)
  }),
  package: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    capabilityKey: z.string().trim().regex(/^[a-z][a-z0-9._-]{1,80}$/),
    capabilityDescription: z.string().trim().min(1).max(500)
  }),
  mode: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    runProfileId: z.string().trim().min(1).default("profile_external_operations_fast")
  }),
  connector: z.object({
    slug,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    // agentModeId is always this app's mode.
    config: z.record(z.unknown())
  })
});

export type ConnectorApp = z.infer<typeof connectorAppSchema> & { instructions: string; directory: string };

export function connectorAppIds(appSlug: string) {
  const key = appSlug.replace(/-/g, "_");
  return {
    managedSkill: `managed_${key}`,
    skillPackage: `package_${key}`,
    item: `item_${key}`,
    binding: `binding_${key}`,
    mode: `mode_${key}`,
    modeSkill: `mode_skill_${key}`,
    instructions: `instr_${key}`
  };
}

export async function loadConnectorApp(directory: string): Promise<ConnectorApp> {
  const spec = connectorAppSchema.parse(JSON.parse(await readFile(path.join(directory, "app.json"), "utf8")));
  const instructions = (await readFile(path.join(directory, "AGENTS.md"), "utf8")).trim();
  if (!instructions) throw new Error(`${directory}/AGENTS.md is empty`);
  if (path.basename(directory) !== spec.slug) throw new Error(`${directory}: directory name must equal slug ${spec.slug}`);
  return { ...spec, instructions, directory };
}

export async function listConnectorApps(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)).sort();
}

/** Prisma delegates used by registration (kept structural so tests can use a stub). */
type Upsertable = { upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown> };
export type ConnectorAppDb = IntegrationInstanceRepositoryDb & {
  codexManagedSkill: Upsertable;
  skillPackage: Upsertable;
  skillPackageItem: Upsertable;
  skillPackageRuntimeBinding: Upsertable;
  agentMode: Upsertable;
  agentModeSkillPackage: Upsertable;
  agentModeInstructionSource: Upsertable;
};

export type RegisterResult = {
  slug: string;
  agentModeId: string;
  checksum: string;
  connector: { id: string; created: boolean } | null;
};

/**
 * Upserts the Skill, package and Agent Mode. With `createConnector`, also creates the connector
 * when no connector with its slug exists yet.
 */
export async function registerConnectorApp(
  db: ConnectorAppDb,
  app: ConnectorApp,
  options: { bundledSkillsDir: string; createConnector?: boolean }
): Promise<RegisterResult> {
  const ids = connectorAppIds(app.slug);
  const skillPath = path.resolve(options.bundledSkillsDir, app.skill.name);
  if (!(await stat(path.join(skillPath, "SKILL.md")).catch(() => null))) {
    throw new Error(`bundled skill ${app.skill.name} not found at ${skillPath}`);
  }
  const checksum = await hashSkillDirectory(skillPath);
  const now = new Date();
  const skillData = {
    skillName: app.skill.name,
    slug: app.skill.name,
    displayName: app.skill.displayName,
    description: app.skill.description,
    status: "active",
    version: app.skill.version,
    publishedPath: skillPath,
    checksum,
    scope: "agent_mode",
    metadata: { source: "bundled", repositoryPath: `agent-api/bundled-skills/${app.skill.name}`, connectorApp: app.slug }
  };
  await db.codexManagedSkill.upsert({ where: { id: ids.managedSkill }, create: { id: ids.managedSkill, ...skillData, publishedAt: now }, update: skillData });
  const packageData = { name: app.package.name, slug: app.slug, description: app.package.description, status: "active", visibleToUsers: false };
  await db.skillPackage.upsert({ where: { id: ids.skillPackage }, create: { id: ids.skillPackage, ...packageData }, update: packageData });
  const itemData = { skillPackageId: ids.skillPackage, capabilityKey: app.package.capabilityKey, description: app.package.capabilityDescription };
  await db.skillPackageItem.upsert({ where: { id: ids.item }, create: { id: ids.item, ...itemData }, update: itemData });
  const bindingData = {
    skillPackageItemId: ids.item,
    runtimeType: "codex",
    bindingType: "codex_skill",
    bindingPayload: { skillName: app.skill.name, managedSkillId: ids.managedSkill, activationPrompt: app.skill.activationPrompt }
  };
  await db.skillPackageRuntimeBinding.upsert({ where: { id: ids.binding }, create: { id: ids.binding, ...bindingData }, update: bindingData });
  const modeData = { name: app.mode.name, slug: app.slug, description: app.mode.description, status: "active", visibleToUsers: false, runProfileId: app.mode.runProfileId };
  await db.agentMode.upsert({ where: { id: ids.mode }, create: { id: ids.mode, ...modeData }, update: modeData });
  const modeSkillData = { agentModeId: ids.mode, skillPackageId: ids.skillPackage };
  await db.agentModeSkillPackage.upsert({ where: { id: ids.modeSkill }, create: { id: ids.modeSkill, ...modeSkillData }, update: modeSkillData });
  const instructionData = {
    agentModeId: ids.mode,
    sourceType: "workspace_agents_md",
    sourceRef: JSON.stringify({ version: 1, kind: "inline", content: app.instructions + "\n" }),
    sortOrder: 0
  };
  await db.agentModeInstructionSource.upsert({ where: { id: ids.instructions }, create: { id: ids.instructions, ...instructionData }, update: instructionData });

  let connector: RegisterResult["connector"] = null;
  const repository = new IntegrationInstanceRepository(db);
  const existing = (await repository.listInstances("action_connector")).find((instance) => instance.slug === app.connector.slug);
  if (existing) {
    connector = { id: existing.id, created: false };
  } else if (options.createConnector) {
    const config = actionConnectorConfigSchema.parse({ ...app.connector.config, agentModeId: ids.mode });
    const created = await repository.createInstance({
      type: "action_connector",
      slug: app.connector.slug,
      name: app.connector.name,
      description: app.connector.description ?? null,
      status: "active"
    });
    await repository.upsertConfig(created.id, config);
    connector = { id: created.id, created: true };
  }
  return { slug: app.slug, agentModeId: ids.mode, checksum, connector };
}
