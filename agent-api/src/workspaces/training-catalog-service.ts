import type { PrismaClient } from "@prisma/client";

import type { ThreadRecord } from "../persistence/thread-repository.js";
import {
  PortalWorkspaceService,
  type WorkspaceActor,
  type WorkspaceFileVersionSummary,
  type WorkspaceNodeSummary,
  type WorkspaceTaskSummary
} from "./service.js";
import { TrainingTranslationService, type TrainingTranslationLocale } from "./training-translation-service.js";

export type TrainingCatalogViewer = {
  userId: string;
  organizationId: string;
  organizationType: string;
};

export type TrainingCatalogSummary = {
  workspaceId: string;
  workspaceName: string;
  rootFolder: WorkspaceNodeSummary;
  sourceActor: WorkspaceActor;
  folderIds: Set<string>;
  nodeIds: Set<string>;
};

export type TrainingCatalogThread = {
  id: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
  model: string;
  reasoningEffort: string;
  workspaceId?: string;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingCatalogConfiguration = {
  enabled: boolean;
  sourceEmail: string;
  rootFolderName: string;
  updatedAt?: string;
};

export type TrainingCatalogConfigurationStatus = TrainingCatalogConfiguration & {
  validationStatus: "valid" | "invalid" | "disabled";
  validationMessage: string;
  folderCount: number;
  threadCount: number;
};

export type TrainingCatalogRootFolderOption = {
  id: string;
  name: string;
  workspaceId: string;
};

export type TrainingEnglishPrewarmStatus = {
  status: "idle" | "running" | "completed" | "failed";
  totalThreads: number;
  completedThreads: number;
  totalMessages: number;
  completedMessages: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export class TrainingCatalogAccessError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TrainingCatalogAccessError";
  }
}

export class TrainingCatalogService {
  private readonly englishPrewarmByOrganization = new Map<string, TrainingEnglishPrewarmStatus>();

  private static readonly ENGLISH_PREWARM_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  constructor(
    private readonly db: PrismaClient,
    private readonly workspaces: PortalWorkspaceService,
    private readonly config: { sourceEmail: string; rootFolderName: string },
    private readonly translations?: TrainingTranslationService
  ) {}

  private async localizeNodes(
    viewer: TrainingCatalogViewer,
    nodes: WorkspaceNodeSummary[],
    locale?: TrainingTranslationLocale
  ): Promise<WorkspaceNodeSummary[]> {
    if (locale !== "en" || !this.translations) return nodes;
    const [folderNames, fileNames] = await Promise.all([
      this.translations.localizeStrings({
        organizationId: viewer.organizationId,
        requestedByUserId: viewer.userId,
        sourceType: "workspace_node_name",
        entries: nodes.filter((node) => node.kind === "folder").map((node) => ({ sourceId: node.id, value: node.name }))
      }),
      this.translations.localizeStrings({
        organizationId: viewer.organizationId,
        requestedByUserId: viewer.userId,
        sourceType: "workspace_file_display_name",
        purpose: "filename",
        entries: nodes.filter((node) => node.kind === "file").map((node) => ({ sourceId: node.id, value: node.name }))
      })
    ]);
    return nodes.map((node) => ({
      ...node,
      name: (node.kind === "folder" ? folderNames : fileNames).get(node.id) ?? node.name
    }));
  }

  private async localizeTasks(
    viewer: TrainingCatalogViewer,
    tasks: WorkspaceTaskSummary[],
    locale?: TrainingTranslationLocale
  ): Promise<WorkspaceTaskSummary[]> {
    if (locale !== "en" || !this.translations) return tasks;
    const titles = await this.translations.localizeStrings({
      organizationId: viewer.organizationId,
      requestedByUserId: viewer.userId,
      sourceType: "thread_title",
      entries: tasks.map((task) => ({ sourceId: task.id, value: task.title }))
    });
    return tasks.map((task) => ({ ...task, title: titles.get(task.id) ?? task.title }));
  }

