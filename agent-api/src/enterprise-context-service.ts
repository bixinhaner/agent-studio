import { createHash } from "node:crypto";

import {
  createDefaultSystemSettingsPayload,
  type SystemSettingsEnterpriseContext,
  type SystemSettingsEnterpriseContextFields
} from "./system-settings/types.js";

export type EnterpriseContextChannel = "portal" | "dingtalk" | "crest" | "zendesk" | "openai_compatible_api";

export type EnterpriseContextDepartmentSnapshot = {
  name: string;
  position?: string;
  isPrimary?: boolean;
  isLeader?: boolean;
};

export type EnterpriseContextSnapshot = {
  source: "agent_studio_enterprise_directory";
  channel: EnterpriseContextChannel;
  generatedAt: string;
  user?: {
    name?: string;
    email?: string;
    organization?: string;
    title?: string;
    employeeNo?: string;
    workPlace?: string;
    manager?: string;
    departments?: EnterpriseContextDepartmentSnapshot[];
    mobile?: string;
    telephone?: string;
    lastSyncedAt?: string;
  };
};

export type EnterpriseContextResolution = {
  enabled: boolean;
  reason?: string;
  markdown?: string;
  hash?: string;
  snapshot?: EnterpriseContextSnapshot;
};

type UserRow = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  primaryOrganization?: {
    name?: string | null;
    slug?: string | null;
  } | null;
  enterpriseProfile?: {
    employeeNo?: string | null;
    title?: string | null;
    mobile?: string | null;
    telephone?: string | null;
    workPlace?: string | null;
    managerUserId?: string | null;
    managerDingTalkUserId?: string | null;
    lastSyncedAt?: Date | string | null;
  } | null;
  departmentMemberships?: Array<{
    isPrimary?: boolean | null;
    position?: string | null;
    isLeader?: boolean | null;
    department?: {
      name?: string | null;
    } | null;
  }>;
};

type ManagerRow = {
  displayName?: string | null;
  email?: string | null;
};

export type EnterpriseContextServiceDb = {
  user: {
    findUnique(args: unknown): Promise<UserRow | ManagerRow | null>;
  };
};

export type EnterpriseContextServiceOptions = {
  db: EnterpriseContextServiceDb;
  getSettings(): Promise<SystemSettingsEnterpriseContext | undefined>;
  now?: () => Date;
  settingsCacheTtlMs?: number;
  contextCacheTtlMs?: number;
  logger?: Pick<Console, "warn">;
};

