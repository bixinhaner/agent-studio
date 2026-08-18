import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { PublicBrandService } from "./service.js";
import type { PublicBrandRecord } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      publicBrand?: PublicBrandRecord;
    }
  }
}

export function createPublicBrandContextMiddleware(
  brands: Pick<PublicBrandService, "resolveByHostname">
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.publicBrand = await brands.resolveByHostname(req.headers.host);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function organizationMatchesRequestBrand(
  req: Request,
  organization: { publicBrandId?: string | null } | null | undefined
): boolean {
  if (!organization) return false;
  return req.publicBrand
    ? organization.publicBrandId === req.publicBrand.id
    : !organization.publicBrandId;
}
