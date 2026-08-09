import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Modal, Select, Spin, Switch } from "antd";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  FileChartColumn,
  FileSpreadsheet,
  FileText,
  FileType2,
  FlaskConical,
  Headphones,
  Image as ImageIcon,
  Languages,
  MoreVertical,
  Package,
  PanelsTopLeft,
  Plus,
  Presentation,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  WandSparkles,
  Zap
} from "lucide-react";

import {
  fetchSkillCatalog,
  publishSkillCatalogDraft,
  saveSkillCatalogDraft,
  type SkillCatalogDraft,
  type SkillCatalogEntry,
  type SkillCatalogActor,
  type SkillCatalogLocalizedContent
} from "./skill-catalog-api";
import "./skill-catalog-management.css";

const ICON_BY_KEY: Record<string, LucideIcon> = {
  image: ImageIcon,
  flask: FlaskConical,
  report: FileChartColumn,
  headphones: Headphones,
  "wand-sparkles": WandSparkles,
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
  sparkles: Sparkles
};

const EMPTY_LOCALE: SkillCatalogLocalizedContent = {
  displayName: "",
  summary: "",
  useCases: [],
  usageSteps: [],
  examplePrompts: [],
  dataScope: ""
};

function scopeLabel(scope: SkillCatalogEntry["scope"]): string {
  if (scope === "private") return "用户私有";
  if (scope === "agent_mode") return "智能体专属";
  if (scope === "team") return "团队共享";
  if (scope === "org") return "组织共享";
  if (scope === "platform") return "平台内置";
  return "未知范围";
}

function entryScopeLabel(entry: SkillCatalogEntry): string {
  return entry.sourceType === "plugin" ? "自动能力" : scopeLabel(entry.scope);
}

function ScopeIcon({ scope }: { scope: SkillCatalogEntry["scope"] }) {
  if (scope === "private") return <UserRound size={15} aria-hidden="true" />;
  if (scope === "agent_mode") return <Bot size={15} aria-hidden="true" />;
  if (scope === "team") return <Users size={15} aria-hidden="true" />;
  if (scope === "org") return <Building2 size={15} aria-hidden="true" />;
  return <Package size={15} aria-hidden="true" />;
}

function actorName(actor?: SkillCatalogActor): string {
  return actor?.displayName || actor?.email || actor?.userId || "未记录";
}

function actorSecondary(actor?: SkillCatalogActor): string | undefined {
  if (!actor) return undefined;
  if (actor.displayName && actor.email) return actor.email;
  if ((actor.displayName || actor.email) && actor.userId) return actor.userId;
  return undefined;
}

function attribution(entry: SkillCatalogEntry): { title: string; secondary?: string; icon: ReactNode } {
  if (entry.scope === "private") {
    return { title: actorName(entry.owner), secondary: actorSecondary(entry.owner), icon: <UserRound size={15} /> };
  }
  if (entry.scope === "agent_mode") {
    const first = entry.audiences[0];
    const remaining = Math.max(0, entry.audiences.length - 1);
    return {
      title: first?.name || "未绑定智能体",
      secondary: first ? `${first.secondaryLabel || "智能体"}${remaining ? ` · 另 ${remaining} 个` : ""}` : "需要检查 Skill Package 绑定",
      icon: <Bot size={15} />
    };
  }
  if (entry.scope === "team" || entry.scope === "org") {
    const audience = entry.audiences[0];
    return {
      title: audience?.name || entry.organization?.name || (entry.scope === "team" ? "当前团队" : "当前组织"),
      secondary: audience?.secondaryLabel || entry.organization?.id,
      icon: entry.scope === "team" ? <Users size={15} /> : <Building2 size={15} />
    };
  }
  return {
    title: entry.sourceType === "plugin" ? "系统自动能力" : "平台",
    secondary: entry.sourceLabel,
    icon: entry.sourceType === "plugin" ? <BadgeCheck size={15} /> : <Package size={15} />
  };
}

