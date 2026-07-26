import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, Dropdown, Empty, Spin } from "antd";
import {
  CheckCircle2,
  ChevronRight,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Upload
} from "lucide-react";

import { api } from "../../../lib/api";
import { usePortalI18n } from "../i18n";
import {
  createPortalWorkspaceFolder,
  fetchPortalAgentOutputs,
  fetchPortalFolderTasks,
  fetchPortalRecentWorkspace,
  fetchPortalWorkspaceNodes,
  fetchPortalWorkspaceTrash,
  searchPortalWorkspace,
  uploadPortalWorkspaceFile,
  type PortalWorkspaceNode,
  type PortalWorkspaceTask
} from "../workspace";
import {
  AGENT_OUTPUTS_WORKSPACE_VIEW,
  RECENT_WORKSPACE_VIEW,
  TRASH_WORKSPACE_VIEW
} from "./WorkspaceRail";

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
  folderPath?: PortalWorkspaceNode[];
  activeThreadId?: string;
  searchQuery?: string;
  rootFolders?: PortalWorkspaceNode[];
  onOpenFolder(folder: PortalWorkspaceNode): void;
  onOpenFile(file: PortalWorkspaceNode): void;
  onOpenTask(task: PortalWorkspaceTask): void;
  onNewTask(): void;
  onWorkspaceChanged?(): void;
}) {
  const { locale, t } = usePortalI18n();
  const [nodes, setNodes] = useState<PortalWorkspaceNode[]>([]);
  const [tasks, setTasks] = useState<PortalWorkspaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentView = props.folderId === RECENT_WORKSPACE_VIEW;
  const agentOutputsView = props.folderId === AGENT_OUTPUTS_WORKSPACE_VIEW;
  const trashView = props.folderId === TRASH_WORKSPACE_VIEW;
  const searchQuery = String(props.searchQuery || "").trim();
  const searchView = Boolean(searchQuery);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      if (searchView) {
        const result = await searchPortalWorkspace(searchQuery);
        setNodes(result.nodes);
        setTasks(result.tasks);
      } else if (trashView) {
        const result = await fetchPortalWorkspaceTrash();
        setNodes(result.nodes);
        setTasks(result.tasks);
      } else if (agentOutputsView) {
        const result = await fetchPortalAgentOutputs();
        setNodes(result.nodes);
        setTasks(result.tasks);
      } else if (recentView) {
        const recent = await fetchPortalRecentWorkspace();
        setNodes(recent.nodes);
        setTasks(recent.tasks);
      } else {
        const [nextNodes, nextTasks] = await Promise.all([
          fetchPortalWorkspaceNodes(props.folderId),
          fetchPortalFolderTasks(props.folderId)
        ]);
        setNodes(nextNodes);
        setTasks(nextTasks);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentOutputsView, props.folderId, recentView, searchQuery, searchView, t, trashView]);

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

  const createSubfolder = async () => {
    if (recentView || agentOutputsView || trashView || searchView) return;
    const name = window.prompt(t("workspace.folderNamePrompt"))?.trim();
    if (!name) return;
    try {
      await createPortalWorkspaceFolder(name, props.folderId);
      await load();
      props.onWorkspaceChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.createFolderFailed"));
    }
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
  const visibleTasks = useMemo(() => tasks.slice(0, 100), [tasks]);
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
        : t("workspace.uploadedByMe");

  return (
    <main
      className={dragActive ? "workspace-folder-home is-dragging" : "workspace-folder-home"}
      onDragEnter={(event) => {
        if (recentView || agentOutputsView || trashView || searchView) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (recentView || agentOutputsView || trashView || searchView) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={handleDrop}
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
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}
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
          {!recentView && !agentOutputsView && !trashView && !searchView ? (
            <>
              <Button type="primary" icon={<Plus size={16} />} onClick={props.onNewTask}>
                {t("workspace.newTask")}
              </Button>
              <Button icon={<Upload size={16} />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                {t("workspace.upload")}
              </Button>
              <Button icon={<FolderPlus size={16} />} onClick={() => void createSubfolder()}>
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
          <section className="workspace-home-section">
            <div className="workspace-section-heading">
              <div>
                <h2>{t("workspace.filesAndFolders")}</h2>
                <span>{t("workspace.itemCount", { count: nodes.length })}</span>
              </div>
              {!recentView && !agentOutputsView && !trashView && !searchView ? <span>{t("workspace.dropHint")}</span> : null}
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
                    {!node.system_key ? (
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
                {!recentView && !agentOutputsView && !trashView && !searchView ? (
                  <Button type="primary" icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                    {t("workspace.uploadFirstFile")}
                  </Button>
                ) : null}
              </Empty>
            )}
            {nodes.length > visibleNodes.length ? (
              <p className="workspace-result-limit">{t("workspace.showingFirst", { count: visibleNodes.length })}</p>
            ) : null}
          </section>

          <section className="workspace-home-section workspace-task-cards-section">
            <div className="workspace-section-heading">
              <div>
                <h2>{t("workspace.tasks")}</h2>
                <span>{t("workspace.taskCount", { count: tasks.length })}</span>
              </div>
              {!recentView && !agentOutputsView && !searchView ? (
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
                    </button>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: trashView
                          ? [{ key: "restore", label: t("workspace.restore") }]
                          : [
                              ...(moveTargets.length > 0
                                ? [{
                                    key: "move",
                                    label: t("workspace.moveTo"),
                                    children: moveTargets
                                      .filter((folder) => folder.id !== task.folder_id)
                                      .map((folder) => ({ key: `move:${folder.id}`, label: folder.name }))
                                  }]
                                : []),
                              { key: "archive", label: t("workspace.archiveTask") }
                            ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === "archive") void archiveTask(task);
                          if (key === "restore") void restoreTask(task);
                          if (key.startsWith("move:")) void moveTask(task, key.slice(5));
                        }
                      }}
                    >
                      <button type="button" className="workspace-card-menu" aria-label={t("workspace.moreTaskActions")}>
                        <MoreHorizontal size={16} />
                      </button>
                    </Dropdown>
                  </article>
                ))}
              </div>
            ) : (
              <div className="workspace-task-empty">
                <MessageSquare size={22} />
                <p>{t("workspace.taskEmpty")}</p>
                {!recentView && !agentOutputsView && !searchView ? (
                  <Button onClick={props.onNewTask}>{t("workspace.newTask")}</Button>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}

      {dragActive ? (
        <div className="workspace-drop-overlay">
          <Upload size={28} />
          <strong>{t("workspace.dropNow")}</strong>
        </div>
      ) : null}
    </main>
  );
}
