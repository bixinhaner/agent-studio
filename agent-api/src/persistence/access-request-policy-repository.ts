export type AccessRequestPolicyRecord = {
  id: string;
  policyKey: string;
  internalEmailDomains: string[];
  blockedApplicantEmailDomains: string[];
  defaultTrialDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AccessRequestPolicyFallback = {
  internalEmailDomains: string[];
  blockedApplicantEmailDomains: string[];
  defaultTrialDays: number;
};

type AccessRequestPolicyRow = {
  id: string;
  policyKey: string | null;
  internalEmailDomains: string[] | null;
  publicEmailBlocklistExtra: string[] | null;
  defaultTrialDays: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AccessRequestPolicyTable = {
  findFirst(args?: { where?: { policyKey?: string } }): Promise<AccessRequestPolicyRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<AccessRequestPolicyRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AccessRequestPolicyRow>;
};

export type AccessRequestPolicyRepositoryDb = {
  accessRequestPolicy: AccessRequestPolicyTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeList(values: string[] | null | undefined, fallback: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? fallback) {
    const normalized = trimOrUndefined(value)?.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeTrialDays(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : fallback;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function mapPolicy(row: AccessRequestPolicyRow, fallback: AccessRequestPolicyFallback): AccessRequestPolicyRecord {
  return {
    id: row.id,
    policyKey: trimOrUndefined(row.policyKey) ?? "global",
    internalEmailDomains: normalizeList(row.internalEmailDomains, fallback.internalEmailDomains),
    blockedApplicantEmailDomains: normalizeList(row.publicEmailBlocklistExtra, fallback.blockedApplicantEmailDomains),
    defaultTrialDays: normalizeTrialDays(row.defaultTrialDays, fallback.defaultTrialDays),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class AccessRequestPolicyRepository {
  constructor(private readonly db: AccessRequestPolicyRepositoryDb) {}

  async getOrCreate(fallback: AccessRequestPolicyFallback): Promise<AccessRequestPolicyRecord> {
    const existing = await this.db.accessRequestPolicy.findFirst({ where: { policyKey: "global" } });
    if (existing) {
      return mapPolicy(existing, fallback);
    }
    const created = await this.db.accessRequestPolicy.create({
      data: {
        policyKey: "global",
        internalEmailDomains: normalizeList(fallback.internalEmailDomains),
        publicEmailBlocklistExtra: normalizeList(fallback.blockedApplicantEmailDomains),
        defaultTrialDays: normalizeTrialDays(fallback.defaultTrialDays, 14)
      }
    });
    return mapPolicy(created, fallback);
  }

  async update(
    input: {
      internalEmailDomains?: string[];
      blockedApplicantEmailDomains?: string[];
      defaultTrialDays?: number;
    },
    fallback: AccessRequestPolicyFallback
  ): Promise<AccessRequestPolicyRecord> {
    const current = await this.getOrCreate(fallback);
    const updated = await this.db.accessRequestPolicy.update({
      where: { id: current.id },
      data: {
        internalEmailDomains:
          input.internalEmailDomains === undefined
            ? current.internalEmailDomains
            : normalizeList(input.internalEmailDomains, fallback.internalEmailDomains),
        publicEmailBlocklistExtra:
          input.blockedApplicantEmailDomains === undefined
            ? current.blockedApplicantEmailDomains
            : normalizeList(input.blockedApplicantEmailDomains, fallback.blockedApplicantEmailDomains),
        defaultTrialDays:
          input.defaultTrialDays === undefined
            ? current.defaultTrialDays
            : normalizeTrialDays(input.defaultTrialDays, fallback.defaultTrialDays),
        updatedAt: new Date()
      }
    });
    return mapPolicy(updated, fallback);
  }
}
