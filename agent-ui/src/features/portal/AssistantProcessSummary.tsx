import { type ComponentProps, type FC, useContext, useEffect, useMemo, useState } from "react";
import { type ThreadMessage } from "@assistant-ui/react";
import { AlertCircleIcon, BrainIcon, CheckIcon, ChevronDownIcon, PackageIcon, SparklesIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/store";
import { Popover } from "antd";
import { ArtifactFileList } from "../artifacts/ArtifactFileList";
import { type PortalLocale, type PortalMessageKey, usePortalI18n } from "./i18n";
import {
  type AssistantProcessCategory,
  type AssistantProcessSkill,
  type AssistantProcessStep,
  type AssistantProcessSummary,
  summarizeAssistantProcess,
  SUMMARIZED_PROCESS_PART_NAMES
} from "./assistant-process-summary";
import { asRecord, shorten } from "./portal-value-utils";
import { type RuntimeSkillOption } from "./portal-types";
import { coerceDate, type PortalTranslate } from "./portal-formatting";
import { ProcessTracePreferencesContext, SkillComposerContext } from "./portal-contexts";

export const ReasoningPart: FC<any> = ({ text }) => {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return null;
  return <SummarizedProcessPart reasoningText={text} />;
};

export const PROCESS_STEP_TITLE_ZH: Record<string, string> = {
  "Running workspace operation": "正在执行工作区操作",
  "Workspace operation completed": "工作区操作完成",
  "Processing step": "处理步骤",
  "Reasoning summary": "推理摘要",
  "Tool step completed": "工具步骤完成"
};

export function isSummarizedProcessContentPart(part: unknown): boolean {
  const item = asRecord(part);
  if (!item) return false;
  if (item.type === "reasoning") return typeof item.text === "string" && item.text.trim().length > 0;
  return item.type === "data" && typeof item.name === "string" && SUMMARIZED_PROCESS_PART_NAMES.has(item.name);
}

/** File cards produced by the live run fade in with a "just generated" badge. */
export const MessageArtifactFileList: FC<ComponentProps<typeof ArtifactFileList>> = (props) => {
  const running = useAuiState((s) => (s.message as { status?: { type?: string } }).status?.type === "running");
  return <ArtifactFileList {...props} fresh={running} />;
};

/** Shown only on turns where Codex actually looked something up in the user's memory. */
export const MemoryContextChip: FC<{ data?: unknown }> = ({ data }) => {
  const { t } = usePortalI18n();
  // Older turns stored `item_count` for "memory available", which said nothing about the answer.
  if (asRecord(data)?.used !== true) return null;
  return (
    <div className="assistant-memory-chip" role="note">
      <BrainIcon size={14} aria-hidden="true" />
      <span title={t("memory.usedDetail")}>{t("memory.used")}</span>
    </div>
  );
};

/** Skill tags pinned above the answer; clicking one reveals what the skill does. */
export const AssistantSkillTags: FC<{ skills: AssistantProcessSkill[]; onShowSteps?: () => void }> = ({ skills, onShowSteps }) => {
  const { t } = usePortalI18n();
  const { availableSkills, automaticSkills } = useContext(SkillComposerContext);
  if (skills.length === 0) return null;
  const find = (name: string) => {
    const key = name.trim().toLowerCase();
    const match = (skill: RuntimeSkillOption) =>
      [skill.name, skill.label, skill.id, skill.presentation?.displayName].some((value) => value?.trim().toLowerCase() === key);
    const automatic = automaticSkills.find(match);
    return { skill: automatic ?? availableSkills.find(match), automatic: Boolean(automatic) };
  };
  return (
    <div className="assistant-skill-tags" role="group" aria-label={t("skillTag.used")}>
      {skills.map((item) => {
        const { skill, automatic } = find(item.name);
        const displayName = skill?.presentation?.displayName || item.name;
        const steps = skill?.presentation?.usageSteps ?? [];
        const content = (
          <div className="assistant-skill-tag-popover">
            <strong>{displayName}</strong>
            {skill?.presentation?.summary ? <p>{skill.presentation.summary}</p> : null}
            {steps.length ? (
              <>
                <span className="assistant-skill-tag-popover-label">{t("skillTag.steps")}</span>
                <ol>
                  {steps.map((step, index) => (
                    <li key={`${index}-${step.slice(0, 12)}`}>{step}</li>
                  ))}
                </ol>
              </>
            ) : null}
            {skill ? <small>{automatic ? t("skillTag.automatic") : t("skillTag.selected")}</small> : null}
          </div>
        );
        return (
          <Popover key={item.id} content={content} trigger="click" placement="bottomLeft" onOpenChange={(open) => open && !steps.length && onShowSteps?.()}>
            <button type="button" className={`assistant-skill-tag is-${item.kind}`}>
              <span className="assistant-skill-tag-icon" aria-hidden="true">
                {item.kind === "capability" ? <SparklesIcon size={13} /> : <PackageIcon size={13} />}
              </span>
              <span className="assistant-skill-tag-kind">{t("skillTag.used")}</span>
              <span className="assistant-skill-tag-name">{displayName}</span>
            </button>
          </Popover>
        );
      })}
    </div>
  );
};

/**
 * Commentary, trace, process and "instructions read" parts are folded into one
 * summary line. Only the first such part of a message renders it; the rest render nothing.
 */
export const SummarizedProcessPart: FC<{ data?: unknown; reasoningText?: string }> = ({ data, reasoningText }) => {
  const isFirst = useAuiState((s) => {
    const content = s.message.content as readonly unknown[];
    const first = asRecord(content.find(isSummarizedProcessContentPart));
    if (!first) return false;
    if (reasoningText !== undefined) return first.type === "reasoning" && first.text === reasoningText;
    return first.type === "data" && first.data === data;
  });
  return isFirst ? <AssistantProcessSummaryBlock /> : null;
};

export function useNowTicker(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

export function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatProcessDuration(ms: number, t: PortalTranslate): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return t("process.seconds", { seconds: totalSeconds });
  return t("process.minutes", { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 });
}

export const PROCESS_CATEGORY_KEYS: Record<AssistantProcessCategory, { done: PortalMessageKey; running: PortalMessageKey; count?: PortalMessageKey }> = {
  search: { done: "process.step.search", running: "process.step.searchRunning", count: "process.count.search" },
  command: { done: "process.step.command", running: "process.step.commandRunning", count: "process.count.command" },
  tool: { done: "process.step.tool", running: "process.step.toolRunning", count: "process.count.tool" },
  "image-generate": { done: "process.step.imageGenerate", running: "process.step.imageGenerateRunning", count: "process.count.imageGenerate" },
  "image-inspect": { done: "process.step.imageInspect", running: "process.step.imageInspectRunning", count: "process.count.imageInspect" },
  plan: { done: "process.step.plan", running: "process.step.planRunning", count: "process.count.plan" },
  files: { done: "process.step.files", running: "process.step.filesRunning", count: "process.count.files" },
  agent: { done: "process.step.agent", running: "process.step.agentRunning", count: "process.count.agent" },
  context: { done: "process.step.context", running: "process.step.contextRunning", count: "process.count.context" },
  other: { done: "process.stepCount", running: "process.stepCount" }
};

export function processStepLabel(step: AssistantProcessStep, t: PortalTranslate, locale: PortalLocale): { action: string; subject?: string } {
  if (step.status === "error") return { action: t("process.step.error") };
  if (step.category === "other") {
    const title = locale === "zh-CN" ? PROCESS_STEP_TITLE_ZH[step.title] || step.title : step.title;
    return { action: title };
  }
  const keys = PROCESS_CATEGORY_KEYS[step.category];
  return { action: t(step.status === "running" ? keys.running : keys.done), subject: step.subject };
}

export function processSummarySegments(summary: AssistantProcessSummary, t: PortalTranslate): string[] {
  const segments: string[] = [];
  const order: AssistantProcessCategory[] = ["search", "tool", "command", "image-generate", "image-inspect", "files", "agent", "plan", "context"];
  for (const category of order) {
    const count = summary.counts[category];
    const key = PROCESS_CATEGORY_KEYS[category].count;
    if (count && key) segments.push(t(key, { count }));
  }
  const other = summary.counts.other;
  if (other) segments.push(t(other === 1 ? "process.stepCount" : "process.stepCountPlural", { count: other }));
  if (summary.sourceCount > 0) segments.push(t("process.sources", { count: summary.sourceCount }));
  if (summary.durationMs) segments.push(t("process.duration", { duration: formatProcessDuration(summary.durationMs, t) }));
  return segments;
}

export const ProcessStepRow: FC<{ step: AssistantProcessStep; showRawDetail: boolean; live?: boolean }> = ({ step, showRawDetail, live }) => {
  const { locale, t } = usePortalI18n();
  const label = processStepLabel(step, t, locale);
  const running = step.status === "running";
  const rawDetail = showRawDetail && step.detail && step.category !== "search" ? step.detail : "";
  const text = (
    <span className="assistant-process-step-text">
      <span className={running && live ? "assistant-process-step-action is-live" : "assistant-process-step-action"}>{label.action}</span>
      {label.subject ? <span className="assistant-process-step-subject">{label.subject}</span> : null}
    </span>
  );
  return (
    <li className={`assistant-process-step is-${step.status}`}>
      <span className="assistant-process-step-icon" aria-hidden="true">
        {step.status === "done" ? <CheckIcon size={13} strokeWidth={2.6} /> : step.status === "error" ? <AlertCircleIcon size={13} /> : <span className="assistant-process-step-pulse" />}
      </span>
      {rawDetail ? (
        <details className="assistant-process-step-raw">
          <summary>{text}</summary>
          <pre>{shorten(rawDetail, 1600)}</pre>
        </details>
      ) : (
        text
      )}
    </li>
  );
};

export const ProcessThoughts: FC<{ thoughts: string[] }> = ({ thoughts }) =>
  thoughts.length > 0 ? (
    <div className="assistant-process-thoughts">
      {thoughts.map((line, index) => (
        <p key={`${index}-${line.slice(0, 16)}`}>{line}</p>
      ))}
    </div>
  ) : null;

/** Before the answer starts: the plan (complete), a growing step list and progress hints. */
export const AssistantWorkingPanel: FC<{ summary: AssistantProcessSummary; startedAt?: number }> = ({ summary, startedAt }) => {
  const { t } = usePortalI18n();
  const { showRawDetail } = useContext(ProcessTracePreferencesContext);
  const [showEarlier, setShowEarlier] = useState(false);
  const now = useNowTicker(true);
  const visibleCount = 3;
  const hiddenCount = showEarlier ? 0 : Math.max(0, summary.steps.length - visibleCount);
  const visibleSteps = summary.steps.slice(hiddenCount);
  const elapsedMs = startedAt ? now - startedAt : 0;
  const meta: string[] = [];
  if (summary.sourceCount > 0) meta.push(t("process.sources", { count: summary.sourceCount }));
  if (elapsedMs >= 10_000) meta.push(t("process.live.elapsed", { duration: formatProcessDuration(elapsedMs, t) }));
  const hasRunningStep = summary.steps.some((step) => step.status === "running");
  const doneSteps = summary.steps.filter((step) => step.status === "done").length;
  if (summary.steps.length >= 2) meta.unshift(t("process.planProgress", { done: doneSteps, total: summary.steps.length }));

  return (
    <div className="assistant-process-working" role="status" aria-live="polite">
      <AssistantSkillTags skills={summary.skills} />
      <ProcessThoughts thoughts={summary.thoughts} />
      {summary.steps.length > 0 ? (
        <ol className="assistant-process-steps">
          {hiddenCount > 0 ? (
            <li className="assistant-process-step is-earlier">
              <button type="button" className="assistant-process-earlier" onClick={() => setShowEarlier(true)}>
                {t("process.live.earlier", { count: hiddenCount })}
              </button>
            </li>
          ) : null}
          {visibleSteps.map((step) => (
            <ProcessStepRow key={step.id} step={step} showRawDetail={showRawDetail} live />
          ))}
        </ol>
      ) : null}
      {!hasRunningStep && summary.steps.length === 0 && summary.thoughts.length === 0 ? (
        <span className="assistant-process-step-action is-live">{t("trace.thinking")}</span>
      ) : null}
      {meta.length > 0 || elapsedMs >= 60_000 ? (
        <div className="assistant-process-meta">
          {meta.join(" · ")}
          {elapsedMs >= 60_000 ? <span className="assistant-process-slow">{t("process.live.slow")}</span> : null}
        </div>
      ) : null}
    </div>
  );
};

export const AssistantProcessSummaryBlock: FC = () => {
  const { t } = usePortalI18n();
  const content = useAuiState((s) => s.message.content);
  const isRunning = useAuiState((s) => (s.message as { status?: { type?: string } }).status?.type === "running");
  const createdAt = useAuiState((s) => (s.message as ThreadMessage & { createdAt?: unknown }).createdAt);
  const { showRawDetail, collapseOnDone } = useContext(ProcessTracePreferencesContext);
  const summary = useMemo(() => summarizeAssistantProcess(content, { running: isRunning }), [content, isRunning]);
  const hasAnswerText = useMemo(
    () =>
      (content as readonly unknown[]).some((part) => {
        const item = asRecord(part);
        return item?.type === "text" && typeof item.text === "string" && item.text.trim().length > 0;
      }),
    [content]
  );
  const [open, setOpen] = useState(() => !collapseOnDone);
  const startedAt = useMemo(() => coerceDate(createdAt)?.getTime(), [createdAt]);

  if (!summary.hasProcess) return null;
  if (isRunning && !hasAnswerText) return <AssistantWorkingPanel summary={summary} startedAt={startedAt} />;

  const segments = processSummarySegments(summary, t);
  if (!isRunning && summary.durationMs) {
    const durationSegment = t("process.duration", { duration: formatProcessDuration(summary.durationMs, t) });
    const index = segments.indexOf(durationSegment);
    if (index >= 0) segments.splice(index, 1);
    segments.unshift(t("process.completedIn", { duration: formatProcessDuration(summary.durationMs, t) }));
  }
  return (
    <>
    <AssistantSkillTags skills={summary.skills} onShowSteps={() => setOpen(true)} />
    <div className={`assistant-process-summary${open ? " is-open" : ""}${isRunning ? " is-running" : ""}`}>
      <button
        type="button"
        className="assistant-process-summary-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="assistant-process-summary-icon" aria-hidden="true">
          {isRunning ? <span className="assistant-process-step-pulse" /> : <CheckIcon size={15} strokeWidth={2.6} />}
        </span>
        <span className="assistant-process-summary-text">
          {segments.map((segment) => (
            <span key={segment} className="assistant-process-summary-segment">{segment}</span>
          ))}
          {segments.length === 0 ? (
            <span className="assistant-process-summary-segment">{t("process.thoughtOnly")}</span>
          ) : null}
        </span>
        <ChevronDownIcon size={14} className="assistant-process-summary-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="assistant-process-details">
          <ProcessThoughts thoughts={summary.thoughts} />
          {summary.steps.length > 0 ? (
            <ol className="assistant-process-steps">
              {summary.steps.map((step) => (
                <ProcessStepRow key={step.id} step={step} showRawDetail={showRawDetail} />
              ))}
            </ol>
          ) : null}
          {summary.sources.length > 0 ? (
            <div className="assistant-process-sources">
              {summary.sources.map((source) => (
                <a key={source.url} className="assistant-process-source" href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                  {source.title || sourceHostname(source.url)}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
    </>
  );
};

export const SourcePart: FC<any> = ({ url, title }) => {
  const { t } = usePortalI18n();
  // With a process summary, sources are listed inside it instead of as a long link list.
  const hasProcessSummary = useAuiState((s) => (s.message.content as readonly unknown[]).some(isSummarizedProcessContentPart));
  const link = typeof url === "string" ? url.trim() : "";
  if (!link || hasProcessSummary) return null;
  const label = typeof title === "string" && title.trim() ? title.trim() : link;
  return (
    <p className="process-source">
      <a href={link} target="_blank" rel="noreferrer">
        {t("thread.source", { label })}
      </a>
    </p>
  );
};
