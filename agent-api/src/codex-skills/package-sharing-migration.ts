export type PackageSharingSkill = {
  id: string;
  organizationId?: string;
  ownerUserId?: string;
  scope: string;
  status: string;
  skillName: string;
  slug: string;
  publishedPath: string;
};

export type PackageSharingPackage = {
  id: string;
  slug: string;
  bindings: Array<{
    runtimeType: string;
    bindingType: string;
    bindingPayload: unknown;
  }>;
};

export type PackageSharingPolicy = {
  id: string;
  organizationId?: string;
  subjectType: string;
  subjectId: string;
  resourceType: string;
  resourceId: string;
  effect: string;
};

export type PackageSharingMigrationPlan = {
  skills: PackageSharingSkill[];
  skillMigrations: Array<{
    sourceSkill: PackageSharingSkill;
    targetSkill: PackageSharingSkill;
  }>;
  packageIds: string[];
  packagePolicyIdsToDelete: string[];
  managedPoliciesToCreate: Array<{
    organizationId?: string;
    subjectType: "user";
    subjectId: string;
    resourceType: "managed_skill";
    resourceId: string;
    effect: "allow" | "deny";
  }>;
  retainedManagedPolicies: number;
  skippedPackages: Array<{ packageId: string; slug: string; reason: string }>;
  blockers: string[];
};

export type ManagedSkillReferenceMapping = {
  sourceManagedSkillId: string;
  targetManagedSkillId: string;
  targetSourcePath: string;
};

