import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Collapse, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, Tag } from "antd";
import ReactMarkdown from "react-markdown";

import { fetchAdminUsers } from "../admin/api";
import type { AdminUser } from "../admin/types";
import { fetchAgentModes } from "../capability-center/api";
import type { AgentModeRecord } from "../capability-center/types";
import { fetchKnowledgeSets } from "../resources-center/api";
import type { KnowledgeSetRecord } from "../resources-center/types";
import {
  fetchIntegrationDetail,
  fetchZendeskGroups,
  previewZendeskCacheCleanup,
  runZendeskCacheCleanup,
  runZendeskIntegrationTicket,
  sendZendeskAiReviewEmailReminder,
  updateIntegrationInstance,
  validateIntegrationInstance
} from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { IntegrationDetail, ZendeskCacheCleanupResult, ZendeskConfigDraft } from "./types";
import type { ZendeskDingTalkGroupFallbackRule, ZendeskGroupOption } from "./types";
import type { ZendeskRunRecord } from "../zendesk/types";
import "../zendesk/zendesk.css";

type ZendeskTab = "basic" | "operations" | "cache" | "bindings" | "policies" | "history";

const TABS: Array<{ id: ZendeskTab; label: string }> = [
  { id: "basic", label: "统一配置" },
  { id: "operations", label: "上线与运行" },
  { id: "cache", label: "缓存清理" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" },
  { id: "history", label: "验证与历史" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "draft", value: "draft" }
];

const RESPONSE_MODE_OPTIONS = [
  { label: "先写内部备注", value: "internal_note" },
  { label: "允许公开回复", value: "public_reply" }
];

const FALLBACK_MODE_OPTIONS = [
  { label: "不确定时写内部备注", value: "internal_note" },
  { label: "不确定时跳过", value: "skip" }
];

const AUTO_STATUS_OPTIONS = [
  { label: "保持不变", value: "unchanged" },
  { label: "等待客户回复 pending", value: "pending" },
  { label: "保持处理 open", value: "open" },
  { label: "内部等待 hold", value: "hold" }
];

const RESPONSE_MODE_VALUES = new Set(RESPONSE_MODE_OPTIONS.map((item) => item.value));
const FALLBACK_MODE_VALUES = new Set(FALLBACK_MODE_OPTIONS.map((item) => item.value));
const AUTO_STATUS_VALUES = new Set(AUTO_STATUS_OPTIONS.map((item) => item.value));
const DEFAULT_ATTACHMENT_MIME_TYPES = [
  "image/*",
  "text/*",
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

const DEFAULT_ZENDESK_CHANNEL_PROMPT = [
  "You are an automated support agent connected to Zendesk.",
  "Use the current workspace, attached files, mounted knowledge sets, scripts, and documents as the source of truth. Do not invent unknown facts.",
  "If the ticket context is insufficient for a reliable customer-facing answer, choose internal_note or handoff instead of forcing a public reply.",
  "Public replies must be concise, accurate, actionable, and written in the language of the customer's latest message whenever possible.",
  "Do not claim that a human action was completed, and do not pretend to have performed an operation that cannot be verified from the context.",
  "Return JSON only. Do not include any extra prose outside the JSON object."
].join("\n");

const ZENDESK_CORE_PROTOCOL_PROMPT = [
  "Use the Zendesk ticket context to decide the next action.",
  "The model must return one JSON object with decision, body, internalNote, confidence, and reasons.",
  "Allowed decisions are public_reply, internal_note, and handoff.",
  "The public body must never expose local paths, internal directories, manifest paths, API tokens, secrets, or implementation details.",
  "Downloaded attachments are referenced by local_path and may be read when relevant.",
  "The service parses this JSON and writes either a Zendesk public reply, an internal note, a handoff note, or skips the ticket."
].join("\n");

const AGENT_MODE_PROMPT_TEMPLATE = [
  "You are a Baicells technical support agent assisting the support team with Zendesk tickets.",
  "",
  "Goals:",
  "- Decide whether the customer can receive a safe public reply.",
  "- When a public reply is safe, provide a concise, accurate, and actionable answer.",
  "- When information is missing, the request requires verification, or the answer would create a commitment, recommend an internal note or human handoff.",
  "",
  "Response principles:",
  "- Use the language of the customer's latest message whenever possible.",
  "- Do not reveal internal systems, local paths, logs, implementation details, or AI workflow.",
  "- Do not invent device status, shipment status, account changes, SLA promises, refunds, or completed operations.",
  "- If screenshots, logs, PDFs, spreadsheets, or other attachments are available, inspect them before making a decision.",
  "",
  "Support boundaries:",
  "- You may explain common CPE, base station, network connectivity, configuration, and troubleshooting steps.",
  "- You may use mounted knowledge sets for product procedures, parameters, and support articles.",
  "- You must not promise contract changes, refunds, shipping actions, account permission changes, or remote operations unless the context explicitly proves they have already been completed.",
  "",
  "Internal note guidance:",
  "- List missing information that the support team should ask for.",
  "- Explain why human verification is needed when you recommend handoff.",
  "- Include practical next steps for device, SIM, coverage, configuration, or platform-side investigation when relevant."
].join("\n");

const DEFAULT_DINGTALK_NOTIFICATION_TEMPLATE = [
  "### Zendesk #{{ticketId}} · {{result}}",
  "",
  "[#{{ticketId}}]({{ticketUrl}})",
  "{{subject}}",
  "",
  "**Requester:** {{requester}}  ",
  "**Assignee:** {{assignee}}",
  "",
  "---",
  "",
  "{{zendeskCommentMarkdown}}",
  "",
  "---",
  "",
  "{{reviewSummary}}",
  "",
  "---",
  "{{mention}}"
].join("\n");

const DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIME = "09:00";
const DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIMEZONE = "Asia/Shanghai";
const AI_REVIEW_EMAIL_REMINDER_TIMEZONE_OPTIONS = [
  { label: "Asia/Shanghai", value: "Asia/Shanghai" },
  { label: "Asia/Singapore", value: "Asia/Singapore" },
  { label: "Asia/Jakarta", value: "Asia/Jakarta" },
  { label: "UTC", value: "UTC" }
];

const DINGTALK_TEMPLATE_TOKENS = [
  { token: "{{ticketId}}", label: "Ticket ID" },
  { token: "{{ticketUrl}}", label: "Zendesk link" },
  { token: "{{subject}}", label: "Ticket subject" },
  { token: "{{requester}}", label: "Requester" },
  { token: "{{assignee}}", label: "Assignee" },
  { token: "{{result}}", label: "AI write result" },
  { token: "{{confidence}}", label: "Confidence" },
  { token: "{{trigger}}", label: "Manual/Webhook" },
  { token: "{{commentId}}", label: "Zendesk comment ID" },
  { token: "{{requesterCommentId}}", label: "Requester comment ID" },
  { token: "{{reasons}}", label: "Reason bullets" },
  { token: "{{aiContent}}", label: "Clean AI content" },
  { token: "{{publicReplyPreview}}", label: "Public reply preview" },
  { token: "{{internalNote}}", label: "Agent internal note" },
  { token: "{{zendeskCommentBody}}", label: "Exact Zendesk comment" },
  { token: "{{zendeskCommentMarkdown}}", label: "Formatted Zendesk comment" },
  { token: "{{reviewSummary}}", label: "AI review task summary" },
  { token: "{{reviewUrl}}", label: "AI review link" },
  { token: "{{mention}}", label: "Real @ userId token" },
  { token: "{{mentionLabel}}", label: "Display name only" }
];

const DINGTALK_TEMPLATE_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const DINGTALK_TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  ticketId: "45250",
  ticketUrl: "https://example.zendesk.com/agent/tickets/45250",
  subject: "VOLTE Calls sent to IBaciore are returning to SIP server creating a loop",
  requester: "Dave George <dgeorge@aislecom.com>",
  assignee: "Li Mingjian <limingjian@baicells.com>",
  result: "Internal note",
  confidence: "72%",
  trigger: "Zendesk webhook",
  commentId: "49467830868500",
  requesterCommentId: "49387224386196",
  reasons: [
    "- Attachment shows SIP online UE but missing MSISDN in UE status.",
    "- Ticket IMSI conflicts with screenshot IMSI.",
    "- SIP routing loop needs live BaiCore SIP trunk configuration and logs before public commitment."
  ].join("\n"),
  aiContent: [
    "Context is insufficient for a safe public reply.",
    "",
    "Recommended next step: verify the IMSI/MSISDN mapping, collect SIP trunk routing logs, and confirm the loop source before replying to the customer."
  ].join("\n"),
  publicReplyPreview: "We are checking the SIP routing path and the IMSI/MSISDN mapping before providing a final answer.",
  internalNote: [
    "Context is insufficient for a safe public reply.",
    "",
    "Recommended next step: verify the IMSI/MSISDN mapping, collect SIP trunk routing logs, and confirm the loop source before replying to the customer."
  ].join("\n"),
  zendeskCommentBody: [
    "AI generated an internal note.",
    "Confidence: 72%",
    "Reasons: Attachment shows SIP online UE but missing MSISDN in UE status; Ticket IMSI conflicts with screenshot IMSI; SIP routing loop needs live BaiCore SIP trunk configuration and logs before public commitment.",
    "",
    "Public reply preview (not sent):",
    "We are checking the SIP routing path and the IMSI/MSISDN mapping before providing a final answer.",
    "",
    "Internal note:",
    "Context is insufficient for a safe public reply.",
    "",
    "Recommended next step: verify the IMSI/MSISDN mapping, collect SIP trunk routing logs, and confirm the loop source before replying to the customer."
  ].join("\n"),
  zendeskCommentMarkdown: [
    "**Status**",
    "AI generated an internal note.",
    "",
    "**Confidence**",
    "72%",
    "",
    "**Reasons**",
    "> - Attachment shows SIP online UE but missing MSISDN in UE status.",
    "> - Ticket IMSI conflicts with screenshot IMSI.",
    "> - SIP routing loop needs live BaiCore SIP trunk configuration and logs before public commitment.",
    "",
    "**Public Reply Preview (not sent)**",
    "> We are checking the SIP routing path and the IMSI/MSISDN mapping before providing a final answer.",
    "",
    "**Internal Note**",
    "> Context is insufficient for a safe public reply.",
    ">",
    "> Recommended next step: verify the IMSI/MSISDN mapping, collect SIP trunk routing logs, and confirm the loop source before replying to the customer."
  ].join("\n"),
  reviewSummary: [
    "**AI Review Required**",
    "> Each @ recipient receives a private review request. Please rate 1-5 and add improvement suggestions if needed.",
    "> Due in 24 hours."
  ].join("\n"),
  reviewUrl: "https://aiagent.example.com/review/ai-response/review_123",
  mention: "@manager422*****",
  mentionLabel: "@Li Mingjian"
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown) {
  return Boolean(value);
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bytesToMb(value: unknown, fallbackMb: number) {
  const bytes = asNumber(value, fallbackMb * 1024 * 1024);
  return Math.max(1, Math.round(bytes / 1024 / 1024));
}

function asListText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ") : "";
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function normalizeOption(value: string, allowed: Set<string>, fallback: string) {
  return allowed.has(value) ? value : fallback;
}

function normalizeZendeskChannelPrompt(value: unknown) {
  const prompt = asString(value).trim();
  const isLegacyDefault =
    prompt.charCodeAt(0) === 0x4f60 &&
    prompt.includes("Zendesk") &&
    prompt.includes("internal_note") &&
    prompt.includes("handoff") &&
    prompt.includes("JSON");
  if (!prompt || isLegacyDefault) return DEFAULT_ZENDESK_CHANNEL_PROMPT;
  return prompt;
}

function normalizeDingTalkNotificationTemplate(value: unknown) {
  const template = asString(value).trim();
  return template || DEFAULT_DINGTALK_NOTIFICATION_TEMPLATE;
}

function normalizeAiReviewEmailReminderTime(value: unknown) {
  const raw = asString(value).trim();
  return /^\d{2}:\d{2}$/.test(raw) ? raw : DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIME;
}

function normalizeAiReviewEmailReminderTimezone(value: unknown) {
  return asString(value).trim() || DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIMEZONE;
}

function normalizeGroupFallbackRules(value: unknown): ZendeskDingTalkGroupFallbackRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        groupId: String(record.groupId ?? record.group_id ?? "").trim(),
        groupName: asString(record.groupName ?? record.group_name).trim(),
        userIds: asStringArray(record.userIds ?? record.user_ids)
      };
    })
    .filter((item) => (item.groupId || item.groupName) && item.userIds.length > 0);
}

