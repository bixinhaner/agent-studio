import {
  Alert,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Upload
} from "antd";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Globe2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { BrandMark } from "../branding/BrandMark";
import { uploadSystemSettingsBrandingAsset, type BrandingAssetKind } from "../system-settings/api";
import {
  checkPublicBrand,
  createPublicBrand,
  fetchPublicBrandLookups,
  fetchPublicBrands,
  regeneratePublicBrandProjection,
  updatePublicBrand
} from "./api";
import type { PublicBrandInput, PublicBrandLookups, PublicBrandRecord } from "./types";

const { TextArea } = Input;
type DetailTab = "entry" | "experience" | "email" | "payment" | "knowledge" | "customers";
type AssetField = "logoUrl" | "iconUrl" | "loginBackgroundUrl" | "portalWelcomeIllustrationUrl" | "assistantAvatarUrl";

const ASSET_KIND: Record<AssetField, BrandingAssetKind> = {
  logoUrl: "logo",
  iconUrl: "icon",
  loginBackgroundUrl: "login-background",
  portalWelcomeIllustrationUrl: "portal-welcome-illustration",
  assistantAvatarUrl: "assistant-avatar"
};

const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "entry", label: "入口与域名" },
  { key: "experience", label: "体验与助手" },
  { key: "email", label: "邮件" },
  { key: "payment", label: "支付" },
  { key: "knowledge", label: "资料与输出" },
  { key: "customers", label: "客户归属" }
];

function emptyBrand(): PublicBrandInput {
  return {
    key: "",
    name: "",
    status: "disabled",
    primaryBaseUrl: "",
    primaryColor: "#0066FF",
    accentColor: "#2CCFF0",
    platformName: "",
    headerSubtitle: "Enterprise AI Assistant",
    externalLoginCopy: "Sign in with your work email to continue.",
    logoUrl: "",
    iconUrl: "",
    loginBackgroundUrl: "",
    portalWelcomeIllustrationUrl: "",
    assistantName: "AI Assistant",
    assistantAvatarUrl: "",
    portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}. How can I help?",
    portalWelcomeMessageMobile: "How can I help?",
    portalWelcomeSuggestions: [],
    answerFeedbackEnabled: true,
    answerFeedbackPrompt: "Was this answer helpful?",
    externalOnly: true,
    accessRequestEnabled: true,
    accessSalesContactLabel: "Sales Contact",
    billingEnabled: true,
    billingSuccessUrl: "",
    billingCancelUrl: "",
    billingPortalUrl: "",
    supportEmail: "",
    supportUrl: "",
    privacyUrl: "",
    termsUrl: "",
    emailFromName: "AI Assistant",
    emailFromAddress: "",
    emailReplyTo: "",
    emailSenderVerified: false,
    billingMerchantName: "",
    billingSupportEmail: "",
    paymentAccountMode: "shared",
    paymentStripeAccountId: "",
    paymentAccountReady: false,
    resourceBindingMode: "brand_managed",
    agentModeId: null,
    knowledgeSetIds: [],
    knowledgeIsolationMode: "direct",
    knowledgeReplacementRules: [],
    outputProtectionEnabled: false,
    outputForbiddenTerms: [],
    subscriptionPlanIds: [],
    domains: [{ hostname: "", status: "active", isPrimary: true }],
    organizationIds: []
  };
}

function toInput(brand: PublicBrandRecord): PublicBrandInput {
  const {
    id: _id,
    readiness: _readiness,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdByUserId: _createdBy,
    updatedByUserId: _updatedBy,
    knowledgeProjectionStorage: _projectionStorage,
    knowledgeProjectionStatus: _projectionStatus,
    knowledgeProjectionItemCount: _projectionItems,
    knowledgeProjectionAt: _projectionAt,
    knowledgeProjectionError: _projectionError,
    ...input
  } = brand;
  return input;
}

function nullable(value: string | null): string | null {
  return value?.trim() || null;
}

