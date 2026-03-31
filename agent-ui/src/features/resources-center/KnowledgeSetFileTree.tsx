import { useMemo } from "react";
import { Button } from "antd";

import type { KnowledgeSetItemRecord } from "./types";

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
  requireRenameConfirm: boolean;
  onDelete: KnowledgeSetFileTreeProps["onDelete"];
  onRename: KnowledgeSetFileTreeProps["onRename"];
};

function DirectoryList({ node, disabled, requireRenameConfirm, onDelete, onRename }: DirectoryListProps) {
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
            requireRenameConfirm={requireRenameConfirm}
            onDelete={onDelete}
            onRename={onRename}
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
                  onClick={() => {
                    const nextRelativePath = window.prompt("输入新的相对路径", item.relativePath);
                    if (!nextRelativePath || !nextRelativePath.trim() || nextRelativePath === item.relativePath) {
                      return;
                    }
                    if (requireRenameConfirm && !window.confirm(`确认将 ${item.relativePath} 重命名为 ${nextRelativePath.trim()} 吗？`)) {
                      return;
                    }
                    void onRename(item.relativePath, nextRelativePath.trim());
                  }}
                >
                  重命名
                </Button>
                <Button
                  type="default"
                  disabled={disabled}
                  aria-label="删除文件"
                  onClick={() => {
                    if (!window.confirm(`确认删除 ${item.relativePath} 吗？`)) return;
                    void onDelete(item.relativePath);
                  }}
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

  if (items.length === 0) {
    return <p className="resource-center-empty">当前资料集没有文件清单。</p>;
  }

  return (
    <DirectoryList
      node={tree}
      disabled={disabled}
      requireRenameConfirm={requireRenameConfirm}
      onDelete={onDelete}
      onRename={onRename}
    />
  );
}
