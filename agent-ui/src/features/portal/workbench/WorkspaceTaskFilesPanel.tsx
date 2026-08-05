import { useEffect, useState } from "react";
import { Empty, Spin } from "antd";
import { File, FileImage, FileSpreadsheet, FileText } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  PORTAL_WORKSPACE_DATA_SOURCE,
  type PortalWorkspaceDataSource,
  type PortalWorkspaceNode
} from "../workspace";

function fileIcon(node: PortalWorkspaceNode) {
  const name = node.name.toLowerCase();
  const mime = (node.mime_type || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return <FileImage size={19} />;
  if (/\.(xlsx?|csv|tsv)$/.test(name)) return <FileSpreadsheet size={19} />;
  if (mime.startsWith("text/") || /\.(txt|md|json|docx?|pdf)$/.test(name)) return <FileText size={19} />;
  return <File size={19} />;
}

export function WorkspaceTaskFilesPanel(props: {
  threadId: string;
  onOpenFile(file: PortalWorkspaceNode): void;
  dataSource?: PortalWorkspaceDataSource;
}) {
  const { locale, t } = usePortalI18n();
  const [files, setFiles] = useState<PortalWorkspaceNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    const threadId = props.threadId.trim();
    if (!threadId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorText("");
    void (props.dataSource ?? PORTAL_WORKSPACE_DATA_SOURCE).fetchTaskFiles(threadId)
      .then((nextFiles) => {
        if (!cancelled) setFiles(nextFiles);
      })
      .catch((error) => {
        if (!cancelled) setErrorText(error instanceof Error ? error.message : t("workspace.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.dataSource, props.threadId, t]);

  return (
    <div className="workspace-task-files-panel">
      <header>
        <div>
          <span>{t("workspace.taskFiles")}</span>
          <h3>{t("workspace.taskFilesTitle")}</h3>
        </div>
        <small>{t("workspace.itemCount", { count: files.length })}</small>
      </header>
      {loading ? (
        <div className="workspace-task-files-loading"><Spin size="small" />{t("common.loading")}</div>
      ) : errorText ? (
        <p className="workspace-rail-error">{errorText}</p>
      ) : files.length > 0 ? (
        <div className="workspace-task-file-list">
          {files.map((file) => (
            <button key={file.id} type="button" onClick={() => props.onOpenFile(file)}>
              <span>{fileIcon(file)}</span>
              <span>
                <strong>{file.name}</strong>
                <small>
                  {file.created_by_type === "migration"
                    ? t("workspace.fromHistory")
                    : file.created_by_type === "agent"
                      ? t("workspace.createdByAgent")
                      : t("workspace.uploadedByMe")}
                  {" · "}
                  {new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  }).format(new Date(file.updated_at))}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("workspace.taskFilesEmpty")} />
      )}
      <div className="workspace-task-files-hint">
        <FileText size={26} />
        <p>{t("workspace.selectFilePreview")}</p>
      </div>
    </div>
  );
}
