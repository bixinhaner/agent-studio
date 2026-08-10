import { describe, expect, it, vi } from "vitest";

import type { AuthEmailSender } from "../auth/email.js";
import type {
  CreateNotificationRecordInput,
  ListNotificationRecordsInput,
  NotificationRecord,
  UpdateNotificationRecordInput
} from "../persistence/notification-record-repository.js";
import type { ProductFeedbackRecord } from "../persistence/product-feedback-repository.js";
import { ProductFeedbackReplyService } from "./product-feedback-reply-service.js";

const now = "2026-08-07T09:07:00.000Z";

function createFeedback(overrides: Partial<ProductFeedbackRecord> = {}): ProductFeedbackRecord {
  const screenshot = Buffer.from("feedback screenshot");
  return {
    id: "feedback-1",
    organizationId: "org-1",
    userId: "user-1",
    type: "bug",
    severity: "medium",
    description: "“我的工作区”里的文件夹无法修改命名",
    status: "open",
    createdAt: now,
    updatedAt: now,
    user: {
      id: "user-1",
      displayName: "杜磊",
      email: "User@Example.com",
      role: "employee",
      status: "active"
    },
    context: {
      attachments: {
        images: [{
          id: "source-image-1",
          name: "folder-menu.png",
          mimeType: "image/png",
          size: screenshot.length,
          dataUrl: `data:image/png;base64,${screenshot.toString("base64")}`
        }]
      }
    },
    ...overrides
  };
}

function createNotifications() {
  const records: NotificationRecord[] = [];
  return {
    records,
    create: vi.fn(async (input: CreateNotificationRecordInput) => {
      const record: NotificationRecord = {
        id: `notification-${records.length + 1}`,
        organizationId: input.organizationId,
        channelType: input.channelType,
        targetRef: input.targetRef,
        eventType: input.eventType,
        status: input.status ?? "pending",
        payload: input.payload,
        errorMessage: input.errorMessage ?? undefined,
        createdAt: now,
        updatedAt: now
      };
      records.push(record);
      return record;
    }),
    update: vi.fn(async (input: { id: string; changes: UpdateNotificationRecordInput }) => {
      const record = records.find((item) => item.id === input.id);
      if (!record) throw new Error("notification not found");
      Object.assign(record, {
        ...input.changes,
        errorMessage: input.changes.errorMessage ?? undefined,
        updatedAt: now
      });
      return record;
    }),
    list: vi.fn(async (input: ListNotificationRecordsInput = {}) => records.filter((record) => (
      (!input.targetRef || record.targetRef === input.targetRef)
      && (!input.eventType || record.eventType === input.eventType)
      && (!input.channelType || record.channelType === input.channelType)
    )))
  };
}

function createHarness(input: {
  feedback?: ProductFeedbackRecord;
  emailSender?: AuthEmailSender;
} = {}) {
  let feedback = input.feedback ?? createFeedback();
  const notifications = createNotifications();
  const updateStatus = vi.fn(async (_id: string, status: ProductFeedbackRecord["status"]) => {
    feedback = { ...feedback, status, updatedAt: now };
    return feedback;
  });
  const repository = {
    get: vi.fn(async () => feedback),
    updateStatus
  };
  const emailSender = input.emailSender ?? {
    send: vi.fn(async () => ({ delivered: true, mode: "smtp" as const }))
  };
  const service = new ProductFeedbackReplyService({
    feedback: repository,
    notifications,
    emailSender,
    resolveBrandName: () => "Bailey",
    resolvePortalUrl: () => "https://portal.example.com"
  });
  return { service, repository, notifications, emailSender };
}

