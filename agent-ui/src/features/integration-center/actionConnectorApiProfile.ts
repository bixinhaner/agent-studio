// Mirrors agent-api/src/integrations/action-connector/api-profile.ts. A connector
// without a saved profile uses these OMC defaults; the server re-validates on save.
export type ActionConnectorApiProfile = {
  sourceName: string;
  pathPrefix: string;
  catalog: {
    searchPath: string;
    searchOperationId: string;
    categoriesPath: string;
    categoriesOperationId: string;
    describePath: string;
    describeOperationId: string;
  };
  handbook: {
    manifestPath: string;
    manifestOperationId: string;
    chunkPathTemplate: string;
    chunkOperationId: string;
  };
  skillName: string;
};

export const DEFAULT_ACTION_CONNECTOR_API_PROFILE: ActionConnectorApiProfile = {
  sourceName: "xOMC",
  pathPrefix: "/api/v1/",
  catalog: {
    searchPath: "/api/v1/agent/catalog",
    searchOperationId: "get.agent.catalog",
    categoriesPath: "/api/v1/agent/catalog/categories",
    categoriesOperationId: "get.agent.catalog.categories",
    describePath: "/api/v1/agent/catalog/describe",
    describeOperationId: "get.agent.catalog.describe"
  },
  handbook: {
    manifestPath: "/api/v1/agent/handbook/manifest",
    manifestOperationId: "get.agent.handbook.manifest",
    chunkPathTemplate: "/api/v1/agent/handbook/chunks/{index}",
    chunkOperationId: "get.agent.handbook.chunks.by_index"
  },
  skillName: "omc-operations"
};

export type ApiProfileFieldKey =
  | "sourceName"
  | "pathPrefix"
  | "skillName"
  | `catalog.${keyof ActionConnectorApiProfile["catalog"]}`
  | `handbook.${keyof ActionConnectorApiProfile["handbook"]}`;

export type ApiProfileField = { key: ApiProfileFieldKey; label: string; help?: string; kind: "path" | "operationId" | "text" };

export const API_PROFILE_SECTIONS: Array<{ title: string; fields: ApiProfileField[] }> = [
  {
    title: "来源系统",
    fields: [
      { key: "sourceName", label: "系统名称", help: "后台助手提示中对来源系统的称呼", kind: "text" },
      { key: "pathPrefix", label: "API 路径前缀", help: "所有能力、目录、手册与 watch 路径必须以此开头，以 / 结尾", kind: "path" },
      { key: "skillName", label: "Skill 名称", help: "后台助手加载的托管 Skill（含手册加载脚本）", kind: "text" }
    ]
  },
  {
    title: "API 目录",
    fields: [
      { key: "catalog.searchPath", label: "搜索路径", kind: "path" },
      { key: "catalog.searchOperationId", label: "搜索 operationId", kind: "operationId" },
      { key: "catalog.categoriesPath", label: "分类路径", kind: "path" },
      { key: "catalog.categoriesOperationId", label: "分类 operationId", kind: "operationId" },
      { key: "catalog.describePath", label: "详情路径", kind: "path" },
      { key: "catalog.describeOperationId", label: "详情 operationId", kind: "operationId" }
    ]
  },
  {
    title: "API 手册（必选）",
    fields: [
      { key: "handbook.manifestPath", label: "Manifest 路径", kind: "path" },
      { key: "handbook.manifestOperationId", label: "Manifest operationId", kind: "operationId" },
      { key: "handbook.chunkPathTemplate", label: "分片路径模板", help: "必须且只能包含一次 {index}", kind: "path" },
      { key: "handbook.chunkOperationId", label: "分片 operationId", kind: "operationId" }
    ]
  }
];

export function readApiProfileField(profile: ActionConnectorApiProfile, key: ApiProfileFieldKey): string {
  const [group, field] = key.split(".") as [string, string | undefined];
  if (!field) return profile[group as "sourceName" | "pathPrefix" | "skillName"];
  return (profile[group as "catalog" | "handbook"] as Record<string, string>)[field];
}

export function writeApiProfileField(profile: ActionConnectorApiProfile, key: ApiProfileFieldKey, value: string): ActionConnectorApiProfile {
  const [group, field] = key.split(".") as [string, string | undefined];
  if (!field) return { ...profile, [group]: value };
  const section = group as "catalog" | "handbook";
  return { ...profile, [section]: { ...profile[section], [field]: value } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pick<T extends Record<string, string>>(defaults: T, raw: unknown): T {
  const source = asRecord(raw);
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = source[key as string];
    if (typeof value === "string") out[key] = value as T[keyof T];
  }
  return out;
}

export function parseApiProfile(raw: unknown): ActionConnectorApiProfile {
  const source = asRecord(raw);
  const { catalog, handbook, ...top } = DEFAULT_ACTION_CONNECTOR_API_PROFILE;
  return {
    ...pick(top, source),
    catalog: pick(catalog, source.catalog),
    handbook: pick(handbook, source.handbook)
  };
}

export function trimApiProfile(profile: ActionConnectorApiProfile): ActionConnectorApiProfile {
  let next = profile;
  for (const section of API_PROFILE_SECTIONS) {
    for (const field of section.fields) next = writeApiProfileField(next, field.key, readApiProfileField(next, field.key).trim());
  }
  return next;
}

export function sameApiProfile(left: ActionConnectorApiProfile, right: ActionConnectorApiProfile): boolean {
  return API_PROFILE_SECTIONS.every((section) =>
    section.fields.every((field) => readApiProfileField(left, field.key) === readApiProfileField(right, field.key))
  );
}

// Client-side checks match the server schema so errors show next to the field.
export function validateApiProfile(profile: ActionConnectorApiProfile): Partial<Record<ApiProfileFieldKey, string>> {
  const errors: Partial<Record<ApiProfileFieldKey, string>> = {};
  const prefix = profile.pathPrefix;
  const ids = new Map<string, ApiProfileFieldKey>();
  for (const section of API_PROFILE_SECTIONS) {
    for (const field of section.fields) {
      const value = readApiProfileField(profile, field.key);
      if (!value) {
        errors[field.key] = "必填";
      } else if (field.kind === "path" && !/^\/[A-Za-z0-9._~\-/{}]*$/.test(value)) {
        errors[field.key] = "必须是以 / 开头的 API 路径";
      } else if (field.kind === "operationId" && !/^[A-Za-z0-9._:-]+$/.test(value)) {
        errors[field.key] = "只能包含字母、数字和 . _ : -";
      } else if (field.kind === "operationId" && ids.has(value)) {
        errors[field.key] = "与其他 operationId 重复";
      } else if (field.kind === "operationId") {
        ids.set(value, field.key);
      }
    }
  }
  if (!errors.pathPrefix && !prefix.endsWith("/")) errors.pathPrefix = "必须以 / 结尾";
  if (!errors.skillName && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.skillName)) errors.skillName = "只能包含小写字母、数字和 -";
  for (const section of API_PROFILE_SECTIONS) {
    for (const field of section.fields) {
      if (field.kind !== "path" || field.key === "pathPrefix" || errors[field.key]) continue;
      if (!readApiProfileField(profile, field.key).startsWith(prefix)) errors[field.key] = `必须以 ${prefix} 开头`;
    }
  }
  if (!errors["handbook.chunkPathTemplate"] && profile.handbook.chunkPathTemplate.split("{index}").length !== 2) {
    errors["handbook.chunkPathTemplate"] = "必须且只能包含一次 {index}";
  }
  return errors;
}
