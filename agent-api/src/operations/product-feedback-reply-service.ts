import { createHash } from "node:crypto";

import type { AuthEmailSender } from "../auth/email.js";
import {
  recoveryEmailHtml
} from "./conversation-recovery-service.js";
import type {
  NotificationRecord,
  NotificationRecordRepository
} from "../persistence/notification-record-repository.js";
import type {
  ProductFeedbackRecord,
  ProductFeedbackRepository
} from "../persistence/product-feedback-repository.js";
import type { PublicBrandRecord } from "../public-brands/types.js";

export const PRODUCT_FEEDBACK_REPLY_MAX_IMAGES = 3;
export const PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

const PRODUCT_FEEDBACK_REPLY_EVENT = "product_feedback.resolution_email";

export type ProductFeedbackReplyLanguage = "zh" | "en";

export type ProductFeedbackReplyUpload = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type ProductFeedbackReplyDraft = {
  recipientEmail?: string;
  defaultLanguage: ProductFeedbackReplyLanguage;
  templates: Record<ProductFeedbackReplyLanguage, {
    language: ProductFeedbackReplyLanguage;
    subject: string;
    bodyText: string;
  }>;
  originalImages: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    emailEligible: boolean;
    ineligibleReason?: string;
  }>;
  limits: {
    maxImages: number;
    maxImageBytes: number;
    mimeTypes: string[];
  };
};

export type ProductFeedbackReplyHistoryItem = {
  id: string;
  status: "pending" | "sent" | "failed";
  recipientEmail?: string;
  subject?: string;
  bodyText?: string;
  templateLanguage: ProductFeedbackReplyLanguage;
  imageCount: number;
  imageNames: string[];
  actorUserId?: string;
  delivered?: boolean;
  deliveryMode?: "smtp" | "debug";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductFeedbackReplyState = {
  draft: ProductFeedbackReplyDraft;
  history: ProductFeedbackReplyHistoryItem[];
};

export class ProductFeedbackReplyError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code?: string
  ) {
    super(message);
    this.name = "ProductFeedbackReplyError";
  }
}

type ResolvedReplyImage = {
  name: string;
  mimeType: string;
  size: number;
  content: Buffer;
  checksum: string;
  source: "feedback" | "upload";
  sourceId?: string;
  cid: string;
};

type ReplyInput = {
  feedbackId: string;
  subject: string;
  bodyText: string;
  templateLanguage?: string | null;
  selectedImageIds?: string[];
  uploads?: ProductFeedbackReplyUpload[];
};

type FeedbackBrand = Pick<
  PublicBrandRecord,
  "platformName" | "primaryBaseUrl" | "primaryColor" | "emailFromName" | "emailFromAddress" | "emailReplyTo" | "supportEmail" | "emailSenderVerified"
>;

export class ProductFeedbackReplyService {
  constructor(
    private readonly deps: {
      feedback: Pick<ProductFeedbackRepository, "get" | "updateStatus">;
      notifications: Pick<NotificationRecordRepository, "create" | "update" | "list">;
      emailSender: AuthEmailSender;
      resolveBrandName?: () => string | Promise<string>;
      resolvePortalUrl?: () => string | Promise<string>;
      resolveOrganizationBrand?: (organizationId: string) => Promise<FeedbackBrand | undefined>;
    }
  ) {}

  async getState(feedback: ProductFeedbackRecord): Promise<ProductFeedbackReplyState> {
    const [draft, records] = await Promise.all([
      this.buildDraft(feedback),
      this.deps.notifications.list({
        targetRef: targetRefForFeedback(feedback.id),
        eventType: PRODUCT_FEEDBACK_REPLY_EVENT,
        channelType: "email",
        take: 50
      })
    ]);
    return {
      draft,
      history: records.slice().reverse().map(mapReplyHistory)
    };
  }

  async preview(input: ReplyInput): Promise<{ html: string; imageCount: number }> {
    const feedback = await this.requireFeedback(input.feedbackId);
    const normalized = await this.normalizeReplyInput(feedback, input);
    const html = await this.buildHtml(feedback, normalized);
    return {
      html: replaceCidImagesWithDataUrls(html, normalized.images),
      imageCount: normalized.images.length
    };
  }

