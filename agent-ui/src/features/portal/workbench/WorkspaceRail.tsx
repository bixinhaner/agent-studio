import type { ReactNode } from "react";
import { Button, Input, Tooltip } from "antd";
import {
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  HardDrive,
  Plus,
  Search,
  Sparkles,
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
  footer?: ReactNode;
  newThreadSlot?: ReactNode;
  onSearchChange(value: string): void;
  onSelectFolder(folderId: string): void;
  onCreateFolder(): void;
}) {
  const { t } = usePortalI18n();
  const folders = props.rootNodes.filter((node) => node.kind === "folder");
  const usagePercent = props.workspace
    ? Math.min(100, Math.round((props.workspace.used_bytes / Math.max(props.workspace.quota_bytes, 1)) * 100))
    : 0;

  return (
    <aside className="workspace-rail" aria-label={t("workspace.title")}>
      <div className="workspace-rail-head">
        <div className="workspace-rail-heading-row">
          <div>
            <span className="workspace-rail-eyebrow">{t("workspace.title")}</span>
            <h2>{props.workspace?.name || t("workspace.mine")}</h2>
          </div>
          <Tooltip title={t("workspace.newFolder")}>
            <Button
              type="text"
              className="workspace-icon-button"
              icon={<Plus size={17} />}
              aria-label={t("workspace.newFolder")}
              onClick={props.onCreateFolder}
            />
          </Tooltip>
        </div>
        {props.newThreadSlot}
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
        <button
          type="button"
          className={props.selectedFolderId === RECENT_WORKSPACE_VIEW ? "workspace-nav-item is-active" : "workspace-nav-item"}
          onClick={() => props.onSelectFolder(RECENT_WORKSPACE_VIEW)}
        >
          <Clock3 size={17} />
          <span>{t("workspace.recent")}</span>
          <ChevronRight size={14} className="workspace-nav-chevron" />
        </button>
        <button
          type="button"
          className={props.selectedFolderId === AGENT_OUTPUTS_WORKSPACE_VIEW ? "workspace-nav-item is-active" : "workspace-nav-item"}
          onClick={() => props.onSelectFolder(AGENT_OUTPUTS_WORKSPACE_VIEW)}
        >
          <Sparkles size={17} />
          <span>{t("workspace.agentOutputs")}</span>
          <ChevronRight size={14} className="workspace-nav-chevron" />
        </button>

        <div className="workspace-nav-section-label">
          <span>{t("workspace.folders")}</span>
          {props.loading ? <span>{t("common.loading")}</span> : null}
        </div>

        {folders.map((folder) => {
          const selected = props.selectedFolderId === folder.id;
          const FolderIcon = selected ? FolderOpen : Folder;
          return (
            <button
              key={folder.id}
              type="button"
              className={selected ? "workspace-nav-item is-active" : "workspace-nav-item"}
              data-system-folder={folder.system_key || undefined}
              onClick={() => props.onSelectFolder(folder.id)}
            >
              <FolderIcon size={17} />
              <span title={folder.name}>{folder.name}</span>
              <ChevronRight size={14} className="workspace-nav-chevron" />
            </button>
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

      <div className="workspace-task-section">
        <div className="workspace-nav-section-label">
          <span>{t("workspace.tasks")}</span>
        </div>
        <div className="workspace-task-list">{props.taskList}</div>
      </div>

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
        {props.workspace ? (
          <div className="workspace-storage">
            <HardDrive size={15} />
            <span>{t("workspace.storageUsed", { percent: usagePercent })}</span>
            <span className="workspace-storage-track" aria-hidden="true">
              <span style={{ width: `${usagePercent}%` }} />
            </span>
          </div>
        ) : null}
        {props.footer}
      </div>
    </aside>
  );
}
