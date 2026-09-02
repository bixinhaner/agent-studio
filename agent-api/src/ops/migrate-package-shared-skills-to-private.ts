import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { appConfig } from "../config.js";
import { planPackageSharingMigration } from "../codex-skills/package-sharing-migration.js";
import { createDbClient } from "../db/client.js";
import { sanitizePathSegment } from "../runtime-scope-resolver.js";

type CliOptions = {
  apply: boolean;
  report?: string;
};

type PreparedMove = {
  sourceSkillId: string;
  targetSkillId: string;
  skillName: string;
  sourcePath: string;
  targetPath: string;
  archivePath: string;
  targetExists: boolean;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function hashDirectory(rootPath: string): Promise<string> {
  const normalizedRoot = path.resolve(rootPath);
  const hash = createHash("sha1");
  const walk = async (currentPath: string): Promise<void> => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(normalizedRoot, entryPath).replace(/\\/g, "/");
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`Skill 目录包含符号链接：${entryPath}`);
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        await walk(entryPath);
      } else if (entry.isFile()) {
        hash.update(`file:${relativePath}:${stat.size}\n`);
        hash.update(await fs.readFile(entryPath));
        hash.update("\n");
      }
    }
  };
  await walk(normalizedRoot);
  return hash.digest("hex");
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
    const [skills, packages, packagePolicies, managedSkillPolicies] = await Promise.all([
      db.codexManagedSkill.findMany({
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
      })
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
    const pathsByOtherSkill = new Map(skills.map((row) => [path.resolve(row.publishedPath), row.id] as const));
    for (const migration of plan.skillMigrations) {
      const sourceSkill = migration.sourceSkill;
      const targetSkill = migration.targetSkill;
      if (!sourceSkill.ownerUserId) {
        blockers.push(`Skill ${sourceSkill.skillName} 缺少 ownerUserId`);
        continue;
      }
      const sourcePath = path.resolve(sourceSkill.publishedPath);
      const targetPath = path.join(
        skillsRoot,
        "user",
        sanitizePathSegment(sourceSkill.organizationId ?? "global", "global"),
        sanitizePathSegment(sourceSkill.ownerUserId, "user"),
        sanitizePathSegment(sourceSkill.slug || sourceSkill.skillName, "skill")
      );
      const archivePath = path.join(
        path.dirname(skillsRoot),
        "skill-archive",
        "package-sharing-migration",
        sanitizePathSegment(sourceSkill.organizationId ?? "global", "global"),
        `${sanitizePathSegment(sourceSkill.slug || sourceSkill.skillName, "skill")}-${sanitizePathSegment(sourceSkill.id, "record")}`
      );
      if (!isUnderRoot(skillsRoot, sourcePath)) {
        blockers.push(`Skill ${sourceSkill.skillName} 的源目录不在受控 Skills 根目录：${sourcePath}`);
        continue;
      }
      const conflictingSkillId = pathsByOtherSkill.get(path.resolve(targetPath));
      if (conflictingSkillId && conflictingSkillId !== sourceSkill.id && conflictingSkillId !== targetSkill.id) {
        blockers.push(`Skill ${sourceSkill.skillName} 的目标目录已被 ${conflictingSkillId} 使用：${targetPath}`);
        continue;
      }
      const sourceStat = await fs.stat(sourcePath).catch(() => undefined);
      if (!sourceStat?.isDirectory()) {
        blockers.push(`Skill ${sourceSkill.skillName} 的源目录不存在：${sourcePath}`);
        continue;
      }
      if (!(await pathExists(path.join(sourcePath, "SKILL.md")))) {
        blockers.push(`Skill ${sourceSkill.skillName} 的源目录缺少 SKILL.md：${sourcePath}`);
        continue;
      }
      await assertDirectoryHasNoSymlinks(sourcePath).catch((error) => {
        blockers.push(error instanceof Error ? error.message : String(error));
      });
      const targetExists = await pathExists(targetPath);
      if (targetExists) {
        await assertDirectoryHasNoSymlinks(targetPath).catch((error) => {
          blockers.push(error instanceof Error ? error.message : String(error));
        });
        const [sourceHash, targetHash] = await Promise.all([hashDirectory(sourcePath), hashDirectory(targetPath)]);
        if (sourceHash !== targetHash) {
          blockers.push(`Skill ${sourceSkill.skillName} 的旧私有目录与当前共享目录内容不同，需人工选择版本`);
          continue;
        }
      }
      if (await pathExists(archivePath)) {
        blockers.push(`Skill ${sourceSkill.skillName} 的迁移归档目录已经存在：${archivePath}`);
        continue;
      }
      preparedMoves.push({
        sourceSkillId: sourceSkill.id,
        targetSkillId: targetSkill.id,
        skillName: sourceSkill.skillName,
        sourcePath,
        targetPath,
        archivePath,
        targetExists
      });
    }

    Object.assign(report, {
      skills: preparedMoves.map((move) => ({
        sourceId: move.sourceSkillId,
        canonicalPrivateId: move.targetSkillId,
        name: move.skillName,
        sourcePath: move.sourcePath,
        targetPath: move.targetPath,
        archivePath: move.archivePath,
        reusesOriginalPrivateRecord: move.sourceSkillId !== move.targetSkillId,
        memberGrantCount: plan.managedPoliciesToCreate.filter((policy) => policy.resourceId === move.targetSkillId).length
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

    const copiedPaths: string[] = [];
    try {
      for (const move of preparedMoves) {
        await fs.mkdir(path.dirname(move.archivePath), { recursive: true });
        await fs.cp(move.sourcePath, move.archivePath, { recursive: true, errorOnExist: true, force: false });
        copiedPaths.push(move.archivePath);
        if (!move.targetExists) {
          await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
          await fs.cp(move.sourcePath, move.targetPath, { recursive: true, errorOnExist: true, force: false });
          copiedPaths.push(move.targetPath);
        }
      }

      await db.$transaction(async (tx) => {
        for (const move of preparedMoves) {
          const source = skills.find((skill) => skill.id === move.sourceSkillId);
          const target = skills.find((skill) => skill.id === move.targetSkillId);
          if (!source || !target) throw new Error(`Skill ${move.skillName} 的迁移记录不存在`);
          if (move.sourceSkillId === move.targetSkillId) {
            const updated = await tx.codexManagedSkill.updateMany({
              where: { id: move.sourceSkillId, scope: "agent_mode", status: "active" },
              data: { scope: "private", publishedPath: move.targetPath }
            });
            if (updated.count !== 1) throw new Error(`Skill ${move.skillName} 在迁移期间发生变化`);
          } else {
            const migratedAt = new Date().toISOString();
            const targetMetadata = { ...record(target.metadata), ...record(source.metadata) };
            delete targetMetadata.removedAt;
            delete targetMetadata.removalAction;
            delete targetMetadata.removalReason;
            delete targetMetadata.replacementManagedSkillId;
            delete targetMetadata.replacementPackageId;
            const restored = await tx.codexManagedSkill.updateMany({
              where: { id: move.targetSkillId, scope: "private", status: "archived" },
              data: {
                displayName: source.displayName,
                description: source.description,
                status: "active",
                version: source.version,
                checksum: source.checksum,
                publishedPath: move.targetPath,
                lastEditedByUserId: source.lastEditedByUserId,
                reviewedByUserId: source.reviewedByUserId,
                reviewedByDisplayName: source.reviewedByDisplayName,
                publishedByUserId: source.publishedByUserId,
                publishedByDisplayName: source.publishedByDisplayName,
                publishedAt: source.publishedAt,
                metadata: {
                  ...targetMetadata,
                  sharingModel: "managed-skill-members-v1",
                  restoredFromManagedSkillId: move.sourceSkillId,
                  restoredAt: migratedAt
                } as Prisma.InputJsonValue
              }
            });
            if (restored.count !== 1) throw new Error(`Skill ${move.skillName} 的原始 private 记录在迁移期间发生变化`);
            const archived = await tx.codexManagedSkill.updateMany({
              where: { id: move.sourceSkillId, scope: "agent_mode", status: "active" },
              data: {
                status: "archived",
                publishedPath: move.archivePath,
                metadata: {
                  ...record(source.metadata),
                  migrationAction: "restored_private_with_member_grants",
                  replacementManagedSkillId: move.targetSkillId,
                  migratedAt
                } as Prisma.InputJsonValue
              }
            });
            if (archived.count !== 1) throw new Error(`Skill ${move.skillName} 的共享记录在迁移期间发生变化`);
          }
        }
        const targetBySource = new Map(preparedMoves.map((move) => [move.sourceSkillId, move.targetSkillId] as const));
        for (const skillPackage of packages.filter((row) => plan.packageIds.includes(row.id))) {
          for (const item of skillPackage.items) {
            for (const binding of item.runtimeBindings) {
              const payload = record(binding.bindingPayload);
              const sourceId = typeof payload.managedSkillId === "string" ? payload.managedSkillId : undefined;
              const targetId = sourceId ? targetBySource.get(sourceId) : undefined;
              if (!targetId || targetId === sourceId) continue;
              await tx.skillPackageRuntimeBinding.update({
                where: { id: binding.id },
                data: { bindingPayload: { ...payload, managedSkillId: targetId } as Prisma.InputJsonValue }
              });
            }
          }
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
      for (const copiedPath of copiedPaths.reverse()) {
        await fs.rm(copiedPath, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }

    const cleanupFailures: string[] = [];
    for (const move of preparedMoves) {
      await fs.rm(move.sourcePath, { recursive: true, force: true }).catch((error) => {
        cleanupFailures.push(`${move.skillName}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    const canonicalIds = preparedMoves.map((move) => move.targetSkillId);
    const supersededIds = preparedMoves.filter((move) => move.sourceSkillId !== move.targetSkillId).map((move) => move.sourceSkillId);
    const [privateSkillCount, archivedSourceCount, remainingPackagePolicyCount, managedPolicyCount] = await Promise.all([
      db.codexManagedSkill.count({ where: { id: { in: canonicalIds }, scope: "private", status: "active" } }),
      db.codexManagedSkill.count({ where: { id: { in: supersededIds }, scope: "agent_mode", status: "archived" } }),
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
        expectedArchivedSharedRecords: supersededIds.length,
        actualArchivedSharedRecords: archivedSourceCount,
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
      archivedSourceCount !== supersededIds.length ||
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
