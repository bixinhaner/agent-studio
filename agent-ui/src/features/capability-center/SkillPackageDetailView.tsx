import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Segmented, Select, Tag } from "antd";

import { fetchNativeCodexSkills, putSkillPackageItems, putSkillPackageRuntimeBindings, updateSkillPackage } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { SkillPackageItemEditor } from "./SkillPackageItemEditor";
import type { NativeCodexSkillRecord, SkillPackageItemInput, SkillPackageRecord, UpdateSkillPackageInput } from "./types";

type SkillPackageDetailViewProps = {
  skillPackage: SkillPackageRecord;
  onSkillPackageUpdated: (skillPackage: SkillPackageRecord) => void;
};

type SkillPackageTab = "basic" | "bindings" | "policies";
type BindingView = "native" | "advanced";

const SKILL_PACKAGE_TABS: Array<{ id: SkillPackageTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" }
];

const VISIBILITY_OPTIONS = [
  { label: "hidden", value: "hidden" },
  { label: "visible", value: "visible" }
];

const BINDING_VIEW_OPTIONS: Array<{ label: string; value: BindingView }> = [
  { label: "Codex 原生 Skills", value: "native" },
  { label: "高级绑定", value: "advanced" }
];

function skillNameFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  const skillName = payload.skillName ?? payload.name;
  return typeof skillName === "string" ? skillName.trim() || undefined : undefined;
}

function skillActivationPromptFromPayload(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const payload = value as Record<string, unknown>;
  const prompt = payload.activationPrompt ?? payload.defaultPrompt ?? payload.prompt;
  return typeof prompt === "string" ? prompt : "";
}

function extractCodexSkillNames(items: SkillPackageItemInput[]): string[] {
  const names: string[] = [];
  for (const item of items) {
    for (const binding of item.runtimeBindings) {
      if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") continue;
      const skillName = skillNameFromPayload(binding.bindingPayload);
      if (skillName && !names.includes(skillName)) names.push(skillName);
    }
  }
  return names;
}

function codexSkillPromptMapFromItems(items: SkillPackageItemInput[]): Map<string, string> {
  const promptMap = new Map<string, string>();
  for (const item of items) {
    for (const binding of item.runtimeBindings) {
      if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") continue;
      const skillName = skillNameFromPayload(binding.bindingPayload);
      if (skillName && !promptMap.has(skillName)) {
        promptMap.set(skillName, skillActivationPromptFromPayload(binding.bindingPayload));
      }
    }
  }
  return promptMap;
}

function withoutCodexSkillItems(items: SkillPackageItemInput[]): SkillPackageItemInput[] {
  return items.filter((item) => !item.runtimeBindings.some((binding) => binding.bindingType === "codex_skill"));
}

function createCodexSkillItem(
  skill: NativeCodexSkillRecord | { name: string; description?: string },
  activationPrompt = ""
): SkillPackageItemInput {
  const prompt = activationPrompt.trim();
  return {
    capabilityKey: `codex-skill:${skill.name}`,
    description: skill.description ?? "",
    runtimeBindings: [
      {
        runtimeType: "codex",
        bindingType: "codex_skill",
        bindingPayload: prompt ? { skillName: skill.name, activationPrompt: prompt } : { skillName: skill.name }
      }
    ]
  };
}

function replaceCodexSkillItems(
  items: SkillPackageItemInput[],
  selectedNames: string[],
  skillMap: Map<string, NativeCodexSkillRecord>,
  promptMap: Map<string, string>
): SkillPackageItemInput[] {
  const baseItems = withoutCodexSkillItems(items);
  const skillItems = selectedNames.map((name) => createCodexSkillItem(skillMap.get(name) ?? { name }, promptMap.get(name) ?? ""));
  return [...baseItems, ...skillItems];
}

