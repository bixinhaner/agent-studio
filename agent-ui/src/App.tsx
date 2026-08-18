import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { BuildingIcon } from "lucide-react";

import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { fetchInvite, type AuthInvite } from "./features/auth/api";
import {
  readPreferredAuthEntryMode,
  rememberPreferredAuthEntryMode,
  type AuthEntryMode
} from "./features/auth/auth-entry-preference";
import { BrandMark } from "./features/branding/BrandMark";
import { BrandingProvider, useBranding } from "./features/branding/BrandingProvider";
import { PortalI18nProvider, usePortalI18n } from "./features/portal/i18n";
import { canAccessPortalTraining } from "./features/portal/training-access";
import { fetchPublicExternalWebAccessState } from "./features/external-web-access/api";
import { MaintenancePage } from "./features/external-web-access/MaintenancePage";
import { EXTERNAL_WEB_MAINTENANCE_EVENT } from "./lib/api";
import "./features/auth/auth.css";

const AdminShellLazy = lazy(() => import("./features/admin/AdminShell").then((module) => ({ default: module.AdminShell })));
const PublicAccessRequestPageLazy = lazy(() =>
  import("./features/access-requests/PublicAccessRequestPage").then((module) => ({ default: module.PublicAccessRequestPage }))
);
const ReviewAccessRequestPageLazy = lazy(() =>
  import("./features/access-requests/ReviewAccessRequestPage").then((module) => ({ default: module.ReviewAccessRequestPage }))
);
const AiResponseReviewPageLazy = lazy(() =>
  import("./features/ai-reviews/AiResponseReviewPage").then((module) => ({ default: module.AiResponseReviewPage }))
);
const PortalShellLazy = lazy(() => import("./features/portal/PortalShell").then((module) => ({ default: module.PortalShell })));
const PublicSharePageLazy = lazy(() =>
  import("./features/public-share/PublicSharePage").then((module) => ({ default: module.PublicSharePage }))
);

function PortalLoadingFallback() {
  const { t } = usePortalI18n();
  return <div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>{t("common.loadingWorkspace")}</p></div></div>;
}

function AccessStateLoadingFallback() {
  return <main className="auth-modern-screen" aria-busy="true" />;
}

function PublicShareRoute(props: {
  token: string;
  externalWebAccessLoading: boolean;
  externalWebMaintenanceEnabled: boolean;
}) {
  const auth = useAuth();
  const isInternalActor =
    auth.user?.userType !== "external_user" &&
    auth.activeOrganization?.type === "internal";

  if (
    props.externalWebAccessLoading ||
    (props.externalWebMaintenanceEnabled && auth.loading)
  ) {
    return <AccessStateLoadingFallback />;
  }
  if (props.externalWebMaintenanceEnabled && !isInternalActor) {
    return <MaintenancePage />;
  }
  return (
    <Suspense fallback={<AccessStateLoadingFallback />}>
      <PublicSharePageLazy token={props.token} />
    </Suspense>
  );
}

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

function extractAccessRequestToken(pathname: string): string | null | undefined {
  if (/^\/access\/apply\/?$/.test(pathname)) return null;
  const match = pathname.match(/^\/access\/apply\/([^/]+)\/?$/);
  if (!match) return undefined;
  const token = decodeURIComponent(match[1] || "");
  return token || null;
}

function extractAccessRequestReviewId(pathname: string): string | undefined {
  const match = pathname.match(/^\/review\/access-requests\/([^/]+)\/?$/);
  const requestId = match ? decodeURIComponent(match[1] || "") : "";
  return requestId || undefined;
}

function extractAiResponseReviewId(pathname: string): string | undefined {
  const match = pathname.match(/^\/review\/ai-response\/([^/]+)\/?$/);
  const reviewId = match ? decodeURIComponent(match[1] || "") : "";
  return reviewId || undefined;
}

function isInternalLoginPath(pathname: string): boolean {
  return /^\/login\/internal\/?$/.test(pathname);
}

