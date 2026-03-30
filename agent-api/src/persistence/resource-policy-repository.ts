export type ResourcePolicySubjectType = "role" | "department" | "user";
export type ResourcePolicyResourceType =
  | "workspace"
  | "knowledge_set"
  | "agent_mode"
  | "skill_package"
  | "run_profile"
  | "integration_instance";
export type ResourcePolicyEffect = "allow" | "deny";

export type ResourcePolicyRecord = {
  id: string;
  organizationId?: string;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
  createdAt: string;
  updatedAt: string;
};

type ResourcePolicyRow = {
  id: string;
  organizationId: string | null;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SubjectRef = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
};

type ReplacementGroup = SubjectRef & {
  resourceType: ResourcePolicyResourceType;
};

type ResourcePolicyTable = {
  findMany(args: {
    where?: {
      resourceType?: ResourcePolicyResourceType;
      resourceId?: string;
      OR?: SubjectRef[];
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ResourcePolicyRow[]>;
  deleteMany(args: {
    where: {
      resourceType?: ResourcePolicyResourceType;
      resourceId?: string;
      OR?: SubjectRef[];
    };
  }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<ResourcePolicyRow>;
};

export type ResourcePolicyRepositoryDb = {
  resourcePolicy: ResourcePolicyTable;
  $transaction<T>(callback: (tx: ResourcePolicyRepositoryDb) => Promise<T>): Promise<T>;
};

type ReplaceResourcePoliciesPayload = Array<{
  organizationId?: string;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
}>;

type ReplaceResourcePolicyGroupsInput = {
  groups: ReplacementGroup[];
  policies: ReplaceResourcePoliciesPayload;
};

type ReplaceResourcePoliciesForResourceInput = {
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  policies: ReplaceResourcePoliciesPayload;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function mapResourcePolicy(row: ResourcePolicyRow): ResourcePolicyRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    effect: row.effect,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function uniqueSubjectRefs(subjectRefs: SubjectRef[]): SubjectRef[] {
  const seen = new Set<string>();
  const normalized: SubjectRef[] = [];
  for (const subject of subjectRefs) {
    const subjectId = trimOrUndefined(subject.subjectId);
    if (!subjectId) continue;
    const key = `${subject.subjectType}:${subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      subjectType: subject.subjectType,
      subjectId
    });
  }
  return normalized;
}

function uniqueReplacementGroups(groups: ReplacementGroup[]): ReplacementGroup[] {
  const seen = new Set<string>();
  const normalized: ReplacementGroup[] = [];
  for (const group of groups) {
    const subjectId = trimOrUndefined(group.subjectId);
    if (!subjectId) continue;
    const key = `${group.subjectType}:${subjectId}:${group.resourceType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      subjectType: group.subjectType,
      subjectId,
      resourceType: group.resourceType
    });
  }
  return normalized;
}

function requireTrimmedValue(value: string | undefined, field: "subjectId" | "resourceId"): string {
  if (!value) {
    throw new Error(`resource policy ${field} is required`);
  }
  return value;
}

export class ResourcePolicyRepository {
  constructor(private readonly db: ResourcePolicyRepositoryDb) {}

  async listAll(): Promise<ResourcePolicyRecord[]> {
    const rows = await this.db.resourcePolicy.findMany({
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapResourcePolicy);
  }

  async replacePolicies(policies: ReplaceResourcePoliciesPayload): Promise<ResourcePolicyRecord[]> {
    if (policies.length === 0) {
      await this.db.$transaction(async (tx) => {
        await tx.resourcePolicy.deleteMany({ where: {} });
      });
      return [];
    }
    return this.replacePoliciesForGroups({
      groups: policies.map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        resourceType: policy.resourceType
      })),
      policies
    });
  }

  async replacePoliciesForGroups(input: ReplaceResourcePolicyGroupsInput): Promise<ResourcePolicyRecord[]> {
    const normalizedPolicies = input.policies.map((policy) => ({
      organizationId: trimOrUndefined(policy.organizationId),
      subjectType: policy.subjectType,
      subjectId: requireTrimmedValue(trimOrUndefined(policy.subjectId), "subjectId"),
      resourceType: policy.resourceType,
      resourceId: requireTrimmedValue(trimOrUndefined(policy.resourceId), "resourceId"),
      effect: policy.effect
    }));
    const replacementGroups = uniqueReplacementGroups(input.groups);
    if (replacementGroups.length === 0) {
      return [];
    }

    return this.db.$transaction(async (tx) => {
      for (const group of replacementGroups) {
        await tx.resourcePolicy.deleteMany({
          where: {
            resourceType: group.resourceType,
            OR: [{ subjectType: group.subjectType, subjectId: group.subjectId }]
          }
        });
      }

      const created: ResourcePolicyRow[] = [];
      for (const policy of normalizedPolicies) {
        created.push(
          await tx.resourcePolicy.create({
            data: {
              organizationId: policy.organizationId ?? null,
              subjectType: policy.subjectType,
              subjectId: policy.subjectId,
              resourceType: policy.resourceType,
              resourceId: policy.resourceId,
              effect: policy.effect
            }
          })
        );
      }
      return created
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .map(mapResourcePolicy);
    });
  }

  async replacePoliciesForResource(input: ReplaceResourcePoliciesForResourceInput): Promise<ResourcePolicyRecord[]> {
    const resourceId = requireTrimmedValue(trimOrUndefined(input.resourceId), "resourceId");
    const normalizedPolicies = input.policies.map((policy) => ({
      organizationId: trimOrUndefined(policy.organizationId),
      subjectType: policy.subjectType,
      subjectId: requireTrimmedValue(trimOrUndefined(policy.subjectId), "subjectId"),
      resourceType: input.resourceType,
      resourceId,
      effect: policy.effect
    }));

    return this.db.$transaction(async (tx) => {
      await tx.resourcePolicy.deleteMany({
        where: {
          resourceType: input.resourceType,
          resourceId
        }
      });

      const created: ResourcePolicyRow[] = [];
      for (const policy of normalizedPolicies) {
        created.push(
          await tx.resourcePolicy.create({
            data: {
              organizationId: policy.organizationId ?? null,
              subjectType: policy.subjectType,
              subjectId: policy.subjectId,
              resourceType: policy.resourceType,
              resourceId: policy.resourceId,
              effect: policy.effect
            }
          })
        );
      }
      return created
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .map(mapResourcePolicy);
    });
  }

  async listForSubjects(input: {
    resourceType: ResourcePolicyResourceType;
    subjectRefs: SubjectRef[];
  }): Promise<ResourcePolicyRecord[]> {
    const subjectRefs = uniqueSubjectRefs(input.subjectRefs);
    if (subjectRefs.length === 0) {
      return [];
    }

    const rows = await this.db.resourcePolicy.findMany({
      where: {
        resourceType: input.resourceType,
        OR: subjectRefs
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapResourcePolicy);
  }
}
