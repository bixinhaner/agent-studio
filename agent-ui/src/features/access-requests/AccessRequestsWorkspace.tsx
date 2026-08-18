import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import {
  accessRequestFileUrl,
  fetchAdminAccessRequestDetail,
  fetchAdminAccessRequestWorkspace,
  patchAdminAccessRequest,
  provisionAdminAccessRequest,
  rejectAdminAccessRequest,
  requestAdminAccessRequestNeedsInfo,
  sendAdminAccessRequestReview,
  updateAdminAccessRequestPolicy
} from "./api";
import {
  deliveryTypeLabel,
  formatFileSize,
  formatLocalDate,
  formatLocalTime,
  membershipTypeLabel,
  rejectionModeLabel,
  requestStatusLabel,
  requestStatusTone,
  reviewModeLabel,
  reviewerDecisionLabel,
  reviewerDecisionTone
} from "./presentation";
import type {
  AdminAccessRequestDetail,
  AccessRequestPolicy,
  AdminAccessRequestProvisionInput,
  AdminAccessRequestSummary,
  AccessRequestWorkspaceLookups
} from "./types";
import "./access-request.css";

type WorkspaceTab = "request" | "review" | "provision" | "activity";

type RequestDraft = {
  ownerUserId?: string | null;
  adminNote?: string;
  requestedPlanId?: string | null;
  approvedPlanId?: string | null;
};

type ReviewDraft = {
  reviewMode: "any_to_approve" | "all_to_approve" | "minimum_approvals";
  minimumApprovals?: number | null;
  rejectionMode: "any_to_reject" | "manual_on_conflict";
  reviewers: Array<{
    reviewerEmail: string;
    reviewerUserId?: string | null;
    deliveryType: "to" | "cc";
  }>;
};

type ProvisionDraft = AdminAccessRequestProvisionInput;

type PolicyDraft = {
  internalEmailDomainsText: string;
  blockedApplicantEmailDomainsText: string;
  defaultTrialDays: number;
};

function createRequestDraft(detail?: AdminAccessRequestDetail | null): RequestDraft {
  return {
    ownerUserId: detail?.owner?.id ?? null,
    adminNote: detail?.adminNote ?? "",
    requestedPlanId: detail?.requestedPlan?.id ?? null,
    approvedPlanId: detail?.approvedPlan?.id ?? detail?.requestedPlan?.id ?? null
  };
}

function createReviewDraft(detail?: AdminAccessRequestDetail | null): ReviewDraft {
  return {
    reviewMode: (detail?.reviewMode as ReviewDraft["reviewMode"]) ?? "any_to_approve",
    minimumApprovals: detail?.minimumApprovals ?? null,
    rejectionMode: (detail?.rejectionMode as ReviewDraft["rejectionMode"]) ?? "any_to_reject",
    reviewers:
      detail?.reviewersList.map((reviewer) => ({
        reviewerEmail: reviewer.reviewerEmail,
        reviewerUserId: reviewer.reviewerUserId ?? null,
        deliveryType: reviewer.deliveryType === "cc" ? "cc" : "to"
      })) ?? []
  };
}

function toDatetimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function createProvisionDraft(detail?: AdminAccessRequestDetail | null): ProvisionDraft {
  return {
    targetMode: detail?.targetOrganization ? "existing_organization" : "new_organization",
    organizationName: detail?.targetOrganization?.name ?? detail?.companyName ?? "",
    organizationId: detail?.targetOrganization?.id,
    membershipType: "customer_admin",
    planId: detail?.approvedPlan?.id ?? detail?.requestedPlan?.id ?? undefined,
    startsAt: "",
    expiresAt: "",
    cycleAnchorAt: "",
    completedTurnLimitOverride: null,
    tokenLimitOverride: null,
    note: ""
  };
}

function summarizeDetail(detail: AdminAccessRequestDetail): AdminAccessRequestSummary {
  const {
    deviceInfoText: _deviceInfoText,
    customerNote: _customerNote,
    adminNote: _adminNote,
    reviewSummary: _reviewSummary,
    rejectionReason: _rejectionReason,
    publicAccessUrl: _publicAccessUrl,
    reviewersList: _reviewersList,
    events: _events,
    ...summary
  } = detail;
  return summary;
}

