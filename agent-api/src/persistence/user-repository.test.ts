import { describe, expect, it, vi } from "vitest";

import { UserRepository, type UserRepositoryDb } from "./user-repository.js";

function buildUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    userType: "external_user",
    primaryOrganizationId: null,
    externalId: null,
    email: "invitee@example.com",
    displayName: "Invitee",
    role: "employee",
    status: "active",
    statusSource: "manual",
    syncState: "active",
    manualDisabled: false,
    adminNote: null,
    preferencesJson: null,
    lastSyncedAt: null,
    dingtalkOpenId: null,
    dingtalkUserId: null,
    dingtalkCorpId: null,
    createdAt: new Date("2026-04-13T00:00:00.000Z"),
    updatedAt: new Date("2026-04-13T00:00:00.000Z"),
    ...overrides
  };
}

describe("UserRepository", () => {
  it("does not replace an organization-synced name with a DingTalk OAuth nickname", async () => {
    const existing = buildUserRow({
      externalId: "union_1",
      displayName: "李可",
      lastSyncedAt: new Date("2026-08-06T00:00:00.000Z")
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => buildUserRow({ ...existing, ...data }));
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => existing),
        update
      }
    } as UserRepositoryDb);

    await repository.upsertFromDingTalk({
      unionId: "union_1",
      displayName: "Like李可15686172592"
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: "李可" })
    }));
  });

  it("uses a DingTalk OAuth name before the first organization sync", async () => {
    const existing = buildUserRow({ externalId: "union_1", displayName: "旧名称", lastSyncedAt: null });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => buildUserRow({ ...existing, ...data }));
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => existing),
        update
      }
    } as UserRepositoryDb);

    await repository.upsertFromDingTalk({ unionId: "union_1", displayName: "首次登录名称" });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: "首次登录名称" })
    }));
  });

  it("preserves an organization-synced name during a generic identity profile refresh", async () => {
    const existing = buildUserRow({
      userType: "internal_employee",
      externalId: "union_1",
      displayName: "王力",
      lastSyncedAt: new Date("2026-08-08T06:11:12.962Z")
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => buildUserRow({ ...existing, ...data }));
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => existing),
        update
      }
    } as UserRepositoryDb);

    await repository.updateUserProfile({
      userId: existing.id,
      email: "wangli@baicells.com",
      displayName: "王力/Wangli (会议请发邮件邀请谢谢)",
      userType: "internal_employee"
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        displayName: "王力",
        email: "wangli@baicells.com",
        userType: "internal_employee"
      })
    }));
  });

  it("accepts an identity display name before organization sync establishes a canonical name", async () => {
    const existing = buildUserRow({
      userType: "internal_employee",
      displayName: "旧登录名称",
      lastSyncedAt: null
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => buildUserRow({ ...existing, ...data }));
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => existing),
        update
      }
    } as UserRepositoryDb);

    await repository.updateUserProfile({
      userId: existing.id,
      displayName: "首次身份登录名称"
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: "首次身份登录名称" })
    }));
  });

  it("looks up users by email with findFirst instead of findUnique", async () => {
    const findFirst = vi.fn(async () => buildUserRow());
    const findUnique = vi.fn(async () => null);
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique,
        findFirst,
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => buildUserRow()),
        update: vi.fn(async () => buildUserRow())
      }
    } as UserRepositoryDb);

    const user = await repository.getByEmail("Invitee@Example.com");

    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: { email: "invitee@example.com" },
      orderBy: { createdAt: "asc" }
    });
    expect(user).toMatchObject({
      id: "user_1",
      email: "invitee@example.com",
      userType: "external_user"
    });
  });

  it("maps portal preferences from preferencesJson", async () => {
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () =>
          buildUserRow({
            preferencesJson: {
              portal: {
                showProcessTrace: true,
                collapseFinalTraceOnDone: false
              }
            }
          })
        ),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => buildUserRow()),
        update: vi.fn(async () => buildUserRow())
      }
    } as UserRepositoryDb);

    const user = await repository.getById("user_1");

    expect(user).toMatchObject({
      id: "user_1",
      portalPreferences: {
        showProcessTrace: true,
        collapseFinalTraceOnDone: false
      }
    });
  });

  it("updates portal preferences without dropping unrelated preferences", async () => {
    const existing = buildUserRow({
      preferencesJson: {
        portal: {
          showProcessTrace: false
        },
        workbench: {
          sidebarCollapsed: true
        }
      }
    });
    const update = vi.fn(async () =>
      buildUserRow({
        preferencesJson: {
          portal: {
            showProcessTrace: true,
            collapseFinalTraceOnDone: true
          },
          workbench: {
            sidebarCollapsed: true
          }
        }
      })
    );
    const repository = new UserRepository({
      user: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => buildUserRow()),
        update
      }
    } as UserRepositoryDb);

    const user = await repository.updatePortalPreferences({
      userId: "user_1",
      portalPreferences: {
        showProcessTrace: true,
        collapseFinalTraceOnDone: true
      }
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        preferencesJson: {
          portal: {
            showProcessTrace: true,
            collapseFinalTraceOnDone: true
          },
          workbench: {
            sidebarCollapsed: true
          }
        },
        updatedAt: expect.any(Date)
      }
    });
    expect(user).toMatchObject({
      portalPreferences: {
        showProcessTrace: true,
        collapseFinalTraceOnDone: true
      }
    });
  });
});
