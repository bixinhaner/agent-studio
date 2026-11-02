import { Router, type Request, type Response } from "express";
import { z } from "zod";

/**
 * Who had the portal open. The page sends a heartbeat to /api/portal-presence, which
 * Caddy routes to the admin service, so visits are recorded even while the chat slots
 * are down. One row per user and 10-minute slot keeps the table small while still
 * answering "who was affected between 11:34 and 13:09".
 */

export const PRESENCE_SLOT_MS = 10 * 60_000;
/** A page heartbeats every few minutes; extra beats within this window are not written. */
const MIN_WRITE_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 180;
const MAX_RANGE_MS = 31 * 24 * 60 * 60_000;

type PresenceSlotRow = {
  userId: string;
  slotStart: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hits: number;
  buildId: string | null;
};

export type PortalPresenceDb = {
  portalPresenceSlot: {
    upsert(args: {
      where: { userId_slotStart: { userId: string; slotStart: Date } };
      create: {
        userId: string;
        slotStart: Date;
        organizationId?: string | null;
        firstSeenAt: Date;
        lastSeenAt: Date;
        buildId?: string | null;
        userAgent?: string | null;
      };
      update: { lastSeenAt: Date; hits: { increment: number }; buildId?: string | null; userAgent?: string | null };
    }): Promise<unknown>;
    deleteMany(args: { where: { slotStart: { lt: Date } } }): Promise<unknown>;
    findMany(args: {
      where: { slotStart: { gte: Date; lt: Date } };
      orderBy: { slotStart: "asc" };
      select: { userId: true; slotStart: true; firstSeenAt: true; lastSeenAt: true; hits: true; buildId: true };
    }): Promise<PresenceSlotRow[]>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; displayName: true; email: true };
    }): Promise<Array<{ id: string; displayName: string | null; email: string | null }>>;
  };
};

export function presenceSlotStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / PRESENCE_SLOT_MS) * PRESENCE_SLOT_MS);
}

const heartbeatSchema = z.object({
  build_id: z.string().trim().max(120).optional()
});

function clip(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Mounted behind requireCurrentUser at /api/portal-presence (admin process). */
export function createPortalPresenceRouter(options: {
  getDb: () => PortalPresenceDb;
  now?: () => Date;
  logger?: Pick<Console, "warn">;
}): Router {
  const router = Router();
  const now = options.now ?? (() => new Date());
  const lastWrite = new Map<string, number>();
  let lastCleanup = 0;

  router.post("/", async (req: Request, res: Response) => {
    const userId = req.currentUser?.id;
    if (!userId) {
      res.status(401).json({ detail: "Not signed in" });
      return;
    }
    const parsed = heartbeatSchema.safeParse(req.body ?? {});
    const at = now();
    const slotStart = presenceSlotStart(at);
    const key = `${userId}|${slotStart.getTime()}`;
    const previous = lastWrite.get(key);
    if (previous !== undefined && at.getTime() - previous < MIN_WRITE_INTERVAL_MS) {
      res.status(204).end();
      return;
    }
    lastWrite.set(key, at.getTime());
    if (lastWrite.size > 5_000) {
      for (const [entry, time] of lastWrite) {
        if (at.getTime() - time > PRESENCE_SLOT_MS) lastWrite.delete(entry);
      }
    }
    const buildId = parsed.success ? clip(parsed.data.build_id, 120) : null;
    const userAgent = clip(req.header("user-agent"), 400);
    const db = options.getDb();
    const write = () =>
      db.portalPresenceSlot.upsert({
        where: { userId_slotStart: { userId, slotStart } },
        create: {
          userId,
          slotStart,
          organizationId: req.currentOrganization?.id ?? null,
          firstSeenAt: at,
          lastSeenAt: at,
          buildId,
          userAgent
        },
        update: { lastSeenAt: at, hits: { increment: 1 }, buildId, userAgent }
      });
    try {
      // Two tabs can create the same slot at once; the loser updates the winner's row.
      await write().catch(write);
      res.status(204).end();
    } catch (error) {
      lastWrite.delete(key);
      options.logger?.warn("portal presence heartbeat failed", { detail: error instanceof Error ? error.message : String(error) });
      res.status(204).end();
    }
    if (at.getTime() - lastCleanup > 24 * 60 * 60_000) {
      lastCleanup = at.getTime();
      void db.portalPresenceSlot
        .deleteMany({ where: { slotStart: { lt: new Date(at.getTime() - RETENTION_DAYS * 24 * 60 * 60_000) } } })
        .catch(() => undefined);
    }
  });

  return router;
}

const auditQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    user: z.string().trim().max(200).optional()
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), "Invalid time range")
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_RANGE_MS, "Time range too long");

/** Mounted inside the internal-admin authorization boundary. */
export function createPortalPresenceAuditRouter(getDb: () => PortalPresenceDb): Router {
  const router = Router();
  router.get("/portal-presence", async (req: Request, res: Response) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ detail: "时间范围无效，最多查询 31 天" });
      return;
    }
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    try {
      const db = getDb();
      // Slots that started before `from` still cover visits inside the range.
      const rows = await db.portalPresenceSlot.findMany({
        where: { slotStart: { gte: new Date(from.getTime() - PRESENCE_SLOT_MS), lt: to } },
        orderBy: { slotStart: "asc" },
        select: { userId: true, slotStart: true, firstSeenAt: true, lastSeenAt: true, hits: true, buildId: true }
      });
      const inRange = rows.filter((row) => row.lastSeenAt >= from && row.firstSeenAt < to);
      const users = await db.user.findMany({
        where: { id: { in: [...new Set(inRange.map((row) => row.userId))] } },
        select: { id: true, displayName: true, email: true }
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      const grouped = new Map<string, PresenceSlotRow[]>();
      for (const row of inRange) grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row]);
      const needle = parsed.data.user?.toLowerCase();
      const items = [...grouped.entries()]
        .map(([userId, slots]) => {
          const user = byId.get(userId);
          return {
            userId,
            userName: user?.displayName ?? null,
            userEmail: user?.email ?? null,
            firstSeenAt: slots[0]!.firstSeenAt,
            lastSeenAt: slots.reduce((latest, slot) => (slot.lastSeenAt > latest ? slot.lastSeenAt : latest), slots[0]!.lastSeenAt),
            activeMinutes: slots.length * (PRESENCE_SLOT_MS / 60_000),
            hits: slots.reduce((sum, slot) => sum + slot.hits, 0),
            buildId: slots.at(-1)?.buildId ?? null,
            slots: slots.map((slot) => slot.slotStart)
          };
        })
        .filter((item) =>
          !needle ||
          item.userId === parsed.data.user ||
          item.userName?.toLowerCase().includes(needle) ||
          item.userEmail?.toLowerCase().includes(needle)
        )
        .sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime());
      res.json({ from, to, slotMinutes: PRESENCE_SLOT_MS / 60_000, total: items.length, items });
    } catch {
      res.status(500).json({ detail: "Portal 访问记录加载失败，请重试" });
    }
  });
  return router;
}
