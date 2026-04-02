import { InboxOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input, Progress, Select, Switch, Tag, Typography, Upload } from "antd";
import type { UploadFile, UploadProps } from "antd";

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

const CONFLICT_STRATEGY_OPTIONS: Array<{ label: string; value: ConflictStrategy }> = [
  { label: "覆盖同名文件", value: "overwrite" },
  { label: "跳过同名文件", value: "skip" }
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

export function KnowledgeSetDetailView({ knowledgeSet, onKnowledgeSetUpdated }: KnowledgeSetDetailViewProps) {
  const [name, setName] = useState(knowledgeSet.name);
  const [description, setDescription] = useState(knowledgeSet.description || "");
  const [status, setStatus] = useState(knowledgeSet.status);
  const [items, setItems] = useState<KnowledgeSetItemRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsReady, setItemsReady] = useState(false);
  const [saving, setSaving] = useState(false);
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
    setItems([]);
    setSaving(false);
    setUploading(false);
    setRebuilding(false);
    setMutatingItemPath(null);
    setSelectedFileList([]);
    setSelectedArchiveList([]);
    setFileUploadTasks([]);
    setArchiveUploadTask(null);
    setConflictStrategy("overwrite");
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
    setSelectedFileList([]);
    setSelectedArchiveList([]);
    setFileUploadTasks([]);
    setArchiveUploadTask(null);
  }

  function isCurrentView(version: number) {
    return viewVersionRef.current === version;
  }

  const selectedFileEntries: SelectedFileEntry[] = selectedFileList.reduce<SelectedFileEntry[]>((result, item) => {
    if (item.originFileObj) {
      result.push({ uid: item.uid, file: item.originFileObj });
    }
    return result;
  }, []);

  const selectedFiles = selectedFileEntries.map((entry) => entry.file);

  const selectedArchive = selectedArchiveList[0]?.originFileObj ?? null;

  const uploadDisabled = uploading || saving || rebuilding || Boolean(mutatingItemPath) || loadingItems || !itemsReady;

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

  async function runFileUploadQueue(targetStatuses: UploadTaskStatus[]) {
    if (selectedFileEntries.length === 0) return;
    const viewVersion = viewVersionRef.current;
    setUploading(true);
    setErrorText("");
    setSuccessText("");

    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let latestItems = items;
    const existingNames = new Set(
      latestItems
        .map((item) => {
          const segments = item.relativePath.split("/").filter(Boolean);
          return (segments.length > 0 ? segments[segments.length - 1] : item.displayName) || item.displayName;
        })
        .filter(Boolean)
    );

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
        const response = await uploadKnowledgeSetFiles(knowledgeSet.id, [entry.file]);
        if (!isCurrentView(viewVersion)) return;
        latestItems = response.items;
        existingNames.add(entry.file.name);
        succeededCount += 1;
        setItems(response.items);
        setItemsReady(true);
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
      const response = await uploadKnowledgeSetArchive(knowledgeSet.id, selectedArchive.name, selectedArchive);
      if (!isCurrentView(viewVersion)) return;
      setItems(response.items);
      setItemsReady(true);
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
  const fileOpsDisabled = busy || !itemsReady;
  const statusEnabled = status === "active";

  return (
    <div className="resource-center-detail-stack">
      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{knowledgeSet.name}</h3>
            <p>维护资料集元数据、文件清单、上传导入和资源授权。</p>
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
        </div>
      </Card>

      <Card className="resource-center-section antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>文件清单</h3>
            <p>支持重建文件清单，并对单个文件执行删除和重命名。</p>
          </div>
          <Button type="default" disabled={busy || loadingItems} onClick={() => void handleRebuild()}>
            {rebuilding ? "重建中..." : "重建资料清单"}
          </Button>
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
                        {`${task.sizeBytes} bytes`}
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
              <p className="ant-upload-hint">仅支持 `.zip`，导入后会自动更新文件清单。</p>
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
                      {`${archiveUploadTask.sizeBytes} bytes`}
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

        {loadingItems ? <p className="resource-center-subtle">加载资料集文件清单中...</p> : null}

        {!loadingItems ? (
          <KnowledgeSetFileTree
            items={items}
            disabled={fileOpsDisabled}
            requireRenameConfirm={false}
            onDelete={handleDeleteItem}
            onRename={handleRenameItem}
          />
        ) : null}
      </Card>

      <ResourcePolicyEditor resourceType="knowledge_set" resourceId={knowledgeSet.id} title="资料集资源策略编辑器" />
    </div>
  );
}