const DEFAULT_ENTERPRISE_CONTEXT_SETTINGS = createDefaultSystemSettingsPayload().enterpriseContext;
const DEFAULT_SETTINGS_CACHE_TTL_MS = 30_000;
const DEFAULT_CONTEXT_CACHE_TTL_MS = 5 * 60_000;

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isoOrUndefined(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function channelSettingsKey(channel: EnterpriseContextChannel): keyof SystemSettingsEnterpriseContext["channels"] {
  return channel === "openai_compatible_api" ? "openaiCompatibleApi" : channel;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashSnapshot(snapshot: EnterpriseContextSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex").slice(0, 16);
}

function managerDisplayName(manager: ManagerRow | null | undefined): string | undefined {
  return trimOrUndefined(manager?.displayName) ?? trimOrUndefined(manager?.email);
}

function truncateBlock(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown;
  const closeTag = "</enterprise_context>";
  const bodyMax = Math.max(0, maxChars - closeTag.length - 8);
  const head = markdown.slice(0, bodyMax).trimEnd();
  return `${head}\n...\n${closeTag}`;
}

function buildMarkdown(snapshot: EnterpriseContextSnapshot, fields: SystemSettingsEnterpriseContextFields): string {
  const user = snapshot.user;
  const lines = [
    "<enterprise_context>",
    "You are assisting an enterprise user. The following information comes from the Agent Studio enterprise directory and is provided only to help you understand the current user's identity, department, and work context.",
    "Usage rules:",
    "- You may use this information to understand the scenario, appropriate form of address, and scope of responsibility.",
    "- Do not proactively repeat the full enterprise context unless the user explicitly asks for it.",
    "- Do not write this dynamic enterprise information to long-term memory.",
    "",
    "Current user:"
  ];

  if (!user) {
    lines.push("- No matching enterprise user was found.");
  } else {
    if (fields.identity) {
      if (user.name) lines.push(`- Name: ${user.name}`);
      if (user.email) lines.push(`- Email: ${user.email}`);
    }
    if (fields.organization && user.organization) lines.push(`- Organization: ${user.organization}`);
    if (fields.departmentPosition && user.title) lines.push(`- Job title: ${user.title}`);
    if (fields.employeeNo && user.employeeNo) lines.push(`- Employee number: ${user.employeeNo}`);
    if (fields.workPlace && user.workPlace) lines.push(`- Work location: ${user.workPlace}`);
    if (fields.manager && user.manager) lines.push(`- Direct manager: ${user.manager}`);
    if (fields.departmentPosition && user.departments?.length) {
      const departmentText = user.departments
        .slice(0, 6)
        .map((department) => {
          const tags = [
            department.position ? `Position: ${department.position}` : undefined,
            department.isPrimary ? "Primary department" : undefined,
            department.isLeader ? "Department leader" : undefined
          ].filter(Boolean);
          return tags.length ? `${department.name} (${tags.join(", ")})` : department.name;
        })
        .join("; ");
      lines.push(`- Departments: ${departmentText}`);
    }
    if (fields.contact) {
      if (user.mobile) lines.push(`- Mobile: ${user.mobile}`);
      if (user.telephone) lines.push(`- Telephone: ${user.telephone}`);
    }
    if (user.lastSyncedAt) lines.push(`- Enterprise profile last synchronized at: ${user.lastSyncedAt}`);
  }

  lines.push("</enterprise_context>");
  return lines.join("\n");
}

export function applyEnterpriseContextToPrompt(prompt: string, context?: EnterpriseContextResolution): string {
  const markdown = trimOrUndefined(context?.markdown);
  if (!markdown) return prompt;
  return `${markdown}\n\n${prompt}`;
}

export class EnterpriseContextService {
  private settingsCache?: { value: SystemSettingsEnterpriseContext | undefined; expiresAt: number };
  private readonly contextCache = new Map<string, { value: EnterpriseContextResolution; expiresAt: number }>();

  constructor(private readonly options: EnterpriseContextServiceOptions) {}

  private nowMs(): number {
    return (this.options.now ?? (() => new Date()))().getTime();
  }

  private async loadPublishedSettings(): Promise<SystemSettingsEnterpriseContext | undefined> {
    const now = this.nowMs();
    if (this.settingsCache && this.settingsCache.expiresAt > now) {
      return this.settingsCache.value;
    }
    const value = await this.options.getSettings();
    this.settingsCache = {
      value,
      expiresAt: now + (this.options.settingsCacheTtlMs ?? DEFAULT_SETTINGS_CACHE_TTL_MS)
    };
    return value;
  }

  async resolveForRun(input: {
    channel: EnterpriseContextChannel;
    userId?: string;
    agentModeId?: string;
    settings?: SystemSettingsEnterpriseContext;
  }): Promise<EnterpriseContextResolution> {
    const sourceSettings = input.settings ?? (await this.loadPublishedSettings());
    const settings = {
      ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS,
      ...(sourceSettings || {}),
      channels: {
        ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.channels,
        ...(sourceSettings?.channels ?? {})
      },
      fields: {
        ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.fields,
        ...(sourceSettings?.fields ?? {})
      },
      agentOverrides: sourceSettings?.agentOverrides ?? []
    };

    if (!settings.enabled) return { enabled: false, reason: "enterprise_context_disabled" };
    if (!settings.channels[channelSettingsKey(input.channel)]) {
      return { enabled: false, reason: "channel_disabled" };
    }

    const override = input.agentModeId
      ? settings.agentOverrides.find((item) => item.agentModeId === input.agentModeId)
      : undefined;
    if (override?.enabled === false) {
      return { enabled: false, reason: "agent_override_disabled" };
    }
    if (!input.userId) {
      return { enabled: false, reason: "missing_user" };
    }

    const canUseContextCache = !input.settings;
    const contextCacheKey = canUseContextCache
      ? stableStringify({
          channel: input.channel,
          userId: input.userId,
          agentModeId: input.agentModeId,
          settings
        })
      : undefined;
    const now = this.nowMs();
    if (contextCacheKey) {
      const cached = this.contextCache.get(contextCacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }
    }

    try {
      const user = await this.options.db.user.findUnique({
        where: { id: input.userId },
        include: {
          primaryOrganization: {
            select: {
              name: true,
              slug: true
            }
          },
          enterpriseProfile: true,
          departmentMemberships: {
            include: {
              department: {
                select: { name: true }
              }
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
          }
        }
      }) as UserRow | null;
      if (!user) return { enabled: false, reason: "user_not_found" };

      const managerUserId = trimOrUndefined(user.enterpriseProfile?.managerUserId);
      const managerDingTalkUserId = trimOrUndefined(user.enterpriseProfile?.managerDingTalkUserId);
      const manager = managerUserId
        ? await this.options.db.user.findUnique({
            where: { id: managerUserId },
            select: { displayName: true, email: true }
          }) as ManagerRow | null
        : managerDingTalkUserId
          ? await this.options.db.user.findUnique({
              where: { dingtalkUserId: managerDingTalkUserId },
              select: { displayName: true, email: true }
            }) as ManagerRow | null
          : null;

      const snapshot: EnterpriseContextSnapshot = {
        source: "agent_studio_enterprise_directory",
        channel: input.channel,
        generatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        user: {
          name: trimOrUndefined(user.displayName),
          email: trimOrUndefined(user.email),
          organization:
            trimOrUndefined(user.primaryOrganization?.name) ??
            trimOrUndefined(user.primaryOrganization?.slug),
          title: trimOrUndefined(user.enterpriseProfile?.title),
          employeeNo: trimOrUndefined(user.enterpriseProfile?.employeeNo),
          workPlace: trimOrUndefined(user.enterpriseProfile?.workPlace),
          manager: managerDisplayName(manager),
          departments: (user.departmentMemberships ?? [])
            .map((membership) => ({
              name: trimOrUndefined(membership.department?.name) ?? "",
              position: trimOrUndefined(membership.position),
              isPrimary: Boolean(membership.isPrimary),
              isLeader: membership.isLeader ?? undefined
            }))
            .filter((department) => Boolean(department.name)),
          mobile: trimOrUndefined(user.enterpriseProfile?.mobile),
          telephone: trimOrUndefined(user.enterpriseProfile?.telephone),
          lastSyncedAt: isoOrUndefined(user.enterpriseProfile?.lastSyncedAt)
        }
      };

      const markdown = truncateBlock(buildMarkdown(snapshot, settings.fields), settings.maxPromptChars);
      const result = {
        enabled: true,
        markdown,
        hash: hashSnapshot(snapshot),
        snapshot
      };
      if (contextCacheKey) {
        this.contextCache.set(contextCacheKey, {
          value: result,
          expiresAt: now + (this.options.contextCacheTtlMs ?? DEFAULT_CONTEXT_CACHE_TTL_MS)
        });
      }
      return result;
    } catch (error) {
      this.options.logger?.warn?.("enterprise context resolution failed", {
        channel: input.channel,
        userId: input.userId,
        agentModeId: input.agentModeId,
        error: error instanceof Error ? error.message : String(error)
      });
      if (settings.failOpen) return { enabled: false, reason: "resolution_failed" };
      throw error;
    }
  }
}
