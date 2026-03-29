import {
  ResourcePolicyRepository,
  type ResourcePolicyResourceType
} from "../persistence/resource-policy-repository.js";

export type PolicyResourceType =
  | ResourcePolicyResourceType
  | "agent_mode"
  | "skill_package"
  | "run_profile";

export class PolicyService {
  constructor(private readonly policies: ResourcePolicyRepository) {}

  async filterAllowedResources(input: {
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    resourceType: PolicyResourceType;
    candidateIds: string[];
  }): Promise<string[]> {
    if (input.candidateIds.length === 0) {
      return [];
    }

    const rows = await this.policies.listForSubjects({
      resourceType: input.resourceType as ResourcePolicyResourceType,
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
