import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type {
  PortalSendFailureInput,
  PortalSendFailureRecord
} from "../persistence/portal-send-failure-repository.js";
import { createReportRateLimiter } from "./report-rate-limiter.js";

/**
 * A portal send can fail before any user message is saved (upload, thread creation,
 * message save, or in the browser before a request is made). Without a record, the
 * conversation just shows up empty in the admin console. Every such failure is written
 * to `portal_send_failures` and logged as one `[portal-send-failure]` line.
 */

export type PortalSendFailureStore = {
  create(input: PortalSendFailureInput): Promise<PortalSendFailureRecord>;
};

export type PortalSendFailureRecorder = (input: PortalSendFailureInput) => Promise<void>;

export function createPortalSendFailureRecorder(options: {
  store: PortalSendFailureStore;
  log?: (line: string) => void;
}): PortalSendFailureRecorder {
  const log = options.log ?? ((line: string) => console.warn(line));
  return async (input) => {
    // The message text stays out of the service log; the table keeps a short preview.
    log(
      `[portal-send-failure] ${JSON.stringify({
        at: (input.createdAt ?? new Date()).toISOString(),
        source: input.source,
        stage: input.stage,
        thread_id: input.threadId ?? undefined,
        user_id: input.userId ?? undefined,
        organization_id: input.organizationId ?? undefined,
        error_code: input.errorCode ?? undefined,
        http_status: input.httpStatus ?? undefined,
        detail: typeof input.detail === "string" ? input.detail.slice(0, 500) : undefined,
        attachments: input.attachments?.length || undefined,
        message_chars: input.messagePreview?.length || undefined,
        client_run_id: input.clientRunId ?? undefined,
        build_id: input.buildId ?? undefined
      })}`
    );
    try {
      await options.store.create(input);
    } catch (error) {
      console.warn("portal send failure persistence failed", {
        stage: input.stage,
        threadId: input.threadId ?? undefined,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Text and attachment names of a user message body, for the failure record. */
export function portalSendFailureMessageFields(message: unknown): {
  messagePreview?: string;
  attachments?: Array<{ name: string; status?: string }>;
} {
  const record = asObject(message);
  if (!record || record.role !== "user") return {};
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((part) => {
      const item = asObject(part);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
  const attachments = (Array.isArray(record.attachments) ? record.attachments : []).flatMap((item) => {
    const attachment = asObject(item);
    const name = typeof attachment?.name === "string" ? attachment.name : "";
    const status = asObject(attachment?.status)?.type;
    return name ? [{ name, ...(typeof status === "string" ? { status } : {}) }] : [];
  });
  return {
    ...(text ? { messagePreview: text } : {}),
    ...(attachments.length ? { attachments } : {})
  };
}

const CLIENT_STAGES = [
  "attachment_upload",
  "attachment_not_ready",
  "composer_send",
  "run_blocked",
  "thread_resolve",
  "thread_create",
  "message_save",
  "session_start"
] as const;

const clientSendFailureSchema = z.object({
  stage: z.enum(CLIENT_STAGES),
  thread_id: z.string().trim().max(200).optional().nullable(),
  error_code: z.string().trim().max(120).optional().nullable(),
  http_status: z.number().int().min(0).max(999).optional().nullable(),
  detail: z.string().max(4000).optional().nullable(),
  message_preview: z.string().max(4000).optional().nullable(),
  attachments: z
    .array(
      z.object({
        name: z.string().max(300),
        status: z.string().max(40).optional().nullable(),
        failure_code: z.string().max(80).optional().nullable(),
        size_bytes: z.number().nonnegative().optional().nullable()
      })
    )
    .max(20)
    .optional()
    .nullable(),
  client_run_id: z.string().trim().max(200).optional().nullable(),
  build_id: z.string().trim().max(120).optional().nullable()
});

export function createPortalSendFailureRouter(options: {
  record: PortalSendFailureRecorder;
  /** Maps a thread id or the browser's local thread id to a thread the caller owns. */
  resolveOwnedThreadId: (rawThreadId: string, req: Request) => Promise<string | undefined>;
  now?: () => number;
}): Router {
  const limiter = createReportRateLimiter({ now: options.now, maxPerWindow: 30, duplicateWindowMs: 5000 });
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const parsed = clientSendFailureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: "Invalid send failure report" });
      return;
    }
    const report = parsed.data;
    const userId = req.currentUser?.id ?? "anonymous";
    const signature = `${report.stage}|${report.thread_id ?? ""}|${report.client_run_id ?? ""}|${(report.detail ?? "").slice(0, 120)}`;
    const at = limiter.accept(userId, signature);
    if (at === undefined) {
      res.status(202).json({ ok: true, dropped: true });
      return;
    }
    let threadId: string | undefined;
    if (report.thread_id) {
      try {
        threadId = await options.resolveOwnedThreadId(report.thread_id, req);
      } catch {
        threadId = undefined;
      }
    }
    await options.record({
      threadId,
      userId: req.currentUser?.id,
      organizationId: req.currentOrganization?.id,
      source: "client",
      stage: report.stage,
      errorCode: report.error_code,
      httpStatus: report.http_status,
      detail: report.detail,
      messagePreview: report.message_preview,
      attachments: (report.attachments ?? []).map((item) => ({
        name: item.name,
        ...(item.status ? { status: item.status } : {}),
        ...(item.failure_code ? { failureCode: item.failure_code } : {}),
        ...(typeof item.size_bytes === "number" ? { sizeBytes: item.size_bytes } : {})
      })),
      clientRunId: report.client_run_id,
      buildId: report.build_id,
      userAgent: req.get("user-agent"),
      createdAt: new Date(at)
    });
    res.status(202).json({ ok: true, thread_id: threadId ?? null });
  });

  return router;
}
