import { useEffect, useState } from "react";
import { api } from "../../lib/api";

// 仅控制入口展示；已有任务绑定、离线检查及执行能力由原逻辑管理。
export function useLocalBridgeEntryVisibility(userId: string | undefined): boolean {
  const [state, setState] = useState({ userId: "", visible: false });
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ local_bridge_visible: boolean }>("/api/auth/portal-features", { cache: "no-store" });
        if (alive) setState({ userId, visible: result.local_bridge_visible === true });
      } catch {
        if (alive) setState({ userId, visible: false });
      } finally { pending = false; }
    };
    const onVisible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
  return Boolean(userId && state.userId === userId && state.visible);
}
