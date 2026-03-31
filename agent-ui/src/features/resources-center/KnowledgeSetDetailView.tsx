import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Tag } from "antd";

import {
  deleteKnowledgeSetItem,
  fetchKnowledgeSetItems,
  rebuildKnowledgeSet,
  renameKnowledgeSetItem,
  updateKnowledgeSet,
  uploadKnowledgeSetArchive,
  uploadKnowledgeSetFiles
} from "./api";
import { KnowledgeSetFileTree } from "./KnowledgeSetFileTree";
import { ResourcePolicyEditor } from "./ResourcePolicyEditor";
import type { KnowledgeSetItemRecord, KnowledgeSetRecord } from "./types";

type KnowledgeSetDetailViewProps = {
  knowledgeSet: KnowledgeSetRecord;
  onKnowledgeSetUpdated: (knowledgeSet: KnowledgeSetRecord) => void;
};

export function KnowledgeSetDetailView({ knowledgeSet, onKnowledgeSetUpdated }: KnowledgeSetDetailViewProps) {
  const [name, setName] = useState(knowledgeSet.name);
  const [slug, setSlug] = useState(knowledgeSet.slug);
  const [description, setDescription] = useState(knowledgeSet.description || "");
  const [sourceType, setSourceType] = useState(knowledgeSet.sourceType);
  const [status, setStatus] = useState(knowledgeSet.status);
  const [rootPath, setRootPath] = useState(knowledgeSet.rootPath || "");
  const [storageKey, setStorageKey] = useState(knowledgeSet.storageKey || "");
  const [items, setItems] = useState<KnowledgeSetItemRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsReady, setItemsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [mutatingItemPath, setMutatingItemPath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedArchive, setSelectedArchive] = useState<File | null>(null);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const viewVersionRef = useRef(0);

  useEffect(() => {
    setName(knowledgeSet.name);
    setSlug(knowledgeSet.slug);
    setDescription(knowledgeSet.description || "");
    setSourceType(knowledgeSet.sourceType);
    setStatus(knowledgeSet.status);
    setRootPath(knowledgeSet.rootPath || "");
    setStorageKey(knowledgeSet.storageKey || "");
  }, [knowledgeSet]);

  useEffect(() => {
    viewVersionRef.current += 1;
    setItems([]);
    setSaving(false);
    setUploading(false);
    setRebuilding(false);
    setMutatingItemPath(null);
    setSelectedFiles([]);
    setSelectedArchive(null);
    setSuccessText("");
    setErrorText("");
  }, [knowledgeSet.id]);

  useEffect(() => {
    let active = true;

    async function loadItems() {
      setLoadingItems(true);
      setItemsReady(false);
      setErrorText("");
      try {
        const response = await fetchKnowledgeSetItems(knowledgeSet.id);
        if (!active) return;
        setItems(response.items);
        setItemsReady(true);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资料集文件清单失败");
          setItemsReady(false);
        }
      } finally {
        if (active) setLoadingItems(false);
      }
    }

    void loadItems();
    return () => {
      active = false;
    };
  }, [knowledgeSet.id]);

  function clearUploadSelections() {
    setSelectedFiles([]);
    setSelectedArchive(null);
    if (filesInputRef.current) {
      filesInputRef.current.value = "";
    }
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
  }

  function isCurrentView(version: number) {
    return viewVersionRef.current === version;
  }

  async function handleSave() {
    const viewVersion = viewVersionRef.current;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await updateKnowledgeSet(knowledgeSet.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        status,
        sourceType,
        ...(sourceType === "filesystem"
          ? { rootPath: rootPath.trim() }
          : { storageKey: storageKey.trim() })
      });
      if (!isCurrentView(viewVersion)) return;
      onKnowledgeSetUpdated(response.knowledgeSet);
      setSuccessText("资料集配置已保存");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "保存资料集配置失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setSaving(false);
      }
    }
  }

  async function handleRebuild() {
    const viewVersion = viewVersionRef.current;
    setRebuilding(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await rebuildKnowledgeSet(knowledgeSet.id);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setItemsReady(true);
      setSuccessText("资料集文件清单已重建");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "重建资料集文件清单失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setRebuilding(false);
      }
    }
  }

  async function handleUploadFiles() {
    if (selectedFiles.length === 0) return;
    const viewVersion = viewVersionRef.current;
    setUploading(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await uploadKnowledgeSetFiles(knowledgeSet.id, selectedFiles);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setItemsReady(true);
      clearUploadSelections();
      setSuccessText("文件已上传");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "上传文件失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setUploading(false);
      }
    }
  }

  async function handleUploadArchive() {
    if (!selectedArchive) return;
    const viewVersion = viewVersionRef.current;
    setUploading(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await uploadKnowledgeSetArchive(knowledgeSet.id, selectedArchive.name, selectedArchive);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setItemsReady(true);
      clearUploadSelections();
      setSuccessText("压缩包已导入");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "导入压缩包失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setUploading(false);
      }
    }
  }

  async function handleDeleteItem(relativePath: string) {
    const viewVersion = viewVersionRef.current;
    setMutatingItemPath(relativePath);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await deleteKnowledgeSetItem(knowledgeSet.id, relativePath);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setSuccessText("文件已删除");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "删除文件失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setMutatingItemPath(null);
      }
    }
  }

  async function handleRenameItem(relativePath: string, nextRelativePath: string) {
    const viewVersion = viewVersionRef.current;
    setMutatingItemPath(relativePath);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await renameKnowledgeSetItem(knowledgeSet.id, relativePath, nextRelativePath);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setSuccessText("文件已重命名");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "重命名文件失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setMutatingItemPath(null);
      }
    }
  }

  const busy = saving || uploading || rebuilding || Boolean(mutatingItemPath);
  const sourceTypeChanged = sourceType !== knowledgeSet.sourceType;
  const fileOpsDisabled = busy || !itemsReady || sourceTypeChanged;

  return (
    <div className="resource-center-detail-stack">
      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{knowledgeSet.name}</h3>
            <p>维护资料集元数据、文件清单、上传导入和资源授权。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        <div className="resource-center-form-grid">
          <label className="field">
            <span className="field-label">资料集名称</span>
            <input className="field-input" aria-label="资料集名称" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">资料集 slug</span>
            <input className="field-input" aria-label="资料集 slug" value={slug} disabled={busy} onChange={(event) => setSlug(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">资料集类型</span>
            <select className="field-input" aria-label="资料集类型" value={sourceType} disabled={busy} onChange={(event) => setSourceType(event.target.value)}>
              <option value="filesystem">filesystem</option>
              <option value="managed_upload">managed_upload</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">资料集状态</span>
            <select className="field-input" aria-label="资料集状态" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>

          {sourceType === "filesystem" ? (
            <label className="field resource-center-form-span-2">
              <span className="field-label">根目录</span>
              <input className="field-input" aria-label="根目录" value={rootPath} disabled={busy} onChange={(event) => setRootPath(event.target.value)} />
            </label>
          ) : (
            <label className="field resource-center-form-span-2">
              <span className="field-label">存储键</span>
              <input className="field-input" aria-label="存储键" value={storageKey} disabled={busy} onChange={(event) => setStorageKey(event.target.value)} />
            </label>
          )}

          <label className="field resource-center-form-span-2">
            <span className="field-label">资料集描述</span>
            <textarea
              className="field-input textarea"
              aria-label="资料集描述"
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="resource-center-actions">
          <Button type="primary" disabled={busy} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存资料集配置"}
          </Button>
        </div>
      </Card>

      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>文件清单</h3>
            <p>支持重建文件清单，并对单个文件执行删除和重命名。</p>
          </div>
          <Button type="default" disabled={busy || loadingItems || sourceTypeChanged} onClick={() => void handleRebuild()}>
            {rebuilding ? "重建中..." : "重建资料清单"}
          </Button>
        </div>

        {sourceTypeChanged ? (
          <p className="resource-center-subtle">资料集类型已修改，保存配置后再执行上传、重建和文件操作。</p>
        ) : null}

        {sourceType === "managed_upload" ? (
          <div className="knowledge-set-upload-grid">
            <label className="field">
              <span className="field-label">上传资料文件</span>
              <input
                ref={filesInputRef}
                className="field-input"
                aria-label="上传资料文件"
                type="file"
                multiple
                disabled={busy || loadingItems || !itemsReady || sourceTypeChanged}
                onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <div className="resource-center-actions">
              <Button
                type="default"
                disabled={busy || loadingItems || !itemsReady || sourceTypeChanged || selectedFiles.length === 0}
                onClick={() => void handleUploadFiles()}
              >
                上传文件
              </Button>
            </div>

            <label className="field">
              <span className="field-label">上传压缩包</span>
              <input
                ref={archiveInputRef}
                className="field-input"
                aria-label="上传压缩包"
                type="file"
                accept=".zip,application/zip,application/octet-stream"
                disabled={busy || loadingItems || !itemsReady || sourceTypeChanged}
                onChange={(event) => setSelectedArchive(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="resource-center-actions">
              <Button
                type="default"
                disabled={busy || loadingItems || !itemsReady || sourceTypeChanged || !selectedArchive}
                onClick={() => void handleUploadArchive()}
              >
                上传压缩包
              </Button>
            </div>
          </div>
        ) : null}

        {loadingItems ? <p className="resource-center-subtle">加载资料集文件清单中...</p> : null}

        {!loadingItems ? (
          <KnowledgeSetFileTree
            items={items}
            disabled={fileOpsDisabled}
            requireRenameConfirm={knowledgeSet.sourceType === "filesystem"}
            onDelete={handleDeleteItem}
            onRename={handleRenameItem}
          />
        ) : null}
      </Card>

      <ResourcePolicyEditor resourceType="knowledge_set" resourceId={knowledgeSet.id} title="资料集资源策略编辑器" />
    </div>
  );
}