function isTrainingPath(pathname: string): boolean {
  return /^\/training\/?$/.test(pathname);
}

function isNeutralAuthEntryPath(pathname: string): boolean {
  return /^\/?$/.test(pathname) || /^\/login\/?$/.test(pathname) || isInternalLoginPath(pathname);
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
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function replaceLocationPath(nextPathname: string): void {
  if (typeof window === "undefined") return;
  const normalizedPathname = nextPathname.trim() || "/";
  window.history.replaceState(
    window.history.state,
    document.title,
    `${normalizedPathname}${window.location.search}${window.location.hash}`
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
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
      return "Employee";
    default:
      return value?.trim() || "";
  }
}

function AuthEntryCard(props: { auth: ReturnType<typeof useAuth>; inviteToken?: string; mode: AuthEntryMode }) {
  const { brand, branding } = useBranding();
  const [invite, setInvite] = useState<AuthInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(props.inviteToken));
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [entryNotice, setEntryNotice] = useState<string | null>(null);
  const [codeRequested, setCodeRequested] = useState(false);
  const [accessHelpOpen, setAccessHelpOpen] = useState(false);
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
        setInviteError(error instanceof Error ? error.message : "Failed to load invitation");
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
  const activeInviteToken = routeInvitePending;
  const resolvedEmail = email.trim() || fallbackEmail;
  const isInviteFlow = Boolean(props.inviteToken);
  const isInternalMode = props.mode === "internal" && !isInviteFlow;
  const eyebrow = isInviteFlow ? "Customer Invite" : isInternalMode ? "Internal Employee Sign-In" : "";
  const subtitle = isInviteFlow
    ? "Use your work email to accept the invitation and enter your organization."
    : isInternalMode
      ? branding.internalLoginCopy
      : branding.externalLoginCopy;
  const inviteStatusText =
    invite?.status === "pending"
      ? "Pending acceptance"
      : invite?.status === "accepted"
        ? "Accepted"
        : invite?.status === "expired"
          ? "Expired"
          : "";

  async function handleRequestEmailCode() {
    setFormError(null);
    setEntryNotice(null);
    props.auth.clearError();
    if (!resolvedEmail) {
      setFormError("Enter your email address.");
      return;
    }

    setRequestPending(true);
    try {
      const response = await props.auth.requestEmailSignIn({
        email: resolvedEmail || undefined,
        inviteToken: activeInviteToken
      });
      if (response.authEntry === "internal") {
        rememberPreferredAuthEntryMode("internal");
        setEmail(resolvedEmail);
        setEmailHint(response.emailHint ?? null);
        setCodeRequested(false);
        setCode("");
        setAccessHelpOpen(false);
        setEntryNotice("This email belongs to an internal employee account. Use DingTalk single sign-on to continue.");
        replaceLocationPath(response.redirectPath || "/login/internal");
        return;
      }
      if (resolvedEmail) {
        setEmail(resolvedEmail);
      }
      if (response.challengeId) {
        setEmailHint(response.emailHint ?? invite?.emailHint ?? (resolvedEmail || null));
        setCodeRequested(true);
        setCode("");
        setAccessHelpOpen(false);
      } else {
        setCodeRequested(false);
        setCode("");
        setAccessHelpOpen(true);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to send verification code");
    } finally {
      setRequestPending(false);
    }
  }

  async function handleVerifyEmailCode() {
    setFormError(null);
    props.auth.clearError();
    if (!resolvedEmail) {
      setFormError("Enter your email address.");
      return;
    }
    if (!code.trim()) {
      setFormError("Enter the verification code.");
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
      setFormError(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setVerifyPending(false);
    }
  }

  return (
    <div className="auth-modern-screen">
      <div className="auth-modern-card">
        <div className="auth-modern-header">
          {eyebrow ? <p className="auth-modern-kicker">{eyebrow}</p> : null}
          <BrandMark
            className="auth-modern-brand-mark"
            imageClassName="auth-modern-brand-image"
            name={branding.platformName}
            logoUrl={branding.logoUrl || branding.iconUrl}
          />
          <p className="auth-modern-subtitle">{subtitle}</p>
        </div>

        {inviteLoading ? (
          <div className="auth-modern-invite">Loading invitation details...</div>
        ) : invite ? (
          <div className="auth-modern-invite">
            <BuildingIcon size={16} style={{ marginRight: 6 }} />
            <span>
              <strong>{invite.organization.name}</strong> invited you to join
              {inviteStatusText ? ` (${inviteStatusText})` : ""}
            </span>
          </div>
        ) : null}

        {inviteError && <p className="err-text" style={{margin:0,textAlign:'center'}}>{inviteError}</p>}
        {props.auth.error && <p className="err-text" style={{margin:0,textAlign:'center'}}>{props.auth.error}</p>}
        {formError && <p className="err-text" style={{margin:0,textAlign:'center'}}>{formError}</p>}

        {!codeRequested && !isInternalMode ? (
          <div className="auth-modern-field auth-modern-fade-enter">
            <input
              className="auth-modern-input"
              type="email"
              placeholder="Email address"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEntryNotice(null);
              }}
            />

            <button
              className="auth-modern-accent-btn"
              style={{ marginTop: 8 }}
              disabled={requestPending}
              onClick={() => void handleRequestEmailCode()}
            >
              {requestPending ? "Sending..." : "Continue with Email"}
            </button>
            {!props.inviteToken && brand.accessRequestEnabled ? (
              <button className="auth-modern-dropdown-link" onClick={() => replaceLocationPath("/access/apply")}>
                Apply for Trial Access
              </button>
            ) : null}
          </div>
        ) : !codeRequested ? (
          <div className="auth-modern-field auth-modern-fade-enter">
            <button
              className="auth-modern-sso-btn"
              onClick={() => void props.auth.startSignIn()}
            >
              Continue with DingTalk
            </button>
            <p className="auth-modern-hint">
              {entryNotice || "Use DingTalk single sign-on to access the internal workspace and control console."}
            </p>
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
              className="auth-modern-accent-btn"
              style={{ marginTop: 12 }}
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
      {accessHelpOpen ? (
        <div className="auth-access-modal-mask" onClick={() => setAccessHelpOpen(false)}>
          <div
            className="auth-access-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-access-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="auth-access-modal-head">
              <h2 id="auth-access-modal-title">Access Not Ready</h2>
              <button
                type="button"
                className="auth-access-modal-close"
                aria-label="Close access help dialog"
                onClick={() => setAccessHelpOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="auth-access-modal-copy">
              This email does not have active access yet. Ask your administrator to resend the invite, or apply for
              trial access.
            </p>
            <div className="auth-access-modal-actions">
              {brand.accessRequestEnabled ? (
                <button
                  type="button"
                  className="auth-modern-sso-btn auth-access-modal-primary"
                  onClick={() => {
                    setAccessHelpOpen(false);
                    replaceLocationPath("/access/apply");
                  }}
                >
                  Apply for Trial Access
                </button>
              ) : null}
              <button
                type="button"
                className="auth-modern-primary-btn"
                onClick={() => setAccessHelpOpen(false)}
              >
                Back to Sign In
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AppContent(props: {
  pathname: string;
  inviteToken?: string;
  reviewRequestId?: string;
  aiResponseReviewId?: string;
  authMode: AuthEntryMode;
  externalWebMaintenanceEnabled: boolean;
  externalWebAccessLoading: boolean;
}) {
  const auth = useAuth();
  const { brand, branding } = useBranding();
  const adminEligible = useMemo(
    () => !brand.externalOnly && canOpenAdmin(auth.user?.role, auth.activeOrganization?.type),
    [auth.activeOrganization?.type, auth.user?.role, brand.externalOnly]
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
        if (typeof window === "undefined") return;
        const nextUrl = new URL(window.location.href);
        nextUrl.hash = `${ADMIN_HASH_PREFIX}analytics`;
        const nextWindow = window.open(nextUrl.toString(), "_blank", "noopener,noreferrer");
        nextWindow?.focus?.();
      }
    : undefined;

  const openPortal = () => {
    if (typeof window !== "undefined" && window.location.hash.startsWith(ADMIN_HASH_PREFIX)) {
      replaceLocationHash("");
    }
    setView("portal");
  };
  const effectiveAuthMode: AuthEntryMode = brand.externalOnly
    ? "external"
    : !props.inviteToken &&
        !props.reviewRequestId &&
        !props.aiResponseReviewId &&
        isNeutralAuthEntryPath(props.pathname) &&
        readPreferredAuthEntryMode() === "internal"
      ? "internal"
      : props.authMode;
  const isExternalWebActor =
    auth.user?.userType === "external_user" ||
    auth.activeOrganization?.type === "customer";
  const trainingMode = isTrainingPath(props.pathname);
  const trainingAccessAllowed = canAccessPortalTraining({
    userType: auth.user?.userType,
    organizationType: auth.activeOrganization?.type
  });
  const openTraining = trainingMode || !trainingAccessAllowed
    ? undefined
    : () => {
        if (typeof window === "undefined") return;
        const nextUrl = new URL("/training", window.location.origin);
        const nextWindow = window.open(nextUrl.toString(), "_blank", "noopener,noreferrer");
        nextWindow?.focus?.();
      };
  const exitTraining = trainingMode
    ? () => replaceLocationPath("/login/internal")
    : undefined;

  useEffect(() => {
    if (auth.loading || !auth.user || !trainingMode || trainingAccessAllowed) return;
    replaceLocationPath("/");
  }, [auth.loading, auth.user, trainingAccessAllowed, trainingMode]);

  useEffect(() => {
    if (auth.loading || auth.user) return;
    if (effectiveAuthMode !== "internal") return;
    if (!isNeutralAuthEntryPath(props.pathname) || isInternalLoginPath(props.pathname)) return;
    replaceLocationPath("/login/internal");
  }, [auth.loading, auth.user, effectiveAuthMode, props.pathname]);

  if (props.externalWebAccessLoading && !isInternalLoginPath(props.pathname)) {
    return <AccessStateLoadingFallback />;
  }

  if (
    props.externalWebMaintenanceEnabled &&
    !isInternalLoginPath(props.pathname) &&
    auth.loading
  ) {
    return <AccessStateLoadingFallback />;
  }

  if (
    props.externalWebMaintenanceEnabled &&
    (
      isExternalWebActor ||
      (!auth.user && effectiveAuthMode === "external")
    )
  ) {
    return <MaintenancePage />;
  }

  if (auth.loading) {
    return (
      <div className="auth-modern-screen" aria-live="polite">
        <div className="auth-modern-card" style={{ textAlign: "center" }}>
          <p className="auth-eyebrow">{branding.platformName}</p>
          <h1 className="auth-modern-logo">Checking sign-in status</h1>
          <p className="auth-modern-subtitle" style={{marginTop: 8}}>Loading account, organization, and active session context.</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return <AuthEntryCard auth={auth} inviteToken={props.inviteToken} mode={effectiveAuthMode} />;
  }

  if (trainingMode && !trainingAccessAllowed) {
    return <AccessStateLoadingFallback />;
  }

  if (props.reviewRequestId) {
    return (
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>Loading review...</p></div></div>}>
        <ReviewAccessRequestPageLazy requestId={props.reviewRequestId} />
      </Suspense>
    );
  }

  if (props.aiResponseReviewId) {
    return (
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>Loading AI review...</p></div></div>}>
        <AiResponseReviewPageLazy reviewId={props.aiResponseReviewId} />
      </Suspense>
    );
  }

  if (adminEligible && view === "admin") {
    return (
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>管理控制台加载中...</p></div></div>}>
        <AdminShellLazy currentUser={auth.user} onOpenPortal={openPortal} onSignOut={() => void auth.signOut()} />
      </Suspense>
    );
  }

  return (
    <PortalI18nProvider>
      <Suspense fallback={<PortalLoadingFallback />}>
        <PortalShellLazy
          currentUser={auth.user}
          onOpenAdmin={openAdmin}
          onSignOut={() => void auth.signOut()}
          trainingReadOnly={trainingMode}
          onOpenTraining={openTraining}
          onExitTraining={exitTraining}
        />
      </Suspense>
    </PortalI18nProvider>
  );
}

function AppRoutes() {
  const [pathname, setPathname] = useState(() => (typeof window !== "undefined" ? window.location.pathname : "/"));
  const [externalWebAccessLoading, setExternalWebAccessLoading] = useState(true);
  const [externalWebMaintenanceEnabled, setExternalWebMaintenanceEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPathname);
    return () => {
      window.removeEventListener("popstate", syncPathname);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh(completeInitialLoad = false) {
      try {
        const state = await fetchPublicExternalWebAccessState();
        if (active) {
          setExternalWebMaintenanceEnabled(state.maintenanceEnabled);
        }
      } catch {
        // API enforcement remains authoritative; keep internal sign-in reachable.
      } finally {
        if (active && completeInitialLoad) {
          setExternalWebAccessLoading(false);
        }
      }
    }
    void refresh(true);
    const refreshInterval = window.setInterval(() => {
      void refresh();
    }, 10_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    const handleMaintenance = () => {
      setExternalWebMaintenanceEnabled(true);
      setExternalWebAccessLoading(false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener(EXTERNAL_WEB_MAINTENANCE_EVENT, handleMaintenance);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener(EXTERNAL_WEB_MAINTENANCE_EVENT, handleMaintenance);
    };
  }, []);

  const publicShareToken = extractPublicShareToken(pathname);
  const inviteToken = extractInviteToken(pathname);
  const accessRequestToken = extractAccessRequestToken(pathname);
  const reviewRequestId = extractAccessRequestReviewId(pathname);
  const aiResponseReviewId = extractAiResponseReviewId(pathname);
  const authMode: AuthEntryMode =
    reviewRequestId ||
    aiResponseReviewId ||
    isInternalLoginPath(pathname) ||
    isTrainingPath(pathname) ||
    (isNeutralAuthEntryPath(pathname) && readPreferredAuthEntryMode() === "internal")
      ? "internal"
      : "external";

  if (publicShareToken) {
    return (
      <AuthProvider>
        <PublicShareRoute
          token={publicShareToken}
          externalWebAccessLoading={externalWebAccessLoading}
          externalWebMaintenanceEnabled={externalWebMaintenanceEnabled}
        />
      </AuthProvider>
    );
  }

  if (externalWebAccessLoading && accessRequestToken !== undefined) {
    return <AccessStateLoadingFallback />;
  }

  if (externalWebMaintenanceEnabled && accessRequestToken !== undefined) {
    return <MaintenancePage />;
  }

  if (accessRequestToken !== undefined) {
    return (
      <Suspense fallback={<div className="auth-modern-screen"><div className="auth-modern-card"><p className="auth-modern-subtitle" style={{textAlign:"center"}}>Loading access request...</p></div></div>}>
        <PublicAccessRequestPageLazy token={accessRequestToken ?? undefined} />
      </Suspense>
    );
  }

  return (
    <AuthProvider>
      <AppContent
        pathname={pathname}
        inviteToken={inviteToken}
        reviewRequestId={reviewRequestId}
        aiResponseReviewId={aiResponseReviewId}
        authMode={authMode}
        externalWebMaintenanceEnabled={externalWebMaintenanceEnabled}
        externalWebAccessLoading={externalWebAccessLoading}
      />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrandingProvider>
      <AppRoutes />
    </BrandingProvider>
  );
}
