import { Button } from "antd";

import type { AgentModeInstructionSourceInput, InstructionSourceType } from "./types";

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

  function emit(next: EditableInstructionSource[]) {
    onChange(toPayload(next));
  }

  function updateSource(index: number, patch: Partial<EditableInstructionSource>) {
    emit(items.map((source, sourceIndex) => (sourceIndex === index ? { ...source, ...patch } : source)));
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
          <article key={`${source.sourceType}-${index}`} className="capability-mode-instruction-card">
            <div className="capability-mode-instruction-card-header">
              <div>
                <h5>{`指令源 ${index + 1}`}</h5>
                <p>{source.sourceType}</p>
              </div>
              <div className="capability-mode-instruction-row-actions">
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
                <select
                  className="field-input"
                  aria-label={`来源类型 ${index + 1}`}
                  disabled={disabled}
                  value={source.sourceType}
                  onChange={(event) => updateSource(index, { sourceType: event.target.value as InstructionSourceType })}
                >
                  <option value="inline_text">inline</option>
                  <option value="workspace_agents_md">workspace_agents_md</option>
                  <option value="knowledge_set_document">knowledge_set_document</option>
                </select>
              </label>

              {source.sourceType === "inline_text" ? (
                <label className="field resource-center-form-span-2">
                  <span className="field-label">{`来源引用 ${index + 1}`}</span>
                  <textarea
                    className="field-input textarea"
                    aria-label={`来源引用 ${index + 1}`}
                    disabled={disabled}
                    value={source.sourceRef}
                    placeholder="直接填写内联指令文本"
                    onChange={(event) => updateSource(index, { sourceRef: event.target.value })}
                  />
                </label>
              ) : source.sourceType === "workspace_agents_md" ? (
                <label className="field resource-center-form-span-2">
                  <span className="field-label">{`来源引用 ${index + 1}`}</span>
                  <input
                    className="field-input"
                    aria-label={`来源引用 ${index + 1}`}
                    disabled={disabled}
                    value={source.sourceRef}
                    placeholder="AGENTS.md 路径（如 /data/agents/AGENTS.md）"
                    onChange={(event) => updateSource(index, { sourceRef: event.target.value })}
                  />
                </label>
              ) : (
                <label className="field resource-center-form-span-2">
                  <span className="field-label">{`来源引用 ${index + 1}`}</span>
                  <input
                    className="field-input"
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
