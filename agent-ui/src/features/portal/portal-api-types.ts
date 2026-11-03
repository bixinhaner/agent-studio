import { type ReasoningEffort } from "../../lib/model-config";
import { type PortalSteerEvent } from "./composer-workflow";

export type SessionOut = {
  session_id: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  workspace: string;
  created_at: string;
  updated_at: string;
};

export type ThreadOut = {
  id: string;
  status: "regular" | "archived";
  title?: string;
  external_id?: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  mode_id?: string | null;
  workspace_id?: string | null;
  folder_id?: string | null;
  enabled_skills?: Array<{
    id: string;
    name: string;
    managed_skill_id?: string | null;
  }>;
  enabled_skill_names?: string[];
  has_unread_completion?: boolean;
  created_at: string;
  updated_at: string;
};

export type ThreadListOut = {
  threads: ThreadOut[];
};

export type RunningThreadsOut = {
  thread_ids: string[];
  /** The open task's last message, when its id was passed as `thread_id`. */
  active_thread?: { id: string; head_id: string | null };
};

/** What a response running elsewhere (another device or tab) has produced so far. */
export type ThreadLiveOut =
  | { running: false }
  | {
      running: true;
      run_id: string;
      user_message_id: string | null;
      message: unknown;
      steer_events?: PortalSteerEventOut[];
    };

export type ThreadOneOut = {
  thread: ThreadOut;
};

export type ThreadCreateOut = {
  thread: ThreadOut;
  session?: SessionOut | null;
};

export type ThreadMessagesOut = {
  head_id?: string | null;
  messages: Array<{
    parent_id?: string | null;
    message: unknown;
    run_config?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
  }>;
  feedback?: ThreadFeedbackOut[];
};

export type PortalSteerEventOut = {
  id: string;
  thread_id: string;
  session_id?: string | null;
  source_user_message_id?: string | null;
  turn_id?: string | null;
  message: string;
  user_input_request_id?: string | null;
  status: "pending" | "accepted" | "failed";
  error_code?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalSteerEventListOut = {
  steer_events: PortalSteerEventOut[];
};

export function portalSteerEventFromOut(event: PortalSteerEventOut): PortalSteerEvent {
  return {
    id: event.id,
    threadId: event.thread_id,
    sessionId: event.session_id || undefined,
    sourceUserMessageId: event.source_user_message_id || undefined,
    turnId: event.turn_id || undefined,
    message: event.message,
    userInputRequestId: event.user_input_request_id || undefined,
    status: event.status,
    errorCode: event.error_code || undefined,
    resolvedAt: event.resolved_at || undefined,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

export type ThreadFeedbackOut = {
  id: string;
  type: "positive" | "negative";
  message_id: string | null;
  content_preview: string | null;
  comment: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string | null;
};

export type DirectoryBrowseOut = {
  roots: string[];
  cwd: string;
  parent: string | null;
  directories: Array<{
    name: string;
    path: string;
  }>;
};
