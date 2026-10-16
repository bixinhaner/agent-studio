import { DEFAULT_MODEL, modelOptionsFromCatalog, normalizeReasoningEffortForModel } from "../../lib/model-config";
import { type PortalRuntimeOptions } from "../modes/types";
import { type AppliedConfig, type RuntimeSkillOption } from "./portal-types";
import { DEFAULT_WORKSPACE } from "./portal-constants";

export function parseDirectories(raw: string): string[] | undefined {
  const items = raw
    .split(/[\n,]/g)
    .map((it) => it.trim())
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : undefined;
}

export function formatDirectories(items: string[]): string {
  const normalized = items.map((it) => it.trim()).filter(Boolean);
  return Array.from(new Set(normalized)).join("\n");
}

export function normalizeKnowledgeSetIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

export function buildCodexRunConfig(
  cfg: AppliedConfig,
  mode: string,
  enabledSkills?: RuntimeSkillOption[]
): Record<string, unknown> {
  const runConfig: Record<string, unknown> = {
    sandboxMode: cfg.sandboxMode,
    approvalPolicy: cfg.approvalPolicy,
    networkAccessEnabled: cfg.networkAccessEnabled,
    webSearchMode: cfg.webSearchMode,
    mode
  };
  if (enabledSkills) {
    runConfig.enabledSkills = enabledSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.managedSkillId ? { managedSkillId: skill.managedSkillId } : {})
    }));
  }

  const additionalDirectories = parseDirectories(cfg.additionalDirectoriesRaw);
  if (additionalDirectories && additionalDirectories.length > 0) {
    runConfig.additionalDirectories = additionalDirectories;
  }

  return runConfig;
}

export function findRuntimeMode(options: PortalRuntimeOptions | null, modeId: string) {
  if (!options) return undefined;
  return options.modes.find((mode) => mode.id === modeId);
}

export function normalizeRuntimeConfig(cfg: AppliedConfig, runtimeOptions?: PortalRuntimeOptions | null): AppliedConfig {
  const model = cfg.model.trim() || DEFAULT_MODEL;
  const workspace = cfg.workspace.trim() || DEFAULT_WORKSPACE;
  const modelOptions = modelOptionsFromCatalog(runtimeOptions?.modelCatalog);
  return {
    ...cfg,
    model,
    reasoningEffort: normalizeReasoningEffortForModel(model, cfg.reasoningEffort, modelOptions),
    workspace
  };
}

export function normalizeProcessTime(value: string | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(at);
}
