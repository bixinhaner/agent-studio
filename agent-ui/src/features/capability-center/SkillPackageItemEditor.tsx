import type { SkillPackageItemInput, SkillPackageRuntimeBindingInput } from "./types";

type SkillPackageItemEditorProps = {
  items: SkillPackageItemInput[];
  onChange: (items: SkillPackageItemInput[]) => void;
  disabled?: boolean;
};

const DEFAULT_BINDING: SkillPackageRuntimeBindingInput = {
  runtimeType: "codex",
  bindingType: "config_fragment",
  bindingPayload: {}
};

function cloneBinding(binding: SkillPackageRuntimeBindingInput | undefined): SkillPackageRuntimeBindingInput {
  return {
    runtimeType: binding?.runtimeType ?? DEFAULT_BINDING.runtimeType,
    bindingType: binding?.bindingType ?? DEFAULT_BINDING.bindingType,
    bindingPayload: binding?.bindingPayload ?? DEFAULT_BINDING.bindingPayload
  };
}

function stringifyBindingPayload(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function parseBindingPayload(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function updateFirstBinding(
  item: SkillPackageItemInput,
  patch: Partial<SkillPackageRuntimeBindingInput>
): SkillPackageItemInput {
  const [firstBinding, ...restBindings] = item.runtimeBindings;
  return {
    ...item,
    runtimeBindings: [{ ...cloneBinding(firstBinding), ...patch }, ...restBindings]
  };
}

function createEmptyItem(): SkillPackageItemInput {
  return {
    capabilityKey: "",
    description: "",
    runtimeBindings: [{ ...DEFAULT_BINDING }]
  };
}

export function SkillPackageItemEditor({ items, onChange, disabled = false }: SkillPackageItemEditorProps) {
  function patchItem(index: number, patch: Partial<SkillPackageItemInput>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function patchBinding(index: number, patch: Partial<SkillPackageRuntimeBindingInput>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? updateFirstBinding(item, patch) : item)));
  }

  return (
    <div className="capability-skill-package-editor">
      <div className="resource-center-section-header">
        <div>
          <h4>能力项与运行绑定</h4>
          <p>按能力项维护 capability_key、描述、运行时和绑定内容。</p>
        </div>
        <button type="button" className="admin-secondary-btn" disabled={disabled} onClick={() => onChange([...items, createEmptyItem()])}>
          新增能力项
        </button>
      </div>

      <div className="capability-skill-package-table-wrap">
        <table className="capability-skill-package-table">
          <thead>
            <tr>
              <th scope="col">capability_key</th>
              <th scope="col">description</th>
              <th scope="col">runtime</th>
              <th scope="col">binding_type</th>
              <th scope="col">binding</th>
              <th scope="col" aria-label="操作列" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const binding = cloneBinding(item.runtimeBindings[0]);
              return (
                <tr key={`${item.capabilityKey || "item"}-${index}`}>
                  <td>
                    <input
                      className="field-input"
                      aria-label={`capability_key ${index + 1}`}
                      disabled={disabled}
                      value={item.capabilityKey}
                      onChange={(event) => patchItem(index, { capabilityKey: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="field-input"
                      aria-label={`description ${index + 1}`}
                      disabled={disabled}
                      value={item.description ?? ""}
                      onChange={(event) => patchItem(index, { description: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="field-input"
                      aria-label={`runtime ${index + 1}`}
                      disabled={disabled}
                      value={binding.runtimeType}
                      onChange={(event) =>
                        patchBinding(index, { runtimeType: event.target.value as SkillPackageRuntimeBindingInput["runtimeType"] })
                      }
                    >
                      <option value="codex">codex</option>
                      <option value="claude_code">claude_code</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="field-input"
                      aria-label={`binding_type ${index + 1}`}
                      disabled={disabled}
                      value={binding.bindingType}
                      onChange={(event) =>
                        patchBinding(index, { bindingType: event.target.value as SkillPackageRuntimeBindingInput["bindingType"] })
                      }
                    >
                      <option value="config_fragment">config_fragment</option>
                      <option value="prompt_hint">prompt_hint</option>
                    </select>
                  </td>
                  <td>
                    <textarea
                      className="field-input textarea capability-skill-package-binding"
                      aria-label={`binding ${index + 1}`}
                      disabled={disabled}
                      value={stringifyBindingPayload(binding.bindingPayload)}
                      onChange={(event) => patchBinding(index, { bindingPayload: parseBindingPayload(event.target.value) })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-secondary-btn"
                      disabled={disabled}
                      onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      {`删除能力项 ${index + 1}`}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {items.length === 0 ? <p className="resource-center-empty">当前技能包还没有能力项。</p> : null}
    </div>
  );
}
