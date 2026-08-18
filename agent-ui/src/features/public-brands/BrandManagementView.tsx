import { Alert, Button, Empty, Input, Select, Spin, Switch, Tag, Upload } from "antd";
import { CheckCircle2, CircleAlert, ExternalLink, Plus, RefreshCw, Save, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BrandMark } from "../branding/BrandMark";
import { uploadSystemSettingsBrandingAsset, type BrandingAssetKind } from "../system-settings/api";
import { checkPublicBrand, createPublicBrand, fetchPublicBrandLookups, fetchPublicBrands, updatePublicBrand } from "./api";
import type { PublicBrandInput, PublicBrandLookups, PublicBrandRecord } from "./types";

const { TextArea } = Input;

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
    billingEnabled: true,
    billingSuccessUrl: "",
    billingCancelUrl: "",
    billingPortalUrl: "",
    agentModeId: null,
    knowledgeSetIds: [],
    subscriptionPlanIds: [],
    domains: [{ hostname: "", status: "active", isPrimary: true }],
    organizationIds: []
  };
}

function toInput(brand: PublicBrandRecord): PublicBrandInput {
  const { id: _id, readiness: _readiness, createdAt: _createdAt, updatedAt: _updatedAt, createdByUserId: _createdBy, updatedByUserId: _updatedBy, ...input } = brand;
  return input;
}

function compactNullable(value: string | null): string | null {
  return value?.trim() || null;
}

function normalizeInput(value: PublicBrandInput): PublicBrandInput {
  return {
    ...value,
    primaryBaseUrl: compactNullable(value.primaryBaseUrl),
    logoUrl: compactNullable(value.logoUrl),
    iconUrl: compactNullable(value.iconUrl),
    loginBackgroundUrl: compactNullable(value.loginBackgroundUrl),
    portalWelcomeIllustrationUrl: compactNullable(value.portalWelcomeIllustrationUrl),
    assistantAvatarUrl: compactNullable(value.assistantAvatarUrl),
    billingSuccessUrl: compactNullable(value.billingSuccessUrl),
    billingCancelUrl: compactNullable(value.billingCancelUrl),
    billingPortalUrl: compactNullable(value.billingPortalUrl),
    agentModeId: compactNullable(value.agentModeId),
    domains: value.domains.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...domain }) => ({
      ...domain,
      hostname: domain.hostname.trim().toLowerCase()
    }))
  };
}

type AssetField = "logoUrl" | "iconUrl" | "loginBackgroundUrl" | "portalWelcomeIllustrationUrl" | "assistantAvatarUrl";

const ASSET_KIND: Record<AssetField, BrandingAssetKind> = {
  logoUrl: "logo",
  iconUrl: "icon",
  loginBackgroundUrl: "login-background",
  portalWelcomeIllustrationUrl: "portal-welcome-illustration",
  assistantAvatarUrl: "assistant-avatar"
};

