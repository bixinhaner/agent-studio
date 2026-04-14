import { DeleteOutlined, FolderOpenOutlined, InboxOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Drawer, Empty, Input, Progress, Select, Switch, Tag, Typography, Upload } from "antd";
import type { UploadFile, UploadProps } from "antd";

import {
  deleteKnowledgeSet,
  deleteKnowledgeSetItem,
  fetchKnowledgeSetFileText,
  fetchKnowledgeSetLibrary,
  rebuildKnowledgeSet,
  renameKnowledgeSetItem,
  updateKnowledgeSet,
  uploadKnowledgeSetArchive,
  uploadKnowledgeSetFiles
} from "./api";
import { openWarningConfirm } from "../../lib/warning-modal";
import { KnowledgeSetFileTree } from "./KnowledgeSetFileTree";
import { ResourcePolicyEditor } from "./ResourcePolicyEditor";
import type {
  KnowledgeSetDocumentRecord,
  KnowledgeSetDocumentStatus,
  KnowledgeSetLibraryResponse,
  KnowledgeSetRecord
} from "./types";

type KnowledgeSetDetailViewProps = {
  knowledgeSet: KnowledgeSetRecord;
  onKnowledgeSetUpdated: (knowledgeSet: KnowledgeSetRecord) => void;
  onKnowledgeSetDeleted: (knowledgeSetId: string, warnings?: string[]) => void;
};

type UploadTaskStatus = "pending" | "uploading" | "success" | "error" | "skipped";

type UploadTask = {
  uid: string;
  name: string;
  sizeBytes: number;
  status: UploadTaskStatus;
  progress: number;
  error?: string;
};

type SelectedFileEntry = {
  uid: string;
  file: NonNullable<UploadFile["originFileObj"]>;
};

type ConflictStrategy = "overwrite" | "skip";
type DocumentStatusFilter = "all" | "ready" | "warning";

const CONFLICT_STRATEGY_OPTIONS: Array<{ label: string; value: ConflictStrategy }> = [
  { label: "覆盖同名文件", value: "overwrite" },
  { label: "跳过同名文件", value: "skip" }
];

const DOCUMENT_STATUS_OPTIONS: Array<{ label: string; value: DocumentStatusFilter }> = [
  { label: "全部文档", value: "all" },
  { label: "仅异常", value: "warning" },
  { label: "仅正常", value: "ready" }
];

function taskTagColor(status: UploadTaskStatus): string {
  if (status === "success") return "success";
  if (status === "error") return "error";
  if (status === "uploading") return "processing";
  if (status === "skipped") return "warning";
  return "default";
}

function taskLabel(status: UploadTaskStatus): string {
  if (status === "success") return "已完成";
  if (status === "error") return "失败";
  if (status === "uploading") return "上传中";
  if (status === "skipped") return "已跳过";
  return "待上传";
}

