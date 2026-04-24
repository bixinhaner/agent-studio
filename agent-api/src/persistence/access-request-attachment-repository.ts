export type AccessRequestAttachmentRecord = {
  id: string;
  accessRequestId: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};

export type CreateAccessRequestAttachmentInput = {
  accessRequestId: string;
  kind?: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

type AccessRequestAttachmentRow = {
  id: string;
  accessRequestId: string;
  kind: string | null;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string;
  createdAt: Date | string;
};

type AccessRequestAttachmentTable = {
  findUnique(args: { where: { id: string } }): Promise<AccessRequestAttachmentRow | null>;
  findMany(args?: {
    where?: { accessRequestId?: string; kind?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AccessRequestAttachmentRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AccessRequestAttachmentRow>;
};

export type AccessRequestAttachmentRepositoryDb = {
  accessRequestAttachment: AccessRequestAttachmentTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function mapAttachment(row: AccessRequestAttachmentRow): AccessRequestAttachmentRecord {
  return {
    id: row.id,
    accessRequestId: row.accessRequestId,
    kind: trimOrUndefined(row.kind) ?? "purchase_proof",
    originalName: row.originalName,
    mimeType: trimOrUndefined(row.mimeType) ?? "application/octet-stream",
    sizeBytes: row.sizeBytes ?? 0,
    storagePath: row.storagePath,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString()
  };
}

export class AccessRequestAttachmentRepository {
  constructor(private readonly db: AccessRequestAttachmentRepositoryDb) {}

  async createMany(input: CreateAccessRequestAttachmentInput[]): Promise<AccessRequestAttachmentRecord[]> {
    const created: AccessRequestAttachmentRecord[] = [];
    for (const item of input) {
      const row = await this.db.accessRequestAttachment.create({
        data: {
          accessRequestId: item.accessRequestId,
          kind: trimOrUndefined(item.kind) ?? "purchase_proof",
          originalName: item.originalName.trim(),
          mimeType: trimOrUndefined(item.mimeType) ?? "application/octet-stream",
          sizeBytes: item.sizeBytes,
          storagePath: item.storagePath
        }
      });
      created.push(mapAttachment(row));
    }
    return created;
  }

  async listForRequest(accessRequestId: string, kind = "purchase_proof"): Promise<AccessRequestAttachmentRecord[]> {
    const normalizedRequestId = trimOrUndefined(accessRequestId);
    if (!normalizedRequestId) return [];
    const rows = await this.db.accessRequestAttachment.findMany({
      where: { accessRequestId: normalizedRequestId, kind },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapAttachment);
  }

  async getById(id: string): Promise<AccessRequestAttachmentRecord | null> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return null;
    const row = await this.db.accessRequestAttachment.findUnique({ where: { id: normalized } });
    return row ? mapAttachment(row) : null;
  }
}