function toEditableItems(skillPackage: SkillPackageRecord): SkillPackageItemInput[] {
  return skillPackage.items.map((item) => ({
    capabilityKey: item.capabilityKey,
    description: item.description ?? "",
    runtimeBindings:
      item.runtimeBindings.length > 0
        ? item.runtimeBindings.map((binding) => ({
            runtimeType: binding.runtimeType,
            bindingType: binding.bindingType,
            bindingPayload: binding.bindingPayload
          }))
        : [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: {} }]
  }));
}

export function SkillPackageDetailView({ skillPackage, onSkillPackageUpdated }: SkillPackageDetailViewProps) {
  const [activeTab, setActiveTab] = useState<SkillPackageTab>("basic");
  const [name, setName] = useState(skillPackage.name);
  const [slug, setSlug] = useState(skillPackage.slug);
  const [description, setDescription] = useState(skillPackage.description || "");
  const [status, setStatus] = useState(skillPackage.status);
  const [visibleToUsers, setVisibleToUsers] = useState(skillPackage.visibleToUsers);
  const [items, setItems] = useState<SkillPackageItemInput[]>(() => toEditableItems(skillPackage));
  const [bindingView, setBindingView] = useState<BindingView>("native");
  const [nativeSkills, setNativeSkills] = useState<NativeCodexSkillRecord[]>([]);
  const [nativeSkillSearch, setNativeSkillSearch] = useState("");
  const [nativeSkillLoading, setNativeSkillLoading] = useState(false);
  const [nativeSkillErrorText, setNativeSkillErrorText] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(skillPackage.name);
    setSlug(skillPackage.slug);
    setDescription(skillPackage.description || "");
    setStatus(skillPackage.status);
    setVisibleToUsers(skillPackage.visibleToUsers);
    setItems(toEditableItems(skillPackage));
    setBindingView("native");
    setNativeSkillSearch("");
    setErrorText("");
    setSuccessText("");
  }, [skillPackage]);

  useEffect(() => {
    let active = true;
    async function loadNativeSkills() {
      setNativeSkillLoading(true);
      setNativeSkillErrorText("");
      try {
        const response = await fetchNativeCodexSkills();
        if (!active) return;
        setNativeSkills(response.skills ?? []);
      } catch (error) {
        if (!active) return;
        setNativeSkillErrorText(error instanceof Error ? error.message : "加载 Codex skills 失败");
      } finally {
        if (active) setNativeSkillLoading(false);
      }
    }
    void loadNativeSkills();
    return () => {
      active = false;
    };
  }, []);

  const nativeSkillMap = useMemo(() => new Map(nativeSkills.map((skill) => [skill.name, skill] as const)), [nativeSkills]);
  const selectedCodexSkillNames = useMemo(() => extractCodexSkillNames(items), [items]);
  const selectedCodexSkillSet = useMemo(() => new Set(selectedCodexSkillNames), [selectedCodexSkillNames]);
  const selectedCodexSkillPromptMap = useMemo(() => codexSkillPromptMapFromItems(items), [items]);
  const filteredNativeSkills = useMemo(() => {
    const keyword = nativeSkillSearch.trim().toLowerCase();
    if (!keyword) return nativeSkills;
    return nativeSkills.filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.relativePath}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [nativeSkillSearch, nativeSkills]);
  const missingSelectedSkillNames = useMemo(
    () => selectedCodexSkillNames.filter((name) => !nativeSkillMap.has(name)),
    [nativeSkillMap, selectedCodexSkillNames]
  );

  function setSelectedCodexSkills(nextNames: string[]) {
    setItems((current) => replaceCodexSkillItems(current, nextNames, nativeSkillMap, codexSkillPromptMapFromItems(current)));
  }

  function toggleCodexSkill(skillName: string) {
    const next = selectedCodexSkillSet.has(skillName)
      ? selectedCodexSkillNames.filter((name) => name !== skillName)
      : [...selectedCodexSkillNames, skillName];
    setSelectedCodexSkills(next);
  }

  function updateCodexSkillActivationPrompt(skillName: string, nextPrompt: string) {
    setItems((current) =>
      current.map((item) => ({
        ...item,
        runtimeBindings: item.runtimeBindings.map((binding) => {
          if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") return binding;
          if (skillNameFromPayload(binding.bindingPayload) !== skillName) return binding;
          const payload =
            binding.bindingPayload && typeof binding.bindingPayload === "object" && !Array.isArray(binding.bindingPayload)
              ? { ...(binding.bindingPayload as Record<string, unknown>) }
              : {};
          payload.skillName = skillName;
          const trimmedPrompt = nextPrompt.trim();
          if (trimmedPrompt) {
            payload.activationPrompt = trimmedPrompt;
          } else {
            delete payload.activationPrompt;
          }
          return {
            ...binding,
            bindingPayload: payload
          };
        })
      }))
    );
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");

    const metadataPayload: UpdateSkillPackageInput = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      status,
      visibleToUsers
    };

    try {
      await updateSkillPackage(skillPackage.id, metadataPayload);
      await putSkillPackageItems(skillPackage.id, items);
      const response = await putSkillPackageRuntimeBindings(skillPackage.id, items);
      onSkillPackageUpdated(response.skillPackage);
      setSuccessText("技能包已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存技能包失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{skillPackage.name}</h3>
            <p>维护技能包元数据、结构化能力项和运行绑定。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="技能包详情标签">
          <Segmented
            block
            value={activeTab}
            options={SKILL_PACKAGE_TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as SkillPackageTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <>
            <div className="resource-center-form-grid">
              <label className="field">
                <span className="field-label">技能包名称</span>
                <Input aria-label="技能包名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>

              <label className="field">
                <span className="field-label">技能包 slug</span>
                <Input aria-label="技能包 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">技能包描述</span>
                <Input.TextArea
                  aria-label="技能包描述"
                  value={description}
                  disabled={saving}
                  rows={4}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">技能包状态</span>
                <Select
                  aria-label="技能包状态"
                  value={status}
                  disabled={saving}
                  options={STATUS_OPTIONS}
                  onChange={(value) => setStatus(value)}
                />
              </label>

              <label className="field">
                <span className="field-label">对用户可见</span>
                <Select
                  aria-label="对用户可见"
                  value={visibleToUsers ? "visible" : "hidden"}
                  options={VISIBILITY_OPTIONS}
                  disabled={saving}
                  onChange={(value) => setVisibleToUsers(value === "visible")}
                />
              </label>
            </div>

            <div className="resource-center-actions">
              <Button type="primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存技能包"}
              </Button>
            </div>
          </>
        ) : null}

        {activeTab === "bindings" ? (
          <>
            <div className="capability-binding-shell">
              <div className="capability-binding-header">
                <div>
                  <h4>运行能力</h4>
                  <p>先选择面向智能体开放的 Codex 原生 Skills；需要兼容旧配置时再进入高级绑定。</p>
                </div>
                <Segmented
                  value={bindingView}
                  options={BINDING_VIEW_OPTIONS}
                  onChange={(value) => setBindingView(value as BindingView)}
                />
              </div>

              {bindingView === "native" ? (
                <div className="capability-native-skill-panel">
                  <div className="capability-native-skill-toolbar">
                    <Input.Search
                      allowClear
                      placeholder="搜索 skill 名称、描述或路径"
                      value={nativeSkillSearch}
                      onChange={(event) => setNativeSkillSearch(event.target.value)}
                    />
                    <div className="capability-native-skill-actions">
                      <Button
                        type="default"
                        disabled={saving || filteredNativeSkills.length === 0}
                        onClick={() =>
                          setSelectedCodexSkills(
                            Array.from(new Set([...selectedCodexSkillNames, ...filteredNativeSkills.map((skill) => skill.name)]))
                          )
                        }
                      >
                        选择当前列表
                      </Button>
                      <Button type="default" disabled={saving || selectedCodexSkillNames.length === 0} onClick={() => setSelectedCodexSkills([])}>
                        清空
                      </Button>
                    </div>
                  </div>

                  <div className="capability-native-skill-summary">
                    <span>{nativeSkillLoading ? "正在读取 Codex skill 目录..." : `已选择 ${selectedCodexSkillNames.length} 个 skill`}</span>
                    {selectedCodexSkillNames.length > 0 ? (
                      <div className="capability-native-skill-chip-row">
                        {selectedCodexSkillNames.map((skillName) => (
                          <button
                            key={skillName}
                            type="button"
                            className="capability-native-skill-chip"
                            disabled={saving}
                            onClick={() => toggleCodexSkill(skillName)}
                          >
                            {skillName}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedCodexSkillNames.length > 0 ? (
                    <div className="capability-native-skill-prompts">
                      <div className="capability-native-skill-prompts-header">
                        <div>
                          <h5>默认触发提示词</h5>
                          <p>用户在工作台选择 skill 后，系统会在本次请求中静默携带对应提示词；用户输入区不会显示这段内容。</p>
                        </div>
                      </div>
                      <div className="capability-native-skill-prompt-list">
                        {selectedCodexSkillNames.map((skillName) => (
                          <label key={skillName} className="capability-native-skill-prompt-card">
                            <span className="capability-native-skill-prompt-title">
                              {skillName}
                              {nativeSkillMap.get(skillName)?.system ? <Tag color="blue">system</Tag> : null}
                            </span>
                            <Input.TextArea
                              aria-label={`${skillName} 默认触发提示词`}
                              value={selectedCodexSkillPromptMap.get(skillName) ?? ""}
                              disabled={saving}
                              autoSize={{ minRows: 2, maxRows: 4 }}
                              placeholder="例如：请用 image gen 生成图片"
                              onChange={(event) => updateCodexSkillActivationPrompt(skillName, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {nativeSkillErrorText ? <Alert type="warning" showIcon className="admin-alert-inline" message={nativeSkillErrorText} /> : null}
                  {missingSelectedSkillNames.length > 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      className="admin-alert-inline"
                      message={`以下已绑定 skill 当前未安装：${missingSelectedSkillNames.join("、")}`}
                    />
                  ) : null}

                  <div className="capability-native-skill-list">
                    {filteredNativeSkills.map((skill) => {
                      const selected = selectedCodexSkillSet.has(skill.name);
                      return (
                        <button
                          key={skill.name}
                          type="button"
                          className={`capability-native-skill-row${selected ? " selected" : ""}`}
                          disabled={saving}
                          onClick={() => toggleCodexSkill(skill.name)}
                        >
                          <span className="capability-native-skill-check" aria-hidden="true">
                            {selected ? "✓" : ""}
                          </span>
                          <span className="capability-native-skill-main">
                            <span className="capability-native-skill-title">
                              {skill.name}
                              {skill.system ? <Tag color="blue">system</Tag> : null}
                            </span>
                            <span className="capability-native-skill-description">{skill.description || "无描述"}</span>
                            <span className="capability-native-skill-path">{skill.relativePath}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {!nativeSkillLoading && filteredNativeSkills.length === 0 ? (
                    <p className="resource-center-empty">没有匹配的 Codex 原生 skill。</p>
                  ) : null}
                </div>
              ) : (
                <SkillPackageItemEditor items={items} onChange={setItems} disabled={saving} />
              )}
            </div>

            <div className="resource-center-actions">
              <Button type="primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存技能包"}
              </Button>
            </div>
          </>
        ) : null}

        {activeTab === "policies" ? (
          <CapabilityPolicyEditor resourceType="skill_package" resourceId={skillPackage.id} title="技能包授权" />
        ) : null}
      </Card>
    </div>
  );
}