describe("ProductFeedbackReplyService", () => {
  it("provides Chinese and English drafts and infers the default language", async () => {
    const { service } = createHarness();

    const state = await service.getState(createFeedback());

    expect(state.draft.defaultLanguage).toBe("zh");
    expect(state.draft.recipientEmail).toBe("user@example.com");
    expect(state.draft.templates.zh.subject).toContain("处理结果");
    expect(state.draft.templates.zh.subject).not.toContain("““");
    expect(state.draft.templates.zh.bodyText).toContain("如果问题仍然出现");
    expect(state.draft.templates.en.subject).toContain("Update on your feedback");
    expect(state.draft.templates.en.bodyText).toContain("If the issue appears again");
    expect(state.draft.originalImages[0]).toMatchObject({
      id: "source-image-1",
      emailEligible: true
    });
  });

  it("renders a styled HTML preview with selected images embedded as data URLs", async () => {
    const { service } = createHarness();

    const preview = await service.preview({
      feedbackId: "feedback-1",
      subject: "Issue resolved",
      bodyText: "The folder can now be renamed from its more menu.",
      templateLanguage: "en",
      selectedImageIds: ["source-image-1"]
    });

    expect(preview.imageCount).toBe(1);
    expect(preview.html).toContain("Feedback addressed");
    expect(preview.html).toContain("Resolution details");
    expect(preview.html).toContain("Illustration");
    expect(preview.html).toContain("data:image/png;base64,");
    expect(preview.html).not.toContain("cid:product-feedback");
    expect(preview.html).toContain("href=\"https://portal.example.com\"");
  });

  it("sends styled HTML with CID attachments, records metadata, and resolves only after delivery", async () => {
    const { service, repository, notifications, emailSender } = createHarness();
    const upload = Buffer.from("admin illustration");

    const result = await service.sendAndResolve({
      feedbackId: "feedback-1",
      subject: "问题已处理",
      bodyText: "现在可以通过更多菜单重命名文件夹。",
      templateLanguage: "zh",
      selectedImageIds: ["source-image-1"],
      uploads: [{
        originalname: "操作示意.jpg",
        mimetype: "image/jpeg",
        size: upload.length,
        buffer: upload
      }],
      clientRequestId: "request-1",
      actorUserId: "admin-1"
    });

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(emailSender.send).mock.calls[0][0];
    expect(sent.text).toBe("现在可以通过更多菜单重命名文件夹。");
    expect(sent.html).toContain("您的反馈已有处理结果");
    expect(sent.html).toContain("cid:product-feedback-feedback-1-1-");
    expect(sent.attachments).toHaveLength(2);
    expect(sent.attachments?.every((attachment) => Boolean(attachment.cid))).toBe(true);
    expect(repository.updateStatus).toHaveBeenCalledWith("feedback-1", "resolved");
    expect(result.feedback.status).toBe("resolved");
    expect(result.reply.history[0]).toMatchObject({
      status: "sent",
      imageCount: 2,
      templateLanguage: "zh",
      delivered: true
    });
    expect(JSON.stringify(notifications.records[0].payload)).not.toContain("feedback screenshot");
    expect(JSON.stringify(notifications.records[0].payload)).not.toContain("data:image");
  });

  it("does not change feedback status when SMTP delivery fails", async () => {
    const emailSender: AuthEmailSender = {
      send: vi.fn(async () => {
        throw new Error("SMTP unavailable");
      })
    };
    const { service, repository, notifications } = createHarness({ emailSender });

    await expect(service.sendAndResolve({
      feedbackId: "feedback-1",
      subject: "问题已处理",
      bodyText: "已完成处理。",
      templateLanguage: "zh",
      clientRequestId: "request-failed"
    })).rejects.toThrow("反馈仍保持原状态");

    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(notifications.records[0]).toMatchObject({
      status: "failed",
      errorMessage: "SMTP unavailable"
    });
  });

  it("reuses a successful client request without sending a duplicate email", async () => {
    const { service, emailSender } = createHarness();
    const input = {
      feedbackId: "feedback-1",
      subject: "问题已处理",
      bodyText: "已完成处理。",
      templateLanguage: "zh",
      clientRequestId: "same-request"
    };

    const first = await service.sendAndResolve(input);
    const second = await service.sendAndResolve(input);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(emailSender.send).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported or oversized images before sending", async () => {
    const { service, emailSender } = createHarness();

    await expect(service.sendAndResolve({
      feedbackId: "feedback-1",
      subject: "问题已处理",
      bodyText: "已完成处理。",
      templateLanguage: "zh",
      uploads: [{
        originalname: "demo.webp",
        mimetype: "image/webp",
        size: 10,
        buffer: Buffer.alloc(10)
      }],
      clientRequestId: "invalid-image"
    })).rejects.toThrow("仅支持 PNG、JPG 或 GIF");

    expect(emailSender.send).not.toHaveBeenCalled();
  });
});
