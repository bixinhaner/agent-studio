import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";
import type { SessionCookieManager } from "./session-cookie.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: AuthenticatedUser;
    }
  }
}

export function userOut(user: AuthenticatedUser) {
  return {
    id: user.id,
    external_id: user.externalId ?? null,
    email: user.email ?? null,
    display_name: user.displayName ?? null,
    role: user.role ?? "employee",
    status: user.status ?? "active"
  };
}

export function createCurrentUserMiddleware(options: {
  users: UserRepositoryLike;
  cookies: SessionCookieManager;
}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = options.cookies.read(req.headers.cookie);
      if (!session) {
        req.currentUser = undefined;
        next();
        return;
      }

      const user = await options.users.getById(session.userId);
      req.currentUser = user && user.status === "active" ? user : undefined;
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
