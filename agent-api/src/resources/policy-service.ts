import {
  ResourcePolicyRepository,
  type ResourcePolicyResourceType
} from "../persistence/resource-policy-repository.js";

export class PolicyService {
  constructor(private readonly policies: ResourcePolicyRepository) {}

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
