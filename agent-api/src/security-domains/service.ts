import type { Prisma, PrismaClient } from "@prisma/client";

export type SecurityDomainRuleInput = {
  subjectType: "user" | "department";
  subjectId: string;
  includeChildren?: boolean;
};

export type SecurityDomainView = {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "inactive";
  rules: Array<SecurityDomainRuleInput & { id: string }>;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export class SecurityDomainConflictError extends Error {
  constructor(
    public readonly conflicts: Array<{
      userId: string;
      domainIds: string[];
      domainNames: string[];
    }>
  ) {
    super("用户不能同时属于多个保密域");
    this.name = "SecurityDomainConflictError";
  }
}

type DbClient = PrismaClient | Prisma.TransactionClient;

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function domainView(row: {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  rules: Array<{
    id: string;
    subjectType: string;
    subjectId: string;
    includeChildren: boolean;
  }>;
  _count: { members: number };
}): SecurityDomainView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status === "inactive" ? "inactive" : "active",
    rules: row.rules.map((rule) => ({
      id: rule.id,
      subjectType: rule.subjectType === "department" ? "department" : "user",
      subjectId: rule.subjectId,
      includeChildren: rule.includeChildren
    })),
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export class SecurityDomainService {
  constructor(private readonly db: PrismaClient) {}

  async list(organizationId: string): Promise<SecurityDomainView[]> {
    const rows = await this.db.securityDomain.findMany({
      where: { organizationId },
      include: {
        rules: { orderBy: { createdAt: "asc" } },
        _count: { select: { members: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(domainView);
  }

  async getForUser(input: { organizationId: string; userId: string }): Promise<{ id: string; name: string } | undefined> {
    const membership = await this.db.securityDomainMember.findUnique({
      where: { userId: input.userId },
      include: { securityDomain: true }
    });
    if (
      !membership ||
      membership.securityDomain.organizationId !== input.organizationId ||
      membership.securityDomain.status !== "active"
    ) {
      return undefined;
    }
    return { id: membership.securityDomain.id, name: membership.securityDomain.name };
  }

  async getDomainIdForUser(userId: string): Promise<string | undefined> {
    const membership = await this.db.securityDomainMember.findUnique({
      where: { userId },
      include: { securityDomain: { select: { id: true, status: true } } }
    });
    return membership?.securityDomain.status === "active" ? membership.securityDomain.id : undefined;
  }

  async create(input: {
    organizationId: string;
    name: string;
    status?: "active" | "inactive";
    rules: SecurityDomainRuleInput[];
  }): Promise<SecurityDomainView> {
    const name = normalizeText(input.name);
    if (!name) throw new Error("保密域名称不能为空");
    const id = await this.db.$transaction(async (tx) => {
      const created = await tx.securityDomain.create({
        data: {
          organizationId: input.organizationId,
          name,
          status: input.status ?? "active"
        }
      });
      await this.replaceRules(tx, created.id, input.rules);
      await this.refreshOrganization(tx, input.organizationId);
      return created.id;
    });
    return this.requireView(input.organizationId, id);
  }

  async update(input: {
    organizationId: string;
    domainId: string;
    name: string;
    status: "active" | "inactive";
    rules: SecurityDomainRuleInput[];
  }): Promise<SecurityDomainView> {
    const name = normalizeText(input.name);
    if (!name) throw new Error("保密域名称不能为空");
    await this.db.$transaction(async (tx) => {
      const existing = await tx.securityDomain.findFirst({
        where: { id: input.domainId, organizationId: input.organizationId },
        select: { id: true }
      });
      if (!existing) throw new Error("保密域不存在");
      await tx.securityDomain.update({
        where: { id: input.domainId },
        data: { name, status: input.status }
      });
      await this.replaceRules(tx, input.domainId, input.rules);
      await this.refreshOrganization(tx, input.organizationId);
    });
    return this.requireView(input.organizationId, input.domainId);
  }

  async refresh(organizationId: string): Promise<void> {
    await this.db.$transaction((tx) => this.refreshOrganization(tx, organizationId));
  }

  async refreshAll(): Promise<void> {
    const domains = await this.db.securityDomain.findMany({ select: { organizationId: true } });
    for (const organizationId of [...new Set(domains.map((domain) => domain.organizationId))]) {
      await this.refresh(organizationId);
    }
  }

  private async requireView(organizationId: string, domainId: string): Promise<SecurityDomainView> {
    const row = await this.db.securityDomain.findFirst({
      where: { id: domainId, organizationId },
      include: {
        rules: { orderBy: { createdAt: "asc" } },
        _count: { select: { members: true } }
      }
    });
    if (!row) throw new Error("保密域不存在");
    return domainView(row);
  }

  private async replaceRules(tx: Prisma.TransactionClient, domainId: string, rules: SecurityDomainRuleInput[]) {
    const normalized = new Map<string, SecurityDomainRuleInput>();
    for (const rule of rules) {
      const subjectId = normalizeText(rule.subjectId);
      if (!subjectId) continue;
      const subjectType = rule.subjectType === "department" ? "department" : "user";
      normalized.set(`${subjectType}:${subjectId}`, {
        subjectType,
        subjectId,
        includeChildren: subjectType === "department" && Boolean(rule.includeChildren)
      });
    }
    await tx.securityDomainRule.deleteMany({ where: { securityDomainId: domainId } });
    if (normalized.size > 0) {
      await tx.securityDomainRule.createMany({
        data: [...normalized.values()].map((rule) => ({ securityDomainId: domainId, ...rule }))
      });
    }
  }

  private async refreshOrganization(tx: DbClient, organizationId: string): Promise<void> {
    const domains = await tx.securityDomain.findMany({
      where: { organizationId, status: "active" },
      include: { rules: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" }
    });
    const departments = await tx.department.findMany({
      where: { organizationId, status: "active" },
      select: { id: true, parentDepartmentId: true }
    });
    const children = new Map<string, string[]>();
    for (const department of departments) {
      if (!department.parentDepartmentId) continue;
      const list = children.get(department.parentDepartmentId) ?? [];
      list.push(department.id);
      children.set(department.parentDepartmentId, list);
    }
    const departmentIds = new Set(departments.map((department) => department.id));
    const expandedDepartmentIds = (rootId: string, includeChildren: boolean): string[] => {
      if (!departmentIds.has(rootId)) return [];
      if (!includeChildren) return [rootId];
      const result: string[] = [];
      const pending = [rootId];
      const seen = new Set<string>();
      while (pending.length > 0) {
        const current = pending.shift()!;
        if (seen.has(current)) continue;
        seen.add(current);
        result.push(current);
        pending.push(...(children.get(current) ?? []));
      }
      return result;
    };

    const requestedUserIds = new Set<string>();
    const domainSources = new Map<string, Map<string, { sourceType: string; sourceId: string }>>();
    for (const domain of domains) {
      const sources = new Map<string, { sourceType: string; sourceId: string }>();
      domainSources.set(domain.id, sources);
      for (const rule of domain.rules.filter((item) => item.subjectType === "user")) {
        requestedUserIds.add(rule.subjectId);
        sources.set(rule.subjectId, { sourceType: "user", sourceId: rule.subjectId });
      }
      const selectedDepartmentIds = domain.rules
        .filter((rule) => rule.subjectType === "department")
        .flatMap((rule) => expandedDepartmentIds(rule.subjectId, rule.includeChildren));
      if (selectedDepartmentIds.length === 0) continue;
      const memberships = await tx.departmentMembership.findMany({
        where: { departmentId: { in: [...new Set(selectedDepartmentIds)] } },
        select: { userId: true, departmentId: true }
      });
      for (const membership of memberships) {
        requestedUserIds.add(membership.userId);
        if (!sources.has(membership.userId)) {
          sources.set(membership.userId, { sourceType: "department", sourceId: membership.departmentId });
        }
      }
    }

    const eligibleUsers = requestedUserIds.size
      ? await tx.user.findMany({
          where: {
            id: { in: [...requestedUserIds] },
            status: "active",
            OR: [
              { primaryOrganizationId: organizationId },
              { organizationMemberships: { some: { organizationId, status: "active" } } }
            ]
          },
          select: { id: true }
        })
      : [];
    const eligibleUserIds = new Set(eligibleUsers.map((user) => user.id));
    const domainsByUser = new Map<string, string[]>();
    for (const [domainId, sources] of domainSources) {
      for (const userId of sources.keys()) {
        if (!eligibleUserIds.has(userId)) continue;
        const assigned = domainsByUser.get(userId) ?? [];
        assigned.push(domainId);
        domainsByUser.set(userId, assigned);
      }
    }
    const domainNameById = new Map(domains.map((domain) => [domain.id, domain.name]));
    const conflicts = [...domainsByUser.entries()]
      .filter(([, domainIds]) => domainIds.length > 1)
      .map(([userId, domainIds]) => ({
        userId,
        domainIds,
        domainNames: domainIds.map((domainId) => domainNameById.get(domainId) ?? domainId)
      }));
    if (conflicts.length > 0) throw new SecurityDomainConflictError(conflicts);

    const domainIds = domains.map((domain) => domain.id);
    const allOrganizationDomainIds = await tx.securityDomain.findMany({
      where: { organizationId },
      select: { id: true }
    });
    await tx.securityDomainMember.deleteMany({
      where: { securityDomainId: { in: allOrganizationDomainIds.map((domain) => domain.id) } }
    });
    const members = [...domainsByUser.entries()].flatMap(([userId, assignedDomainIds]) => {
      const securityDomainId = assignedDomainIds[0];
      if (!securityDomainId || !domainIds.includes(securityDomainId)) return [];
      const source = domainSources.get(securityDomainId)?.get(userId);
      return source ? [{ securityDomainId, userId, ...source }] : [];
    });
    if (members.length > 0) await tx.securityDomainMember.createMany({ data: members });
    for (const domain of domains) {
      const userIds = members
        .filter((member) => member.securityDomainId === domain.id)
        .map((member) => member.userId);
      if (userIds.length === 0) continue;
      await tx.thread.updateMany({
        where: {
          organizationId,
          userId: { in: userIds },
          channel: "portal",
          securityDomainId: null
        },
        data: { securityDomainId: domain.id }
      });
    }
  }
}
