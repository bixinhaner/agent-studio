/**
 * Database-backed index of admin conversation-audit summaries.
 *
 * Summaries are still computed by the router's JS logic (so filtering semantics stay
 * identical); this module persists them in `thread_audit_summaries`, recomputes only
 * rows that triggers marked stale (dirty_seq > clean_seq), and filters / sorts /
 * paginates in SQL instead of loading every thread and message per request.
 */

export type SummaryIndexRawDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type IndexedConversationFields = {
  status: string;
  audience: string;
  hasChannel: boolean;
  channelType: string | null;
  userId: string | null;
  feedbackTotal: number;
  feedbackPositive: number;
  feedbackNegative: number;
  searchText: string;
};

export type ConversationIndexQuery = {
  status: "all" | string;
  feedback: "all" | "with_feedback" | "positive" | "negative" | "none";
  source: "all" | "internal" | "brand_employee" | "external" | "zendesk" | "dingtalk" | "action_connector";
  query?: string;
  sort: "updated_desc" | "created_desc";
  page: number;
  pageSize: number;
};

export type ConversationIndexAggregate = {
  totalThreads: number;
  threadsWithFeedback: number;
  totalFeedback: number;
  positiveFeedback: number;
  negativeFeedback: number;
  uniqueUsers: number;
};

const VISIBLE_THREAD = `t."workspace_trash_batch_id" IS NULL AND t."security_domain_id" IS NULL`;
const REFRESH_BATCH_SIZE = 100;

type StaleRow = { threadId: string; dirtySeq: string | number | bigint };

export function buildIndexWhere(input: ConversationIndexQuery): { sql: string; values: unknown[] } {
  const clauses = [VISIBLE_THREAD, `s."summary" IS NOT NULL`];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.status !== "all") clauses.push(`s."status" = ${param(input.status)}`);

  if (input.feedback === "with_feedback") clauses.push(`s."feedback_total" > 0`);
  else if (input.feedback === "none") clauses.push(`s."feedback_total" = 0`);
  else if (input.feedback === "positive") clauses.push(`s."feedback_positive" > 0`);
  else if (input.feedback === "negative") clauses.push(`s."feedback_negative" > 0`);

  if (input.source === "zendesk") clauses.push(`s."channel_type" = 'zendesk'`);
  else if (input.source === "dingtalk") clauses.push(`s."channel_type" = 'dingtalk_bot'`);
  else if (input.source === "action_connector") clauses.push(`s."channel_type" = 'action_connector'`);
  else if (input.source === "internal" || input.source === "brand_employee" || input.source === "external") {
    clauses.push(`s."has_channel" = false AND s."audience" = ${param(input.source)}`);
  }

  const needle = input.query?.trim().toLowerCase();
  if (needle) clauses.push(`position(${param(needle)} in s."search_text") > 0`);

  return { sql: clauses.join(" AND "), values };
}

export class ConversationSummaryIndex<TSummary> {
  private refreshing: Promise<number> | null = null;

  constructor(
    private readonly deps: {
      db: () => SummaryIndexRawDb;
      /** Builds summaries for the given visible thread ids (missing ids are skipped). */
      buildSummaries(threadIds: string[]): Promise<Array<{ threadId: string; summary: TSummary; fields: IndexedConversationFields }>>;
    }
  ) {}

