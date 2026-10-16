import { type FC, useCallback, useContext, useEffect, useState } from "react";
import { type CodexFileChangeView } from "../artifacts/codex-file-changes";
import { usePortalI18n } from "./i18n";
import { createPortalSkillDraftNewVersion, fetchPortalSkillDraft, revisePortalSkillDraft } from "../skills/api";
import { type CodexSkillDraft } from "../skills/types";
import { asRecord } from "./portal-value-utils";
import { type SkillDraftStatusPartData } from "./portal-types";
import { normalizePreviewFilePath } from "./assistant-preview-paths";
import { SkillDraftActionContext, ThreadMutationReadOnlyContext } from "./portal-contexts";

export function collectSkillRootPathsFromChanges(changes: CodexFileChangeView[]): string[] {
  const roots = new Set<string>();
  for (const change of changes) {
    const normalizedPath = normalizePreviewFilePath(change.path);
    if (!normalizedPath) continue;
    const marker = "/SKILL.md";
    const root = normalizedPath === "SKILL.md"
      ? "."
      : normalizedPath.endsWith(marker)
        ? normalizedPath.slice(0, -marker.length) || "."
        : "";
    if (!root) continue;
    roots.add(root);
  }
  return [...roots];
}

export function buildSkillCreatorReviewPrompt(prompt: string): string {
  return `${prompt}

Platform skill install workflow:
- Use the normal skill-creator workflow to create or update a standard Codex Skill directory with a valid SKILL.md.
- Do not install or copy the skill into CODEX_HOME, ~/.codex, or any global Codex skills directory.
- Create the generated skill inside this thread workspace, preferably under ./skill-drafts/<skill-name>.
- When the skill files are ready, stop at the generated files. The platform will offer an Install skill action that installs the skill through the backend and makes it available in new chats.`;
}

export function isSkillCreationIntent(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  const hasSkillWord = /\bskill\b|技能|能力/.test(normalized);
  const hasCreateWord = /创建|生成|做成|固化|保存|沉淀|封装|复用|create|make|build|turn.+into/.test(normalized);
  return hasSkillWord && hasCreateWord;
}

export function skillDraftStatusTone(status: string | undefined): string {
  if (status === "published") return "published";
  if (status === "rejected") return "rejected";
  if (status === "changes_requested") return "changes";
  return "pending";
}

export function managedSkillStatusTone(status: string | undefined): string {
  if (status === "disabled") return "changes";
  if (status === "archived") return "rejected";
  return "published";
}

