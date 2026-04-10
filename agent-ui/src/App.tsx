import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { fetchInvite, type AuthInvite } from "./features/auth/api";

const AdminShellLazy = lazy(() => import("./features/admin/AdminShell").then((module) => ({ default: module.AdminShell })));
const PortalShellLazy = lazy(() => import("./features/portal/PortalShell").then((module) => ({ default: module.PortalShell })));
const PublicSharePageLazy = lazy(() =>
  import("./features/public-share/PublicSharePage").then((module) => ({ default: module.PublicSharePage }))
);

type AppShellView = "portal" | "admin";

const ADMIN_HASH_PREFIX = "#admin/";

function canOpenAdmin(role: string | undefined, organizationType: string | undefined): boolean {
  return organizationType === "internal" && (role === "admin" || role === "super_admin");
}

function extractPublicShareToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  const token = match ? decodeURIComponent(match[1] || "") : "";
  return token || undefined;
}

function extractInviteToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/invite\/([^/]+)\/?$/);
  const token = match ? decodeURIComponent(match[1] || "") : "";
  return token || undefined;
}

function resolveAppShellView(hash: string, adminEligible: boolean): AppShellView {
  if (adminEligible && hash.startsWith(ADMIN_HASH_PREFIX)) {
    return "admin";
  }
  return "portal";
}