  /** Recomputes stale rows; concurrent callers share one run. Returns how many rows were rebuilt. */
  refresh(): Promise<number> {
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async runRefresh(): Promise<number> {
    const db = this.deps.db();
    // Safety net for threads created before the triggers existed.
    await db.$executeRawUnsafe(
      `INSERT INTO "thread_audit_summaries" ("thread_id")
       SELECT t."id" FROM "threads" t
       WHERE NOT EXISTS (SELECT 1 FROM "thread_audit_summaries" s WHERE s."thread_id" = t."id")
       ON CONFLICT DO NOTHING`
    );
    let rebuilt = 0;
    let afterId = "";
    // Walk stale rows in id order so each pass makes progress even if some rows stay stale.
    for (;;) {
      const stale = await db.$queryRawUnsafe<StaleRow[]>(
        `SELECT s."thread_id" AS "threadId", s."dirty_seq" AS "dirtySeq"
         FROM "thread_audit_summaries" s JOIN "threads" t ON t."id" = s."thread_id"
         WHERE s."dirty_seq" > s."clean_seq" AND ${VISIBLE_THREAD} AND s."thread_id" > $1
         ORDER BY s."thread_id" LIMIT ${REFRESH_BATCH_SIZE}`,
        afterId
      );
      if (stale.length === 0) break;
      afterId = stale[stale.length - 1].threadId;
      const seqByThread = new Map(stale.map((row) => [row.threadId, String(row.dirtySeq)]));
      const built = await this.deps.buildSummaries(stale.map((row) => row.threadId));
      if (built.length > 0) {
        const payload = built.map((item) => ({
          thread_id: item.threadId,
          seq: seqByThread.get(item.threadId) ?? "0",
          status: item.fields.status,
          audience: item.fields.audience,
          has_channel: item.fields.hasChannel,
          channel_type: item.fields.channelType,
          user_id: item.fields.userId,
          feedback_total: item.fields.feedbackTotal,
          feedback_positive: item.fields.feedbackPositive,
          feedback_negative: item.fields.feedbackNegative,
          search_text: item.fields.searchText,
          summary: item.summary
        }));
        // SKIP LOCKED: never wait on rows a chat transaction is writing (avoids deadlocks
        // with message writes); those rows stay stale and are picked up next time.
        // clean_seq is set to the dirty_seq we read, so writes that happened meanwhile keep the row stale.
        rebuilt += await db.$executeRawUnsafe(
          `WITH x AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(
               thread_id text, seq bigint, status text, audience text, has_channel boolean, channel_type text,
               user_id text, feedback_total int, feedback_positive int, feedback_negative int, search_text text, summary jsonb
             )
           ), locked AS (
             SELECT s."thread_id" FROM "thread_audit_summaries" s
             WHERE s."thread_id" IN (SELECT thread_id FROM x)
             FOR UPDATE SKIP LOCKED
           )
           UPDATE "thread_audit_summaries" s SET
             "clean_seq" = x.seq,
             "status" = x.status,
             "audience" = x.audience,
             "has_channel" = x.has_channel,
             "channel_type" = x.channel_type,
             "user_id" = x.user_id,
             "feedback_total" = x.feedback_total,
             "feedback_positive" = x.feedback_positive,
             "feedback_negative" = x.feedback_negative,
             "search_text" = x.search_text,
             "summary" = x.summary,
             "refreshed_at" = NOW()
           FROM x JOIN locked ON locked."thread_id" = x.thread_id
           WHERE s."thread_id" = x.thread_id`,
          // Postgres text/jsonb reject NUL characters.
          JSON.stringify(payload).replace(/(?<!\\)\\u0000/g, "")
        );
      }
      if (stale.length < REFRESH_BATCH_SIZE) break;
    }
    return rebuilt;
  }

  async query(input: ConversationIndexQuery): Promise<{
    totalItems: number;
    page: number;
    totalPages: number;
    aggregate: ConversationIndexAggregate;
    items: TSummary[];
  }> {
    const db = this.deps.db();
    const where = buildIndexWhere(input);
    const from = `FROM "thread_audit_summaries" s JOIN "threads" t ON t."id" = s."thread_id" WHERE ${where.sql}`;
    const [aggregateRow] = await db.$queryRawUnsafe<Array<Record<string, number | bigint | null>>>(
      `SELECT
         COUNT(*)::int AS "totalThreads",
         COUNT(*) FILTER (WHERE s."feedback_total" > 0)::int AS "threadsWithFeedback",
         COALESCE(SUM(s."feedback_total"), 0)::int AS "totalFeedback",
         COALESCE(SUM(s."feedback_positive"), 0)::int AS "positiveFeedback",
         COALESCE(SUM(s."feedback_negative"), 0)::int AS "negativeFeedback",
         COUNT(DISTINCT s."user_id")::int AS "uniqueUsers"
       ${from}`,
      ...where.values
    );
    const aggregate: ConversationIndexAggregate = {
      totalThreads: Number(aggregateRow?.totalThreads ?? 0),
      threadsWithFeedback: Number(aggregateRow?.threadsWithFeedback ?? 0),
      totalFeedback: Number(aggregateRow?.totalFeedback ?? 0),
      positiveFeedback: Number(aggregateRow?.positiveFeedback ?? 0),
      negativeFeedback: Number(aggregateRow?.negativeFeedback ?? 0),
      uniqueUsers: Number(aggregateRow?.uniqueUsers ?? 0)
    };
    const totalItems = aggregate.totalThreads;
    const totalPages = Math.max(1, Math.ceil(totalItems / input.pageSize));
    const page = Math.min(Math.max(1, input.page), totalPages);
    const orderColumn = input.sort === "created_desc" ? `t."created_at"` : `t."updated_at"`;
    const rows = await db.$queryRawUnsafe<Array<{ summary: TSummary }>>(
      `SELECT s."summary" AS "summary" ${from}
       ORDER BY ${orderColumn} DESC, t."id" DESC
       LIMIT ${input.pageSize} OFFSET ${(page - 1) * input.pageSize}`,
      ...where.values
    );
    return { totalItems, page, totalPages, aggregate, items: rows.map((row) => row.summary) };
  }
}