function prepareGroupFallbackRules(value: ZendeskDingTalkGroupFallbackRule[]): ZendeskDingTalkGroupFallbackRule[] {
  const seen = new Set<string>();
  return value
    .map((item) => ({
      groupId: asString(item.groupId).trim(),
      groupName: asString(item.groupName).trim(),
      userIds: asStringArray(item.userIds)
    }))
    .filter((item) => {
      if ((!item.groupId && !item.groupName) || item.userIds.length === 0) return false;
      const key = item.groupId ? `id:${item.groupId}` : `name:${item.groupName.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderDingTalkTemplatePreview(template: string) {
  return normalizeDingTalkNotificationTemplate(template).replace(
    DINGTALK_TEMPLATE_PLACEHOLDER_RE,
    (_match, key: string) => DINGTALK_TEMPLATE_SAMPLE_VALUES[key] ?? ""
  );
}

function buildDraft(detail: IntegrationDetail): ZendeskConfigDraft {
  return {
    enabled: asBoolean(detail.config.enabled),
    publicBaseUrl: asString(detail.config.publicBaseUrl),
    zendeskBaseUrl: asString(detail.config.zendeskBaseUrl),
    zendeskEmail: asString(detail.config.zendeskEmail),
    zendeskApiTokenDraft: "",
    webhookSigningSecretDraft: "",
    responseMode: normalizeOption(asString(detail.config.responseMode), RESPONSE_MODE_VALUES, "internal_note"),
    fallbackMode: normalizeOption(asString(detail.config.fallbackMode), FALLBACK_MODE_VALUES, "internal_note"),
    autoStatus: normalizeOption(asString(detail.config.autoStatus), AUTO_STATUS_VALUES, "pending"),
    excludedTagsRaw: asListText(detail.config.excludedTags),
    agentModeId: asString(detail.config.agentModeId),
    knowledgeSetIds: asStringArray(detail.config.knowledgeSetIds),
    maxCommentHistory: asNumber(detail.config.maxCommentHistory, 12),
    attachmentReadingEnabled: detail.config.attachmentReadingEnabled !== false,
    attachmentTypeRestrictionEnabled: detail.config.attachmentTypeRestrictionEnabled !== false,
    maxAttachmentCount: Math.max(1, Math.min(100, asNumber(detail.config.maxAttachmentCount, 5))),
    maxAttachmentSizeMb: Math.max(1, Math.min(50, bytesToMb(detail.config.maxAttachmentBytes, 10))),
    allowedAttachmentMimeTypesRaw: asListText(
      Array.isArray(detail.config.allowedAttachmentMimeTypes)
        ? detail.config.allowedAttachmentMimeTypes
        : DEFAULT_ATTACHMENT_MIME_TYPES
    ),
    dingtalkNotificationEnabled: asBoolean(detail.config.dingtalkNotificationEnabled),
    dingtalkNotificationManualRunsEnabled: asBoolean(detail.config.dingtalkNotificationManualRunsEnabled),
    dingtalkNotificationWebhookUrlDraft: "",
    dingtalkNotificationRobotSecretDraft: "",
    dingtalkNotificationFallbackUserIds: asStringArray(detail.config.dingtalkNotificationFallbackUserIds),
    dingtalkNotificationGroupFallbacks: normalizeGroupFallbackRules(detail.config.dingtalkNotificationGroupFallbacks),
    dingtalkNotificationTemplate: normalizeDingTalkNotificationTemplate(detail.config.dingtalkNotificationTemplate),
    dingtalkReviewRequiredEnabled:
      detail.config.dingtalkReviewRequiredEnabled === undefined
        ? asBoolean(detail.config.dingtalkNotificationEnabled)
        : asBoolean(detail.config.dingtalkReviewRequiredEnabled),
    dingtalkReviewDueHours: Math.max(1, Math.min(168, asNumber(detail.config.dingtalkReviewDueHours, 24))),
    aiReviewEmailReminderEnabled: asBoolean(detail.config.aiReviewEmailReminderEnabled),
    aiReviewEmailReminderTime: normalizeAiReviewEmailReminderTime(detail.config.aiReviewEmailReminderTime),
    aiReviewEmailReminderTimezone: normalizeAiReviewEmailReminderTimezone(detail.config.aiReviewEmailReminderTimezone),
    aiReviewEmailReminderCcEmailsRaw: asListText(detail.config.aiReviewEmailReminderCcEmails),
    systemPrompt: normalizeZendeskChannelPrompt(detail.config.systemPrompt)
  };
}

function parseList(value: string) {
  return value
    .split(/,|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionsWithCurrent(options: Array<{ label: string; value: string }>, value: string) {
  if (!value) return options;
  if (options.some((item) => item.value === value)) return options;
  return [{ label: value, value }, ...options];
}

function optionsWithCurrentValues(options: Array<{ label: string; value: string }>, values: string[]) {
  const known = new Set(options.map((item) => item.value));
  const extras = values
    .filter((value) => value && !known.has(value))
    .map((value) => ({ label: value, value }));
  return [...extras, ...options];
}

function zendeskGroupOptionsWithCurrent(
  options: Array<{ label: string; value: string }>,
  rule: ZendeskDingTalkGroupFallbackRule
) {
  const value = asString(rule.groupId).trim();
  if (!value || options.some((item) => item.value === value)) return options;
  const label = rule.groupName ? `${rule.groupName} (#${value})` : value;
  return [{ label, value }, ...options];
}

function adminUserDingTalkLabel(user: AdminUser) {
  const name = user.synced.displayName || user.synced.email || user.synced.dingtalkUserId || user.id;
  const email = user.synced.email ? ` · ${user.synced.email}` : "";
  return `${name}${email}`;
}

function formatLocalDateTime(value?: string) {
  if (!value) return "-";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(at);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function runStatusLabel(run: ZendeskRunRecord) {
  const map: Record<ZendeskRunRecord["status"], string> = {
    received: "已接收",
    deferred: "部署后处理",
    skipped: "已跳过",
    processing: "处理中",
    replied: "已公开回复",
    noted: "已写内部备注",
    handoff: "待人工接管",
    failed: "执行失败"
  };
  return map[run.status];
}

export function ZendeskIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<ZendeskTab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<ZendeskConfigDraft>(() => buildDraft(props.detail));
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [refreshingOperations, setRefreshingOperations] = useState(false);
  const [runningTicket, setRunningTicket] = useState(false);
  const [manualTicketId, setManualTicketId] = useState("");
  const [cleanupRetentionDays, setCleanupRetentionDays] = useState(7);
  const [cleanupLimit, setCleanupLimit] = useState(100);
  const [cleanupPreview, setCleanupPreview] = useState<ZendeskCacheCleanupResult | null>(null);
  const [previewingCleanup, setPreviewingCleanup] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [sendingEmailReminder, setSendingEmailReminder] = useState<"test" | "live" | null>(null);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsErrorText, setOptionsErrorText] = useState("");
  const [zendeskGroupsLoading, setZendeskGroupsLoading] = useState(false);
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [knowledgeSets, setKnowledgeSets] = useState<KnowledgeSetRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [zendeskGroups, setZendeskGroups] = useState<ZendeskGroupOption[]>([]);

  useEffect(() => {
    setName(props.detail.instance.name);
    setDescription(props.detail.instance.description || "");
    setStatus(props.detail.instance.status);
    setDraft(buildDraft(props.detail));
  }, [props.detail]);

  useEffect(() => {
    setManualTicketId("");
    setCleanupPreview(null);
    setErrorText("");
    setSuccessText("");
  }, [props.detail.instance.id]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsErrorText("");
      try {
        const [modeResponse, knowledgeSetResponse, usersResponse] = await Promise.all([
          fetchAgentModes(),
          fetchKnowledgeSets(),
          fetchAdminUsers()
        ]);
        if (!active) return;
        setAgentModes(modeResponse.agentModes.filter((item) => item.status === "active"));
        setKnowledgeSets(
          knowledgeSetResponse.knowledgeSets.filter((item) => item.status === "active" && item.sourceType === "managed_upload")
        );
        setAdminUsers(usersResponse.users);
      } catch (error) {
        if (active) setOptionsErrorText(error instanceof Error ? error.message : "加载 Agent Mode/资料集/用户列表失败");
      } finally {
        if (active) setOptionsLoading(false);
      }
    }

    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadZendeskGroups() {
      if (!props.detail.instance.id || !asString(props.detail.config.zendeskBaseUrl).trim()) {
        setZendeskGroups([]);
        return;
      }
      setZendeskGroupsLoading(true);
      try {
        const response = await fetchZendeskGroups(props.detail.instance.id);
        if (!active) return;
        setZendeskGroups(response.groups.filter((item) => !item.deleted));
      } catch (error) {
        if (active) {
          setOptionsErrorText(error instanceof Error ? error.message : "加载 Zendesk Groups 失败");
        }
      } finally {
        if (active) setZendeskGroupsLoading(false);
      }
    }

    void loadZendeskGroups();
    return () => {
      active = false;
    };
  }, [props.detail.instance.id, props.detail.instance.updatedAt, props.detail.config.zendeskBaseUrl]);

  const agentModeOptions = useMemo(
    () => agentModes.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [agentModes]
  );
  const knowledgeSetOptions = useMemo(
    () => knowledgeSets.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [knowledgeSets]
  );
  const dingtalkUserOptions = useMemo(
    () =>
      adminUsers
        .filter((user) => user.effective.status === "active" && Boolean(user.synced.dingtalkUserId))
        .map((user) => ({
          label: adminUserDingTalkLabel(user),
          value: user.synced.dingtalkUserId || ""
        }))
        .filter((item) => Boolean(item.value)),
    [adminUsers]
  );
  const zendeskGroupOptions = useMemo(
    () =>
      zendeskGroups.map((item) => ({
        label: `${item.name} (#${item.id})`,
        value: String(item.id)
      })),
    [zendeskGroups]
  );
  const dingtalkTemplatePreview = useMemo(
    () => renderDingTalkTemplatePreview(draft.dingtalkNotificationTemplate),
    [draft.dingtalkNotificationTemplate]
  );

  async function handleSave() {
    if (draft.enabled && !draft.agentModeId.trim()) {
      setErrorText("启用 Zendesk 自动回复前需要绑定 Agent Mode");
      setSuccessText("");
      setActiveTab("basic");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          enabled: draft.enabled,
          publicBaseUrl: draft.publicBaseUrl.trim(),
          zendeskBaseUrl: draft.zendeskBaseUrl.trim(),
          zendeskEmail: draft.zendeskEmail.trim(),
          responseMode: draft.responseMode.trim(),
          fallbackMode: draft.fallbackMode.trim(),
          autoStatus: draft.autoStatus.trim(),
          excludedTags: parseList(draft.excludedTagsRaw),
          agentModeId: draft.agentModeId.trim(),
          knowledgeSetIds: asStringArray(draft.knowledgeSetIds),
          maxCommentHistory: Math.max(1, Math.min(50, Number(draft.maxCommentHistory) || 12)),
          attachmentReadingEnabled: draft.attachmentReadingEnabled,
          attachmentTypeRestrictionEnabled: draft.attachmentTypeRestrictionEnabled,
          maxAttachmentCount: Math.max(1, Math.min(100, Number(draft.maxAttachmentCount) || 5)),
          maxAttachmentBytes: Math.max(1, Math.min(50, Number(draft.maxAttachmentSizeMb) || 10)) * 1024 * 1024,
          allowedAttachmentMimeTypes: parseList(draft.allowedAttachmentMimeTypesRaw),
          dingtalkNotificationEnabled: draft.dingtalkNotificationEnabled,
          dingtalkNotificationManualRunsEnabled: draft.dingtalkNotificationManualRunsEnabled,
          dingtalkNotificationFallbackUserIds: asStringArray(draft.dingtalkNotificationFallbackUserIds),
          dingtalkNotificationGroupFallbacks: prepareGroupFallbackRules(draft.dingtalkNotificationGroupFallbacks),
          dingtalkNotificationTemplate: normalizeDingTalkNotificationTemplate(draft.dingtalkNotificationTemplate),
          dingtalkReviewRequiredEnabled: draft.dingtalkReviewRequiredEnabled,
          dingtalkReviewDueHours: Math.max(1, Math.min(168, Number(draft.dingtalkReviewDueHours) || 24)),
          aiReviewEmailReminderEnabled: draft.aiReviewEmailReminderEnabled,
          aiReviewEmailReminderTime: normalizeAiReviewEmailReminderTime(draft.aiReviewEmailReminderTime),
          aiReviewEmailReminderTimezone: normalizeAiReviewEmailReminderTimezone(draft.aiReviewEmailReminderTimezone),
          aiReviewEmailReminderCcEmails: parseList(draft.aiReviewEmailReminderCcEmailsRaw),
          systemPrompt: draft.systemPrompt.trim()
        },
        secretState:
          draft.zendeskApiTokenDraft.trim() ||
          draft.webhookSigningSecretDraft.trim() ||
          draft.dingtalkNotificationWebhookUrlDraft.trim() ||
          draft.dingtalkNotificationRobotSecretDraft.trim()
            ? {
                ...(draft.zendeskApiTokenDraft.trim() ? { zendeskApiToken: draft.zendeskApiTokenDraft.trim() } : {}),
                ...(draft.webhookSigningSecretDraft.trim()
                  ? { webhookSigningSecret: draft.webhookSigningSecretDraft.trim() }
                  : {}),
                ...(draft.dingtalkNotificationWebhookUrlDraft.trim()
                  ? { dingtalkNotificationWebhookUrl: draft.dingtalkNotificationWebhookUrlDraft.trim() }
                  : {}),
                ...(draft.dingtalkNotificationRobotSecretDraft.trim()
                  ? { dingtalkNotificationRobotSecret: draft.dingtalkNotificationRobotSecretDraft.trim() }
                  : {})
              }
            : undefined
      });
      props.onUpdated(detail);
      setSuccessText("Zendesk 集成已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Zendesk 集成失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendAiReviewEmailReminder(mode: "test" | "live") {
    setSendingEmailReminder(mode);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await sendZendeskAiReviewEmailReminder(props.detail.instance.id, mode);
      const result = response.result;
      if (!result.sent) {
        setSuccessText(result.detail || "当前没有可发送的 Zendesk AI 评分提醒邮件");
        return;
      }
      if (mode === "test") {
        setSuccessText(`测试邮件已发送给 ${result.to.join(", ")}，包含 ${result.pendingCount} 个 Pending 任务。`);
      } else {
        setSuccessText(
          `提醒邮件已发送给 ${result.reviewerCount} 个处理人，共 ${result.pendingCount} 个 Pending 任务。${
            result.skippedNoEmailCount > 0 ? ` 有 ${result.skippedNoEmailCount} 个任务因缺少邮箱未发送。` : ""
          }`
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发送 Zendesk AI 评分提醒邮件失败");
    } finally {
      setSendingEmailReminder(null);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText("");
    setSuccessText("");
    try {
      const result = await validateIntegrationInstance(props.detail.instance.id);
      props.onUpdated(result.detail);
      if (result.validation.status === "success") {
        setSuccessText("Zendesk 验证通过");
      } else {
        setErrorText(
          typeof result.validation.detail === "object" && result.validation.detail && "error" in result.validation.detail
            ? String((result.validation.detail as { error?: unknown }).error || "Zendesk 验证失败")
            : "Zendesk 验证失败"
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "验证 Zendesk 集成失败");
    } finally {
      setValidating(false);
    }
  }

  async function handleRefreshOperations() {
    setRefreshingOperations(true);
    setErrorText("");
    setSuccessText("");
    try {
      props.onUpdated(await fetchIntegrationDetail(props.detail.instance.id));
      setSuccessText("Webhook 与运行记录已刷新");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "刷新 Zendesk 运维数据失败");
    } finally {
      setRefreshingOperations(false);
    }
  }

  async function handleManualRun() {
    if (!manualTicketId.trim()) {
      setErrorText("请输入要测试的 ticket ID");
      setSuccessText("");
      return;
    }
    setRunningTicket(true);
    setErrorText("");
    setSuccessText("");
    try {
      const result = await runZendeskIntegrationTicket(props.detail.instance.id, manualTicketId.trim());
      props.onUpdated(result.detail);
      setSuccessText(`已执行 ticket #${manualTicketId.trim()} 的手动处理`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "手动执行 Zendesk ticket 失败");
    } finally {
      setRunningTicket(false);
    }
  }

  async function handlePreviewCleanup() {
    setPreviewingCleanup(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await previewZendeskCacheCleanup(props.detail.instance.id, {
        retentionDays: cleanupRetentionDays,
        limit: cleanupLimit
      });
      setCleanupPreview(response.result);
      setSuccessText("缓存清理预览已生成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "生成缓存清理预览失败");
    } finally {
      setPreviewingCleanup(false);
    }
  }

  async function handleRunCleanup() {
    if (!cleanupPreview || cleanupPreview.eligibleCount <= 0) {
      setErrorText("当前预览没有可清理目录");
      setSuccessText("");
      return;
    }
    const confirmed = window.confirm(
      `确认删除 ${cleanupPreview.eligibleCount} 个 closed ticket 运行缓存，预计释放 ${formatBytes(cleanupPreview.reclaimableBytes)}？`
    );
    if (!confirmed) return;

    setRunningCleanup(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await runZendeskCacheCleanup(props.detail.instance.id, {
        retentionDays: cleanupRetentionDays,
        limit: cleanupLimit
      });
      setCleanupPreview(response.result);
      setSuccessText(`已清理 ${response.result.deletedCount} 个目录，释放 ${formatBytes(response.result.deletedBytes)}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "执行缓存清理失败");
    } finally {
      setRunningCleanup(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccessText(`${label} 已复制`);
      setErrorText("");
    } catch {
      setErrorText(`复制 ${label} 失败`);
    }
  }

  const zendeskSetup = props.detail.zendesk?.setup;
  const launchChecks = [
    {
      label: "实例启用",
      ok: draft.enabled && status === "active",
      detail: draft.enabled && status === "active" ? "Webhook 会接收并处理工单" : "把实例状态设为 active，并打开启用集成"
    },
    {
      label: "连接验证",
      ok: Boolean(props.detail.config.lastValidatedAt),
      detail: props.detail.config.lastValidatedAt ? "Zendesk API token 可用" : "先点验证实例，确认账号和 token 可用"
    },
    {
      label: "Webhook 地址",
      ok: Boolean(zendeskSetup?.webhookUrl),
      detail: zendeskSetup?.webhookUrl ? "复制实例专属地址到 Zendesk" : "填写 Public Base URL 后保存"
    },
    {
      label: "智能体绑定",
      ok: Boolean(draft.agentModeId),
      detail: draft.agentModeId ? "已绑定 Agent Mode 和可选资料集" : "先选择一个 Agent Mode，运行参数将从该智能体继承"
    },
    {
      label: "上线策略",
      ok: draft.responseMode === "internal_note",
      detail: draft.responseMode === "internal_note" ? "当前为内部备注试运行" : "当前允许公开回复，请确认知识库覆盖后再上线"
    }
  ];

  return (
    <section className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{props.detail.instance.name}</h3>
            <p>管理 Zendesk 站点、Webhook、Agent Mode、资料集和回复策略。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Zendesk 详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as ZendeskTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}
        {optionsErrorText ? <Alert type="warning" showIcon className="admin-alert-inline" message={optionsErrorText} /> : null}

        {activeTab === "basic" ? (
          <>
            <div className="zendesk-config-hero">
              <div>
                <strong>Zendesk 自动回复配置入口</strong>
                <p>
                  建议先用内部备注试运行。确认回复质量稳定后，再把 Response Mode 改为允许公开回复。
                </p>
              </div>
              <Tag color={draft.responseMode === "internal_note" ? "processing" : "warning"}>
                {draft.responseMode === "internal_note" ? "内部试运行" : "公开回复模式"}
              </Tag>
            </div>

            <Collapse
              size="small"
              defaultActiveKey={["identity", "connection", "runtime", "context", "advanced"]}
              items={[
                {
                  key: "identity",
                  label: "基础信息",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">实例名称</span>
                        <Input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field-label">实例 slug</span>
                        <Input value={props.detail.instance.slug} disabled />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">实例描述</span>
                        <Input.TextArea
                          rows={4}
                          value={description}
                          disabled={saving}
                          onChange={(event) => setDescription(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">状态</span>
                        <Select value={status} options={STATUS_OPTIONS} disabled={saving} onChange={(value) => setStatus(value)} />
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.enabled}
                          disabled={saving}
                          checkedChildren="启用"
                          unCheckedChildren="停用"
                          onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                        />
                        <span className="field-label">启用集成</span>
                      </label>
                      <div className="field">
                        <span className="field-label">密钥状态</span>
                        <p className="resource-center-subtle">
                          {props.detail.secretState.hasSecrets ? "已保存 Zendesk 凭证" : "未保存 Zendesk 凭证"}
                        </p>
                      </div>
                    </div>
                  )
                },
                {
                  key: "connection",
                  label: "连接与密钥",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">Public Base URL</span>
                        <Input
                          value={draft.publicBaseUrl}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk Base URL</span>
                        <Input
                          value={draft.zendeskBaseUrl}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, zendeskBaseUrl: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk Email</span>
                        <Input
                          value={draft.zendeskEmail}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, zendeskEmail: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk API Token</span>
                        <Input.Password
                          value={draft.zendeskApiTokenDraft}
                          placeholder="留空则保持现状"
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, zendeskApiTokenDraft: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Webhook Secret</span>
                        <Input.Password
                          value={draft.webhookSigningSecretDraft}
                          placeholder="留空则保持现状"
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, webhookSigningSecretDraft: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                  )
                },
                {
                  key: "notifications",
                  label: "AI 结果钉钉通知",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field checkbox-field resource-center-toggle-row resource-center-form-span-2">
                        <Switch
                          checked={draft.dingtalkNotificationEnabled}
                          disabled={saving}
                          checkedChildren="发送"
                          unCheckedChildren="关闭"
                          onChange={(checked) =>
                            setDraft((current) => ({ ...current, dingtalkNotificationEnabled: checked }))
                          }
                        />
                        <span className="field-label">AI 写入 Zendesk 后发送钉钉消息</span>
                        <span className="field-help">
                          只在 Agent Studio 成功写入内部备注或公开回复后发送，消息内容为英文 Markdown，并在末尾 @ 当前处理人。
                        </span>
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">DingTalk Robot Webhook</span>
                        <Input.Password
                          value={draft.dingtalkNotificationWebhookUrlDraft}
                          placeholder="留空则保持现状"
                          disabled={saving || !draft.dingtalkNotificationEnabled}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, dingtalkNotificationWebhookUrlDraft: event.target.value }))
                          }
                        />
                        <span className="field-help">
                          使用钉钉群自定义机器人 webhook；不要再让 Zendesk 的 Dingtalk L2 Ticket Trigger 直接发群消息。
                        </span>
                      </label>
                      <label className="field">
                        <span className="field-label">Robot Secret</span>
                        <Input.Password
                          value={draft.dingtalkNotificationRobotSecretDraft}
                          placeholder="可选，留空则保持现状"
                          disabled={saving || !draft.dingtalkNotificationEnabled}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, dingtalkNotificationRobotSecretDraft: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.dingtalkNotificationManualRunsEnabled}
                          disabled={saving || !draft.dingtalkNotificationEnabled}
                          checkedChildren="通知"
                          unCheckedChildren="不通知"
                          onChange={(checked) =>
                            setDraft((current) => ({ ...current, dingtalkNotificationManualRunsEnabled: checked }))
                          }
                        />
                        <span className="field-label">手动执行也发送</span>
                        <span className="field-help">默认关闭，避免测试 ticket 打扰钉钉群。</span>
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.dingtalkReviewRequiredEnabled}
                          disabled={saving || !draft.dingtalkNotificationEnabled}
                          checkedChildren="必评"
                          unCheckedChildren="关闭"
                          onChange={(checked) =>
                            setDraft((current) => ({ ...current, dingtalkReviewRequiredEnabled: checked }))
                          }
                        />
                        <span className="field-label">要求 @ 人评分</span>
                        <span className="field-help">
                          开启后，每个被 @ 的钉钉用户都会生成必评任务、钉钉待办，并收到个人工作通知。
                        </span>
                      </label>
                      <label className="field">
                        <span className="field-label">评分截止时间</span>
                        <InputNumber
                          min={1}
                          max={168}
                          addonAfter="hours"
                          value={draft.dingtalkReviewDueHours}
                          disabled={saving || !draft.dingtalkNotificationEnabled || !draft.dingtalkReviewRequiredEnabled}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, dingtalkReviewDueHours: Number(value) || 24 }))
                          }
                          style={{ width: "100%" }}
                        />
                        <span className="field-help">超时后进入后台逾期统计，并作为钉钉待办截止时间。</span>
                      </label>
                      <div className="field resource-center-form-span-2 zendesk-email-reminder-panel">
                        <div className="zendesk-email-reminder-head">
                          <label className="checkbox-field resource-center-toggle-row">
                            <Switch
                              checked={draft.aiReviewEmailReminderEnabled}
                              disabled={saving || !draft.dingtalkReviewRequiredEnabled}
                              checkedChildren="发送"
                              unCheckedChildren="关闭"
                              onChange={(checked) =>
                                setDraft((current) => ({ ...current, aiReviewEmailReminderEnabled: checked }))
                              }
                            />
                            <span className="field-label">Daily English email digest</span>
                          </label>
                          <span className="field-help">
                            每天一封群发汇总邮件；To 为所有未评分处理人，CC 为固定管理者。Pending 包含已逾期任务。
                          </span>
                        </div>
                        <div className="zendesk-email-reminder-grid">
                          <label className="field">
                            <span className="field-label">Send time</span>
                            <Input
                              type="time"
                              value={draft.aiReviewEmailReminderTime}
                              disabled={
                                saving || !draft.dingtalkReviewRequiredEnabled || !draft.aiReviewEmailReminderEnabled
                              }
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  aiReviewEmailReminderTime: event.target.value || DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIME
                                }))
                              }
                            />
                            <span className="field-help">到达该时间后发送；服务重启后当天未发会补发一次。</span>
                          </label>
                          <label className="field">
                            <span className="field-label">Timezone</span>
                            <Select
                              showSearch
                              value={draft.aiReviewEmailReminderTimezone}
                              options={optionsWithCurrent(
                                AI_REVIEW_EMAIL_REMINDER_TIMEZONE_OPTIONS,
                                draft.aiReviewEmailReminderTimezone
                              )}
                              disabled={
                                saving || !draft.dingtalkReviewRequiredEnabled || !draft.aiReviewEmailReminderEnabled
                              }
                              onChange={(value) =>
                                setDraft((current) => ({
                                  ...current,
                                  aiReviewEmailReminderTimezone: value || DEFAULT_AI_REVIEW_EMAIL_REMINDER_TIMEZONE
                                }))
                              }
                            />
                            <span className="field-help">用于判断每天发送时间和邮件内到期时间显示。</span>
                          </label>
                          <label className="field resource-center-form-span-2">
                            <span className="field-label">Fixed CC emails</span>
                            <Input.TextArea
                              rows={3}
                              value={draft.aiReviewEmailReminderCcEmailsRaw}
                              placeholder={"manager@example.com\nlead@example.com"}
                              disabled={
                                saving || !draft.dingtalkReviewRequiredEnabled || !draft.aiReviewEmailReminderEnabled
                              }
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  aiReviewEmailReminderCcEmailsRaw: event.target.value
                                }))
                              }
                            />
                            <span className="field-help">
                              可用换行或逗号分隔。邮件正文按处理人分组列出未评分任务，逾期任务显示 Past due by X days。
                            </span>
                          </label>
                          <div className="field resource-center-form-span-2 zendesk-email-reminder-actions">
                            <Button
                              disabled={
                                saving ||
                                !draft.dingtalkReviewRequiredEnabled ||
                                !draft.aiReviewEmailReminderEnabled ||
                                Boolean(sendingEmailReminder)
                              }
                              loading={sendingEmailReminder === "test"}
                              onClick={() => void handleSendAiReviewEmailReminder("test")}
                            >
                              Send test digest now
                            </Button>
                            <Popconfirm
                              title="Send reminder now?"
                              description="This will email all reviewers with pending Zendesk AI review tasks and mark today's reminder as sent."
                              okText="Send"
                              cancelText="Cancel"
                              onConfirm={() => void handleSendAiReviewEmailReminder("live")}
                              disabled={
                                saving ||
                                !draft.dingtalkReviewRequiredEnabled ||
                                !draft.aiReviewEmailReminderEnabled ||
                                Boolean(sendingEmailReminder)
                              }
                            >
                              <Button
                                type="primary"
                                disabled={
                                  saving ||
                                  !draft.dingtalkReviewRequiredEnabled ||
                                  !draft.aiReviewEmailReminderEnabled ||
                                  Boolean(sendingEmailReminder)
                                }
                                loading={sendingEmailReminder === "live"}
                              >
                                Send reminder now
                              </Button>
                            </Popconfirm>
                          </div>
                        </div>
                      </div>
                      <div className="field resource-center-form-span-2 zendesk-group-fallback-panel">
                        <div className="zendesk-group-fallback-head">
                          <div>
                            <span className="field-label">Team fallback routing</span>
                            <span className="field-help">
                              当 assignee 为空或无法映射钉钉用户时，先按 Zendesk Group 指派评分人；未命中的 ticket 再走全局 fallback。
                            </span>
                          </div>
                          <Button
                            size="small"
                            disabled={saving || !draft.dingtalkNotificationEnabled}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                dingtalkNotificationGroupFallbacks: [
                                  ...current.dingtalkNotificationGroupFallbacks,
                                  { groupId: "", groupName: "", userIds: [] }
                                ]
                              }))
                            }
                          >
                            添加规则
                          </Button>
                        </div>
                        <div className="zendesk-group-fallback-flow">
                          Assignee match → Zendesk Group fallback → Global fallback
                        </div>
                        {draft.dingtalkNotificationGroupFallbacks.length === 0 ? (
                          <div className="zendesk-group-fallback-empty">
                            暂未配置团队兜底。US team 未分配或无法映射 assignee 的 ticket 会继续走全局 fallback。
                          </div>
                        ) : (
                          <div className="zendesk-group-fallback-list">
                            {draft.dingtalkNotificationGroupFallbacks.map((rule, index) => (
                              <div className="zendesk-group-fallback-row" key={`${rule.groupId || rule.groupName || "rule"}-${index}`}>
                                <label className="field">
                                  <span className="field-label">Zendesk Group</span>
                                  <Select
                                    showSearch
                                    allowClear
                                    value={rule.groupId || undefined}
                                    options={zendeskGroupOptionsWithCurrent(zendeskGroupOptions, rule)}
                                    loading={zendeskGroupsLoading}
                                    optionFilterProp="label"
                                    disabled={saving || !draft.dingtalkNotificationEnabled}
                                    placeholder="选择 US / Global support group"
                                    onChange={(value) => {
                                      const selected = zendeskGroups.find((item) => String(item.id) === value);
                                      setDraft((current) => ({
                                        ...current,
                                        dingtalkNotificationGroupFallbacks: current.dingtalkNotificationGroupFallbacks.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                groupId: value || "",
                                                groupName: selected?.name || item.groupName || ""
                                              }
                                            : item
                                        )
                                      }));
                                    }}
                                  />
                                </label>
                                <label className="field">
                                  <span className="field-label">评分接收人</span>
                                  <Select
                                    mode="multiple"
                                    showSearch
                                    value={rule.userIds}
                                    options={optionsWithCurrentValues(dingtalkUserOptions, rule.userIds)}
                                    loading={optionsLoading}
                                    optionFilterProp="label"
                                    disabled={saving || !draft.dingtalkNotificationEnabled}
                                    placeholder="搜索姓名、邮箱或钉钉 ID"
                                    onChange={(value) =>
                                      setDraft((current) => ({
                                        ...current,
                                        dingtalkNotificationGroupFallbacks: current.dingtalkNotificationGroupFallbacks.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, userIds: value } : item
                                        )
                                      }))
                                    }
                                  />
                                </label>
                                <Button
                                  danger
                                  disabled={saving || !draft.dingtalkNotificationEnabled}
                                  onClick={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      dingtalkNotificationGroupFallbacks: current.dingtalkNotificationGroupFallbacks.filter(
                                        (_item, itemIndex) => itemIndex !== index
                                      )
                                    }))
                                  }
                                >
                                  删除
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">Fallback @ Users</span>
                        <Select
                          mode="multiple"
                          showSearch
                          value={draft.dingtalkNotificationFallbackUserIds}
                          options={optionsWithCurrentValues(dingtalkUserOptions, draft.dingtalkNotificationFallbackUserIds)}
                          loading={optionsLoading}
                          optionFilterProp="label"
                          disabled={saving || !draft.dingtalkNotificationEnabled}
                          placeholder="搜索姓名、邮箱或钉钉 ID"
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, dingtalkNotificationFallbackUserIds: value }))
                          }
                        />
                        <span className="field-help">
                          仅当 ticket 没有 assignee，或 assignee 无法映射到钉钉用户时，才 @ 这些 fallback 用户。
                        </span>
                      </label>
                      <div className="field resource-center-form-span-2 zendesk-dingtalk-template-shell">
                        <div className="zendesk-dingtalk-template-head">
                          <div>
                            <span className="field-label">Message Template</span>
                            <span className="field-help">
                              钉钉消息使用 Markdown；保留 {"{{mention}}"} 才会触发真实 @，{"{{mentionLabel}}"} 只用于显示姓名。
                            </span>
                          </div>
                          <Button
                            size="small"
                            disabled={saving || !draft.dingtalkNotificationEnabled}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                dingtalkNotificationTemplate: DEFAULT_DINGTALK_NOTIFICATION_TEMPLATE
                              }))
                            }
                          >
                            恢复默认
                          </Button>
                        </div>
                        <div className="zendesk-dingtalk-template-grid">
                          <div className="zendesk-dingtalk-template-editor">
                            <Input.TextArea
                              rows={16}
                              value={draft.dingtalkNotificationTemplate}
                              disabled={saving || !draft.dingtalkNotificationEnabled}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  dingtalkNotificationTemplate: event.target.value
                                }))
                              }
                            />
                            <div className="zendesk-template-token-list" aria-label="钉钉模板变量">
                              {DINGTALK_TEMPLATE_TOKENS.map((item) => (
                                <Tag key={item.token}>
                                  {item.token} · {item.label}
                                </Tag>
                              ))}
                            </div>
                          </div>
                          <div className="zendesk-dingtalk-preview" aria-label="钉钉消息预览">
                            <div className="zendesk-dingtalk-preview-toolbar">
                              <strong>Live Preview</strong>
                              <span>Sample ticket</span>
                            </div>
                            <div className="zendesk-dingtalk-preview-card">
                              <ReactMarkdown>{dingtalkTemplatePreview}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                },
                {
                  key: "runtime",
                  label: "智能体与资料集",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">绑定 Agent Mode</span>
                        <Select
                          showSearch
                          value={draft.agentModeId || undefined}
                          options={optionsWithCurrent(agentModeOptions, draft.agentModeId)}
                          loading={optionsLoading}
                          optionFilterProp="label"
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, agentModeId: value }))}
                        />
                        <span className="field-help">
                          Zendesk 运行时会继承该 Agent Mode 的 Run Profile、指令和技能配置。
                        </span>
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">绑定资料集</span>
                        <Select
                          mode="multiple"
                          showSearch
                          value={draft.knowledgeSetIds}
                          options={knowledgeSetOptions}
                          loading={optionsLoading}
                          optionFilterProp="label"
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, knowledgeSetIds: value }))}
                        />
                        <span className="field-help">
                          资料集会作为只读参考目录挂载给本次 Zendesk 回复任务。
                        </span>
                      </label>
                    </div>
                  )
                },
                {
                  key: "prompts",
                  label: "提示词",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">Channel Prompt</span>
                        <Input.TextArea
                          rows={8}
                          value={draft.systemPrompt}
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, systemPrompt: event.target.value }))
                          }
                        />
                        <span className="field-help">
                          这里只写 Zendesk 通道约束，业务角色、处理边界和客服口吻放到 Agent Mode。
                        </span>
                      </label>
                      <div className="field resource-center-form-span-2">
                        <span className="field-label">Core Protocol</span>
                        <div className="zendesk-code-block">
                          <pre>{ZENDESK_CORE_PROTOCOL_PROMPT}</pre>
                        </div>
                        <span className="field-help">核心 JSON 协议由系统强制追加，展示给管理员核对，不建议改成自由配置。</span>
                      </div>
                      <div className="field resource-center-form-span-2">
                        <div className="zendesk-prompt-template-head">
                          <span className="field-label">Agent Mode Prompt Template</span>
                          <Button size="small" onClick={() => void copyText(AGENT_MODE_PROMPT_TEMPLATE, "Agent Mode Prompt Template")}>
                            复制
                          </Button>
                        </div>
                        <div className="zendesk-code-block">
                          <pre>{AGENT_MODE_PROMPT_TEMPLATE}</pre>
                        </div>
                      </div>
                    </div>
                  )
                },
                {
                  key: "context",
                  label: "上下文与附件",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">最大评论历史</span>
                        <InputNumber
                          min={1}
                          max={50}
                          value={Number(draft.maxCommentHistory) || 12}
                          disabled={saving}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, maxCommentHistory: Number(value) || 12 }))
                          }
                          style={{ width: "100%" }}
                        />
                        <span className="field-help">每次回复都会重新读取这些 Zendesk 评论，作为同一 ticket 的最新事实上下文。</span>
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.attachmentReadingEnabled}
                          disabled={saving}
                          checkedChildren="读取"
                          unCheckedChildren="关闭"
                          onChange={(checked) =>
                            setDraft((current) => ({ ...current, attachmentReadingEnabled: checked }))
                          }
                        />
                        <span className="field-label">读取图片和附件</span>
                        <span className="field-help">客户上传的截图、PDF、表格和文本文件会下载到该 ticket 的工作区供 Agent 参考。</span>
                      </label>
                      <label className="field">
                        <span className="field-label">最多附件数</span>
                        <InputNumber
                          min={1}
                          max={100}
                          value={Number(draft.maxAttachmentCount) || 5}
                          disabled={saving || !draft.attachmentReadingEnabled}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, maxAttachmentCount: Number(value) || 5 }))
                          }
                          style={{ width: "100%" }}
                        />
                        <span className="field-help">同一次处理最多传给 Agent 的附件数量。新触发的客户评论会优先占用名额。</span>
                      </label>
                      <label className="field">
                        <span className="field-label">单文件上限 MB</span>
                        <InputNumber
                          min={1}
                          max={50}
                          value={Number(draft.maxAttachmentSizeMb) || 10}
                          disabled={saving || !draft.attachmentReadingEnabled}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, maxAttachmentSizeMb: Number(value) || 10 }))
                          }
                          style={{ width: "100%" }}
                        />
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row resource-center-form-span-2">
                        <Switch
                          checked={draft.attachmentTypeRestrictionEnabled}
                          disabled={saving || !draft.attachmentReadingEnabled}
                          checkedChildren="限制"
                          unCheckedChildren="不限"
                          onChange={(checked) =>
                            setDraft((current) => ({ ...current, attachmentTypeRestrictionEnabled: checked }))
                          }
                        />
                        <span className="field-label">限制附件类型</span>
                        <span className="field-help">
                          关闭后所有 MIME 类型都会尝试下载；仍受最多附件数和单文件大小限制。
                        </span>
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">允许的附件类型</span>
                        <Input.TextArea
                          rows={3}
                          value={draft.allowedAttachmentMimeTypesRaw}
                          disabled={saving || !draft.attachmentReadingEnabled || !draft.attachmentTypeRestrictionEnabled}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, allowedAttachmentMimeTypesRaw: event.target.value }))
                          }
                        />
                        <span className="field-help">
                          开启类型限制时生效；支持一行一个或逗号分隔，例如 image/*、application/pdf、text/*。
                        </span>
                      </label>
                    </div>
                  )
                },
                {
                  key: "advanced",
                  label: "回复策略",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">Response Mode</span>
                        <Select
                          value={draft.responseMode}
                          options={optionsWithCurrent(RESPONSE_MODE_OPTIONS, draft.responseMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, responseMode: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Fallback Mode</span>
                        <Select
                          value={draft.fallbackMode}
                          options={optionsWithCurrent(FALLBACK_MODE_OPTIONS, draft.fallbackMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, fallbackMode: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Auto Status</span>
                        <Select
                          value={draft.autoStatus}
                          options={optionsWithCurrent(AUTO_STATUS_OPTIONS, draft.autoStatus)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, autoStatus: value }))}
                        />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">排除标签</span>
                        <Input.TextArea
                          rows={2}
                          value={draft.excludedTagsRaw}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, excludedTagsRaw: event.target.value }))}
                        />
                      </label>
                    </div>
                  )
                }
              ]}
            />

            <div className="resource-center-actions">
              <Space>
                <Button onClick={() => void handleValidate()} disabled={saving || validating}>
                  {validating ? "验证中..." : "验证实例"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating}>
                  {saving ? "保存中..." : "保存实例"}
                </Button>
              </Space>
            </div>
          </>
        ) : null}

        {activeTab === "operations" ? (
          <>
            <div className="zendesk-launch-checklist" aria-label="Zendesk 上线检查">
              {launchChecks.map((item) => (
                <div key={item.label} className={item.ok ? "zendesk-check-item zendesk-check-ok" : "zendesk-check-item"}>
                  <span className="zendesk-check-dot" aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="zendesk-summary-grid">
              <div>
                <strong>启用状态</strong>
                <p>{draft.enabled ? "已启用 webhook 自动答复" : "未启用 webhook 自动答复"}</p>
              </div>
              <div>
                <strong>最近验证</strong>
                <p>
                  {props.detail.zendesk
                    ? props.detail.config.lastValidatedAt
                      ? formatLocalDateTime(String(props.detail.config.lastValidatedAt))
                      : "尚未验证"
                    : "暂无运维数据"}
                </p>
              </div>
              <div>
                <strong>Agent Mode</strong>
                <p>{draft.agentModeId ? agentModeOptions.find((item) => item.value === draft.agentModeId)?.label || draft.agentModeId : "未绑定"}</p>
              </div>
              <div>
                <strong>资料集</strong>
                <p>{draft.knowledgeSetIds.length ? `${draft.knowledgeSetIds.length} 个` : "未绑定"}</p>
              </div>
              <div>
                <strong>钉钉通知</strong>
                <p>{draft.dingtalkNotificationEnabled ? "AI 写入后发送" : "未启用"}</p>
              </div>
            </div>

            {props.detail.zendesk?.missing?.length ? (
              <Alert
                type="warning"
                showIcon
                className="admin-alert-inline"
                message={`缺少关键项：${props.detail.zendesk.missing.join(", ")}`}
              />
            ) : null}

            <div className="zendesk-section">
              <h4>Zendesk 侧配置</h4>
              <div className="zendesk-inline-actions">
                <Button onClick={() => void copyText(zendeskSetup?.webhookUrl || "", "Webhook URL")}>
                  复制实例 Webhook URL
                </Button>
                <Button onClick={() => void copyText(zendeskSetup?.payloadExample || "", "Payload 示例")}>
                  复制 Payload
                </Button>
              </div>
              <label className="field">
                <span className="field-label">实例专属 Webhook URL</span>
                <Input readOnly value={zendeskSetup?.webhookUrl || ""} />
              </label>
              {zendeskSetup?.legacyWebhookUrl ? (
                <label className="field">
                  <span className="field-label">兼容旧地址</span>
                  <Input readOnly value={zendeskSetup.legacyWebhookUrl} />
                </label>
              ) : null}
              <div className="zendesk-code-block">
                <pre>{zendeskSetup?.payloadExample || ""}</pre>
              </div>
              <ol className="zendesk-setup-steps">
                <li>在 Zendesk Admin Center 创建 Webhook，Endpoint URL 粘贴上面的实例专属地址。</li>
                <li>Webhook Signing Secret 填这里配置的 Webhook Secret，HTTP method 选 POST。</li>
                <li>创建两个 Trigger：新工单创建、客户追加公开评论；Action 选择 Notify active webhook。</li>
                <li>Payload 使用上面的 JSON，只保留 ticket_id 也可以。</li>
              </ol>
              <div className="zendesk-trigger-list">
                {(zendeskSetup?.triggers || []).map((item) => (
                  <div key={item.name} className="zendesk-trigger-card">
                    <strong>{item.name}</strong>
                    <p>{item.description}</p>
                    <ul>
                      {item.conditions.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="zendesk-section">
              <h4>操作与日志</h4>
              <div className="zendesk-inline-actions zendesk-manual-run-row">
                <Input
                  value={manualTicketId}
                  onChange={(event) => setManualTicketId(event.target.value)}
                  placeholder="输入 Zendesk ticket ID 进行手动测试"
                />
                <Button type="primary" onClick={() => void handleManualRun()} disabled={runningTicket}>
                  {runningTicket ? "执行中..." : "手动执行"}
                </Button>
              </div>

              <div className="zendesk-inline-actions">
                <Button onClick={() => void handleRefreshOperations()} disabled={refreshingOperations}>
                  {refreshingOperations ? "刷新中..." : "刷新"}
                </Button>
                <Button onClick={() => void handleValidate()} disabled={saving || validating || refreshingOperations}>
                  {validating ? "验证中..." : "验证凭证"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating || refreshingOperations}>
                  {saving ? "保存中..." : "保存配置"}
                </Button>
              </div>

              <div className="zendesk-run-list">
                {props.detail.zendesk?.runs?.length ? (
                  props.detail.zendesk.runs.map((run) => (
                    <article key={run.id} className={`zendesk-run-card zendesk-run-${run.status}`}>
                      <div className="zendesk-run-head">
                        <strong>#{run.ticketId}</strong>
                        <span className={`zendesk-run-badge zendesk-run-badge-${run.status}`}>{runStatusLabel(run)}</span>
                      </div>
                      <p className="zendesk-run-title">{run.ticketSubject || "未命名工单"}</p>
                      <p>{run.detail}</p>
                      <p className="field-help">
                        {formatLocalDateTime(run.updatedAt)} · {run.source === "manual" ? "手动" : "webhook"}
                        {run.commentId ? ` · comment ${run.commentId}` : ""}
                        {run.requesterCommentId ? ` · requester ${run.requesterCommentId}` : ""}
                      </p>
                      {run.error ? <p className="err-text">{run.error}</p> : null}
                    </article>
                  ))
                ) : (
                  <p className="field-help">暂无执行记录。</p>
                )}
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "cache" ? (
          <div className="zendesk-section zendesk-cache-cleanup">
            <div className="zendesk-cache-toolbar">
              <div>
                <h4>Zendesk 运行缓存清理</h4>
                <p>
                  只检查当前实例的 <code>zendesk-*-ticket-*</code> Codex HOME。预览会实时读取 Zendesk ticket 状态，执行时只删除
                  closed 且超过保留期的目录。
                </p>
              </div>
              <Tag color="processing">closed only</Tag>
            </div>

            <div className="zendesk-cache-controls">
              <label className="field">
                <span className="field-label">closed 后保留天数</span>
                <InputNumber
                  min={1}
                  max={365}
                  value={cleanupRetentionDays}
                  disabled={previewingCleanup || runningCleanup}
                  onChange={(value) => setCleanupRetentionDays(Math.max(1, Math.min(365, Number(value) || 7)))}
                />
              </label>
              <label className="field">
                <span className="field-label">单次检查目录数</span>
                <InputNumber
                  min={1}
                  max={500}
                  value={cleanupLimit}
                  disabled={previewingCleanup || runningCleanup}
                  onChange={(value) => setCleanupLimit(Math.max(1, Math.min(500, Number(value) || 100)))}
                />
              </label>
              <div className="zendesk-cache-actions">
                <Button onClick={() => void handlePreviewCleanup()} disabled={previewingCleanup || runningCleanup}>
                  {previewingCleanup ? "预览中..." : "生成预览"}
                </Button>
                <Button
                  danger
                  type="primary"
                  onClick={() => void handleRunCleanup()}
                  disabled={runningCleanup || previewingCleanup || !cleanupPreview?.eligibleCount}
                >
                  {runningCleanup ? "清理中..." : "清理可删除项"}
                </Button>
              </div>
            </div>

            {cleanupPreview ? (
              <>
                <div className="zendesk-summary-grid zendesk-cache-summary">
                  <div>
                    <strong>匹配目录</strong>
                    <p>
                      {cleanupPreview.matchedCount} / {cleanupPreview.scannedCount}
                    </p>
                  </div>
                  <div>
                    <strong>当前占用</strong>
                    <p>{formatBytes(cleanupPreview.totalBytes)}</p>
                  </div>
                  <div>
                    <strong>可清理</strong>
                    <p>
                      {cleanupPreview.eligibleCount} 个 · {formatBytes(cleanupPreview.reclaimableBytes)}
                    </p>
                  </div>
                  <div>
                    <strong>已删除</strong>
                    <p>
                      {cleanupPreview.deletedCount} 个 · {formatBytes(cleanupPreview.deletedBytes)}
                    </p>
                  </div>
                </div>

                <p className="field-help">
                  预览时间 {formatLocalDateTime(cleanupPreview.generatedAt)}，当前只展示本次检查的 {cleanupPreview.items.length} 个目录。
                </p>

                <div className="zendesk-cache-list">
                  {cleanupPreview.items.length ? (
                    cleanupPreview.items.map((item) => (
                      <article
                        key={item.directoryName}
                        className={
                          item.deleted
                            ? "zendesk-cache-row zendesk-cache-row-deleted"
                            : item.eligible
                              ? "zendesk-cache-row zendesk-cache-row-eligible"
                              : "zendesk-cache-row"
                        }
                      >
                        <div className="zendesk-cache-row-head">
                          <div>
                            <strong>#{item.ticketId}</strong>
                            <p>{item.directoryName}</p>
                          </div>
                          <Tag color={item.deleted ? "success" : item.eligible ? "warning" : "default"}>
                            {item.deleted ? "已删除" : item.eligible ? "可清理" : "保留"}
                          </Tag>
                        </div>
                        <div className="zendesk-cache-row-meta">
                          <span>{formatBytes(item.sizeBytes)}</span>
                          <span>目录修改 {formatLocalDateTime(item.modifiedAt)}</span>
                          <span>ticket {item.ticketStatus || "未知"}</span>
                          {item.ticketUpdatedAt ? <span>ticket 更新 {formatLocalDateTime(item.ticketUpdatedAt)}</span> : null}
                        </div>
                        <p>{item.reason}</p>
                        {item.error ? <p className="err-text">{item.error}</p> : null}
                      </article>
                    ))
                  ) : (
                    <p className="field-help">没有找到当前实例的 Zendesk 运行缓存目录。</p>
                  )}
                </div>
              </>
            ) : (
              <Alert
                type="info"
                showIcon
                className="admin-alert-inline"
                message="先生成预览，确认 closed 工单与预计释放空间后再执行清理。"
              />
            )}
          </div>
        ) : null}

        {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "history" ? <IntegrationValidationHistory items={props.detail.validationHistory.items} /> : null}
      </Card>
    </section>
  );
}
