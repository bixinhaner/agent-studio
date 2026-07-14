import { describe, expect, it } from "vitest";

import { SecurityDomainAccessControl, SecurityDomainAccessError } from "./access-control.js";

function createAccessControl() {
  let policy:
    | { organizationId: string; passwordDigest: string; passwordVersion: number; updatedByUserId?: string }
    | null = null;
  const db = {
    securityDomainAccessPolicy: {
      findUnique: async () => policy,
      create: async ({ data }: { data: typeof policy }) => {
        policy = { ...(data as NonNullable<typeof policy>), passwordVersion: 1 };
        return policy;
      },
      update: async ({ data }: { data: { passwordDigest: string; updatedByUserId: string } }) => {
        policy = {
          ...policy!,
          passwordDigest: data.passwordDigest,
          passwordVersion: policy!.passwordVersion + 1,
          updatedByUserId: data.updatedByUserId
        };
        return policy;
      }
    }
  };
  return new SecurityDomainAccessControl(db as never, {
    cookieName: "security_access",
    secret: "test-secret",
    secure: false,
    grantTtlMs: 60_000
  });
}

describe("SecurityDomainAccessControl", () => {
  it("allows only a super admin to initialize and binds the grant to user and organization", async () => {
    const access = createAccessControl();
    await expect(
      access.initialize({ organizationId: "org-1", userId: "admin-1", role: "admin", password: "strong-password" })
    ).rejects.toMatchObject({ status: 403 });

    const cookie = await access.initialize({
      organizationId: "org-1",
      userId: "super-1",
      role: "super_admin",
      password: "strong-password"
    });

    await expect(
      access.status({ organizationId: "org-1", userId: "super-1", role: "super_admin", cookie })
    ).resolves.toMatchObject({ configured: true, unlocked: true });
    await expect(
      access.status({ organizationId: "org-1", userId: "other", role: "admin", cookie })
    ).resolves.toMatchObject({ configured: true, unlocked: false });
  });

  it("rejects an incorrect password and invalidates older grants after a password change", async () => {
    const access = createAccessControl();
    const oldCookie = await access.initialize({
      organizationId: "org-1",
      userId: "super-1",
      role: "super_admin",
      password: "strong-password"
    });
    await expect(
      access.unlock({ organizationId: "org-1", userId: "admin-1", password: "wrong-password" })
    ).rejects.toMatchObject({ status: 403, code: "invalid_password" } satisfies Partial<SecurityDomainAccessError>);

    const newCookie = await access.changePassword({
      organizationId: "org-1",
      userId: "super-1",
      cookie: oldCookie,
      password: "new-strong-password"
    });
    await expect(access.requireUnlocked("org-1", "super-1", oldCookie)).rejects.toMatchObject({ status: 423 });
    await expect(access.requireUnlocked("org-1", "super-1", newCookie)).resolves.toBeDefined();
  });
});