export function BrandManagementView() {
  const [brands, setBrands] = useState<PublicBrandRecord[]>([]);
  const [lookups, setLookups] = useState<PublicBrandLookups | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PublicBrandInput>(emptyBrand);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<AssetField | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selected = useMemo(() => brands.find((brand) => brand.id === selectedId), [brands, selectedId]);

  async function load(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const [nextBrands, nextLookups] = await Promise.all([fetchPublicBrands(), fetchPublicBrandLookups()]);
      setBrands(nextBrands);
      setLookups(nextLookups);
      const nextId = preferredId || selectedId || nextBrands[0]?.id || "";
      setSelectedId(nextId);
      const nextSelected = nextBrands.find((brand) => brand.id === nextId);
      setDraft(nextSelected ? toInput(nextSelected) : emptyBrand());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "品牌配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function selectBrand(id: string) {
    setSelectedId(id);
    const next = brands.find((brand) => brand.id === id);
    setDraft(next ? toInput(next) : emptyBrand());
    setError("");
    setSuccess("");
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
      setSuccess("当前品牌配置已生效");
      await load(saved.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
    } finally {
      setSaving(false);
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
      <label className="brand-field">
        <span>{label}</span>
        <div className="brand-inline-control">
          <Input value={draft[field] || ""} onChange={(event) => patch({ [field]: event.target.value })} />
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              void uploadAsset(field, file as File);
              return false;
            }}
          >
            <Button icon={<UploadCloud size={16} />} loading={uploading === field} aria-label={`上传${label}`} />
          </Upload>
        </div>
      </label>
    );
  }

  if (loading && !lookups) {
    return <div className="brand-management-loading"><Spin size="large" /></div>;
  }

  return (
    <div className="brand-management-page">
      <aside className="brand-management-list" aria-label="品牌入口列表">
        <div className="brand-management-list-head">
          <div><strong>品牌入口</strong><span>{brands.length} 个</span></div>
          <Button
            icon={<Plus size={16} />}
            aria-label="新增品牌"
            onClick={() => {
              setSelectedId("");
              setDraft(emptyBrand());
              setError("");
              setSuccess("");
            }}
          />
        </div>
        <div className="brand-management-list-body">
          {brands.length ? brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              className={`brand-list-item${selectedId === brand.id ? " is-active" : ""}`}
              onClick={() => selectBrand(brand.id)}
            >
              <span className="brand-list-swatch" style={{ background: brand.primaryColor }} />
              <span className="brand-list-copy"><strong>{brand.name}</strong><small>{brand.domains[0]?.hostname || brand.key}</small></span>
              <Tag color={brand.status === "active" ? "success" : "default"}>{brand.status === "active" ? "启用" : "停用"}</Tag>
            </button>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置品牌" />}
        </div>
      </aside>

      <main className="brand-management-editor">
        <header className="brand-management-toolbar">
          <div>
            <h2>{selectedId ? draft.name || "品牌配置" : "新增品牌"}</h2>
            <p>保存后立即作用于对应域名，不生成历史版本。</p>
          </div>
          <div className="brand-management-actions">
            {selected?.primaryBaseUrl ? (
              <Button icon={<ExternalLink size={16} />} href={selected.primaryBaseUrl} target="_blank">打开入口</Button>
            ) : null}
            {selectedId ? (
              <Button icon={<RefreshCw size={16} />} onClick={() => void load(selectedId)}>刷新</Button>
            ) : null}
            <Button type="primary" icon={<Save size={16} />} loading={saving} onClick={() => void save()}>保存并生效</Button>
          </div>
        </header>

        {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
        {success ? <Alert type="success" showIcon message={success} closable onClose={() => setSuccess("")} /> : null}

        {selected ? (
          <section className="brand-readiness-band">
            <div className="brand-readiness-title">
              {selected.readiness.ready ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <strong>{selected.readiness.ready ? "已具备上线条件" : "仍有配置未完成"}</strong>
              <Button size="small" onClick={async () => {
                const readiness = await checkPublicBrand(selected.id);
                setBrands((items) => items.map((item) => item.id === selected.id ? { ...item, readiness } : item));
              }}>重新检查</Button>
            </div>
            <div className="brand-readiness-checks">
              {selected.readiness.checks.map((item) => <Tag key={item.key} color={item.ok ? "success" : "warning"}>{item.detail}</Tag>)}
            </div>
          </section>
        ) : null}

        <div className="brand-editor-sections">
          <section className="brand-editor-section">
            <div className="brand-section-heading"><h3>入口与身份</h3><p>客户首先看到的域名、名称和登录说明。</p></div>
            <div className="brand-form-grid">
              <label className="brand-field"><span>内部标识</span><Input value={draft.key} placeholder="ranley" disabled={Boolean(selectedId)} onChange={(event) => patch({ key: event.target.value })} /></label>
              <label className="brand-field"><span>配置名称</span><Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label className="brand-field"><span>客户看到的平台名</span><Input value={draft.platformName} onChange={(event) => patch({ platformName: event.target.value })} /></label>
              <label className="brand-field"><span>入口状态</span><Select value={draft.status} options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} onChange={(status) => patch({ status })} /></label>
              <label className="brand-field brand-field-wide"><span>主入口地址</span><Input value={draft.primaryBaseUrl || ""} placeholder="https://ranley.example.com" onChange={(event) => patch({ primaryBaseUrl: event.target.value })} /></label>
              <label className="brand-field brand-field-wide"><span>登录说明</span><TextArea rows={2} value={draft.externalLoginCopy} onChange={(event) => patch({ externalLoginCopy: event.target.value })} /></label>
            </div>
            <div className="brand-domain-list">
              {draft.domains.map((domain, index) => (
                <div className="brand-domain-row" key={`${index}-${domain.hostname}`}>
                  <Input value={domain.hostname} placeholder="ranley.example.com" onChange={(event) => patch({ domains: draft.domains.map((item, itemIndex) => itemIndex === index ? { ...item, hostname: event.target.value } : item) })} />
                  <Switch checked={domain.status === "active"} checkedChildren="启用" unCheckedChildren="停用" onChange={(checked) => patch({ domains: draft.domains.map((item, itemIndex) => itemIndex === index ? { ...item, status: checked ? "active" : "disabled" } : item) })} />
                  <Button type={domain.isPrimary ? "primary" : "default"} onClick={() => patch({ domains: draft.domains.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index })) })}>主域名</Button>
                  <Button danger icon={<Trash2 size={15} />} aria-label="删除域名" disabled={draft.domains.length === 1} onClick={() => patch({ domains: draft.domains.filter((_, itemIndex) => itemIndex !== index) })} />
                </div>
              ))}
              <Button icon={<Plus size={15} />} onClick={() => patch({ domains: [...draft.domains, { hostname: "", status: "active", isPrimary: false }] })}>添加域名</Button>
            </div>
          </section>

          <section className="brand-editor-section">
            <div className="brand-section-heading"><h3>视觉与助手</h3><p>主题色、Logo 和助手形象按域名实时加载。</p></div>
            <div className="brand-preview-strip">
              <BrandMark name={draft.platformName || draft.name || "Brand"} logoUrl={draft.logoUrl || draft.iconUrl || ""} />
              <span className="brand-preview-assistant" style={{ borderColor: draft.primaryColor }}>
                {draft.assistantAvatarUrl ? <img src={draft.assistantAvatarUrl} alt="" /> : null}
              </span>
              <div><strong>{draft.assistantName}</strong><small>{draft.headerSubtitle}</small></div>
            </div>
            <div className="brand-form-grid">
              <label className="brand-field"><span>主色</span><div className="brand-color-control"><input type="color" value={draft.primaryColor} onChange={(event) => patch({ primaryColor: event.target.value.toUpperCase() })} /><Input value={draft.primaryColor} onChange={(event) => patch({ primaryColor: event.target.value })} /></div></label>
              <label className="brand-field"><span>辅助色</span><div className="brand-color-control"><input type="color" value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value.toUpperCase() })} /><Input value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value })} /></div></label>
              <label className="brand-field"><span>顶部副标题</span><Input value={draft.headerSubtitle} onChange={(event) => patch({ headerSubtitle: event.target.value })} /></label>
              <label className="brand-field"><span>助手名称</span><Input value={draft.assistantName} onChange={(event) => patch({ assistantName: event.target.value })} /></label>
              {assetField("品牌 Logo", "logoUrl")}
              {assetField("站点图标", "iconUrl")}
              {assetField("助手头像", "assistantAvatarUrl")}
              {assetField("登录背景", "loginBackgroundUrl")}
              {assetField("欢迎页插图", "portalWelcomeIllustrationUrl")}
            </div>
          </section>

          <section className="brand-editor-section">
            <div className="brand-section-heading"><h3>Portal 体验</h3><p>外部客户只看到完成问答所需的信息。</p></div>
            <div className="brand-form-grid">
              <label className="brand-field brand-field-wide"><span>桌面欢迎语</span><TextArea rows={2} value={draft.portalWelcomeMessageDesktop} onChange={(event) => patch({ portalWelcomeMessageDesktop: event.target.value })} /></label>
              <label className="brand-field brand-field-wide"><span>移动端欢迎语</span><TextArea rows={2} value={draft.portalWelcomeMessageMobile} onChange={(event) => patch({ portalWelcomeMessageMobile: event.target.value })} /></label>
            </div>
            <div className="brand-suggestion-list">
              {draft.portalWelcomeSuggestions.map((item, index) => (
                <div className="brand-suggestion-row" key={index}>
                  <Input value={item.label} placeholder="按钮名称" onChange={(event) => patch({ portalWelcomeSuggestions: draft.portalWelcomeSuggestions.map((entry, itemIndex) => itemIndex === index ? { ...entry, label: event.target.value } : entry) })} />
                  <TextArea rows={2} value={item.prompt} placeholder="点击后发送的问题" onChange={(event) => patch({ portalWelcomeSuggestions: draft.portalWelcomeSuggestions.map((entry, itemIndex) => itemIndex === index ? { ...entry, prompt: event.target.value } : entry) })} />
                  <Button danger icon={<Trash2 size={15} />} aria-label="删除推荐问题" onClick={() => patch({ portalWelcomeSuggestions: draft.portalWelcomeSuggestions.filter((_, itemIndex) => itemIndex !== index) })} />
                </div>
              ))}
              <Button icon={<Plus size={15} />} disabled={draft.portalWelcomeSuggestions.length >= 8} onClick={() => patch({ portalWelcomeSuggestions: [...draft.portalWelcomeSuggestions, { label: "", prompt: "" }] })}>添加推荐问题</Button>
            </div>
            <div className="brand-switch-grid">
              <label><Switch checked={draft.externalOnly} onChange={(externalOnly) => patch({ externalOnly })} /><span>仅允许外部客户登录</span></label>
              <label><Switch checked={draft.accessRequestEnabled} onChange={(accessRequestEnabled) => patch({ accessRequestEnabled })} /><span>开放试用申请</span></label>
              <label><Switch checked={draft.billingEnabled} onChange={(billingEnabled) => patch({ billingEnabled })} /><span>开放套餐购买</span></label>
              <label><Switch checked={draft.answerFeedbackEnabled} onChange={(answerFeedbackEnabled) => patch({ answerFeedbackEnabled })} /><span>收集回答反馈</span></label>
            </div>
            <label className="brand-field"><span>反馈问题</span><Input value={draft.answerFeedbackPrompt} onChange={(event) => patch({ answerFeedbackPrompt: event.target.value })} /></label>
          </section>

          <section className="brand-editor-section">
            <div className="brand-section-heading"><h3>能力与客户绑定</h3><p>复用现有智能体、资料集和套餐；客户无需感知这些内部资源名称。</p></div>
            <div className="brand-form-grid">
              <label className="brand-field"><span>默认智能体</span><Select showSearch optionFilterProp="label" value={draft.agentModeId || undefined} options={(lookups?.agentModes || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(agentModeId) => patch({ agentModeId })} /></label>
              <label className="brand-field"><span>自动使用的资料集</span><Select mode="multiple" optionFilterProp="label" value={draft.knowledgeSetIds} options={(lookups?.knowledgeSets || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(knowledgeSetIds) => patch({ knowledgeSetIds })} /></label>
              <label className="brand-field"><span>可购买套餐</span><Select mode="multiple" optionFilterProp="label" value={draft.subscriptionPlanIds} options={(lookups?.plans || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}` }))} onChange={(subscriptionPlanIds) => patch({ subscriptionPlanIds })} /></label>
              <label className="brand-field"><span>已归属客户组织</span><Select mode="multiple" optionFilterProp="label" value={draft.organizationIds} options={(lookups?.organizations || []).map((item) => ({ value: item.id, label: `${item.name} · ${item.slug}`, disabled: Boolean(item.publicBrandId && item.publicBrandId !== selectedId) }))} onChange={(organizationIds) => patch({ organizationIds })} /></label>
              <label className="brand-field"><span>付款成功返回地址</span><Input value={draft.billingSuccessUrl || ""} onChange={(event) => patch({ billingSuccessUrl: event.target.value })} /></label>
              <label className="brand-field"><span>取消付款返回地址</span><Input value={draft.billingCancelUrl || ""} onChange={(event) => patch({ billingCancelUrl: event.target.value })} /></label>
              <label className="brand-field brand-field-wide"><span>续费入口地址</span><Input value={draft.billingPortalUrl || ""} onChange={(event) => patch({ billingPortalUrl: event.target.value })} /></label>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
