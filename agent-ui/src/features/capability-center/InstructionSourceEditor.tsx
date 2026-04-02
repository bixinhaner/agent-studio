import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "antd";

import { fetchWorkspaceAgentsTemplates } from "./api";
import type { AgentModeInstructionSourceInput, InstructionSourceType } from "./types";
import type { WorkspaceAgentsTemplateRecord } from "./types";
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

type EditableInstructionSource = {
  sourceType: InstructionSourceType;
  sourceRef: string;
};

const DEFAULT_SOURCE: EditableInstructionSource = {
  sourceType: "inline_text",
  sourceRef: ""
};

const SOURCE_TYPE_OPTIONS = [
  { label: "inline", value: "inline_text" },
  { label: "workspace_agents_md", value: "workspace_agents_md" },
  { label: "knowledge_set_document", value: "knowledge_set_document" }
];

const WORKSPACE_AGENTS_MD_SOURCE_MODE_OPTIONS: Array<{ label: string; value: WorkspaceAgentsMdSourceRefMode }> = [
  { label: "直接编辑", value: "inline" },
  { label: "选择模板", value: "template" },
  { label: "路径兼容", value: "path" }
];

function normalizeInstructionSources(instructionSources: AgentModeInstructionSourceInput[]): EditableInstructionSource[] {
  if (instructionSources.length === 0) {
    return [{ ...DEFAULT_SOURCE }];
  }
  return instructionSources.map((source) => ({
    sourceType: source.sourceType,
    sourceRef: source.sourceRef ?? ""
  }));
}