function replaceLocationHash(nextHash: string): void {
  if (typeof window === "undefined") return;
  const normalizedHash = nextHash.trim();
  const suffix = normalizedHash ? normalizedHash : "";
  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${window.location.search}${suffix}`
  );
}

function replaceLocationPath(nextPathname: string): void {
  if (typeof window === "undefined") return;
  const normalizedPathname = nextPathname.trim() || "/";
  window.history.replaceState(
    window.history.state,
    document.title,
    `${normalizedPathname}${window.location.search}${window.location.hash}`
  );
}

function formatInviteExpiry(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function AuthEntryCard(props: { auth: ReturnType<typeof useAuth>; inviteToken?: string }) {
  const [invite, setInvite] = useState<AuthInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(props.inviteToken));
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [manualInviteToken, setManualInviteToken] = useState("");
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [codeRequested, setCodeRequested] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);

  useEffect(() => {
    let active = true;
    if (!props.inviteToken) {
      setInvite(null);
      setInviteLoading(false);
      setInviteError(null);
      return;
    }

    setInviteLoading(true);
    setInviteError(null);
    void fetchInvite(props.inviteToken)
      .then((nextInvite) => {
        if (!active) return;
        setInvite(nextInvite);
        if (nextInvite.email) {
          setEmail(nextInvite.email);
        }
      })
      .catch((error) => {
        if (!active) return;
        setInvite(null);
        setInviteError(error instanceof Error ? error.message : "读取邀请失败");
      })
      .finally(() => {
        if (active) {
          setInviteLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [props.inviteToken]);

  const routeInvitePending = props.inviteToken && invite?.status === "pending" ? props.inviteToken : undefined;
  const fallbackEmail = invite?.status === "pending" ? invite.email?.trim() || "" : "";
  const activeInviteToken = routeInvitePending ?? (manualInviteToken.trim() || undefined);
  const resolvedEmail = email.trim() || fallbackEmail;
  const inviteStatusText = invite?.status === "pending" ? "待接受邀请" : invite?.status === "accepted" ? "已接受" : invite?.status === "expired" ? "已过期" : "";

  async function handleRequestEmailCode() {
    setFormError(null);
    props.auth.clearError();
    if (!resolvedEmail && !activeInviteToken) {
      setFormError("请输入邮箱，或提供有效邀请码。");
      return;
    }

    setRequestPending(true);
    try {
      const response = await props.auth.requestEmailSignIn({
        email: resolvedEmail || undefined,
        inviteToken: activeInviteToken
      });
      if (resolvedEmail) {
        setEmail(resolvedEmail);
      }
      setEmailHint(response.emailHint ?? invite?.emailHint ?? (resolvedEmail || null));
      setCodeRequested(true);
      setCode("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "发送验证码失败");
    } finally {
      setRequestPending(false);
    }
  }

  async function handleVerifyEmailCode() {
    setFormError(null);
    props.auth.clearError();
    if (!resolvedEmail) {
      setFormError("请输入邮箱。");
      return;
    }
    if (!code.trim()) {
      setFormError("请输入验证码。");
      return;
    }

    setVerifyPending(true);
    try {
      await props.auth.verifyEmailSignIn({
        email: resolvedEmail,
        code,
        inviteToken: activeInviteToken
      });
      if (props.inviteToken) {
        replaceLocationPath("/");
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "验证码校验失败");
    } finally {
      setVerifyPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card-shell">
        <div className="auth-card-head">
          <div>
            <p className="auth-eyebrow">Agent Studio</p>
            <h1>多租户访问入口</h1>
            <p className="auth-subtitle">内部员工继续使用钉钉免登，外部客户和协作者使用邮箱验证码进入所属组织。</p>
          </div>
          <div className="auth-card-badge">长期开放版</div>
        </div>

        {inviteLoading ? (
          <section className="auth-invite-banner">
            <strong>正在读取邀请信息</strong>
            <p>系统正在确认组织、邮箱和邀请状态。</p>
          </section>
        ) : invite ? (
          <section className="auth-invite-banner">
            <div className="auth-invite-banner-head">
              <strong>{invite.organization.name}</strong>
              {inviteStatusText ? <span className="auth-status-chip">{inviteStatusText}</span> : null}
            </div>
            <p>
              {invite.emailHint ? `目标邮箱：${invite.emailHint}` : "已识别邀请链接。"}
              {invite.membershipType ? ` 加入身份：${invite.membershipType}。` : ""}
            </p>
            {invite.expiresAt ? <p>有效期截止：{formatInviteExpiry(invite.expiresAt)}</p> : null}
          </section>
        ) : null}

        {inviteError ? <p className="err-text">{inviteError}</p> : null}
        {props.auth.error ? <p className="err-text">{props.auth.error}</p> : null}
        {formError ? <p className="err-text">{formError}</p> : null}

        <div className="auth-entry-grid">
          <section className="auth-option-panel">
            <div className="auth-option-copy">
              <p className="auth-option-kicker">内部员工</p>
              <h2>钉钉单点登录</h2>
              <p>适用于企业内部成员，沿用现有钉钉身份与部门同步，不需要额外账号。</p>
            </div>
            <button
              type="button"
              className="picker-btn auth-primary-btn"
              onClick={() => void props.auth.startSignIn()}
            >
              使用钉钉登录
            </button>
          </section>

          <section className="auth-option-panel auth-option-panel-email">
            <div className="auth-option-copy">
              <p className="auth-option-kicker">外部用户</p>
              <h2>邮箱验证码登录</h2>
              <p>适用于客户管理员、客户成员和受邀协作者。首次使用会根据邀请自动建立组织成员关系。</p>
            </div>

            <label className="auth-field">
              <span>邮箱地址</span>
              <input
                className="auth-field-input"
                type="email"
                placeholder="name@example.com"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {!props.inviteToken ? (
              <label className="auth-field">
                <span>邀请码（可选）</span>
                <input
                  className="auth-field-input"
                  type="text"
                  placeholder="输入邀请链接中的 token"
                  value={manualInviteToken}
                  onChange={(event) => setManualInviteToken(event.target.value)}
                />
              </label>
            ) : null}

            {codeRequested ? (
              <label className="auth-field">
                <span>邮箱验证码</span>
                <input
                  className="auth-field-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="输入 6 位验证码"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            ) : null}

            {emailHint ? <p className="auth-hint">验证码已发送至 {emailHint}。</p> : null}

            <div className="auth-action-row">
              <button
                type="button"
                className="picker-btn"
                disabled={requestPending}
                onClick={() => void handleRequestEmailCode()}
              >
                {requestPending ? "发送中..." : codeRequested ? "重新发送验证码" : "发送验证码"}
              </button>
              {codeRequested ? (
                <button
                  type="button"
                  className="picker-btn auth-primary-btn"
                  disabled={verifyPending}
                  onClick={() => void handleVerifyEmailCode()}
                >
                  {verifyPending ? "验证中..." : "验证并进入组织"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AppContent(props: { inviteToken?: string }) {
  const auth = useAuth();
  const adminEligible = useMemo(
    () => canOpenAdmin(auth.user?.role, auth.activeOrganization?.type),
    [auth.activeOrganization?.type, auth.user?.role]
  );
  const [view, setView] = useState<AppShellView>(() => {
    if (typeof window === "undefined") return "portal";
    return resolveAppShellView(window.location.hash, false);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    setView(resolveAppShellView(window.location.hash, adminEligible));
  }, [adminEligible, auth.user?.id]);

  useEffect(() => {
    if (!adminEligible && view === "admin") {
      if (typeof window !== "undefined" && window.location.hash.startsWith(ADMIN_HASH_PREFIX)) {
        replaceLocationHash("");
      }
      setView("portal");
    }
  }, [adminEligible, view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewFromLocation = () => {
      setView(resolveAppShellView(window.location.hash, adminEligible));
    };
    window.addEventListener("hashchange", syncViewFromLocation);
    window.addEventListener("popstate", syncViewFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncViewFromLocation);
      window.removeEventListener("popstate", syncViewFromLocation);
    };
  }, [adminEligible]);

  const openAdmin = adminEligible
    ? () => {
        if (typeof window !== "undefined" && !window.location.hash.startsWith(ADMIN_HASH_PREFIX)) {
          replaceLocationHash(`${ADMIN_HASH_PREFIX}overview`);
        }
        setView("admin");
      }
    : undefined;

  const openPortal = () => {
    if (typeof window !== "undefined" && window.location.hash.startsWith(ADMIN_HASH_PREFIX)) {
      replaceLocationHash("");
    }
    setView("portal");
  };

  if (auth.loading) {
    return (
      <div className="auth-screen" aria-live="polite">
        <div className="auth-card">
          <p className="auth-eyebrow">Agent Studio</p>
          <h1>正在检查登录状态</h1>
          <p>正在读取账号、组织和当前会话上下文。</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return <AuthEntryCard auth={auth} inviteToken={props.inviteToken} />;
  }

  if (adminEligible && view === "admin") {
    return (
      <Suspense fallback={<div className="auth-screen"><div className="auth-card"><p>管理控制台加载中...</p></div></div>}>
        <AdminShellLazy currentUser={auth.user} onOpenPortal={openPortal} onSignOut={() => void auth.signOut()} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="auth-screen"><div className="auth-card"><p>工作台加载中...</p></div></div>}>
      <PortalShellLazy
        currentUser={auth.user}
        onOpenAdmin={openAdmin}
        onSignOut={() => void auth.signOut()}
      />
    </Suspense>
  );
}

export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const publicShareToken = extractPublicShareToken(pathname);
  const inviteToken = extractInviteToken(pathname);

  if (publicShareToken) {
    return (
      <Suspense fallback={<div className="auth-screen"><div className="auth-card"><p>公开链接加载中...</p></div></div>}>
        <PublicSharePageLazy token={publicShareToken} />
      </Suspense>
    );
  }

  return (
    <AuthProvider>
      <AppContent inviteToken={inviteToken} />
    </AuthProvider>
  );
}
