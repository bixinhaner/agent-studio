export type ResourcePolicySubjectType = "role" | "department" | "user";
export type ResourcePolicyResourceType = "workspace" | "knowledge_set";
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

type ResourcePolicyTable = {
  findMany(args: {
    where?: {
      resourceType?: ResourcePolicyResourceType;
      OR?: SubjectRef[];
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ResourcePolicyRow[]>;
  deleteMany(args: {
    where: {
      resourceType?: ResourcePolicyResourceType;
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

function uniqueResourceTypes(resourceTypes: ResourcePolicyResourceType[]): ResourcePolicyResourceType[] {
  return [...new Set(resourceTypes)];
}

export class ResourcePolicyRepository {
  constructor(private readonly db: ResourcePolicyRepositoryDb) {}

  async replacePolicies(policies: ReplaceResourcePoliciesPayload): Promise<ResourcePolicyRecord[]> {
    const subjectRefs = uniqueSubjectRefs(
      policies.map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId
      }))
    );
    const resourceTypes = uniqueResourceTypes(policies.map((policy) => policy.resourceType));
    if (subjectRefs.length === 0) {
      return [];
    }

    return this.db.$transaction(async (tx) => {
      for (const resourceType of resourceTypes) {
        await tx.resourcePolicy.deleteMany({
          where: {
            resourceType,
            OR: subjectRefs
          }
        });
      }

      const created: ResourcePolicyRow[] = [];
      for (const policy of policies) {
        created.push(
          await tx.resourcePolicy.create({
            data: {
              organizationId: trimOrUndefined(policy.organizationId) ?? null,
              subjectType: policy.subjectType,
              subjectId: trimOrUndefined(policy.subjectId) ?? "",
              resourceType: policy.resourceType,
              resourceId: trimOrUndefined(policy.resourceId) ?? "",
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
