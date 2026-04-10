import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";
import type { OrganizationMembershipRecord } from "../persistence/organization-membership-repository.js";
import type { SessionCookieManager } from "./session-cookie.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: AuthenticatedUser;
      currentOrganization?: OrganizationMembershipRecord["organization"];
      currentMembership?: OrganizationMembershipRecord;
    }
  }
}

export function userOut(user: AuthenticatedUser) {
  return {
    id: user.id,
    user_type: user.userType ?? "internal_employee",
    primary_organization_id: user.primaryOrganizationId ?? null,
    external_id: user.externalId ?? null,
    email: user.email ?? null,
    display_name: user.displayName ?? null,
    role: user.role ?? "employee",
    status: user.status ?? "active"
  };
}

export function createCurrentUserMiddleware(options: {
  users: UserRepositoryLike;
  memberships: {
    listActiveForUser(userId: string): Promise<OrganizationMembershipRecord[]>;
    getActiveForUserAndOrganization(userId: string, organizationId: string): Promise<OrganizationMembershipRecord | undefined>;
  };
  cookies: SessionCookieManager;
}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = options.cookies.read(req.headers.cookie);
      if (!session) {
        req.currentUser = undefined;
        req.currentOrganization = undefined;
        req.currentMembership = undefined;
        next();
        return;
      }

      const user = await options.users.getById(session.userId);
      if (!user || user.status !== "active") {
        req.currentUser = undefined;
        req.currentOrganization = undefined;
        req.currentMembership = undefined;
        next();
        return;
      }

      const activeMemberships = await options.memberships.listActiveForUser(user.id);
      let activeMembership =
        session.activeOrganizationId
          ? await options.memberships.getActiveForUserAndOrganization(user.id, session.activeOrganizationId)
          : undefined;
      if (!activeMembership) {
        activeMembership = activeMemberships[0];
      }

      req.currentUser = user;
      req.currentMembership = activeMembership;
      req.currentOrganization = activeMembership?.organization;

      if (activeMembership && activeMembership.organizationId !== session.activeOrganizationId) {
        res.append("Set-Cookie", options.cookies.create(user.id, activeMembership.organizationId));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCurrentUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  next();
}

export function requireCurrentOrganization(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  if (!req.currentOrganization || !req.currentMembership || req.currentMembership.status !== "active") {
    res.status(403).json({ detail: "Organization context is required" });
    return;
  }
  next();
}

export function requireRole(role: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    if (req.currentUser.role !== role && req.currentUser.role !== "super_admin") {
      res.status(403).json({ detail: "Forbidden" });
      return;
    }
    next();
  };
}
