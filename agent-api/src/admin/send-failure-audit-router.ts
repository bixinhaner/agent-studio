import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type AuditDb = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
const querySchema = z.object({
  user: z.string().trim().max(200).optional(),
  stage: z.string().trim().max(80).optional(),
  unlinked: z.enum(["true", "false"]).default("true"),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1)
}).refine(q => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), "Invalid time range");

// Mounted inside the existing internal-admin authorization boundary.
export function createSendFailureAuditRouter(getDb: () => AuditDb) {
  const router = Router();
  router.get("/conversations/send-failures", async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ detail: "筛选条件无效" }); return; }
    const q = parsed.data;
    const filters = [Prisma.sql`(f.thread_id IS NULL OR (t.id IS NOT NULL AND t.security_domain_id IS NULL))`];
    if (q.unlinked === "true") filters.push(Prisma.sql`f.thread_id IS NULL`);
    if (q.user) filters.push(Prisma.sql`(f.user_id = ${q.user} OR u.email ILIKE ${"%" + q.user + "%"} OR u.display_name ILIKE ${"%" + q.user + "%"})`);
    if (q.stage) filters.push(Prisma.sql`f.stage = ${q.stage}`);
    if (q.from) filters.push(Prisma.sql`f.created_at >= ${new Date(q.from)}`);
    if (q.to) filters.push(Prisma.sql`f.created_at <= ${new Date(q.to)}`);
    const scope = Prisma.sql`FROM portal_send_failures f LEFT JOIN threads t ON t.id = f.thread_id LEFT JOIN users u ON u.id = f.user_id WHERE ${Prisma.join(filters, " AND ")}`;
    try {
      const db = getDb();
      const [items, totals] = await Promise.all([
        db.$queryRaw<unknown[]>(Prisma.sql`SELECT f.id, f.thread_id AS "threadId", f.user_id AS "userId", u.display_name AS "userName", u.email AS "userEmail", f.source, f.stage, f.error_code AS "errorCode", f.http_status AS "httpStatus", f.detail, f.message_preview AS "messagePreview", COALESCE(f.attachments, '[]'::jsonb) AS attachments, f.client_run_id AS "clientRunId", f.build_id AS "buildId", f.user_agent AS "userAgent", f.created_at AS "createdAt" ${scope} ORDER BY f.created_at DESC, f.id DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`),
        db.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT count(*)::int AS total ${scope}`)
      ]);
      res.json({ items, total: totals[0]?.total ?? 0, page: q.page, pageSize: 25 });
    } catch {
      res.status(500).json({ detail: "发送失败记录加载失败，请重试" });
    }
  });
  return router;
}
