import { useEffect, useRef, useState } from "react";

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
  const [status, setStatus] = useState(knowledgeSet.status);
  const [rootPath, setRootPath] = useState(knowledgeSet.rootPath || "");
  const [storageKey, setStorageKey] = useState(knowledgeSet.storageKey || "");
  const [items, setItems] = useState<KnowledgeSetItemRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsReady, setItemsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedArchive, setSelectedArchive] = useState<File | null>(null);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(knowledgeSet.name);
    setSlug(knowledgeSet.slug);
    setDescription(knowledgeSet.description || "");
    setStatus(knowledgeSet.status);
    setRootPath(knowledgeSet.rootPath || "");
    setStorageKey(knowledgeSet.storageKey || "");
    setSelectedFiles([]);
    setSelectedArchive(null);
    setSuccessText("");
    setErrorText("");
  }, [knowledgeSet]);

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

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await updateKnowledgeSet(knowledgeSet.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        status,
        ...(knowledgeSet.sourceType === "filesystem"
          ? { rootPath: rootPath.trim() }
          : { storageKey: storageKey.trim() })
      });
      onKnowledgeSetUpdated(response.knowledgeSet);
      setSuccessText("资料集配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存资料集配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await rebuildKnowledgeSet(knowledgeSet.id);
      setItems(response.items);
      setItemsReady(true);
      setSuccessText("资料集文件清单已重建");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "重建资料集文件清单失败");
    } finally {
      setRebuilding(false);
    }
  }

  async function handleUploadFiles() {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await uploadKnowledgeSetFiles(knowledgeSet.id, selectedFiles);
      setItems(response.items);
      setItemsReady(true);
      clearUploadSelections();
      setSuccessText("文件已上传");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "上传文件失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadArchive() {
    if (!selectedArchive) return;
    setUploading(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await uploadKnowledgeSetArchive(knowledgeSet.id, selectedArchive.name, selectedArchive);
      setItems(response.items);
      setItemsReady(true);
      clearUploadSelections();
      setSuccessText("压缩包已导入");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "导入压缩包失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteItem(relativePath: string) {
    setErrorText("");
    setSuccessText("");
    try {
      const response = await deleteKnowledgeSetItem(knowledgeSet.id, relativePath);
      setItems(response.items);
      setSuccessText("文件已删除");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "删除文件失败");
    }
  }

  async function handleRenameItem(relativePath: string, nextRelativePath: string) {
    setErrorText("");
    setSuccessText("");
    try {
      const response = await renameKnowledgeSetItem(knowledgeSet.id, relativePath, nextRelativePath);
      setItems(response.items);
      setSuccessText("文件已重命名");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "重命名文件失败");
    }
  }

  const busy = saving || uploading || rebuilding;

  return (
    <div className="resource-center-detail-stack">
      <section className="resource-center-section">
        <div className="resource-center-section-header">
          <div>
            <h3>{knowledgeSet.name}</h3>
            <p>维护资料集元数据、文件清单、上传导入和资源授权。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        {errorText ? <p className="err-text">{errorText}</p> : null}
        {successText ? <p className="resource-center-success">{successText}</p> : null}

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
            <span className="field-label">资料集状态</span>
            <select className="field-input" aria-label="资料集状态" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>

          {knowledgeSet.sourceType === "filesystem" ? (
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
          <button type="button" className="admin-action-btn" disabled={busy} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存资料集配置"}
          </button>
        </div>
      </section>

      <section className="resource-center-section">
        <div className="resource-center-section-header">
          <div>
            <h3>文件清单</h3>
            <p>支持重建文件清单，并对单个文件执行删除和重命名。</p>
          </div>
          <button type="button" className="admin-secondary-btn" disabled={busy || loadingItems} onClick={() => void handleRebuild()}>
            {rebuilding ? "重建中..." : "重建资料清单"}
          </button>
        </div>

        {knowledgeSet.sourceType === "managed_upload" ? (
          <div className="knowledge-set-upload-grid">
            <label className="field">
              <span className="field-label">上传资料文件</span>
              <input
                ref={filesInputRef}
                className="field-input"
                aria-label="上传资料文件"
                type="file"
                multiple
                disabled={busy}
                onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <div className="resource-center-actions">
              <button type="button" className="admin-secondary-btn" disabled={busy || selectedFiles.length === 0} onClick={() => void handleUploadFiles()}>
                上传文件
              </button>
            </div>

            <label className="field">
              <span className="field-label">上传压缩包</span>
              <input
                ref={archiveInputRef}
                className="field-input"
                aria-label="上传压缩包"
                type="file"
                accept=".zip,application/zip,application/octet-stream"
                disabled={busy}
                onChange={(event) => setSelectedArchive(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="resource-center-actions">
              <button type="button" className="admin-secondary-btn" disabled={busy || !selectedArchive} onClick={() => void handleUploadArchive()}>
                上传压缩包
              </button>
            </div>
          </div>
        ) : null}

        {loadingItems ? <p className="resource-center-subtle">加载资料集文件清单中...</p> : null}

        {!loadingItems ? (
          <KnowledgeSetFileTree
            items={items}
            disabled={busy || !itemsReady}
            onDelete={handleDeleteItem}
            onRename={handleRenameItem}
          />
        ) : null}
      </section>

      <ResourcePolicyEditor resourceType="knowledge_set" resourceId={knowledgeSet.id} title="资料集资源策略编辑器" />
    </div>
  );
}
