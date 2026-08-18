import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  Link2,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Paperclip,
  Send,
  Share2,
  UserRound
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { BrandMark } from "../branding/BrandMark";
import { resolveBrandingAssetUrl } from "../branding/asset-url";
import type { PublicBrandInput } from "./types";

export type BrandPreviewScene = "login" | "portal" | "conversation" | "access" | "billing" | "email" | "share";

export const BRAND_PREVIEW_SCENES: Array<{ value: BrandPreviewScene; label: string }> = [
  { value: "login", label: "登录与邀请" },
  { value: "portal", label: "Portal 首页" },
  { value: "conversation", label: "对话过程" },
  { value: "access", label: "试用申请" },
  { value: "billing", label: "套餐与付款" },
  { value: "email", label: "客户邮件" },
  { value: "share", label: "公开分享" }
];

type BrandCustomerPreviewProps = {
  brand: PublicBrandInput;
  scene: BrandPreviewScene;
  device: "desktop" | "mobile";
  planNames?: string[];
};

function displayName(brand: PublicBrandInput): string {
  return brand.platformName.trim() || brand.name.trim() || "Brand Portal";
}

function assistantName(brand: PublicBrandInput): string {
  return brand.assistantName.trim() || "AI Assistant";
}

function welcomeMessage(brand: PublicBrandInput, device: "desktop" | "mobile"): string {
  const template = device === "mobile" ? brand.portalWelcomeMessageMobile : brand.portalWelcomeMessageDesktop;
  return (template.trim() || "How can I help?").replace(/{{assistantName}}/g, assistantName(brand));
}

