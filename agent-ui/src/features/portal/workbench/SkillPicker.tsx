import { useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button, Drawer, Input, Modal, Tooltip } from "antd";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Check,
  CircleCheck,
  Copy,
  FileChartColumn,
  FileSpreadsheet,
  FileText,
  FileType2,
  FlaskConical,
  Headphones,
  Image as ImageIcon,
  Package,
  PanelsTopLeft,
  Plus,
  Presentation,
  Radio,
  Search,
  Sparkles,
  SquarePlus,
  Users,
  UserRound,
  WandSparkles,
  X,
  Zap
} from "lucide-react";

import type { RuntimeModeSnapshot } from "../../modes/types";
import { useIsNarrowScreen } from "../../../lib/use-is-narrow-screen";
import { usePortalI18n, type PortalLocale } from "../i18n";

type SkillOption = RuntimeModeSnapshot["availableSkills"][number];
type SkillScope = "private" | "team" | "platform";
type ScopeFilter = "all" | SkillScope | "automatic";
type MobilePickerStep = "list" | "detail";

const ICON_BY_KEY: Record<string, LucideIcon> = {
  image: ImageIcon,
  flask: FlaskConical,
  device: FlaskConical,
  report: FileChartColumn,
  headphones: Headphones,
  support: Headphones,
  "wand-sparkles": WandSparkles,
  "plus-square": SquarePlus,
  bolt: Zap,
  chart: BarChart3,
  "chart-line": BarChart3,
  text: FileText,
  document: FileText,
  pdf: FileType2,
  presentation: Presentation,
  spreadsheet: FileSpreadsheet,
  design: PanelsTopLeft,
  visualize: BarChart3,
  radio: Radio,
  sparkles: Sparkles,
  spark: Sparkles
};

const COPY = {
  zh: {
    title: "选择 Skill",
    search: "搜索 Skill 名称或用途",
    recent: "最近使用",
    all: "全部",
    private: "我的",
    team: "团队",
    platform: "平台",
    automatic: "自动能力",
    automaticAvailable: "自动可用",
    automaticNote: "此能力已由系统自动启用。描述匹配的任务时，系统会按需使用；无需手动选择。",
    copyInvocation: "复制",
    create: "创建 Skill",
    close: "关闭 Skill 选择器",
    emptyTitle: "没有匹配的 Skill",
    emptyBody: "换个关键词或清除范围筛选后重试。",
    suitable: "适合这些情况",
    how: "使用方法",
    examples: "试试这样说",
    data: "数据范围",
    fill: "填入示例",
    enable: "启用 Skill",
    disable: "停用 Skill",
    enabled: "已启用",
    selected: "已为本次对话启用",
    back: "返回 Skill 列表",
    privateLabel: "仅自己可见",
    teamLabel: "团队共享",
    platformLabel: "平台内置",
    fallbackSummary: "使用该 Skill 完成专属任务",
    saveError: "Skill 保存失败，请重试",
    copied: "Skill 原名已复制"
  },
  en: {
    title: "Choose a Skill",
    search: "Search by Skill name or purpose",
    recent: "Recently used",
    all: "All",
    private: "Mine",
    team: "Team",
    platform: "Platform",
    automatic: "Automatic",
    automaticAvailable: "Available automatically",
    automaticNote: "This capability is available automatically. Describe a matching task and the system will use it when needed; no selection is required.",
    copyInvocation: "Copy",
    create: "Create Skill",
    close: "Close Skill picker",
    emptyTitle: "No matching Skills",
    emptyBody: "Try another keyword or clear the scope filter.",
    suitable: "Best for",
    how: "How to use",
    examples: "Try saying",
    data: "Data scope",
    fill: "Use example",
    enable: "Enable Skill",
    disable: "Disable Skill",
    enabled: "Enabled",
    selected: "Enabled for this conversation",
    back: "Back to Skills",
    privateLabel: "Only me",
    teamLabel: "Shared with team",
    platformLabel: "Built into platform",
    fallbackSummary: "Use this Skill for a specialized task",
    saveError: "Could not save the Skill. Try again.",
    copied: "Skill name copied"
  }
} as const;

function currentCopy(locale: PortalLocale) {
  return locale === "zh-CN" ? COPY.zh : COPY.en;
}

