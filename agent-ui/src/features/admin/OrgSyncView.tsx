import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Space, Spin, Tag, Typography } from "antd";

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
    <Card className="admin-card antd-admin-card">
      <div className="admin-section-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            组织同步
          </Typography.Title>
          <Typography.Paragraph>支持全量、按部门和按用户补同步。</Typography.Paragraph>
        </div>
      </div>
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {config ? (
        <div className="admin-sync-meta">
          <Tag color={config.enabled ? "success" : "default"}>启用状态：{config.enabled ? "已启用" : "已关闭"}</Tag>
          <Tag color="processing">同步周期：{formatCadence(config.intervalMinutes)}</Tag>
        </div>
      ) : null}
      <section className="admin-form-section">
        <div className="admin-form-section-header">
          <h4>同步触发</h4>
          <p>支持全量、部门和用户级补同步；建议优先使用小范围同步。</p>
        </div>
        <div className="admin-trigger-grid">
          <Button type="primary" disabled={submitting} onClick={() => void handleTrigger(triggerFullOrgSync)}>
            立即全量同步
          </Button>
          <div className="admin-trigger-inline">
            <label className="field admin-trigger-field">
              <span className="field-label">部门 External ID</span>
              <Input
                aria-label="部门 External ID"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                placeholder="部门 External ID"
              />
              <small className="field-help">示例：`dept-rd`，用于增量补齐该部门人员和结构。</small>
            </label>
            <Button
              disabled={submitting || !departmentId.trim()}
              onClick={() => void handleTrigger(() => triggerDepartmentOrgSync(departmentId.trim()))}
            >
              按部门同步
            </Button>
          </div>
          <div className="admin-trigger-inline">
            <label className="field admin-trigger-field">
              <span className="field-label">用户 External ID</span>
              <Input
                aria-label="用户 External ID"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="用户 External ID"
              />
              <small className="field-help">示例：`ding-u1`，用于补齐单个用户信息。</small>
            </label>
            <Button
              disabled={submitting || !userId.trim()}
              onClick={() => void handleTrigger(() => triggerUserOrgSync(userId.trim()))}
            >
              按用户补同步
            </Button>
          </div>
        </div>
      </section>
      <div className="admin-job-list">
        <Typography.Title level={5} className="admin-card-subheading">
          同步任务
        </Typography.Title>
        <Space direction="vertical" size={10} className="admin-full-width">
          {jobs.map((job) => (
            <Card key={job.id} size="small" className="admin-list-card">
              <div className="admin-list-card-header">
                <div>
                  <Typography.Text strong>{job.id}</Typography.Text>
                  <Typography.Paragraph className="admin-card-meta">
                    {job.scopeType || "full"} / {job.status}
                  </Typography.Paragraph>
                </div>
                <span className="admin-job-time">{formatLocalTime(job.updatedAt || job.finishedAt || job.createdAt)}</span>
              </div>
              <Typography.Paragraph className="admin-job-summary">{summarize(job)}</Typography.Paragraph>
            </Card>
          ))}
        </Space>
      </div>
    </Card>
  );
}
