import express, { Router, type Request, type Response } from "express";
import path from "node:path";
import { z } from "zod";

import { sendOfficePdfPreview } from "../files/office-preview-service.js";
import { detectedContentType, sendStructuredPreview } from "../files/structured-preview-service.js";
import {
  PortalWorkspaceService,
  type WorkspaceActor,
  type WorkspaceFileVersionSummary,
  type WorkspaceNodeSummary,
  type WorkspaceTaskSummary
} from "./service.js";

const createFolderSchema = z.object({
  parent_id: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(255)
});

const patchNodeSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    parent_id: z.string().trim().min(1).nullable().optional()
  })
  .refine((value) => value.name !== undefined || value.parent_id !== undefined, {
    message: "name or parent_id is required"
  });

const moveTaskSchema = z.object({
  folder_id: z.string().trim().min(1)
});

const queryBoolean = (value: unknown): boolean =>
  typeof value === "string" && ["1", "true", "yes"].includes(value.trim().toLowerCase());

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

function workspaceErrorStatus(error: unknown): number {
  const detail = error instanceof Error ? error.message : "";
  if (/does not exist/i.test(detail)) return 404;
  if (/same name|already exists/i.test(detail)) return 409;
  if (/quota/i.test(detail)) return 413;
  return 400;
}

function sendWorkspaceError(res: Response, error: unknown, fallback: string): void {
  const detail = error instanceof Error ? error.message : fallback;
  res.status(workspaceErrorStatus(error)).json({ detail });
}

