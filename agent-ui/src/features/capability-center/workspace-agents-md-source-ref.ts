export type WorkspaceAgentsMdSourceRefMode = "inline" | "template" | "path";

export type WorkspaceAgentsMdSourceRefDraft = {
  mode: WorkspaceAgentsMdSourceRefMode;
  content: string;
  templateId: string;
  path: string;
};

type EncodedWorkspaceAgentsMdSourceRef =
  | { version: 1; kind: "inline"; content: string }
  | { version: 1; kind: "template"; templateId: string }
  | { version: 1; kind: "path"; path: string };

const DEFAULT_WORKSPACE_AGENTS_MD_SOURCE_REF: WorkspaceAgentsMdSourceRefDraft = {
  mode: "inline",
  content: "",
  templateId: "",
  path: ""
};

export function parseWorkspaceAgentsMdSourceRef(raw: string): WorkspaceAgentsMdSourceRefDraft {
  const normalized = raw.trim();
  if (!normalized) {
    return { ...DEFAULT_WORKSPACE_AGENTS_MD_SOURCE_REF };
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {
        mode: "path",
        content: "",
        templateId: "",
        path: raw
      };
    }
    const payload = parsed as Record<string, unknown>;
    if (payload.version !== 1) {
      return {
        mode: "path",
        content: "",
        templateId: "",
        path: raw
      };
    }
    if (payload.kind === "inline") {
      return {
        mode: "inline",
        content: typeof payload.content === "string" ? payload.content : "",
        templateId: "",
        path: ""
      };
    }
    if (payload.kind === "template") {
      return {
        mode: "template",
        content: "",
        templateId: typeof payload.templateId === "string" ? payload.templateId : "",
        path: ""
      };
    }
    if (payload.kind === "path") {
      return {
        mode: "path",
        content: "",
        templateId: "",
        path: typeof payload.path === "string" ? payload.path : ""
      };
    }
  } catch {
    return {
      mode: "path",
      content: "",
      templateId: "",
      path: raw
    };
  }

  return {
    mode: "path",
    content: "",
    templateId: "",
    path: raw
  };
}

export function stringifyWorkspaceAgentsMdSourceRef(draft: WorkspaceAgentsMdSourceRefDraft): string {
  if (draft.mode === "inline") {
    const payload: EncodedWorkspaceAgentsMdSourceRef = {
      version: 1,
      kind: "inline",
      content: draft.content
    };
    return JSON.stringify(payload);
  }

  if (draft.mode === "template") {
    const payload: EncodedWorkspaceAgentsMdSourceRef = {
      version: 1,
      kind: "template",
      templateId: draft.templateId.trim()
    };
    return JSON.stringify(payload);
  }

  return draft.path.trim();
}

export function defaultWorkspaceAgentsMdSourceRef(): string {
  return stringifyWorkspaceAgentsMdSourceRef(DEFAULT_WORKSPACE_AGENTS_MD_SOURCE_REF);
}