function visibilityText(entry: SkillCatalogEntry): string {
  if (entry.scope === "private") return entry.owner ? `仅 ${actorName(entry.owner)}` : "仅所有者";
  if (entry.scope === "agent_mode") return entry.audiences.length
    ? entry.audiences.map((item) => item.name).join("、")
    : "尚未检测到智能体绑定";
  if (entry.scope === "team") return entry.audiences[0]?.name || "当前团队";
  if (entry.scope === "org") return entry.audiences[0]?.name || entry.organization?.name || "当前组织";
  return "所有可访问 Portal 的用户";
}

function IconGlyph({ iconKey, size = 20 }: { iconKey: string; size?: number }) {
  const Icon = ICON_BY_KEY[iconKey] ?? Sparkles;
  return <span className="skill-admin-glyph"><Icon size={size} strokeWidth={1.9} /></span>;
}

function displayContent(entry: SkillCatalogEntry, locale = entry.defaultLocale): SkillCatalogLocalizedContent {
  return entry.translations[locale] ?? entry.translations[entry.defaultLocale] ?? EMPTY_LOCALE;
}

function draftFromEntry(entry: SkillCatalogEntry): SkillCatalogDraft {
  if (entry.draft) {
    return {
      baseConfig: { ...entry.draft.baseConfig },
      translations: Object.fromEntries(
        Object.entries(entry.draft.translations).map(([locale, content]) => [locale, { ...content }])
      )
    };
  }
  return {
    baseConfig: {
      defaultLocale: entry.defaultLocale,
      iconKey: entry.iconKey,
      sortOrder: entry.sortOrder,
      shortcutKey: entry.shortcutKey,
      status: entry.status === "disabled" ? "disabled" : "active"
    },
    translations: Object.fromEntries(
      Object.entries(entry.translations).map(([locale, content]) => [locale, { ...content }])
    )
  };
}

