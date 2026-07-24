import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { CreateAdminAuditLogInput } from "./persistence/admin-audit-log-repository.js";

export const EXTERNAL_WEB_MAINTENANCE_KEY = "external_web_maintenance";
export const EXTERNAL_WEB_MAINTENANCE_MESSAGE = "系统维护中，请稍后再试。";

type RuntimeControlRow = {
  key: string;
  enabled: boolean;
  updatedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuntimeControlTable = {
  findUnique(args: { where: { key: string } }): Promise<RuntimeControlRow | null>;
  upsert(args: {
    where: { key: string };
    create: {
      key: string;
      enabled: boolean;
      updatedByUserId: string;
    };
    update: {
      enabled: boolean;
      updatedByUserId: string;
    };
  }): Promise<RuntimeControlRow>;
};

export type RuntimeControlDb = {
  runtimeControl: RuntimeControlTable;
};

type AuditWriter = {
  create(input: CreateAdminAuditLogInput): Promise<unknown>;
};

export type ExternalWebAccessState = {
  maintenanceEnabled: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stateFromRow(row: RuntimeControlRow | null): ExternalWebAccessState {
  return {
    maintenanceEnabled: row?.enabled ?? false,
    updatedAt: row ? toIsoString(row.updatedAt) : null,
    updatedByUserId: row?.updatedByUserId ?? null
  };
}

export class ExternalWebAccessService {
  constructor(
    private readonly db: RuntimeControlDb,
    private readonly audits?: AuditWriter
  ) {}

  async getState(): Promise<ExternalWebAccessState> {
    return stateFromRow(
      await this.db.runtimeControl.findUnique({
        where: { key: EXTERNAL_WEB_MAINTENANCE_KEY }
      })
    );
  }

  async isMaintenanceEnabled(): Promise<boolean> {
    return (await this.getState()).maintenanceEnabled;
  }

  async setMaintenanceEnabled(input: {
    maintenanceEnabled: boolean;
    actorUserId: string;
    organizationId?: string;
  }): Promise<ExternalWebAccessState> {
    const before = await this.getState();
    const row = await this.db.runtimeControl.upsert({
      where: { key: EXTERNAL_WEB_MAINTENANCE_KEY },
      create: {
        key: EXTERNAL_WEB_MAINTENANCE_KEY,
        enabled: input.maintenanceEnabled,
        updatedByUserId: input.actorUserId
      },
      update: {
        enabled: input.maintenanceEnabled,
        updatedByUserId: input.actorUserId
      }
    });
    const after = stateFromRow(row);
    if (this.audits && before.maintenanceEnabled !== after.maintenanceEnabled) {
      await this.audits.create({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actionType: "runtime_control.external_web_maintenance",
        targetType: "runtime_control",
        targetId: EXTERNAL_WEB_MAINTENANCE_KEY,
        beforePayload: before,
        afterPayload: after
      });
    }
    return after;
  }
}

export function sendExternalWebMaintenance(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({ detail: EXTERNAL_WEB_MAINTENANCE_MESSAGE });
}

export function createPublicExternalWebGate(
  access: Pick<ExternalWebAccessService, "isMaintenanceEnabled">
): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (await access.isMaintenanceEnabled()) {
        sendExternalWebMaintenance(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAuthenticatedExternalWebGate(
  access: Pick<ExternalWebAccessService, "isMaintenanceEnabled">
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isExternal =
      req.currentUser?.userType === "external_user" ||
      req.currentOrganization?.type === "customer";
    if (!isExternal) {
      next();
      return;
    }
    try {
      if (await access.isMaintenanceEnabled()) {
        sendExternalWebMaintenance(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createExternalWebSurfaceGate(
  access: Pick<ExternalWebAccessService, "isMaintenanceEnabled">
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isInternal =
      req.currentUser?.userType !== "external_user" &&
      req.currentOrganization?.type === "internal";
    if (isInternal) {
      next();
      return;
    }
    try {
      if (await access.isMaintenanceEnabled()) {
        sendExternalWebMaintenance(res);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