  async sendAndResolve(input: ReplyInput & {
    clientRequestId: string;
    actorUserId?: string | null;
  }): Promise<{
    feedback: ProductFeedbackRecord;
    reply: ProductFeedbackReplyState;
    notificationId: string;
    delivered: true;
    mode: "smtp";
    duplicate: boolean;
  }> {
    const feedback = await this.requireFeedback(input.feedbackId);
    const clientRequestId = trimOrUndefined(input.clientRequestId);
    if (!clientRequestId || clientRequestId.length > 200) {
      throw new ProductFeedbackReplyError("clientRequestId 不合法", 400, "invalid_client_request_id");
    }

    const targetRef = targetRefForFeedback(feedback.id);
    const existing = await this.deps.notifications.list({
      targetRef,
      eventType: PRODUCT_FEEDBACK_REPLY_EVENT,
      channelType: "email",
      take: 50
    });
    const matching = existing.slice().reverse().find((record) => payloadString(record.payload, "clientRequestId") === clientRequestId);
    if (matching?.status === "sent") {
      const resolved = feedback.status === "resolved"
        ? feedback
        : await this.requireResolvedFeedback(feedback.id);
      return {
        feedback: resolved,
        reply: await this.getState(resolved),
        notificationId: matching.id,
        delivered: true,
        mode: "smtp",
        duplicate: true
      };
    }
    if (matching?.status === "pending") {
      throw new ProductFeedbackReplyError(
        "这封邮件正在发送，请稍后再查看结果。",
        409,
        "reply_in_progress"
      );
    }

    const normalized = await this.normalizeReplyInput(feedback, input);
    const recipientEmail = normalizeEmail(feedback.user?.email);
    if (!recipientEmail) {
      throw new ProductFeedbackReplyError("反馈人没有可用邮箱，无法发送回复。", 400, "recipient_email_missing");
    }
    const imageMetadata = normalized.images.map((image) => ({
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      checksum: image.checksum,
      source: image.source,
      sourceId: image.sourceId
    }));
    const payload = {
      category: "product_feedback",
      feedbackId: feedback.id,
      organizationId: feedback.organizationId,
      userId: feedback.userId,
      recipientEmail,
      subject: normalized.subject,
      bodyText: normalized.bodyText,
      templateLanguage: normalized.templateLanguage,
      templateVersion: "experience-resolution-v1",
      actorUserId: trimOrUndefined(input.actorUserId ?? undefined),
      clientRequestId,
      images: imageMetadata
    };
    const notification = await this.deps.notifications.create({
      organizationId: feedback.organizationId,
      channelType: "email",
      targetRef,
      eventType: PRODUCT_FEEDBACK_REPLY_EVENT,
      status: "pending",
      payload
    });

    let delivery: { delivered: boolean; mode: "smtp" | "debug" };
    try {
      delivery = await this.deps.emailSender.send({
        to: recipientEmail,
        ...await this.resolveEmailEnvelope(feedback.organizationId),
        subject: normalized.subject,
        text: normalized.bodyText,
        html: await this.buildHtml(feedback, normalized),
        attachments: normalized.images.map((image) => ({
          filename: image.name,
          content: image.content,
          contentType: image.mimeType,
          cid: image.cid
        })),
        debugLabel: "product-feedback-resolution-email"
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "邮件发送失败";
      await this.deps.notifications.update({
        id: notification.id,
        changes: { status: "failed", errorMessage: detail, payload }
      });
      throw new ProductFeedbackReplyError(
        `邮件发送失败，反馈仍保持原状态：${detail}`,
        502,
        "email_delivery_failed"
      );
    }

    if (!delivery.delivered || delivery.mode !== "smtp") {
      const detail = "邮件服务未确认送达";
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: detail,
          payload: { ...payload, delivered: delivery.delivered, deliveryMode: delivery.mode }
        }
      });
      throw new ProductFeedbackReplyError(
        `${detail}，反馈仍保持原状态。`,
        503,
        "email_not_delivered"
      );
    }

    await this.deps.notifications.update({
      id: notification.id,
      changes: {
        status: "sent",
        errorMessage: null,
        payload: { ...payload, delivered: true, deliveryMode: "smtp" }
      }
    });

