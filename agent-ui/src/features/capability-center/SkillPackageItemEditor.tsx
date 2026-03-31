import { Button } from "antd";

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

function normalizeBindings(bindings: SkillPackageRuntimeBindingInput[]) {
  return bindings.length > 0 ? bindings.map((binding) => cloneBinding(binding)) : [{ ...DEFAULT_BINDING }];
}

function updateBinding(
  item: SkillPackageItemInput,
  bindingIndex: number,
  patch: Partial<SkillPackageRuntimeBindingInput>
): SkillPackageItemInput {
  const bindings = normalizeBindings(item.runtimeBindings);
  return {
    ...item,
    runtimeBindings: bindings.map((binding, index) => (index === bindingIndex ? { ...binding, ...patch } : binding))
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

  function patchBinding(index: number, bindingIndex: number, patch: Partial<SkillPackageRuntimeBindingInput>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? updateBinding(item, bindingIndex, patch) : item)));
  }

  function addBinding(index: number) {
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, runtimeBindings: [...normalizeBindings(item.runtimeBindings), { ...DEFAULT_BINDING }] } : item
      )
    );
  }

  function removeBinding(index: number, bindingIndex: number) {
    onChange(
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const remainingBindings = normalizeBindings(item.runtimeBindings).filter((_, indexToKeep) => indexToKeep !== bindingIndex);
        return {
          ...item,
          runtimeBindings: remainingBindings
        };
      })
    );
  }

  function bindingLabel(base: string, itemIndex: number, bindingIndex: number) {
    return `${base} ${itemIndex + 1}${bindingIndex === 0 ? "" : `-${bindingIndex + 1}`}`;
  }

  return (
    <div className="capability-skill-package-editor">
      <div className="resource-center-section-header">
        <div>
          <h4>能力项与运行绑定</h4>
          <p>按能力项维护 capability_key、描述、运行时和绑定内容。</p>
        </div>
        <Button type="default" disabled={disabled} onClick={() => onChange([...items, createEmptyItem()])}>
          新增能力项
        </Button>
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
              const bindings = normalizeBindings(item.runtimeBindings);
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
                    <div className="capability-skill-package-binding-list">
                      {bindings.map((binding, bindingIndex) => (
                        <div
                          key={`${item.capabilityKey || "item"}-runtime-${bindingIndex}`}
                          className="capability-skill-package-binding-card"
                        >
                          <select
                            className="field-input"
                            aria-label={bindingLabel("runtime", index, bindingIndex)}
                            disabled={disabled}
                            value={binding.runtimeType}
                            onChange={(event) =>
                              patchBinding(index, bindingIndex, {
                                runtimeType: event.target.value as SkillPackageRuntimeBindingInput["runtimeType"]
                              })
                            }
                          >
                            <option value="codex">codex</option>
                            <option value="claude_code">claude_code</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="capability-skill-package-binding-list">
                      {bindings.map((binding, bindingIndex) => (
                        <div
                          key={`${item.capabilityKey || "item"}-binding-type-${bindingIndex}`}
                          className="capability-skill-package-binding-card"
                        >
                          <select
                            className="field-input"
                            aria-label={bindingLabel("binding_type", index, bindingIndex)}
                            disabled={disabled}
                            value={binding.bindingType}
                            onChange={(event) =>
                              patchBinding(index, bindingIndex, {
                                bindingType: event.target.value as SkillPackageRuntimeBindingInput["bindingType"]
                              })
                            }
                          >
                            <option value="config_fragment">config_fragment</option>
                            <option value="prompt_hint">prompt_hint</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="capability-skill-package-binding-list">
                      {bindings.map((binding, bindingIndex) => (
                        <div key={`${item.capabilityKey || "item"}-binding-${bindingIndex}`} className="capability-skill-package-binding-card">
                          <textarea
                            className="field-input textarea capability-skill-package-binding"
                            aria-label={bindingLabel("binding", index, bindingIndex)}
                            disabled={disabled}
                            value={stringifyBindingPayload(binding.bindingPayload)}
                            onChange={(event) => patchBinding(index, bindingIndex, { bindingPayload: parseBindingPayload(event.target.value) })}
                          />
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="capability-skill-package-row-actions">
                      <Button type="default" disabled={disabled} onClick={() => addBinding(index)}>
                        {`新增运行绑定 ${index + 1}`}
                      </Button>
                      {bindings.map((_, bindingIndex) => (
                        <Button
                          key={`${item.capabilityKey || "item"}-remove-binding-${bindingIndex}`}
                          type="default"
                          disabled={disabled}
                          onClick={() => removeBinding(index, bindingIndex)}
                        >
                          {`删除运行绑定 ${index + 1}${bindingIndex === 0 ? "" : `-${bindingIndex + 1}`}`}
                        </Button>
                      ))}
                      <Button type="default" disabled={disabled} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
                        {`删除能力项 ${index + 1}`}
                      </Button>
                    </div>
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
