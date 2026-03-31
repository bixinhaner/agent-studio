import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { AdminShell } from "./features/admin/AdminShell";
import { PortalShell } from "./features/portal/PortalShell";
import { useEffect, useMemo, useState } from "react";

type AppShellView = "portal" | "admin";

function canOpenAdmin(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

function AppContent() {
  const auth = useAuth();
  const adminEligible = useMemo(() => canOpenAdmin(auth.user?.role), [auth.user?.role]);
  const [view, setView] = useState<AppShellView>("portal");

  useEffect(() => {
    setView("portal");
  }, [auth.user?.id]);

  useEffect(() => {
    if (!adminEligible && view === "admin") {
      setView("portal");
    }
  }, [adminEligible, view]);

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
    return <AdminShell currentUser={auth.user} onOpenPortal={() => setView("portal")} />;
  }

  return <PortalShell currentUser={auth.user} onOpenAdmin={adminEligible ? () => setView("admin") : undefined} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