    const resolved = await this.requireResolvedFeedback(feedback.id);
    return {
      feedback: resolved,
      reply: await this.getState(resolved),
      notificationId: notification.id,
      delivered: true,
      mode: "smtp",
      duplicate: false
    };
  }

  private async buildDraft(feedback: ProductFeedbackRecord): Promise<ProductFeedbackReplyDraft> {
    const brandName = await this.resolveBrandName(feedback.organizationId);
    const defaultLanguage = containsCjk(feedback.description) ? "zh" : "en";
    const summary = summarize(feedback.description, defaultLanguage === "zh" ? 36 : 70);
    return {
      recipientEmail: normalizeEmail(feedback.user?.email),
      defaultLanguage,
      templates: {
        zh: {
          language: "zh",
          subject: `关于以下反馈的处理结果：${summary}`,
          bodyText: `您好，\n\n感谢您提交反馈：${summary}\n\n我们已完成排查并处理相关问题，您现在可以继续使用 ${brandName}。\n\n如果问题仍然出现，请直接回复这封邮件，我们会继续跟进。\n\n— ${brandName} 团队`
        },
        en: {
          language: "en",
          subject: `Update on your feedback: ${summary}`,
          bodyText: `Hello,\n\nThank you for reporting the following feedback: ${summary}\n\nWe have completed our review and addressed the related issue. You can continue using ${brandName}.\n\nIf the issue appears again, reply to this email and we will follow up.\n\n— The ${brandName} team`
        }
      },
      originalImages: originalImagesFromContext(feedback.context).map((image) => ({
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        size: image.size,
        emailEligible: image.emailEligible,
        ineligibleReason: image.ineligibleReason
      })),
      limits: {
        maxImages: PRODUCT_FEEDBACK_REPLY_MAX_IMAGES,
        maxImageBytes: PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES,
        mimeTypes: [...PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES]
      }
    };
  }

  private async normalizeReplyInput(feedback: ProductFeedbackRecord, input: ReplyInput) {
    const subject = trimOrUndefined(input.subject);
    const bodyText = trimOrUndefined(input.bodyText);
    if (!subject || subject.length > 200) {
      throw new ProductFeedbackReplyError("邮件标题不能为空且不能超过 200 个字符。", 400, "invalid_subject");
    }
    if (!bodyText || bodyText.length > 10_000) {
      throw new ProductFeedbackReplyError("邮件正文不能为空且不能超过 10000 个字符。", 400, "invalid_body");
    }
    const templateLanguage: ProductFeedbackReplyLanguage = input.templateLanguage === "en" ? "en" : "zh";
    const selectedIds = uniqueStrings(input.selectedImageIds ?? []);
    const uploads = input.uploads ?? [];
    if (selectedIds.length + uploads.length > PRODUCT_FEEDBACK_REPLY_MAX_IMAGES) {
      throw new ProductFeedbackReplyError(
        `邮件最多可插入 ${PRODUCT_FEEDBACK_REPLY_MAX_IMAGES} 张图片。`,
        400,
        "too_many_images"
      );
    }

    const originals = originalImagesFromContext(feedback.context);
    const selected = selectedIds.map((id) => {
      const image = originals.find((item) => item.id === id);
      if (!image) {
        throw new ProductFeedbackReplyError(`找不到反馈原图：${id}`, 400, "original_image_not_found");
      }
      if (!image.emailEligible || !image.content) {
        throw new ProductFeedbackReplyError(
          image.ineligibleReason ?? `反馈原图 ${image.name} 不适合插入邮件。`,
          400,
          "original_image_ineligible"
        );
      }
      return {
        name: image.name,
        mimeType: image.mimeType,
        size: image.size,
        content: image.content,
        source: "feedback" as const,
        sourceId: image.id
      };
    });
    const uploaded = uploads.map((upload) => normalizeUpload(upload));
    const images: ResolvedReplyImage[] = [...selected, ...uploaded].map((image, index) => {
      const checksum = createHash("sha256").update(image.content).digest("hex");
      return {
        ...image,
        sourceId: "sourceId" in image ? image.sourceId : undefined,
        checksum,
        cid: `product-feedback-${feedback.id}-${index + 1}-${checksum.slice(0, 12)}@brand-message`
      };
    });
    return { subject, bodyText, templateLanguage, images };
  }

  private async buildHtml(
    feedback: ProductFeedbackRecord,
    input: { subject: string; bodyText: string; templateLanguage: ProductFeedbackReplyLanguage; images: ResolvedReplyImage[] }
  ): Promise<string> {
    const organizationBrand = await this.resolveOrganizationBrand(feedback.organizationId);
    const [brandName, portalUrl] = await Promise.all([
      this.resolveBrandName(feedback.organizationId),
      this.resolvePortalUrl(feedback.organizationId)
    ]);
    return recoveryEmailHtml({
      brandName,
      subject: input.subject,
      bodyText: input.bodyText,
      templateLanguage: input.templateLanguage,
      lastOccurredAt: feedback.createdAt,
      resolutionSummary: input.bodyText,
      portalUrl,
      primaryColor: organizationBrand?.primaryColor,
      issueKind: "product_feedback_reply",
      inlineImages: input.images.map((image) => ({ cid: image.cid, name: image.name }))
    });
  }

  private async requireFeedback(feedbackId: string): Promise<ProductFeedbackRecord> {
    const normalizedId = trimOrUndefined(feedbackId);
    const feedback = normalizedId ? await this.deps.feedback.get(normalizedId) : null;
    if (!feedback) {
      throw new ProductFeedbackReplyError("系统反馈不存在", 404, "feedback_not_found");
    }
    return feedback;
  }

  private async requireResolvedFeedback(feedbackId: string): Promise<ProductFeedbackRecord> {
    const updated = await this.deps.feedback.updateStatus(feedbackId, "resolved");
    if (!updated) {
      throw new ProductFeedbackReplyError(
        "邮件已发送，但反馈状态更新失败；可用同一请求重试，系统不会重复发信。",
        500,
        "status_update_failed_after_delivery"
      );
    }
    return updated;
  }

  private async resolveOrganizationBrand(organizationId?: string): Promise<FeedbackBrand | undefined> {
    return organizationId ? this.deps.resolveOrganizationBrand?.(organizationId) : undefined;
  }

  private async resolveBrandName(organizationId?: string): Promise<string> {
    const brand = await this.resolveOrganizationBrand(organizationId);
    const organizationBrandName = trimOrUndefined(brand?.platformName);
    if (organizationBrandName) return organizationBrandName;
    const resolved = trimOrUndefined(await this.deps.resolveBrandName?.());
    return resolved ?? "Workspace";
  }

  private async resolvePortalUrl(organizationId?: string): Promise<string> {
    const brand = await this.resolveOrganizationBrand(organizationId);
    const organizationPortalUrl = trimOrUndefined(brand?.primaryBaseUrl);
    if (organizationPortalUrl) return organizationPortalUrl;
    const resolved = trimOrUndefined(await this.deps.resolvePortalUrl?.());
    return resolved ?? "#";
  }

  private async resolveEmailEnvelope(organizationId?: string) {
    const brand = await this.resolveOrganizationBrand(organizationId);
    if (!brand) return {};
    if (!brand.emailSenderVerified || !trimOrUndefined(brand.emailFromAddress)) {
      throw new Error(`${brand.platformName} email delivery is not ready`);
    }
    return {
      from: `${trimOrUndefined(brand.emailFromName) ?? brand.platformName} <${brand.emailFromAddress}>`,
      replyTo: trimOrUndefined(brand.emailReplyTo) ?? trimOrUndefined(brand.supportEmail)
    };
  }
}

