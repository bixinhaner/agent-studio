import {
  type ResourcePolicyEffect,
  ResourcePolicyRepository,
  type ResourcePolicyRecord,
  type ResourcePolicyResourceType,
  type ResourcePolicySubjectType
} from "../persistence/resource-policy-repository.js";

export class PolicyService {
  constructor(private readonly policies: ResourcePolicyRepository) {}

  async listSubjectPolicies(input: {
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

    return input.candidateIds.filter((resourceId) => {
      const matched = rows.filter((row) => row.resourceId === resourceId);
      if (matched.some((row) => row.effect === "deny")) {
        return false;
      }
      return matched.some((row) => row.effect === "allow");
    });
  }
}