export function metadataValueAsString(metadata: unknown, key: string): string {
  const payload = asRecord(metadata);
  const value = payload ? payload[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

export const SkillDraftStatusBlock: FC<{ data: SkillDraftStatusPartData | unknown }> = ({ data }) => {
  const { t } = usePortalI18n();
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
  const payload = asRecord(data) || {};
  const draftId = typeof payload.draftId === "string" ? payload.draftId.trim() : "";
  const [draft, setDraft] = useState<CodexSkillDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(draftId));
  const [errorText, setErrorText] = useState("");
  const actions = useContext(SkillDraftActionContext);

  const loadDraft = useCallback(async () => {
    if (!draftId) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchPortalSkillDraft(draftId);
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("skill.saveError"));
    } finally {
      setLoading(false);
    }
  }, [draftId, t]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!draftId) return undefined;
    const terminal = draft?.status === "published" || draft?.status === "rejected" || draft?.status === "archived";
    if (terminal) return undefined;
    const timer = window.setInterval(() => {
      void loadDraft();
    }, 7000);
    return () => window.clearInterval(timer);
  }, [draft?.status, draftId, loadDraft]);

  const status = draft?.status || (typeof payload.status === "string" ? payload.status : undefined);
  const skillName = draft?.skillName || (typeof payload.skillName === "string" ? payload.skillName : undefined);
  const validation = draft?.validation;
  const canRevise = draft && draft.status !== "published" && draft.status !== "archived";
  const canUse = draft?.status === "published" && skillName;
  const canCreateNewVersion = draft?.status === "published";

  const handleRevise = async () => {
    if (!draft) return;
    const instruction = window.prompt(t("skill.revisePrompt"));
    if (!instruction?.trim()) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await revisePortalSkillDraft(draft.id, instruction.trim());
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("skill.saveError"));
    } finally {
      setLoading(false);
    }
  };

  const handleUseNewSession = async () => {
    if (!skillName) return;
    await actions.openNewSessionWithSkill({ skillName });
  };

  const handleCreateNewVersion = async () => {
    if (!draft) return;
    const instruction = window.prompt(t("skill.newVersionPrompt"));
    if (!instruction?.trim()) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await createPortalSkillDraftNewVersion(draft.id, instruction.trim());
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("skill.saveError"));
    } finally {
      setLoading(false);
    }
  };

  if (!draftId) return null;

  return (
    <section className={`skill-draft-card skill-draft-${skillDraftStatusTone(status)}`} aria-label={t("skill.draftStatus")}>
      <div className="skill-draft-card-head">
        <div>
          <p className="skill-draft-eyebrow">{t("skill.reusable")}</p>
          <h4>{draft?.displayName || skillName || t("skill.draft")}</h4>
        </div>
        <span className="skill-draft-status">
          {loading
            ? t("skill.statusRefreshing")
            : status === "pending_review"
              ? t("skill.statusPending")
              : status === "changes_requested"
                ? t("skill.statusChanges")
                : status === "published"
                  ? t("skill.statusPublished")
                  : status === "rejected"
                    ? t("skill.statusRejected")
                    : status === "archived"
                      ? t("skill.statusArchived")
                      : status || t("skill.statusProcessing")}
        </span>
      </div>
      <div className="skill-draft-meta-grid">
        <div>
          <span>{t("skill.name")}</span>
          <strong>{skillName || "-"}</strong>
        </div>
        <div>
          <span>{t("skill.author")}</span>
          <strong>{draft?.createdByDisplayName || draft?.createdByEmail || t("skill.you")}</strong>
        </div>
        <div>
          <span>{t("skill.version")}</span>
          <strong>{draft?.version || "1.0.0"}</strong>
        </div>
      </div>
      {draft?.description ? <p className="skill-draft-description">{draft.description}</p> : null}
      {draft?.reviewNote ? <p className="skill-draft-note">{t("skill.reviewNote", { note: draft.reviewNote })}</p> : null}
      {validation && (!validation.ok || validation.warnings.length > 0) ? (
        <div className="skill-draft-validation">
          {validation.errors.map((item) => (
            <p key={`error-${item}`}>{t("skill.error", { message: item })}</p>
          ))}
          {validation.warnings.map((item) => (
            <p key={`warning-${item}`}>{t("skill.warning", { message: item })}</p>
          ))}
        </div>
      ) : null}
      {errorText ? <p className="skill-draft-error">{errorText}</p> : null}
      {!mutationReadOnly ? <div className="skill-draft-actions">
        <button type="button" onClick={() => void loadDraft()} disabled={loading}>
          {t("skill.refreshStatus")}
        </button>
        {canRevise ? (
          <button type="button" onClick={() => void handleRevise()} disabled={loading}>
            {t("skill.reviseDraft")}
          </button>
        ) : null}
        {canCreateNewVersion ? (
          <button type="button" onClick={() => void handleCreateNewVersion()} disabled={loading}>
            {t("skill.newVersion")}
          </button>
        ) : null}
        {canUse ? (
          <button type="button" className="primary" onClick={() => void handleUseNewSession()} disabled={loading}>
            {t("skill.useNewChat")}
          </button>
        ) : null}
      </div> : null}
      {canUse ? (
        <p className="skill-draft-footnote">
          {t("skill.publishedHelp")}
        </p>
      ) : null}
    </section>
  );
};