function targetRefForFeedback(feedbackId: string): string {
  return `product_feedback:${feedbackId}:email`;
}

function normalizeUpload(upload: ProductFeedbackReplyUpload) {
  const mimeType = trimOrUndefined(upload.mimetype)?.toLowerCase() ?? "";
  if (!PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ProductFeedbackReplyError("仅支持 PNG、JPG 或 GIF 图片。", 400, "unsupported_image_type");
  }
  if (!upload.buffer?.length || upload.size <= 0 || upload.size > PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES) {
    throw new ProductFeedbackReplyError("每张图片必须小于等于 2 MB。", 400, "image_too_large");
  }
  return {
    name: safeImageName(upload.originalname, mimeType),
    mimeType,
    size: upload.size,
    content: upload.buffer,
    source: "upload" as const
  };
}

function originalImagesFromContext(context: unknown): Array<{
  id: string;
  name: string;
  mimeType: string;
  size: number;
  content?: Buffer;
  emailEligible: boolean;
  ineligibleReason?: string;
}> {
  const root = asRecord(context);
  const attachments = asRecord(root?.attachments);
  const images = Array.isArray(attachments?.images) ? attachments.images : [];
  return images.map((item, index) => {
    const record = asRecord(item);
    const id = trimOrUndefined(record?.id) ?? `image-${index + 1}`;
    const mimeType = (trimOrUndefined(record?.mimeType) ?? "").toLowerCase();
    const name = safeImageName(trimOrUndefined(record?.name) ?? `screenshot-${index + 1}`, mimeType);
    const dataUrl = trimOrUndefined(record?.dataUrl) ?? "";
    const parsed = parseImageDataUrl(dataUrl);
    const content = parsed?.content;
    const resolvedMimeType = parsed?.mimeType ?? mimeType;
    const size = Number.isFinite(Number(record?.size)) && Number(record?.size) > 0
      ? Number(record?.size)
      : content?.length ?? 0;
    let ineligibleReason: string | undefined;
    if (!PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES.has(resolvedMimeType)) {
      ineligibleReason = "邮件暂不支持该图片格式，请上传 PNG、JPG 或 GIF。";
    } else if (!content?.length) {
      ineligibleReason = "图片数据不可用，请重新上传。";
    } else if (content.length > PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES) {
      ineligibleReason = "图片超过 2 MB，请压缩后重新上传。";
    }
    return {
      id,
      name,
      mimeType: resolvedMimeType,
      size,
      content,
      emailEligible: !ineligibleReason,
      ineligibleReason
    };
  });
}

