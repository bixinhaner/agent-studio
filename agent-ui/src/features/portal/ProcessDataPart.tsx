import { type FC, useContext, useEffect, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { PackageIcon, SparklesIcon } from "lucide-react";
import { apiBase } from "../../lib/api";
import { artifactFileName, collectCodexFileChanges } from "../artifacts/codex-file-changes";
import { isLocalToolPart } from "./workbench/local-tool-parts";
import { usePortalThreadUserSendIntent } from "./PortalThread";
import { PortalChatRecoveryNotice } from "./PortalChatRecoveryNotice";
import { createProcessDataFallback } from "./process-data-part-dispatch";
import {
  managedSkillInstallConflictFromError,
  SkillInstallConflictDialog
} from "./workbench/SkillInstallConflictDialog";
import { usePortalI18n } from "./i18n";
import { UserInputRequestCard } from "./user-input-request";
import { fetchPortalManagedSkills, type ManagedSkillInstallConflict } from "../skills/api";
import { type CodexManagedSkill } from "../skills/types";
import { SUMMARIZED_PROCESS_PART_NAMES } from "./assistant-process-summary";
import { asRecord, detailFromUnknown, shorten } from "./portal-value-utils";
import {
  type CommentaryEntryData,
  type CommentaryPartData,
  type InstructionReadData,
  type ProcessData,
  type TimelineRow
} from "./portal-types";
import { normalizeProcessTime } from "./runtime-run-config";
import {
  fileExtensionFromPreviewPath,
  IMAGE_FILE_EXTENSIONS,
  normalizePreviewFilePath
} from "./assistant-preview-paths";
import { GENERIC_TOOL_ERROR_DETAIL } from "./portal-formatting";
import {
  ActiveThreadIdContext,
  AttachmentWorkspaceFilesContext,
  ExternalPortalUserContext,
  PreviewRequestContext,
  RunningThreadIdsContext,
  SkillDraftActionContext,
  ThreadMutationReadOnlyContext,
  workspaceFilePreviewOptions
} from "./portal-contexts";
import {
  collectSkillRootPathsFromChanges,
  managedSkillStatusTone,
  metadataValueAsString,
  SkillDraftStatusBlock
} from "./SkillDraftStatusBlock";
import { MemoryContextChip, MessageArtifactFileList, SummarizedProcessPart } from "./AssistantProcessSummary";
import { AssistantLiveStatus } from "./AssistantRunningState";

export const AssistantCommentaryBlock: FC<{
  row: CommentaryPartData;
  entries: CommentaryEntryData[];
}> = ({ row, entries }) => {
  const { t } = usePortalI18n();
  const isStreaming = row.status === "streaming";
  const entryCount = entries.length;
  const updateCount = entries.reduce((count, entry) => count + Math.max(entry.lines.length, 1), 0);
  const [isOpen, setIsOpen] = useState(() => isStreaming || row.open !== false);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
      return;
    }
    if (row.open === false) {
      setIsOpen(false);
    }
  }, [isStreaming, row.open]);

  return (
    <details
      className={`assistant-commentary-block ${isStreaming ? "is-streaming" : "is-complete"}`}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="assistant-commentary-head">
        {isStreaming ? <AssistantLiveStatus title={t("trace.thinking")} compact /> : <span className="assistant-commentary-chip">{t("trace.thought")}</span>}
        {!isStreaming && (
          <span className="assistant-commentary-count">
            {t(entryCount === 1 ? "trace.thoughtCount" : "trace.thoughtCountPlural", { count: entryCount })} ·{" "}
            {t(updateCount === 1 ? "trace.updateCount" : "trace.updateCountPlural", { count: updateCount })}
          </span>
        )}
      </summary>
      <div className="assistant-commentary-text">
        {entries.map((entry, entryIndex) => (
          <div key={entry.id || `${row.id}-${entryIndex}`} className="assistant-commentary-entry">
            {(entry.lines.length > 0 ? entry.lines : [entry.text]).map((line, lineIndex) => (
              <p key={`${entry.id}-${lineIndex}`} className="assistant-commentary-line">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
};

export const RecoveryFailurePart: FC = () => {
  const aui = useAui();
  const notifyUserSendIntent = usePortalThreadUserSendIntent();
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
  return (
    <PortalChatRecoveryNotice
      state="failed"
      canRerun={!mutationReadOnly}
      onRerun={() => {
        notifyUserSendIntent();
        aui.message().reload();
      }}
    />
  );
};

export const ProcessDataPart: FC<{
  name?: string;
  data?: ProcessData | unknown;
}> = ({ name, data }) => {
  const { t } = usePortalI18n();
  const requestPreview = useContext(PreviewRequestContext);
  const attachmentWorkspaceFiles = useContext(AttachmentWorkspaceFilesContext);
  const isExternalPortalUser = useContext(ExternalPortalUserContext);
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const runningThreadIds = useContext(RunningThreadIdsContext);
  const skillDraftActions = useContext(SkillDraftActionContext);
  const [installingSkillPath, setInstallingSkillPath] = useState("");
  const [uninstallingSkillId, setUninstallingSkillId] = useState("");
  const [installedSkillsByPath, setInstalledSkillsByPath] = useState<Record<string, CodexManagedSkill>>({});
  const [skillInstallError, setSkillInstallError] = useState("");
  const [skillInstallConflict, setSkillInstallConflict] = useState<{
    skillPath: string;
    conflict: ManagedSkillInstallConflict;
  }>();

  useEffect(() => {
    if (name !== "codex_file_change") return;
    if (isExternalPortalUser) return;
    const threadId = activeThreadId.trim();
    if (!threadId) return;
    let active = true;
    void fetchPortalManagedSkills()
      .then((response) => {
        if (!active) return;
        const next: Record<string, CodexManagedSkill> = {};
        for (const skill of response.skills || []) {
          const sourceThreadId = metadataValueAsString(skill.metadata, "sourceThreadId");
          const sourceDirectoryPath = normalizePreviewFilePath(
            metadataValueAsString(skill.metadata, "sourceThreadRelativePath") ||
              metadataValueAsString(skill.metadata, "sourceDirectoryPath")
          );
          if (!sourceDirectoryPath || sourceThreadId !== threadId) continue;
          next[sourceDirectoryPath] = skill;
        }
        setInstalledSkillsByPath(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeThreadId, isExternalPortalUser, name]);

  if (name === "codex_process_audit") return null;

  if (typeof name === "string" && SUMMARIZED_PROCESS_PART_NAMES.has(name)) {
    return <SummarizedProcessPart data={data} />;
  }

  if (name === "codex_instruction_reads") {
    const payload = (data && typeof data === "object" ? data : {}) as InstructionReadData;
    const reads = Array.isArray(payload.reads)
      ? payload.reads
          .map((read, index) => {
            const item = asRecord(read);
            const readName = typeof item?.name === "string" ? item.name.trim() : "";
            const kind = item?.kind === "capability" ? "capability" : item?.kind === "skill" ? "skill" : "";
            if (!readName || !kind) return null;
            return {
              id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : `instruction-read-${index + 1}`,
              name: readName,
              kind
            };
          })
          .filter(Boolean) as Array<{ id: string; name: string; kind: "skill" | "capability" }>
      : [];
    if (reads.length === 0) return null;
    return (
      <div className="assistant-instruction-reads" role="group" aria-label={t("instruction.usedInResponse")}>
        <span className="assistant-instruction-reads-label">{t("instruction.usedInResponse")}</span>
        <div className="assistant-instruction-read-list">
          {reads.map((read) => {
            const isCapability = read.kind === "capability";
            const Icon = isCapability ? SparklesIcon : PackageIcon;
            return (
              <span
                key={read.id}
                className={`assistant-instruction-read-chip is-${read.kind}`}
                title={`${t(isCapability ? "instruction.capability" : "instruction.skill")} · ${read.name}`}
              >
                <span className="assistant-instruction-read-icon" aria-hidden="true"><Icon size={14} /></span>
                <span className="assistant-instruction-read-kind">
                  {t(isCapability ? "instruction.capability" : "instruction.skill")}
                </span>
                <span className="assistant-instruction-read-separator" aria-hidden="true">·</span>
                <span className="assistant-instruction-read-name">{read.name}</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  if (name === "skill_draft_status") {
    return <SkillDraftStatusBlock data={data} />;
  }

  if (name === "codex_commentary") {
    const row = (data && typeof data === "object" ? data : {}) as CommentaryPartData;
    const entries: CommentaryEntryData[] = Array.isArray(row.entries)
      ? row.entries
          .map((entry, index) => {
            const entryObj = asRecord(entry);
            const text = typeof entryObj?.text === "string" ? entryObj.text.trim() : "";
            const lines = Array.isArray(entryObj?.lines)
              ? entryObj.lines
                  .map((line) => (typeof line === "string" ? line.trim() : ""))
                  .filter(Boolean)
              : [];
            if (lines.length === 0 && !text) return null;
            return {
              id: typeof entryObj?.id === "string" && entryObj.id.trim() ? entryObj.id.trim() : `${row.id}-${index}`,
              text,
              lines,
              status: entryObj?.status === "streaming" ? "streaming" : "completed"
            } satisfies CommentaryEntryData;
          })
          .filter((entry): entry is CommentaryEntryData => Boolean(entry))
      : [];
    if (entries.length === 0) {
      const lines = Array.isArray(row.lines)
        ? row.lines
            .map((line) => (typeof line === "string" ? line.trim() : ""))
            .filter(Boolean)
        : [];
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (lines.length === 0 && !text) return null;
      entries.push({
        id: row.id || "thought",
        text,
        lines,
        status: row.status
      });
    }
    return <AssistantCommentaryBlock row={row} entries={entries} />;
  }

  if (name === "codex_trace_batch") {
    const payload = asRecord(data) || {};
    const batchId = typeof payload.batch_id === "number" ? payload.batch_id : 0;
    const batchOpen = payload.open !== false;
    const activeRowId =
      typeof payload.active_row_id === "string" && payload.active_row_id.trim()
        ? payload.active_row_id.trim()
        : "";
    const rowsInput = Array.isArray(payload.rows) ? payload.rows : [];
    const rows: TimelineRow[] = rowsInput
      .map((item, index) => {
        const obj = asRecord(item);
        if (!obj) return null;
        const kindRaw = typeof obj.kind === "string" ? obj.kind : "process";
        const kind = ["reasoning", "tool", "source", "meta", "process", "done", "error", "debug"].includes(kindRaw)
          ? (kindRaw as TimelineRow["kind"])
          : "process";
        const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : t("trace.processingStep");
        const detail = typeof obj.detail === "string" ? obj.detail.trim() : "";
        const rawDetail = typeof obj.rawDetail === "string" ? obj.rawDetail.trim() : "";
        const at = typeof obj.at === "string" ? normalizeProcessTime(obj.at) : "";
        return {
          id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `trace-batch-${index + 1}`,
          kind,
          title,
          detail: detail || undefined,
          rawDetail: rawDetail || undefined,
          at: at || undefined
        } satisfies TimelineRow;
      })
      .filter(Boolean) as TimelineRow[];

    if (rows.length === 0) return null;

    const reasoningCount = rows.filter((row) => row.kind === "reasoning").length;
    const toolCount = rows.filter((row) => row.kind === "tool").length;
    const stepCount = rows.filter((row) => row.kind !== "reasoning" && row.kind !== "tool").length;
    const resolvedActiveId = activeRowId || rows[rows.length - 1]?.id || "";

    return (
      <details className="trace-panel trace-panel-inline" open={batchOpen}>
        <summary className="trace-summary">{t("trace.summary", { count: rows.length, reasoning: reasoningCount, tools: toolCount, steps: stepCount })}</summary>
        <ol className="trace-timeline">
          {rows.map((row, index) => {
            const isActiveStep = row.id === resolvedActiveId || (!resolvedActiveId && index === rows.length - 1);
            const rowKey = `${batchId}-${row.id}-${resolvedActiveId || "none"}`;
            return (
              <li key={rowKey} className="trace-line">
                <span className={`trace-node trace-node-${row.kind} ${isActiveStep ? "trace-node-active" : ""}`} />
                <details className={`trace-card trace-step ${isActiveStep ? "trace-step-active" : ""}`} open={isActiveStep}>
                  <summary className="trace-card-head trace-step-summary">
                    <span className={`trace-pill trace-pill-${row.kind}`}>
                      {t(
                        row.kind === "reasoning"
                          ? "trace.reasoning"
                          : row.kind === "tool"
                            ? "trace.tool"
                            : row.kind === "source"
                              ? "trace.source"
                              : row.kind === "done"
                                ? "trace.done"
                                : row.kind === "error"
                                  ? "trace.error"
                                  : row.kind === "debug"
                                    ? "trace.debug"
                                    : row.kind === "meta"
                                      ? "trace.meta"
                                      : "trace.process"
                      )}
                    </span>
                    <span className="trace-item-title">{row.title}</span>
                    {row.at ? <span className="trace-item-time">{row.at}</span> : null}
                  </summary>
                  {row.detail ? <pre className="trace-item-detail">{row.detail}</pre> : null}
                </details>
              </li>
            );
          })}
        </ol>
      </details>
    );
  }

  if (name === "codex_file_change") {
    const changes = collectCodexFileChanges(data);
    const artifactChanges = changes.filter((item) => item.canPreview || item.canDownload);
    const skillRootPaths = isExternalPortalUser ? [] : collectSkillRootPathsFromChanges(changes);
    if (artifactChanges.length === 0 && skillRootPaths.length === 0) return null;
    const activeThreadRunning = Boolean(activeThreadId.trim() && runningThreadIds[activeThreadId.trim()]);
    const installSkillPath = async (skillPath: string, conflictAction?: "fork"): Promise<boolean> => {
      const threadId = activeThreadId.trim();
      if (!threadId) return false;
      setInstallingSkillPath(skillPath);
      setSkillInstallError("");
      try {
        const skill = await skillDraftActions.installSkillFromPath({
          threadId,
          path: skillPath,
          conflictAction
        });
        if (skill) {
          setInstalledSkillsByPath((current) => ({
            ...current,
            [skillPath]: skill
          }));
          await skillDraftActions.refreshRuntimeOptions();
          setSkillInstallConflict(undefined);
          return true;
        }
        return false;
      } catch (error) {
        const conflict = managedSkillInstallConflictFromError(error);
        if (!conflictAction && conflict) {
          setSkillInstallConflict({ skillPath, conflict });
          return false;
        }
        setSkillInstallError(error instanceof Error ? error.message : t("skill.saveError"));
        return false;
      } finally {
        setInstallingSkillPath("");
      }
    };
    return (
      <>
        <MessageArtifactFileList
          changes={artifactChanges}
          resolveActions={(item) => {
            const displayName = artifactFileName(item.displayPath);
            const workspacePreviewOptions = workspaceFilePreviewOptions(attachmentWorkspaceFiles, displayName);
            const artifactUrl = activeThreadId.trim()
              ? `${apiBase()}/api/threads/${encodeURIComponent(activeThreadId.trim())}/artifacts/content?${new URLSearchParams({
                  path: item.path
                }).toString()}`
              : "";
            const isImageArtifact = IMAGE_FILE_EXTENSIONS.has(fileExtensionFromPreviewPath(item.path));
            return {
              previewUrl: item.canPreview ? workspacePreviewOptions?.contentUrl || artifactUrl : "",
              downloadUrl: item.canDownload
                ? workspacePreviewOptions?.downloadUrl || (artifactUrl ? `${artifactUrl}&disposition=attachment` : "")
                : "",
              inlineImageUrl: item.canPreview && isImageArtifact
                ? workspacePreviewOptions?.contentUrl || (artifactUrl ? `${artifactUrl}&disposition=inline` : "")
                : ""
            };
          }}
          onPreview={(item) => {
            const displayName = artifactFileName(item.displayPath);
            requestPreview(item.path, workspaceFilePreviewOptions(attachmentWorkspaceFiles, displayName));
          }}
        />
        {skillRootPaths.length > 0 ? (
          <div className="assistant-file-change-skill-submit">
            <p>
              {activeThreadRunning
                ? t("skill.filesDetectedRunning")
                : t("skill.detected")}
            </p>
            {skillRootPaths.map((skillPath) => {
              const installedSkill = installedSkillsByPath[skillPath];
              const installLabel =
                installingSkillPath === skillPath
                  ? t("skill.installing")
                  : activeThreadRunning
                    ? t("skill.waiting")
                    : installedSkill
                      ? t("skill.installUpdate")
                      : t("skill.install");
              return (
                <div key={skillPath} style={{ display: "grid", gap: 10 }}>
                  <div className="assistant-file-change-actions">
                    {!mutationReadOnly ? (
                      <button
                        type="button"
                        className="assistant-file-change-btn"
                        disabled={!activeThreadId || activeThreadRunning || installingSkillPath === skillPath}
                        onClick={() => void installSkillPath(skillPath)}
                      >
                        {installLabel}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="assistant-file-change-btn"
                      onClick={() => requestPreview(skillPath === "." ? "SKILL.md" : `${skillPath}/SKILL.md`)}
                    >
                      {t("skill.preview")}
                    </button>
                  </div>
                  {installedSkill ? (
                    <section
                      className={`skill-draft-card skill-draft-${managedSkillStatusTone(installedSkill.status)}`}
                      aria-label={t("skill.installedStatus")}
                    >
                      <div className="skill-draft-card-head">
                        <div>
                          <p className="skill-draft-eyebrow">{t("skill.reusable")}</p>
                          <h4>{installedSkill.displayName || installedSkill.skillName}</h4>
                        </div>
                        <span className="skill-draft-status">
                          {installedSkill.status === "disabled"
                            ? t("skill.statusDisabled")
                            : installedSkill.status === "archived"
                              ? t("skill.statusArchived")
                              : t("skill.statusInstalled")}
                        </span>
                      </div>
                      <div className="skill-draft-meta-grid">
                        <div>
                          <span>{t("skill.name")}</span>
                          <strong>{installedSkill.skillName}</strong>
                        </div>
                        <div>
                          <span>{t("skill.version")}</span>
                          <strong>{installedSkill.version}</strong>
                        </div>
                        <div>
                          <span>{t("skill.availableIn")}</span>
                          <strong>{installedSkill.status === "active" ? t("skill.newChats") : t("skill.notAvailable")}</strong>
                        </div>
                      </div>
                      {installedSkill.description ? <p className="skill-draft-description">{installedSkill.description}</p> : null}
                      {!mutationReadOnly ? <div className="skill-draft-actions">
                        {installedSkill.status === "active" ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() =>
                              void skillDraftActions.openNewSessionWithSkill({
                                skillName: installedSkill.skillName,
                                managedSkillId: installedSkill.id
                              })
                            }
                          >
                            {t("skill.useNewChat")}
                          </button>
                        ) : null}
                        {installedSkill.scope === "private" && installedSkill.status === "active" ? (
                          <button
                            type="button"
                            disabled={uninstallingSkillId === installedSkill.id}
                            onClick={async () => {
                              const confirmed = window.confirm(
                                t("skill.uninstallConfirm")
                              );
                              if (!confirmed) return;
                              setUninstallingSkillId(installedSkill.id);
                              setSkillInstallError("");
                              try {
                                const removed = await skillDraftActions.uninstallSkill({ skillId: installedSkill.id });
                                if (removed) {
                                  setInstalledSkillsByPath((current) => ({
                                    ...current,
                                    [skillPath]: removed
                                  }));
                                }
                              } catch (error) {
                                setSkillInstallError(error instanceof Error ? error.message : t("skill.saveError"));
                              } finally {
                                setUninstallingSkillId("");
                              }
                            }}
                          >
                            {uninstallingSkillId === installedSkill.id ? t("skill.uninstalling") : t("skill.uninstall")}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void skillDraftActions.refreshRuntimeOptions()}>
                          {t("skill.refresh")}
                        </button>
                      </div> : null}
                      <p className="skill-draft-footnote">
                        {t("skill.installedHelp")}
                      </p>
                    </section>
                  ) : null}
                </div>
              );
            })}
            {skillInstallError ? <p className="skill-draft-error">{skillInstallError}</p> : null}
            <SkillInstallConflictDialog
              open={Boolean(skillInstallConflict)}
              conflict={skillInstallConflict?.conflict}
              loading={Boolean(skillInstallConflict && installingSkillPath === skillInstallConflict.skillPath)}
              errorText={skillInstallError}
              onKeepShared={() => {
                setSkillInstallConflict(undefined);
                setSkillInstallError("");
              }}
              onCreateCopy={() => {
                if (!skillInstallConflict) return;
                void installSkillPath(skillInstallConflict.skillPath, "fork");
              }}
            />
          </div>
        ) : null}
      </>
    );
  }

  if (name !== "codex_process") {
    return (
      <details className="process-block process-data" open={false}>
        <summary>{t("trace.dataEvent")}</summary>
        <pre>{shorten(detailFromUnknown(data), 1200)}</pre>
      </details>
    );
  }
  const row = (data && typeof data === "object" ? data : {}) as ProcessData;
  const title = typeof row.title === "string" ? row.title : "Processing step";
  const detail = typeof row.detail === "string" ? row.detail : "";
  const kind = typeof row.kind === "string" ? row.kind : "process";
  const at = typeof row.at === "string" ? row.at.replace("T", " ").replace("Z", "").slice(0, 19) : "";
  return (
    <details className={`process-block process-data process-${kind}`} open={kind === "error"}>
      <summary>{title}</summary>
      {at ? <p className="process-time">{at}</p> : null}
      {detail ? <pre>{shorten(detail, 1600)}</pre> : null}
    </details>
  );
};

export const ProcessDataFallback = createProcessDataFallback({
  memoryContext: MemoryContextChip,
  userInputRequest: UserInputRequestCard,
  connectionRecovery: () => <PortalChatRecoveryNotice state="recovering" />,
  recoveryFailure: RecoveryFailurePart,
  generic: ProcessDataPart
});

export function extractTimelineRows(content: unknown): TimelineRow[] {
  if (!Array.isArray(content)) return [];
  const rows: TimelineRow[] = [];
  let seq = 0;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";

    if (type === "text" || type === "image" || type === "file") continue;

    if (type === "reasoning") {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) continue;
      rows.push({
        id: `timeline-${++seq}`,
        kind: "reasoning",
        title: "Reasoning summary",
        detail: shorten(text, 1200)
      });
      continue;
    }

    if (type === "tool-call") {
      if (isLocalToolPart(p)) continue;
      if (p.isError === true) {
        rows.push({
          id: `timeline-${++seq}`,
          kind: "tool",
          title: "Tool step completed",
          detail: GENERIC_TOOL_ERROR_DETAIL
        });
        continue;
      }
      const toolName = typeof p.toolName === "string" ? p.toolName : "unknown";
      const argsText = typeof p.argsText === "string" ? p.argsText : detailFromUnknown(p.args);
      const resultText = p.result === undefined ? "" : detailFromUnknown(p.result);
      rows.push({
        id: `timeline-${++seq}`,
        kind: "tool",
        title: `Tool · ${toolName}`,
        detail: [shorten(argsText, 800), shorten(resultText, 1000)].filter(Boolean).join("\n\n")
      });
      continue;
    }

    if (type === "source") {
      const url = typeof p.url === "string" ? p.url.trim() : "";
      if (!url) continue;
      const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Source link";
      rows.push({
        id: `timeline-${++seq}`,
        kind: "source",
        title,
        detail: url
      });
      continue;
    }

    if (type === "data" && p.name === "codex_process" && p.data && typeof p.data === "object") {
      const data = p.data as Record<string, unknown>;
      const kindRaw = typeof data.kind === "string" ? data.kind : "process";
      const kind = ["meta", "process", "done", "error", "debug"].includes(kindRaw) ? (kindRaw as TimelineRow["kind"]) : "process";
      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Processing step";
      const detail = typeof data.detail === "string" ? data.detail.trim() : "";
      const rawDetail = typeof data.rawDetail === "string" ? data.rawDetail.trim() : "";
      const at = typeof data.at === "string" ? normalizeProcessTime(data.at) : "";
      rows.push({
        id: `timeline-${++seq}`,
        kind,
        title,
        detail: detail ? shorten(detail, 1400) : undefined,
        rawDetail: rawDetail ? shorten(rawDetail, 1400) : undefined,
        at
      });
      continue;
    }

    if (type === "data" && p.name === "codex_file_change") {
      continue;
    }

    if (type === "data" && p.name === "skill_draft_status") {
      continue;
    }

    if (type === "data" && p.name === "codex_process_audit") {
      continue;
    }

    if (type === "data") {
      rows.push({
        id: `timeline-${++seq}`,
        kind: "process",
        title: "Data event",
        detail: shorten(detailFromUnknown(p), 1200)
      });
    }
  }

  return rows;
}