function localDate(value?: string): string {
  if (!value) return "尚未发布";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function localDateShort(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

type ScopeFilter = "all" | "private" | "shared" | "platform" | "plugin";

export function SkillCatalogManagementView() {
  const [entries, setEntries] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [language, setLanguage] = useState<"all" | "complete" | "missing">("all");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchSkillCatalog();
      setEntries(result.entries);
      setSelectedId((current) => current || result.entries[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Skill 目录加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      const content = displayContent(entry);
      if (scope === "plugin" && entry.sourceType !== "plugin") return false;
      if (scope === "private" && (entry.sourceType === "plugin" || entry.scope !== "private")) return false;
      if (scope === "shared" && (entry.sourceType === "plugin" || !["agent_mode", "team", "org"].includes(entry.scope))) return false;
      if (scope === "platform" && (entry.sourceType === "plugin" || entry.scope !== "platform")) return false;
      if (language === "complete" && entry.languageStatus.configured !== entry.languageStatus.total) return false;
      if (language === "missing" && entry.languageStatus.configured === entry.languageStatus.total) return false;
      if (status === "published" && !entry.publishedAt) return false;
      if (status === "draft" && !entry.draft) return false;
      const searchable = [
        entry.canonicalName,
        content.displayName,
        content.summary,
        entry.owner?.displayName,
        entry.owner?.email,
        entry.createdBy?.displayName,
        entry.createdBy?.email,
        ...entry.audiences.flatMap((audience) => [audience.name, audience.secondaryLabel])
      ];
      return !normalized || searchable.filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
    });
  }, [entries, language, query, scope, status]);
  const selected = filtered.find((entry) => entry.id === selectedId) ?? filtered[0];
  const editing = entries.find((entry) => entry.id === editingId);

  if (editing) {
    return (
      <SkillCatalogEditor
        entry={editing}
        onBack={() => setEditingId("")}
        onUpdated={(updated) => {
          setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
          setSelectedId(updated.id);
        }}
      />
    );
  }

  return (
    <div className="admin-page-container skill-admin-page">
      <header className="skill-admin-page-header">
        <div>
          <h1 className="admin-page-title">Skill 管理</h1>
          <p className="admin-page-desc">配置 Skill 在 Portal 中的名称、释义、示例与多语言内容。</p>
        </div>
        <div className="skill-admin-header-actions">
          <Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void load()}>同步能力目录</Button>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => window.location.assign("/?openSkill=create_skill")}>新建托管 Skill</Button>
        </div>
      </header>

      {error ? <div className="skill-admin-error" role="alert">{error}</div> : null}
      <div className="skill-admin-filters">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search size={16} />} placeholder="搜索 Skill、所有者或邮箱" allowClear />
        <div className="skill-admin-scope-tabs">
          {([
            ["all", "全部"],
            ["private", "用户私有"],
            ["shared", "共享 Skill"],
            ["platform", "平台内置"],
            ["plugin", "自动能力"]
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={scope === value ? "is-selected" : ""} onClick={() => setScope(value)}>{label}</button>
          ))}
        </div>
        <Select value={language} onChange={setLanguage} options={[
          { value: "all", label: "全部语言状态" },
          { value: "complete", label: "语言完整" },
          { value: "missing", label: "缺少翻译" }
        ]} />
        <Select value={status} onChange={setStatus} options={[
          { value: "all", label: "全部状态" },
          { value: "published", label: "已发布" },
          { value: "draft", label: "有草稿" }
        ]} />
      </div>

      <div className="skill-admin-catalog-layout">
        <section className="skill-admin-table-wrap" aria-label="Skill 目录">
          {loading ? <div className="skill-admin-loading"><Spin /></div> : (
            <table className="skill-admin-table">
              <thead><tr><th>Skill</th><th>范围</th><th>所有者 / 归属</th><th className="skill-admin-col-status">状态</th><th className="skill-admin-col-updated">更新于</th><th>操作</th></tr></thead>
              <tbody>
                {filtered.map((entry) => {
                  const content = displayContent(entry);
                  const ownerOrScope = attribution(entry);
                  const isSelected = selected?.id === entry.id;
                  return (
                    <tr key={entry.id} className={isSelected ? "is-selected" : ""} onClick={() => setSelectedId(entry.id)}>
                      <td><div className="skill-admin-skill-cell"><code title={entry.canonicalName}>{entry.canonicalName}</code><span title={content.displayName}>{content.displayName || "未配置用途名"}</span></div></td>
                      <td><span className={`skill-admin-scope scope-${entry.sourceType === "plugin" ? "plugin" : entry.scope}`}>{entry.sourceType === "plugin" ? <BadgeCheck size={15} /> : <ScopeIcon scope={entry.scope} />}{entryScopeLabel(entry)}</span></td>
                      <td><div className="skill-admin-attribution-cell"><span className="skill-admin-attribution-icon" aria-hidden="true">{ownerOrScope.icon}</span><span><strong title={ownerOrScope.title}>{ownerOrScope.title}</strong>{ownerOrScope.secondary ? <small title={ownerOrScope.secondary}>{ownerOrScope.secondary}</small> : null}</span></div></td>
                      <td className="skill-admin-col-status"><div className="skill-admin-state-cell">{entry.draft ? <span className="skill-admin-table-status is-draft"><i aria-hidden="true" />有草稿</span> : entry.publishedAt ? <span className="skill-admin-table-status is-published"><i aria-hidden="true" />已发布</span> : <span className="skill-admin-table-status"><i aria-hidden="true" />未发布</span>}</div></td>
                      <td className="skill-admin-col-updated" title={localDate(entry.draft?.updatedAt ?? entry.publishedAt ?? entry.updatedAt)}>{localDateShort(entry.draft?.updatedAt ?? entry.publishedAt ?? entry.updatedAt)}</td>
                      <td>
                        <button type="button" className="skill-admin-link" onClick={(event) => { event.stopPropagation(); setEditingId(entry.id); }}>编辑</button>
                        <button type="button" className="skill-admin-more" aria-label="更多操作"><MoreVertical size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        {selected ? <SkillCatalogSidePanel entry={selected} onEdit={() => setEditingId(selected.id)} /> : null}
      </div>
    </div>
  );
}

function SkillCatalogSidePanel({ entry, onEdit }: { entry: SkillCatalogEntry; onEdit: () => void }) {
  const content = displayContent(entry);
  const runtimeLabel = entry.plugin?.readiness === "ready"
    ? "全部能力可用"
    : entry.plugin?.readiness === "degraded"
      ? "部分能力可用"
      : "当前不可用";
  return (
    <aside className="skill-admin-side-panel">
      <div className="skill-admin-side-heading"><strong>Skill 详情</strong><button type="button" aria-label="折叠详情"><ChevronDown size={17} /></button></div>
      <section className="skill-admin-detail-section">
        <h3>归属与可见范围</h3>
        <dl>
          <div><dt>所有者</dt><dd><ActorDetail actor={entry.owner} emptyLabel={entry.scope === "private" ? "未记录所有者" : "不适用"} /></dd></div>
          <div><dt>创建人</dt><dd><ActorDetail actor={entry.createdBy} emptyLabel={entry.system ? "系统" : "未记录创建人"} /></dd></div>
          <div><dt>原始范围</dt><dd><span className={`skill-admin-scope scope-${entry.sourceType === "plugin" ? "plugin" : entry.scope}`}>{entry.sourceType === "plugin" ? <BadgeCheck size={15} /> : <ScopeIcon scope={entry.scope} />}{entryScopeLabel(entry)}</span><code>{entry.rawScope || entry.scope}</code></dd></div>
          <div><dt>可见对象</dt><dd className="skill-admin-audience-list">{visibilityText(entry)}</dd></div>
        </dl>
      </section>
      <section className="skill-admin-detail-section">
        <h3>基础信息</h3>
        <dl>
          <div><dt>原名（规范名）</dt><dd><code>{entry.canonicalName}</code><Copy size={14} aria-hidden="true" /></dd></div>
          <div><dt>用途名</dt><dd>{content.displayName || "未配置"}<button type="button" onClick={onEdit}>编辑</button></dd></div>
          <div><dt>来源</dt><dd>{entry.sourceLabel}</dd></div>
          <div><dt>默认语言</dt><dd>{entry.defaultLocale}</dd></div>
          <div><dt>语言内容</dt><dd>{entry.languageStatus.configured}/{entry.languageStatus.total} {entry.languageStatus.configured === entry.languageStatus.total ? "完整" : "已配置"}</dd></div>
          <div><dt>当前发布</dt><dd>{localDate(entry.publishedAt)}</dd></div>
        </dl>
      </section>
      {entry.plugin ? <section className="skill-admin-detail-section"><h3>运行信息</h3><dl><div><dt>运行版本</dt><dd>{entry.plugin.version}</dd></div><div><dt>运行状态</dt><dd><span className={`skill-admin-status ${entry.plugin.readiness !== "unavailable" ? "is-published" : ""}`}>{runtimeLabel}</span></dd></div><div><dt>Portal 展示</dt><dd>{entry.plugin.visibleToUsers ? "显示" : "隐藏"}</dd></div><div><dt>能力状态</dt><dd>{entry.plugin.capabilityHealth.map((capability) => `${capability.label}：${capability.status === "ready" ? "可用" : capability.detail || "不可用"}`).join("；") || "—"}</dd></div><div><dt>包含 Skill</dt><dd>{entry.plugin.skillNames.join("、") || "—"}</dd></div></dl></section> : null}
      <h3>在 Portal 中的预览</h3>
      <PortalCardPreview entry={entry} content={content} />
      <Button block onClick={onEdit}>编辑展示内容</Button>
    </aside>
  );
}

function ActorDetail({ actor, emptyLabel }: { actor?: SkillCatalogActor; emptyLabel: string }) {
  if (!actor) return <span className="skill-admin-empty-value">{emptyLabel}</span>;
  return (
    <span className="skill-admin-actor-detail">
      <span className="skill-admin-attribution-icon" aria-hidden="true"><UserRound size={15} /></span>
      <span><strong>{actorName(actor)}</strong>{actorSecondary(actor) ? <small>{actorSecondary(actor)}</small> : null}</span>
    </span>
  );
}

type EditorTab = "base" | "translations" | "preview";

function SkillCatalogEditor({ entry, onBack, onUpdated }: { entry: SkillCatalogEntry; onBack: () => void; onUpdated: (entry: SkillCatalogEntry) => void }) {
  const [draft, setDraft] = useState<SkillCatalogDraft>(() => draftFromEntry(entry));
  const [tab, setTab] = useState<EditorTab>("translations");
  const [locale, setLocale] = useState(entry.defaultLocale);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const updateDraft = (updater: (current: SkillCatalogDraft) => SkillCatalogDraft) => {
    setDraft((current) => updater(current));
    setDirty(true);
    setNotice("");
  };
  const localeContent = draft.translations[locale] ?? EMPTY_LOCALE;
  const defaultContent = draft.translations[draft.baseConfig.defaultLocale] ?? EMPTY_LOCALE;
  const previewContent: SkillCatalogLocalizedContent = {
    displayName: localeContent.displayName || defaultContent.displayName || entry.canonicalName,
    summary: localeContent.summary || defaultContent.summary || entry.description,
    useCases: localeContent.useCases.length ? localeContent.useCases : defaultContent.useCases,
    usageSteps: localeContent.usageSteps.length ? localeContent.usageSteps : defaultContent.usageSteps,
    examplePrompts: localeContent.examplePrompts.length ? localeContent.examplePrompts : defaultContent.examplePrompts,
    dataScope: localeContent.dataScope || defaultContent.dataScope
  };
  const missing = [!localeContent.displayName && "用途名", !localeContent.summary && "一句话释义", !localeContent.useCases.length && "适用情况", !localeContent.usageSteps.length && "使用方法", !localeContent.examplePrompts.length && "示例问题"].filter(Boolean) as string[];

  const save = async (): Promise<SkillCatalogEntry | undefined> => {
    setSaving(true);
    setError("");
    try {
      const result = await saveSkillCatalogDraft(entry.id, draft);
      onUpdated(result.entry);
      setDirty(false);
      setNotice("草稿已保存");
      return result.entry;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "草稿保存失败");
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError("");
    try {
      if (dirty || !entry.draft) {
        const saved = await save();
        if (!saved) return;
      }
      const result = await publishSkillCatalogDraft(entry.id);
      onUpdated(result.entry);
      setDraft(draftFromEntry(result.entry));
      setDirty(false);
      setPublishOpen(false);
      setNotice("已发布，Portal 将读取当前配置");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="admin-page-container skill-admin-editor">
      <header className="skill-admin-editor-header">
        <div className="skill-admin-editor-title">
          <button type="button" onClick={onBack} aria-label="返回 Skill 管理"><ArrowLeft size={22} /></button>
          <div><h1>{previewContent.displayName || entry.canonicalName}</h1><p><code>{entry.canonicalName}</code><span>{entry.sourceType === "plugin" ? <BadgeCheck size={15} /> : <ScopeIcon scope={entry.scope} />}{entryScopeLabel(entry)}</span>{entry.publishedAt ? <em>已发布</em> : null}</p></div>
        </div>
        <div className="skill-admin-editor-actions">
          <Button disabled={!dirty} onClick={() => { setDraft(draftFromEntry(entry)); setDirty(false); }}>放弃更改</Button>
          <Button loading={saving} onClick={() => void save()}>保存草稿</Button>
          <Button type="primary" onClick={() => setPublishOpen(true)}>发布</Button>
        </div>
      </header>
      <nav className="skill-admin-editor-tabs" aria-label="Skill 配置步骤">
        {([[
          "base", "基础信息"
        ], ["translations", "多语言内容"], ["preview", "Portal 预览"]] as const).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "is-selected" : ""} onClick={() => setTab(value)}>{label}</button>
        ))}
      </nav>

      {error ? <div className="skill-admin-error" role="alert">{error}</div> : null}
      {notice ? <div className="skill-admin-notice" role="status"><CircleCheck size={16} />{notice}</div> : null}

      <div className="skill-admin-editor-layout">
        <main className="skill-admin-editor-main">
          {tab === "base" ? (
            <BaseSettings entry={entry} draft={draft} onChange={updateDraft} />
          ) : tab === "translations" ? (
            <>
              <div className="skill-admin-language-tabs">
                {["zh-CN", "en-US"].map((item) => {
                  const content = draft.translations[item] ?? EMPTY_LOCALE;
                  const complete = Boolean(content.displayName && content.summary);
                  return <button key={item} type="button" className={locale === item ? "is-selected" : ""} onClick={() => setLocale(item)}><strong>{item === "zh-CN" ? "简体中文" : "English"}</strong><span>{item}</span><em className={complete ? "is-complete" : ""}>{complete ? "完整" : "缺内容"}</em></button>;
                })}
                <button type="button" className="add-language"><Plus size={15} />添加语言</button>
                <span>默认语言：{draft.baseConfig.defaultLocale}</span>
              </div>
              {missing.length && locale !== draft.baseConfig.defaultLocale ? <div className="skill-admin-fallback-alert"><CircleAlert size={17} /><span><strong>{locale} 有 {missing.length} 项未配置</strong>Portal 将逐字段回退到 {draft.baseConfig.defaultLocale}：{missing.join("、")}</span></div> : null}
              <LocalizedContentEditor locale={locale} content={localeContent} onChange={(content) => updateDraft((current) => ({ ...current, translations: { ...current.translations, [locale]: content } }))} />
            </>
          ) : (
            <div className="skill-admin-full-preview"><h2>Portal 展示预览</h2><p>按 {locale} 预览当前草稿；缺失字段使用默认语言。</p><PortalDetailPreview entry={entry} draft={draft} content={previewContent} /></div>
          )}
        </main>
        <aside className="skill-admin-live-preview">
          <div className="skill-admin-live-preview-head"><strong>实时预览</strong><Select value={locale} onChange={setLocale} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]} /></div>
          <PortalDetailPreview entry={entry} draft={draft} content={previewContent} compact />
          <p>预览使用草稿内容，不影响当前已发布配置</p>
        </aside>
      </div>

      <Modal open={publishOpen} onCancel={() => setPublishOpen(false)} title="发布检查" footer={null} width={620}>
        <div className="skill-admin-publish-review">
          <div className="skill-admin-publish-summary"><CircleCheck size={22} /><div><strong>将用当前草稿覆盖 Portal 生效配置</strong><span>发布后，新打开或刷新的 Portal 会话会读取这些内容。</span></div></div>
          <dl>
            <div><dt>Skill</dt><dd><code>{entry.canonicalName}</code></dd></div>
            <div><dt>影响范围</dt><dd>{entryScopeLabel(entry)}</dd></div>
            <div><dt>默认语言</dt><dd>{draft.baseConfig.defaultLocale}</dd></div>
            <div><dt>语言完整度</dt><dd>{["zh-CN", "en-US"].filter((item) => draft.translations[item]?.displayName && draft.translations[item]?.summary).length}/2</dd></div>
            <div><dt>发布方式</dt><dd>覆盖当前配置，不保留版本快照</dd></div>
          </dl>
          {missing.length ? <div className="skill-admin-publish-warning"><CircleAlert size={17} />{locale} 仍有字段会回退到 {draft.baseConfig.defaultLocale}，允许发布但对应用户会看到回退内容。</div> : null}
          <div className="skill-admin-publish-actions"><Button onClick={() => setPublishOpen(false)}>继续编辑</Button><Button type="primary" loading={publishing} onClick={() => void publish()}>确认发布</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function BaseSettings({ entry, draft, onChange }: { entry: SkillCatalogEntry; draft: SkillCatalogDraft; onChange: (updater: (current: SkillCatalogDraft) => SkillCatalogDraft) => void }) {
  const patchBase = (patch: Partial<SkillCatalogDraft["baseConfig"]>) => onChange((current) => ({ ...current, baseConfig: { ...current.baseConfig, ...patch } }));
  const runtimeLabel = entry.plugin?.readiness === "ready"
    ? "全部能力可用"
    : entry.plugin?.readiness === "degraded"
      ? "部分能力可用"
      : "当前不可用";
  return (
    <div className="skill-admin-form-section">
      <h2>基础信息</h2><p>原名来自能力本身，不可翻译；展示配置只决定 Portal 如何解释和排序。</p>
      <label><span>{entry.sourceType === "plugin" ? "插件原名" : "Skill 原名"}</span><Input value={entry.canonicalName} disabled /><small>来自 {entry.sourceLabel}，不能在这里修改</small></label>
      {entry.plugin ? <div className="skill-admin-runtime-info"><strong>只读运行信息</strong><dl><div><dt>插件标识</dt><dd><code>{entry.plugin.pluginRef}</code></dd></div><div><dt>版本</dt><dd>{entry.plugin.version}</dd></div><div><dt>状态</dt><dd>{runtimeLabel}</dd></div><div><dt>Portal 展示</dt><dd>{entry.plugin.visibleToUsers ? "显示" : "隐藏"}</dd></div><div><dt>能力状态</dt><dd>{entry.plugin.capabilityHealth.map((capability) => `${capability.label}：${capability.status === "ready" ? "可用" : capability.detail || "不可用"}`).join("；") || "—"}</dd></div><div><dt>包含 Skill</dt><dd>{entry.plugin.skillNames.join("、") || "—"}</dd></div></dl><small>运行状态由系统根据共享运行时与安全隔离策略管理；这里仅配置用户看到的介绍内容。</small></div> : null}
      <label><span>默认语言</span><Select value={draft.baseConfig.defaultLocale} onChange={(value) => patchBase({ defaultLocale: value })} options={[{ value: "zh-CN", label: "简体中文 (zh-CN)" }, { value: "en-US", label: "English (en-US)" }]} /></label>
      <label><span>图标</span><Select value={draft.baseConfig.iconKey} onChange={(value) => patchBase({ iconKey: value })} options={Object.keys(ICON_BY_KEY).map((value) => ({ value, label: value }))} /></label>
      <label><span>排序</span><Input type="number" value={draft.baseConfig.sortOrder} onChange={(event) => patchBase({ sortOrder: Number(event.target.value) || 0 })} /></label>
      {entry.sourceType !== "plugin" ? <label><span>创建 Skill 快捷入口</span><Switch checked={draft.baseConfig.shortcutKey === "create_skill"} onChange={(checked) => patchBase({ shortcutKey: checked ? "create_skill" : undefined })} /><small>启用后，Portal 的“创建 Skill”按钮会定位到这个普通 Skill</small></label> : null}
      <label><span>在 Portal 可用</span><Switch checked={draft.baseConfig.status === "active"} onChange={(checked) => patchBase({ status: checked ? "active" : "disabled" })} /></label>
    </div>
  );
}

function LocalizedContentEditor({ locale, content, onChange }: { locale: string; content: SkillCatalogLocalizedContent; onChange: (content: SkillCatalogLocalizedContent) => void }) {
  const patch = (value: Partial<SkillCatalogLocalizedContent>) => onChange({ ...content, ...value });
  return (
    <div className="skill-admin-localized-editor">
      <section><h2>Portal 基本展示</h2><label><span>用途名</span><Input value={content.displayName} maxLength={32} showCount onChange={(event) => patch({ displayName: event.target.value })} placeholder={locale === "zh-CN" ? "例如：Skill 创建助手" : "For example: Skill Creator"} /></label><label><span>一句话释义</span><Input.TextArea value={content.summary} maxLength={160} showCount autoSize={{ minRows: 2, maxRows: 3 }} onChange={(event) => patch({ summary: event.target.value })} /></label></section>
      <section className="skill-admin-two-column"><ListEditor title="适合这些情况" items={content.useCases} onChange={(useCases) => patch({ useCases })} /><ListEditor title="使用方法" items={content.usageSteps} numbered onChange={(usageSteps) => patch({ usageSteps })} /></section>
      <section><ListEditor title="示例问题" items={content.examplePrompts} onChange={(examplePrompts) => patch({ examplePrompts })} /><small>用户点击后会填入 Portal 输入框</small></section>
      <section><h2>数据范围</h2><Input.TextArea value={content.dataScope} maxLength={500} showCount autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patch({ dataScope: event.target.value })} /></section>
    </div>
  );
}

function ListEditor({ title, items, numbered = false, onChange }: { title: string; items: string[]; numbered?: boolean; onChange: (items: string[]) => void }) {
  const update = (index: number, value: string) => onChange(items.map((item, itemIndex) => itemIndex === index ? value : item));
  return (
    <div className="skill-admin-list-editor"><h2>{title}</h2>{items.map((item, index) => <div key={index} className="skill-admin-list-row">{numbered ? <span>{index + 1}</span> : <span className="drag-handle">⋮⋮</span>}<Input value={item} onChange={(event) => update(index, event.target.value)} /><button type="button" aria-label={`删除 ${item}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div>)}<button type="button" className="skill-admin-add-row" onClick={() => onChange([...items, ""])}><Plus size={14} />添加一项</button></div>
  );
}

function PortalCardPreview({ entry, content }: { entry: SkillCatalogEntry; content: SkillCatalogLocalizedContent }) {
  return <div className="skill-admin-portal-card"><IconGlyph iconKey={entry.iconKey} /><div><strong>{content.displayName || entry.canonicalName}</strong><code>{entry.canonicalName}</code><p>{content.summary || entry.description || "尚未配置释义"}</p><span>{entry.sourceType === "plugin" ? <BadgeCheck size={15} /> : <ScopeIcon scope={entry.scope} />}{entryScopeLabel(entry)}</span></div></div>;
}

function PortalDetailPreview({ entry, draft, content, compact = false }: { entry: SkillCatalogEntry; draft: SkillCatalogDraft; content: SkillCatalogLocalizedContent; compact?: boolean }) {
  const automatic = entry.sourceType === "plugin";
  return <div className={`skill-admin-portal-detail${compact ? " is-compact" : ""}`}><div className="skill-admin-preview-title"><IconGlyph iconKey={draft.baseConfig.iconKey} size={25} /><div><strong>{content.displayName || entry.canonicalName}</strong><code>{entry.canonicalName}</code></div></div><p>{content.summary}</p><span className={`skill-admin-preview-scope${automatic ? " is-automatic" : ""}`}>{automatic ? <BadgeCheck size={15} /> : <ScopeIcon scope={entry.scope} />}{entryScopeLabel(entry)}</span>{automatic ? <div className="skill-admin-preview-automatic">此能力已由系统自动启用。描述匹配的任务时，系统会按需使用，无需手动选择。</div> : null}{content.useCases.length ? <PreviewSection title="适合这些情况"><ul>{content.useCases.map((item) => <li key={item}>{item}</li>)}</ul></PreviewSection> : null}{content.usageSteps.length ? <PreviewSection title="使用方法"><ol>{content.usageSteps.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ol></PreviewSection> : null}{content.examplePrompts.length ? <PreviewSection title="试试这样说"><div className="skill-admin-preview-prompts">{content.examplePrompts.slice(0, 2).map((item) => <button type="button" key={item}>{item}</button>)}</div></PreviewSection> : null}{automatic ? <Button className="is-automatic-copy" block>复制 ${entry.canonicalName}</Button> : <Button type="primary" block>启用 Skill</Button>}</div>;
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="skill-admin-preview-section"><h4>{title}</h4>{children}</section>;
}