function primaryHostname(brand: PublicBrandInput): string {
  const hostname = brand.domains.find((domain) => domain.isPrimary)?.hostname || brand.domains[0]?.hostname;
  if (hostname?.trim()) return hostname.trim();
  if (brand.primaryBaseUrl) {
    try {
      return new URL(brand.primaryBaseUrl).hostname;
    } catch {
      return brand.primaryBaseUrl.replace(/^https?:\/\//, "").split("/")[0] || "brand.example.com";
    }
  }
  return "brand.example.com";
}

function PreviewHeader({ brand, trailing }: { brand: PublicBrandInput; trailing?: ReactNode }) {
  const name = displayName(brand);
  return (
    <header className="brand-preview-product-header">
      <BrandMark
        className="brand-preview-product-mark"
        imageClassName="brand-preview-product-mark-image"
        name={name}
        logoUrl={brand.logoUrl || brand.iconUrl || ""}
      />
      <div className="brand-preview-product-copy">
        <strong>{name}</strong>
        <span>{brand.headerSubtitle || "Enterprise AI Assistant"}</span>
      </div>
      {trailing ? <div className="brand-preview-header-trailing">{trailing}</div> : null}
    </header>
  );
}

function AssistantAvatar({ brand }: { brand: PublicBrandInput }) {
  const avatarUrl = resolveBrandingAssetUrl(brand.assistantAvatarUrl || "");
  return avatarUrl
    ? <img className="brand-preview-assistant-avatar" src={avatarUrl} alt="" />
    : <span className="brand-preview-assistant-avatar is-placeholder"><Bot size={18} /></span>;
}

function LoginScene({ brand }: { brand: PublicBrandInput }) {
  const backgroundUrl = resolveBrandingAssetUrl(brand.loginBackgroundUrl || "");
  return (
    <div className="brand-preview-login">
      {backgroundUrl ? <img className="brand-preview-login-background" src={backgroundUrl} alt="" /> : null}
      <div className="brand-preview-login-panel">
        <BrandMark
          className="brand-preview-login-mark"
          imageClassName="brand-preview-login-mark-image"
          name={displayName(brand)}
          logoUrl={brand.logoUrl || brand.iconUrl || ""}
        />
        <div className="brand-preview-login-copy">
          <span className="brand-preview-eyebrow"><Mail size={11} />客户邀请</span>
          <strong>登录 {displayName(brand)}</strong>
          <p>{brand.externalLoginCopy || "使用工作邮箱继续。"}</p>
        </div>
        <label className="brand-preview-field"><span>工作邮箱</span><i>name@company.com</i></label>
        <button type="button" className="brand-preview-primary-button">继续<ArrowRight size={13} /></button>
        <small className="brand-preview-legal"><LockKeyhole size={11} />登录即表示同意服务条款与隐私政策</small>
      </div>
    </div>
  );
}

function PortalScene({ brand, device }: { brand: PublicBrandInput; device: "desktop" | "mobile" }) {
  const illustrationUrl = resolveBrandingAssetUrl(brand.portalWelcomeIllustrationUrl || brand.assistantAvatarUrl || "");
  const suggestions = brand.portalWelcomeSuggestions.filter((item) => item.label.trim()).slice(0, 3);
  const visibleSuggestions = suggestions.length ? suggestions : [
    { label: "总结一份资料", prompt: "" },
    { label: "分析业务问题", prompt: "" },
    { label: "起草工作邮件", prompt: "" }
  ];
  return (
    <div className="brand-preview-app-shell">
      <PreviewHeader brand={brand} trailing={<span className="brand-preview-user"><UserRound size={13} /></span>} />
      <div className="brand-preview-portal-body">
        <nav className="brand-preview-side-nav" aria-hidden="true">
          <span className="is-active"><MessageSquareText size={13} />新对话</span>
          <span><FileText size={13} />资料集</span>
          <i />
          <small>最近对话</small>
          <span>销售资料摘要</span>
          <span>产品方案比较</span>
        </nav>
        <main className="brand-preview-welcome">
          {illustrationUrl ? <img className="brand-preview-welcome-illustration" src={illustrationUrl} alt="" /> : <AssistantAvatar brand={brand} />}
          <strong>{welcomeMessage(brand, device)}</strong>
          <div className="brand-preview-suggestions">
            {visibleSuggestions.map((suggestion) => <span key={suggestion.label}>{suggestion.label}<ArrowRight size={11} /></span>)}
          </div>
          <div className="brand-preview-composer"><Paperclip size={13} /><span>输入问题或上传资料</span><i><Send size={12} /></i></div>
        </main>
      </div>
    </div>
  );
}

function ConversationScene({ brand }: { brand: PublicBrandInput }) {
  return (
    <div className="brand-preview-app-shell">
      <PreviewHeader brand={brand} trailing={<span className="brand-preview-share-action"><Share2 size={12} />分享</span>} />
      <div className="brand-preview-conversation">
        <div className="brand-preview-thread-title"><strong>产品方案比较</strong><span>刚刚更新</span></div>
        <div className="brand-preview-message is-user">请总结这份方案，并列出三项关键差异。</div>
        <div className="brand-preview-message-row">
          <AssistantAvatar brand={brand} />
          <div className="brand-preview-message is-assistant">
            <strong>{assistantName(brand)}</strong>
            <p>方案的核心差异集中在部署方式、服务范围和交付周期。建议优先确认现网条件，再比较总体成本。</p>
            <div className="brand-preview-source"><FileText size={12} /><span>产品方案说明.pdf</span><small>第 4-7 页</small></div>
            {brand.answerFeedbackEnabled ? <small className="brand-preview-feedback">{brand.answerFeedbackPrompt || "这个回答有帮助吗？"}　○　○</small> : null}
          </div>
        </div>
        <div className="brand-preview-composer"><Paperclip size={13} /><span>继续提问</span><i><Send size={12} /></i></div>
      </div>
    </div>
  );
}

function AccessScene({ brand }: { brand: PublicBrandInput }) {
  return (
    <div className="brand-preview-app-shell">
      <PreviewHeader brand={brand} />
      <div className="brand-preview-access">
        <span className="brand-preview-access-icon"><CheckCircle2 size={20} /></span>
        <strong>申请访问 {displayName(brand)}</strong>
        <p>提交企业信息后，审核结果将发送到你的工作邮箱。</p>
        <div className="brand-preview-access-fields">
          <label className="brand-preview-field"><span>公司名称</span><i>请输入公司名称</i></label>
          <label className="brand-preview-field"><span>{brand.accessSalesContactLabel || "销售联系人"}</span><i>姓名或邮箱</i></label>
        </div>
        <button type="button" className="brand-preview-primary-button">提交申请</button>
        <div className="brand-preview-process">
          <span className="is-complete"><Check size={10} />提交申请</span><i /><span>企业审核</span><i /><span>账号开通</span>
        </div>
      </div>
    </div>
  );
}

function BillingScene({ brand, planNames }: { brand: PublicBrandInput; planNames: string[] }) {
  const plans = planNames.length ? planNames.slice(0, 2) : ["团队版", "企业版"];
  const merchant = brand.billingMerchantName?.trim() || displayName(brand);
  return (
    <div className="brand-preview-app-shell">
      <PreviewHeader brand={brand} trailing={<CreditCard size={14} />} />
      <div className="brand-preview-billing">
        <div className="brand-preview-billing-heading"><div><strong>选择套餐</strong><span>按月订阅，可随时管理续费</span></div><small>安全支付</small></div>
        <div className="brand-preview-plan-list">
          {plans.map((plan, index) => (
            <div className={`brand-preview-plan${index === 0 ? " is-selected" : ""}`} key={plan}>
              <span>{index === 0 ? <Check size={10} /> : null}</span><div><strong>{plan}</strong><small>{index === 0 ? "适合日常团队协作" : "适合多部门统一使用"}</small></div><b>{index === 0 ? "¥199" : "联系销售"}</b>
            </div>
          ))}
        </div>
        <div className="brand-preview-checkout-summary"><span>收款方</span><strong>{merchant}</strong><span>今日应付</span><strong>¥199.00</strong></div>
        <button type="button" className="brand-preview-primary-button"><CreditCard size={13} />确认并付款</button>
        <small className="brand-preview-support">付款支持：{brand.billingSupportEmail || brand.supportEmail || "support@example.com"}</small>
      </div>
    </div>
  );
}

function EmailScene({ brand }: { brand: PublicBrandInput }) {
  const fromName = brand.emailFromName.trim() || displayName(brand);
  return (
    <div className="brand-preview-email-client">
      <div className="brand-preview-email-toolbar"><Mail size={13} /><span>收件箱</span><small>刚刚</small></div>
      <div className="brand-preview-email-meta">
        <BrandMark className="brand-preview-email-avatar" imageClassName="brand-preview-email-avatar-image" name={fromName} logoUrl={brand.iconUrl || brand.logoUrl || ""} />
        <div><strong>{fromName}</strong><span>{brand.emailFromAddress || "notifications@brand.example.com"}</span></div>
      </div>
      <div className="brand-preview-email-content">
        <strong>你的访问申请已通过</strong>
        <p>你好，你的企业账号已经开通。现在可以登录 {displayName(brand)} 开始使用。</p>
        <button type="button" className="brand-preview-primary-button">进入 {displayName(brand)}</button>
        <small>如需帮助，请联系 {brand.emailReplyTo || brand.supportEmail || "support@example.com"}</small>
      </div>
      <footer><BrandMark className="brand-preview-email-footer-mark" imageClassName="brand-preview-email-footer-image" name={displayName(brand)} logoUrl={brand.logoUrl || ""} /><span>此邮件由 {displayName(brand)} 发送</span></footer>
    </div>
  );
}

function ShareScene({ brand }: { brand: PublicBrandInput }) {
  return (
    <div className="brand-preview-app-shell">
      <PreviewHeader brand={brand} trailing={<span className="brand-preview-public-label"><Link2 size={11} />公开链接</span>} />
      <div className="brand-preview-share">
        <div className="brand-preview-share-title"><Share2 size={15} /><div><strong>产品方案比较</strong><span>由 {assistantName(brand)} 生成</span></div></div>
        <div className="brand-preview-shared-question">如何选择适合团队的部署方案？</div>
        <div className="brand-preview-message-row">
          <AssistantAvatar brand={brand} />
          <div className="brand-preview-message is-assistant"><strong>{assistantName(brand)}</strong><p>先确认数据边界和接入范围，再根据团队规模评估部署方式。以下是三种方案的适用条件与主要差异。</p><div className="brand-preview-source"><FileText size={12} /><span>方案比较表</span><small>2 个来源</small></div></div>
        </div>
        <small className="brand-preview-share-footer">分享内容只读 · 由 {displayName(brand)} 提供</small>
      </div>
    </div>
  );
}

function SceneContent({ brand, scene, device, planNames }: BrandCustomerPreviewProps) {
  if (scene === "login") return <LoginScene brand={brand} />;
  if (scene === "portal") return <PortalScene brand={brand} device={device} />;
  if (scene === "conversation") return <ConversationScene brand={brand} />;
  if (scene === "access") return <AccessScene brand={brand} />;
  if (scene === "billing") return <BillingScene brand={brand} planNames={planNames || []} />;
  if (scene === "email") return <EmailScene brand={brand} />;
  return <ShareScene brand={brand} />;
}

export function BrandCustomerPreview(props: BrandCustomerPreviewProps) {
  return (
    <div
      className={`brand-preview-frame is-${props.device}`}
      data-preview-scene={props.scene}
      style={{
        "--preview-brand": props.brand.primaryColor || "#0066ff",
        "--preview-accent": props.brand.accentColor || "#2ccff0"
      } as CSSProperties}
    >
      <div className="brand-preview-browser-bar">
        <span><i /><i /><i /></span>
        <strong><LockKeyhole size={9} />{primaryHostname(props.brand)}</strong>
      </div>
      <div className="brand-preview-viewport">
        <SceneContent {...props} />
      </div>
    </div>
  );
}
