import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ACTION_CONNECTOR_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ACTION_CONNECTOR_MAX_ATTACHMENTS_PER_TURN = 10;

export type ActionConnectorAttachmentRef = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
};

type StoredAttachment = ActionConnectorAttachmentRef & {
  connectorId: string;
  externalUserIdHash: string;
  conversationIdHash: string;
  storedName: string;
};

export type MaterializedActionConnectorAttachment = ActionConnectorAttachmentRef & {
  absolutePath: string;
  relativePath: string;
};

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 96) || fallback;
}

function identityHash(value: string): string {
  return createHash("sha256").update(requireText(value, "externalUserId")).digest("hex").slice(0, 24);
}

function conversationHash(value: string): string {
  return createHash("sha256").update(requireText(value, "conversationId")).digest("hex").slice(0, 24);
}

function sanitizeFilename(value: string): string {
  const normalized = path.basename(value.trim()).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.slice(0, 180) || "attachment";
}

function normalizeMimeType(value: string | undefined): string {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream";
}

export class ActionConnectorAttachmentStore {
  constructor(private readonly rootPath: string) {}

  private conversationDir(input: { connectorId: string; externalUserId: string; conversationId: string }): string {
    return path.join(
      this.rootPath,
      safeSegment(requireText(input.connectorId, "connectorId"), "connector"),
      identityHash(input.externalUserId),
      conversationHash(input.conversationId)
    );
  }

  async upload(input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
    filename: string;
    mimeType?: string;
    content: Buffer;
  }): Promise<ActionConnectorAttachmentRef> {
    if (!input.content.length) throw new Error("Attachment is empty");
    if (input.content.length > ACTION_CONNECTOR_MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment exceeds ${ACTION_CONNECTOR_MAX_ATTACHMENT_BYTES} bytes`);
    }
    const attachmentId = randomUUID().replace(/-/g, "");
    const filename = sanitizeFilename(input.filename);
    const storedName = `${attachmentId}-${filename}`;
    const directory = this.conversationDir(input);
    const record: StoredAttachment = {
      attachmentId,
      connectorId: requireText(input.connectorId, "connectorId"),
      externalUserIdHash: identityHash(input.externalUserId),
      conversationIdHash: conversationHash(input.conversationId),
      filename,
      mimeType: normalizeMimeType(input.mimeType),
      sizeBytes: input.content.length,
      sha256: createHash("sha256").update(input.content).digest("hex"),
      createdAt: new Date().toISOString(),
      storedName
    };
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, storedName), input.content, { mode: 0o600 });
    await fs.writeFile(path.join(directory, `${attachmentId}.json`), JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    return this.publicRef(record);
  }

  async remove(input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
    attachmentId: string;
  }): Promise<boolean> {
    const loaded = await this.load(input).catch(() => undefined);
    if (!loaded) return false;
    const directory = this.conversationDir(input);
    await Promise.all([
      fs.rm(path.join(directory, loaded.storedName), { force: true }),
      fs.rm(path.join(directory, `${loaded.attachmentId}.json`), { force: true })
    ]);
    return true;
  }

  async materialize(input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
    attachmentIds: string[];
    workspacePath: string;
  }): Promise<MaterializedActionConnectorAttachment[]> {
    const uniqueIds = [...new Set(input.attachmentIds.map((item) => item.trim()).filter(Boolean))];
    if (uniqueIds.length > ACTION_CONNECTOR_MAX_ATTACHMENTS_PER_TURN) {
      throw new Error(`A turn supports at most ${ACTION_CONNECTOR_MAX_ATTACHMENTS_PER_TURN} attachments`);
    }
    if (!uniqueIds.length) return [];
    const uploadDir = path.join(input.workspacePath, ".uploads", conversationHash(input.conversationId));
    await fs.mkdir(uploadDir, { recursive: true });
    const output: MaterializedActionConnectorAttachment[] = [];
    for (const attachmentId of uniqueIds) {
      const record = await this.load({ ...input, attachmentId });
      const sourceDir = this.conversationDir(input);
      const sourcePath = path.join(sourceDir, record.storedName);
      const targetName = `${record.attachmentId}-${record.filename}`;
      const targetPath = path.join(uploadDir, targetName);
      const content = await fs.readFile(sourcePath);
      if (content.length !== record.sizeBytes || createHash("sha256").update(content).digest("hex") !== record.sha256) {
        throw new Error(`Attachment ${record.attachmentId} failed integrity validation`);
      }
      await fs.writeFile(targetPath, content, { mode: 0o600 });
      output.push({
        ...this.publicRef(record),
        absolutePath: targetPath,
        relativePath: path.relative(input.workspacePath, targetPath).split(path.sep).join("/")
      });
    }
    return output;
  }

  private async load(input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
    attachmentId: string;
  }): Promise<StoredAttachment> {
    const attachmentId = requireText(input.attachmentId, "attachmentId");
    if (!/^[a-f0-9]{32}$/i.test(attachmentId)) throw new Error("Attachment id is invalid");
    const directory = this.conversationDir(input);
    const record = JSON.parse(await fs.readFile(path.join(directory, `${attachmentId}.json`), "utf8")) as StoredAttachment;
    if (
      record.attachmentId !== attachmentId ||
      record.connectorId !== input.connectorId.trim() ||
      record.externalUserIdHash !== identityHash(input.externalUserId) ||
      record.conversationIdHash !== conversationHash(input.conversationId)
    ) {
      throw new Error("Attachment does not belong to this conversation");
    }
    return record;
  }

  private publicRef(record: StoredAttachment): ActionConnectorAttachmentRef {
    return {
      attachmentId: record.attachmentId,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      createdAt: record.createdAt
    };
  }
}