function SuggestionEditor({
  value,
  onChange
}: {
  value: PublicBrandInput["portalWelcomeSuggestions"];
  onChange: (value: PublicBrandInput["portalWelcomeSuggestions"]) => void;
}) {
  return (
    <div className="brand-suggestion-editor">
      {value.map((suggestion, index) => (
        <div className="brand-suggestion-row" key={index}>
          <Input
            value={suggestion.label}
            placeholder="显示标题"
            onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
          />
          <Input
            value={suggestion.prompt}
            placeholder="发送给助手的问题"
            onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: event.target.value } : item))}
          />
          <Button danger type="text" icon={<Trash2 size={15} />} aria-label="删除快捷问题" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />
        </div>
      ))}
      <Button disabled={value.length >= 8} icon={<Plus size={15} />} onClick={() => onChange([...value, { label: "", prompt: "" }])}>添加快捷问题</Button>
    </div>
  );
}

function normalizeInput(value: PublicBrandInput): PublicBrandInput {
  const nullableFields = [
    "primaryBaseUrl", "logoUrl", "iconUrl", "loginBackgroundUrl", "portalWelcomeIllustrationUrl",
    "assistantAvatarUrl", "billingSuccessUrl", "billingCancelUrl", "billingPortalUrl", "supportEmail",
    "supportUrl", "privacyUrl", "termsUrl", "emailFromAddress", "emailReplyTo", "billingMerchantName",
    "billingSupportEmail", "paymentStripeAccountId", "agentModeId"
  ] as const;
  const next = { ...value };
  nullableFields.forEach((field) => { next[field] = nullable(value[field]) as never; });
  next.domains = value.domains.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...domain }) => ({
    ...domain,
    hostname: domain.hostname.trim().toLowerCase()
  }));
  next.outputForbiddenTerms = Array.from(new Set(value.outputForbiddenTerms.map((item) => item.trim()).filter(Boolean)));
  return next;
}

function localTime(value?: string): string {
  if (!value) return "尚未生成";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚未生成" : date.toLocaleString();
}

function readinessLabel(brand: PublicBrandRecord): string {
  return brand.readiness.ready ? "已上线" : brand.status === "active" ? "需处理" : "已停用";
}