function toPayload(instructionSources: EditableInstructionSource[]): AgentModeInstructionSourceInput[] {
  return instructionSources.map((source, index) => ({
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    sortOrder: index
  }));
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function InstructionSourceEditor({ instructionSources, onChange, disabled = false }: InstructionSourceEditorProps) {
  const items = normalizeInstructionSources(instructionSources);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
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

  function emit(next: EditableInstructionSource[]) {
    onChange(toPayload(next));
  }

  function updateSource(index: number, patch: Partial<EditableInstructionSource>) {
    emit(items.map((source, sourceIndex) => (sourceIndex === index ? { ...source, ...patch } : source)));
  }

  function updateSourceType(index: number, sourceType: InstructionSourceType) {
    emit(
      items.map((source, sourceIndex) => {
        if (sourceIndex !== index) return source;
        if (source.sourceType === sourceType) {
          return source;
        }
        if (sourceType === "workspace_agents_md") {
          return {
            sourceType,
            sourceRef: defaultWorkspaceAgentsMdSourceRef()
          };
        }
        return {
          sourceType,
          sourceRef: source.sourceType === "workspace_agents_md" ? "" : source.sourceRef
        };
      })
    );
  }

  function updateWorkspaceAgentsMdSourceRef(index: number, patch: Partial<ReturnType<typeof parseWorkspaceAgentsMdSourceRef>>) {
    const source = items[index];
    if (!source || source.sourceType !== "workspace_agents_md") return;
    const draft = parseWorkspaceAgentsMdSourceRef(source.sourceRef);
    const nextDraft = {
      ...draft,
      ...patch
    };
    updateSource(index, {
      sourceRef: stringifyWorkspaceAgentsMdSourceRef(nextDraft)
    });
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

  function loadTemplateAsEditable(index: number, templateId: string) {
    const template = selectedTemplateForId(templateId);
    if (!template) return;
    updateWorkspaceAgentsMdSourceRef(index, {
      mode: "inline",
      content: template.content
    });
  }

  function addSource() {
    emit([...items, { ...DEFAULT_SOURCE }]);
  }

  function removeSource(index: number) {
    const next = items.filter((_, sourceIndex) => sourceIndex !== index);
    emit(next);
  }

  function moveSource(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    emit(moveItem(items, index, nextIndex));
  }

  function handleDragStart(index: number) {
    if (disabled) return;
    setDraggingIndex(index);
  }

  function handleDrop(targetIndex: number) {
    if (disabled) return;
    if (draggingIndex == null || draggingIndex === targetIndex) {
      setDraggingIndex(null);
      return;
    }
    emit(moveItem(items, draggingIndex, targetIndex));
    setDraggingIndex(null);
  }

  return (
    <section className="capability-mode-instruction-editor">
      <div className="resource-center-section-header">
        <div>
          <h4>指令源</h4>
          <p>按顺序维护 inline、workspace_agents_md 和 knowledge_set_document 指令源。</p>
        </div>
        <Button type="default" disabled={disabled} onClick={addSource}>
          新增指令源
        </Button>
      </div>

      <div className="capability-mode-instruction-list">
        {items.map((source, index) => (
          <article
            key={`${source.sourceType}-${index}`}
            className={
              draggingIndex === index
                ? "capability-mode-instruction-card capability-mode-instruction-card dragging"
                : "capability-mode-instruction-card"
            }
            draggable={!disabled}
            onDragStart={() => handleDragStart(index)}
            onDragEnd={() => setDraggingIndex(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(index)}
          >
            <div className="capability-mode-instruction-card-header">
              <div>
                <h5>{`指令源 ${index + 1}`}</h5>
                <p>{source.sourceType}</p>
              </div>
              <div className="capability-mode-instruction-row-actions">
                <Button type="text" disabled>
                  拖拽排序
                </Button>
                <Button type="default" disabled={disabled || index === 0} onClick={() => moveSource(index, -1)}>
                  {`上移 ${index + 1}`}
                </Button>
                <Button type="default" disabled={disabled || index === items.length - 1} onClick={() => moveSource(index, 1)}>
                  {`下移 ${index + 1}`}
                </Button>
                <Button type="default" disabled={disabled} onClick={() => removeSource(index)}>
                  {`删除指令源 ${index + 1}`}
                </Button>
              </div>
            </div>

            <div className="resource-center-form-grid capability-mode-instruction-grid">
              <label className="field">
                <span className="field-label">{`来源类型 ${index + 1}`}</span>
                <Select
                  aria-label={`来源类型 ${index + 1}`}
                  disabled={disabled}
                  value={source.sourceType}
                  options={SOURCE_TYPE_OPTIONS}
                  onChange={(value) => updateSourceType(index, value as InstructionSourceType)}
                />
              </label>

              {source.sourceType === "inline_text" ? (
                <label className="field resource-center-form-span-2">
                  <span className="field-label">{`来源引用 ${index + 1}`}</span>
                  <Input.TextArea
                    aria-label={`来源引用 ${index + 1}`}
                    disabled={disabled}
                    rows={4}
                    value={source.sourceRef}
                    placeholder="直接填写内联指令文本"
                    onChange={(event) => updateSource(index, { sourceRef: event.target.value })}
                  />
                </label>
              ) : source.sourceType === "workspace_agents_md" ? (
                <>
                  <label className="field">
                    <span className="field-label">{`配置方式 ${index + 1}`}</span>
                    <Select
                      aria-label={`配置方式 ${index + 1}`}
                      disabled={disabled}
                      value={parseWorkspaceAgentsMdSourceRef(source.sourceRef).mode}
                      options={WORKSPACE_AGENTS_MD_SOURCE_MODE_OPTIONS}
                      onChange={(value) => {
                        const nextMode = value as WorkspaceAgentsMdSourceRefMode;
                        const current = parseWorkspaceAgentsMdSourceRef(source.sourceRef);
                        updateWorkspaceAgentsMdSourceRef(index, {
                          mode: nextMode,
                          templateId:
                            nextMode === "template"
                              ? current.templateId || workspaceAgentsTemplates[0]?.id || ""
                              : current.templateId
                        });
                      }}
                    />
                  </label>

                  {parseWorkspaceAgentsMdSourceRef(source.sourceRef).mode === "inline" ? (
                    <label className="field resource-center-form-span-2">
                      <span className="field-label">{`来源引用 ${index + 1}`}</span>
                      <Input.TextArea
                        aria-label={`来源引用 ${index + 1}`}
                        disabled={disabled}
                        rows={8}
                        value={parseWorkspaceAgentsMdSourceRef(source.sourceRef).content}
                        placeholder="直接编辑 AGENTS.md 内容"
                        onChange={(event) =>
                          updateWorkspaceAgentsMdSourceRef(index, {
                            content: event.target.value
                          })
                        }
                      />
                    </label>
                  ) : null}

                  {parseWorkspaceAgentsMdSourceRef(source.sourceRef).mode === "template" ? (
                    <>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">{`来源引用 ${index + 1}`}</span>
                        <Select
                          aria-label={`来源引用 ${index + 1}`}
                          disabled={disabled}
                          loading={workspaceAgentsTemplateLoading}
                          value={parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId || undefined}
                          options={workspaceAgentsTemplateOptionsWithCurrent(
                            parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId
                          )}
                          placeholder="请选择 AGENTS 模板"
                          showSearch
                          optionFilterProp="label"
                          onChange={(value) =>
                            updateWorkspaceAgentsMdSourceRef(index, {
                              templateId: value
                            })
                          }
                        />
                      </label>

                      {workspaceAgentsTemplateErrorText ? (
                        <p className="err-text">{workspaceAgentsTemplateErrorText}</p>
                      ) : null}

                      <label className="field resource-center-form-span-2">
                        <span className="field-label">{`模板预览 ${index + 1}`}</span>
                        <Input.TextArea
                          aria-label={`模板预览 ${index + 1}`}
                          disabled
                          rows={8}
                          value={selectedTemplateForId(parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId)?.content || ""}
                          placeholder="选择模板后显示预览"
                        />
                      </label>

                      <div className="field resource-center-form-span-2">
                        <Button
                          type="default"
                          disabled={
                            disabled ||
                            !parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId ||
                            !selectedTemplateForId(parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId)
                          }
                          onClick={() =>
                            loadTemplateAsEditable(index, parseWorkspaceAgentsMdSourceRef(source.sourceRef).templateId)
                          }
                        >
                          载入模板到可编辑内容
                        </Button>
                      </div>
                    </>
                  ) : null}

                  {parseWorkspaceAgentsMdSourceRef(source.sourceRef).mode === "path" ? (
                    <label className="field resource-center-form-span-2">
                      <span className="field-label">{`来源引用 ${index + 1}`}</span>
                      <Input
                        aria-label={`来源引用 ${index + 1}`}
                        disabled={disabled}
                        value={parseWorkspaceAgentsMdSourceRef(source.sourceRef).path}
                        placeholder="AGENTS.md 路径（如 /data/agents/AGENTS.md）"
                        onChange={(event) =>
                          updateWorkspaceAgentsMdSourceRef(index, {
                            path: event.target.value
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : (
                <label className="field resource-center-form-span-2">
                  <span className="field-label">{`来源引用 ${index + 1}`}</span>
                  <Input
                    aria-label={`来源引用 ${index + 1}`}
                    disabled={disabled}
                    value={source.sourceRef}
                    placeholder="knowledge-set-id#/path/to/doc.md"
                    onChange={(event) => updateSource(index, { sourceRef: event.target.value })}
                  />
                </label>
              )}
            </div>
          </article>
        ))}
      </div>

      {items.length === 0 ? <p className="resource-center-empty">当前还没有指令源。</p> : null}
    </section>
  );
}