function formatLocalDateTime(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function formatSize(sizeBytes?: number | string) {
  const value = typeof sizeBytes === "number" ? sizeBytes : Number(sizeBytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function documentStatusTag(status: KnowledgeSetDocumentStatus) {
  if (status === "ready") return <Tag color="success">完整</Tag>;
  if (status === "missing_meta") return <Tag color="warning">缺少 meta.json</Tag>;
  if (status === "missing_doc") return <Tag color="error">缺少 doc.md</Tag>;
  return <Tag color="default">结构异常</Tag>;
}

function matchesDocumentStatus(record: KnowledgeSetDocumentRecord, filter: DocumentStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return record.status === "ready";
  return record.status !== "ready";
}

function matchesSearch(input: string, values: Array<string | undefined>) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => (value || "").toLowerCase().includes(normalized));
}

function previewContent(text: string): string {
  if (!text.trim()) return "正文为空。";
  return text.length > 12000 ? `${text.slice(0, 12000)}\n\n…已截断预览` : text;
}

export function KnowledgeSetDetailView({
  knowledgeSet,
  onKnowledgeSetUpdated,
  onKnowledgeSetDeleted
}: KnowledgeSetDetailViewProps) {
  const [name, setName] = useState(knowledgeSet.name);
  const [description, setDescription] = useState(knowledgeSet.description || "");
  const [status, setStatus] = useState(knowledgeSet.status);
  const [library, setLibrary] = useState<KnowledgeSetLibraryResponse | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [libraryReloadKey, setLibraryReloadKey] = useState(0);
  const [documentSearch, setDocumentSearch] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState("__all__");
  const [documentStatusFilter, setDocumentStatusFilter] = useState<DocumentStatusFilter>("all");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErrorText, setPreviewErrorText] = useState("");
  const [rawBrowserOpen, setRawBrowserOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [mutatingItemPath, setMutatingItemPath] = useState<string | null>(null);
  const [selectedFileList, setSelectedFileList] = useState<UploadFile[]>([]);
  const [selectedArchiveList, setSelectedArchiveList] = useState<UploadFile[]>([]);
  const [fileUploadTasks, setFileUploadTasks] = useState<UploadTask[]>([]);
  const [archiveUploadTask, setArchiveUploadTask] = useState<UploadTask | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>("overwrite");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const viewVersionRef = useRef(0);

  useEffect(() => {
    setName(knowledgeSet.name);
    setDescription(knowledgeSet.description || "");
    setStatus(knowledgeSet.status);
  }, [knowledgeSet]);

  useEffect(() => {
    viewVersionRef.current += 1;
    setLibrary(null);
    setLoadingLibrary(true);
    setDocumentSearch("");
    setDirectoryFilter("__all__");
    setDocumentStatusFilter("all");
    setSelectedDocumentId(null);
    setPreviewText("");
    setPreviewErrorText("");
    setSaving(false);
    setDeleting(false);
    setUploading(false);
    setRebuilding(false);
    setMutatingItemPath(null);
    setSelectedFileList([]);
    setSelectedArchiveList([]);
    setFileUploadTasks([]);
    setArchiveUploadTask(null);
    setConflictStrategy("overwrite");
    setRawBrowserOpen(false);
    setSuccessText("");
    setErrorText("");
    setLibraryReloadKey(0);
  }, [knowledgeSet.id]);

  function isCurrentView(version: number) {
    return viewVersionRef.current === version;
  }

  useEffect(() => {
    let active = true;

    async function loadLibrary() {
      setLoadingLibrary(true);
      setErrorText("");
      try {
        const response = await fetchKnowledgeSetLibrary(knowledgeSet.id);
        if (!active) return;
        setLibrary(response);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载文档视图失败");
          setLibrary(null);
        }
      } finally {
        if (active) {
          setLoadingLibrary(false);
        }
      }
    }

    void loadLibrary();
    return () => {
      active = false;
    };
  }, [knowledgeSet.id, libraryReloadKey]);

  const directoryOptions = useMemo(
    () => [
      { label: "全部目录", value: "__all__" },
      ...((library?.directories ?? []).map((item) => ({
        label: `${item.label} (${item.documentCount})`,
        value: item.path || "__root__"
      })) ?? [])
    ],
    [library]
  );

  const filteredDocuments = useMemo(() => {
    return (library?.documents ?? []).filter((record) => {
      const matchesDirectory =
        directoryFilter === "__all__" ||
        (directoryFilter === "__root__" ? !record.topLevelDirectory : record.topLevelDirectory === directoryFilter);
      if (!matchesDirectory) return false;
      if (!matchesDocumentStatus(record, documentStatusFilter)) return false;
      return matchesSearch(documentSearch, [record.title, record.relativePath, record.directoryPath, record.docPath]);
    });
  }, [documentSearch, documentStatusFilter, directoryFilter, library]);

  useEffect(() => {
    if (!filteredDocuments.length) {
      setSelectedDocumentId(null);
      return;
    }
    if (!selectedDocumentId || !filteredDocuments.some((record) => record.id === selectedDocumentId)) {
      setSelectedDocumentId(filteredDocuments[0].id);
    }
  }, [filteredDocuments, selectedDocumentId]);

  const selectedDocument =
    filteredDocuments.find((record) => record.id === selectedDocumentId) ||
    library?.documents.find((record) => record.id === selectedDocumentId) ||
    null;

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      if (!selectedDocument?.docPath) {
        setPreviewText("");
        setPreviewErrorText(selectedDocument ? "该文档没有可预览的正文文件。" : "");
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      setPreviewErrorText("");
      try {
        const text = await fetchKnowledgeSetFileText(knowledgeSet.id, selectedDocument.docPath);
        if (!active) return;
        setPreviewText(previewContent(text));
      } catch (error) {
        if (active) {
          setPreviewText("");
          setPreviewErrorText(error instanceof Error ? error.message : "加载正文预览失败");
        }
      } finally {
        if (active) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreview();
    return () => {
      active = false;
    };
  }, [knowledgeSet.id, selectedDocument?.docPath]);

  const selectedFileEntries: SelectedFileEntry[] = selectedFileList.reduce<SelectedFileEntry[]>((result, item) => {
    if (item.originFileObj) {
      result.push({ uid: item.uid, file: item.originFileObj });
    }
    return result;
  }, []);

  const selectedFiles = selectedFileEntries.map((entry) => entry.file);
  const selectedArchive = selectedArchiveList[0]?.originFileObj ?? null;

  const busy = saving || deleting || uploading || rebuilding || Boolean(mutatingItemPath);
  const uploadDisabled = uploading || saving || rebuilding || Boolean(mutatingItemPath) || loadingLibrary || !library;
  const fileOpsDisabled = busy || loadingLibrary || !library;
  const statusEnabled = status === "active";

  const fileUploadProps: UploadProps = {
    multiple: true,
    beforeUpload: () => false,
    fileList: selectedFileList,
    disabled: uploadDisabled,
    onChange: ({ fileList }) => {
      setErrorText("");
      setSuccessText("");
      setSelectedFileList(fileList);
      setFileUploadTasks(
        fileList
          .map((item, index) => {
            const origin = item.originFileObj;
            if (!origin) return null;
            return {
              uid: item.uid || `${origin.name}-${index}`,
              name: origin.name,
              sizeBytes: origin.size,
              status: "pending" as UploadTaskStatus,
              progress: 0
            };
          })
          .filter((task): task is UploadTask => Boolean(task))
      );
    }
  };

  const archiveUploadProps: UploadProps = {
    multiple: false,
    maxCount: 1,
    accept: ".zip,application/zip,application/octet-stream",
    beforeUpload: (file) => {
      if (file.name.toLowerCase().endsWith(".zip")) {
        return false;
      }
      setErrorText("仅支持 .zip 压缩包");
      return Upload.LIST_IGNORE;
    },
    fileList: selectedArchiveList,
    disabled: uploadDisabled,
    onChange: ({ fileList }) => {
      setErrorText("");
      setSuccessText("");
      setSelectedArchiveList(fileList.slice(-1));
      const archive = fileList.slice(-1)[0]?.originFileObj;
      setArchiveUploadTask(
        archive
          ? {
              uid: fileList.slice(-1)[0]?.uid ?? `${archive.name}-archive`,
              name: archive.name,
              sizeBytes: archive.size,
              status: "pending",
              progress: 0
            }
          : null
      );
    }
  };

  function patchFileTask(uid: string, patch: Partial<UploadTask>) {
    setFileUploadTasks((current) => current.map((task) => (task.uid === uid ? { ...task, ...patch } : task)));
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorText("资料集名称不能为空");
      return;
    }
    const viewVersion = viewVersionRef.current;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await updateKnowledgeSet(knowledgeSet.id, {
        name: trimmedName,
        description: description.trim(),
        status
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
      await rebuildKnowledgeSet(knowledgeSet.id);
      if (!isCurrentView(viewVersion)) return;
      setLibraryReloadKey((current) => current + 1);
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

  async function handleDeleteKnowledgeSet() {
    const confirmed = await openWarningConfirm({
      title: "确认删除资料集",
      content: `确认删除资料集「${knowledgeSet.name}」吗？`,
      description: "将删除资料集记录、文件目录和关联授权策略，操作不可恢复。",
      dangerLevel: "danger",
      okText: "删除资料集",
      cancelText: "取消",
      okButtonDanger: true
    });
    if (!confirmed) return;

    const viewVersion = viewVersionRef.current;
    setDeleting(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await deleteKnowledgeSet(knowledgeSet.id);
      if (!isCurrentView(viewVersion)) return;
      onKnowledgeSetDeleted(response.deletedId, response.warnings);
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        setErrorText(error instanceof Error ? error.message : "删除资料集失败");
      }
    } finally {
      if (isCurrentView(viewVersion)) {
        setDeleting(false);
      }
    }
  }

  async function runFileUploadQueue(targetStatuses: UploadTaskStatus[]) {
    if (selectedFileEntries.length === 0) return;
    const viewVersion = viewVersionRef.current;
    setUploading(true);
    setErrorText("");
    setSuccessText("");

    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const existingNames = new Set((library?.knownFileNames ?? []).filter(Boolean));

    for (const entry of selectedFileEntries) {
      const task = fileUploadTasks.find((currentTask) => currentTask.uid === entry.uid);
      if (!task || !targetStatuses.includes(task.status)) continue;

      if (conflictStrategy === "skip" && existingNames.has(entry.file.name)) {
        skippedCount += 1;
        patchFileTask(entry.uid, { status: "skipped", progress: 100, error: undefined });
        continue;
      }

      patchFileTask(entry.uid, { status: "uploading", progress: 20, error: undefined });
      try {
        await uploadKnowledgeSetFiles(knowledgeSet.id, [entry.file]);
        if (!isCurrentView(viewVersion)) return;
        existingNames.add(entry.file.name);
        succeededCount += 1;
        patchFileTask(entry.uid, { status: "success", progress: 100, error: undefined });
      } catch (error) {
        if (!isCurrentView(viewVersion)) return;
        failedCount += 1;
        patchFileTask(entry.uid, {
          status: "error",
          progress: 100,
          error: error instanceof Error ? error.message : "上传失败"
        });
      }
    }

    if (!isCurrentView(viewVersion)) return;
    setLibraryReloadKey((current) => current + 1);
    if (failedCount > 0) {
      setErrorText(`上传完成：成功 ${succeededCount}，失败 ${failedCount}，跳过 ${skippedCount}`);
    } else {
      setSuccessText(`上传完成：成功 ${succeededCount}，跳过 ${skippedCount}`);
    }
    setUploading(false);
  }

  async function handleUploadFiles() {
    await runFileUploadQueue(["pending", "error", "skipped"]);
  }

  async function handleRetryFailedFiles() {
    await runFileUploadQueue(["error"]);
  }

  async function handleUploadArchive() {
    if (!selectedArchive) return;
    const viewVersion = viewVersionRef.current;
    setUploading(true);
    setErrorText("");
    setSuccessText("");
    setArchiveUploadTask((current) => (current ? { ...current, status: "uploading", progress: 20, error: undefined } : current));
    try {
      await uploadKnowledgeSetArchive(knowledgeSet.id, selectedArchive.name, selectedArchive);
      if (!isCurrentView(viewVersion)) return;
      setLibraryReloadKey((current) => current + 1);
      setArchiveUploadTask((current) => (current ? { ...current, status: "success", progress: 100, error: undefined } : current));
      setSuccessText("压缩包已导入");
    } catch (error) {
      if (isCurrentView(viewVersion)) {
        const message = error instanceof Error ? error.message : "导入压缩包失败";
        setArchiveUploadTask((current) => (current ? { ...current, status: "error", progress: 100, error: message } : current));
        setErrorText(message);
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
      await deleteKnowledgeSetItem(knowledgeSet.id, relativePath);
      if (!isCurrentView(viewVersion)) return;
      setLibraryReloadKey((current) => current + 1);
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
      await renameKnowledgeSetItem(knowledgeSet.id, relativePath, nextRelativePath);
      if (!isCurrentView(viewVersion)) return;
      setLibraryReloadKey((current) => current + 1);
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

  return (
    <div className="resource-center-detail-stack">
      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{knowledgeSet.name}</h3>
            <p>维护资料集元数据、文档视图、上传导入和资源授权。</p>
          </div>
          <Tag color={statusEnabled ? "success" : "default"}>{statusEnabled ? "已启用" : "已停用"}</Tag>
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        <div className="resource-center-form-grid">
          <label className="field">
            <span className="field-label">资料集名称</span>
            <Input aria-label="资料集名称" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">系统标识（slug）</span>
            <Input aria-label="资料集 slug" value={knowledgeSet.slug} disabled />
          </label>

          <label className="field">
            <span className="field-label">资料来源</span>
            <Input aria-label="资料来源" value="托管上传" disabled />
          </label>

          <label className="field checkbox-field resource-center-toggle-row resource-center-form-span-2">
            <Switch
              checked={statusEnabled}
              disabled={busy}
              checkedChildren="启用"
              unCheckedChildren="停用"
              onChange={(checked) => setStatus(checked ? "active" : "disabled")}
            />
            <span>
              <span className="field-label">资料集状态</span>
              <span className="field-help">关闭后，资料集不会出现在会话可选资源中。</span>
            </span>
          </label>

          <label className="field resource-center-form-span-2">
            <span className="field-label">资料集描述</span>
            <Input.TextArea
              aria-label="资料集描述"
              value={description}
              disabled={busy}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="resource-center-actions">
          <Button type="primary" disabled={busy} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存资料集配置"}
          </Button>
          <Button danger icon={<DeleteOutlined />} disabled={busy} onClick={() => void handleDeleteKnowledgeSet()}>
            {deleting ? "删除中..." : "删除资料集"}
          </Button>
        </div>
      </Card>

      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>文档视图</h3>
            <p>默认按文档单元查看正文和健康度，原始文件树降级到抽屉中按需浏览。</p>
          </div>
          <div className="resource-center-actions">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              disabled={busy || loadingLibrary}
              onClick={() => void handleRebuild()}
            >
              {rebuilding ? "重建中..." : "重建资料清单"}
            </Button>
            <Button
              type="default"
              icon={<FolderOpenOutlined />}
              disabled={fileOpsDisabled}
              onClick={() => setRawBrowserOpen(true)}
            >
              查看原始文件
            </Button>
          </div>
        </div>

        {loadingLibrary ? <p className="resource-center-subtle">加载文档视图中...</p> : null}

        {library ? (
          <>
            <div className="knowledge-set-summary-grid">
              <article className="knowledge-set-summary-card">
                <span className="knowledge-set-summary-label">文档总数</span>
                <strong className="knowledge-set-summary-value">{library.summary.totalDocuments}</strong>
                <span className="knowledge-set-summary-note">按 `doc.md` / Markdown 单元聚合</span>
              </article>
              <article className="knowledge-set-summary-card">
                <span className="knowledge-set-summary-label">结构完整</span>
                <strong className="knowledge-set-summary-value">{library.summary.readyDocuments}</strong>
                <span className="knowledge-set-summary-note">具备可直接检索的正文入口</span>
              </article>
              <article className="knowledge-set-summary-card warning">
                <span className="knowledge-set-summary-label">异常文档</span>
                <strong className="knowledge-set-summary-value">{library.summary.warningDocuments}</strong>
                <span className="knowledge-set-summary-note">缺少 `doc.md`、`meta.json` 或结构不完整</span>
              </article>
              <article className="knowledge-set-summary-card">
                <span className="knowledge-set-summary-label">可见文件</span>
                <strong className="knowledge-set-summary-value">{library.summary.totalVisibleFiles}</strong>
                <span className="knowledge-set-summary-note">
                  已隐藏 {library.summary.ignoredJsonlFileCount} 个 `.jsonl`
                </span>
              </article>
            </div>

            <div className="knowledge-set-document-toolbar">
              <Input
                aria-label="搜索文档"
                placeholder="搜索标题、路径、目录"
                value={documentSearch}
                onChange={(event) => setDocumentSearch(event.target.value)}
              />
              <Select
                aria-label="目录筛选"
                value={directoryFilter}
                options={directoryOptions}
                onChange={setDirectoryFilter}
              />
              <Select
                aria-label="文档状态筛选"
                value={documentStatusFilter}
                options={DOCUMENT_STATUS_OPTIONS}
                onChange={(value) => setDocumentStatusFilter(value)}
              />
            </div>

            <div className="knowledge-set-document-layout">
              <div className="knowledge-set-document-list">
                {filteredDocuments.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有文档。" />
                ) : (
                  filteredDocuments.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      className={`knowledge-set-document-card${record.id === selectedDocument?.id ? " active" : ""}`}
                      onClick={() => setSelectedDocumentId(record.id)}
                    >
                      <div className="knowledge-set-document-card-head">
                        <div>
                          <strong>{record.title}</strong>
                          <span className="knowledge-set-document-card-path">{record.relativePath || "根目录"}</span>
                        </div>
                        {documentStatusTag(record.status)}
                      </div>
                      <div className="knowledge-set-document-card-meta">
                        <span>{record.totalFiles} 个文件</span>
                        <span>{record.mediaFileCount} 个媒体文件</span>
                        <span>更新于 {formatLocalDateTime(record.updatedAt)}</span>
                      </div>
                      <div className="knowledge-set-document-card-tags">
                        <Tag>{record.topLevelDirectory || "根目录"}</Tag>
                        {record.hasDocMarkdown ? <Tag color="blue">有正文</Tag> : null}
                        {record.hasMetaJson ? <Tag color="cyan">有 meta</Tag> : null}
                        {record.sourceArchiveNames[0] ? <Tag>来源 {record.sourceArchiveNames[0]}</Tag> : null}
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="knowledge-set-document-preview-panel">
                {selectedDocument ? (
                  <>
                    <div className="knowledge-set-document-preview-head">
                      <div>
                        <h4>{selectedDocument.title}</h4>
                        <p>{selectedDocument.docPath || selectedDocument.relativePath || "暂无正文路径"}</p>
                      </div>
                      {documentStatusTag(selectedDocument.status)}
                    </div>
                    <div className="knowledge-set-document-preview-meta">
                      <span>目录：{selectedDocument.directoryPath || "根目录"}</span>
                      <span>Markdown：{selectedDocument.markdownFileCount}</span>
                      <span>媒体：{selectedDocument.mediaFileCount}</span>
                      <span>更新时间：{formatLocalDateTime(selectedDocument.updatedAt)}</span>
                    </div>
                    {previewLoading ? <p className="resource-center-subtle">加载正文预览中...</p> : null}
                    {previewErrorText ? <Alert type="warning" showIcon message={previewErrorText} /> : null}
                    {!previewLoading && !previewErrorText ? (
                      <pre className="knowledge-set-document-preview-body">{previewText || "暂无正文可预览。"}</pre>
                    ) : null}
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧文档后查看正文预览。" />
                )}
              </div>
            </div>
          </>
        ) : null}
      </Card>

      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>上传与导入</h3>
            <p>上传单文件或导入 ZIP 压缩包后，文档视图会自动刷新。</p>
          </div>
        </div>

        <div className="knowledge-set-upload-grid">
          <label className="field knowledge-set-upload-field">
            <span className="field-label">上传资料文件</span>
            <Upload.Dragger aria-label="上传资料文件" className="knowledge-set-upload-dragger" {...fileUploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">拖拽或点击选择资料文件</p>
              <p className="ant-upload-hint">支持多文件选择，确认后手动上传。</p>
            </Upload.Dragger>
            <Typography.Text type="secondary" className="resource-center-inline-muted">
              {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : "尚未选择文件"}
            </Typography.Text>
          </label>
          <div className="resource-center-actions knowledge-set-upload-actions">
            <label className="field knowledge-set-inline-field">
              <span className="field-label">冲突策略</span>
              <Select
                value={conflictStrategy}
                options={CONFLICT_STRATEGY_OPTIONS}
                disabled={uploadDisabled || selectedFiles.length === 0}
                onChange={(value) => setConflictStrategy(value)}
              />
            </label>
            <Button type="default" disabled={uploadDisabled || selectedFiles.length === 0} onClick={() => void handleUploadFiles()}>
              上传文件
            </Button>
            <Button
              type="default"
              disabled={uploadDisabled || !fileUploadTasks.some((task) => task.status === "error")}
              onClick={() => void handleRetryFailedFiles()}
            >
              重试失败项
            </Button>
            <Button
              type="default"
              disabled={uploadDisabled || selectedFiles.length === 0}
              onClick={() => {
                setSelectedFileList([]);
                setFileUploadTasks([]);
              }}
            >
              清空选择
            </Button>
          </div>

          {fileUploadTasks.length > 0 ? (
            <div className="knowledge-set-upload-task-list knowledge-set-upload-full-row">
              {fileUploadTasks.map((task) => (
                <article key={task.uid} className="knowledge-set-upload-task-item">
                  <div className="knowledge-set-upload-task-head">
                    <div>
                      <Typography.Text strong>{task.name}</Typography.Text>
                      <Typography.Text type="secondary" className="resource-center-inline-muted">
                        {formatSize(task.sizeBytes)}
                      </Typography.Text>
                    </div>
                    <Tag color={taskTagColor(task.status)}>{taskLabel(task.status)}</Tag>
                  </div>
                  <Progress
                    percent={task.progress}
                    status={task.status === "error" ? "exception" : task.status === "success" ? "success" : "active"}
                    size="small"
                  />
                  {task.error ? <Typography.Text type="danger">{task.error}</Typography.Text> : null}
                </article>
              ))}
            </div>
          ) : null}

          <label className="field knowledge-set-upload-field">
            <span className="field-label">上传压缩包</span>
            <Upload.Dragger aria-label="上传压缩包" className="knowledge-set-upload-dragger" {...archiveUploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">拖拽或点击选择 ZIP 压缩包</p>
              <p className="ant-upload-hint">仅支持 `.zip`，导入后会自动更新文档视图。</p>
            </Upload.Dragger>
            <Typography.Text type="secondary" className="resource-center-inline-muted">
              {selectedArchive ? `已选择：${selectedArchive.name}` : "尚未选择压缩包"}
            </Typography.Text>
          </label>
          <div className="resource-center-actions knowledge-set-upload-actions">
            <Button type="default" disabled={uploadDisabled || !selectedArchive} onClick={() => void handleUploadArchive()}>
              上传压缩包
            </Button>
            <Button
              type="default"
              disabled={uploadDisabled || archiveUploadTask?.status !== "error"}
              onClick={() => void handleUploadArchive()}
            >
              重试压缩包
            </Button>
            <Button
              type="default"
              disabled={uploadDisabled || !selectedArchive}
              onClick={() => {
                setSelectedArchiveList([]);
                setArchiveUploadTask(null);
              }}
            >
              清空选择
            </Button>
          </div>

          {archiveUploadTask ? (
            <div className="knowledge-set-upload-task-list knowledge-set-upload-full-row">
              <article className="knowledge-set-upload-task-item">
                <div className="knowledge-set-upload-task-head">
                  <div>
                    <Typography.Text strong>{archiveUploadTask.name}</Typography.Text>
                    <Typography.Text type="secondary" className="resource-center-inline-muted">
                      {formatSize(archiveUploadTask.sizeBytes)}
                    </Typography.Text>
                  </div>
                  <Tag color={taskTagColor(archiveUploadTask.status)}>{taskLabel(archiveUploadTask.status)}</Tag>
                </div>
                <Progress
                  percent={archiveUploadTask.progress}
                  status={archiveUploadTask.status === "error" ? "exception" : archiveUploadTask.status === "success" ? "success" : "active"}
                  size="small"
                />
                {archiveUploadTask.error ? <Typography.Text type="danger">{archiveUploadTask.error}</Typography.Text> : null}
              </article>
            </div>
          ) : null}
        </div>
      </Card>

      <ResourcePolicyEditor resourceType="knowledge_set" resourceId={knowledgeSet.id} title="资料集资源策略编辑器" />

      <Drawer
        title="原始文件"
        open={rawBrowserOpen}
        onClose={() => setRawBrowserOpen(false)}
        width={760}
        destroyOnClose={false}
      >
        <Typography.Paragraph type="secondary">
          这里只展示原始文件系统视角，默认隐藏 `.jsonl`。日常核查优先使用上方文档视图。
        </Typography.Paragraph>
        <KnowledgeSetFileTree
          knowledgeSetId={knowledgeSet.id}
          disabled={fileOpsDisabled}
          reloadKey={libraryReloadKey}
          onDelete={handleDeleteItem}
          onRename={handleRenameItem}
        />
      </Drawer>
    </div>
  );
}