export type ManagedSkillReferenceRewrite = {
  runConfig: Record<string, unknown>;
  changed: boolean;
  rewrittenSkillIds: string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundManagedSkillId(binding: PackageSharingPackage["bindings"][number]): string | undefined {
  if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") return undefined;
  const value = record(binding.bindingPayload)?.managedSkillId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function policyKey(input: { subjectId: string; resourceId: string }): string {
  return `${input.subjectId}:${input.resourceId}`;
}

export function rewriteManagedSkillReferences(
  value: unknown,
  mappings: ManagedSkillReferenceMapping[]
): ManagedSkillReferenceRewrite {
  const runConfig = record(value) ? { ...record(value)! } : {};
  if (!Array.isArray(runConfig.enabledSkills) || mappings.length === 0) {
    return { runConfig, changed: false, rewrittenSkillIds: [] };
  }
  const mappingBySourceId = new Map(mappings.map((mapping) => [mapping.sourceManagedSkillId, mapping] as const));
  const rewrittenSkillIds = new Set<string>();
  let changed = false;
  runConfig.enabledSkills = runConfig.enabledSkills.map((item) => {
    const payload = record(item);
    if (!payload) return item;
    const managedSkillId = typeof payload.managedSkillId === "string" ? payload.managedSkillId.trim() : "";
    const selectionId = typeof payload.id === "string" ? payload.id.trim() : "";
    const selectionManagedSkillId = selectionId.startsWith("managed:")
      ? selectionId.slice("managed:".length)
      : selectionId;
    const mapping = mappingBySourceId.get(managedSkillId) ?? mappingBySourceId.get(selectionManagedSkillId);
    if (!mapping) return item;
    changed = true;
    rewrittenSkillIds.add(mapping.sourceManagedSkillId);
    return {
      ...payload,
      id: `managed:${mapping.targetManagedSkillId}`,
      managedSkillId: mapping.targetManagedSkillId,
      sourcePath: mapping.targetSourcePath
    };
  });
  return { runConfig, changed, rewrittenSkillIds: [...rewrittenSkillIds].sort() };
}

export function planPackageSharingMigration(input: {
  skills: PackageSharingSkill[];
  packages: PackageSharingPackage[];
  packagePolicies: PackageSharingPolicy[];
  managedSkillPolicies: PackageSharingPolicy[];
}): PackageSharingMigrationPlan {
  const candidates = new Map(input.skills
    .filter((skill) => skill.scope === "agent_mode" && skill.status === "active" && Boolean(skill.ownerUserId))
    .map((skill) => [skill.id, skill] as const));
  const archivedPrivateByIdentity = new Map(input.skills
    .filter((skill) => skill.scope === "private" && skill.status === "archived" && Boolean(skill.ownerUserId))
    .map((skill) => [`${skill.organizationId ?? ""}:${skill.ownerUserId}:${skill.skillName}`, skill] as const));
  const packagePoliciesByResource = new Map<string, PackageSharingPolicy[]>();
  for (const policy of input.packagePolicies) {
    if (policy.resourceType !== "skill_package" || policy.subjectType !== "user") continue;
    const rows = packagePoliciesByResource.get(policy.resourceId) ?? [];
    rows.push(policy);
    packagePoliciesByResource.set(policy.resourceId, rows);
  }

  const selectedPackages: Array<{ row: PackageSharingPackage; skillIds: string[]; policies: PackageSharingPolicy[] }> = [];
  const skippedPackages: PackageSharingMigrationPlan["skippedPackages"] = [];
  const blockers: string[] = [];
  for (const skillPackage of input.packages) {
    const policies = packagePoliciesByResource.get(skillPackage.id) ?? [];
    if (policies.length === 0) continue;
    const skillIds = skillPackage.bindings.map(boundManagedSkillId);
    if (skillIds.length === 0 || skillIds.some((skillId) => !skillId || !candidates.has(skillId))) {
      skippedPackages.push({
        packageId: skillPackage.id,
        slug: skillPackage.slug,
        reason: "Package 含非目标 Skill、非 Codex Skill 或缺少 managedSkillId，未自动迁移"
      });
      continue;
    }
    const uniqueSkillIds = [...new Set(skillIds as string[])];
    const ownerDenied = uniqueSkillIds.some((skillId) => {
      const ownerUserId = candidates.get(skillId)?.ownerUserId;
      return policies.some((policy) => policy.subjectId === ownerUserId && policy.effect === "deny");
    });
    if (ownerDenied) {
      blockers.push(`Package ${skillPackage.slug} 存在对 Skill 持有人的 deny 授权，无法等价迁移`);
      continue;
    }
    selectedPackages.push({ row: skillPackage, skillIds: uniqueSkillIds, policies });
  }

  const selectedSkillIds = new Set(selectedPackages.flatMap((item) => item.skillIds));
  const selectedSkills = [...selectedSkillIds]
    .map((skillId) => candidates.get(skillId))
    .filter((skill): skill is PackageSharingSkill => Boolean(skill))
    .sort((left, right) => left.skillName.localeCompare(right.skillName) || left.id.localeCompare(right.id));
  const skillMigrations = selectedSkills.map((sourceSkill) => ({
    sourceSkill,
    targetSkill: archivedPrivateByIdentity.get(
      `${sourceSkill.organizationId ?? ""}:${sourceSkill.ownerUserId}:${sourceSkill.skillName}`
    ) ?? sourceSkill
  }));
  const targetSkillBySourceId = new Map(skillMigrations.map((migration) => [
    migration.sourceSkill.id,
    migration.targetSkill
  ] as const));
  const existingBySubjectAndSkill = new Map<string, Set<string>>();
  for (const policy of input.managedSkillPolicies) {
    if (policy.resourceType !== "managed_skill" || policy.subjectType !== "user") continue;
    const key = policyKey({ subjectId: policy.subjectId, resourceId: policy.resourceId });
    const effects = existingBySubjectAndSkill.get(key) ?? new Set<string>();
    effects.add(policy.effect);
    existingBySubjectAndSkill.set(key, effects);
  }

  const plannedKeys = new Set<string>();
  const managedPoliciesToCreate: PackageSharingMigrationPlan["managedPoliciesToCreate"] = [];
  let retainedManagedPolicies = 0;
  for (const selectedPackage of selectedPackages) {
    for (const skillId of selectedPackage.skillIds) {
      const skill = candidates.get(skillId);
      if (!skill) continue;
      const targetSkill = targetSkillBySourceId.get(skill.id) ?? skill;
      for (const policy of selectedPackage.policies) {
        if (policy.subjectId === skill.ownerUserId) continue;
        if (policy.effect !== "allow" && policy.effect !== "deny") {
          blockers.push(`Policy ${policy.id} 的 effect=${policy.effect} 无法迁移`);
          continue;
        }
        const key = policyKey({ subjectId: policy.subjectId, resourceId: targetSkill.id });
        const existingEffects = existingBySubjectAndSkill.get(key);
        if (existingEffects?.has(policy.effect)) {
          retainedManagedPolicies += 1;
          continue;
        }
        const oppositeEffect = policy.effect === "allow" ? "deny" : "allow";
        if (existingEffects?.has(oppositeEffect)) {
          blockers.push(`用户 ${policy.subjectId} 对 Skill ${skill.skillName} 已存在相反的 ${oppositeEffect} 授权`);
          continue;
        }
        const plannedKey = `${key}:${policy.effect}`;
        if (plannedKeys.has(plannedKey)) continue;
        plannedKeys.add(plannedKey);
        managedPoliciesToCreate.push({
          organizationId: skill.organizationId ?? policy.organizationId,
          subjectType: "user",
          subjectId: policy.subjectId,
          resourceType: "managed_skill",
          resourceId: targetSkill.id,
          effect: policy.effect
        });
      }
    }
  }

  return {
    skills: selectedSkills,
    skillMigrations,
    packageIds: selectedPackages.map((item) => item.row.id).sort(),
    packagePolicyIdsToDelete: [...new Set(selectedPackages.flatMap((item) => item.policies.map((policy) => policy.id)))].sort(),
    managedPoliciesToCreate,
    retainedManagedPolicies,
    skippedPackages,
    blockers: [...new Set(blockers)]
  };
}
