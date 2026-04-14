import { FolderOpenOutlined, FileOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { Button, Empty, Input, Modal, Switch, Tag, Typography } from "antd";

import { fetchKnowledgeSetTree } from "./api";
import type { KnowledgeSetTreeDirectoryEntry, KnowledgeSetTreeEntry, KnowledgeSetTreeResponse } from "./types";
import { openWarningConfirm } from "../../lib/warning-modal";

type KnowledgeSetFileTreeProps = {
  knowledgeSetId: string;
  disabled?: boolean;
  reloadKey?: number;
  onDelete: (relativePath: string) => void | Promise<void>;
  onRename: (relativePath: string, nextRelativePath: string) => void | Promise<void>;
};

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

function breadcrumbItems(currentPath: string): Array<{ label: string; path: string }> {
  if (!currentPath) return [{ label: "根目录", path: "" }];
  const segments = currentPath.split("/").filter(Boolean);
  const items = [{ label: "根目录", path: "" }];
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    items.push({ label: segment, path: current });
  }
  return items;
}

function DirectoryMeta({ entry }: { entry: KnowledgeSetTreeDirectoryEntry }) {
  return (
    <div className="knowledge-set-browser-meta">
      <span>{entry.documentCount} 篇文档</span>
      <span>{entry.fileCount} 个文件</span>
      {entry.warningDocumentCount > 0 ? <span>{entry.warningDocumentCount} 个异常</span> : null}
    </div>
  );
}

export function KnowledgeSetFileTree({
  knowledgeSetId,
  disabled = false,
  reloadKey = 0,
  onDelete,
  onRename
}: KnowledgeSetFileTreeProps) {
  const [tree, setTree] = useState<KnowledgeSetTreeResponse | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [includeJsonl, setIncludeJsonl] = useState(false);
  const [renameDraft, setRenameDraft] = useState<{ sourcePath: string; nextPath: string } | null>(null);
  const [renameErrorText, setRenameErrorText] = useState("");

  useEffect(() => {
    setCurrentPath("");
    setTree(null);
    setErrorText("");
  }, [knowledgeSetId]);

  useEffect(() => {
    let active = true;

    async function loadTree() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchKnowledgeSetTree(knowledgeSetId, {
          path: currentPath,
          includeJsonl
        });
        if (!active) return;
        setTree(response);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载原始文件失败");
          setTree(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadTree();
    return () => {
      active = false;
    };
  }, [currentPath, includeJsonl, knowledgeSetId, refreshNonce, reloadKey]);

  async function handleDelete(relativePath: string) {
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
    await onRename(renameDraft.sourcePath, nextRelativePath);
    setRenameDraft(null);
  }

  const breadcrumbs = breadcrumbItems(tree?.currentPath ?? currentPath);
  const parentPath = tree?.parentPath ?? null;

  return (
    <div className="knowledge-set-browser">
      <div className="knowledge-set-browser-toolbar">
        <div className="knowledge-set-browser-breadcrumbs">
          {breadcrumbs.map((item, index) => (
            <button
              key={`${item.path || "root"}-${index}`}
              type="button"
              className={`knowledge-set-browser-crumb${index === breadcrumbs.length - 1 ? " active" : ""}`}
              onClick={() => setCurrentPath(item.path)}
              disabled={loading || (index === breadcrumbs.length - 1 && !loading)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="knowledge-set-browser-actions">
          <label className="knowledge-set-browser-toggle">
            <span>显示 `.jsonl`</span>
            <Switch checked={includeJsonl} onChange={setIncludeJsonl} disabled={loading} />
          </label>
          <Button
            type="default"
            icon={<ReloadOutlined />}
            onClick={() => setRefreshNonce((value) => value + 1)}
            disabled={loading}
          >
            刷新
          </Button>
          <Button type="default" onClick={() => setCurrentPath(parentPath || "")} disabled={!parentPath || loading}>
            返回上级
          </Button>
        </div>
      </div>

      {tree?.hiddenEntryCount ? (
        <Typography.Text type="secondary" className="resource-center-inline-muted">
          当前目录及其子树默认隐藏了 {tree.hiddenEntryCount} 个 `.jsonl` 文件。
        </Typography.Text>
      ) : null}
      {errorText ? <Typography.Text type="danger">{errorText}</Typography.Text> : null}

      {loading ? <p className="resource-center-subtle">加载原始文件中...</p> : null}

      {!loading && !tree?.entries.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={tree ? "当前目录没有可显示的文件。" : "当前资料集没有原始文件。"}
        />
      ) : null}

      {!loading && tree?.entries.length ? (
        <div className="knowledge-set-browser-list">
          {tree.entries.map((entry: KnowledgeSetTreeEntry) => {
            if (entry.kind === "directory") {
              return (
                <article key={`dir:${entry.relativePath}`} className="knowledge-set-browser-row directory">
                  <button
                    type="button"
                    className="knowledge-set-browser-directory-main"
                    onClick={() => setCurrentPath(entry.relativePath)}
                    disabled={loading}
                  >
                    <span className="knowledge-set-browser-icon">
                      <FolderOpenOutlined />
                    </span>
                    <span className="knowledge-set-browser-title">{entry.name}</span>
                  </button>
                  <DirectoryMeta entry={entry} />
                  {entry.warningDocumentCount > 0 ? <Tag color="warning">含异常文档</Tag> : <Tag>目录</Tag>}
                </article>
              );
            }

            const sizeText = formatSize(entry.sizeBytes);
            const updatedText = formatLocalDateTime(entry.updatedAt);
            return (
              <article key={`file:${entry.relativePath}`} className="knowledge-set-browser-row file">
                <div className="knowledge-set-browser-file-main">
                  <div className="knowledge-set-browser-file-head">
                    <span className="knowledge-set-browser-icon">
                      <FileOutlined />
                    </span>
                    <span className="knowledge-set-browser-title">{entry.name}</span>
                  </div>
                  <span className="knowledge-set-browser-path">{entry.relativePath}</span>
                  <div className="knowledge-set-browser-meta">
                    {sizeText ? <span>{sizeText}</span> : null}
                    {entry.sourceArchiveName ? <span>来源 {entry.sourceArchiveName}</span> : null}
                    {updatedText ? <span>更新于 {updatedText}</span> : null}
                  </div>
                </div>
                <div className="knowledge-set-browser-file-actions">
                  <Button
                    type="default"
                    disabled={disabled}
                    onClick={() => {
                      setRenameErrorText("");
                      setRenameDraft({ sourcePath: entry.relativePath, nextPath: entry.relativePath });
                    }}
                  >
                    重命名
                  </Button>
                  <Button type="default" danger={false} disabled={disabled} onClick={() => void handleDelete(entry.relativePath)}>
                    删除
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

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
    </div>
  );
}
