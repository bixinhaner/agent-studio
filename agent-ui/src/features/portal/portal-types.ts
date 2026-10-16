import { type ReasoningEffort } from "../../lib/model-config";
import { type PortalRuntimeOptions } from "../modes/types";

export type ProductFeedbackType = "bug" | "feature_request" | "usability_issue" | "other";
export type ProductFeedbackSeverity = "blocking" | "high" | "medium" | "low";
export type ProductFeedbackImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type WebSearchMode = "disabled" | "cached" | "live";
export type DirectoryPickerTarget = "workspace" | "additional";
export type DirectoryLoadOptions = {
  syncInput?: boolean;
  keepDirectoriesOnError?: boolean;
};

export type AppliedConfig = {
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
  additionalDirectoriesRaw: string;
};

export type RuntimeSkillOption = PortalRuntimeOptions["modes"][number]["availableSkills"][number];

export type ProcessData = {
  kind: "debug" | "meta" | "process" | "done" | "error";
  at: string;
  title: string;
  detail?: string;
  rawDetail?: string;
  event?: string;
  item_type?: string;
  status?: string;
};

export type InstructionReadData = {
  reads?: Array<{
    id?: string;
    name?: string;
    kind?: "skill" | "capability";
    trigger?: "selected" | "automatic";
    readAt?: string;
  }>;
};

export type TurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type ContextUsageSnapshot = TurnUsage & {
  threadId: string;
  model: string;
  contextLimit: number;
  updatedAt: string;
};

export type ContextUsageTone = "idle" | "ok" | "warn" | "critical";

export type ThreadIdentity = {
  remoteId?: string;
  localId?: string;
};

export type TimelineRow = {
  id: string;
  kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
  title: string;
  detail?: string;
  rawDetail?: string;
  at?: string;
};

export type TraceBatchPartData = {
  batch_id: number;
  open?: boolean;
  active_row_id?: string;
  rows: TimelineRow[];
};

export type TraceBatchPart = {
  type: "data";
  name: "codex_trace_batch";
  data: TraceBatchPartData;
};

export type CommentaryEntryData = {
  id: string;
  text: string;
  lines: string[];
  last_event_at?: number;
  status: "streaming" | "completed";
};

export type CommentaryPartData = {
  id: string;
  text: string;
  lines: string[];
  entries?: CommentaryEntryData[];
  open?: boolean;
  last_event_at?: number;
  status: "streaming" | "completed";
};

export type SkillDraftStatusPartData = {
  draftId: string;
  status?: string;
  skillName?: string;
};

export type SessionGroupLabelContextValue = {
  groupHeaderByRemoteId: Record<string, string>;
};

export type RunningThreadIdsContextValue = Record<string, boolean>;

export type ThreadCompletionNoticeContextValue = {
  completedThreadIds: RunningThreadIdsContextValue;
  clearCompletedThreadNotice: (...threadIds: Array<string | undefined | null>) => void;
};