function decodeUploadHeader(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createPortalWorkspaceRouter(input: {
  service: PortalWorkspaceService;
  resolveActor(req: Request): Promise<WorkspaceActor>;
}): Router {
  const router = Router();
  const PORTAL_WORKSPACE_FILE_MAX_BYTES = 512 * 1024 * 1024;
  const uploadParser = express.raw({
    type: () => true,
    limit: PORTAL_WORKSPACE_FILE_MAX_BYTES
  });

  router.get("/", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const workspace = await input.service.ensureWorkspace(actor);
      const nodes = await input.service.listNodes({ actor });
      res.json({
        workspace: {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          quota_bytes: workspace.quotaBytes,
          used_bytes: workspace.usedBytes,
          history_folder_id: workspace.historyFolderId
        },
        nodes: nodes.map(nodeOut)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load workspace");
    }
  });

  router.get("/nodes", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const parentId = typeof req.query.parent_id === "string" ? req.query.parent_id.trim() : "";
      const state = req.query.state === "trashed" ? "trashed" : "active";
      const nodes = await input.service.listNodes({
        actor,
        parentId: parentId || undefined,
        state,
        allParents: state === "trashed" && queryBoolean(req.query.all),
        includeMigrated: queryBoolean(req.query.include_migrated)
      });
      res.json({ nodes: nodes.map(nodeOut) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load workspace items");
    }
  });

  router.get("/folder-ancestor-paths", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const rawFolderIds = typeof req.query.folder_ids === "string" ? req.query.folder_ids : "";
      const folderIds = Array.from(
        new Set(rawFolderIds.split(",").map((folderId) => folderId.trim()).filter(Boolean))
      );
      if (folderIds.length > 500) {
        res.status(400).json({ detail: "Too many folder ids" });
        return;
      }
      const paths = await input.service.listFolderAncestorPaths({ actor, folderIds });
      res.json({ paths });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load folder ancestor paths");
    }
  });

  router.get("/nodes/:nodeId", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const node = await input.service.getNode({
        actor,
        nodeId: String(req.params.nodeId || "").trim()
      });
      res.json({ node: nodeOut(node) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load workspace item");
    }
  });

  router.post("/folders", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const payload = createFolderSchema.parse(req.body || {});
      const folder = await input.service.createFolder({
        actor,
        parentId: payload.parent_id ?? undefined,
        name: payload.name
      });
      res.status(201).json({ node: nodeOut(folder) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to create folder");
    }
  });

  router.post("/files", uploadParser, async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const content = req.body;
      if (!Buffer.isBuffer(content) || content.length === 0) {
        res.status(400).json({ detail: "Upload payload is empty" });
        return;
      }
      const name = decodeUploadHeader(req.header("x-file-name"));
      const parentId = String(req.header("x-parent-id") || "").trim();
      const threadId = String(req.header("x-thread-id") || "").trim();
      const conflict = String(req.header("x-file-conflict") || "").trim() === "replace" ? "replace" : "keep_both";
      const saved = await input.service.saveFile({
        actor,
        parentId: parentId || undefined,
        name,
        content,
        mimeType: String(req.header("x-file-type") || "").trim() || undefined,
        conflict,
        createdByType: "user",
        threadId: threadId || undefined,
        role: threadId ? "input" : undefined
      });
      res.status(201).json({
        file: nodeOut(saved.file),
        version: versionOut(saved.version)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to upload workspace file");
    }
  });

  router.patch("/nodes/:nodeId", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const payload = patchNodeSchema.parse(req.body || {});
      const node = await input.service.renameOrMoveNode({
        actor,
        nodeId: String(req.params.nodeId || "").trim(),
        name: payload.name,
        parentId: payload.parent_id
      });
      res.json({ node: nodeOut(node) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to update workspace item");
    }
  });

  router.delete("/nodes/:nodeId", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const node = await input.service.trashNode({
        actor,
        nodeId: String(req.params.nodeId || "").trim()
      });
      res.json({ node: nodeOut(node) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to move workspace item to trash");
    }
  });

  router.post("/nodes/:nodeId/restore", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const node = await input.service.restoreNode({
        actor,
        nodeId: String(req.params.nodeId || "").trim()
      });
      res.json({ node: nodeOut(node) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to restore workspace item");
    }
  });

  router.get("/files/:fileId/content", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const versionId = typeof req.query.version_id === "string" ? req.query.version_id.trim() : "";
      const disposition = req.query.disposition === "attachment" ? "attachment" : "inline";
      const resolved = await input.service.getFile({
        actor,
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
      ) {
        return;
      }
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
      ) {
        return;
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Length", String(resolved.content.length));
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename*=UTF-8''${encodeURIComponent(resolved.file.name)}`
      );
      const registeredMimeType = resolved.version.mimeType || resolved.file.mimeType || "";
      res.type(
        registeredMimeType && registeredMimeType !== "application/octet-stream"
          ? registeredMimeType
          : path.extname(resolved.file.name) ||
            await detectedContentType({ fileName: resolved.file.name, content: resolved.content })
      );
      res.status(200).send(resolved.content);
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to read workspace file");
    }
  });

  router.get("/files/:fileId/versions", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const versions = await input.service.listVersions({
        actor,
        fileId: String(req.params.fileId || "").trim()
      });
      res.json({ versions: versions.map(versionOut) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load file versions");
    }
  });

  router.post("/files/:fileId/versions/:versionId/restore", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const threadId =
        typeof req.body?.thread_id === "string" && req.body.thread_id.trim() ? req.body.thread_id.trim() : undefined;
      const saved = await input.service.restoreVersion({
        actor,
        fileId: String(req.params.fileId || "").trim(),
        versionId: String(req.params.versionId || "").trim(),
        threadId
      });
      res.json({
        file: nodeOut(saved.file),
        version: versionOut(saved.version)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to restore file version");
    }
  });

  router.get("/folders/:folderId/tasks", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const folderId = String(req.params.folderId || "").trim();
      const includeArchived = queryBoolean(req.query.include_archived);
      const [tasks, summary] = await Promise.all([
        input.service.listFolderTasks({
          actor,
          folderId,
          includeArchived,
          take: Number(req.query.take) || undefined
        }),
        input.service.getFolderTaskSummary({
          actor,
          folderId,
          includeArchived
        })
      ]);
      res.json({
        tasks: tasks.map(taskOut),
        summary: {
          task_count: summary.taskCount,
          tasks_with_files: summary.tasksWithFiles,
          file_count: summary.fileCount
        }
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load folder tasks");
    }
  });

  router.patch("/tasks/:threadId", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const payload = moveTaskSchema.parse(req.body || {});
      const task = await input.service.moveThread({
        actor,
        threadId: String(req.params.threadId || "").trim(),
        folderId: payload.folder_id
      });
      res.json({ task: taskOut(task) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to move task");
    }
  });

  router.get("/tasks/:threadId/files", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const files = await input.service.listThreadFiles({
        actor,
        threadId: String(req.params.threadId || "").trim()
      });
      res.json({ files: files.map(nodeOut) });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load task files");
    }
  });

  router.get("/recent", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const recent = await input.service.recent({
        actor,
        take: Number(req.query.take) || undefined
      });
      res.json({
        nodes: recent.nodes.map(nodeOut),
        tasks: recent.tasks.map(taskOut)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load recent workspace items");
    }
  });

  router.get("/trash", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const take = Number(req.query.take);
      const result = await input.service.trash({
        actor,
        take: Number.isFinite(take) ? take : undefined
      });
      res.json({
        nodes: result.nodes.map(nodeOut),
        tasks: result.tasks.map(taskOut)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load workspace trash");
    }
  });

  router.get("/agent-outputs", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const take = Number(req.query.take);
      const result = await input.service.agentOutputs({
        actor,
        take: Number.isFinite(take) ? take : undefined
      });
      res.json({
        nodes: result.nodes.map(nodeOut),
        tasks: result.tasks.map(taskOut)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load agent outputs");
    }
  });

  router.get("/search", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const result = await input.service.search({ actor, query });
      res.json({
        nodes: result.nodes.map(nodeOut),
        tasks: result.tasks.map(taskOut)
      });
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to search workspace");
    }
  });

  router.get("/changesets/:changeSetId", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      res.json(
        await input.service.getChangeSet({
          actor,
          changeSetId: String(req.params.changeSetId || "").trim()
        })
      );
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to load workspace changes");
    }
  });

  router.post("/changesets/:changeSetId/revert", async (req, res) => {
    try {
      const actor = await input.resolveActor(req);
      res.json(
        await input.service.revertChangeSet({
          actor,
          changeSetId: String(req.params.changeSetId || "").trim()
        })
      );
    } catch (error) {
      sendWorkspaceError(res, error, "Failed to revert workspace changes");
    }
  });

  return router;
}
