import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, Dropdown, Empty, Pagination, Spin } from "antd";
import {
  CheckCircle2,
  ChevronRight,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload
} from "lucide-react";

import { api } from "../../../lib/api";
import { usePortalI18n } from "../i18n";
import {
  createPortalWorkspaceFolder,
  fetchPortalAgentOutputs,
  fetchPortalRecentWorkspace,
  fetchPortalWorkspaceTrash,
  PORTAL_WORKSPACE_DATA_SOURCE,
  searchPortalWorkspace,
  uploadPortalWorkspaceFile,
  type PortalWorkspaceNode,
  type PortalWorkspaceDataSource,
  type PortalWorkspaceFolderTaskSummary,
  type PortalWorkspaceTask
} from "../workspace";
import {
  AGENT_OUTPUTS_WORKSPACE_VIEW,
  RECENT_WORKSPACE_VIEW,
  TRASH_WORKSPACE_VIEW
} from "./WorkspaceRail";
import { CreateWorkspaceFolderModal } from "./CreateWorkspaceFolderModal";

function fileIconFor(node: PortalWorkspaceNode) {
  if (node.kind === "folder") return <Folder size={21} />;
  const name = node.name.toLowerCase();
  const mime = (node.mime_type || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return <FileImage size={21} />;
  if (/\.(xlsx?|csv|tsv)$/.test(name)) return <FileSpreadsheet size={21} />;
  if (/\.(zip|tar|gz|7z|rar)$/.test(name)) return <FileArchive size={21} />;
  if (mime.startsWith("text/") || /\.(md|txt|json|docx?|pdf)$/.test(name)) return <FileText size={21} />;
  return <File size={21} />;
}

function formatFileSize(value: number | null): string {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatLocalDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function WorkspaceFolderHome(props: {
  folderId: string;
  folderName: string;
  folderSystemKey?: string | null;
  folderPath?: PortalWorkspaceNode[];
  activeThreadId?: string;
  searchQuery?: string;
  rootFolders?: PortalWorkspaceNode[];
  onOpenFolder(folder: PortalWorkspaceNode): void;
  onOpenFile(file: PortalWorkspaceNode): void;
  onOpenTask(task: PortalWorkspaceTask): void;
  onNewTask(): void;
  onWorkspaceChanged?(): void;
  dataSource?: PortalWorkspaceDataSource;
  readOnly?: boolean;
}) {
  const { locale, t } = usePortalI18n();
  const [nodes, setNodes] = useState<PortalWorkspaceNode[]>([]);
  const [tasks, setTasks] = useState<PortalWorkspaceTask[]>([]);
  const [folderTaskSummary, setFolderTaskSummary] = useState<PortalWorkspaceFolderTaskSummary>({
    task_count: 0,
    tasks_with_files: 0,
    file_count: 0
  });
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showHistoryFiles, setShowHistoryFiles] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const [activeContentTab, setActiveContentTab] = useState<"tasks" | "files">("tasks");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentView = props.folderId === RECENT_WORKSPACE_VIEW;
  const agentOutputsView = props.folderId === AGENT_OUTPUTS_WORKSPACE_VIEW;
  const trashView = props.folderId === TRASH_WORKSPACE_VIEW;
  const searchQuery = String(props.searchQuery || "").trim();
  const searchView = Boolean(searchQuery);
  const historyView = props.folderSystemKey === "history_unfiled";
  const dataSource = props.dataSource ?? PORTAL_WORKSPACE_DATA_SOURCE;

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      if (searchView) {
        const result = props.readOnly ? await dataSource.search(searchQuery) : await searchPortalWorkspace(searchQuery);
        setNodes(result.nodes);
        setTasks(result.tasks);
        setFolderTaskSummary({
          task_count: result.tasks.length,
          tasks_with_files: result.tasks.filter((task) => task.file_count > 0).length,
          file_count: result.tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
        });
      } else if (trashView) {
        const result = await fetchPortalWorkspaceTrash();
        setNodes(result.nodes);
        setTasks(result.tasks);
        setFolderTaskSummary({
          task_count: result.tasks.length,
          tasks_with_files: result.tasks.filter((task) => task.file_count > 0).length,
          file_count: result.tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
        });
      } else if (agentOutputsView) {
        const result = await fetchPortalAgentOutputs();
        setNodes(result.nodes);
        setTasks(result.tasks);
        setFolderTaskSummary({
          task_count: result.tasks.length,
          tasks_with_files: result.tasks.filter((task) => task.file_count > 0).length,
          file_count: result.tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
        });
      } else if (recentView) {
        const recent = await fetchPortalRecentWorkspace();
        setNodes(recent.nodes);
        setTasks(recent.tasks);
        setFolderTaskSummary({
          task_count: recent.tasks.length,
          tasks_with_files: recent.tasks.filter((task) => task.file_count > 0).length,
          file_count: recent.tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
        });
      } else {
        const [nextNodes, taskResult] = await Promise.all([
          dataSource.fetchNodes(props.folderId, { includeMigrated: historyView && showHistoryFiles }),
          dataSource.fetchFolderTasks(props.folderId)
        ]);
        setNodes(nextNodes);
        setTasks(taskResult.tasks);
        setFolderTaskSummary(taskResult.summary);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentOutputsView, dataSource, historyView, props.folderId, props.readOnly, recentView, searchQuery, searchView, showHistoryFiles, t, trashView]);

  useEffect(() => {
    setTaskPage(1);
    setActiveContentTab("tasks");
  }, [props.folderId, searchQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = async (files: File[]) => {
    if (recentView || agentOutputsView || trashView || searchView || files.length === 0 || uploading) return;
    setUploading(true);
    setErrorText("");
    try {
      for (const file of files) {
        await uploadPortalWorkspaceFile({
          file,
          parentId: props.folderId,
          threadId: props.activeThreadId
        });
      }
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const createSubfolder = async (name: string) => {
    if (recentView || agentOutputsView || trashView || searchView) return;
    await createPortalWorkspaceFolder(name, props.folderId);
    await load();
    props.onWorkspaceChanged?.();
  };

  const renameNode = async (node: PortalWorkspaceNode) => {
    const name = window.prompt(t("workspace.renamePrompt"), node.name)?.trim();
    if (!name || name === node.name) return;
    try {
      await api(`/api/portal/workspace/nodes/${encodeURIComponent(node.id)}`, {
        method: "PATCH",
        json: { name }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.renameFailed"));
    }
  };

  const trashNode = async (node: PortalWorkspaceNode) => {
    if (!window.confirm(t("workspace.trashConfirm", { name: node.name }))) return;
    try {
      await api(`/api/portal/workspace/nodes/${encodeURIComponent(node.id)}`, { method: "DELETE" });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.trashFailed"));
    }
  };

  const restoreNode = async (node: PortalWorkspaceNode) => {
    try {
      await api(`/api/portal/workspace/nodes/${encodeURIComponent(node.id)}/restore`, { method: "POST" });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.restoreFailed"));
    }
  };

  const moveNode = async (node: PortalWorkspaceNode, parentId: string) => {
    try {
      await api(`/api/portal/workspace/nodes/${encodeURIComponent(node.id)}`, {
        method: "PATCH",
        json: { parent_id: parentId }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.moveFailed"));
    }
  };

  const moveTask = async (task: PortalWorkspaceTask, folderId: string) => {
    try {
      await api(`/api/portal/workspace/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        json: { folder_id: folderId }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.moveFailed"));
    }
  };

  const renameTask = async (task: PortalWorkspaceTask) => {
    const title = window.prompt(t("workspace.renamePrompt"), task.title)?.trim();
    if (!title || title === task.title) return;
    try {
      await api(`/api/threads/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        json: { title }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.renameFailed"));
    }
  };

  const archiveTask = async (task: PortalWorkspaceTask) => {
    try {
      await api(`/api/threads/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        json: { status: "archived" }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.archiveFailed"));
    }
  };

  const restoreTask = async (task: PortalWorkspaceTask) => {
    try {
      await api(`/api/threads/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        json: { status: "regular" }
      });
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.restoreFailed"));
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files || []));
  };

  const visibleNodes = useMemo(() => nodes.slice(0, 200), [nodes]);
  const taskPageSize = 20;
  const visibleTasks = useMemo(
    () => tasks.slice((taskPage - 1) * taskPageSize, taskPage * taskPageSize),
    [taskPage, tasks]
  );
  const latestUpdatedAt = useMemo(
    () =>
      [...nodes.map((node) => node.updated_at), ...tasks.map((task) => task.updated_at)]
        .filter(Boolean)
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0],
    [nodes, tasks]
  );
  const latestAgentOutput = useMemo(
    () => nodes.find((node) => node.kind === "file" && node.created_by_type === "agent"),
    [nodes]
  );
  const moveTargets = useMemo(
    () => (props.rootFolders || []).filter((folder) => folder.kind === "folder" && !folder.system_key),
    [props.rootFolders]
  );
  const sourceLabel = (node: PortalWorkspaceNode) =>
    node.created_by_type === "agent"
      ? t("workspace.createdByAgent")
      : node.created_by_type === "migration"
        ? t("workspace.fromHistory")
        : props.readOnly
          ? t("workspace.workspaceFile")
          : t("workspace.uploadedByMe");

  return (
    <main
      className={dragActive ? "workspace-folder-home is-dragging" : "workspace-folder-home"}
      onDragEnter={(event) => {
        if (props.readOnly || recentView || agentOutputsView || trashView || searchView) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (props.readOnly || recentView || agentOutputsView || trashView || searchView) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={props.readOnly ? undefined : handleDrop}
    >
      <header className="workspace-folder-head">
        <div>
          {!searchView && !recentView && !agentOutputsView && !trashView && (props.folderPath?.length || 0) > 1 ? (
            <nav className="workspace-folder-breadcrumb" aria-label={t("workspace.folderPath")}>
              {props.folderPath!.map((folder, index) => (
                <span key={folder.id}>
                  {index > 0 ? <ChevronRight size={13} /> : null}
                  <button
                    type="button"
                    aria-current={index === props.folderPath!.length - 1 ? "page" : undefined}
                    onClick={() => props.onOpenFolder(folder)}
                  >
                    {folder.system_key === "history_unfiled" ? t("workspace.historyTasks") : folder.name}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}
          {!historyView ? (
            <p className="workspace-folder-kicker">
              {searchView
                ? t("workspace.searchResults")
                : recentView
                  ? t("workspace.recent")
                  : agentOutputsView
                    ? t("workspace.agentOutputs")
                    : trashView
                      ? t("workspace.trash")
                      : t("workspace.folder")}
            </p>
          ) : null}
          <h1>{searchView ? t("workspace.searchFor", { query: searchQuery }) : props.folderName}</h1>
          <p>
            {searchView
              ? t("workspace.searchHelp")
              : recentView
                ? t("workspace.recentHelp")
                : agentOutputsView
                  ? t("workspace.agentOutputsHelp")
                  : trashView
                    ? t("workspace.trashHelp")
                    : historyView && !loading
                      ? t("workspace.historyTaskSummary", {
                          tasks: folderTaskSummary.task_count,
                          tasksWithFiles: folderTaskSummary.tasks_with_files,
                          files: folderTaskSummary.file_count
                        })
                    : loading
                      ? t("workspace.folderHelp")
                      : t("workspace.folderMeta", {
                          files: nodes.length,
                          tasks: tasks.length,
                          updated: latestUpdatedAt
                            ? formatLocalDate(latestUpdatedAt, locale)
                            : t("workspace.neverUpdated")
                        })}
          </p>
        </div>
        <div className="workspace-folder-actions">
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()} aria-label={t("common.refresh")} />
          {!props.readOnly && !recentView && !agentOutputsView && !trashView && !searchView ? (
            <>
              <Button type="primary" icon={<Plus size={16} />} onClick={props.onNewTask}>
                {t("workspace.newTask")}
              </Button>
              <Button icon={<Upload size={16} />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                {t("workspace.upload")}
              </Button>
              <Button icon={<FolderPlus size={16} />} onClick={() => setCreateFolderOpen(true)}>
                {t("workspace.newFolder")}
              </Button>
            </>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => void uploadFiles(Array.from(event.target.files || []))}
          />
        </div>
      </header>

      {errorText ? (
        <div className="workspace-inline-error" role="alert">
          <span>{errorText}</span>
          <Button size="small" onClick={() => void load()}>{t("common.retry")}</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="workspace-folder-loading"><Spin /><span>{t("common.loadingWorkspace")}</span></div>
      ) : (
        <>
          <div className="workspace-content-tabs" role="tablist" aria-label={t("workspace.folder")}>
            <button
              type="button"
              role="tab"
              id="workspace-tasks-tab"
              aria-selected={activeContentTab === "tasks"}
              aria-controls="workspace-tasks-panel"
              className={activeContentTab === "tasks" ? "is-active" : undefined}
              onClick={() => setActiveContentTab("tasks")}
            >
              <span>{t("workspace.tasks")}</span>
              <small>{tasks.length}</small>
            </button>
            <button
              type="button"
              role="tab"
              id="workspace-files-tab"
              aria-selected={activeContentTab === "files"}
              aria-controls="workspace-files-panel"
              className={activeContentTab === "files" ? "is-active" : undefined}
              onClick={() => setActiveContentTab("files")}
            >
              <span>{t("workspace.files")}</span>
              <small>{nodes.length}</small>
            </button>
          </div>

          {activeContentTab === "files" ? (
            <div
              id="workspace-files-panel"
              role="tabpanel"
              aria-labelledby="workspace-files-tab"
              className="workspace-tab-panel"
            >
              {historyView ? (
                <section className="workspace-history-files-summary" aria-label={t("workspace.historyFiles")}>
                  <div>
                    <FileArchive size={20} />
                    <span>
                      <strong>{t("workspace.historyFiles")}</strong>
                      <small>
                        {t("workspace.historyFilesRecovered", {
                          tasks: folderTaskSummary.tasks_with_files,
                          files: folderTaskSummary.file_count
                        })}
                      </small>
                    </span>
                  </div>
                  {folderTaskSummary.file_count > 0 ? (
                    <Button type="text" onClick={() => setShowHistoryFiles((value) => !value)}>
                      {showHistoryFiles ? t("workspace.hideHistoryFiles") : t("workspace.viewAllFiles")}
                    </Button>
                  ) : null}
                </section>
              ) : null}
              {!recentView && !agentOutputsView && !trashView && !searchView && latestAgentOutput ? (
                <button
                  type="button"
                  className="workspace-agent-status"
                  onClick={() => props.onOpenFile(latestAgentOutput)}
                >
                  <CheckCircle2 size={19} />
                  <span>{t("workspace.agentRecentlyUpdated", { name: latestAgentOutput.name })}</span>
                  <strong>{t("workspace.preview")}</strong>
                </button>
              ) : null}
              {!historyView || showHistoryFiles ? <section className="workspace-home-section">
                <div className="workspace-section-heading">
                  <div>
                    <h2>{t("workspace.filesAndFolders")}</h2>
                    <span>{t("workspace.itemCount", { count: nodes.length })}</span>
                  </div>
                  {!props.readOnly && !recentView && !agentOutputsView && !trashView && !searchView ? <span>{t("workspace.dropHint")}</span> : null}
                </div>
                {visibleNodes.length > 0 ? (
                  <div className="workspace-file-grid">
                    <div className="workspace-file-table-head" aria-hidden="true">
                      <span />
                      <span>{t("workspace.name")}</span>
                      <span>{t("workspace.modified")}</span>
                      <span>{t("workspace.source")}</span>
                      <span />
                    </div>
                    {visibleNodes.map((node) => (
                      <article
                        key={node.id}
                        className="workspace-file-card"
                        data-kind={node.kind}
                        tabIndex={0}
                        onDoubleClick={() =>
                          trashView
                            ? void restoreNode(node)
                            : node.kind === "folder"
                              ? props.onOpenFolder(node)
                              : props.onOpenFile(node)
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          if (trashView) {
                            void restoreNode(node);
                          } else {
                            node.kind === "folder" ? props.onOpenFolder(node) : props.onOpenFile(node);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="workspace-file-main"
                          onClick={() =>
                            trashView
                              ? void restoreNode(node)
                              : node.kind === "folder"
                                ? props.onOpenFolder(node)
                                : props.onOpenFile(node)
                          }
                        >
                          <span className="workspace-file-icon">{fileIconFor(node)}</span>
                          <span className="workspace-file-copy">
                            <strong title={node.name}>{node.name}</strong>
                            <small className="workspace-file-mobile-meta">
                              {node.kind === "folder"
                                ? t("workspace.folder")
                                : `${formatFileSize(node.size_bytes)} · ${formatLocalDate(node.updated_at, locale)} · ${sourceLabel(node)}`}
                            </small>
                          </span>
                          <small className="workspace-file-date">
                            {node.kind === "folder" ? "—" : formatLocalDate(node.updated_at, locale)}
                          </small>
                          <span className="workspace-file-source" data-source={node.created_by_type}>
                            {node.kind === "folder" ? "—" : sourceLabel(node)}
                          </span>
                        </button>
                        {!props.readOnly && !node.system_key ? (
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: trashView
                                ? [{ key: "restore", label: t("workspace.restore") }]
                                : [
                                    { key: "rename", label: t("workspace.rename") },
                                    ...(moveTargets.length > 0
                                      ? [{
                                          key: "move",
                                          label: t("workspace.moveTo"),
                                          children: moveTargets
                                            .filter((folder) => folder.id !== node.parent_id)
                                            .map((folder) => ({ key: `move:${folder.id}`, label: folder.name }))
                                        }]
                                      : []),
                                    { key: "trash", label: t("workspace.moveToTrash"), danger: true }
                                  ],
                              onClick: ({ key, domEvent }) => {
                                domEvent.stopPropagation();
                                if (key === "rename") void renameNode(node);
                                if (key === "trash") void trashNode(node);
                                if (key === "restore") void restoreNode(node);
                                if (key.startsWith("move:")) void moveNode(node, key.slice(5));
                              }
                            }}
                          >
                            <button type="button" className="workspace-card-menu" aria-label={t("workspace.moreActions")}>
                              <MoreHorizontal size={16} />
                            </button>
                          </Dropdown>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      searchView
                        ? t("workspace.searchEmpty")
                        : recentView
                        ? t("workspace.recentEmpty")
                        : agentOutputsView
                          ? t("workspace.agentOutputsEmpty")
                        : trashView
                          ? t("workspace.trashEmpty")
                          : t("workspace.folderEmpty")
                    }
                  >
                    {!props.readOnly && !recentView && !agentOutputsView && !trashView && !searchView ? (
                      <Button type="primary" icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                        {t("workspace.uploadFirstFile")}
                      </Button>
                    ) : null}
                  </Empty>
                )}
                {nodes.length > visibleNodes.length ? (
                  <p className="workspace-result-limit">{t("workspace.showingFirst", { count: visibleNodes.length })}</p>
                ) : null}
              </section> : null}
            </div>
          ) : null}

          {activeContentTab === "tasks" ? (
            <section
              id="workspace-tasks-panel"
              role="tabpanel"
              aria-labelledby="workspace-tasks-tab"
              className="workspace-home-section workspace-task-cards-section workspace-tab-panel"
            >
              <div className="workspace-section-heading">
                <div>
                  <h2>{t("workspace.tasks")}</h2>
                  <span>{t("workspace.taskCount", { count: tasks.length })}</span>
                </div>
                {!props.readOnly && !recentView && !agentOutputsView && !searchView ? (
                  <Button type="text" icon={<Plus size={16} />} onClick={props.onNewTask}>
                    {t("workspace.newTask")}
                  </Button>
                ) : null}
              </div>
              {visibleTasks.length > 0 ? (
                <div className="workspace-task-cards">
                  {visibleTasks.map((task) => (
                    <article key={task.id} className="workspace-task-card">
                      <button
                        type="button"
                        className="workspace-task-main"
                        onClick={() => trashView ? void restoreTask(task) : props.onOpenTask(task)}
                      >
                        <MessageSquare size={18} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{formatLocalDate(task.updated_at, locale)}</small>
                        </span>
                        <span className="workspace-task-file-count" data-empty={task.file_count > 0 ? undefined : "true"}>
                          {task.file_count > 0
                            ? t("workspace.filesCount", { count: task.file_count })
                          : t("workspace.pureConversation")}
                        </span>
                      </button>
                      {!props.readOnly ? <div className="workspace-task-actions">
                        {trashView ? (
                          <button
                            type="button"
                            className="workspace-task-action-btn"
                            aria-label={t("workspace.restore")}
                            title={t("workspace.restore")}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void restoreTask(task);
                            }}
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="workspace-task-action-btn"
                              aria-label={t("workspace.rename")}
                              title={t("workspace.rename")}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void renameTask(task);
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                            {moveTargets.length > 0 ? (
                              <Dropdown
                                trigger={["click"]}
                                menu={{
                                  items: moveTargets
                                    .filter((folder) => folder.id !== task.folder_id)
                                    .map((folder) => ({ key: `move:${folder.id}`, label: folder.name })),
                                  onClick: ({ key, domEvent }) => {
                                    domEvent.stopPropagation();
                                    if (key.startsWith("move:")) void moveTask(task, key.slice(5));
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className="workspace-task-action-btn"
                                  aria-label={t("workspace.moveTo")}
                                  title={t("workspace.moveTo")}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  <FolderInput size={15} />
                                </button>
                              </Dropdown>
                            ) : null}
                            <button
                              type="button"
                              className="workspace-task-action-btn is-danger"
                              aria-label={t("workspace.archiveTask")}
                              title={t("workspace.archiveTask")}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void archiveTask(task);
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="workspace-task-empty">
                  <MessageSquare size={22} />
                  <p>{t("workspace.taskEmpty")}</p>
                  {!props.readOnly && !recentView && !agentOutputsView && !searchView ? (
                    <Button onClick={props.onNewTask}>{t("workspace.newTask")}</Button>
                  ) : null}
                </div>
              )}
              {tasks.length > taskPageSize ? (
                <Pagination
                  className="workspace-task-pagination"
                  current={taskPage}
                  pageSize={taskPageSize}
                  total={tasks.length}
                  showSizeChanger={false}
                  hideOnSinglePage
                  onChange={setTaskPage}
                />
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {!props.readOnly && dragActive ? (
        <div className="workspace-drop-overlay">
          <Upload size={28} />
          <strong>{t("workspace.dropNow")}</strong>
        </div>
      ) : null}
      {!props.readOnly ? (
        <CreateWorkspaceFolderModal
          open={createFolderOpen}
          parentName={props.folderName}
          onCancel={() => setCreateFolderOpen(false)}
          onCreate={createSubfolder}
        />
      ) : null}
    </main>
  );
}