function skillScope(skill: SkillOption): SkillScope {
  if (skill.scope === "private") return "private";
  if (skill.scope === "team") return "team";
  return "platform";
}

function isAutomaticSkill(skill: SkillOption): boolean {
  return skill.automatic === true;
}

function scopeLabel(skill: SkillOption, copy: typeof COPY.en | typeof COPY.zh): string {
  const scope = skillScope(skill);
  return scope === "private" ? copy.privateLabel : scope === "team" ? copy.teamLabel : copy.platformLabel;
}

function ScopeIcon({ scope, size = 15 }: { scope: SkillScope; size?: number }) {
  if (scope === "private") return <UserRound size={size} aria-hidden="true" />;
  if (scope === "team") return <Users size={size} aria-hidden="true" />;
  return <Package size={size} aria-hidden="true" />;
}

function SkillGlyph({ skill, size = 20 }: { skill: SkillOption; size?: number }) {
  const Icon = ICON_BY_KEY[skill.presentation.iconKey] ?? Sparkles;
  return (
    <span className="portal-skill-glyph" data-tone={isAutomaticSkill(skill) ? "automatic" : skillScope(skill)} aria-hidden="true">
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}

function skillTitle(skill: SkillOption): string {
  return skill.presentation.displayName || skill.label || skill.name;
}

function skillSummary(skill: SkillOption, copy: typeof COPY.en | typeof COPY.zh): string {
  return skill.presentation.summary || skill.description || copy.fallbackSummary;
}

function skillSearchText(skill: SkillOption): string {
  return [
    skill.name,
    skill.label,
    skill.description,
    skill.presentation.displayName,
    skill.presentation.summary,
    ...skill.presentation.useCases,
    ...skill.presentation.examplePrompts
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

type SkillPickerProps = {
  availableSkills: SkillOption[];
  automaticSkills: SkillOption[];
  enabledSkillIds: string[];
  recentSkillIds: string[];
  onEnabledSkillIdsChange: (ids: string[]) => Promise<void> | void;
  onFillPrompt: (prompt: string) => void;
};

export const PortalSelectedSkillBar: FC<
  Pick<SkillPickerProps, "availableSkills" | "enabledSkillIds" | "onEnabledSkillIdsChange">
> = ({ availableSkills, enabledSkillIds, onEnabledSkillIdsChange }) => {
  const { locale } = usePortalI18n();
  const selected = availableSkills.filter((skill) => enabledSkillIds.includes(skill.id));
  const copy = currentCopy(locale);
  if (selected.length === 0) return null;

  return (
    <div className="portal-selected-skill-bar" aria-label={copy.selected}>
      <div className="portal-selected-skill-list">
        {selected.map((skill) => (
          <Tooltip
            key={skill.id}
            placement="topLeft"
            classNames={{ root: "portal-selected-skill-tooltip" }}
            title={
              <span className="portal-selected-skill-tooltip-content">
                <strong>{skillTitle(skill)}</strong>
                <small>{skillSummary(skill, copy)}</small>
                <em><ScopeIcon scope={skillScope(skill)} />{scopeLabel(skill, copy)}</em>
              </span>
            }
          >
            <span
              className="portal-selected-skill-chip"
              tabIndex={0}
              title={`${skillTitle(skill)}\n${skillSummary(skill, copy)}\n${scopeLabel(skill, copy)}`}
            >
              <code>{skill.name}</code>
              <button
                type="button"
                aria-label={`${copy.disable} ${skill.name}`}
                onClick={() => {
                  void Promise.resolve(onEnabledSkillIdsChange(enabledSkillIds.filter((id) => id !== skill.id))).catch(
                    () => undefined
                  );
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          </Tooltip>
        ))}
      </div>
      <span className="portal-selected-skill-status">
        <CircleCheck size={15} aria-hidden="true" />
        {copy.selected}
      </span>
    </div>
  );
};

export const PortalSkillPicker: FC<SkillPickerProps> = ({
  availableSkills,
  automaticSkills,
  enabledSkillIds,
  recentSkillIds,
  onEnabledSkillIdsChange,
  onFillPrompt
}) => {
  const { locale } = usePortalI18n();
  const copy = currentCopy(locale);
  const isMobile = useIsNarrowScreen(760);
  const [open, setOpen] = useState(false);
  const [mobileStep, setMobileStep] = useState<MobilePickerStep>("list");
  const [focusedSkillId, setFocusedSkillId] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const allSkills = useMemo(() => [...availableSkills, ...automaticSkills], [automaticSkills, availableSkills]);
  const skillById = useMemo(() => new Map(allSkills.map((skill) => [skill.id, skill] as const)), [allSkills]);
  const recentSkills = useMemo(
    () => recentSkillIds.map((id) => skillById.get(id)).filter((skill): skill is SkillOption => Boolean(skill)).slice(0, 5),
    [recentSkillIds, skillById]
  );
  const counts = useMemo(() => ({
    all: allSkills.length,
    private: availableSkills.filter((skill) => skillScope(skill) === "private").length,
    team: availableSkills.filter((skill) => skillScope(skill) === "team").length,
    platform: availableSkills.filter((skill) => skillScope(skill) === "platform").length,
    automatic: automaticSkills.length
  }), [allSkills.length, automaticSkills.length, availableSkills]);
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return allSkills.filter((skill) => {
      if (scope === "automatic" && !isAutomaticSkill(skill)) return false;
      if (scope !== "all" && scope !== "automatic" && (isAutomaticSkill(skill) || skillScope(skill) !== scope)) return false;
      return !normalizedQuery || skillSearchText(skill).includes(normalizedQuery);
    });
  }, [allSkills, query, scope]);
  const focusedSkill =
    filteredSkills.find((skill) => skill.id === focusedSkillId) ??
    filteredSkills[0];

  useEffect(() => {
    if (typeof window === "undefined" || availableSkills.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("openSkill") !== "create_skill") return;
    const createSkill = availableSkills.find((skill) => skill.presentation.shortcutKey === "create_skill");
    if (!createSkill) return;
    setOpen(true);
    setQuery("");
    setScope(skillScope(createSkill));
    setFocusedSkillId(createSkill.id);
    setMobileStep(isMobile ? "detail" : "list");
    params.delete("openSkill");
    const nextSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`);
  }, [availableSkills, isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    panelRef.current?.scrollTo({ top: 0 });
  }, [focusedSkillId, isMobile, mobileStep]);

  const saveSelection = async (nextIds: string[]): Promise<boolean> => {
    setSaving(true);
    setErrorText("");
    try {
      await onEnabledSkillIdsChange(Array.from(new Set(nextIds)));
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : copy.saveError);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const enableSkill = async (skill: SkillOption): Promise<boolean> => {
    if (isAutomaticSkill(skill) || enabledSkillIds.includes(skill.id)) return true;
    return saveSelection([
      ...enabledSkillIds.filter((id) => skillById.get(id)?.name !== skill.name),
      skill.id
    ]);
  };

  const toggleSelection = async (skill: SkillOption) => {
    const isSelected = enabledSkillIds.includes(skill.id);
    const saved = await saveSelection(
      isSelected
        ? enabledSkillIds.filter((id) => id !== skill.id)
        : [...enabledSkillIds.filter((id) => skillById.get(id)?.name !== skill.name), skill.id]
    );
    if (saved && !isSelected) setOpen(false);
  };

  const openPicker = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setQuery("");
    setScope("all");
    setErrorText("");
    setMobileStep("list");
    setFocusedSkillId(recentSkills[0]?.id ?? allSkills[0]?.id ?? "");
  };

  const focusSkill = (skill: SkillOption) => {
    setFocusedSkillId(skill.id);
    if (isMobile) setMobileStep("detail");
  };

  const focusCreateSkill = () => {
    const createSkill = availableSkills.find((skill) => skill.presentation.shortcutKey === "create_skill");
    if (!createSkill) return;
    setQuery("");
    setScope(skillScope(createSkill));
    focusSkill(createSkill);
  };

  const fillExample = async (skill: SkillOption, selectedPrompt?: string) => {
    const prompt = selectedPrompt ?? skill.presentation.examplePrompts[0];
    if (!prompt) return;
    const enabled = await enableSkill(skill);
    if (!enabled) return;
    onFillPrompt(prompt);
    setOpen(false);
  };

  const scopeOptions: Array<{ id: ScopeFilter; label: string }> = [
    { id: "all", label: copy.all },
    { id: "private", label: copy.private },
    { id: "team", label: copy.team },
    { id: "platform", label: copy.platform },
    { id: "automatic", label: copy.automatic }
  ];

  const panel = (
    <div ref={panelRef} className={`portal-skill-picker-panel mobile-${mobileStep}-active`}>
      <section className="portal-skill-catalog-column" aria-label={copy.title}>
        <div className="portal-skill-picker-heading">
          <h3>{copy.title}</h3>
          <Button icon={<Plus size={16} />} onClick={focusCreateSkill}>{copy.create}</Button>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<Search size={17} aria-hidden="true" />}
          placeholder={copy.search}
          aria-label={copy.search}
          allowClear
        />
        {recentSkills.length > 0 ? (
          <div className="portal-skill-recent">
            <h4>{copy.recent}</h4>
            <div className="portal-skill-recent-list">
              {recentSkills.map((skill) => (
                <button key={skill.id} type="button" onClick={() => focusSkill(skill)}>
                  <SkillGlyph skill={skill} size={16} />
                  <span>{skillTitle(skill)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="portal-skill-scope-tabs" aria-label={locale === "zh-CN" ? "Skill 范围" : "Skill scope"}>
          {scopeOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={scope === item.id ? "is-selected" : ""}
              aria-pressed={scope === item.id}
              onClick={() => setScope(item.id)}
            >
              {item.label}<span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="portal-skill-card-grid">
          {filteredSkills.length > 0 ? filteredSkills.map((skill) => {
            const selected = enabledSkillIds.includes(skill.id);
            const focused = focusedSkill?.id === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                className={`portal-skill-card${focused ? " is-focused" : ""}${selected ? " is-enabled" : ""}`}
                onClick={() => focusSkill(skill)}
              >
                <SkillGlyph skill={skill} size={24} />
                <span className="portal-skill-card-copy">
                  <strong>{skillTitle(skill)}</strong>
                  <code>{skill.name}</code>
                  <small>{skillSummary(skill, copy)}</small>
                  <em>
                    {isAutomaticSkill(skill) ? <BadgeCheck size={15} /> : <ScopeIcon scope={skillScope(skill)} />}
                    {isAutomaticSkill(skill) ? copy.automaticAvailable : scopeLabel(skill, copy)}
                  </em>
                </span>
                {!isAutomaticSkill(skill) && selected ? <CircleCheck className="portal-skill-card-check" size={18} aria-label={copy.enabled} /> : null}
              </button>
            );
          }) : (
            <div className="portal-skill-empty">
              <Search size={22} aria-hidden="true" />
              <strong>{copy.emptyTitle}</strong>
              <span>{copy.emptyBody}</span>
            </div>
          )}
        </div>
      </section>
      {focusedSkill ? (
        <SkillDetail
          skill={focusedSkill}
          selected={enabledSkillIds.includes(focusedSkill.id)}
          saving={saving}
          errorText={errorText}
          mobile={isMobile}
          onBack={() => setMobileStep("list")}
          onFill={(prompt) => void fillExample(focusedSkill, prompt)}
          onToggle={isAutomaticSkill(focusedSkill) ? undefined : () => void toggleSelection(focusedSkill)}
        />
      ) : null}
      <button type="button" className="portal-skill-close" aria-label={copy.close} onClick={() => setOpen(false)}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  );

  const trigger = (
    <button
      type="button"
      className={`portal-composer-skill-trigger${enabledSkillIds.length > 0 ? " is-active" : ""}`}
      aria-label={copy.title}
      aria-expanded={open}
      onClick={() => openPicker(true)}
    >
      <Package size={16} aria-hidden="true" />
      <span className="portal-composer-skill-trigger-text">Skills</span>
      {enabledSkillIds.length > 0 ? <span className="portal-skill-count">{enabledSkillIds.length}</span> : null}
    </button>
  );

  return isMobile ? (
    <>
      {trigger}
      <Drawer
        open={open}
        placement="bottom"
        height="min(92dvh, 820px)"
        title={copy.title}
        onClose={() => setOpen(false)}
        rootClassName="portal-skill-mobile-drawer"
        destroyOnClose={false}
      >
        {panel}
      </Drawer>
    </>
  ) : (
    <>
      {trigger}
      <Modal
        open={open}
        centered
        width={1040}
        footer={null}
        closable={false}
        title={copy.title}
        onCancel={() => openPicker(false)}
        rootClassName="portal-skill-desktop-modal"
      >
        {panel}
      </Modal>
    </>
  );
};

function SkillDetail({
  skill,
  selected,
  saving,
  errorText,
  mobile,
  onBack,
  onFill,
  onToggle
}: {
  skill: SkillOption;
  selected: boolean;
  saving: boolean;
  errorText: string;
  mobile: boolean;
  onBack: () => void;
  onFill: (prompt?: string) => void;
  onToggle?: () => void;
}) {
  const { locale } = usePortalI18n();
  const copy = currentCopy(locale);
  return (
    <section className="portal-skill-detail-column" aria-label={`${skillTitle(skill)}${locale === "zh-CN" ? "详情" : " details"}`}>
      <div className="portal-skill-detail-scroll">
        {mobile ? (
          <button type="button" className="portal-skill-mobile-back" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />{copy.back}
          </button>
        ) : null}
        <div className="portal-skill-detail-title">
          <SkillGlyph skill={skill} size={27} />
          <span>
            <strong>{skillTitle(skill)}</strong>
            <code>{skill.name}</code>
          </span>
          <Tooltip title={copy.copied} trigger="click">
            <button type="button" aria-label={locale === "zh-CN" ? "复制 Skill 名称" : "Copy Skill name"} onClick={() => void navigator.clipboard?.writeText(skill.name)}>
              <Copy size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <p className="portal-skill-detail-summary">{skillSummary(skill, copy)}</p>
        <p className={`portal-skill-detail-scope${isAutomaticSkill(skill) ? " is-automatic" : ""}`}>
          {isAutomaticSkill(skill) ? <BadgeCheck size={15} /> : <ScopeIcon scope={skillScope(skill)} />}
          {isAutomaticSkill(skill) ? copy.automaticAvailable : scopeLabel(skill, copy)}
        </p>
        {isAutomaticSkill(skill) ? <p className="portal-skill-automatic-note">{copy.automaticNote}</p> : null}

        {skill.presentation.useCases.length > 0 ? (
          <DetailSection title={copy.suitable}>
            <ul>{skill.presentation.useCases.map((item) => <li key={item}>{item}</li>)}</ul>
          </DetailSection>
        ) : null}
        {skill.presentation.usageSteps.length > 0 ? (
          <DetailSection title={copy.how}>
            <ol>{skill.presentation.usageSteps.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ol>
          </DetailSection>
        ) : null}
        {skill.presentation.examplePrompts.length > 0 ? (
          <DetailSection title={copy.examples}>
            <div className="portal-skill-example-list">
              {skill.presentation.examplePrompts.slice(0, 2).map((prompt) => (
                <button key={prompt} type="button" onClick={() => onFill(prompt)}>
                  <Sparkles size={15} aria-hidden="true" />{prompt}
                </button>
              ))}
            </div>
          </DetailSection>
        ) : null}
        {skill.presentation.dataScope ? (
          <DetailSection title={copy.data}>
            <p>{skill.presentation.dataScope}</p>
          </DetailSection>
        ) : null}
        {errorText ? <p className="portal-skill-error" role="alert">{errorText}</p> : null}
      </div>
      <div className="portal-skill-detail-actions">
        <Button onClick={() => onFill()} disabled={!skill.presentation.examplePrompts.length}>{copy.fill}</Button>
        {onToggle ? (
          <Button type="primary" loading={saving} onClick={onToggle}>
            {selected ? copy.disable : copy.enable}
          </Button>
        ) : (
          <Button icon={<Copy size={15} />} onClick={() => void navigator.clipboard?.writeText(`$${skill.name}`)}>
            {copy.copyInvocation} ${skill.name}
          </Button>
        )}
      </div>
    </section>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <div className="portal-skill-detail-section"><h4>{title}</h4>{children}</div>;
}
