export function clone<T>(value: T): T {
  return structuredClone(value);
}

export type FakeUserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  statusSource: string | null;
  syncState: string | null;
  manualDisabled: boolean;
  adminNote: string | null;
  lastSyncedAt: Date | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeRoleRow = {
  id: string;
  organizationId: string | null;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FakePermissionRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeUserRoleRow = {
  id: string;
  userId: string;
  roleId: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeRolePermissionRow = {
  id: string;
  roleId: string;
  permissionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeAdminAuditLogRow = {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actionType: string;
  targetType: string;
  targetId: string | null;
  beforePayload: unknown;
  afterPayload: unknown;
  metadata: unknown;
  createdAt: Date;
};

export class FakeRbacDb {
  private userCounter = 0;
  private roleCounter = 0;
  private permissionCounter = 0;
  private userRoleCounter = 0;
  private rolePermissionCounter = 0;
  private auditLogCounter = 0;

  constructor(
    readonly users: FakeUserRow[] = [],
    readonly roles: FakeRoleRow[] = [],
    readonly permissions: FakePermissionRow[] = [],
    readonly userRoles: FakeUserRoleRow[] = [],
    readonly rolePermissions: FakeRolePermissionRow[] = [],
    readonly adminAuditLogs: FakeAdminAuditLogRow[] = []
  ) {}

  readonly user = {
    findUnique: async ({ where }: { where: { id?: string; externalId?: string; email?: string } }) => {
      const row = this.users.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        if (where.email) return item.email === where.email;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ where, orderBy }: { where?: { status?: string; role?: string }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.users.filter((item) => {
        if (where?.status && item.status !== where.status) return false;
        if (where?.role && item.role !== where.role) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeUserRow = {
        id: typeof data.id === "string" ? data.id : `user-${++this.userCounter}`,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        email: typeof data.email === "string" ? data.email : null,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: typeof data.role === "string" ? data.role : null,
        status: typeof data.status === "string" ? data.status : null,
        statusSource: typeof data.statusSource === "string" ? data.statusSource : null,
        syncState: typeof data.syncState === "string" ? data.syncState : null,
        manualDisabled: typeof data.manualDisabled === "boolean" ? data.manualDisabled : false,
        adminNote: typeof data.adminNote === "string" ? data.adminNote : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        dingtalkOpenId: typeof data.dingtalkOpenId === "string" ? data.dingtalkOpenId : null,
        dingtalkUserId: typeof data.dingtalkUserId === "string" ? data.dingtalkUserId : null,
        dingtalkCorpId: typeof data.dingtalkCorpId === "string" ? data.dingtalkCorpId : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.users.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.users.find((item) => item.id === where.id);
      if (!row) throw new Error("user not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly role = {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.roles.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { id?: { in: string[] }; slug?: string; organizationId?: string | null };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.roles.filter((item) => {
        if (where?.id?.in?.length && !where.id.in.includes(item.id)) return false;
        if (where?.slug && item.slug !== where.slug) return false;
        if (where && "organizationId" in where && item.organizationId !== (where.organizationId ?? null)) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeRoleRow = {
        id: typeof data.id === "string" ? data.id : `role-${++this.roleCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        slug: typeof data.slug === "string" ? data.slug : "",
        name: typeof data.name === "string" ? data.name : "",
        description: typeof data.description === "string" ? data.description : null,
        isSystem: typeof data.isSystem === "boolean" ? data.isSystem : false,
        isActive: typeof data.isActive === "boolean" ? data.isActive : true,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.roles.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.roles.find((item) => item.id === where.id);
      if (!row) throw new Error("role not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly permission = {
    findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
      const row = this.permissions.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.key) return item.key === where.key;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = [...this.permissions];
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakePermissionRow = {
        id: typeof data.id === "string" ? data.id : `permission-${++this.permissionCounter}`,
        key: typeof data.key === "string" ? data.key : "",
        name: typeof data.name === "string" ? data.name : "",
        description: typeof data.description === "string" ? data.description : null,
        category: typeof data.category === "string" ? data.category : "",
        isSystem: typeof data.isSystem === "boolean" ? data.isSystem : true,
        isActive: typeof data.isActive === "boolean" ? data.isActive : true,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.permissions.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.permissions.find((item) => item.id === where.id);
      if (!row) throw new Error("permission not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly userRole = {
    findMany: async ({
      where,
      include,
      orderBy
    }: {
      where?: { userId?: string; roleId?: string; roleIdIn?: string[] };
      include?: { role?: boolean };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.userRoles.filter((item) => {
        if (where?.userId && item.userId !== where.userId) return false;
        if (where?.roleId && item.roleId !== where.roleId) return false;
        if (where?.roleIdIn && !where.roleIdIn.includes(item.roleId)) return false;
        return true;
      });
      const hydratedRows = rows.map((row) => ({
        ...row,
        role: include?.role ? this.roles.find((role) => role.id === row.roleId) ?? null : undefined
      }));
      hydratedRows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(hydratedRows);
    },
    deleteMany: async ({ where }: { where: { userId?: string; roleId?: string } }) => {
      const before = this.userRoles.length;
      const remaining = this.userRoles.filter((item) => {
        if (where.userId && item.userId !== where.userId) return true;
        if (where.roleId && item.roleId !== where.roleId) return true;
        return false;
      });
      this.userRoles.splice(0, this.userRoles.length, ...remaining);
      return { count: before - this.userRoles.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeUserRoleRow = {
        id: typeof data.id === "string" ? data.id : `user-role-${++this.userRoleCounter}`,
        userId: typeof data.userId === "string" ? data.userId : "",
        roleId: typeof data.roleId === "string" ? data.roleId : "",
        isPrimary: typeof data.isPrimary === "boolean" ? data.isPrimary : false,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.userRoles.push(row);
      return clone(row);
    }
  };

  readonly rolePermission = {
    findMany: async ({ where, orderBy }: { where?: { roleId?: string; roleIdIn?: string[] }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.rolePermissions.filter((item) => {
        if (where?.roleId && item.roleId !== where.roleId) return false;
        if (where?.roleIdIn && !where.roleIdIn.includes(item.roleId)) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { roleId?: string } }) => {
      const before = this.rolePermissions.length;
      const remaining = this.rolePermissions.filter((item) => {
        if (where.roleId && item.roleId !== where.roleId) return true;
        return false;
      });
      this.rolePermissions.splice(0, this.rolePermissions.length, ...remaining);
      return { count: before - this.rolePermissions.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeRolePermissionRow = {
        id: typeof data.id === "string" ? data.id : `role-permission-${++this.rolePermissionCounter}`,
        roleId: typeof data.roleId === "string" ? data.roleId : "",
        permissionId: typeof data.permissionId === "string" ? data.permissionId : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rolePermissions.push(row);
      return clone(row);
    }
  };

  readonly adminAuditLog = {
    findMany: async ({ where, orderBy }: { where?: { targetType?: string; targetId?: string | null }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.adminAuditLogs.filter((item) => {
        if (where?.targetType && item.targetType !== where.targetType) return false;
        if (where?.targetId !== undefined && item.targetId !== where.targetId) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAdminAuditLogRow = {
        id: typeof data.id === "string" ? data.id : `audit-${++this.auditLogCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : null,
        actionType: typeof data.actionType === "string" ? data.actionType : "",
        targetType: typeof data.targetType === "string" ? data.targetType : "",
        targetId: typeof data.targetId === "string" ? data.targetId : null,
        beforePayload: data.beforePayload,
        afterPayload: data.afterPayload,
        metadata: data.metadata,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now
      };
      this.adminAuditLogs.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeRbacDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
