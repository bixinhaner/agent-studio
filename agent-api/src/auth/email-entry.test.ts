import { describe, expect, it, vi } from "vitest";

import { isInternalUserForEmail } from "./email-entry.js";
import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";

function buildUser(patch: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: "user-1",
    userType: "external_user",
    email: "user@example.com",
    role: "employee",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  };
}

describe("email auth entry resolution", () => {
  it("detects an internal employee by the user record email", async () => {
    const users: Pick<UserRepositoryLike, "getById" | "getByEmail"> = {
      getById: vi.fn(),
      getByEmail: vi.fn(async () => buildUser({ userType: "internal_employee" }))
    };

    await expect(
      isInternalUserForEmail({
        users: users as UserRepositoryLike,
        identities: { listByEmail: vi.fn(async () => []) },
        memberships: { listActiveForUser: vi.fn(async () => []) },
        email: "Internal@Baicells.com"
      })
    ).resolves.toBe(true);
  });

  it("detects an internal employee through an identity and active internal membership", async () => {
    const users: Pick<UserRepositoryLike, "getById" | "getByEmail"> = {
      getByEmail: vi.fn(async () => undefined),
      getById: vi.fn(async () => buildUser({ id: "user-internal", userType: "external_user" }))
    };

    await expect(
      isInternalUserForEmail({
        users: users as UserRepositoryLike,
        identities: {
          listByEmail: vi.fn(async () => [
            {
              id: "identity-1",
              userId: "user-internal",
              provider: "dingtalk",
              providerSubject: "union-1",
              email: "internal@baicells.com",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        },
        memberships: {
          listActiveForUser: vi.fn(async () => [
            {
              id: "membership-1",
              organizationId: "org-internal",
              userId: "user-internal",
              membershipType: "employee",
              status: "active",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              organization: {
                id: "org-internal",
                slug: "internal",
                name: "Internal",
                type: "internal",
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }
          ])
        },
        email: "internal@baicells.com"
      })
    ).resolves.toBe(true);
  });

  it("keeps customer users on the external email entry", async () => {
    await expect(
      isInternalUserForEmail({
        users: {
          getById: vi.fn(),
          getByEmail: vi.fn(async () => buildUser({ userType: "external_user" }))
        } as unknown as UserRepositoryLike,
        identities: { listByEmail: vi.fn(async () => []) },
        memberships: {
          listActiveForUser: vi.fn(async () => [
            {
              id: "membership-1",
              organizationId: "org-customer",
              userId: "user-1",
              membershipType: "customer_member",
              status: "active",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              organization: {
                id: "org-customer",
                slug: "customer",
                name: "Customer",
                type: "customer",
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }
          ])
        },
        email: "customer@example.com"
      })
    ).resolves.toBe(false);
  });
});
