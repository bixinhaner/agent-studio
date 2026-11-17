// Kept apart from the sign-in router: the CREST integration runs on the chat service and needs only this,
// so changes to sign-in routes do not force a chat restart (see scripts/deploy-scope.mjs).
import { ensureInternalOrganization, INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE } from "./internal-organization.js";
import type { CrestExchangeIdentity } from "./router.js";
import type { AuthIdentityRepository } from "../persistence/auth-identity-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { OrganizationRepository } from "../persistence/organization-repository.js";
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

export async function resolveCrestUser(options: {
  users: UserRepositoryLike;
  identities: AuthIdentityRepository;
  memberships: OrganizationMembershipRepository;
  organizations: OrganizationRepository;
  identity: CrestExchangeIdentity;
}) {
  const internalOrganization = await ensureInternalOrganization(options.organizations);
  const providerSubject = `crest:${options.identity.user.id}`;
  const email = toEmail(options.identity.user.email ?? options.identity.user.domainName);
  const displayName = trimOrUndefined(options.identity.user.fullName) ?? email ?? providerSubject;

  const existingIdentity = await options.identities.getByProviderSubject("crest", providerSubject);
  let user =
    (existingIdentity ? await options.users.getById(existingIdentity.userId) : undefined) ??
    (await options.users.getByExternalId(providerSubject)) ??
    (email && options.users.getByEmail ? await options.users.getByEmail(email) : undefined);

  if (!user) {
    if (!options.users.createUser) {
      throw new Error("user repository does not support creating users");
    }
    user = await options.users.createUser({
      externalId: providerSubject,
      email: email ?? null,
      displayName,
      userType: "internal_employee",
      primaryOrganizationId: internalOrganization.id,
      role: "employee"
    });
  } else if (options.users.updateUserProfile) {
    user = await options.users.updateUserProfile({
      userId: user.id,
      externalId: providerSubject,
      email: email ?? user.email ?? null,
      displayName: displayName ?? user.displayName ?? null,
      userType: "internal_employee",
      primaryOrganizationId: user.primaryOrganizationId ?? internalOrganization.id
    });
  }

  await options.identities.upsert({
    userId: user.id,
    provider: "crest",
    providerSubject,
    email: email ?? user.email ?? null,
    emailVerifiedAt: email ? new Date() : null,
    profileJson: {
      crestUser: options.identity.user,
      ...(options.identity.delegationRefreshToken ? {} : { delegationToken: options.identity.delegationToken }),
      delegationExpiresAt: options.identity.delegationExpiresAt,
      delegationRefreshExpiresAt: options.identity.delegationRefreshExpiresAt ?? null
    },
    lastLoginAt: new Date()
  });

  await options.memberships.upsert({
    organizationId: internalOrganization.id,
    userId: user.id,
    membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE,
    status: "active",
    joinedAt: new Date()
  });

  return { user, organizationId: internalOrganization.id };
}
