import { Router, type Request, type RequestHandler, type Response } from "express";

import { AdminAuditLogRepository } from "../persistence/admin-audit-log-repository.js";
import { PermissionRepository } from "../persistence/permission-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import type { ResourcePolicyResourceType } from "../persistence/resource-policy-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";
import { PolicyService } from "../resources/policy-service.js";

type RbacDb = {
  userRole?: {
    findMany(args?: {
      where?: { userId?: string; roleId?: string };
      include?: { role?: boolean };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<
      Array<{
        userId: string;
        roleId: string;
        isPrimary: boolean;
        role?: { id: string; slug: string; name: string; isSystem: boolean; isActive: boolean } | null;
      }>
    >;
  };
  user?: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; role: string | null } | null>;
  };
};

type CreateRequirePermission = (permissionKey: string) => RequestHandler;

type CreateRbacRouterOptions = {
  roles: RoleRepository;
  permissions: PermissionRepository;
  userRoles: UserRoleRepository;
  rolePermissions: RolePermissionRepository;
  audits: AdminAuditLogRepository;
  policies: PolicyService;
  requirePermission: CreateRequirePermission;
  db?: RbacDb;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "RBAC 请求失败";
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getActorUserId(req: Request): string | undefined {
  return trimOrUndefined(req.currentUser?.id);
}

function getRolePermissionIds(
  bindings: Awaited<ReturnType<RolePermissionRepository["listForRole"]>>,
): string[] {
  return bindings.map((binding) => binding.permissionId);
}

async function buildRoleDetail(
  options: Pick<CreateRbacRouterOptions, "roles" | "permissions" | "rolePermissions" | "policies" | "audits" | "db">,
  roleId: string
) {
  const role = await options.roles.getById(roleId);
  if (!role) {
    return null;
  }

  const [allPermissions, roleBindings, resourcePolicies, recentAuditEntries, members] = await Promise.all([
    options.permissions.list(),
    options.rolePermissions.listForRole(roleId),
    Promise.all(
      (["workspace", "knowledge_set", "agent_mode", "skill_package", "run_profile"] as ResourcePolicyResourceType[]).map(
        (resourceType) =>
          options.policies.listSubjectPolicies({
            subjectType: "role",
            subjectId: roleId,
            resourceType
          })
      )
    ).then((rows) => rows.flat()),
    options.audits.list({ targetType: "role", targetId: roleId, take: 20 }),
    typeof options.db?.userRole?.findMany === "function"
      ? options.db.userRole.findMany({
          where: { roleId },
          include: { role: true },
          orderBy: { createdAt: "asc" }
        })
      : Promise.resolve([])
  ]);

  const boundPermissionIds = new Set(getRolePermissionIds(roleBindings));

  return {
    role,
    permissions: allPermissions.map((permission) => ({
      ...permission,
      assigned: boundPermissionIds.has(permission.id)
    })),
    resourcePolicies,
    memberCount: members.length,
    recentAuditEntries
  };
}

export function createRbacRouter(options: CreateRbacRouterOptions): Router {
  const router = Router();

  router.get("/roles", options.requirePermission("role.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ roles: await options.roles.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/roles", options.requirePermission("role.write"), async (req: Request, res: Response) => {
    try {
      const role = await options.roles.create({
        slug: String(req.body?.slug ?? ""),
        name: String(req.body?.name ?? ""),
        description: trimOrUndefined(req.body?.description)
      });
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.created",
        targetType: "role",
        targetId: role.id,
        afterPayload: role
      });
      res.status(201).json({ role });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/roles/:roleId", options.requirePermission("role.read"), async (req: Request, res: Response) => {
    try {
      const detail = await buildRoleDetail(options, req.params.roleId);
      if (!detail) {
        res.status(404).json({ detail: "role 不存在" });
        return;
      }
      res.json(detail);
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/roles/:roleId", options.requirePermission("role.write"), async (req: Request, res: Response) => {
    try {
      const before = await options.roles.getById(req.params.roleId);
      if (!before) {
        res.status(404).json({ detail: "role 不存在" });
        return;
      }
      const role = await options.roles.update(req.params.roleId, {
        slug: req.body?.slug,
        name: req.body?.name,
        description: req.body?.description,
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
      });
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.updated",
        targetType: "role",
        targetId: role.id,
        beforePayload: before,
        afterPayload: role
      });
      res.json({ role });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/roles/:roleId/clone", options.requirePermission("role.clone"), async (req: Request, res: Response) => {
    try {
      const role = await options.roles.clone({
        sourceRoleId: req.params.roleId,
        slug: String(req.body?.slug ?? ""),
        name: String(req.body?.name ?? ""),
        description: req.body?.description ?? null
      });
      const sourceBindings = await options.rolePermissions.listForRole(req.params.roleId);
      await options.rolePermissions.replaceRolePermissions(role.id, getRolePermissionIds(sourceBindings));
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.cloned",
        targetType: "role",
        targetId: role.id,
        metadata: { sourceRoleId: req.params.roleId },
        afterPayload: role
      });
      res.status(201).json({ role });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/roles/:roleId/disable", options.requirePermission("role.disable"), async (req: Request, res: Response) => {
    try {
      const before = await options.roles.getById(req.params.roleId);
      if (!before) {
        res.status(404).json({ detail: "role 不存在" });
        return;
      }
      const role = await options.roles.disable(req.params.roleId);
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.disabled",
        targetType: "role",
        targetId: role.id,
        beforePayload: before,
        afterPayload: role
      });
      res.json({ role });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/roles/:roleId/permissions", options.requirePermission("permission.read"), async (req: Request, res: Response) => {
    try {
      res.json({ bindings: await options.rolePermissions.listForRole(req.params.roleId) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/roles/:roleId/permissions", options.requirePermission("permission.assign"), async (req: Request, res: Response) => {
    try {
      const before = await options.rolePermissions.listForRole(req.params.roleId);
      const permissionIds = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds.map(String) : [];
      const bindings = await options.rolePermissions.replaceRolePermissions(req.params.roleId, permissionIds);
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.permissions.updated",
        targetType: "role",
        targetId: req.params.roleId,
        beforePayload: before,
        afterPayload: bindings
      });
      res.json({ bindings });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/roles/:roleId/resource-policies", options.requirePermission("resource_policy.read"), async (req: Request, res: Response) => {
    try {
      const resourceType = trimOrUndefined(req.query.resourceType as string | undefined) as ResourcePolicyResourceType | undefined;
      res.json({
        policies: await options.policies.listSubjectPolicies({
          subjectType: "role",
          subjectId: req.params.roleId,
          resourceType
        })
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/roles/:roleId/resource-policies", options.requirePermission("resource_policy.write"), async (req: Request, res: Response) => {
    try {
      const resourceType = trimOrUndefined(String(req.body?.resourceType ?? "")) as ResourcePolicyResourceType | undefined;
      if (!resourceType) {
        res.status(400).json({ detail: "resourceType 必填" });
        return;
      }
      const before = await options.policies.listSubjectPolicies({
        subjectType: "role",
        subjectId: req.params.roleId,
        resourceType
      });
      const policies = Array.isArray(req.body?.policies)
        ? req.body.policies.map((policy: Record<string, unknown>) => ({
            resourceId: String(policy.resourceId ?? ""),
            effect: policy.effect === "deny" ? "deny" : "allow"
          }))
        : [];
      const replaced = await options.policies.replaceSubjectPolicies({
        subjectType: "role",
        subjectId: req.params.roleId,
        resourceType,
        policies
      });
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "role.resource_policies.updated",
        targetType: "role",
        targetId: req.params.roleId,
        beforePayload: before,
        afterPayload: replaced,
        metadata: { resourceType }
      });
      res.json({ policies: replaced });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/roles/:roleId/members", options.requirePermission("role.read"), async (req: Request, res: Response) => {
    try {
      const assignments =
        typeof options.db?.userRole?.findMany === "function"
          ? await options.db.userRole.findMany({
              where: { roleId: req.params.roleId },
              include: { role: true },
              orderBy: { createdAt: "asc" }
            })
          : [];
      res.json({
        members: assignments.map((assignment: { userId: string; roleId: string; isPrimary: boolean }) => ({
          userId: assignment.userId,
          roleId: assignment.roleId,
          isPrimary: assignment.isPrimary
        }))
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/permissions", options.requirePermission("permission.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ permissions: await options.permissions.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/users/:userId/roles", options.requirePermission("user.read"), async (req: Request, res: Response) => {
    try {
      res.json({ userRoles: await options.userRoles.listForUser(req.params.userId) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/users/:userId/roles", options.requirePermission("user.role.assign"), async (req: Request, res: Response) => {
    try {
      const assignments: Array<{ roleId: string; isPrimary: boolean }> = Array.isArray(req.body?.assignments)
        ? req.body.assignments.map((assignment: Record<string, unknown>) => ({
            roleId: String(assignment.roleId ?? ""),
            isPrimary: parseBoolean(assignment.isPrimary, false)
          }))
        : [];
      const primaryAssignment = assignments.find((assignment) => assignment.isPrimary);
      if (!primaryAssignment) {
        res.status(400).json({ detail: "必须指定一个主角色" });
        return;
      }
      const before = await options.userRoles.listForUser(req.params.userId);
      const primaryRole = await options.roles.getById(primaryAssignment.roleId);
      if (!primaryRole) {
        res.status(404).json({ detail: "role 不存在" });
        return;
      }
      const userRoles = await options.userRoles.replaceUserRoles({
        userId: req.params.userId,
        assignments,
        mirrorLegacyRole: primaryRole.slug
      });
      await options.audits.create({
        actorUserId: getActorUserId(req),
        actionType: "user.roles.updated",
        targetType: "user",
        targetId: req.params.userId,
        beforePayload: before,
        afterPayload: userRoles
      });
      res.json({ userRoles });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/audit-logs", options.requirePermission("audit.read"), async (req: Request, res: Response) => {
    try {
      res.json({
        auditLogs: await options.audits.list({
          targetType: trimOrUndefined(req.query.targetType as string | undefined),
          targetId: trimOrUndefined(req.query.targetId as string | undefined),
          actorUserId: trimOrUndefined(req.query.actorUserId as string | undefined)
        })
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
