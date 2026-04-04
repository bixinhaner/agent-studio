import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Space, Spin, Tag, Typography, Progress } from "antd";
import { RefreshCcw, UserPlus, Building, Zap, Clock, FileJson, Activity } from "lucide-react";

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
    return JSON.stringify(job.summary, null, 2);
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

  const latestJob = jobs[0];
  const isRunning = latestJob?.status === "running";

  return (
    <Card className="admin-tree-card antd-admin-card" bordered={false} bodyStyle={{ padding: 0 }}>
      <div className="admin-tree-header" style={{ padding: '24px 24px 0 24px' }}>
        <Typography.Title level={4} style={{ margin: '0 0 8px 0', fontSize: 18 }}>
          同步中心
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          管理与身份提供商的同步任务状态与策略。
        </Typography.Paragraph>
      </div>

      <div className="admin-tree-container" style={{ padding: 24 }}>
        {loading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div> : null}
        {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} /> : null}
        
        {config && !loading && (
          <>
            <div className="admin-sync-dashboard">
              <div className="admin-sync-stat-card">
                <div className="admin-sync-stat-label"><Clock size={16} /> 自动化策略</div>
                <div className="admin-sync-stat-value" style={{ color: config.enabled ? 'var(--admin-color-text)' : 'var(--admin-color-subtle)' }}>
                  {config.enabled ? formatCadence(config.intervalMinutes) : "已关闭"}
                </div>
                <div style={{ marginTop: 'auto' }}>
                  <Tag color={config.enabled ? "success" : "default"} style={{ borderRadius: 12 }}>
                    {config.enabled ? "Enabled" : "Disabled"}
                  </Tag>
                </div>
              </div>

              <div className="admin-sync-stat-card">
                <div className="admin-sync-stat-label"><Activity size={16} /> 最近任务状态</div>
                {latestJob ? (
                  <>
                    <div className="admin-sync-stat-value">
                      {latestJob.status === "success" ? "同步成功" : latestJob.status === "running" ? "进行中" : "异常结束"}
                    </div>
                    <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--admin-color-subtle)' }}>
                      耗时: {latestJob.finishedAt ? `${Math.round((new Date(latestJob.finishedAt).getTime() - new Date(latestJob.createdAt || Date.now()).getTime()) / 1000)}s` : '--'}
                      <br/>
                      结束于: {formatLocalTime(latestJob.finishedAt)}
                    </div>
                  </>
                ) : (
                  <div className="admin-sync-stat-value" style={{ color: 'var(--admin-color-subtle)' }}>暂无记录</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 32 }}>
              <Typography.Title level={5} style={{ fontSize: 15, marginBottom: 16 }}>触发手动同步</Typography.Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Card size="small" style={{ borderRadius: 12, border: '1px solid var(--admin-color-border)', boxShadow: 'var(--admin-shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ padding: 8, background: 'var(--admin-color-bg)', borderRadius: 8 }}><Zap size={18} color="var(--admin-color-accent)" /></div>
                      <div>
                        <div style={{ fontWeight: 500 }}>全量同步</div>
                        <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)' }}>立即同步所有用户与组织架构信息</div>
                      </div>
                    </div>
                    <Button type="primary" loading={submitting || isRunning} onClick={() => handleTrigger(triggerFullOrgSync)}>
                      立即执行
                    </Button>
                  </div>
                </Card>

                <div style={{ display: 'flex', gap: 16 }}>
                  <Card size="small" style={{ flex: 1, borderRadius: 12, border: '1px solid var(--admin-color-border)', boxShadow: 'var(--admin-shadow-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ padding: 8, background: 'var(--admin-color-bg)', borderRadius: 8 }}><Building size={18} color="var(--admin-color-subtle)" /></div>
                      <div style={{ fontWeight: 500 }}>部门增量同步</div>
                    </div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input 
                        placeholder="输入部门 External ID (如 dept-rd)" 
                        value={departmentId}
                        onChange={e => setDepartmentId(e.target.value)}
                      />
                      <Button loading={submitting} disabled={!departmentId.trim()} onClick={() => handleTrigger(() => triggerDepartmentOrgSync(departmentId.trim()))}>
                        执行
                      </Button>
                    </Space.Compact>
                  </Card>

                  <Card size="small" style={{ flex: 1, borderRadius: 12, border: '1px solid var(--admin-color-border)', boxShadow: 'var(--admin-shadow-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ padding: 8, background: 'var(--admin-color-bg)', borderRadius: 8 }}><UserPlus size={18} color="var(--admin-color-subtle)" /></div>
                      <div style={{ fontWeight: 500 }}>用户增量同步</div>
                    </div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input 
                        placeholder="输入用户 External ID (如 ding-u1)" 
                        value={userId}
                        onChange={e => setUserId(e.target.value)}
                      />
                      <Button loading={submitting} disabled={!userId.trim()} onClick={() => handleTrigger(() => triggerUserOrgSync(userId.trim()))}>
                        执行
                      </Button>
                    </Space.Compact>
                  </Card>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Typography.Title level={5} style={{ fontSize: 15, margin: 0 }}>最近同步任务</Typography.Title>
                <Button type="text" icon={<RefreshCcw size={14} />} onClick={reload} loading={loading}>刷新列表</Button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {jobs.map((job) => (
                  <div key={job.id} className="admin-sync-job-item">
                    <div className="admin-sync-job-header">
                      <div className="admin-sync-job-title">
                        {job.status === "running" && <Spin size="small" />}
                        {job.scopeType === "full" ? "全量同步" : job.scopeType === "department" ? "部门同步" : "用户同步"}
                        <Tag color={job.status === 'success' ? 'success' : job.status === 'running' ? 'processing' : 'error'} style={{ borderRadius: 12, marginLeft: 8 }}>
                          {job.status}
                        </Tag>
                      </div>
                      <div className="admin-sync-job-meta">
                        {formatLocalTime(job.updatedAt || job.finishedAt || job.createdAt)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)', display: 'flex', gap: 16 }}>
                      <span>Task ID: <span style={{ fontFamily: 'monospace' }}>{job.id}</span></span>
                      <span>Target: {job.scopeType === "department" || job.scopeType === "user" ? (job as any).scopeValue || "Unknown" : "All"}</span>
                    </div>
                    {job.summary && (
                      <div className="admin-sync-job-summary">
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{summarize(job)}</pre>
                      </div>
                    )}
                  </div>
                ))}
                {jobs.length === 0 && <div style={{ textAlign: 'center', color: 'var(--admin-color-subtle)', padding: 24 }}>暂无同步任务记录</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
