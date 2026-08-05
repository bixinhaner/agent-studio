import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { Input } from "antd";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Search,
  Trash2
} from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  PORTAL_WORKSPACE_DATA_SOURCE,
  type PortalWorkspaceDataSource,
  type PortalWorkspaceNode,
  type PortalWorkspaceSummary
} from "../workspace";

export const RECENT_WORKSPACE_VIEW = "__recent__";
export const AGENT_OUTPUTS_WORKSPACE_VIEW = "__agent_outputs__";
export const TRASH_WORKSPACE_VIEW = "__trash__";
export const WORKSPACE_RAIL_TASK_LIMIT = 5;

export function WorkspaceRail(props: {
  workspace: PortalWorkspaceSummary | null;
  rootNodes: PortalWorkspaceNode[];
  selectedFolderPath?: PortalWorkspaceNode[];
  selectedFolderId: string;
  searchValue: string;
  runningFolderIds?: ReadonlySet<string>;
  unreadFolderIds?: ReadonlySet<string>;
  loading?: boolean;
  errorText?: string;
  taskList?: ReactNode;
  taskCount?: number;
  footer?: ReactNode;
  refreshKey?: number;
  onSearchChange(value: string): void;
  onSelectFolder(folderId: string): void;
  onCreateFolder(): void;
  onNewTask(): void;
  onViewAllTasks(): void;
  dataSource?: PortalWorkspaceDataSource;
  readOnly?: boolean;
  title?: string;
}) {
  const { t } = usePortalI18n();
  const folders = props.rootNodes.filter((node) => node.kind === "folder");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [childrenByFolderId, setChildrenByFolderId] = useState<Record<string, PortalWorkspaceNode[]>>({});
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<string>>(new Set());

  const loadChildren = useCallback(async (folderId: string) => {
    setLoadingFolderIds((current) => new Set(current).add(folderId));
    try {
      const children = await (props.dataSource ?? PORTAL_WORKSPACE_DATA_SOURCE).fetchNodes(folderId);
      setChildrenByFolderId((current) => ({ ...current, [folderId]: children }));
    } catch {
      setChildrenByFolderId((current) => ({ ...current, [folderId]: [] }));
    } finally {
      setLoadingFolderIds((current) => {
        const next = new Set(current);
        next.delete(folderId);
        return next;
      });
    }
  }, [props.dataSource]);

  useEffect(() => {
    setChildrenByFolderId({});
  }, [props.refreshKey]);

  useEffect(() => {
    const path = props.selectedFolderPath || [];
    if (path.length === 0) return;
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      path.forEach((folder) => {
        if (!folder.system_key) next.add(folder.id);
      });
      return next;
    });
    path.forEach((folder) => {
      if (
        !folder.system_key &&
        childrenByFolderId[folder.id] === undefined &&
        !loadingFolderIds.has(folder.id)
      ) {
        void loadChildren(folder.id);
      }
    });
  }, [childrenByFolderId, loadChildren, loadingFolderIds, props.selectedFolderPath]);

  const toggleFolder = useCallback((folder: PortalWorkspaceNode) => {
    const willExpand = !expandedFolderIds.has(folder.id);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      willExpand ? next.add(folder.id) : next.delete(folder.id);
      return next;
    });
    if (willExpand && childrenByFolderId[folder.id] === undefined) {
      void loadChildren(folder.id);
    }
  }, [childrenByFolderId, expandedFolderIds, loadChildren]);

  const renderFolder = useCallback((folder: PortalWorkspaceNode, depth: number) => {
    const selected = props.selectedFolderId === folder.id;
    const expanded = expandedFolderIds.has(folder.id);
    const loading = loadingFolderIds.has(folder.id);
    const childFolders = (childrenByFolderId[folder.id] || []).filter((node) => node.kind === "folder");
    const FolderIcon = selected || expanded ? FolderOpen : Folder;
    const folderName = folder.system_key === "history_unfiled"
      ? t("workspace.historyTasks")
      : folder.name;
    const hasRunningTasks = props.runningFolderIds?.has(folder.id) ?? false;
    const hasUnreadTasks = props.unreadFolderIds?.has(folder.id) ?? false;
    const folderStateLabel = [
      hasRunningTasks ? t("workspace.runningTasks") : "",
      hasUnreadTasks ? t("workspace.unreadTasks") : ""
    ].filter(Boolean).join(", ");
    const canExpand = !folder.system_key;
    const treeStyle = { "--workspace-tree-depth": depth } as CSSProperties;

    return (
      <div
        key={folder.id}
        className={selected ? "workspace-folder-tree-node is-active" : "workspace-folder-tree-node"}
        data-system-folder={folder.system_key || undefined}
        style={treeStyle}
      >
        <div className="workspace-folder-tree-row">
          {canExpand ? (
            <button
              type="button"
              className="workspace-tree-toggle"
              aria-label={t(expanded ? "workspace.collapseFolder" : "workspace.expandFolder", { name: folderName })}
              aria-expanded={expanded}
              onClick={() => toggleFolder(folder)}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="workspace-tree-toggle-spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className={selected ? "workspace-tree-item is-active" : "workspace-tree-item"}
            aria-current={selected ? "page" : undefined}
            onClick={() => props.onSelectFolder(folder.id)}
          >
            <FolderIcon size={17} />
            <span className="workspace-tree-item-label" title={folderName}>{folderName}</span>
            {folderStateLabel ? (
              <span
                className="workspace-folder-state-indicators"
                aria-label={folderStateLabel}
                title={folderStateLabel}
              >
                {hasRunningTasks ? <span className="thread-running-indicator workspace-folder-running-indicator" aria-hidden="true" /> : null}
                {hasUnreadTasks ? <span className="workspace-folder-unread-indicator" aria-hidden="true" /> : null}
              </span>
            ) : null}
          </button>
          {selected && !props.readOnly ? (
            <button
              type="button"
              className="workspace-folder-inline-new"
              aria-label={t("workspace.newTask")}
              title={t("workspace.newTask")}
              onClick={props.onNewTask}
            >
              <Plus size={14} />
              <span>{t("workspace.newTask")}</span>
            </button>
          ) : null}
        </div>
        {selected ? (
          <div className="workspace-folder-task-preview">
            <div className="workspace-folder-task-preview-label">{t("workspace.recentTasks")}</div>
            <div className="workspace-task-list">{props.taskList}</div>
            {(props.taskCount || 0) > WORKSPACE_RAIL_TASK_LIMIT ? (
              <button type="button" className="workspace-view-all-tasks" onClick={props.onViewAllTasks}>
                {t("workspace.viewAllTasks", { count: props.taskCount || 0 })}
                <ChevronRight size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
        {expanded ? (
          <div className="workspace-folder-tree-children">
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {loading ? <span className="workspace-tree-loading">{t("common.loading")}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }, [
    childrenByFolderId,
    expandedFolderIds,
    loadingFolderIds,
    props.onNewTask,
    props.onSelectFolder,
    props.onViewAllTasks,
    props.readOnly,
    props.selectedFolderId,
    props.taskCount,
    props.taskList,
    props.runningFolderIds,
    props.unreadFolderIds,
    t,
    toggleFolder
  ]);

  const folderTree = useMemo(
    () => folders.map((folder) => renderFolder(folder, 0)),
    [folders, renderFolder]
  );

  return (
    <aside className="workspace-rail" aria-label={t("workspace.title")}>
      <div className="workspace-rail-head">
        <div className="workspace-rail-heading-row">
          <h2>{props.title || t("workspace.mine")}</h2>
        </div>
        <Input
          className="workspace-search"
          aria-label={t("workspace.search")}
          placeholder={t("workspace.searchPlaceholder")}
          prefix={<Search size={15} />}
          value={props.searchValue}
          onChange={(event) => props.onSearchChange(event.target.value)}
          allowClear
        />
      </div>

      <nav className="workspace-folder-nav" aria-label={t("workspace.folders")}>
        <div className="workspace-nav-section-label">
          <span>{t("workspace.folders")}</span>
          {!props.readOnly ? (
            <button type="button" onClick={props.onCreateFolder}>
              <Plus size={13} />
              {t("workspace.addFolder")}
            </button>
          ) : null}
        </div>

        {folderTree}

        {!props.readOnly && !props.loading && folders.length === 0 ? (
          <button type="button" className="workspace-empty-folder-cta" onClick={props.onCreateFolder}>
            <Plus size={16} />
            {t("workspace.createFirstFolder")}
          </button>
        ) : null}

        {props.errorText ? <p className="workspace-rail-error">{props.errorText}</p> : null}
      </nav>

      {!props.readOnly ? <div className="workspace-rail-footer">
        <button
          type="button"
          className={props.selectedFolderId === TRASH_WORKSPACE_VIEW ? "workspace-nav-item is-active" : "workspace-nav-item"}
          onClick={() => props.onSelectFolder(TRASH_WORKSPACE_VIEW)}
        >
          <Trash2 size={17} />
          <span>{t("workspace.trash")}</span>
          <ChevronRight size={14} className="workspace-nav-chevron" />
        </button>
        {props.footer}
      </div> : props.footer ? <div className="workspace-rail-footer">{props.footer}</div> : null}
    </aside>
  );
}
