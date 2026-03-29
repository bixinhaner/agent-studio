import { useEffect, useState } from "react";

import {
  fetchOrgSyncConfig,
  fetchOrgSyncJobs,
  triggerDepartmentOrgSync,
  triggerFullOrgSync,
  triggerUserOrgSync
} from "./api";
import type { OrgSyncConfig, OrgSyncJob } from "./types";

function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "未执行";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function formatCadence(intervalMinutes: number): string {
  if (intervalMinutes === 24 * 60) return "每日同步";
  if (intervalMinutes % (24 * 60) === 0) return `每 ${intervalMinutes / (24 * 60)} 天同步`;
  if (intervalMinutes % 60 === 0) return `每 ${intervalMinutes / 60} 小时同步`;
  return `每 ${intervalMinutes} 分钟同步`;
}

function summarize(job: OrgSyncJob): string {
  if (!job.summary) return "无摘要";
  try {
    return JSON.stringify(job.summary);
  } catch {
    return "摘要不可用";
  }
}

export function OrgSyncView() {
  const [config, setConfig] = useState<OrgSyncConfig | null>(null);
  const [jobs, setJobs] = useState<OrgSyncJob[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  async function reload() {
    const [configResponse, jobsResponse] = await Promise.all([fetchOrgSyncConfig(), fetchOrgSyncJobs()]);
    setConfig(configResponse.orgSync);
    setJobs(jobsResponse.jobs);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [configResponse, jobsResponse] = await Promise.all([fetchOrgSyncConfig(), fetchOrgSyncJobs()]);
        if (!active) return;
        setConfig(configResponse.orgSync);
        setJobs(jobsResponse.jobs);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载组织同步信息失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function handleTrigger(run: () => Promise<unknown>) {
    setSubmitting(true);
    setErrorText("");
    try {
      await run();
      await reload();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "触发组织同步失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-card">
      <div className="admin-section-header">
        <div>
          <h2>组织同步</h2>
          <p>支持全量、按部门和按用户补同步。</p>
        </div>
      </div>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {config ? (
        <div className="admin-sync-meta">
          <span>启用状态：{config.enabled ? "已启用" : "已关闭"}</span>
          <span>同步周期：{formatCadence(config.intervalMinutes)}</span>
        </div>
      ) : null}
      <div className="admin-trigger-grid">
        <button type="button" className="admin-action-btn" disabled={submitting} onClick={() => void handleTrigger(triggerFullOrgSync)}>
          立即全量同步
        </button>
        <div className="admin-trigger-inline">
          <input
            aria-label="部门 External ID"
            className="field-input"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            placeholder="部门 External ID"
          />
          <button
            type="button"
            className="admin-secondary-btn"
            disabled={submitting || !departmentId.trim()}
            onClick={() => void handleTrigger(() => triggerDepartmentOrgSync(departmentId.trim()))}
          >
            按部门同步
          </button>
        </div>
        <div className="admin-trigger-inline">
          <input
            aria-label="用户 External ID"
            className="field-input"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="用户 External ID"
          />
          <button
            type="button"
            className="admin-secondary-btn"
            disabled={submitting || !userId.trim()}
            onClick={() => void handleTrigger(() => triggerUserOrgSync(userId.trim()))}
          >
            按用户补同步
          </button>
        </div>
      </div>
      <div className="admin-job-list">
        <h3>同步任务</h3>
        {jobs.map((job) => (
          <article key={job.id} className="admin-list-card">
            <div className="admin-list-card-header">
              <div>
                <h4>{job.id}</h4>
                <p>
                  {job.scopeType || "full"} / {job.status}
                </p>
              </div>
              <span className="admin-job-time">{formatLocalTime(job.updatedAt || job.finishedAt || job.createdAt)}</span>
            </div>
            <p className="admin-job-summary">{summarize(job)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
