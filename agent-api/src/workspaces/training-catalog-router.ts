import { Router, type Request, type Response } from "express";
import path from "node:path";

import { sendOfficePdfPreview } from "../files/office-preview-service.js";
import { detectedContentType, sendStructuredPreview } from "../files/structured-preview-service.js";
import {
  TrainingCatalogAccessError,
  TrainingCatalogService,
  type TrainingCatalogThread,
  type TrainingCatalogViewer
} from "./training-catalog-service.js";
import type {
  WorkspaceFileVersionSummary,
  WorkspaceNodeSummary,
  WorkspaceTaskSummary
} from "./service.js";
import type { TrainingTranslationLocale } from "./training-translation-service.js";

function requestedLocale(req: Request): TrainingTranslationLocale | undefined {
  return req.query.lang === "en" ? "en" : undefined;
}

function scheduleEnglishPrewarm(
  service: TrainingCatalogService,
  viewer: TrainingCatalogViewer,
  locale?: TrainingTranslationLocale
): void {
  if (locale !== "en") return;
  void service.ensureEnglishPrewarm(viewer).catch(() => undefined);
}

function nodeOut(node: WorkspaceNodeSummary) {
  return {
    id: node.id,
    parent_id: node.parentId ?? null,
    kind: node.kind,
    name: node.name,
    system_key: node.systemKey ?? null,
    mime_type: node.mimeType ?? null,
    size_bytes: node.sizeBytes ?? null,
    checksum: node.checksum ?? null,
    state: node.state,
    created_by_type: node.createdByType,
    source_thread_id: node.sourceThreadId ?? null,
    created_at: node.createdAt,
    updated_at: node.updatedAt
  };
}

function taskOut(task: WorkspaceTaskSummary) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    folder_id: task.folderId ?? null,
    file_count: task.fileCount,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
}

function versionOut(version: WorkspaceFileVersionSummary) {
  return {
    id: version.id,
    file_id: version.fileId,
    version_no: version.versionNo,
    mime_type: version.mimeType ?? null,
    size_bytes: version.sizeBytes,
    checksum: version.checksum,
    created_by_type: version.createdByType,
    created_by_user_id: version.createdByUserId ?? null,
    created_by_thread_id: version.createdByThreadId ?? null,
    change_type: version.changeType,
    created_at: version.createdAt
  };
}

function threadOut(thread: TrainingCatalogThread) {
  return {
    id: thread.id,
    status: thread.status,
    title: thread.title,
    external_id: thread.externalId,
    model: thread.model,
    reasoning_effort: thread.reasoningEffort,
    workspace_id: thread.workspaceId ?? null,
    folder_id: thread.folderId ?? null,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    has_unread_completion: false,
    enabled_skills: [],
    enabled_skill_names: []
  };
}

function sendTrainingError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof TrainingCatalogAccessError) {
    res.status(error.status).json({ detail: error.message });
    return;
  }
  const detail = error instanceof Error ? error.message : fallback;
  res.status(/does not exist|不存在|尚未发布/i.test(detail) ? 404 : 400).json({ detail });
}

