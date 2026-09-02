import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { planPackageSharingMigration } from "../codex-skills/package-sharing-migration.js";
import { createDbClient } from "../db/client.js";
import { sanitizePathSegment } from "../runtime-scope-resolver.js";

type CliOptions = {
  apply: boolean;
  report?: string;
};

type PreparedMove = {
  skillId: string;
  skillName: string;
  sourcePath: string;
  targetPath: string;
};

function usage(): never {
  console.error([
    "Usage: node dist/ops/migrate-package-shared-skills-to-private.js [--dry-run|--apply] [--report <path>]",
    "",
    "Dry-run is the default. The migration converts user-owned agent_mode Skills that are shared through",
    "dedicated Skill Packages into private Skills with direct managed_skill member grants."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--report") {
      const value = argv[index + 1]?.trim();
      if (!value) usage();
      options.report = path.resolve(value);
      index += 1;
    } else usage();
  }
  return options;
}

function isUnderRoot(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function assertDirectoryHasNoSymlinks(rootPath: string): Promise<void> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill 目录包含符号链接：${entryPath}`);
    if (entry.isDirectory()) await assertDirectoryHasNoSymlinks(entryPath);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  return fs.stat(targetPath).then(() => true, () => false);
}

async function writeReport(reportPath: string | undefined, report: unknown): Promise<void> {
  if (!reportPath) return;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const skillsRoot = path.join(appConfig.codex.baseHome, "skills");
  const report: Record<string, unknown> = {
    mode: options.apply ? "apply" : "dry-run",
    startedAt: new Date().toISOString()
  };

  try {
    const [skills, packages, packagePolicies, managedSkillPolicies, allPublishedPaths] = await Promise.all([
      db.codexManagedSkill.findMany({
        where: { status: "active", scope: "agent_mode", ownerUserId: { not: null } },
        orderBy: [{ skillName: "asc" }, { id: "asc" }]
      }),
      db.skillPackage.findMany({
        include: { items: { include: { runtimeBindings: true } } },
        orderBy: { slug: "asc" }
      }),
      db.resourcePolicy.findMany({
        where: { resourceType: "skill_package", subjectType: "user" },
        orderBy: { createdAt: "asc" }
      }),
      db.resourcePolicy.findMany({
        where: { resourceType: "managed_skill", subjectType: "user" },
        orderBy: { createdAt: "asc" }
      }),
      db.codexManagedSkill.findMany({ select: { id: true, publishedPath: true } })
    ]);
    const plan = planPackageSharingMigration({
      skills: skills.map((skill) => ({
        id: skill.id,
        organizationId: skill.organizationId ?? undefined,
        ownerUserId: skill.ownerUserId ?? undefined,
        scope: skill.scope,
        status: skill.status,
        skillName: skill.skillName,
        slug: skill.slug,
        publishedPath: skill.publishedPath
      })),
      packages: packages.map((skillPackage) => ({
        id: skillPackage.id,
        slug: skillPackage.slug,
        bindings: skillPackage.items.flatMap((item) => item.runtimeBindings.map((binding) => ({
          runtimeType: binding.runtimeType,
          bindingType: binding.bindingType,
          bindingPayload: binding.bindingPayload
        })))
      })),
      packagePolicies: packagePolicies.map((policy) => ({
        id: policy.id,
        organizationId: policy.organizationId ?? undefined,
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        resourceType: policy.resourceType,
        resourceId: policy.resourceId,
        effect: policy.effect
      })),
      managedSkillPolicies: managedSkillPolicies.map((policy) => ({
        id: policy.id,
        organizationId: policy.organizationId ?? undefined,
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        resourceType: policy.resourceType,
        resourceId: policy.resourceId,
        effect: policy.effect
      }))
    });

    const blockers = [...plan.blockers];
    const preparedMoves: PreparedMove[] = [];
    const pathsByOtherSkill = new Map(allPublishedPaths.map((row) => [path.resolve(row.publishedPath), row.id] as const));
    for (const skill of plan.skills) {
      if (!skill.ownerUserId) {
        blockers.push(`Skill ${skill.skillName} 缺少 ownerUserId`);
        continue;
      }
      const sourcePath = path.resolve(skill.publishedPath);
      const targetPath = path.join(
        skillsRoot,
        "user",
        sanitizePathSegment(skill.organizationId ?? "global", "global"),
        sanitizePathSegment(skill.ownerUserId, "user"),
        sanitizePathSegment(skill.slug || skill.skillName, "skill")
      );
      if (!isUnderRoot(skillsRoot, sourcePath)) {
        blockers.push(`Skill ${skill.skillName} 的源目录不在受控 Skills 根目录：${sourcePath}`);
        continue;
      }
      const conflictingSkillId = pathsByOtherSkill.get(path.resolve(targetPath));
      if (conflictingSkillId && conflictingSkillId !== skill.id) {
        blockers.push(`Skill ${skill.skillName} 的目标目录已被 ${conflictingSkillId} 使用：${targetPath}`);
        continue;
      }
      const sourceStat = await fs.stat(sourcePath).catch(() => undefined);
      if (!sourceStat?.isDirectory()) {
        blockers.push(`Skill ${skill.skillName} 的源目录不存在：${sourcePath}`);
        continue;
      }
      if (!(await pathExists(path.join(sourcePath, "SKILL.md")))) {
        blockers.push(`Skill ${skill.skillName} 的源目录缺少 SKILL.md：${sourcePath}`);
        continue;
      }
      await assertDirectoryHasNoSymlinks(sourcePath).catch((error) => {
        blockers.push(error instanceof Error ? error.message : String(error));
      });
      if (sourcePath !== path.resolve(targetPath) && await pathExists(targetPath)) {
        blockers.push(`Skill ${skill.skillName} 的目标目录已经存在：${targetPath}`);
        continue;
      }
      preparedMoves.push({ skillId: skill.id, skillName: skill.skillName, sourcePath, targetPath });
    }

    Object.assign(report, {
      skills: preparedMoves.map((move) => ({
        id: move.skillId,
        name: move.skillName,
        sourcePath: move.sourcePath,
        targetPath: move.targetPath,
        memberGrantCount: plan.managedPoliciesToCreate.filter((policy) => policy.resourceId === move.skillId).length
      })),
      packageIds: plan.packageIds,
      packageUserPoliciesToRemove: plan.packagePolicyIdsToDelete.length,
      managedSkillPoliciesToCreate: plan.managedPoliciesToCreate.length,
      retainedManagedSkillPolicies: plan.retainedManagedPolicies,
      skippedPackages: plan.skippedPackages,
      blockers
    });

    if (blockers.length > 0) {
      await writeReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
      throw new Error(`迁移预检失败，共 ${blockers.length} 个阻断项`);
    }
    if (!options.apply) {
      await writeReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const copiedTargets: string[] = [];
    try {
      for (const move of preparedMoves) {
        if (path.resolve(move.sourcePath) === path.resolve(move.targetPath)) continue;
        await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
        await fs.cp(move.sourcePath, move.targetPath, { recursive: true, errorOnExist: true, force: false });
        copiedTargets.push(move.targetPath);
      }

      await db.$transaction(async (tx) => {
        for (const move of preparedMoves) {
          const updated = await tx.codexManagedSkill.updateMany({
            where: { id: move.skillId, scope: "agent_mode" },
            data: { scope: "private", publishedPath: move.targetPath }
          });
          if (updated.count !== 1) throw new Error(`Skill ${move.skillName} 在迁移期间发生变化`);
        }
        for (const policy of plan.managedPoliciesToCreate) {
          await tx.resourcePolicy.create({ data: {
            organizationId: policy.organizationId ?? null,
            subjectType: policy.subjectType,
            subjectId: policy.subjectId,
            resourceType: policy.resourceType,
            resourceId: policy.resourceId,
            effect: policy.effect
          } });
        }
        const deleted = await tx.resourcePolicy.deleteMany({
          where: { id: { in: plan.packagePolicyIdsToDelete }, resourceType: "skill_package", subjectType: "user" }
        });
        if (deleted.count !== plan.packagePolicyIdsToDelete.length) {
          throw new Error(`Package 用户授权在迁移期间发生变化：预期 ${plan.packagePolicyIdsToDelete.length}，实际 ${deleted.count}`);
        }
      });
    } catch (error) {
      for (const targetPath of copiedTargets.reverse()) {
        await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }

    const cleanupFailures: string[] = [];
    for (const move of preparedMoves) {
      if (path.resolve(move.sourcePath) === path.resolve(move.targetPath)) continue;
      await fs.rm(move.sourcePath, { recursive: true, force: true }).catch((error) => {
        cleanupFailures.push(`${move.skillName}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    const [privateSkillCount, remainingPackagePolicyCount, managedPolicyCount] = await Promise.all([
      db.codexManagedSkill.count({ where: { id: { in: plan.skills.map((skill) => skill.id) }, scope: "private" } }),
      db.resourcePolicy.count({ where: { id: { in: plan.packagePolicyIdsToDelete } } }),
      db.resourcePolicy.count({ where: {
        resourceType: "managed_skill",
        OR: plan.managedPoliciesToCreate.map((policy) => ({
          resourceId: policy.resourceId,
          subjectType: policy.subjectType,
          subjectId: policy.subjectId,
          effect: policy.effect
        }))
      } })
    ]);
    Object.assign(report, {
      completedAt: new Date().toISOString(),
      applied: true,
      verification: {
        expectedPrivateSkills: plan.skills.length,
        actualPrivateSkills: privateSkillCount,
        remainingMigratedPackagePolicies: remainingPackagePolicyCount,
        expectedManagedSkillPolicies: plan.managedPoliciesToCreate.length,
        actualManagedSkillPolicies: managedPolicyCount,
        cleanupFailures
      }
    });
    await writeReport(options.report, report);
    console.log(JSON.stringify(report, null, 2));
    if (
      privateSkillCount !== plan.skills.length ||
      remainingPackagePolicyCount !== 0 ||
      managedPolicyCount !== plan.managedPoliciesToCreate.length ||
      cleanupFailures.length > 0
    ) {
      throw new Error("迁移已执行，但完成后验证未通过");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
