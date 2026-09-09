import { Router, type Request, type Response } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

type Db = any;
type Pending = { resolve: (value: unknown) => void; timer: NodeJS.Timeout; command: unknown };
const pending = new Map<string, Pending>();
const pairCodes = new Map<string, { userId: string; expiresAt: number }>();

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const deviceToken = () => `asb_${randomBytes(32).toString("base64url")}`;
const requestSchema = z.object({
  op: z.enum(["read", "list", "write"]),
  path: z.string().min(1).max(4096),
  content: z.string().max(10 * 1024 * 1024).optional(),
  expectedMtimeMs: z.number().optional(),
  sessionId: z.string().min(1).max(200)
});

function currentUser(req: Request) {
  if (!req.currentUser) throw new Error("Unauthorized");
  return req.currentUser;
}

export function createLocalBridgeRouter(db: Db): Router {
  const router = Router();

  router.get("/devices", async (req, res) => {
    try {
      const user = currentUser(req);
      const devices = await db.localBridgeDevice.findMany({ where: { userId: user.id }, include: { roots: true }, orderBy: { createdAt: "desc" } });
      res.json({ devices: devices.map((d: any) => ({ id: d.id, name: d.name, platform: d.platform, status: d.status === "active" && d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 45_000 ? "online" : "offline", last_seen_at: d.lastSeenAt?.toISOString() ?? null, roots: d.roots.map((r: any) => ({ id: r.id, path: r.path, label: r.label })) })) });
    } catch (e) { res.status(e instanceof Error && e.message === "Unauthorized" ? 401 : 500).json({ detail: e instanceof Error ? e.message : "failed" }); }
  });

  router.post("/devices/pairing", async (req, res) => {
    try {
      const user = currentUser(req);
      const code = randomBytes(4).toString("hex").toUpperCase();
      pairCodes.set(code, { userId: user.id, expiresAt: Date.now() + 10 * 60_000 });
      res.status(201).json({ code, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    } catch (e) { res.status(401).json({ detail: e instanceof Error ? e.message : "Unauthorized" }); }
  });

  router.post("/devices/:deviceId/roots", async (req, res) => {
    try {
      const user = currentUser(req); const path = z.string().min(1).max(4096).parse(req.body?.path); const label = typeof req.body?.label === "string" ? req.body.label.slice(0, 120) : null;
      const device = await db.localBridgeDevice.findFirst({ where: { id: req.params.deviceId, userId: user.id } }); if (!device) return res.status(404).json({ detail: "Device not found" });
      const root = await db.localBridgeRoot.upsert({ where: { deviceId_path: { deviceId: device.id, path } }, update: { label }, create: { deviceId: device.id, path, label } });
      res.status(201).json({ root: { id: root.id, path: root.path, label: root.label } });
    } catch (e) { res.status(400).json({ detail: e instanceof Error ? e.message : "invalid request" }); }
  });

  router.delete("/devices/:deviceId", async (req, res) => {
    try { const user = currentUser(req); const result = await db.localBridgeDevice.deleteMany({ where: { id: req.params.deviceId, userId: user.id } }); if (!result.count) return res.status(404).json({ detail: "Device not found" }); for (const [id, task] of pending) { if (id.startsWith(`${req.params.deviceId}:`)) { clearTimeout(task.timer); task.resolve({ ok: false, error: "DEVICE_REVOKED" }); pending.delete(id); } } res.status(204).end(); } catch (e) { res.status(401).json({ detail: e instanceof Error ? e.message : "Unauthorized" }); }
  });

  router.post("/devices/:deviceId/execute", async (req, res) => {
    try {
      const user = currentUser(req); const parsed = requestSchema.parse(req.body); const device = await db.localBridgeDevice.findFirst({ where: { id: req.params.deviceId, userId: user.id }, include: { roots: true } });
      if (!device || device.status !== "active") return res.status(409).json({ detail: "Device is offline" });
      const id = `${device.id}:${randomUUID()}`; const promise = new Promise((resolve) => { const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "BRIDGE_TIMEOUT" }); }, 30_000); pending.set(id, { resolve, timer, command: { id, ...parsed } }); });
      await db.localBridgeDevice.update({ where: { id: device.id }, data: { updatedAt: new Date() } });
      const result = await promise; res.status((result as any).ok === false ? 504 : 200).json(result);
    } catch (e) { res.status(400).json({ detail: e instanceof Error ? e.message : "invalid request" }); }
  });

  router.post("/agent/pair", async (req, res) => {
    const parsed = z.object({ code: z.string().min(4), name: z.string().min(1).max(120), platform: z.string().max(80).optional() }).safeParse(req.body);
    const claim = parsed.success ? pairCodes.get(parsed.data.code.toUpperCase()) : undefined;
    if (!parsed.success || !claim || claim.expiresAt < Date.now()) return res.status(400).json({ detail: "Pairing code is invalid or expired" });
    pairCodes.delete(parsed.data.code.toUpperCase()); const token = deviceToken();
    const device = await db.localBridgeDevice.create({ data: { userId: claim.userId, name: parsed.data.name, platform: parsed.data.platform, status: "active", tokenHash: hash(token) } });
    res.status(201).json({ device_id: device.id, token });
  });

  router.post("/agent/roots", async (req, res) => {
    const device = await authenticateAgent(req, res);
    if (!device) return;
    try {
      const parsed = z.object({ path: z.string().min(1).max(4096), label: z.string().max(120).optional() }).parse(req.body);
      const root = await db.localBridgeRoot.upsert({
        where: { deviceId_path: { deviceId: device.id, path: parsed.path } },
        update: { label: parsed.label ?? null },
        create: { deviceId: device.id, path: parsed.path, label: parsed.label ?? null }
      });
      res.status(201).json({ root: { id: root.id, path: root.path, label: root.label } });
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : "Invalid root" });
    }
  });

  async function authenticateAgent(req: Request, res: Response) {
    const raw = req.header("authorization")?.replace(/^Bearer\s+/i, ""); if (!raw) { res.status(401).json({ detail: "Missing device token" }); return null; }
    const device = await db.localBridgeDevice.findFirst({ where: { tokenHash: hash(raw), status: "active" }, include: { roots: true } }); if (!device) { res.status(401).json({ detail: "Invalid device token" }); return null; }
    await db.localBridgeDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }); return device;
  }

  router.post("/agent/poll", async (req, res) => {
    const device = await authenticateAgent(req, res); if (!device) return; const task = [...pending.entries()].find(([id]) => id.startsWith(`${device.id}:`));
    if (!task) return res.json({ command: null, roots: device.roots.map((r: any) => r.path) });
    res.json({ command: { ...(pending.get(task[0])?.command as object), scope: { userId: device.userId, deviceId: device.id, sessionId: "relay", roots: device.roots.map((r: any) => r.path) } } });
  });
  router.post("/agent/result", async (req, res) => {
    const device = await authenticateAgent(req, res); if (!device) return; const id = z.string().parse(req.body?.id); const task = pending.get(id); if (!task || !id.startsWith(`${device.id}:`)) return res.status(404).json({ detail: "Command not found" }); clearTimeout(task.timer); pending.delete(id); task.resolve(req.body?.result ?? { ok: false, error: "BRIDGE_ERROR" }); res.status(204).end();
  });
  return router;
}
