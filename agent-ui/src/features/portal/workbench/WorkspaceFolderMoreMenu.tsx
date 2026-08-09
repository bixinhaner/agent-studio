import { useMemo, useState } from "react";
import { Alert, Dropdown, Input, Modal, Select } from "antd";
import { FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  fetchPortalWorkspaceNodes,
  previewPortalWorkspaceTrash,
  trashPortalWorkspaceNode,
  updatePortalWorkspaceNode,
  type PortalWorkspaceNode,
  type PortalWorkspaceTrashPreview
} from "../workspace";

const WORKSPACE_ROOT = "__workspace_root__";

function formatDeleteDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function WorkspaceFolderMoreMenu(props: {
  folder: PortalWorkspaceNode;
  onChanged(action: "rename" | "move" | "trash", folder: PortalWorkspaceNode): void;
}) {
  const { locale, t } = usePortalI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [name, setName] = useState(props.folder.name);
  const [folders, setFolders] = useState<PortalWorkspaceNode[]>([]);
  const [targetId, setTargetId] = useState<string>();
  const [preview, setPreview] = useState<PortalWorkspaceTrashPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const moveTargets = useMemo(() => {
    const parentById = new Map(folders.map((folder) => [folder.id, folder.parent_id]));
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const isDescendant = (candidateId: string): boolean => {
      const seen = new Set<string>();
      let current: string | null | undefined = candidateId;
      while (current && !seen.has(current)) {
        if (current === props.folder.id) return true;
        seen.add(current);
        current = parentById.get(current);
      }
      return false;
    };
    return folders
      .filter((folder) =>
        folder.kind === "folder" &&
        !folder.system_key &&
        folder.id !== props.folder.id &&
        folder.id !== props.folder.parent_id &&
        !isDescendant(folder.id)
      )
      .map((folder) => {
        const names = [folder.name];
        const seen = new Set([folder.id]);
        let parentId = folder.parent_id;
        while (parentId && !seen.has(parentId) && names.length < 12) {
          seen.add(parentId);
          const parent = folderById.get(parentId);
          if (!parent || parent.system_key) break;
          names.unshift(parent.name);
          parentId = parent.parent_id;
        }
        return { folder, label: names.join(" / ") };
      })
      .sort((left, right) => left.label.localeCompare(right.label, locale === "zh-CN" ? "zh-CN" : "en"));
  }, [folders, locale, props.folder.id, props.folder.parent_id]);

  const openMove = async () => {
    setErrorText("");
    setLoading(true);
    setMoveOpen(true);
    try {
      setFolders(await fetchPortalWorkspaceNodes(undefined, { all: true }));
      setTargetId(undefined);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.moveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const openTrash = async () => {
    setErrorText("");
    setPreview(null);
    setLoading(true);
    setTrashOpen(true);
    try {
      setPreview(await previewPortalWorkspaceTrash(props.folder.id));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.trashFailed"));
    } finally {
      setLoading(false);
    }
  };

  const submitRename = async () => {
    const nextName = name.trim();
    if (!nextName || nextName === props.folder.name) {
      setRenameOpen(false);
      return;
    }
    setLoading(true);
    setErrorText("");
    try {
      const updated = await updatePortalWorkspaceNode(props.folder.id, { name: nextName });
      setRenameOpen(false);
      props.onChanged("rename", updated);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.renameFailed"));
    } finally {
      setLoading(false);
    }
  };

  const submitMove = async () => {
    if (!targetId) return;
    setLoading(true);
    setErrorText("");
    try {
      const updated = await updatePortalWorkspaceNode(props.folder.id, {
        parent_id: targetId === WORKSPACE_ROOT ? null : targetId
      });
      setMoveOpen(false);
      props.onChanged("move", updated);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.moveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const submitTrash = async () => {
    if (!preview) return;
    setLoading(true);
    setErrorText("");
    try {
      const updated = await trashPortalWorkspaceNode(props.folder.id);
      setTrashOpen(false);
      props.onChanged("trash", updated);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("workspace.trashFailed"));
    } finally {
      setLoading(false);
    }
  };

  const inlineError = errorText ? <Alert type="error" showIcon message={errorText} /> : null;

  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            { key: "rename", icon: <Pencil size={14} />, label: t("workspace.rename") },
            { key: "move", icon: <FolderInput size={14} />, label: t("workspace.moveTo") },
            { type: "divider" },
            { key: "trash", icon: <Trash2 size={14} />, label: t("workspace.moveToTrash"), danger: true }
          ],
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "rename") {
              setName(props.folder.name);
              setErrorText("");
              setRenameOpen(true);
            }
            if (key === "move") void openMove();
            if (key === "trash") void openTrash();
          }
        }}
      >
        <button
          type="button"
          className="workspace-folder-more"
          aria-label={t("workspace.moreActionsFor", { name: props.folder.name })}
          title={t("workspace.moreActions")}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal size={16} />
        </button>
      </Dropdown>

      <Modal
        title={t("workspace.renameFolder")}
        open={renameOpen}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        confirmLoading={loading}
        onOk={() => void submitRename()}
        onCancel={() => setRenameOpen(false)}
        destroyOnHidden
      >
        <div className="workspace-folder-action-modal">
          {inlineError}
          <Input value={name} maxLength={255} autoFocus onChange={(event) => setName(event.target.value)} onPressEnter={() => void submitRename()} />
        </div>
      </Modal>

      <Modal
        title={t("workspace.moveFolder")}
        open={moveOpen}
        okText={t("workspace.moveHere")}
        cancelText={t("common.cancel")}
        okButtonProps={{ disabled: !targetId }}
        confirmLoading={loading}
        onOk={() => void submitMove()}
        onCancel={() => setMoveOpen(false)}
        destroyOnHidden
      >
        <div className="workspace-folder-action-modal">
          {inlineError}
          <p>{t("workspace.moveFolderHelp", { name: props.folder.name })}</p>
          <Select
            loading={loading}
            value={targetId}
            placeholder={t("workspace.selectDestination")}
            onChange={setTargetId}
            options={[
              ...(props.folder.parent_id ? [{ value: WORKSPACE_ROOT, label: t("workspace.workspaceRoot") }] : []),
              ...moveTargets.map((target) => ({ value: target.folder.id, label: target.label }))
            ]}
          />
        </div>
      </Modal>

      <Modal
        title={t("workspace.trashFolderTitle")}
        open={trashOpen}
        okText={t("workspace.moveToTrash")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true, disabled: !preview || preview.running_conversation_count > 0 }}
        confirmLoading={loading}
        onOk={() => void submitTrash()}
        onCancel={() => setTrashOpen(false)}
        destroyOnHidden
      >
        <div className="workspace-folder-action-modal workspace-folder-trash-confirm">
          {inlineError}
          {preview ? (
            <>
              <p>{t("workspace.trashFolderImpact", {
                name: preview.name,
                folders: Math.max(preview.folder_count - 1, 0),
                conversations: preview.conversation_count,
                files: preview.file_count
              })}</p>
              <Alert
                type="warning"
                showIcon
                message={t("workspace.trashFolderPermanentWarning")}
                description={t("workspace.trashFolderRestoreBefore", {
                  date: formatDeleteDate(preview.delete_at, locale)
                })}
              />
              {preview.running_conversation_count > 0 ? (
                <Alert
                  type="error"
                  showIcon
                  message={t("workspace.trashFolderRunningBlocked", { count: preview.running_conversation_count })}
                />
              ) : null}
            </>
          ) : loading ? <p>{t("workspace.calculatingTrashImpact")}</p> : null}
        </div>
      </Modal>
    </>
  );
}
