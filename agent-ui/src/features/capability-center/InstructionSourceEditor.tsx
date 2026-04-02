import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "antd";

import { fetchWorkspaceAgentsTemplates } from "./api";
import type { AgentModeInstructionSourceInput, WorkspaceAgentsTemplateRecord } from "./types";
import {
  defaultWorkspaceAgentsMdSourceRef,
  parseWorkspaceAgentsMdSourceRef,
  stringifyWorkspaceAgentsMdSourceRef,
  type WorkspaceAgentsMdSourceRefMode
} from "./workspace-agents-md-source-ref";

type InstructionSourceEditorProps = {
  instructionSources: AgentModeInstructionSourceInput[];
  onChange: (instructionSources: AgentModeInstructionSourceInput[]) => void;
  disabled?: boolean;
};

const WORKSPACE_AGENTS_MD_SOURCE_MODE_OPTIONS: Array<{ label: string; value: WorkspaceAgentsMdSourceRefMode }> = [
  { label: "直接编辑", value: "inline" },
  { label: "选择模板", value: "template" },
  { label: "路径兼容", value: "path" }
];

function normalizeSingleSourceRef(instructionSources: AgentModeInstructionSourceInput[]): string {
  const first = instructionSources[0];
  return first?.sourceRef ?? defaultWorkspaceAgentsMdSourceRef();
}

function toPayload(sourceRef: string): AgentModeInstructionSourceInput[] {
  return [
    {
      sourceType: "workspace_agents_md",
      sourceRef,
      sortOrder: 0
    }
  ];
}

export function InstructionSourceEditor({ instructionSources, onChange, disabled = false }: InstructionSourceEditorProps) {
  const sourceRef = useMemo(() => normalizeSingleSourceRef(instructionSources), [instructionSources]);
  const parsed = useMemo(() => parseWorkspaceAgentsMdSourceRef(sourceRef), [sourceRef]);
  const [workspaceAgentsTemplates, setWorkspaceAgentsTemplates] = useState<WorkspaceAgentsTemplateRecord[]>([]);
  const [workspaceAgentsTemplateLoading, setWorkspaceAgentsTemplateLoading] = useState(false);
  const [workspaceAgentsTemplateErrorText, setWorkspaceAgentsTemplateErrorText] = useState("");

  useEffect(() => {
    let active = true;

    async function loadWorkspaceAgentsTemplates() {
      setWorkspaceAgentsTemplateLoading(true);
      setWorkspaceAgentsTemplateErrorText("");
      try {
        const response = await fetchWorkspaceAgentsTemplates();
        if (!active) return;
        setWorkspaceAgentsTemplates(response.templates);
      } catch (error) {
        if (!active) return;
        setWorkspaceAgentsTemplateErrorText(error instanceof Error ? error.message : "加载 AGENTS 模板失败");
      } finally {
        if (active) {
          setWorkspaceAgentsTemplateLoading(false);
        }
      }
    }

    void loadWorkspaceAgentsTemplates();
    return () => {
      active = false;
    };
  }, []);

  const workspaceAgentsTemplateOptionMap = useMemo(
    () => new Map(workspaceAgentsTemplates.map((item) => [item.id, item] as const)),
    [workspaceAgentsTemplates]
  );
  const workspaceAgentsTemplateOptions = useMemo(
    () =>
      workspaceAgentsTemplates.map((item) => ({
        label: item.label,
        value: item.id
      })),
    [workspaceAgentsTemplates]
  );

  function emitDraft(patch: Partial<ReturnType<typeof parseWorkspaceAgentsMdSourceRef>>) {
    const nextDraft = {
      ...parsed,
      ...patch
    };
    onChange(toPayload(stringifyWorkspaceAgentsMdSourceRef(nextDraft)));
  }

  function workspaceAgentsTemplateOptionsWithCurrent(selectedTemplateId: string) {
    if (!selectedTemplateId) return workspaceAgentsTemplateOptions;
    if (workspaceAgentsTemplateOptionMap.has(selectedTemplateId)) {
      return workspaceAgentsTemplateOptions;
    }
    return [{ label: selectedTemplateId, value: selectedTemplateId }, ...workspaceAgentsTemplateOptions];
  }

  function selectedTemplateForId(templateId: string) {
    return workspaceAgentsTemplateOptionMap.get(templateId);
  }

  function loadTemplateAsEditable(templateId: string) {
    const template = selectedTemplateForId(templateId);
    if (!template) return;
    emitDraft({
      mode: "inline",
      content: template.content
    });
  }

  return (
    <section className="capability-mode-instruction-editor">
      <div className="resource-center-section-header">
        <div>
          <h4>AGENTS.md 规则（workspace_agents_md）</h4>
          <p>这里只支持一条配置，保存后会自动写入会话工作目录的 AGENTS.md。</p>
        </div>
      </div>

      <div className="resource-center-form-grid capability-mode-instruction-grid">
        <label className="field">
          <span className="field-label">配置方式</span>
          <Select
            aria-label="配置方式"
            disabled={disabled}
            value={parsed.mode}
            options={WORKSPACE_AGENTS_MD_SOURCE_MODE_OPTIONS}
            onChange={(value) => {
              const nextMode = value as WorkspaceAgentsMdSourceRefMode;
              emitDraft({
                mode: nextMode,
                templateId: nextMode === "template" ? parsed.templateId || workspaceAgentsTemplates[0]?.id || "" : parsed.templateId
              });
            }}
          />
        </label>

        {parsed.mode === "inline" ? (
          <label className="field resource-center-form-span-2">
            <span className="field-label">规则内容</span>
            <Input.TextArea
              aria-label="规则内容"
              disabled={disabled}
              rows={8}
              value={parsed.content}
              placeholder="直接编辑 AGENTS.md 内容"
              onChange={(event) =>
                emitDraft({
                  content: event.target.value
                })
              }
            />
          </label>
        ) : null}

        {parsed.mode === "template" ? (
          <>
            <label className="field resource-center-form-span-2">
              <span className="field-label">模板</span>
              <Select
                aria-label="模板"
                disabled={disabled}
                loading={workspaceAgentsTemplateLoading}
                value={parsed.templateId || undefined}
                options={workspaceAgentsTemplateOptionsWithCurrent(parsed.templateId)}
                placeholder="请选择 AGENTS 模板"
                showSearch
                optionFilterProp="label"
                onChange={(value) =>
                  emitDraft({
                    templateId: value
                  })
                }
              />
            </label>

            {workspaceAgentsTemplateErrorText ? <p className="err-text">{workspaceAgentsTemplateErrorText}</p> : null}

            <label className="field resource-center-form-span-2">
              <span className="field-label">模板预览</span>
              <Input.TextArea
                aria-label="模板预览"
                disabled
                rows={8}
                value={selectedTemplateForId(parsed.templateId)?.content || ""}
                placeholder="选择模板后显示预览"
              />
            </label>

            <div className="field resource-center-form-span-2">
              <Button
                type="default"
                disabled={disabled || !parsed.templateId || !selectedTemplateForId(parsed.templateId)}
                onClick={() => loadTemplateAsEditable(parsed.templateId)}
              >
                载入模板到可编辑内容
              </Button>
            </div>
          </>
        ) : null}

        {parsed.mode === "path" ? (
          <label className="field resource-center-form-span-2">
            <span className="field-label">AGENTS.md 路径</span>
            <Input
              aria-label="AGENTS.md 路径"
              disabled={disabled}
              value={parsed.path}
              placeholder="AGENTS.md 路径（如 /data/agents/AGENTS.md）"
              onChange={(event) =>
                emitDraft({
                  path: event.target.value
                })
              }
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
