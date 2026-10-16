import { type AuthUser } from "../auth/api";
import {
  type ApprovalPolicy,
  type ProductFeedbackSeverity,
  type ProductFeedbackType,
  type SandboxMode,
  type WebSearchMode
} from "./portal-types";

export const DEFAULT_WORKSPACE = ".";

export function resolveShowProcessTracePreference(user?: AuthUser | null): boolean {
  return user?.portalPreferences?.showProcessTrace ?? false;
}

export function resolveCollapseFinalTraceOnDonePreference(user?: AuthUser | null): boolean {
  return user?.portalPreferences?.collapseFinalTraceOnDone ?? true;
}

export const SANDBOX_OPTIONS: Array<{ value: SandboxMode; label: string }> = [
  { value: "workspace-write", label: "workspace-write (Recommended: read/write workspace)" },
  { value: "read-only", label: "read-only (Read-only)" },
  { value: "danger-full-access", label: "danger-full-access (Full access)" }
];

export const APPROVAL_OPTIONS: Array<{ value: ApprovalPolicy; label: string }> = [
  { value: "never", label: "never (No approval)" },
  { value: "on-request", label: "on-request (Ask when needed)" },
  { value: "on-failure", label: "on-failure (Ask on failure)" },
  { value: "untrusted", label: "untrusted (Approval for untrusted actions)" }
];

export const WEB_SEARCH_OPTIONS: Array<{ value: WebSearchMode; label: string }> = [
  { value: "disabled", label: "disabled (Off)" },
  { value: "cached", label: "cached (Cached search)" },
  { value: "live", label: "live (Live search)" }
];
export const PRODUCT_FEEDBACK_TYPE_OPTIONS: Array<{ value: ProductFeedbackType; label: string }> = [
  { value: "usability_issue", label: "Improvement suggestion" },
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" }
];
export const PRODUCT_FEEDBACK_SEVERITY_OPTIONS: Array<{ value: ProductFeedbackSeverity; label: string }> = [
  { value: "blocking", label: "Blocking" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];
export const PRODUCT_FEEDBACK_MAX_IMAGES = 3;
export const PRODUCT_FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_FEEDBACK_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const RUNNING_STAGE_RECEIVED_TEXT = "Request received. Preparing your workspace.";
export const RUNNING_STAGE_CONTEXT_TEXT = "Analyzing context.";
export const RUNNING_STAGE_ANSWER_TEXT = "Generating the answer.";
export const RUNNING_STAGE_RESULT_TEXT = "Thinking...";
export const RUNNING_STAGE_WAITING_TEXT = "Still working. New updates will appear here automatically.";
export const RUNNING_STAGE_IMAGE_TEXT = "Generating image. This usually takes longer than a text answer.";
export const RUNNING_STAGE_IMAGE_HINT_TEXT = "The image will appear here automatically when it is ready.";
export const RUNNING_STAGE_WAITING_MS = 25_000;
export const DEFAULT_RUNNING_STAGE_TEXT = RUNNING_STAGE_RECEIVED_TEXT;
export const PORTAL_RUNNING_LEAVE_WARNING = "There are still running sessions. If you leave, you may lose visibility into their output.";
export type RunningStageKind = "text" | "image";
export type RunningStageContextValue = {
  text: string;
  secondaryText: string;
  kind: RunningStageKind;
};
export const DEFAULT_RUNNING_STAGE_CONTEXT_VALUE: RunningStageContextValue = {
  text: DEFAULT_RUNNING_STAGE_TEXT,
  secondaryText: "",
  kind: "text"
};
export const PORTAL_THREAD_SEARCH_PARAM = "thread";
export const PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM = "folder";
export const PORTAL_WORKSPACE_FILE_SEARCH_PARAM = "file";
export const PORTAL_WORKSPACE_QUERY_SEARCH_PARAM = "q";
export const PORTAL_BILLING_SEARCH_PARAM = "billing";
export type PortalBillingIntent = "renew" | "success" | "cancel";
