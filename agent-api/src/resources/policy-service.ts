import {
  type ResourcePolicyEffect,
  ResourcePolicyRepository,
  type ResourcePolicyRecord,
  type ResourcePolicyResourceType,
  type ResourcePolicySubjectType
} from "../persistence/resource-policy-repository.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class PolicyService {
  constructor(private readonly policies: ResourcePolicyRepository) {}

  async listResourcePolicies(input: {
    organizationId?: string;
    resourceType: ResourcePolicyResourceType;
    resourceId: string;
  }): Promise<ResourcePolicyRecord[]> {
    const resourceId = input.resourceId.trim();
    if (!resourceId) return [];
    const organizationId = trimOrUndefined(input.organizationId);
    const rows = await this.policies.listAll();
    return rows.filter((row) => {
      const rowOrganizationId = trimOrUndefined(row.organizationId);
      if (organizationId ? rowOrganizationId && rowOrganizationId !== organizationId : rowOrganizationId) {
        return false;
      }
      return row.resourceType === input.resourceType && row.resourceId === resourceId;
    });
  }

  async listResourcePoliciesForIds(input: {
    organizationId?: string;
    resourceType: ResourcePolicyResourceType;
    resourceIds: string[];
  }): Promise<ResourcePolicyRecord[]> {
    const resourceIds = new Set(input.resourceIds.map((id) => id.trim()).filter(Boolean));
    if (resourceIds.size === 0) return [];
    const organizationId = trimOrUndefined(input.organizationId);
    const rows = await this.policies.listAll();
    return rows.filter((row) => {
      const rowOrganizationId = trimOrUndefined(row.organizationId);
      if (organizationId ? rowOrganizationId && rowOrganizationId !== organizationId : rowOrganizationId) {
        return false;
      }
      return row.resourceType === input.resourceType && resourceIds.has(row.resourceId);
    });
  }

  async listSubjectPolicies(input: {
    organizationId?: string;
    subjectType: ResourcePolicySubjectType;
    subjectId: string;
    resourceType?: ResourcePolicyResourceType;
  }): Promise<ResourcePolicyRecord[]> {
    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      return [];
    }

    const rows = await this.policies.listAll();
    return rows.filter((row) => {
      const rowOrganizationId = trimOrUndefined(row.organizationId);
      const organizationId = trimOrUndefined(input.organizationId);
      if (organizationId) {
        if (rowOrganizationId && rowOrganizationId !== organizationId) {
          return false;
        }
      } else if (rowOrganizationId) {
        return false;
      }
      if (row.subjectType !== input.subjectType || row.subjectId !== subjectId) {
        return false;
      }
      if (input.resourceType && row.resourceType !== input.resourceType) {
        return false;
      }
      return true;
    });
  }

  async replaceSubjectPolicies(input: {
    organizationId?: string;
    subjectType: ResourcePolicySubjectType;
    subjectId: string;
    resourceType: ResourcePolicyResourceType;
    policies: Array<{ resourceId: string; effect: ResourcePolicyEffect }>;
  }): Promise<ResourcePolicyRecord[]> {
    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      throw new Error("resource policy subjectId is required");
    }

    return this.policies.replacePoliciesForGroups({
      groups: [
        {
          subjectType: input.subjectType,
          subjectId,
          resourceType: input.resourceType
        }
      ],
      policies: input.policies.map((policy) => ({
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        subjectId,
        resourceType: input.resourceType,
        resourceId: policy.resourceId,
        effect: policy.effect
      }))
    });
  }

  async filterAllowedResources(input: {
    organizationId?: string;
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    resourceType: ResourcePolicyResourceType;
    candidateIds: string[];
  }): Promise<string[]> {
    if (input.candidateIds.length === 0) {
      return [];
    }

    const rows = await this.policies.listForSubjects({
      resourceType: input.resourceType,
      subjectRefs: [
        ...input.roleIds.map((subjectId) => ({ subjectType: "role" as const, subjectId })),
        ...input.departmentIds.map((subjectId) => ({ subjectType: "department" as const, subjectId })),
        { subjectType: "user" as const, subjectId: input.userId }
      ]
    });
    const organizationId = trimOrUndefined(input.organizationId);
    const scopedRows = rows.filter((row) => {
      const rowOrganizationId = trimOrUndefined(row.organizationId);
      if (organizationId) {
        return !rowOrganizationId || rowOrganizationId === organizationId;
      }
      return !rowOrganizationId;
    });

    return input.candidateIds.filter((resourceId) => {
      const matched = scopedRows.filter((row) => row.resourceId === resourceId);
      if (matched.some((row) => row.effect === "deny")) {
        return false;
      }
      return matched.some((row) => row.effect === "allow");
    });
  }
}