export function createTrainingCatalogRouter(input: {
  service: TrainingCatalogService;
  resolveViewer(req: Request): Promise<TrainingCatalogViewer>;
}): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const catalog = await input.service.getCatalog(viewer);
      const rootFolder = (await input.service.listNodes({ viewer, locale: requestedLocale(req) }))[0];
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        workspace: {
          id: catalog.workspaceId,
          name: "培训案例",
          status: "readonly",
          quota_bytes: 0,
          used_bytes: 0,
          history_folder_id: catalog.rootFolder.id,
          read_only: true
        },
        nodes: [nodeOut(rootFolder ?? catalog.rootFolder)],
        root_folder_id: catalog.rootFolder.id
      });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training catalog");
    }
  });

  router.get("/nodes", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const parentId = typeof req.query.parent_id === "string" ? req.query.parent_id.trim() : "";
      const nodes = await input.service.listNodes({
        viewer,
        parentId: parentId || undefined,
        locale: requestedLocale(req)
      });
      res.json({ nodes: nodes.map(nodeOut) });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training items");
    }
  });

  router.get("/folder-ancestor-paths", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const raw = typeof req.query.folder_ids === "string" ? req.query.folder_ids : "";
      const folderIds = Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))).slice(0, 500);
      const paths = await input.service.listFolderAncestorPaths({ viewer, folderIds });
      res.json({ paths });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training folder paths");
    }
  });

  router.get("/nodes/:nodeId", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const node = await input.service.getNode({
        viewer,
        nodeId: String(req.params.nodeId || "").trim(),
        locale: requestedLocale(req)
      });
      res.json({ node: nodeOut(node) });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training item");
    }
  });

  router.get("/folders/:folderId/tasks", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const result = await input.service.listFolderTasks({
        viewer,
        folderId: String(req.params.folderId || "").trim(),
        take: Number(req.query.take) || undefined,
        locale: requestedLocale(req)
      });
      res.json({
        tasks: result.tasks.map(taskOut),
        summary: {
          task_count: result.summary.taskCount,
          tasks_with_files: result.summary.tasksWithFiles,
          file_count: result.summary.fileCount
        }
      });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training tasks");
    }
  });

  router.get("/tasks/:threadId/files", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const files = await input.service.listThreadFiles({
        viewer,
        threadId: String(req.params.threadId || "").trim(),
        locale: requestedLocale(req)
      });
      res.json({ files: files.map(nodeOut) });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training task files");
    }
  });

  router.get("/threads", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const locale = requestedLocale(req);
      const threads = await input.service.listThreads(viewer, locale);
      res.json({ threads: threads.map(threadOut) });
      scheduleEnglishPrewarm(input.service, viewer, locale);
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training conversations");
    }
  });

  router.get("/threads/:threadId", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const locale = requestedLocale(req);
      const threadId = String(req.params.threadId || "").trim();
      const thread = (await input.service.listThreads(viewer, locale)).find((item) => item.id === threadId);
      if (!thread) {
        res.status(404).json({ detail: "培训会话不存在" });
        return;
      }
      res.json({ thread: threadOut(thread) });
      scheduleEnglishPrewarm(input.service, viewer, locale);
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training conversation");
    }
  });

  router.get("/threads/:threadId/messages", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const locale = requestedLocale(req);
      const repository = await input.service.listThreadMessages({
        viewer,
        threadId: String(req.params.threadId || "").trim(),
        locale,
        allowStaleTranslations: locale === "en"
      });
      res.json({
        head_id: repository.headId,
        messages: repository.messages.map((item) => ({
          parent_id: item.parentId,
          message: item.message,
          run_config: item.runConfig,
          created_at: item.createdAt,
          updated_at: item.updatedAt
        })),
        feedback: []
      });
      scheduleEnglishPrewarm(input.service, viewer, locale);
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training conversation messages");
    }
  });

  router.get("/search", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const result = await input.service.search({ viewer, query, locale: requestedLocale(req) });
      res.json({ nodes: result.nodes.map(nodeOut), tasks: result.tasks.map(taskOut) });
    } catch (error) {
      sendTrainingError(res, error, "Failed to search training catalog");
    }
  });

  router.get("/files/:fileId/content", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const versionId = typeof req.query.version_id === "string" ? req.query.version_id.trim() : "";
      const disposition = req.query.disposition === "attachment" ? "attachment" : "inline";
      const resolved = await input.service.getFile({
        viewer,
        fileId: String(req.params.fileId || "").trim(),
        versionId: versionId || undefined
      });
      if (
        disposition === "inline" &&
        await sendOfficePdfPreview(res, {
          requested: req.query.preview === "pdf",
          fileName: resolved.file.name,
          content: resolved.content,
          fingerprint: resolved.version.checksum
        })
      ) return;
      if (
        disposition === "inline" &&
        await sendStructuredPreview(res, {
          requested:
            typeof req.query.preview === "string" && req.query.preview !== "pdf"
              ? req.query.preview as "auto" | "text" | "table" | "diagram"
              : undefined,
          fileName: resolved.file.name,
          content: resolved.content,
          mimeType: resolved.version.mimeType || resolved.file.mimeType || "",
          query: req.query
        })
      ) return;
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Length", String(resolved.content.length));
      res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(resolved.file.name)}`);
      const registeredMimeType = resolved.version.mimeType || resolved.file.mimeType || "";
      res.type(
        registeredMimeType && registeredMimeType !== "application/octet-stream"
          ? registeredMimeType
          : path.extname(resolved.file.name) || await detectedContentType({ fileName: resolved.file.name, content: resolved.content })
      );
      res.status(200).send(resolved.content);
    } catch (error) {
      sendTrainingError(res, error, "Failed to read training file");
    }
  });

  router.get("/files/:fileId/versions", async (req, res) => {
    try {
      const viewer = await input.resolveViewer(req);
      const versions = await input.service.listFileVersions({
        viewer,
        fileId: String(req.params.fileId || "").trim()
      });
      res.json({ versions: versions.map(versionOut) });
    } catch (error) {
      sendTrainingError(res, error, "Failed to load training file versions");
    }
  });

  return router;
}
