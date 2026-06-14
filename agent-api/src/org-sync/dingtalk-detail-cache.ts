import type { DingTalkDepartmentPosition } from "../auth/dingtalk.js";
import type { DingTalkUserDetailCacheEntry } from "./dingtalk-org-provider.js";

type EnterpriseProfileRow = {
  employeeNo?: string | null;
  title?: string | null;
  mobile?: string | null;
  telephone?: string | null;
  avatarUrl?: string | null;
  workPlace?: string | null;
  hiredAt?: Date | string | null;
  managerDingTalkUserId?: string | null;
  isAdmin?: boolean | null;
  isBoss?: boolean | null;
  isLeader?: boolean | null;
  extensionJson?: unknown;
  departmentPositionsJson?: unknown;
  detailAttemptedAt?: Date | string | null;
  detailSyncedAt?: Date | string | null;
};

type UserProfileRow = {
  dingtalkUserId?: string | null;
  enterpriseProfile?: EnterpriseProfileRow | null;
};

export type DingTalkDetailCacheDb = {
  user: {
    findMany(args: {
      where: { dingtalkUserId: { in: string[] } };
      select: {
        dingtalkUserId: true;
        enterpriseProfile: {
          select: {
            employeeNo: true;
            title: true;
            mobile: true;
            telephone: true;
            avatarUrl: true;
            workPlace: true;
            hiredAt: true;
            managerDingTalkUserId: true;
            isAdmin: true;
            isBoss: true;
            isLeader: true;
            extensionJson: true;
            departmentPositionsJson: true;
            detailAttemptedAt: true;
            detailSyncedAt: true;
          };
        };
      };
    }): Promise<UserProfileRow[]>;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asDepartmentPositions(value: unknown): DingTalkDepartmentPosition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const positions = value.flatMap((item) => {
    const record = asRecord(item);
    const departmentExternalId = typeof record?.departmentExternalId === "string" ? record.departmentExternalId.trim() : "";
    if (!departmentExternalId) return [];
    const position = typeof record?.position === "string" && record.position.trim() ? record.position.trim() : undefined;
    const sortOrder = typeof record?.sortOrder === "number" && Number.isFinite(record.sortOrder) ? record.sortOrder : undefined;
    const isLeader = typeof record?.isLeader === "boolean" ? record.isLeader : undefined;
    const isPrimary = typeof record?.isPrimary === "boolean" ? record.isPrimary : undefined;
    return [{
      departmentExternalId,
      ...(position ? { position } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(isLeader !== undefined ? { isLeader } : {}),
      ...(isPrimary !== undefined ? { isPrimary } : {})
    }];
  });
  return positions.length > 0 ? positions : undefined;
}

function isoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createDingTalkDetailCacheLoader(db: DingTalkDetailCacheDb) {
  return async function loadDingTalkDetailCache(userIds: string[]): Promise<Map<string, DingTalkUserDetailCacheEntry>> {
    const uniqueUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const rows = await db.user.findMany({
      where: { dingtalkUserId: { in: uniqueUserIds } },
      select: {
        dingtalkUserId: true,
        enterpriseProfile: {
          select: {
            employeeNo: true,
            title: true,
            mobile: true,
            telephone: true,
            avatarUrl: true,
            workPlace: true,
            hiredAt: true,
            managerDingTalkUserId: true,
            isAdmin: true,
            isBoss: true,
            isLeader: true,
            extensionJson: true,
            departmentPositionsJson: true,
            detailAttemptedAt: true,
            detailSyncedAt: true
          }
        }
      }
    });

    const cache = new Map<string, DingTalkUserDetailCacheEntry>();
    for (const row of rows) {
      const dingtalkUserId = typeof row.dingtalkUserId === "string" ? row.dingtalkUserId.trim() : "";
      const profile = row.enterpriseProfile;
      if (!dingtalkUserId || !profile) continue;

      cache.set(dingtalkUserId, {
        detailAttemptedAt: profile.detailAttemptedAt ?? null,
        detailSyncedAt: profile.detailSyncedAt ?? null,
        detail: {
          ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          ...(profile.mobile ? { mobile: profile.mobile } : {}),
          ...(profile.telephone ? { telephone: profile.telephone } : {}),
          ...(profile.employeeNo ? { jobNumber: profile.employeeNo } : {}),
          ...(profile.title ? { title: profile.title } : {}),
          ...(profile.workPlace ? { workPlace: profile.workPlace } : {}),
          ...(profile.hiredAt ? { hiredAt: isoString(profile.hiredAt) } : {}),
          ...(profile.managerDingTalkUserId ? { managerDingTalkUserId: profile.managerDingTalkUserId } : {}),
          ...(profile.isAdmin !== null && profile.isAdmin !== undefined ? { isAdmin: profile.isAdmin } : {}),
          ...(profile.isBoss !== null && profile.isBoss !== undefined ? { isBoss: profile.isBoss } : {}),
          ...(profile.isLeader !== null && profile.isLeader !== undefined ? { isLeader: profile.isLeader } : {}),
          ...(asRecord(profile.extensionJson) ? { extension: asRecord(profile.extensionJson) } : {}),
          ...(asDepartmentPositions(profile.departmentPositionsJson) ? { departmentPositions: asDepartmentPositions(profile.departmentPositionsJson) } : {})
        }
      });
    }
    return cache;
  };
}
