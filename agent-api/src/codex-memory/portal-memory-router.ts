import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { SystemSettingsCodexMemory } from "../system-settings/types.js";
import { MemoryTranslationError, type MemoryTranslationService } from "./memory-translation.js";
import { localeLanguage, type MemoryLanguage, type NativeMemoryContent } from "./native-memory-view.js";
import {
  PortalMemoryError,
  type PortalMemoryScope,
  type PortalMemoryService
} from "./portal-memory-service.js";
import type { UserMemoryItem } from "./user-memory.js";

const textSchema = z.string().trim().min(1).max(500);
const createSchema = z.object({ scope_id: z.string().trim().min(1).max(200), text: textSchema });
const updateSchema = z.object({ text: textSchema });
const translateSchema = z.object({ locale: z.string().trim().min(2).max(16) });

function itemOut(item: UserMemoryItem) {
  return { id: item.id, text: item.text, created_at: item.createdAt, updated_at: item.updatedAt };
}

function contentOut(content: NativeMemoryContent) {
  return { profile: content.profile, preferences: content.preferences, tips: content.tips };
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? fallback, code: "invalid_input" });
    return;
  }
  if (error instanceof PortalMemoryError) {
    res.status(/not_found/.test(error.code) ? 404 : error.code === "duplicate_item" ? 409 : 400).json({ detail: error.message, code: error.code });
    return;
  }
  if (error instanceof MemoryTranslationError) {
    res.status(error.code === "translation_unavailable" ? 503 : 502).json({ detail: error.message, code: error.code });
    return;
  }
  res.status(500).json({ detail: error instanceof Error ? error.message : fallback });
}

export function createPortalMemoryRouter(input: {
  service: PortalMemoryService;
  translations?: MemoryTranslationService;
  resolveActor(req: Request): { userId: string; organizationId?: string };
  getSettings(): Promise<SystemSettingsCodexMemory>;
}): Router {
  const router = Router();

  async function scopeOut(scope: PortalMemoryScope, language: MemoryLanguage | undefined) {
    const learned = scope.learned;
    const translated =
      learned && language && learned.language !== language
        ? await input.translations?.cached(scope.storeDir, learned, language)
        : undefined;
    return {
      id: scope.id,
      organization_key: scope.organizationKey,
      agent_segment: scope.agentSegment,
      mode_id: scope.modeId ?? null,
      updated_at: scope.updatedAt ?? null,
      user_items: scope.userItems.map(itemOut),
      learned: learned
        ? {
            ...contentOut(learned),
            language: learned.language,
            content_hash: learned.contentHash,
            updated_at: learned.updatedAt ?? null,
            translated: translated ? { language, ...contentOut(translated) } : null
          }
        : null
    };
  }

  router.get("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const language = typeof req.query.locale === "string" && req.query.locale ? localeLanguage(req.query.locale) : undefined;
      const [scopes, settings] = await Promise.all([input.service.list(actor.userId), input.getSettings()]);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        enabled: Boolean(settings.enabled && settings.useMemories),
        learning: Boolean(settings.enabled && settings.generateMemories),
        min_idle_hours: settings.minRolloutIdleHours,
        translation_available: Boolean(input.translations),
        scopes: await Promise.all(scopes.map((scope) => scopeOut(scope, language)))
      });
    } catch (error) {
      sendError(res, error, "Failed to load memories");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = createSchema.parse(req.body ?? {});
      const home = await input.service.resolveHome(actor.userId, body.scope_id);
      const item = await input.service.add(home, { text: body.text });
      res.status(201).json({ scope_id: home.id, item: itemOut(item) });
    } catch (error) {
      sendError(res, error, "Failed to add memory");
    }
  });

  router.post("/:scopeId/translate", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = translateSchema.parse(req.body ?? {});
      if (!input.translations) throw new MemoryTranslationError("Translation is not available", "translation_unavailable");
      const home = await input.service.resolveHome(actor.userId, String(req.params.scopeId));
      const scope = await input.service.readScope(home);
      if (!scope.learned) throw new PortalMemoryError("Nothing to translate", "learned_not_found");
      const language = localeLanguage(body.locale);
      const content = await input.translations.translate({
        storeDir: scope.storeDir,
        view: scope.learned,
        target: language,
        actor,
        scopeId: scope.id
      });
      res.json({ content_hash: scope.learned.contentHash, translated: { language, ...contentOut(content) } });
    } catch (error) {
      sendError(res, error, "Failed to translate memories");
    }
  });

  router.patch("/:scopeId/:itemId", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = updateSchema.parse(req.body ?? {});
      const home = await input.service.resolveHome(actor.userId, String(req.params.scopeId));
      const item = await input.service.update(home, String(req.params.itemId), body);
      res.json({ item: itemOut(item) });
    } catch (error) {
      sendError(res, error, "Failed to update memory");
    }
  });

  router.delete("/:scopeId/:itemId", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const home = await input.service.resolveHome(actor.userId, String(req.params.scopeId));
      await input.service.remove(home, String(req.params.itemId));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete memory");
    }
  });

  return router;
}
