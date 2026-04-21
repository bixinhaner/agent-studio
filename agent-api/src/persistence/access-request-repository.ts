export type AccessRequestRecord = {
  id: string;
  requestType: string;
  commercialIntent: string;
  status: string;
  applicantEmail: string;
  applicantEmailDomain: string;
  contactName?: string;
  companyName: string;
  countryRegion?: string;
  deviceInfoText: string;
  purchaseDate?: string;
  poNumber: string;
  snNumber?: string;
  salesContactEmail: string;
  customerNote?: string;
  adminNote?: string;
  reviewSummary?: string;
  rejectionReason?: string;
  reviewMode: string;
  minimumApprovals?: number;
  rejectionMode: string;
  ownerUserId?: string;
  requestedPlanId?: string;
  approvedPlanId?: string;
  targetOrganizationId?: string;
  targetUserId?: string;
  organizationInviteId?: string;
  publicToken: string;
  lastSubmittedAt?: string;
  reviewRequestedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  provisionedAt?: string;
  invitedAt?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAccessRequestInput = {
  requestType?: string;
  commercialIntent?: string;
  status?: string;
  applicantEmail: string;
  applicantEmailDomain: string;
  contactName?: string | null;
  companyName: string;
  countryRegion?: string | null;
  deviceInfoText: string;
  purchaseDate?: string | Date | null;
  poNumber: string;
  snNumber?: string | null;
  salesContactEmail: string;
  customerNote?: string | null;
  adminNote?: string | null;
  reviewSummary?: string | null;
  rejectionReason?: string | null;
  reviewMode?: string;
  minimumApprovals?: number | null;
  rejectionMode?: string;
  ownerUserId?: string | null;
  requestedPlanId?: string | null;
  approvedPlanId?: string | null;
  targetOrganizationId?: string | null;
  targetUserId?: string | null;
  organizationInviteId?: string | null;
  publicToken: string;
  lastSubmittedAt?: string | Date | null;
  reviewRequestedAt?: string | Date | null;
  approvedAt?: string | Date | null;
  rejectedAt?: string | Date | null;
  provisionedAt?: string | Date | null;
  invitedAt?: string | Date | null;
  activatedAt?: string | Date | null;
};

export type UpdateAccessRequestInput = Omit<Partial<CreateAccessRequestInput>, "applicantEmail" | "applicantEmailDomain" | "companyName" | "deviceInfoText" | "poNumber" | "snNumber" | "salesContactEmail" | "publicToken"> & {
  applicantEmail?: string;
  applicantEmailDomain?: string;
  companyName?: string;
  deviceInfoText?: string;
  poNumber?: string;
  snNumber?: string;
  salesContactEmail?: string;
  publicToken?: string;
};

type AccessRequestRow = {
  id: string;
  requestType: string | null;
  commercialIntent: string | null;
  status: string | null;
  applicantEmail: string;
  applicantEmailDomain: string;
  contactName: string | null;
  companyName: string;
  countryRegion: string | null;
  deviceInfoText: string;
  purchaseDate: Date | string | null;
  poNumber: string;
  snNumber: string | null;
  salesContactEmail: string;
  customerNote: string | null;
  adminNote: string | null;
  reviewSummary: string | null;
  rejectionReason: string | null;
  reviewMode: string | null;
  minimumApprovals: number | null;
  rejectionMode: string | null;
  ownerUserId: string | null;
  requestedPlanId: string | null;
  approvedPlanId: string | null;
  targetOrganizationId: string | null;
  targetUserId: string | null;
  organizationInviteId: string | null;
  publicToken: string;
  lastSubmittedAt: Date | string | null;
  reviewRequestedAt: Date | string | null;
  approvedAt: Date | string | null;
  rejectedAt: Date | string | null;
  provisionedAt: Date | string | null;
  invitedAt: Date | string | null;
  activatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AccessRequestTable = {
  findUnique(args: { where: { id?: string; publicToken?: string; organizationInviteId?: string } }): Promise<AccessRequestRow | null>;
  findMany(args?: {
    where?: { status?: string; ownerUserId?: string | null };
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
  }): Promise<AccessRequestRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AccessRequestRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AccessRequestRow>;
};

export type AccessRequestRepositoryDb = {
  accessRequest: AccessRequestTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function mapRequest(row: AccessRequestRow): AccessRequestRecord {
  return {
    id: row.id,
    requestType: trimOrUndefined(row.requestType) ?? "trial",
    commercialIntent: trimOrUndefined(row.commercialIntent) ?? "trial",
    status: trimOrUndefined(row.status) ?? "submitted",
    applicantEmail: row.applicantEmail,
    applicantEmailDomain: row.applicantEmailDomain,
    contactName: trimOrUndefined(row.contactName),
    companyName: row.companyName,
    countryRegion: trimOrUndefined(row.countryRegion),
    deviceInfoText: row.deviceInfoText,
    purchaseDate: toIsoString(row.purchaseDate),
    poNumber: row.poNumber,
    snNumber: trimOrUndefined(row.snNumber),
    salesContactEmail: row.salesContactEmail,
    customerNote: trimOrUndefined(row.customerNote),
    adminNote: trimOrUndefined(row.adminNote),
    reviewSummary: trimOrUndefined(row.reviewSummary),
    rejectionReason: trimOrUndefined(row.rejectionReason),
    reviewMode: trimOrUndefined(row.reviewMode) ?? "any_to_approve",
    minimumApprovals: row.minimumApprovals ?? undefined,
    rejectionMode: trimOrUndefined(row.rejectionMode) ?? "any_to_reject",
    ownerUserId: trimOrUndefined(row.ownerUserId),
    requestedPlanId: trimOrUndefined(row.requestedPlanId),
    approvedPlanId: trimOrUndefined(row.approvedPlanId),
    targetOrganizationId: trimOrUndefined(row.targetOrganizationId),
    targetUserId: trimOrUndefined(row.targetUserId),
    organizationInviteId: trimOrUndefined(row.organizationInviteId),
    publicToken: row.publicToken,
    lastSubmittedAt: toIsoString(row.lastSubmittedAt),
    reviewRequestedAt: toIsoString(row.reviewRequestedAt),
    approvedAt: toIsoString(row.approvedAt),
    rejectedAt: toIsoString(row.rejectedAt),
    provisionedAt: toIsoString(row.provisionedAt),
    invitedAt: toIsoString(row.invitedAt),
    activatedAt: toIsoString(row.activatedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function buildUpdateData(input: UpdateAccessRequestInput): Record<string, unknown> {
  return {
    requestType: input.requestType === undefined ? undefined : trimOrUndefined(input.requestType) ?? "trial",
    commercialIntent:
      input.commercialIntent === undefined ? undefined : trimOrUndefined(input.commercialIntent) ?? "trial",
    status: input.status === undefined ? undefined : trimOrUndefined(input.status) ?? "submitted",
    applicantEmail: input.applicantEmail === undefined ? undefined : input.applicantEmail.trim().toLowerCase(),
    applicantEmailDomain:
      input.applicantEmailDomain === undefined ? undefined : input.applicantEmailDomain.trim().toLowerCase(),
    contactName: input.contactName === undefined ? undefined : trimOrUndefined(input.contactName ?? undefined) ?? null,
    companyName: input.companyName === undefined ? undefined : input.companyName.trim(),
    countryRegion:
      input.countryRegion === undefined ? undefined : trimOrUndefined(input.countryRegion ?? undefined) ?? null,
    deviceInfoText: input.deviceInfoText === undefined ? undefined : input.deviceInfoText.trim(),
    purchaseDate: input.purchaseDate === undefined ? undefined : toDate(input.purchaseDate) ?? null,
    poNumber: input.poNumber === undefined ? undefined : input.poNumber.trim(),
    snNumber: input.snNumber === undefined ? undefined : trimOrUndefined(input.snNumber ?? undefined) ?? null,
    salesContactEmail: input.salesContactEmail === undefined ? undefined : input.salesContactEmail.trim().toLowerCase(),
    customerNote:
      input.customerNote === undefined ? undefined : trimOrUndefined(input.customerNote ?? undefined) ?? null,
    adminNote: input.adminNote === undefined ? undefined : trimOrUndefined(input.adminNote ?? undefined) ?? null,
    reviewSummary:
      input.reviewSummary === undefined ? undefined : trimOrUndefined(input.reviewSummary ?? undefined) ?? null,
    rejectionReason:
      input.rejectionReason === undefined ? undefined : trimOrUndefined(input.rejectionReason ?? undefined) ?? null,
    reviewMode: input.reviewMode === undefined ? undefined : trimOrUndefined(input.reviewMode) ?? "any_to_approve",
    minimumApprovals:
      input.minimumApprovals === undefined ? undefined : input.minimumApprovals === null ? null : input.minimumApprovals,
    rejectionMode:
      input.rejectionMode === undefined ? undefined : trimOrUndefined(input.rejectionMode) ?? "any_to_reject",
    ownerUserId: input.ownerUserId === undefined ? undefined : trimOrUndefined(input.ownerUserId ?? undefined) ?? null,
    requestedPlanId:
      input.requestedPlanId === undefined ? undefined : trimOrUndefined(input.requestedPlanId ?? undefined) ?? null,
    approvedPlanId:
      input.approvedPlanId === undefined ? undefined : trimOrUndefined(input.approvedPlanId ?? undefined) ?? null,
    targetOrganizationId:
      input.targetOrganizationId === undefined ? undefined : trimOrUndefined(input.targetOrganizationId ?? undefined) ?? null,
    targetUserId: input.targetUserId === undefined ? undefined : trimOrUndefined(input.targetUserId ?? undefined) ?? null,
    organizationInviteId:
      input.organizationInviteId === undefined ? undefined : trimOrUndefined(input.organizationInviteId ?? undefined) ?? null,
    publicToken:
      input.publicToken === undefined ? undefined : trimOrUndefined(input.publicToken) ?? undefined,
    lastSubmittedAt: input.lastSubmittedAt === undefined ? undefined : toDate(input.lastSubmittedAt) ?? null,
    reviewRequestedAt: input.reviewRequestedAt === undefined ? undefined : toDate(input.reviewRequestedAt) ?? null,
    approvedAt: input.approvedAt === undefined ? undefined : toDate(input.approvedAt) ?? null,
    rejectedAt: input.rejectedAt === undefined ? undefined : toDate(input.rejectedAt) ?? null,
    provisionedAt: input.provisionedAt === undefined ? undefined : toDate(input.provisionedAt) ?? null,
    invitedAt: input.invitedAt === undefined ? undefined : toDate(input.invitedAt) ?? null,
    activatedAt: input.activatedAt === undefined ? undefined : toDate(input.activatedAt) ?? null,
    updatedAt: new Date()
  };
}

export class AccessRequestRepository {
  constructor(private readonly db: AccessRequestRepositoryDb) {}

  async create(input: CreateAccessRequestInput): Promise<AccessRequestRecord> {
    const row = await this.db.accessRequest.create({
      data: {
        requestType: trimOrUndefined(input.requestType) ?? "trial",
        commercialIntent: trimOrUndefined(input.commercialIntent) ?? "trial",
        status: trimOrUndefined(input.status) ?? "submitted",
        applicantEmail: input.applicantEmail.trim().toLowerCase(),
        applicantEmailDomain: input.applicantEmailDomain.trim().toLowerCase(),
        contactName: trimOrUndefined(input.contactName ?? undefined) ?? null,
        companyName: input.companyName.trim(),
        countryRegion: trimOrUndefined(input.countryRegion ?? undefined) ?? null,
        deviceInfoText: input.deviceInfoText.trim(),
        purchaseDate: toDate(input.purchaseDate) ?? null,
        poNumber: input.poNumber.trim(),
        snNumber: trimOrUndefined(input.snNumber ?? undefined) ?? null,
        salesContactEmail: input.salesContactEmail.trim().toLowerCase(),
        customerNote: trimOrUndefined(input.customerNote ?? undefined) ?? null,
        adminNote: trimOrUndefined(input.adminNote ?? undefined) ?? null,
        reviewSummary: trimOrUndefined(input.reviewSummary ?? undefined) ?? null,
        rejectionReason: trimOrUndefined(input.rejectionReason ?? undefined) ?? null,
        reviewMode: trimOrUndefined(input.reviewMode) ?? "any_to_approve",
        minimumApprovals: input.minimumApprovals ?? null,
        rejectionMode: trimOrUndefined(input.rejectionMode) ?? "any_to_reject",
        ownerUserId: trimOrUndefined(input.ownerUserId ?? undefined) ?? null,
        requestedPlanId: trimOrUndefined(input.requestedPlanId ?? undefined) ?? null,
        approvedPlanId: trimOrUndefined(input.approvedPlanId ?? undefined) ?? null,
        targetOrganizationId: trimOrUndefined(input.targetOrganizationId ?? undefined) ?? null,
        targetUserId: trimOrUndefined(input.targetUserId ?? undefined) ?? null,
        organizationInviteId: trimOrUndefined(input.organizationInviteId ?? undefined) ?? null,
        publicToken: input.publicToken.trim(),
        lastSubmittedAt: toDate(input.lastSubmittedAt) ?? null,
        reviewRequestedAt: toDate(input.reviewRequestedAt) ?? null,
        approvedAt: toDate(input.approvedAt) ?? null,
        rejectedAt: toDate(input.rejectedAt) ?? null,
        provisionedAt: toDate(input.provisionedAt) ?? null,
        invitedAt: toDate(input.invitedAt) ?? null,
        activatedAt: toDate(input.activatedAt) ?? null
      }
    });
    return mapRequest(row);
  }

  async getById(id: string): Promise<AccessRequestRecord | null> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return null;
    const row = await this.db.accessRequest.findUnique({ where: { id: normalized } });
    return row ? mapRequest(row) : null;
  }

  async getByPublicToken(publicToken: string): Promise<AccessRequestRecord | null> {
    const normalized = trimOrUndefined(publicToken);
    if (!normalized) return null;
    const row = await this.db.accessRequest.findUnique({ where: { publicToken: normalized } });
    return row ? mapRequest(row) : null;
  }

  async getByOrganizationInviteId(organizationInviteId: string): Promise<AccessRequestRecord | null> {
    const normalized = trimOrUndefined(organizationInviteId);
    if (!normalized) return null;
    const row = await this.db.accessRequest.findUnique({ where: { organizationInviteId: normalized } });
    return row ? mapRequest(row) : null;
  }

  async list(input?: { status?: string; ownerUserId?: string | null }): Promise<AccessRequestRecord[]> {
    const rows = await this.db.accessRequest.findMany({
      where: {
        status: trimOrUndefined(input?.status),
        ownerUserId: input?.ownerUserId === undefined ? undefined : trimOrUndefined(input.ownerUserId ?? undefined) ?? null
      },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(mapRequest);
  }

  async update(id: string, input: UpdateAccessRequestInput): Promise<AccessRequestRecord> {
    const normalized = trimOrUndefined(id);
    if (!normalized) {
      throw new Error("access request id is required");
    }
    const row = await this.db.accessRequest.update({
      where: { id: normalized },
      data: buildUpdateData(input)
    });
    return mapRequest(row);
  }
}
