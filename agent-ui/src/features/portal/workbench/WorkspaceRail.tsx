import type { ReactNode } from "react";
import { Input } from "antd";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Search,
  Trash2
} from "lucide-react";

import { usePortalI18n } from "../i18n";
import type { PortalWorkspaceNode, PortalWorkspaceSummary } from "../workspace";

export const RECENT_WORKSPACE_VIEW = "__recent__";
export const AGENT_OUTPUTS_WORKSPACE_VIEW = "__agent_outputs__";
export const TRASH_WORKSPACE_VIEW = "__trash__";

export function WorkspaceRail(props: {
  workspace: PortalWorkspaceSummary | null;
  rootNodes: PortalWorkspaceNode[];
  selectedFolderId: string;
  searchValue: string;
  loading?: boolean;
  errorText?: string;
  taskList?: ReactNode;
  taskCount?: number;
  footer?: ReactNode;
  onSearchChange(value: string): void;
  onSelectFolder(folderId: string): void;
  onCreateFolder(): void;
  onNewTask(): void;
  onViewAllTasks(): void;
}) {
  const { t } = usePortalI18n();
  const folders = props.rootNodes.filter((node) => node.kind === "folder");

  return (
    <aside className="workspace-rail" aria-label={t("workspace.title")}>
      <div className="workspace-rail-head">
        <div className="workspace-rail-heading-row">
          <h2>{t("workspace.mine")}</h2>
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
          <button type="button" onClick={props.onCreateFolder}>
            <Plus size={13} />
            {t("workspace.addFolder")}
          </button>
        </div>

        {folders.map((folder) => {
          const selected = props.selectedFolderId === folder.id;
          const FolderIcon = selected ? FolderOpen : Folder;
          const folderName = folder.system_key === "history_unfiled"
            ? t("workspace.historyTasks")
            : folder.name;
          return (
            <div
              key={folder.id}
              className={selected ? "workspace-folder-entry is-active" : "workspace-folder-entry"}
              data-system-folder={folder.system_key || undefined}
            >
              <div className="workspace-folder-row">
                <button
                  type="button"
                  className={selected ? "workspace-nav-item is-active" : "workspace-nav-item"}
                  onClick={() => props.onSelectFolder(folder.id)}
                >
                  <FolderIcon size={17} />
                  <span title={folderName}>{folderName}</span>
                  {!selected ? <ChevronRight size={14} className="workspace-nav-chevron" /> : null}
                </button>
                {selected ? (
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
                  {(props.taskCount || 0) > 0 ? (
                    <button type="button" className="workspace-view-all-tasks" onClick={props.onViewAllTasks}>
                      {t("workspace.viewAllTasks", { count: props.taskCount || 0 })}
                      <ChevronRight size={13} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {!props.loading && folders.length === 0 ? (
          <button type="button" className="workspace-empty-folder-cta" onClick={props.onCreateFolder}>
            <Plus size={16} />
            {t("workspace.createFirstFolder")}
          </button>
        ) : null}

        {props.errorText ? <p className="workspace-rail-error">{props.errorText}</p> : null}
      </nav>

      <div className="workspace-rail-footer">
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
      </div>
    </aside>
  );
}
