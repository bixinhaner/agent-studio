import type { NextFunction, Request, RequestHandler, Response } from "express";

type PermissionChecker = {
  hasPermission(input: { userId: string; legacyRole?: string; permissionKey: string }): Promise<boolean>;
};

export function createPermissionGuard(permissionChecker: PermissionChecker) {
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