function ReadinessList({ brand }: { brand: PublicBrandRecord }) {
  return (
    <div className="brand-readiness-list">
      {brand.readiness.checks.map((check) => (
        <div className="brand-readiness-row" key={check.key}>
          {check.ok ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
          <span>{check.detail}</span>
          <strong>{check.ok ? "已通过" : "待完成"}</strong>
        </div>
      ))}
    </div>
  );
}

export function BrandManagementView() {
  const [brands, setBrands] = useState<PublicBrandRecord[]>([]);
  const [lookups, setLookups] = useState<PublicBrandLookups | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PublicBrandInput>(emptyBrand);
  const [screen, setScreen] = useState<"overview" | "detail">("overview");
  const [tab, setTab] = useState<DetailTab>("entry");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [uploading, setUploading] = useState<AssetField | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selected = useMemo(() => brands.find((brand) => brand.id === selectedId), [brands, selectedId]);
  const filteredBrands = useMemo(() => brands.filter((brand) => {
    const matchesQuery = !query.trim() || `${brand.name} ${brand.key} ${brand.domains.map((domain) => domain.hostname).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
    const label = readinessLabel(brand);
    const matchesStatus = statusFilter === "all" || (statusFilter === "ready" ? brand.readiness.ready : statusFilter === "attention" ? !brand.readiness.ready && brand.status === "active" : brand.status === "disabled");
    return matchesQuery && matchesStatus && Boolean(label);
  }), [brands, query, statusFilter]);

  async function load(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const [nextBrands, nextLookups] = await Promise.all([fetchPublicBrands(), fetchPublicBrandLookups()]);
      const nextId = preferredId || selectedId || nextBrands[0]?.id || "";
      setBrands(nextBrands);
      setLookups(nextLookups);
      setSelectedId(nextId);
      const nextSelected = nextBrands.find((brand) => brand.id === nextId);
      setDraft(nextSelected ? toInput(nextSelected) : emptyBrand());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "品牌配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function selectBrand(id: string) {
    const next = brands.find((brand) => brand.id === id);
    setSelectedId(id);
    if (next) setDraft(toInput(next));
    setError("");
    setSuccess("");
  }

  function openDetail(id?: string, nextTab: DetailTab = "entry") {
    if (id) selectBrand(id);
    setTab(nextTab);
    setScreen("detail");
  }

  function patch(value: Partial<PublicBrandInput>) {
    setDraft((current) => ({ ...current, ...value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = selectedId
        ? await updatePublicBrand(selectedId, normalizeInput(draft))
        : await createPublicBrand(normalizeInput(draft));
      await load(saved.id);
      setSuccess("品牌配置已保存；未通过上线检查的能力仍保持关闭");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function runCheck() {
    if (!selectedId) return;
    setChecking(true);
    setError("");
    try {
      const readiness = await checkPublicBrand(selectedId);
      setBrands((items) => items.map((item) => item.id === selectedId ? { ...item, readiness } : item));
      setSuccess(readiness.ready ? "全部上线检查项已通过" : "检查完成，仍有配置需要处理");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "上线检查失败");
    } finally {
      setChecking(false);
    }
  }

  async function regenerateProjection() {
    if (!selectedId) return;
    setProjecting(true);
    setError("");
    try {
      const brand = await regeneratePublicBrandProjection(selectedId);
      setBrands((items) => items.map((item) => item.id === brand.id ? brand : item));
      setDraft(toInput(brand));
      setSuccess(`资料投影已更新，共 ${brand.knowledgeProjectionItemCount.toLocaleString()} 个文本条目`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "资料投影生成失败");
    } finally {
      setProjecting(false);
    }
  }

  async function uploadAsset(field: AssetField, file: File) {
    setUploading(field);
    setError("");
    try {
      const asset = await uploadSystemSettingsBrandingAsset(ASSET_KIND[field], file);
      patch({ [field]: asset.url });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "素材上传失败");
    } finally {
      setUploading("");
    }
  }

  function assetField(label: string, field: AssetField) {
    return (
      <label className="brand-config-field">
        <span>{label}</span>
        <div className="brand-inline-control">
          <Input value={draft[field] || ""} onChange={(event) => patch({ [field]: event.target.value })} />
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(file) => { void uploadAsset(field, file as File); return false; }}>
            <Button icon={<UploadCloud size={16} />} loading={uploading === field} aria-label={`上传${label}`} />
          </Upload>
        </div>
      </label>
    );
  }

  if (loading && !lookups) return <div className="brand-management-loading"><Spin size="large" /></div>;

  if (screen === "overview") {
    const readyCount = brands.filter((brand) => brand.readiness.ready).length;
    const attentionCount = brands.filter((brand) => brand.status === "active" && !brand.readiness.ready).length;
    const customerCount = brands.reduce((total, brand) => total + brand.organizationIds.length, 0);
    return (
      <div className="brand-hub-page">
        <header className="brand-hub-header">
          <div><h1>品牌入口</h1><p>统一管理客户域名、入口体验与白标隔离</p></div>
          <Button type="primary" icon={<Plus size={17} />} onClick={() => { setSelectedId(""); setDraft(emptyBrand()); openDetail(undefined); }}>新增品牌</Button>
        </header>
        {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
        <div className="brand-metric-grid">
          <div><Building2 /><span>品牌</span><strong>{brands.length}</strong></div>
          <div><CheckCircle2 /><span>已就绪</span><strong>{readyCount}</strong></div>
          <div><CircleAlert /><span>待处理</span><strong>{attentionCount}</strong></div>
          <div><Globe2 /><span>客户组织</span><strong>{customerCount}</strong></div>
        </div>
        <div className="brand-hub-workspace">
          <section className="brand-directory">
            <div className="brand-directory-tools">
              <Input prefix={<Search size={16} />} placeholder="搜索品牌名称或域名" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
              <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "ready", label: "已就绪" }, { value: "attention", label: "需处理" }, { value: "disabled", label: "已停用" }]} />
              <Button icon={<RefreshCw size={16} />} aria-label="刷新品牌列表" onClick={() => void load(selectedId)} />
            </div>
            {filteredBrands.length ? (
              <div className="brand-table-wrap">
                <table className="brand-table">
                  <thead><tr><th>品牌</th><th>域名</th><th>状态</th><th>客户组织</th><th>上线就绪度</th><th>操作</th></tr></thead>
                  <tbody>{filteredBrands.map((brand) => {
                    const passed = brand.readiness.checks.filter((check) => check.ok).length;
                    return (
                      <tr key={brand.id} className={selectedId === brand.id ? "is-selected" : ""} onClick={() => selectBrand(brand.id)}>
                        <td><div className="brand-table-identity"><span style={{ background: brand.primaryColor }}>{brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : null}</span><strong>{brand.name}</strong></div></td>
                        <td><span className="brand-domain-primary">{brand.domains.find((domain) => domain.isPrimary)?.hostname || brand.key}</span>{brand.domains.length > 1 ? <small>+{brand.domains.length - 1}</small> : null}</td>
                        <td><Tag color={brand.readiness.ready ? "success" : brand.status === "active" ? "warning" : "default"}>{readinessLabel(brand)}</Tag></td>
                        <td>{brand.organizationIds.length}</td>
                        <td><div className="brand-readiness-progress"><span>{passed}/{brand.readiness.checks.length}</span><i><b style={{ width: `${(passed / Math.max(1, brand.readiness.checks.length)) * 100}%`, background: brand.readiness.ready ? "#16a34a" : "#f59e0b" }} /></i></div></td>
                        <td><div className="brand-table-actions"><Button type="link" onClick={(event) => { event.stopPropagation(); openDetail(brand.id); }}>配置</Button></div></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的品牌" />}
          </section>
          <aside className="brand-check-panel">
            {selected ? <>
              <div className="brand-check-head"><BrandMark name={selected.platformName} logoUrl={selected.logoUrl || selected.iconUrl || ""} /><div><strong>{selected.name}</strong><span>{selected.domains.find((domain) => domain.isPrimary)?.hostname}</span></div></div>
              <p>检查品牌上线所需配置与隔离项</p>
              <ReadinessList brand={selected} />
              {!selected.readiness.ready ? <Alert type="warning" showIcon message="存在未完成的必要检查项" description="未就绪的客户能力会失败关闭，不会回退显示其他品牌。" /> : null}
              <Button block icon={<RefreshCw size={16} />} loading={checking} onClick={() => void runCheck()}>重新检查</Button>
              <Button block type="primary" onClick={() => openDetail(selected.id)}>处理配置</Button>
            </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个品牌查看上线检查" />}
          </aside>
        </div>
      </div>
    );
  }

  const knowledgeSets = lookups?.knowledgeSets.filter((item) => draft.knowledgeSetIds.includes(item.id)) ?? [];
  return (
    <div className="brand-detail-page">
      <header className="brand-detail-header">
        <button type="button" className="brand-back-link" onClick={() => setScreen("overview")}><ArrowLeft size={16} />返回品牌列表</button>
        <div className="brand-detail-title"><h1>{draft.name || "新增品牌"}</h1><Tag color={draft.status === "active" ? "success" : "default"}>{draft.status === "active" ? "已启用" : "已停用"}</Tag><span>{draft.domains.find((domain) => domain.isPrimary)?.hostname}</span></div>
        <div className="brand-detail-actions">{draft.primaryBaseUrl ? <Button href={draft.primaryBaseUrl} target="_blank" icon={<ExternalLink size={16} />}>打开入口</Button> : null}<Button type="primary" icon={<Save size={16} />} loading={saving} onClick={() => void save()}>保存并检查</Button></div>
      </header>
      <nav className="brand-detail-tabs" aria-label="品牌配置分类">{DETAIL_TABS.map((item) => <button type="button" key={item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav>
      {error ? <Alert className="brand-detail-alert" type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
      {success ? <Alert className="brand-detail-alert" type="success" showIcon message={success} closable onClose={() => setSuccess("")} /> : null}
      <div className="brand-detail-workspace">
        <main className="brand-config-main">
          {tab === "entry" ? <>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>入口身份</h2><p>域名命中此品牌后，所有公开页面只使用这里的身份。</p></div><div className="brand-config-grid">
              <label className="brand-config-field"><span>内部标识</span><Input value={draft.key} disabled={Boolean(selectedId)} placeholder="brand-key" onChange={(event) => patch({ key: event.target.value })} /></label>
              <label className="brand-config-field"><span>配置名称</span><Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label className="brand-config-field"><span>客户看到的平台名</span><Input value={draft.platformName} onChange={(event) => patch({ platformName: event.target.value })} /></label>
              <label className="brand-config-field"><span>入口状态</span><Select value={draft.status} options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} onChange={(status) => patch({ status })} /></label>
              <label className="brand-config-field brand-field-wide"><span>主入口地址</span><Input value={draft.primaryBaseUrl || ""} placeholder="https://brand.example.com" onChange={(event) => patch({ primaryBaseUrl: event.target.value })} /></label>
              <label className="brand-config-field brand-field-wide"><span>登录说明</span><TextArea rows={2} value={draft.externalLoginCopy} onChange={(event) => patch({ externalLoginCopy: event.target.value })} /></label>
            </div></section>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>域名</h2><p>每个域名只能归属一个品牌，主域名用于邮件与付款返回。</p></div><div className="brand-domain-editor">{draft.domains.map((domain, index) => <div key={domain.id ?? `domain-${index}`}><Input value={domain.hostname} placeholder="brand.example.com" onChange={(event) => patch({ domains: draft.domains.map((item, itemIndex) => itemIndex === index ? { ...item, hostname: event.target.value } : item) })} /><Switch checked={domain.status === "active"} checkedChildren="启用" unCheckedChildren="停用" onChange={(checked) => patch({ domains: draft.domains.map((item, itemIndex) => itemIndex === index ? { ...item, status: checked ? "active" : "disabled" } : item) })} /><Button type={domain.isPrimary ? "primary" : "default"} onClick={() => patch({ domains: draft.domains.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index })) })}>主域名</Button><Button danger icon={<Trash2 size={15} />} aria-label="删除域名" disabled={draft.domains.length === 1} onClick={() => patch({ domains: draft.domains.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}<Button icon={<Plus size={15} />} onClick={() => patch({ domains: [...draft.domains, { hostname: "", status: "active", isPrimary: false }] })}>添加域名</Button></div></section>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>公开链接</h2><p>法律与支持链接按品牌展示，不回退到平台默认身份。</p></div><div className="brand-config-grid"><label className="brand-config-field"><span>支持邮箱</span><Input value={draft.supportEmail || ""} onChange={(event) => patch({ supportEmail: event.target.value })} /></label><label className="brand-config-field"><span>支持网站</span><Input value={draft.supportUrl || ""} onChange={(event) => patch({ supportUrl: event.target.value })} /></label><label className="brand-config-field"><span>隐私政策</span><Input value={draft.privacyUrl || ""} onChange={(event) => patch({ privacyUrl: event.target.value })} /></label><label className="brand-config-field"><span>服务条款</span><Input value={draft.termsUrl || ""} onChange={(event) => patch({ termsUrl: event.target.value })} /></label></div></section>
          </> : null}

          {tab === "experience" ? <>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>视觉与助手</h2><p>客户在登录、工作台和对话中看到同一套品牌身份。</p></div><div className="brand-config-grid"><label className="brand-config-field"><span>主色</span><div className="brand-color-control"><input type="color" value={draft.primaryColor} onChange={(event) => patch({ primaryColor: event.target.value.toUpperCase() })} /><Input value={draft.primaryColor} onChange={(event) => patch({ primaryColor: event.target.value })} /></div></label><label className="brand-config-field"><span>辅助色</span><div className="brand-color-control"><input type="color" value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value.toUpperCase() })} /><Input value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value })} /></div></label><label className="brand-config-field"><span>顶部副标题</span><Input value={draft.headerSubtitle} onChange={(event) => patch({ headerSubtitle: event.target.value })} /></label><label className="brand-config-field"><span>助手名称</span><Input value={draft.assistantName} onChange={(event) => patch({ assistantName: event.target.value })} /></label>{assetField("品牌 Logo", "logoUrl")}{assetField("站点图标", "iconUrl")}{assetField("助手头像", "assistantAvatarUrl")}{assetField("登录背景", "loginBackgroundUrl")}{assetField("欢迎页插图", "portalWelcomeIllustrationUrl")}</div></section>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>Portal 体验</h2><p>只展示客户完成问答和服务申请所需的信息。</p></div><div className="brand-config-grid"><label className="brand-config-field brand-field-wide"><span>桌面欢迎语</span><TextArea rows={2} value={draft.portalWelcomeMessageDesktop} onChange={(event) => patch({ portalWelcomeMessageDesktop: event.target.value })} /></label><label className="brand-config-field brand-field-wide"><span>移动端欢迎语</span><TextArea rows={2} value={draft.portalWelcomeMessageMobile} onChange={(event) => patch({ portalWelcomeMessageMobile: event.target.value })} /></label><div className="brand-config-field brand-field-wide"><span>快捷问题</span><SuggestionEditor value={draft.portalWelcomeSuggestions} onChange={(portalWelcomeSuggestions) => patch({ portalWelcomeSuggestions })} /></div><label className="brand-config-field brand-field-wide"><span>回答反馈提示</span><Input value={draft.answerFeedbackPrompt} disabled={!draft.answerFeedbackEnabled} onChange={(event) => patch({ answerFeedbackPrompt: event.target.value })} /></label></div><div className="brand-toggle-grid"><label><Switch checked={draft.externalOnly} onChange={(externalOnly) => patch({ externalOnly })} /><span>仅允许外部客户登录</span></label><label><Switch checked={draft.accessRequestEnabled} onChange={(accessRequestEnabled) => patch({ accessRequestEnabled })} /><span>开放试用申请</span></label><label><Switch checked={draft.billingEnabled} onChange={(billingEnabled) => patch({ billingEnabled })} /><span>开放套餐购买</span></label><label><Switch checked={draft.answerFeedbackEnabled} onChange={(answerFeedbackEnabled) => patch({ answerFeedbackEnabled })} /><span>收集回答反馈</span></label></div></section>
          </> : null}

          {tab === "email" ? <>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>客户邮件身份</h2><p>验证码、邀请、审核与计费通知都使用同一品牌发件身份。</p></div><div className="brand-config-grid"><label className="brand-config-field"><span>发件人名称</span><Input value={draft.emailFromName} onChange={(event) => patch({ emailFromName: event.target.value })} /></label><label className="brand-config-field"><span>发件邮箱</span><Input value={draft.emailFromAddress || ""} onChange={(event) => patch({ emailFromAddress: event.target.value, emailSenderVerified: false })} /></label><label className="brand-config-field"><span>回复邮箱</span><Input value={draft.emailReplyTo || ""} onChange={(event) => patch({ emailReplyTo: event.target.value })} /></label><label className="brand-config-field"><span>销售联系人字段名</span><Input value={draft.accessSalesContactLabel} onChange={(event) => patch({ accessSalesContactLabel: event.target.value })} /></label></div><div className="brand-verification-row"><div>{draft.emailSenderVerified ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<span><strong>{draft.emailSenderVerified ? "发件域名已验证" : "发件域名待验证"}</strong><small>验证 SPF、DKIM 和实际投递后再标记就绪。</small></span></div><Switch checked={draft.emailSenderVerified} checkedChildren="已验证" unCheckedChildren="待验证" onChange={(emailSenderVerified) => patch({ emailSenderVerified })} /></div></section>
          </> : null}

          {tab === "payment" ? <>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>支付商户</h2><p>客户结账页、收据与账单只展示这里绑定的商户身份。</p></div><div className="brand-config-grid"><label className="brand-config-field"><span>客户看到的商户名</span><Input value={draft.billingMerchantName || ""} onChange={(event) => patch({ billingMerchantName: event.target.value })} /></label><label className="brand-config-field"><span>账单支持邮箱</span><Input value={draft.billingSupportEmail || ""} onChange={(event) => patch({ billingSupportEmail: event.target.value })} /></label><label className="brand-config-field"><span>支付账户模式</span><Segmented block value={draft.paymentAccountMode} options={[{ value: "shared", label: "平台共享账户（需确认账单品牌）" }, { value: "connected", label: "独立连接账户" }]} onChange={(value) => patch({ paymentAccountMode: value as PublicBrandInput["paymentAccountMode"], paymentAccountReady: false })} /></label>{draft.paymentAccountMode === "connected" ? <label className="brand-config-field"><span>Stripe Account ID</span><Input value={draft.paymentStripeAccountId || ""} placeholder="acct_..." onChange={(event) => patch({ paymentStripeAccountId: event.target.value, paymentAccountReady: false })} /></label> : null}</div><div className="brand-verification-row"><div>{draft.paymentAccountReady ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<span><strong>{draft.paymentAccountReady ? "支付商户已就绪" : "支付商户待配置"}</strong><small>未就绪时客户仍可查看套餐，但付费操作会停止并提示联系支持。</small></span></div><Switch checked={draft.paymentAccountReady} checkedChildren="已就绪" unCheckedChildren="未就绪" onChange={(paymentAccountReady) => patch({ paymentAccountReady })} /></div></section>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>套餐与返回地址</h2><p>套餐继续复用系统中的现有定义，品牌只控制可见范围。</p></div><div className="brand-config-grid"><label className="brand-config-field brand-field-wide"><span>可购买套餐</span><Select mode="multiple" optionFilterProp="label" value={draft.subscriptionPlanIds} options={(lookups?.plans || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(subscriptionPlanIds) => patch({ subscriptionPlanIds })} /></label><label className="brand-config-field"><span>付款成功返回</span><Input value={draft.billingSuccessUrl || ""} onChange={(event) => patch({ billingSuccessUrl: event.target.value })} /></label><label className="brand-config-field"><span>取消付款返回</span><Input value={draft.billingCancelUrl || ""} onChange={(event) => patch({ billingCancelUrl: event.target.value })} /></label><label className="brand-config-field brand-field-wide"><span>续费入口</span><Input value={draft.billingPortalUrl || ""} onChange={(event) => patch({ billingPortalUrl: event.target.value })} /></label></div></section>
          </> : null}

          {tab === "knowledge" ? <>
            <section className="brand-config-section"><div className="brand-section-heading"><h2>资料来源</h2><p>共享源资料只维护一份，品牌投影自动生成当前脱敏副本。</p></div><div className="brand-config-grid"><label className="brand-config-field brand-field-wide"><span>资源分配方式</span><Segmented block value={draft.resourceBindingMode} options={[{ value: "brand_managed", label: "品牌固定资源" }, { value: "organization_policy", label: "沿用组织权限" }]} onChange={(value) => patch({ resourceBindingMode: value as PublicBrandInput["resourceBindingMode"] })} /></label>{draft.resourceBindingMode === "brand_managed" ? <><label className="brand-config-field"><span>默认智能体</span><Select showSearch optionFilterProp="label" value={draft.agentModeId || undefined} options={(lookups?.agentModes || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(agentModeId) => patch({ agentModeId })} /></label><label className="brand-config-field"><span>资料集</span><Select mode="multiple" optionFilterProp="label" value={draft.knowledgeSetIds} options={(lookups?.knowledgeSets || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(knowledgeSetIds) => patch({ knowledgeSetIds })} /></label><label className="brand-config-field brand-field-wide"><span>隔离模式</span><Segmented block value={draft.knowledgeIsolationMode} options={[{ value: "brand_projection", label: "品牌投影（推荐）" }, { value: "direct", label: "直接复用" }]} onChange={(value) => patch({ knowledgeIsolationMode: value as PublicBrandInput["knowledgeIsolationMode"] })} /></label></> : null}</div>{draft.resourceBindingMode === "brand_managed" && draft.knowledgeIsolationMode === "brand_projection" ? <div className="brand-projection-status"><div><strong>{selected?.knowledgeProjectionItemCount.toLocaleString() || "0"} 个条目</strong><span>最后同步：{localTime(selected?.knowledgeProjectionAt)}</span><Tag color={selected?.knowledgeProjectionStatus === "ready" ? "success" : selected?.knowledgeProjectionStatus === "failed" ? "error" : "warning"}>{selected?.knowledgeProjectionStatus === "ready" ? "已同步" : selected?.knowledgeProjectionStatus === "failed" ? "失败" : "待同步"}</Tag></div><Button icon={<RefreshCw size={16} />} loading={projecting} disabled={!selectedId} onClick={() => void regenerateProjection()}>重新生成投影</Button></div> : null}<p className="brand-config-note">更改资料来源或脱敏规则后会重建当前投影，不保留历史配置版本。</p></section>
            {draft.resourceBindingMode === "brand_managed" && draft.knowledgeIsolationMode === "brand_projection" ? <section className="brand-config-section"><div className="brand-section-heading"><h2>脱敏规则</h2><p>规则同时处理文本内容和文件路径，二进制附件不会进入投影。</p></div><div className="brand-rule-table"><div className="brand-rule-head"><span>原词</span><span>客户显示</span><span>处理方式</span><span /></div>{draft.knowledgeReplacementRules.map((rule, index) => <div className="brand-rule-row" key={index}><Input value={rule.source} onChange={(event) => patch({ knowledgeReplacementRules: draft.knowledgeReplacementRules.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item) })} /><Input value={rule.target} disabled={rule.mode === "remove"} onChange={(event) => patch({ knowledgeReplacementRules: draft.knowledgeReplacementRules.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item) })} /><Select value={rule.mode} options={[{ value: "replace", label: "替换" }, { value: "remove", label: "删除" }]} onChange={(mode) => patch({ knowledgeReplacementRules: draft.knowledgeReplacementRules.map((item, itemIndex) => itemIndex === index ? { ...item, mode } : item) })} /><Button danger type="text" icon={<Trash2 size={15} />} aria-label="删除脱敏规则" onClick={() => patch({ knowledgeReplacementRules: draft.knowledgeReplacementRules.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div><Button icon={<Plus size={15} />} onClick={() => patch({ knowledgeReplacementRules: [...draft.knowledgeReplacementRules, { source: "", target: "", mode: "replace" }] })}>添加规则</Button></section> : null}
            <section className="brand-config-section"><div className="brand-section-heading"><h2>输出保护</h2><p>对实时过程和最终回答执行品牌术语检查。</p></div><div className="brand-output-control"><label><Switch checked={draft.outputProtectionEnabled} onChange={(outputProtectionEnabled) => patch({ outputProtectionEnabled })} /><span>启用输出保护</span></label><Select mode="tags" tokenSeparators={[","]} value={draft.outputForbiddenTerms} placeholder="输入禁用词并回车" onChange={(outputForbiddenTerms) => patch({ outputForbiddenTerms })} /></div></section>
          </> : null}

          {tab === "customers" ? <section className="brand-config-section"><div className="brand-section-heading"><h2>客户归属</h2><p>客户组织绑定品牌后，只能从该品牌域名登录；注册、审核、开通与套餐流程保持不变。</p></div><label className="brand-config-field brand-field-wide"><span>已归属客户组织</span><Select mode="multiple" optionFilterProp="label" value={draft.organizationIds} options={(lookups?.organizations || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}`, disabled: Boolean(item.publicBrandId && item.publicBrandId !== selectedId) }))} onChange={(organizationIds) => patch({ organizationIds })} /></label></section> : null}
        </main>
        <aside className="brand-detail-aside">
          <section className="brand-customer-preview"><div className="brand-preview-head"><strong>客户预览</strong><Segmented size="small" value={previewDevice} options={[{ value: "desktop", label: "桌面端" }, { value: "mobile", label: "移动端" }]} onChange={(value) => setPreviewDevice(value as "desktop" | "mobile")} /></div><div className={`brand-preview-canvas is-${previewDevice}`} style={{ "--preview-brand": draft.primaryColor } as CSSProperties}><BrandMark name={draft.platformName || draft.name || "Brand"} logoUrl={draft.logoUrl || draft.iconUrl || ""} />{draft.assistantAvatarUrl ? <img className="brand-preview-avatar" src={draft.assistantAvatarUrl} alt="" /> : <span className="brand-preview-avatar-placeholder" />}<p>{(previewDevice === "mobile" ? draft.portalWelcomeMessageMobile : draft.portalWelcomeMessageDesktop).replace("{{assistantName}}", draft.assistantName)}</p><button type="button">开始对话</button></div></section>
          {selected ? <section className="brand-detail-readiness"><div><strong>上线检查</strong><span>{selected.readiness.checks.filter((check) => check.ok).length}/{selected.readiness.checks.length}</span></div><ReadinessList brand={selected} /><Button block icon={<RefreshCw size={16} />} loading={checking} onClick={() => void runCheck()}>查看全部检查项</Button></section> : <section className="brand-detail-readiness"><ShieldCheck size={24} /><strong>保存后开始上线检查</strong></section>}
          {tab === "knowledge" && knowledgeSets.length ? <section className="brand-source-summary"><strong>已选资料源</strong>{knowledgeSets.map((item) => <div key={item.id}><span>{item.name}</span><small>{item.itemCount?.toLocaleString() || 0} 项</small></div>)}</section> : null}
        </aside>
      </div>
    </div>
  );
}
