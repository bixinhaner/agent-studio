import type { AuthIdentityRepository } from "../persistence/auth-identity-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { UserRepositoryLike } from "../persistence/user-repository.js";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toEmail(value: unknown): string | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase();
  return normalized || undefined;
}

export async function isInternalUserForEmail(options: {
  users: UserRepositoryLike;
  identities: Pick<AuthIdentityRepository, "listByEmail">;
  memberships: Pick<OrganizationMembershipRepository, "listActiveForUser">;
  email: string;
}): Promise<boolean> {
  const email = toEmail(options.email);
  if (!email) return false;
  const users = new Map<string, NonNullable<Awaited<ReturnType<UserRepositoryLike["getById"]>>>>();
  const userByEmail = options.users.getByEmail ? await options.users.getByEmail(email) : undefined;
  if (userByEmail) {
    users.set(userByEmail.id, userByEmail);
  }

  const identities = await options.identities.listByEmail(email);
  for (const identity of identities) {
    if (users.has(identity.userId)) continue;
    const user = await options.users.getById(identity.userId);
    if (user) {
      users.set(user.id, user);
    }
  }

  for (const user of users.values()) {
    if (user.userType === "internal_employee") return true;
    const memberships = await options.memberships.listActiveForUser(user.id);
    if (memberships.some((membership) => membership.organization?.type === "internal")) {
      return true;
    }
  }

  return false;
}
