import { Alert, Button, Checkbox, Input, Modal, Segmented, Tabs, Typography, message } from "antd";
import { Image as ImageIcon, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  previewAdminProductFeedbackReply,
  sendAdminProductFeedbackReplyAndResolve
} from "./api";
import type {
  AdminProductFeedbackDetailResponse,
  AdminProductFeedbackReplyLanguage,
  AdminProductFeedbackReplyResult
} from "./types";

export type ProductFeedbackReplySourceImage = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

type LocalizedContent = Record<AdminProductFeedbackReplyLanguage, {
  subject: string;
  bodyText: string;
}>;

const FALLBACK_LIMITS = {
  maxImages: 3,
  maxImageBytes: 2 * 1024 * 1024,
  mimeTypes: ["image/png", "image/jpeg", "image/gif"]
};

export function ProductFeedbackReplyModal(props: {
  open: boolean;
  detail: AdminProductFeedbackDetailResponse;
  sourceImages: ProductFeedbackReplySourceImage[];
  onClose(): void;
  onResolved(result: AdminProductFeedbackReplyResult): void;
}) {
  const draft = props.detail.reply?.draft;
  const limits = draft?.limits ?? FALLBACK_LIMITS;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<AdminProductFeedbackReplyLanguage>("zh");
  const [content, setContent] = useState<LocalizedContent>({
    zh: { subject: "", bodyText: "" },
    en: { subject: "", bodyText: "" }
  });
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState("edit");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [clientRequestId, setClientRequestId] = useState(() => createClientRequestId());

  useEffect(() => {
    if (!props.open || !draft) return;
    setLanguage(draft.defaultLanguage);
    setContent({
      zh: {
        subject: draft.templates.zh.subject,
        bodyText: draft.templates.zh.bodyText
      },
      en: {
        subject: draft.templates.en.subject,
        bodyText: draft.templates.en.bodyText
      }
    });
    setSelectedImageIds([]);
    setUploadedImages([]);
    setActiveTab("edit");
    setPreviewHtml("");
    setErrorText("");
    setClientRequestId(createClientRequestId());
  }, [draft, props.detail.feedback.id, props.open]);

  const selectedCount = selectedImageIds.length + uploadedImages.length;
  const sourceImageMap = useMemo(
    () => new Map(props.sourceImages.map((image) => [image.id, image] as const)),
    [props.sourceImages]
  );
  const current = content[language];

  const buildInput = () => ({
    subject: current.subject,
    bodyText: current.bodyText,
    templateLanguage: language,
    selectedImageIds,
    images: uploadedImages
  });

  const showPreview = async () => {
    setActiveTab("preview");
    setErrorText("");
    setPreviewLoading(true);
    try {
      const result = await previewAdminProductFeedbackReply(props.detail.feedback.id, buildInput());
      setPreviewHtml(result.html);
    } catch (error) {
      setPreviewHtml("");
      setErrorText(error instanceof Error ? error.message : "生成邮件预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendAndResolve = async () => {
    setErrorText("");
    setSending(true);
    try {
      const result = await sendAdminProductFeedbackReplyAndResolve(props.detail.feedback.id, {
        ...buildInput(),
        clientRequestId
      });
      props.onResolved(result);
      props.onClose();
      message.success(result.duplicate ? "邮件已发送，反馈状态已同步为已解决" : "邮件已发送，反馈已标记为已解决");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发送反馈回复失败");
    } finally {
      setSending(false);
    }
  };

  const toggleOriginalImage = (imageId: string, checked: boolean) => {
    if (checked && selectedCount >= limits.maxImages) {
      setErrorText(`邮件最多可插入 ${limits.maxImages} 张图片。`);
      return;
    }
    setErrorText("");
    setSelectedImageIds((currentIds) => checked
      ? [...new Set([...currentIds, imageId])]
      : currentIds.filter((id) => id !== imageId));
    setPreviewHtml("");
  };

  const addUploadedImages = (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files);
    const invalidType = nextFiles.find((file) => !limits.mimeTypes.includes(file.type));
    if (invalidType) {
      setErrorText(`${invalidType.name} 格式不受支持；请使用 PNG、JPG 或 GIF。`);
      return;
    }
    const tooLarge = nextFiles.find((file) => file.size > limits.maxImageBytes);
    if (tooLarge) {
      setErrorText(`${tooLarge.name} 超过 2 MB，请压缩后重新上传。`);
      return;
    }
    if (selectedCount + nextFiles.length > limits.maxImages) {
      setErrorText(`反馈原图与上传图片合计最多 ${limits.maxImages} 张。`);
      return;
    }
    setUploadedImages((currentFiles) => {
      const keys = new Set(currentFiles.map(fileKey));
      return [...currentFiles, ...nextFiles.filter((file) => !keys.has(fileKey(file)))];
    });
    setErrorText("");
    setPreviewHtml("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!draft) return null;

  const editContent = (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Typography.Text strong>回复语言</Typography.Text>
        <Segmented
          value={language}
          options={[
            { label: "中文", value: "zh" },
            { label: "English", value: "en" }
          ]}
          onChange={(value) => {
            setLanguage(value === "en" ? "en" : "zh");
            setPreviewHtml("");
          }}
        />
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <Typography.Text strong>收件人邮箱</Typography.Text>
        <Input value={draft.recipientEmail ?? ""} readOnly disabled aria-label="收件人邮箱" />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <Typography.Text strong>邮件标题</Typography.Text>
        <Input
          value={current.subject}
          maxLength={200}
          aria-label="邮件标题"
          onChange={(event) => {
            setContent((previous) => ({
              ...previous,
              [language]: { ...previous[language], subject: event.target.value }
            }));
            setPreviewHtml("");
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <Typography.Text strong>邮件正文</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          发送时会套用与“体验跟进”一致的 HTML 样式；这里同时作为不支持 HTML 的邮件客户端降级内容。
        </Typography.Text>
        <Input.TextArea
          value={current.bodyText}
          rows={9}
          maxLength={10_000}
          showCount
          aria-label="邮件正文"
          onChange={(event) => {
            setContent((previous) => ({
              ...previous,
              [language]: { ...previous[language], bodyText: event.target.value }
            }));
            setPreviewHtml("");
          }}
        />
      </label>

      <section aria-labelledby="product-feedback-reply-images" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <Typography.Text strong id="product-feedback-reply-images">邮件内图片（可选）</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已选 {selectedCount}/{limits.maxImages} 张
          </Typography.Text>
        </div>

        {draft.originalImages.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>反馈原图</Typography.Text>
            {draft.originalImages.map((image) => {
              const source = sourceImageMap.get(image.id);
              const checked = selectedImageIds.includes(image.id);
              return (
                <label
                  key={image.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 72px minmax(0, 1fr)",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    border: `1px solid ${checked ? "#ffb59c" : "var(--admin-color-border)"}`,
                    borderRadius: 8,
                    background: checked ? "#fff7f3" : "#fff",
                    cursor: image.emailEligible ? "pointer" : "not-allowed"
                  }}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!image.emailEligible}
                    onChange={(event) => toggleOriginalImage(image.id, event.target.checked)}
                    aria-label={`在邮件中插入 ${image.name}`}
                  />
                  {source ? (
                    <img
                      src={source.dataUrl}
                      alt=""
                      style={{ display: "block", width: 72, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }}
                    />
                  ) : (
                    <div style={{ width: 72, height: 48, borderRadius: 6, display: "grid", placeItems: "center", background: "#f3f4f6", color: "#9ca3af" }}>
                      <ImageIcon size={18} />
                    </div>
                  )}
                  <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                    <Typography.Text ellipsis style={{ fontSize: 13 }}>{image.name}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {formatBytes(image.size)}{image.ineligibleReason ? ` · ${image.ineligibleReason}` : ""}
                    </Typography.Text>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}

        {uploadedImages.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {uploadedImages.map((file, index) => (
              <div
                key={fileKey(file)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--admin-color-border)", borderRadius: 8, background: "#fff" }}
              >
                <ImageIcon size={16} color="#6b7280" />
                <span style={{ minWidth: 0, flex: 1, display: "grid" }}>
                  <Typography.Text ellipsis style={{ fontSize: 13 }}>{file.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatBytes(file.size)}</Typography.Text>
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<X size={14} />}
                  aria-label={`移除 ${file.name}`}
                  onClick={() => {
                    setUploadedImages((files) => files.filter((_, fileIndex) => fileIndex !== index));
                    setPreviewHtml("");
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/gif"
            onChange={(event) => addUploadedImages(event.target.files)}
          />
          <Button
            icon={<Upload size={14} />}
            disabled={selectedCount >= limits.maxImages}
            onClick={() => fileInputRef.current?.click()}
          >
            上传示意图
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最多 {limits.maxImages} 张，每张不超过 2 MB，支持 PNG、JPG、GIF
          </Typography.Text>
        </div>
      </section>
    </div>
  );

  const previewContent = previewLoading ? (
    <div style={{ minHeight: 420, display: "grid", placeItems: "center", color: "var(--admin-color-subtle)" }}>
      正在生成 HTML 邮件预览…
    </div>
  ) : previewHtml ? (
    <div style={{ display: "grid", gap: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        这是反馈人将收到的 HTML 邮件；纯文本版本会同时发送作为兼容降级。
      </Typography.Text>
      <iframe
        title="HTML 邮件预览"
        srcDoc={previewHtml}
        sandbox=""
        style={{ width: "100%", height: 520, border: "1px solid var(--admin-color-border)", borderRadius: 10, background: "#fafafa" }}
      />
    </div>
  ) : (
    <div style={{ minHeight: 360, display: "grid", placeItems: "center", color: "var(--admin-color-subtle)" }}>
      预览生成失败，请返回编辑后重试。
    </div>
  );

  return (
    <Modal
      open={props.open}
      title="回复并解决"
      width={720}
      centered
      destroyOnHidden
      maskClosable={!sending}
      closable={!sending}
      styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto" } }}
      onCancel={props.onClose}
      footer={(
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={activeTab === "preview" ? () => setActiveTab("edit") : props.onClose} disabled={sending}>
            {activeTab === "preview" ? "返回编辑" : "取消"}
          </Button>
          <Button
            type="primary"
            loading={sending}
            disabled={!draft.recipientEmail || !current.subject.trim() || !current.bodyText.trim()}
            onClick={sendAndResolve}
          >
            发送并标记已解决
          </Button>
        </div>
      )}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <Alert
          type="info"
          showIcon
          message="只有邮件确认发送成功后，反馈才会标记为已解决；发送失败时状态保持不变。"
        />
        {!draft.recipientEmail ? (
          <Alert type="warning" showIcon message="反馈人没有可用邮箱，暂时无法发送邮件回复。" />
        ) : null}
        {errorText ? <Alert type="error" showIcon closable message={errorText} onClose={() => setErrorText("")} /> : null}
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            if (key === "preview") {
              void showPreview();
            } else {
              setActiveTab("edit");
            }
          }}
          items={[
            { key: "edit", label: "编辑内容", children: editContent },
            { key: "preview", label: `邮件预览${selectedCount ? ` · ${selectedCount} 张图片` : ""}`, children: previewContent }
          ]}
        />
      </div>
    </Modal>
  );
}

function createClientRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `feedback-reply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
