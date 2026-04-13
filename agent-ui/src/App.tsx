import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { fetchInvite, type AuthInvite } from "./features/auth/api";
import "./features/auth/auth.css";

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

function inviteMembershipTypeLabel(value: string | null | undefined): string {
  switch ((value || "").trim()) {
    case "customer_admin":
      return "Admin";
    case "customer_member":
      return "User";
    case "employee":
      return "员工";
    default:
      return value?.trim() || "";
  }
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

  const [showInviteField, setShowInviteField] = useState(false);

  return (
    <div className="auth-modern-screen">
      <div className="auth-modern-card">
        <div className="auth-modern-header">
          <h1 className="auth-modern-logo">Agent Studio</h1>
          <p className="auth-modern-subtitle">Sign in to your organization</p>
        </div>

        {inviteLoading ? (
          <div className="auth-modern-invite">正在读取邀请信息...</div>
        ) : invite ? (
          <div className="auth-modern-invite">
            🌟 <strong>{invite.organization.name}</strong> 邀请你加入
            {inviteStatusText ? ` (${inviteStatusText})` : ""}
          </div>
        ) : null}

        {inviteError && <p className="err-text" style={{margin:0,textAlign:'center'}}>{inviteError}</p>}
        {props.auth.error && <p className="err-text" style={{margin:0,textAlign:'center'}}>{props.auth.error}</p>}
        {formError && <p className="err-text" style={{margin:0,textAlign:'center'}}>{formError}</p>}

        {!codeRequested && (
          <button
            className="auth-modern-sso-btn"
            onClick={() => void props.auth.startSignIn()}
          >
            Continue with DingTalk
          </button>
        )}

        {!codeRequested && <div className="auth-modern-divider">OR</div>}

        {!codeRequested ? (
          <div className="auth-modern-field auth-modern-fade-enter">
            <input
              className="auth-modern-input"
              type="email"
              placeholder="Email address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            
            {showInviteField && !props.inviteToken && (
              <input
                className="auth-modern-input"
                style={{ marginTop: 8 }}
                type="text"
                placeholder="Invite token (Optional)"
                value={manualInviteToken}
                onChange={(e) => setManualInviteToken(e.target.value)}
              />
            )}
            
            <button
              className="auth-modern-primary-btn"
              style={{ marginTop: 8 }}
              disabled={requestPending}
              onClick={() => void handleRequestEmailCode()}
            >
              {requestPending ? "Sending..." : "Continue with Email"}
            </button>

            {!props.inviteToken && !showInviteField && (
              <button 
                className="auth-modern-dropdown-link" 
                onClick={() => setShowInviteField(true)}
              >
                Have an invite code?
              </button>
            )}
          </div>
        ) : (
          <div className="auth-modern-field auth-modern-fade-enter">
            <p className="auth-modern-hint">
              {emailHint ? `We sent a code to ${emailHint}` : `Enter the verification code sent to your email.`}
            </p>
            <input
              className="auth-modern-input"
              style={{ marginTop: 8, letterSpacing: '0.2em', textAlign: 'center', fontSize: 18, fontWeight: 600 }}
              type="text"
              inputMode="numeric"
              placeholder="000 000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button
              className="auth-modern-primary-btn"
              style={{ marginTop: 12, background: '#FF4614', color: '#fff', borderColor: '#FF4614' }}
              disabled={verifyPending}
              onClick={() => void handleVerifyEmailCode()}
            >
              {verifyPending ? "Verifying..." : "Verify & Sign In"}
            </button>
            <button
              className="auth-modern-primary-btn"
              style={{ marginTop: 8 }}
              onClick={() => setCodeRequested(false)}
            >
              Back
            </button>
          </div>
        )}
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
      <div className="auth-modern-screen" aria-live="polite">
        <div className="auth-modern-card" style={{ textAlign: "center" }}>
          <p className="auth-eyebrow">Agent Studio</p>
          <h1 className="auth-modern-logo">正在检查登录状态</h1>
          <p className="auth-modern-subtitle" style={{marginTop: 8}}>正在读取账号、组织和当前会话上下文。</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return <AuthEntryCard auth={auth} inviteToken={props.inviteToken} />;
  }

  if (adminEligible && view === "admin") {
    return (
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>管理控制台加载中...</p></div></div>}>
        <AdminShellLazy currentUser={auth.user} onOpenPortal={openPortal} onSignOut={() => void auth.signOut()} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>工作台加载中...</p></div></div>}>
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
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>公开链接加载中...</p></div></div>}>
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