  async getCatalog(viewer: TrainingCatalogViewer): Promise<TrainingCatalogSummary> {
    this.assertInternalViewer(viewer);
    const configuration = await this.resolveConfiguration(viewer.organizationId);
    if (!configuration.enabled) {
      throw new TrainingCatalogAccessError("培训案例尚未启用", 404);
    }
    return this.resolveCatalog(viewer, configuration);
  }

  async getConfigurationStatus(viewer: TrainingCatalogViewer): Promise<TrainingCatalogConfigurationStatus> {
    this.assertInternalViewer(viewer);
    const configuration = await this.resolveConfiguration(viewer.organizationId);
    if (!configuration.enabled) {
      return {
        ...configuration,
        validationStatus: "disabled",
        validationMessage: "培训案例当前未启用",
        folderCount: 0,
        threadCount: 0
      };
    }
    try {
      const catalog = await this.resolveCatalog(viewer, configuration);
      const threadCount = await this.db.thread.count({
        where: {
          organizationId: viewer.organizationId,
          userId: catalog.sourceActor.userId,
          userWorkspaceId: catalog.workspaceId,
          workspaceFolderId: { in: Array.from(catalog.folderIds) },
          status: "active"
        }
      });
      return {
        ...configuration,
        validationStatus: "valid",
        validationMessage: "配置有效，内容会从来源工作区实时同步",
        folderCount: Math.max(0, catalog.folderIds.size - 1),
        threadCount
      };
    } catch (error) {
      return {
        ...configuration,
        validationStatus: "invalid",
        validationMessage: error instanceof Error ? error.message : "培训案例配置无效",
        folderCount: 0,
        threadCount: 0
      };
    }
  }

  async saveConfiguration(input: {
    viewer: TrainingCatalogViewer;
    actorUserId: string;
    enabled: boolean;
    sourceEmail: string;
    rootFolderName: string;
  }): Promise<TrainingCatalogConfigurationStatus> {
    this.assertInternalViewer(input.viewer);
    const configuration: TrainingCatalogConfiguration = {
      enabled: input.enabled,
      sourceEmail: input.sourceEmail.trim(),
      rootFolderName: input.rootFolderName.trim()
    };
    if (!configuration.sourceEmail || !configuration.rootFolderName) {
      throw new TrainingCatalogAccessError("来源账号和根目录不能为空", 400);
    }
    if (configuration.enabled) {
      await this.resolveCatalog(input.viewer, configuration);
    }
    await this.db.portalTrainingConfiguration.upsert({
      where: { organizationId: input.viewer.organizationId },
      create: {
        organizationId: input.viewer.organizationId,
        enabled: configuration.enabled,
        sourceEmail: configuration.sourceEmail,
        rootFolderName: configuration.rootFolderName,
        updatedByUserId: input.actorUserId
      },
      update: {
        enabled: configuration.enabled,
        sourceEmail: configuration.sourceEmail,
        rootFolderName: configuration.rootFolderName,
        updatedByUserId: input.actorUserId
      }
    });
    return this.getConfigurationStatus(input.viewer);
  }

