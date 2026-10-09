import { Router, type Request, type Response } from "express";
import { z } from "zod";

/**
 * Browser-side render failures (React error boundaries) never reach the server on their own,
 * so the portal reports them here. Reports are only written to the service log as one JSON
 * line (`[portal-client-error]`), which keeps this endpoint cheap and free of schema changes.
 */

const MAX_TEXT = 4000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 20;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_USERS = 5000;

const clientErrorReportSchema = z.object({
  source: z.string().trim().min(1).max(80),
  message: z.string().max(MAX_TEXT),
  name: z.string().max(200).optional().nullable(),
  stack: z.string().max(MAX_TEXT * 2).optional().nullable(),
  component_stack: z.string().max(MAX_TEXT * 2).optional().nullable(),
  thread_id: z.string().trim().max(200).optional().nullable(),
  build_id: z.string().trim().max(120).optional().nullable(),
  locale: z.string().trim().max(20).optional().nullable(),
  url_path: z.string().trim().max(500).optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional().nullable()
});

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;

type UserWindow = { startedAt: number; count: number; recent: Map<string, number> };

function clip(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function compactContext(context: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  try {
    const text = JSON.stringify(context);
    if (text.length <= 2000) return context;
    return { truncated: text.slice(0, 2000) };
  } catch {
    return undefined;
  }
}

export function createClientErrorReportRouter(options: {
  now?: () => number;
  log?: (line: string) => void;
} = {}): Router {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  const windows = new Map<string, UserWindow>();
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    const parsed = clientErrorReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: "Invalid client error report" });
      return;
    }
    const report = parsed.data;
    const userId = req.currentUser?.id ?? "anonymous";
    const at = now();

    let window = windows.get(userId);
    if (!window || at - window.startedAt > WINDOW_MS) {
      if (!window && windows.size >= MAX_TRACKED_USERS) windows.clear();
      window = { startedAt: at, count: 0, recent: new Map() };
      windows.set(userId, window);
    }
    const signature = `${report.source}|${report.message.slice(0, 200)}|${report.thread_id ?? ""}`;
    const lastSeen = window.recent.get(signature);
    if (window.count >= MAX_REPORTS_PER_WINDOW || (lastSeen !== undefined && at - lastSeen < DUPLICATE_WINDOW_MS)) {
      res.status(202).json({ ok: true, dropped: true });
      return;
    }
    window.count += 1;
    window.recent.set(signature, at);

    log(
      `[portal-client-error] ${JSON.stringify({
        at: new Date(at).toISOString(),
        source: report.source,
        user_id: userId,
        organization_id: req.currentOrganization?.id,
        thread_id: clip(report.thread_id, 200),
        name: clip(report.name, 200),
        message: clip(report.message, MAX_TEXT),
        stack: clip(report.stack, MAX_TEXT),
        component_stack: clip(report.component_stack, MAX_TEXT),
        build_id: clip(report.build_id, 120),
        locale: clip(report.locale, 20),
        url_path: clip(report.url_path, 500),
        user_agent: clip(req.get("user-agent"), 300),
        context: compactContext(report.context)
      })}`
    );
    res.status(202).json({ ok: true });
  });

  return router;
}
