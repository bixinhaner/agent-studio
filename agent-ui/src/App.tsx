import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

const AdminShellLazy = lazy(() => import("./features/admin/AdminShell").then((module) => ({ default: module.AdminShell })));
const PortalShellLazy = lazy(() => import("./features/portal/PortalShell").then((module) => ({ default: module.PortalShell })));
const PublicSharePageLazy = lazy(() =>
  import("./features/public-share/PublicSharePage").then((module) => ({ default: module.PublicSharePage }))
);

type AppShellView = "portal" | "admin";

const ADMIN_HASH_PREFIX = "#admin/";

function canOpenAdmin(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

function extractPublicShareToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
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

function AppContent() {
  const auth = useAuth();
  const adminEligible = useMemo(() => canOpenAdmin(auth.user?.role), [auth.user?.role]);
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
          <p>正在从会话中读取当前用户。</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-eyebrow">Agent Studio</p>
          <h1>登录</h1>
          <p>当前会话未登录，请先完成统一身份认证。</p>
          {auth.error ? <p className="err-text">{auth.error}</p> : null}
          <button type="button" className="picker-btn" onClick={() => void auth.startSignIn()}>
            使用钉钉登录
          </button>
        </div>
      </div>
    );
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
  const publicShareToken =
    typeof window !== "undefined" ? extractPublicShareToken(window.location.pathname) : undefined;

  if (publicShareToken) {
    return (
      <Suspense fallback={<div className="auth-screen"><div className="auth-card"><p>公开链接加载中...</p></div></div>}>
        <PublicSharePageLazy token={publicShareToken} />
      </Suspense>
    );
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
