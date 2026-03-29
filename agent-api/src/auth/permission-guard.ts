import type { NextFunction, Request, RequestHandler, Response } from "express";

type PermissionChecker = {
  hasPermission(input: { userId: string; legacyRole?: string; permissionKey: string }): Promise<boolean>;
};

type PermissionGuardOptions = {
  resourceAccessLogs?: {
    record(input: {
      userId?: string;
      departmentIdSnapshot?: string;
      resourceType: string;
      resourceId: string;
      actionType: string;
      resultStatus: string;
      metadata?: unknown;
    }): Promise<unknown>;
  };
  listDepartmentIdsForUser?: (userId: string) => Promise<string[]>;
  securityAlerts?: {
    evaluateSecurityEvent(input: {
      scopeType: string;
      scopeId: string;
      resourceType?: string;
      resourceId?: string;
      actionType?: string;
      resultStatus?: string;
      userId?: string;
      denialPattern?: {
        deniedCount: number;
        thresholdCount?: number;
      };
    }): Promise<unknown>;
  };
  countRecentDeniedPermissionsForUser?: (userId: string, permissionKey: string) => Promise<number>;
};

export function createPermissionGuard(permissionChecker: PermissionChecker, options: PermissionGuardOptions = {}) {
  return function requirePermission(permissionKey: string): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.currentUser) {
        res.status(401).json({ detail: "Unauthorized" });
        return;
      }

      try {
        const allowed = await permissionChecker.hasPermission({
          userId: req.currentUser.id,
          legacyRole: req.currentUser.role,
          permissionKey
        });
        if (!allowed) {
          if (options.resourceAccessLogs) {
            const departmentIds = options.listDepartmentIdsForUser
              ? await options.listDepartmentIdsForUser(req.currentUser.id)
              : [];
            const departmentIdSnapshot = departmentIds[0];
            await options.resourceAccessLogs.record({
              userId: req.currentUser.id,
              departmentIdSnapshot,
              resourceType: "permission",
              resourceId: permissionKey,
              actionType: "deny",
              resultStatus: "denied",
              metadata: {
                kind: "permission_guard"
              }
            });
            if (options.securityAlerts) {
              const deniedCount = options.countRecentDeniedPermissionsForUser
                ? await options.countRecentDeniedPermissionsForUser(req.currentUser.id, permissionKey)
                : 1;
              await options.securityAlerts.evaluateSecurityEvent({
                scopeType: departmentIdSnapshot ? "department" : "platform",
                scopeId: departmentIdSnapshot ?? "platform",
                resourceType: "permission",
                resourceId: permissionKey,
                actionType: "deny",
                resultStatus: "denied",
                userId: req.currentUser.id,
                denialPattern: {
                  deniedCount,
                  thresholdCount: 3
                }
              });
            }
          }
          res.status(403).json({ detail: "Forbidden" });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

export const createRequirePermission = createPermissionGuard;
