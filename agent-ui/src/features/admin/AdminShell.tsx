import { useEffect, useState } from "react";

import { api } from "../../lib/api";

type AdminOverview = {
  counts: {
    users: number;
    threads: number;
    activeSessions: number;
  };
};

export function AdminShell() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await api<AdminOverview>("/api/admin/overview");
        if (active) setOverview(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载管理概览失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="admin-shell">
      <section className="admin-card">
        <p className="auth-eyebrow">Agent Studio Admin</p>
        <h1>管理控制台</h1>
        <p className="admin-description">查看整体用户、线程和活跃会话概览。</p>
      </section>
      <section className="admin-card">
        <h2>运行概览</h2>
        {loading ? <p>加载中...</p> : null}
        {errorText ? <p className="err-text">{errorText}</p> : null}
        {overview ? (
          <dl className="admin-metrics">
            <div>
              <dt>用户</dt>
              <dd>{overview.counts.users}</dd>
            </div>
            <div>
              <dt>线程</dt>
              <dd>{overview.counts.threads}</dd>
            </div>
            <div>
              <dt>活跃会话</dt>
              <dd>{overview.counts.activeSessions}</dd>
            </div>
          </dl>
        ) : null}
      </section>
    </div>
  );
}

export default AdminShell;