function parseImageDataUrl(value: string): { mimeType: string; content: Buffer } | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(value);
  if (!match) return undefined;
  try {
    return {
      mimeType: match[1].toLowerCase(),
      content: Buffer.from(match[2], "base64")
    };
  } catch {
    return undefined;
  }
}

function safeImageName(value: string, mimeType: string): string {
  const fallbackExtension = mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : "jpg";
  const normalized = value
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 160);
  return normalized || `image.${fallbackExtension}`;
}

function mapReplyHistory(record: NotificationRecord): ProductFeedbackReplyHistoryItem {
  const payload = asRecord(record.payload);
  const imageRecords = Array.isArray(payload?.images) ? payload.images.map(asRecord).filter(Boolean) : [];
  const deliveryMode = payloadString(payload, "deliveryMode");
  return {
    id: record.id,
    status: record.status,
    recipientEmail: normalizeEmail(payloadString(payload, "recipientEmail")),
    subject: trimOrUndefined(payloadString(payload, "subject")),
    bodyText: trimOrUndefined(payloadString(payload, "bodyText")),
    templateLanguage: payloadString(payload, "templateLanguage") === "en" ? "en" : "zh",
    imageCount: imageRecords.length,
    imageNames: imageRecords.map((image) => trimOrUndefined(image?.name)).filter(Boolean) as string[],
    actorUserId: trimOrUndefined(payloadString(payload, "actorUserId")),
    delivered: payload?.delivered === true,
    deliveryMode: deliveryMode === "smtp" || deliveryMode === "debug" ? deliveryMode : undefined,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function replaceCidImagesWithDataUrls(html: string, images: ResolvedReplyImage[]): string {
  return images.reduce((result, image) => {
    const dataUrl = `data:${image.mimeType};base64,${image.content.toString("base64")}`;
    return result.replaceAll(`cid:${image.cid}`, dataUrl);
  }, html);
}

function payloadString(value: unknown, key: string): string | undefined {
  return trimOrUndefined(asRecord(value)?.[key]);
}

function normalizeEmail(value: unknown): string | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function summarize(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => trimOrUndefined(value)).filter(Boolean) as string[])];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
