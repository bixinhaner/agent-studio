import { Button, Input, Select, Space, Typography } from "antd";

import { openWarningConfirm } from "../../lib/warning-modal";
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

const RUNTIME_TYPE_OPTIONS = [
  { label: "codex", value: "codex" },
  { label: "claude_code", value: "claude_code" }
];

const BINDING_TYPE_OPTIONS = [
  { label: "config_fragment", value: "config_fragment" },
  { label: "prompt_hint", value: "prompt_hint" },
  { label: "codex_skill", value: "codex_skill" }
];

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
    onChange(
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const bindings = normalizeBindings(item.runtimeBindings).map((binding, currentIndex) =>
          currentIndex === bindingIndex ? { ...binding, ...patch } : binding
        );
        return { ...item, runtimeBindings: bindings };
      })
    );
  }

  function addBinding(index: number) {
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, runtimeBindings: [...normalizeBindings(item.runtimeBindings), { ...DEFAULT_BINDING }] }
          : item
      )
    );
  }

  async function removeBinding(index: number, bindingIndex: number) {
    const confirmed = await openWarningConfirm({
      title: "确认删除运行绑定",
      content: `确认删除第 ${index + 1} 个能力项的第 ${bindingIndex + 1} 个运行绑定吗？`,
      dangerLevel: "warning",
      okText: "删除",
      cancelText: "取消",
      okButtonDanger: false
    });
    if (!confirmed) return;
    onChange(
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const remainingBindings = normalizeBindings(item.runtimeBindings).filter(
          (_, indexToKeep) => indexToKeep !== bindingIndex
        );
        return {
          ...item,
          runtimeBindings: remainingBindings
        };
      })
    );
  }

  async function removeItem(index: number) {
    const target = items[index];
    const label = target?.capabilityKey?.trim() || `能力项 ${index + 1}`;
    const confirmed = await openWarningConfirm({
      title: "确认删除能力项",
      content: `确认删除 ${label} 吗？`,
      description: "删除后该能力项下的所有运行绑定也会被移除。",
      dangerLevel: "danger",
      okText: "删除",
      cancelText: "取消"
    });
    if (!confirmed) return;
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
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

      <div className="capability-skill-package-card-list">
        {items.map((item, index) => {
          const bindings = normalizeBindings(item.runtimeBindings);
          return (
            <article key={`${item.capabilityKey || "item"}-${index}`} className="capability-skill-package-item-card">
              <div className="capability-skill-package-item-header">
                <div>
                  <Typography.Text strong>{`能力项 ${index + 1}`}</Typography.Text>
                  <Typography.Paragraph type="secondary" className="resource-center-inline-muted">
                    配置 capability_key 与运行绑定
                  </Typography.Paragraph>
                </div>
                <Button type="default" danger disabled={disabled} onClick={() => void removeItem(index)}>
                  删除能力项
                </Button>
              </div>

              <div className="resource-center-form-grid">
                <label className="field">
                  <span className="field-label">capability_key</span>
                  <Input
                    aria-label={`capability_key ${index + 1}`}
                    disabled={disabled}
                    value={item.capabilityKey}
                    onChange={(event) => patchItem(index, { capabilityKey: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">description</span>
                  <Input
                    aria-label={`description ${index + 1}`}
                    disabled={disabled}
                    value={item.description ?? ""}
                    onChange={(event) => patchItem(index, { description: event.target.value })}
                  />
                </label>
              </div>

              <div className="capability-skill-package-binding-list">
                {bindings.map((binding, bindingIndex) => (
                  <div
                    key={`${item.capabilityKey || "item"}-binding-${bindingIndex}`}
                    className="capability-skill-package-binding-card"
                  >
                    <div className="capability-skill-package-binding-header">
                      <Typography.Text>{`运行绑定 ${index + 1}-${bindingIndex + 1}`}</Typography.Text>
                      <Button
                        type="text"
                        danger
                        disabled={disabled}
                        onClick={() => void removeBinding(index, bindingIndex)}
                      >
                        删除绑定
                      </Button>
                    </div>

                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">runtime</span>
                        <Select
                          aria-label={`runtime ${index + 1}-${bindingIndex + 1}`}
                          disabled={disabled}
                          value={binding.runtimeType}
                          options={RUNTIME_TYPE_OPTIONS}
                          onChange={(value) =>
                            patchBinding(index, bindingIndex, {
                              runtimeType: value as SkillPackageRuntimeBindingInput["runtimeType"]
                            })
                          }
                        />
                      </label>

                      <label className="field">
                        <span className="field-label">binding_type</span>
                        <Select
                          aria-label={`binding_type ${index + 1}-${bindingIndex + 1}`}
                          disabled={disabled}
                          value={binding.bindingType}
                          options={BINDING_TYPE_OPTIONS}
                          onChange={(value) =>
                            patchBinding(index, bindingIndex, {
                              bindingType: value as SkillPackageRuntimeBindingInput["bindingType"]
                            })
                          }
                        />
                      </label>

                      <label className="field resource-center-form-span-2">
                        <span className="field-label">binding_payload</span>
                        <Input.TextArea
                          className="capability-skill-package-binding"
                          aria-label={`binding_payload ${index + 1}-${bindingIndex + 1}`}
                          disabled={disabled}
                          rows={4}
                          value={stringifyBindingPayload(binding.bindingPayload)}
                          onChange={(event) =>
                            patchBinding(index, bindingIndex, { bindingPayload: parseBindingPayload(event.target.value) })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <Space>
                <Button type="default" disabled={disabled} onClick={() => addBinding(index)}>
                  新增运行绑定
                </Button>
              </Space>
            </article>
          );
        })}
      </div>

      {items.length === 0 ? <p className="resource-center-empty">当前技能包还没有能力项。</p> : null}
    </div>
  );
}
