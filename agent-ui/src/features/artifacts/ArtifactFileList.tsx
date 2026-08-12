import { CheckIcon, DownloadIcon, FileIcon } from "lucide-react";

import { usePortalI18n } from "../portal/i18n";
import {
  artifactFileName,
  isImageArtifactFile,
  isReadyFileChange,
  type CodexFileChangeView
} from "./codex-file-changes";
import "./artifact-file-list.css";

export type ArtifactFileActions = {
  previewUrl?: string;
  downloadUrl?: string;
  inlineImageUrl?: string;
};

export type ArtifactFileListProps = {
  changes: CodexFileChangeView[];
  resolveActions(change: CodexFileChangeView): ArtifactFileActions;
  onPreview?(change: CodexFileChangeView, actions: ArtifactFileActions): void;
  className?: string;
};

export function ArtifactFileList(props: ArtifactFileListProps) {
  const { t } = usePortalI18n();

  if (props.changes.length === 0) return null;

  const previewArtifact = (change: CodexFileChangeView, actions: ArtifactFileActions) => {
    if (props.onPreview) {
      props.onPreview(change, actions);
      return;
    }
    if (actions.previewUrl) {
      window.open(actions.previewUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <section
      className={["artifact-file-list", props.className].filter(Boolean).join(" ")}
      aria-label={t("files.generated")}
    >
      <p className="artifact-file-list-title">{t("files.generated")}</p>
      <ul className="artifact-file-list-items">
        {props.changes.map((change) => {
          const actions = props.resolveActions(change);
          const isReady = isReadyFileChange(change.kind);
          const normalizedKind = change.kind.trim().toLowerCase();
          const statusLabel = isReady
            ? t("files.ready")
            : ["rename", "renamed", "move", "moved"].includes(normalizedKind)
              ? t("files.renamed")
              : ["delete", "deleted", "remove", "removed"].includes(normalizedKind)
                ? t("files.deleted")
                : t("files.updated");
          const displayName = artifactFileName(change.displayPath) || t("files.untitled");
          const canPreview = change.canPreview && Boolean(actions.previewUrl || props.onPreview);
          const canDownload = change.canDownload && Boolean(actions.downloadUrl);
          const inlineImageUrl = actions.inlineImageUrl
            || (isImageArtifactFile(change.path) ? actions.previewUrl : "");

          return (
            <li
              key={`${change.kind}-${change.path}`}
              className={inlineImageUrl
                ? "artifact-file-list-item artifact-file-list-item-with-image"
                : "artifact-file-list-item"}
            >
              {inlineImageUrl && canPreview ? (
                <button
                  type="button"
                  className="artifact-file-list-image-preview"
                  onClick={() => previewArtifact(change, actions)}
                  aria-label={t("files.previewNamed", { name: displayName })}
                >
                  <img
                    className="artifact-file-list-image"
                    src={inlineImageUrl}
                    alt={displayName}
                    loading="lazy"
                  />
                </button>
              ) : null}
              <div className="artifact-file-list-main">
                <div className="artifact-file-list-meta">
                  <span className="artifact-file-list-icon" aria-hidden="true">
                    <FileIcon size={18} />
                  </span>
                  <span className="artifact-file-list-details">
                    <span className="artifact-file-list-name">{displayName}</span>
                    <span className={isReady
                      ? "artifact-file-list-status is-ready"
                      : "artifact-file-list-status"}
                    >
                      {isReady ? <CheckIcon size={14} aria-hidden="true" /> : null}
                      {statusLabel}
                    </span>
                  </span>
                </div>
                {canPreview || canDownload ? (
                  <div className="artifact-file-list-actions">
                    {canPreview ? (
                      <button
                        type="button"
                        className="artifact-file-list-btn"
                        onClick={() => previewArtifact(change, actions)}
                      >
                        {t("files.preview")}
                      </button>
                    ) : null}
                    {canDownload ? (
                      <a
                        className="artifact-file-list-btn artifact-file-list-btn-primary"
                        href={actions.downloadUrl}
                        download={displayName}
                        aria-label={t("files.downloadNamed", { name: displayName })}
                      >
                        <DownloadIcon size={14} aria-hidden="true" />
                        {t("files.download")}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
