import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { OrgTeamError, type OrgTeamActor, type OrgTeamService } from "./service.js";

// Mounted outside /api/portal on purpose: Caddy sends /api/portal/* to the chat slots, while these
// routes belong to the admin process so changing them never restarts chat.

function sendError(res: Response, error: unknown): void {
  if (error instanceof OrgTeamError) {
    res.status(error.status).json({ detail: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? "Invalid request", code: "invalid_request" });
    return;
  }
  console.error("[org-team] request failed", error);
  res.status(500).json({ detail: "Request failed", code: "internal_error" });
}

function customerActor(req: Request): OrgTeamActor {
  const organizationId = req.currentOrganization?.id;
  if (!req.currentUser || !organizationId || !req.currentMembership) {
    throw new OrgTeamError(403, "forbidden", "Organization context is required");
  }
  return {
    kind: "customer",
    userId: req.currentUser.id,
    email: req.currentUser.email?.toLowerCase(),
    organizationId,
    membershipType: req.currentMembership.membershipType
  };
}

function platformActor(req: Request): OrgTeamActor {
  if (!req.currentUser) throw new OrgTeamError(401, "unauthorized", "Unauthorized");
  return { kind: "platform", userId: req.currentUser.id, email: req.currentUser.email?.toLowerCase() };
}

const inviteSchema = z.object({
  email: z.string().trim().min(1, "Email is required").max(254),
  membershipType: z.enum(["customer_admin", "customer_member"]).optional()
});
const roleSchema = z.object({ membershipType: z.enum(["customer_admin", "customer_member"]) });
const domainsSchema = z.object({ domains: z.array(z.string().max(253)).max(50) });
const joinRequestSchema = z.object({
  email: z.string().trim().min(1, "Email is required").max(254),
  contactName: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).optional()
});

/** `/api/org-team`: the signed-in customer admin manages their active organization. */
export function createOrgTeamPortalRouter(service: OrgTeamService): Router {
  const router = Router();
  const organizationId = (req: Request) => req.currentOrganization?.id ?? "";

  router.get("/team", async (req, res) => {
    try {
      res.json({ team: await service.getOverview(organizationId(req), customerActor(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/team/invites", async (req, res) => {
    try {
      const input = inviteSchema.parse(req.body ?? {});
      const invite = await service.inviteMember(organizationId(req), customerActor(req), { email: input.email });
      res.status(201).json({ invite });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/team/invites/:inviteId", async (req, res) => {
    try {
      await service.revokeInvite(organizationId(req), customerActor(req), req.params.inviteId);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/team/members/:membershipId", async (req, res) => {
    try {
      await service.removeMember(organizationId(req), customerActor(req), req.params.membershipId);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/team/join-requests/:requestId/:decision(approve|reject)", async (req, res) => {
    try {
      const actor = customerActor(req);
      const result =
        req.params.decision === "approve"
          ? await service.approveJoinRequest(organizationId(req), actor, req.params.requestId)
          : await service.rejectJoinRequest(organizationId(req), actor, req.params.requestId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

/** `/api/admin/org-team`: platform admins (the /api/admin chain already enforced the internal admin role). */
export function createOrgTeamAdminRouter(service: OrgTeamService): Router {
  const router = Router();

  router.get("/join-requests", async (req, res) => {
    try {
      res.json({ joinRequests: await service.listPendingJoinRequests(platformActor(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/organizations/:organizationId", async (req, res) => {
    try {
      const actor = platformActor(req);
      const [team, events] = await Promise.all([
        service.getOverview(req.params.organizationId, actor),
        service.listEvents(req.params.organizationId, actor, 50)
      ]);
      res.json({ team, events });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/organizations/:organizationId/invites", async (req, res) => {
    try {
      const input = inviteSchema.parse(req.body ?? {});
      const invite = await service.inviteMember(req.params.organizationId, platformActor(req), input);
      res.status(201).json({ invite });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/organizations/:organizationId/invites/:inviteId", async (req, res) => {
    try {
      await service.revokeInvite(req.params.organizationId, platformActor(req), req.params.inviteId);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/organizations/:organizationId/members/:membershipId", async (req, res) => {
    try {
      const input = roleSchema.parse(req.body ?? {});
      await service.changeMemberRole(req.params.organizationId, platformActor(req), req.params.membershipId, input.membershipType);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/organizations/:organizationId/members/:membershipId", async (req, res) => {
    try {
      await service.removeMember(req.params.organizationId, platformActor(req), req.params.membershipId);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/organizations/:organizationId/invite-domains", async (req, res) => {
    try {
      const input = domainsSchema.parse(req.body ?? {});
      res.json({ domains: await service.setInviteDomains(req.params.organizationId, platformActor(req), input.domains) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/organizations/:organizationId/join-requests/:requestId/:decision(approve|reject)", async (req, res) => {
    try {
      const actor = platformActor(req);
      const result =
        req.params.decision === "approve"
          ? await service.approveJoinRequest(req.params.organizationId, actor, req.params.requestId)
          : await service.rejectJoinRequest(req.params.organizationId, actor, req.params.requestId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

/** Small per-IP window so the public join form cannot be used to spam organization admins. */
export function createJoinRequestRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = options.now?.() ?? Date.now();
    const recent = (hits.get(key) ?? []).filter((at) => now - at < options.windowMs);
    if (recent.length >= options.limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [entryKey, values] of hits) {
        if (!values.some((at) => now - at < options.windowMs)) hits.delete(entryKey);
      }
    }
    return true;
  };
}

/** Caddy is the only proxy in front of the API; the entry it appends last is the visitor and cannot be spoofed. */
function clientKey(req: Request): string {
  const forwarded = req.header("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean).pop();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

/** `/public-api/org-join-requests`: ask to join the workspace your company already has. */
export function createOrgJoinRequestPublicRouter(
  service: OrgTeamService,
  allow = createJoinRequestRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 })
): Router {
  const router = Router();
  router.post("/", async (req, res) => {
    try {
      if (!allow(clientKey(req))) {
        res.status(429).json({ detail: "Too many requests. Try again later.", code: "rate_limited" });
        return;
      }
      const input = joinRequestSchema.parse(req.body ?? {});
      res.status(202).json(await service.submitJoinRequest({ ...input, publicBrandId: req.publicBrand?.id }));
    } catch (error) {
      sendError(res, error);
    }
  });
  return router;
}