  async listRootFolderOptions(input: {
    viewer: TrainingCatalogViewer;
    sourceEmail: string;
  }): Promise<TrainingCatalogRootFolderOption[]> {
    this.assertInternalViewer(input.viewer);
    const sourceEmail = input.sourceEmail.trim();
    if (!sourceEmail) return [];
    const sourceUser = await this.db.user.findFirst({
      where: {
        email: { equals: sourceEmail, mode: "insensitive" },
        status: "active",
        organizationMemberships: {
          some: { organizationId: input.viewer.organizationId, status: "active" }
        }
      },
      select: { id: true }
    });
    if (!sourceUser) return [];
    const workspace = await this.db.userWorkspace.findFirst({
      where: {
        organizationId: input.viewer.organizationId,
        ownerUserId: sourceUser.id,
        status: "active"
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    if (!workspace) return [];
    const folders = await this.db.workspaceNode.findMany({
      where: {
        workspaceId: workspace.id,
        parentId: null,
        kind: "folder",
        state: "active"
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    });
    return folders.map((folder) => ({ ...folder, workspaceId: workspace.id }));
  }

  private async resolveConfiguration(organizationId: string): Promise<TrainingCatalogConfiguration> {
    const stored = await this.db.portalTrainingConfiguration.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        sourceEmail: true,
        rootFolderName: true,
        updatedAt: true
      }
    });
    if (stored) {
      return {
        enabled: stored.enabled,
        sourceEmail: stored.sourceEmail,
        rootFolderName: stored.rootFolderName,
        updatedAt: toIso(stored.updatedAt)
      };
    }
    return {
      enabled: true,
      sourceEmail: this.config.sourceEmail.trim(),
      rootFolderName: this.config.rootFolderName.trim()
    };
  }

  private async resolveCatalog(
    viewer: TrainingCatalogViewer,
    configuration: TrainingCatalogConfiguration
  ): Promise<TrainingCatalogSummary> {
    const sourceEmail = configuration.sourceEmail.trim();
    const rootFolderName = configuration.rootFolderName.trim();
    if (!sourceEmail || !rootFolderName) {
      throw new TrainingCatalogAccessError("培训案例尚未配置", 404);
    }

    const sourceUser = await this.db.user.findFirst({
      where: {
        email: { equals: sourceEmail, mode: "insensitive" },
        status: "active",
        organizationMemberships: {
          some: {
            organizationId: viewer.organizationId,
            status: "active"
          }
        }
      },
      select: { id: true }
    });
    if (!sourceUser) {
      throw new TrainingCatalogAccessError("培训案例尚未发布", 404);
    }

    const workspace = await this.db.userWorkspace.findFirst({
      where: {
        organizationId: viewer.organizationId,
        ownerUserId: sourceUser.id,
        status: "active",
        nodes: {
          some: {
            parentId: null,
            kind: "folder",
            name: rootFolderName,
            state: "active"
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        securityDomainId: true
      }
    });
    if (!workspace) {
      throw new TrainingCatalogAccessError("培训案例尚未发布", 404);
    }

    const rootFolder = await this.db.workspaceNode.findFirst({
      where: {
        workspaceId: workspace.id,
        parentId: null,
        kind: "folder",
        name: rootFolderName,
        state: "active"
      }
    });
    if (!rootFolder) {
      throw new TrainingCatalogAccessError("培训案例根目录不存在", 404);
    }

    const allNodes = await this.db.workspaceNode.findMany({
      where: { workspaceId: workspace.id, state: "active" },
      select: { id: true, parentId: true, kind: true }
    });
    const childrenByParentId = new Map<string, Array<{ id: string; kind: string }>>();
    for (const node of allNodes) {
      if (!node.parentId) continue;
      const children = childrenByParentId.get(node.parentId) ?? [];
      children.push({ id: node.id, kind: node.kind });
      childrenByParentId.set(node.parentId, children);
    }
    const nodeIds = new Set<string>([rootFolder.id]);
    const folderIds = new Set<string>([rootFolder.id]);
    const queue = [rootFolder.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of childrenByParentId.get(parentId) ?? []) {
        if (nodeIds.has(child.id)) continue;
        nodeIds.add(child.id);
        if (child.kind === "folder") {
          folderIds.add(child.id);
          queue.push(child.id);
        }
      }
    }

    const sourceActor: WorkspaceActor = {
      userId: sourceUser.id,
      organizationId: viewer.organizationId,
      securityDomainId: workspace.securityDomainId ?? undefined
    };
    const rootSummary = await this.workspaces.getNode({ actor: sourceActor, nodeId: rootFolder.id });
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      rootFolder: rootSummary,
      sourceActor,
      folderIds,
      nodeIds
    };
  }

  async listNodes(input: {
    viewer: TrainingCatalogViewer;
    parentId?: string;
    locale?: TrainingTranslationLocale;
  }): Promise<WorkspaceNodeSummary[]> {
    const catalog = await this.getCatalog(input.viewer);
    if (!input.parentId) return this.localizeNodes(input.viewer, [catalog.rootFolder], input.locale);
    this.assertFolderInCatalog(catalog, input.parentId);
    const nodes = await this.workspaces.listNodes({ actor: catalog.sourceActor, parentId: input.parentId });
    return this.localizeNodes(input.viewer, nodes, input.locale);
  }

  async getNode(input: {
    viewer: TrainingCatalogViewer;
    nodeId: string;
    locale?: TrainingTranslationLocale;
  }): Promise<WorkspaceNodeSummary> {
    const catalog = await this.getCatalog(input.viewer);
    this.assertNodeInCatalog(catalog, input.nodeId);
    const node = await this.workspaces.getNode({ actor: catalog.sourceActor, nodeId: input.nodeId });
    return (await this.localizeNodes(input.viewer, [node], input.locale))[0];
  }

  async listFolderAncestorPaths(input: {
    viewer: TrainingCatalogViewer;
    folderIds: readonly string[];
  }): Promise<Record<string, string[]>> {
    const catalog = await this.getCatalog(input.viewer);
    const allowed = input.folderIds.filter((folderId) => catalog.folderIds.has(folderId));
    const paths = await this.workspaces.listFolderAncestorPaths({ actor: catalog.sourceActor, folderIds: allowed });
    const trimmed: Record<string, string[]> = {};
    for (const [folderId, path] of Object.entries(paths)) {
      const rootIndex = path.indexOf(catalog.rootFolder.id);
      trimmed[folderId] = rootIndex >= 0 ? path.slice(0, rootIndex + 1) : [];
    }
    return trimmed;
  }

  async listFolderTasks(input: {
    viewer: TrainingCatalogViewer;
    folderId: string;
    take?: number;
    locale?: TrainingTranslationLocale;
  }): Promise<{ tasks: WorkspaceTaskSummary[]; summary: { taskCount: number; tasksWithFiles: number; fileCount: number } }> {
    const catalog = await this.getCatalog(input.viewer);
    this.assertFolderInCatalog(catalog, input.folderId);
    const [tasks, summary] = await Promise.all([
      this.workspaces.listFolderTasks({
        actor: catalog.sourceActor,
        folderId: input.folderId,
        take: input.take
      }),
      this.workspaces.getFolderTaskSummary({ actor: catalog.sourceActor, folderId: input.folderId })
    ]);
    return { tasks: await this.localizeTasks(input.viewer, tasks, input.locale), summary };
  }

  async listThreads(viewer: TrainingCatalogViewer, locale?: TrainingTranslationLocale): Promise<TrainingCatalogThread[]> {
    const catalog = await this.getCatalog(viewer);
    const rows = await this.db.thread.findMany({
      where: {
        organizationId: viewer.organizationId,
        userId: catalog.sourceActor.userId,
        userWorkspaceId: catalog.workspaceId,
        workspaceFolderId: { in: Array.from(catalog.folderIds) },
        status: "active"
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        title: true,
        externalId: true,
        model: true,
        reasoningEffort: true,
        userWorkspaceId: true,
        workspaceFolderId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const threads: TrainingCatalogThread[] = rows.map((row) => ({
      id: row.id,
      status: row.status === "archived" ? "archived" : "regular",
      title: row.title ?? undefined,
      externalId: row.externalId ?? undefined,
      model: row.model ?? "",
      reasoningEffort: row.reasoningEffort ?? "high",
      workspaceId: row.userWorkspaceId ?? undefined,
      folderId: row.workspaceFolderId ?? undefined,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt)
    }));
    if (locale !== "en" || !this.translations) return threads;
    const titles = await this.translations.localizeStrings({
      organizationId: viewer.organizationId,
      requestedByUserId: viewer.userId,
      sourceType: "thread_title",
      entries: threads
        .filter((thread) => thread.title)
        .map((thread) => ({ sourceId: thread.id, value: thread.title! }))
    });
    return threads.map((thread) => ({ ...thread, title: titles.get(thread.id) ?? thread.title }));
  }

  async listThreadMessages(input: {
    viewer: TrainingCatalogViewer;
    threadId: string;
    locale?: TrainingTranslationLocale;
    allowStaleTranslations?: boolean;
  }): Promise<{ headId: string | null; messages: Array<{
    parentId: string | null;
    message: unknown;
    runConfig?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }> }> {
    const thread = await this.getThread(input);
    if (!thread) throw new TrainingCatalogAccessError("培训会话不存在", 404);
    const rows = await this.db.message.findMany({
      where: { threadId: input.threadId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        parentId: true,
        content: true,
        runConfig: true,
        createdAt: true,
        updatedAt: true
      }
    });
    let localized = new Map<string, unknown>();
    if (input.locale === "en" && this.translations) {
      localized = await this.translations.localizeMessages({
        organizationId: input.viewer.organizationId,
        requestedByUserId: input.viewer.userId,
        entries: rows.map((row) => ({ sourceId: row.id, value: row.content })),
        allowStale: input.allowStaleTranslations
      });
    }
    return {
      headId: thread.headId ?? null,
      messages: rows.map((row) => ({
        parentId: row.parentId,
        message: localized.get(row.id) ?? row.content,
        runConfig:
          row.runConfig && typeof row.runConfig === "object" && !Array.isArray(row.runConfig)
            ? row.runConfig as Record<string, unknown>
            : undefined,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt)
      }))
    };
  }

  async getThread(input: {
    viewer: TrainingCatalogViewer;
    threadId: string;
  }): Promise<ThreadRecord | undefined> {
    const catalog = await this.getCatalog(input.viewer);
    const row = await this.db.thread.findFirst({
      where: {
        id: input.threadId,
        organizationId: input.viewer.organizationId,
        userId: catalog.sourceActor.userId,
        userWorkspaceId: catalog.workspaceId,
        workspaceFolderId: { in: Array.from(catalog.folderIds) },
        status: "active"
      }
    });
    if (!row) return undefined;
    return {
      id: row.id,
      organizationId: row.organizationId ?? undefined,
      userId: row.userId ?? undefined,
      securityDomainId: row.securityDomainId ?? undefined,
      userWorkspaceId: row.userWorkspaceId ?? undefined,
      workspaceFolderId: row.workspaceFolderId ?? undefined,
      channel: row.channel ?? undefined,
      externalId: row.externalId ?? undefined,
      status: row.status === "archived" ? "archived" : "regular",
      title: row.title ?? undefined,
      model: row.model ?? "",
      reasoningEffort: (row.reasoningEffort ?? "high") as ThreadRecord["reasoningEffort"],
      workspace: row.workspace ?? "",
      codexRunConfig:
        row.codexRunConfig && typeof row.codexRunConfig === "object" && !Array.isArray(row.codexRunConfig)
          ? row.codexRunConfig as Record<string, unknown>
          : undefined,
      codexThreadId: row.codexThreadId ?? undefined,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      headId: row.headId,
      messages: [],
      feedback: []
    };
  }

  async listThreadFiles(input: {
    viewer: TrainingCatalogViewer;
    threadId: string;
    locale?: TrainingTranslationLocale;
  }): Promise<WorkspaceNodeSummary[]> {
    const catalog = await this.getCatalog(input.viewer);
    const thread = await this.getThread(input);
    if (!thread) throw new TrainingCatalogAccessError("培训会话不存在", 404);
    const files = await this.workspaces.listThreadFiles({ actor: catalog.sourceActor, threadId: input.threadId });
    return this.localizeNodes(input.viewer, files, input.locale);
  }

  getEnglishPrewarmStatus(viewer: TrainingCatalogViewer): TrainingEnglishPrewarmStatus {
    this.assertInternalViewer(viewer);
    return this.englishPrewarmByOrganization.get(viewer.organizationId) ?? {
      status: "idle",
      totalThreads: 0,
      completedThreads: 0,
      totalMessages: 0,
      completedMessages: 0
    };
  }

  async startEnglishPrewarm(viewer: TrainingCatalogViewer): Promise<TrainingEnglishPrewarmStatus> {
    this.assertInternalViewer(viewer);
    const current = this.getEnglishPrewarmStatus(viewer);
    if (current.status === "running") return current;
    const status: TrainingEnglishPrewarmStatus = {
      status: "running",
      totalThreads: 0,
      completedThreads: 0,
      totalMessages: 0,
      completedMessages: 0,
      startedAt: new Date().toISOString()
    };
    this.englishPrewarmByOrganization.set(viewer.organizationId, status);
    void this.runEnglishPrewarm(viewer, status);
    return status;
  }

  async ensureEnglishPrewarm(viewer: TrainingCatalogViewer): Promise<TrainingEnglishPrewarmStatus> {
    const current = this.getEnglishPrewarmStatus(viewer);
    if (current.status === "running") return current;
    const completedAt = current.completedAt ? Date.parse(current.completedAt) : Number.NaN;
    if (
      current.status === "completed"
      && Number.isFinite(completedAt)
      && Date.now() - completedAt < TrainingCatalogService.ENGLISH_PREWARM_REFRESH_INTERVAL_MS
    ) {
      return current;
    }
    return this.startEnglishPrewarm(viewer);
  }

  private async runEnglishPrewarm(
    viewer: TrainingCatalogViewer,
    status: TrainingEnglishPrewarmStatus
  ): Promise<void> {
    try {
      const catalog = await this.getCatalog(viewer);
      const [nodeRows, threads] = await Promise.all([
        this.db.workspaceNode.findMany({
          where: { workspaceId: catalog.workspaceId, id: { in: Array.from(catalog.nodeIds) }, state: "active" },
          select: { id: true }
        }),
        this.listThreads(viewer, "en")
      ]);
      const nodes = await Promise.all(nodeRows.map((node) =>
        this.workspaces.getNode({ actor: catalog.sourceActor, nodeId: node.id })
      ));
      await this.localizeNodes(viewer, nodes, "en");
      status.totalThreads = threads.length;
      status.totalMessages = await this.db.message.count({ where: { threadId: { in: threads.map((thread) => thread.id) } } });
      let nextThreadIndex = 0;
      const workerCount = Math.min(4, threads.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextThreadIndex < threads.length) {
          const thread = threads[nextThreadIndex];
          nextThreadIndex += 1;
          const repository = await this.listThreadMessages({ viewer, threadId: thread.id, locale: "en" });
          status.completedThreads += 1;
          status.completedMessages += repository.messages.length;
        }
      }));
      status.status = "completed";
      status.completedAt = new Date().toISOString();
    } catch (error) {
      status.status = "failed";
      status.error = error instanceof Error ? error.message : "英文缓存生成失败";
      status.completedAt = new Date().toISOString();
    }
  }

  async getFile(input: {
    viewer: TrainingCatalogViewer;
    fileId: string;
    versionId?: string;
  }): Promise<{ file: WorkspaceNodeSummary; version: WorkspaceFileVersionSummary; content: Buffer }> {
    const catalog = await this.getCatalog(input.viewer);
    this.assertNodeInCatalog(catalog, input.fileId);
    return this.workspaces.getFile({ actor: catalog.sourceActor, fileId: input.fileId, versionId: input.versionId });
  }

  async listFileVersions(input: {
    viewer: TrainingCatalogViewer;
    fileId: string;
  }): Promise<WorkspaceFileVersionSummary[]> {
    const catalog = await this.getCatalog(input.viewer);
    this.assertNodeInCatalog(catalog, input.fileId);
    return this.workspaces.listVersions({ actor: catalog.sourceActor, fileId: input.fileId });
  }

  async search(input: {
    viewer: TrainingCatalogViewer;
    query: string;
    locale?: TrainingTranslationLocale;
  }): Promise<{ nodes: WorkspaceNodeSummary[]; tasks: WorkspaceTaskSummary[] }> {
    const catalog = await this.getCatalog(input.viewer);
    const query = input.query.trim().toLocaleLowerCase(input.locale === "en" ? "en-US" : "zh-Hans-CN");
    if (!query) return { nodes: [], tasks: [] };
    if (input.locale === "en" && this.translations) {
      const [nodeRows, threadRows] = await Promise.all([
        this.db.workspaceNode.findMany({
          where: {
            workspaceId: catalog.workspaceId,
            id: { in: Array.from(catalog.nodeIds) },
            state: "active"
          },
          take: 500,
          select: { id: true }
        }),
        this.db.thread.findMany({
          where: {
            organizationId: input.viewer.organizationId,
            userId: catalog.sourceActor.userId,
            userWorkspaceId: catalog.workspaceId,
            workspaceFolderId: { in: Array.from(catalog.folderIds) },
            status: "active"
          },
          orderBy: { updatedAt: "desc" },
          take: 500,
          select: {
            id: true,
            title: true,
            status: true,
            workspaceFolderId: true,
            workspaceFileBindings: { select: { fileId: true } },
            createdAt: true,
            updatedAt: true
          }
        })
      ]);
      const allNodes = await Promise.all(
        nodeRows.map((node) => this.workspaces.getNode({ actor: catalog.sourceActor, nodeId: node.id }))
      );
      const allTasks: WorkspaceTaskSummary[] = threadRows.map((thread) => ({
        id: thread.id,
        title: thread.title?.trim() || "New conversation",
        status: thread.status === "archived" ? "archived" : "regular",
        folderId: thread.workspaceFolderId ?? undefined,
        fileCount: new Set(thread.workspaceFileBindings.map((binding) => binding.fileId)).size,
        createdAt: toIso(thread.createdAt),
        updatedAt: toIso(thread.updatedAt)
      }));
      const [localizedNodes, localizedTasks] = await Promise.all([
        this.localizeNodes(input.viewer, allNodes, "en"),
        this.localizeTasks(input.viewer, allTasks, "en")
      ]);
      return {
        nodes: localizedNodes.filter((node) => node.name.toLocaleLowerCase("en-US").includes(query)).slice(0, 200),
        tasks: localizedTasks.filter((task) => task.title.toLocaleLowerCase("en-US").includes(query)).slice(0, 200)
      };
    }
    const nodes = await this.db.workspaceNode.findMany({
      where: {
        workspaceId: catalog.workspaceId,
        id: { in: Array.from(catalog.nodeIds) },
        state: "active",
        name: { contains: input.query.trim(), mode: "insensitive" }
      },
      take: 200,
      select: { id: true }
    });
    const nodeResults = await Promise.all(
      nodes.map((node) => this.workspaces.getNode({ actor: catalog.sourceActor, nodeId: node.id }))
    );
    const threadRows = await this.db.thread.findMany({
      where: {
        organizationId: input.viewer.organizationId,
        userId: catalog.sourceActor.userId,
        userWorkspaceId: catalog.workspaceId,
        workspaceFolderId: { in: Array.from(catalog.folderIds) },
        status: "active",
        title: { contains: query, mode: "insensitive" }
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        status: true,
        workspaceFolderId: true,
        workspaceFileBindings: { select: { fileId: true } },
        createdAt: true,
        updatedAt: true
      }
    });
    return {
      nodes: nodeResults,
      tasks: threadRows.map((thread) => ({
        id: thread.id,
        title: thread.title?.trim() || "New conversation",
        status: thread.status === "archived" ? "archived" : "regular",
        folderId: thread.workspaceFolderId ?? undefined,
        fileCount: new Set(thread.workspaceFileBindings.map((binding) => binding.fileId)).size,
        createdAt: toIso(thread.createdAt),
        updatedAt: toIso(thread.updatedAt)
      }))
    };
  }

  private assertInternalViewer(viewer: TrainingCatalogViewer): void {
    if (viewer.organizationType !== "internal") {
      throw new TrainingCatalogAccessError("培训案例仅对内部员工开放", 403);
    }
  }

  private assertFolderInCatalog(catalog: TrainingCatalogSummary, folderId: string): void {
    if (!catalog.folderIds.has(folderId)) {
      throw new TrainingCatalogAccessError("培训目录不存在", 404);
    }
  }

  private assertNodeInCatalog(catalog: TrainingCatalogSummary, nodeId: string): void {
    if (!catalog.nodeIds.has(nodeId)) {
      throw new TrainingCatalogAccessError("培训文件不存在", 404);
    }
  }
}