function normalizeIsoOrNull(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatPolicyList(values: string[]): string {
  return values.join("\n");
}

function parsePolicyList(value: string): string[] {
  const segments = value
    .split(/[\n,]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(segments)];
}

function createPolicyDraft(policy?: AccessRequestPolicy | null): PolicyDraft {
  return {
    internalEmailDomainsText: formatPolicyList(policy?.internalEmailDomains ?? []),
    blockedApplicantEmailDomainsText: formatPolicyList(policy?.blockedApplicantEmailDomains ?? []),
    defaultTrialDays: policy?.defaultTrialDays ?? 14
  };
}

export function AccessRequestsWorkspace() {
  const isNarrowScreen = useIsNarrowScreen(1180);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [requests, setRequests] = useState<AdminAccessRequestSummary[]>([]);
  const [lookups, setLookups] = useState<AccessRequestWorkspaceLookups>({
    reviewerCandidates: [],
    organizations: [],
    plans: []
  });
  const [policy, setPolicy] = useState<AccessRequestPolicy | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(createPolicyDraft());
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("request");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<AdminAccessRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(createRequestDraft());
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>(createReviewDraft());
  const [provisionDraft, setProvisionDraft] = useState<ProvisionDraft>(createProvisionDraft());
  const [savingRequest, setSavingRequest] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [sendingReview, setSendingReview] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [needsInfoOpen, setNeedsInfoOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [needsInfoMessage, setNeedsInfoMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [postingNeedsInfo, setPostingNeedsInfo] = useState(false);
  const [postingReject, setPostingReject] = useState(false);

  async function loadWorkspace(silent = false) {
    if (!silent) setLoading(true);
    setRefreshing(silent);
    setErrorText("");
    try {
      const data = await fetchAdminAccessRequestWorkspace({
        status: statusFilter === "all" ? undefined : statusFilter,
        query
      });
      setRequests(data.requests);
      setLookups(data.lookups);
      setPolicy(data.policy);
      setPolicyDraft(createPolicyDraft(data.policy));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load access requests");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleSavePolicy() {
    const internalEmailDomains = parsePolicyList(policyDraft.internalEmailDomainsText);
    if (!internalEmailDomains.length) {
      setErrorText("至少保留一个内部邮箱域名。");
      setSuccessText("");
      return;
    }
    setSavingPolicy(true);
    setErrorText("");
    setSuccessText("");
    try {
      const nextPolicy = await updateAdminAccessRequestPolicy({
        internalEmailDomains,
        blockedApplicantEmailDomains: parsePolicyList(policyDraft.blockedApplicantEmailDomainsText),
        defaultTrialDays: Math.max(1, Number(policyDraft.defaultTrialDays || 14))
      });
      setPolicy(nextPolicy);
      setPolicyDraft(createPolicyDraft(nextPolicy));
      setPolicyDrawerOpen(false);
      setSuccessText("访问申请规则已保存。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to save access request policy");
    } finally {
      setSavingPolicy(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function openRequest(requestId: string) {
    setDrawerOpen(true);
    setSelectedRequestId(requestId);
    setDetailLoading(true);
    setErrorText("");
    try {
      const detail = await fetchAdminAccessRequestDetail(requestId);
      setSelectedRequest(detail);
      setRequestDraft(createRequestDraft(detail));
      setReviewDraft(createReviewDraft(detail));
      setProvisionDraft(createProvisionDraft(detail));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load request detail");
    } finally {
      setDetailLoading(false);
    }
  }

  function applyDetail(nextDetail: AdminAccessRequestDetail, successMessage?: string) {
    setSelectedRequest(nextDetail);
    setRequestDraft(createRequestDraft(nextDetail));
    setReviewDraft(createReviewDraft(nextDetail));
    setProvisionDraft(createProvisionDraft(nextDetail));
    setRequests((current) =>
      current.map((item) => (item.id === nextDetail.id ? summarizeDetail(nextDetail) : item))
    );
    if (successMessage) setSuccessText(successMessage);
  }

  async function handleSaveRequestDraft() {
    if (!selectedRequest) return;
    setSavingRequest(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await patchAdminAccessRequest(selectedRequest.id, {
        ownerUserId: requestDraft.ownerUserId ?? null,
        adminNote: requestDraft.adminNote?.trim() || null,
        requestedPlanId: requestDraft.requestedPlanId ?? null,
        approvedPlanId: requestDraft.approvedPlanId ?? null
      });
      applyDetail(detail, "申请配置已保存。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to save request settings");
    } finally {
      setSavingRequest(false);
    }
  }

  async function handleSaveReviewDraft() {
    if (!selectedRequest) return;
    setSavingReview(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await patchAdminAccessRequest(selectedRequest.id, {
        reviewMode: reviewDraft.reviewMode,
        minimumApprovals: reviewDraft.reviewMode === "minimum_approvals" ? reviewDraft.minimumApprovals ?? 1 : null,
        rejectionMode: reviewDraft.rejectionMode,
        reviewers: reviewDraft.reviewers
      });
      applyDetail(detail, "审核路由已保存。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to save review settings");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleSendReview() {
    if (!selectedRequest) return;
    setSendingReview(true);
    setErrorText("");
    setSuccessText("");
    try {
      const savedDetail = await patchAdminAccessRequest(selectedRequest.id, {
        reviewMode: reviewDraft.reviewMode,
        minimumApprovals: reviewDraft.reviewMode === "minimum_approvals" ? reviewDraft.minimumApprovals ?? 1 : null,
        rejectionMode: reviewDraft.rejectionMode,
        reviewers: reviewDraft.reviewers
      });
      applyDetail(savedDetail);
      const detail = await sendAdminAccessRequestReview(selectedRequest.id);
      applyDetail(detail, "审核邮件已发送。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to send review request");
    } finally {
      setSendingReview(false);
    }
  }

  async function handleProvision() {
    if (!selectedRequest) return;
    setProvisioning(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await provisionAdminAccessRequest(selectedRequest.id, {
        ...provisionDraft,
        startsAt: normalizeIsoOrNull(provisionDraft.startsAt),
        expiresAt: normalizeIsoOrNull(provisionDraft.expiresAt),
        cycleAnchorAt: normalizeIsoOrNull(provisionDraft.cycleAnchorAt)
      });
      applyDetail(detail, "套餐已开通，邀请已发送。");
      setActiveTab("activity");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to provision access request");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleNeedsInfoSubmit() {
    if (!selectedRequest) return;
    setPostingNeedsInfo(true);
    setErrorText("");
    try {
      const detail = await requestAdminAccessRequestNeedsInfo(selectedRequest.id, needsInfoMessage);
      applyDetail(detail, "已发送补资料通知。");
      setNeedsInfoOpen(false);
      setNeedsInfoMessage("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to request more information");
    } finally {
      setPostingNeedsInfo(false);
    }
  }

  async function handleRejectSubmit() {
    if (!selectedRequest) return;
    setPostingReject(true);
    setErrorText("");
    try {
      const detail = await rejectAdminAccessRequest(selectedRequest.id, rejectReason);
      applyDetail(detail, "申请已拒绝。");
      setRejectOpen(false);
      setRejectReason("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to reject access request");
    } finally {
      setPostingReject(false);
    }
  }

  const columns = useMemo<ColumnsType<AdminAccessRequestSummary>>(
    () => [
      {
        title: "状态",
        dataIndex: "status",
        width: 110,
        render: (value: string) => <Tag color={requestStatusTone(value)}>{requestStatusLabel(value)}</Tag>
      },
      {
        title: "品牌入口",
        key: "publicBrand",
        width: 120,
        render: (_, record) => <Tag color={record.publicBrand ? "blue" : "default"}>{record.publicBrand?.name ?? "未归属品牌"}</Tag>
      },
      {
        title: "公司 / 申请人",
        key: "company",
        render: (_, record) => (
          <div>
            <div className="access-admin-cell-title">{record.companyName}</div>
            <div className="access-admin-cell-subtitle">{record.applicantEmail}</div>
          </div>
        )
      },
      {
        title: "销售联系人",
        dataIndex: "salesContactEmail",
        width: 220
      },
      {
        title: "审核",
        key: "reviewers",
        width: 180,
        render: (_, record) => (
          <div className="access-admin-cell-subtitle">
            <div>{record.reviewers.pendingCount} pending</div>
            <div>{record.reviewers.approvedCount} approved</div>
          </div>
        )
      },
      {
        title: "目标组织 / 套餐",
        key: "target",
        width: 220,
        render: (_, record) => (
          <div>
            <div className="access-admin-cell-title">{record.targetOrganization?.name ?? "未开通"}</div>
            <div className="access-admin-cell-subtitle">{record.approvedPlan?.name ?? record.requestedPlan?.name ?? "未选套餐"}</div>
          </div>
        )
      },
      {
        title: "更新时间",
        dataIndex: "updatedAt",
        width: 180,
        render: (value: string) => formatLocalTime(value)
      }
    ],
    []
  );

  return (
    <section className="access-admin-workspace">
      <div className="access-admin-toolbar">
        <Space wrap size={12}>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "submitted", label: "已提交" },
              { value: "under_review", label: "审核中" },
              { value: "needs_info", label: "待补资料" },
              { value: "approved_pending_provision", label: "待开通" },
              { value: "invited", label: "已发邀请" },
              { value: "activated", label: "已激活" },
              { value: "rejected", label: "已拒绝" }
            ]}
            style={{ minWidth: 160 }}
          />
          <Input.Search
            allowClear
            placeholder="公司 / 邮箱 / PO"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={() => void loadWorkspace()}
            style={{ width: 280 }}
          />
          <Button icon={<RefreshCw size={16} />} onClick={() => void loadWorkspace(true)} loading={refreshing}>
            刷新
          </Button>
        </Space>
        <Space wrap size={12}>
          <Button
            onClick={() => {
              setPolicyDraft(createPolicyDraft(policy));
              setPolicyDrawerOpen(true);
            }}
          >
            规则设置
          </Button>
        </Space>
      </div>

      {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon message={successText} /> : null}

      <div className="access-admin-table-shell">
        {loading ? (
          <div className="access-admin-empty">
            <Spin />
          </div>
        ) : requests.length ? (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={requests}
            pagination={{ pageSize: 12 }}
            onRow={(record) => ({
              onClick: () => void openRequest(record.id)
            })}
            size="small"
          />
        ) : (
          <div className="access-admin-empty">
            <Empty description="暂无申请单" />
          </div>
        )}
      </div>

      <Drawer
        open={policyDrawerOpen}
        onClose={() => setPolicyDrawerOpen(false)}
        width={isNarrowScreen ? "100%" : 460}
        title="访问申请规则"
        extra={
          <Space>
            <Button onClick={() => setPolicyDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={savingPolicy} onClick={() => void handleSavePolicy()}>
              保存
            </Button>
          </Space>
        }
      >
        <div className="access-admin-tab">
          <label className="access-admin-field">
            <span>内部邮箱域名</span>
            <textarea
              className="access-admin-textarea access-admin-textarea-sm"
              value={policyDraft.internalEmailDomainsText}
              onChange={(event) =>
                setPolicyDraft((current) => ({ ...current, internalEmailDomainsText: event.target.value }))
              }
              placeholder={"baicells.com\nbaicells.net"}
            />
          </label>
          <label className="access-admin-field">
            <span>申请邮箱黑名单域名</span>
            <textarea
              className="access-admin-textarea access-admin-textarea-sm"
              value={policyDraft.blockedApplicantEmailDomainsText}
              onChange={(event) =>
                setPolicyDraft((current) => ({ ...current, blockedApplicantEmailDomainsText: event.target.value }))
              }
              placeholder={"126.com\n163.com\ngmail.com\noutlook.com"}
            />
          </label>
          <label className="access-admin-field">
            <span>默认试用天数</span>
            <InputNumber
              min={1}
              max={365}
              value={policyDraft.defaultTrialDays}
              onChange={(value) =>
                setPolicyDraft((current) => ({ ...current, defaultTrialDays: Number(value ?? 14) }))
              }
              style={{ width: "100%" }}
            />
          </label>
          <div className="access-admin-policy-meta">
            <span>当前生效值会立即用于新申请校验和默认开通时长。</span>
            <span>{policy?.updatedAt ? `最近更新：${formatLocalTime(policy.updatedAt)}` : "当前使用默认策略"}</span>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isNarrowScreen ? "100%" : 860}
        title={selectedRequest ? `${selectedRequest.companyName} · ${selectedRequest.applicantEmail}` : "Access Request"}
        extra={
          selectedRequest ? (
            <Tag color={requestStatusTone(selectedRequest.status)}>{requestStatusLabel(selectedRequest.status)}</Tag>
          ) : undefined
        }
      >
        {detailLoading ? (
          <div className="access-admin-empty">
            <Spin />
          </div>
        ) : selectedRequest ? (
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as WorkspaceTab)}
            items={[
              {
                key: "request",
                label: "申请",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-kv-grid">
                      <div><span>品牌入口</span><strong>{selectedRequest.publicBrand?.name ?? "未归属品牌"}</strong></div>
                      <div><span>公司</span><strong>{selectedRequest.companyName}</strong></div>
                      <div><span>申请邮箱</span><strong>{selectedRequest.applicantEmail}</strong></div>
                      <div><span>联系人</span><strong>{selectedRequest.contactName ?? "—"}</strong></div>
                      <div><span>国家 / 地区</span><strong>{selectedRequest.countryRegion ?? "—"}</strong></div>
                      <div><span>历史 SN 号</span><strong>{selectedRequest.snNumber ?? "—"}</strong></div>
                      <div><span>销售联系人</span><strong>{selectedRequest.salesContactEmail}</strong></div>
                      {selectedRequest.purchaseDate ? <div><span>历史购买时间</span><strong>{formatLocalDate(selectedRequest.purchaseDate)}</strong></div> : null}
                      {selectedRequest.poNumber ? <div><span>历史 PO 号</span><strong>{selectedRequest.poNumber}</strong></div> : null}
                      <div><span>公开链接</span><strong>{selectedRequest.publicAccessUrl ?? "—"}</strong></div>
                    </div>
                    <div className="access-admin-field">
                      <span>采购凭证</span>
                      {selectedRequest.purchaseProofAttachments.length ? (
                        <div className="access-admin-file-list">
                          {selectedRequest.purchaseProofAttachments.map((file) => (
                            <a key={file.id} href={accessRequestFileUrl(file.contentUrl)} target="_blank" rel="noreferrer">
                              {file.name}
                              {formatFileSize(file.sizeBytes) ? ` · ${formatFileSize(file.sizeBytes)}` : ""}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <textarea readOnly value={selectedRequest.deviceInfoText} className="access-admin-textarea access-admin-textarea-readonly" />
                      )}
                    </div>
                    <div className="access-admin-form-grid">
                      <label className="access-admin-field">
                        <span>Owner</span>
                        <Select
                          allowClear
                          value={requestDraft.ownerUserId ?? undefined}
                          onChange={(value) => setRequestDraft((current) => ({ ...current, ownerUserId: value ?? null }))}
                          options={lookups.reviewerCandidates.map((candidate) => ({
                            value: candidate.id,
                            label: `${candidate.displayName} · ${candidate.email}`
                          }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Requested Plan</span>
                        <Select
                          allowClear
                          value={requestDraft.requestedPlanId ?? undefined}
                          onChange={(value) => setRequestDraft((current) => ({ ...current, requestedPlanId: value ?? null }))}
                          options={lookups.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Approved Plan</span>
                        <Select
                          allowClear
                          value={requestDraft.approvedPlanId ?? undefined}
                          onChange={(value) => setRequestDraft((current) => ({ ...current, approvedPlanId: value ?? null }))}
                          options={lookups.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                        />
                      </label>
                      <div />
                    </div>
                    <label className="access-admin-field">
                      <span>Admin Note</span>
                      <textarea
                        className="access-admin-textarea"
                        value={requestDraft.adminNote ?? ""}
                        onChange={(event) => setRequestDraft((current) => ({ ...current, adminNote: event.target.value }))}
                      />
                    </label>
                    <div className="access-admin-action-row">
                      <Button loading={savingRequest} type="primary" onClick={() => void handleSaveRequestDraft()}>
                        保存申请配置
                      </Button>
                      <Button onClick={() => setNeedsInfoOpen(true)}>要求补资料</Button>
                      <Button danger onClick={() => setRejectOpen(true)}>
                        拒绝申请
                      </Button>
                    </div>
                  </div>
                )
              },
              {
                key: "review",
                label: "审核",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-form-grid">
                      <label className="access-admin-field">
                        <span>Approval Mode</span>
                        <Select
                          value={reviewDraft.reviewMode}
                          onChange={(value) => setReviewDraft((current) => ({ ...current, reviewMode: value }))}
                          options={[
                            { value: "any_to_approve", label: "任一 To 通过" },
                            { value: "all_to_approve", label: "全部 To 通过" },
                            { value: "minimum_approvals", label: "最少通过数" }
                          ]}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Minimum Approvals</span>
                        <InputNumber
                          min={1}
                          disabled={reviewDraft.reviewMode !== "minimum_approvals"}
                          value={reviewDraft.minimumApprovals ?? 1}
                          onChange={(value) => setReviewDraft((current) => ({ ...current, minimumApprovals: value ?? 1 }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Reject Mode</span>
                        <Select
                          value={reviewDraft.rejectionMode}
                          onChange={(value) => setReviewDraft((current) => ({ ...current, rejectionMode: value }))}
                          options={[
                            { value: "any_to_reject", label: "任一 To 拒绝" },
                            { value: "manual_on_conflict", label: "冲突转管理员" }
                          ]}
                        />
                      </label>
                    </div>

                    <div className="access-admin-section-head">
                      <strong>Recipients</strong>
                      <Button icon={<Plus size={14} />} onClick={() => setReviewDraft((current) => ({
                        ...current,
                        reviewers: [
                          ...current.reviewers,
                          { reviewerEmail: lookups.reviewerCandidates[0]?.email ?? "", reviewerUserId: lookups.reviewerCandidates[0]?.id ?? null, deliveryType: "to" }
                        ]
                      }))}>
                        Add
                      </Button>
                    </div>
                    <div className="access-admin-edit-table">
                      <div className="access-admin-edit-head">
                        <span>Email</span>
                        <span>Delivery</span>
                        <span />
                      </div>
                      {reviewDraft.reviewers.map((reviewer, index) => (
                        <div className="access-admin-edit-row" key={`${reviewer.reviewerEmail}-${index}`}>
                          <Select
                            showSearch
                            value={reviewer.reviewerEmail || undefined}
                            onChange={(value) => setReviewDraft((current) => ({
                              ...current,
                              reviewers: current.reviewers.map((item, itemIndex) => itemIndex === index ? { ...item, reviewerEmail: value, reviewerUserId: lookups.reviewerCandidates.find((candidate) => candidate.email === value)?.id ?? null } : item)
                            }))}
                            options={lookups.reviewerCandidates.map((candidate) => ({
                              value: candidate.email,
                              label: `${candidate.displayName} · ${candidate.email}`
                            }))}
                          />
                          <Select
                            value={reviewer.deliveryType}
                            onChange={(value) => setReviewDraft((current) => ({
                              ...current,
                              reviewers: current.reviewers.map((item, itemIndex) => itemIndex === index ? { ...item, deliveryType: value } : item)
                            }))}
                            options={[
                              { value: "to", label: "To" },
                              { value: "cc", label: "Cc" }
                            ]}
                          />
                          <Button danger onClick={() => setReviewDraft((current) => ({
                            ...current,
                            reviewers: current.reviewers.filter((_, itemIndex) => itemIndex !== index)
                          }))}>
                            删除
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="access-admin-section-head">
                      <strong>Decision Feed</strong>
                      <span className="access-admin-muted">{reviewModeLabel(selectedRequest.reviewMode)} / {rejectionModeLabel(selectedRequest.rejectionMode)}</span>
                    </div>
                    <div className="access-admin-decision-table">
                      {selectedRequest.reviewersList.length ? (
                        selectedRequest.reviewersList.map((reviewer) => (
                          <div className="access-admin-decision-row" key={reviewer.id}>
                            <div>
                              <strong>{reviewer.reviewerDisplayName ?? reviewer.reviewerEmail}</strong>
                              <span>{deliveryTypeLabel(reviewer.deliveryType)} · {reviewer.reviewerEmail}</span>
                            </div>
                            <div>
                              <Tag color={reviewerDecisionTone(reviewer.decision)}>{reviewerDecisionLabel(reviewer.decision)}</Tag>
                              <span>{formatLocalTime(reviewer.decidedAt ?? reviewer.notifiedAt)}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="access-admin-empty access-admin-empty-inline">还没有审核人</div>
                      )}
                    </div>

                    <div className="access-admin-action-row">
                      <Button loading={savingReview} onClick={() => void handleSaveReviewDraft()}>
                        保存审核路由
                      </Button>
                      <Button type="primary" icon={<Send size={14} />} loading={sendingReview} onClick={() => void handleSendReview()}>
                        发送审核
                      </Button>
                    </div>
                  </div>
                )
              },
              {
                key: "provision",
                label: "开通",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-form-grid">
                      <label className="access-admin-field">
                        <span>Target</span>
                        <Select
                          value={provisionDraft.targetMode}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, targetMode: value }))}
                          options={[
                            { value: "new_organization", label: "创建新组织" },
                            { value: "existing_organization", label: "使用已有组织" }
                          ]}
                        />
                      </label>
                      {provisionDraft.targetMode === "new_organization" ? (
                        <label className="access-admin-field">
                          <span>Organization Name</span>
                          <Input
                            value={provisionDraft.organizationName}
                            onChange={(event) => setProvisionDraft((current) => ({ ...current, organizationName: event.target.value }))}
                          />
                        </label>
                      ) : (
                        <label className="access-admin-field">
                          <span>Organization</span>
                          <Select
                            value={provisionDraft.organizationId}
                            onChange={(value) => setProvisionDraft((current) => ({ ...current, organizationId: value }))}
                            options={lookups.organizations.map((organization) => ({
                              value: organization.id,
                              label: organization.name
                            }))}
                          />
                        </label>
                      )}
                      <label className="access-admin-field">
                        <span>Membership</span>
                        <Select
                          value={provisionDraft.membershipType}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, membershipType: value }))}
                          options={[
                            { value: "customer_admin", label: "Admin" },
                            { value: "customer_member", label: "User" }
                          ]}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Plan</span>
                        <Select
                          value={provisionDraft.planId}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, planId: value }))}
                          options={lookups.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Starts At</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.startsAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, startsAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Expires At</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.expiresAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, expiresAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Cycle Anchor</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.cycleAnchorAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, cycleAnchorAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>AI Request Override</span>
                        <InputNumber
                          min={0}
                          value={provisionDraft.completedTurnLimitOverride ?? undefined}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, completedTurnLimitOverride: value ?? null }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Token Override</span>
                        <InputNumber
                          min={0}
                          value={provisionDraft.tokenLimitOverride ?? undefined}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, tokenLimitOverride: value ?? null }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                    </div>
                    <label className="access-admin-field">
                      <span>Provision Note</span>
                      <textarea
                        className="access-admin-textarea"
                        value={provisionDraft.note ?? ""}
                        onChange={(event) => setProvisionDraft((current) => ({ ...current, note: event.target.value }))}
                      />
                    </label>
                    <div className="access-admin-action-row">
                      <Button type="primary" loading={provisioning} onClick={() => void handleProvision()}>
                        开通套餐并发送邀请
                      </Button>
                    </div>
                  </div>
                )
              },
              {
                key: "activity",
                label: "活动",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-activity-table">
                      {selectedRequest.events.length ? (
                        selectedRequest.events.map((event) => (
                          <div className="access-admin-activity-row" key={event.id}>
                            <div>
                              <strong>{event.title}</strong>
                              <span>{event.detail || event.eventType}</span>
                            </div>
                            <div>{formatLocalTime(event.createdAt)}</div>
                          </div>
                        ))
                      ) : (
                        <div className="access-admin-empty access-admin-empty-inline">暂无活动记录</div>
                      )}
                    </div>
                  </div>
                )
              }
            ]}
          />
        ) : (
          <div className="access-admin-empty">
            <Empty description="请选择申请单" />
          </div>
        )}
      </Drawer>

      <Modal
        open={needsInfoOpen}
        onCancel={() => setNeedsInfoOpen(false)}
        onOk={() => void handleNeedsInfoSubmit()}
        confirmLoading={postingNeedsInfo}
        title="要求补资料"
      >
        <Input.TextArea rows={6} value={needsInfoMessage} onChange={(event) => setNeedsInfoMessage(event.target.value)} />
      </Modal>

      <Modal
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => void handleRejectSubmit()}
        confirmLoading={postingReject}
        title="拒绝申请"
      >
        <Input.TextArea rows={6} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
      </Modal>
    </section>
  );
}
