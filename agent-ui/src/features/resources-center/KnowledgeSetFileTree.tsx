import { useMemo, useState } from "react";
import { Button, Input, Modal, Typography } from "antd";

import type { KnowledgeSetItemRecord } from "./types";
import { openWarningConfirm } from "../../lib/warning-modal";

type KnowledgeSetFileTreeProps = {
  items: KnowledgeSetItemRecord[];
  disabled?: boolean;
  requireRenameConfirm?: boolean;
  onDelete: (relativePath: string) => void | Promise<void>;
  onRename: (relativePath: string, nextRelativePath: string) => void | Promise<void>;
};

type DirectoryNode = {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  files: KnowledgeSetItemRecord[];
};

function createDirectoryNode(name: string, path: string): DirectoryNode {
  return {
    name,
    path,
    directories: new Map(),
    files: []
  };
}

function buildTree(items: KnowledgeSetItemRecord[]) {
  const root = createDirectoryNode("", "");
  for (const item of items) {
    const segments = item.relativePath.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let current = root;
    const directories = segments.slice(0, -1);
    for (const segment of directories) {
      const nextPath = current.path ? `${current.path}/${segment}` : segment;
      let next = current.directories.get(segment);
      if (!next) {
        next = createDirectoryNode(segment, nextPath);
        current.directories.set(segment, next);
      }
      current = next;
    }
    current.files.push(item);
  }
  return root;
}

function formatLocalDateTime(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function formatSize(sizeBytes?: string) {
  if (!sizeBytes) return null;
  const value = Number(sizeBytes);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type DirectoryListProps = {
  node: DirectoryNode;
  disabled: boolean;
  onRequestDelete(relativePath: string): void;
  onRequestRename(relativePath: string): void;
};

function DirectoryList({ node, disabled, onRequestDelete, onRequestRename }: DirectoryListProps) {
  const directories = [...node.directories.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const files = [...node.files].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));

  return (
    <ul className={node.path ? "knowledge-set-tree-list nested" : "knowledge-set-tree-list"} role="tree">
      {directories.map((directory) => (
        <li key={`dir:${directory.path}`} className="knowledge-set-tree-directory" role="treeitem" aria-expanded="true">
          <div className="knowledge-set-tree-directory-row">
            <span className="knowledge-set-tree-directory-name">{directory.name}</span>
          </div>
          <DirectoryList
            node={directory}
            disabled={disabled}
            onRequestDelete={onRequestDelete}
            onRequestRename={onRequestRename}
          />
        </li>
      ))}

      {files.map((item) => {
        const sizeText = formatSize(item.sizeBytes);
        const updatedText = formatLocalDateTime(item.updatedAt);
        return (
          <li key={`file:${item.relativePath}`} className="knowledge-set-tree-file" role="treeitem">
            <div className="knowledge-set-tree-file-row">
              <div className="knowledge-set-tree-file-main">
                <span className="knowledge-set-tree-file-name">{item.displayName}</span>
                <span className="knowledge-set-tree-file-path">{item.relativePath}</span>
                <div className="knowledge-set-tree-file-meta">
                  {sizeText ? <span>{sizeText}</span> : null}
                  {item.sourceArchiveName ? <span>来源 {item.sourceArchiveName}</span> : null}
                  {updatedText ? <span>更新于 {updatedText}</span> : null}
                </div>
              </div>

              <div className="knowledge-set-tree-file-actions">
                <Button
                  type="default"
                  disabled={disabled}
                  aria-label="重命名文件"
                  onClick={() => onRequestRename(item.relativePath)}
                >
                  重命名
                </Button>
                <Button
                  type="default"
                  disabled={disabled}
                  aria-label="删除文件"
                  onClick={() => onRequestDelete(item.relativePath)}
                >
                  删除
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function KnowledgeSetFileTree({
  items,
  disabled = false,
  requireRenameConfirm = false,
  onDelete,
  onRename
}: KnowledgeSetFileTreeProps) {
  const tree = useMemo(() => buildTree(items), [items]);
  const [renameDraft, setRenameDraft] = useState<{ sourcePath: string; nextPath: string } | null>(null);
  const [renameErrorText, setRenameErrorText] = useState("");

  async function handleDeleteRequest(relativePath: string) {
    const confirmed = await openWarningConfirm({
      title: "确认删除文件",
      content: `确认删除 ${relativePath} 吗？`,
      description: "删除后将立即从资料集移除，请谨慎操作。",
      dangerLevel: "danger",
      okText: "删除",
      cancelText: "取消"
    });
    if (!confirmed) return;
    await onDelete(relativePath);
  }

  function handleRenameRequest(relativePath: string) {
    setRenameErrorText("");
    setRenameDraft({ sourcePath: relativePath, nextPath: relativePath });
  }

  async function handleRenameConfirm() {
    if (!renameDraft) return;
    const nextRelativePath = renameDraft.nextPath.trim();
    if (!nextRelativePath) {
      setRenameErrorText("新的相对路径不能为空");
      return;
    }

    if (nextRelativePath === renameDraft.sourcePath) {
      setRenameDraft(null);
      return;
    }

    if (requireRenameConfirm) {
      const confirmed = await openWarningConfirm({
        title: "确认重命名文件",
        content: `确认将 ${renameDraft.sourcePath} 重命名为 ${nextRelativePath} 吗？`,
        dangerLevel: "warning",
        okText: "确认重命名",
        cancelText: "取消",
        okButtonDanger: false
      });
      if (!confirmed) return;
    }

    await onRename(renameDraft.sourcePath, nextRelativePath);
    setRenameDraft(null);
  }

  if (items.length === 0) {
    return <p className="resource-center-empty">当前资料集没有文件清单。</p>;
  }

  return (
    <>
      <DirectoryList
        node={tree}
        disabled={disabled}
        onRequestDelete={(relativePath) => void handleDeleteRequest(relativePath)}
        onRequestRename={handleRenameRequest}
      />

      <Modal
        title="重命名文件"
        open={Boolean(renameDraft)}
        onCancel={() => setRenameDraft(null)}
        onOk={() => void handleRenameConfirm()}
        okText="保存"
        cancelText="取消"
        maskClosable={!disabled}
        okButtonProps={{ disabled }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          更新文件相对路径后，资料集清单会同步变更。
        </Typography.Paragraph>
        <label className="field">
          <span className="field-label">原路径</span>
          <Input value={renameDraft?.sourcePath ?? ""} disabled />
        </label>
        <label className="field">
          <span className="field-label">新路径</span>
          <Input
            autoFocus
            value={renameDraft?.nextPath ?? ""}
            onChange={(event) =>
              setRenameDraft((current) => (current ? { ...current, nextPath: event.target.value } : current))
            }
          />
        </label>
        {renameErrorText ? <Typography.Text type="danger">{renameErrorText}</Typography.Text> : null}
      </Modal>
    </>
  );
}
