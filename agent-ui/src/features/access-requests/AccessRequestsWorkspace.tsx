import {
  Alert,
  AutoComplete,
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
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, RefreshCw, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  ACCESS_REQUEST_STATUS_FILTERS,
  accessRequestActionAvailability,
  buildAccessRequestHash,
  deliveryTypeLabel,
  formatFileSize,
  formatLocalDate,
  formatLocalTime,
  membershipTypeLabel,
  readAccessRequestHashState,
  rejectionModeLabel,
  requestStatusLabel,
  requestStatusTone,
  reviewModeLabel,
  reviewerCandidateMatches,
  reviewerCandidatesForBrand,
  reviewerDecisionLabel,
  reviewerDecisionTone,
  reviewerRowsProblem
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
  const initialHashState = useMemo(() => readAccessRequestHashState(window.location.hash), []);
  const [messageApi, messageHolder] = message.useMessage();
  const [errorText, setErrorText] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialHashState.status);
  const [query, setQuery] = useState(initialHashState.query);
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
  const requestReviewerCandidates = useMemo(
    () => reviewerCandidatesForBrand(lookups.reviewerCandidates, selectedRequest?.publicBrand?.id),
    [lookups.reviewerCandidates, selectedRequest?.publicBrand?.id]
  );

  // Errors appear on the surface the admin is looking at; page-level alerts were hidden behind the drawer and modals.
  const feedbackSurface: "page" | "policy" | "drawer" | "modal" =
    needsInfoOpen || rejectOpen ? "modal" : policyDrawerOpen ? "policy" : drawerOpen ? "drawer" : "page";
  const errorAlert = errorText ? <Alert type="error" showIcon message={errorText} className="access-admin-feedback" /> : null;

  const reviewDraftDirty = Boolean(
    selectedRequest && JSON.stringify(reviewDraft) !== JSON.stringify(createReviewDraft(selectedRequest))
  );
  const requestDraftDirty = Boolean(
    selectedRequest && JSON.stringify(requestDraft) !== JSON.stringify(createRequestDraft(selectedRequest))
  );
  const actionAvailability = accessRequestActionAvailability(selectedRequest?.status ?? "");
  const reviewRowsProblem = reviewerRowsProblem(reviewDraft.reviewers, { requireTo: false });

  /** Unsaved request settings or review routing are easy to lose when switching requests, so ask first. */
  function confirmDiscardDrafts(onDiscard: () => void) {
    if (!reviewDraftDirty && !requestDraftDirty) {
      onDiscard();
      return;
    }
    Modal.confirm({
      title: "放弃未保存的修改？",
      content: [requestDraftDirty ? "申请配置" : "", reviewDraftDirty ? "审核路由" : ""].filter(Boolean).join("、") + "有未保存的修改，离开后会丢失。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: onDiscard
    });
  }

  function closeRequestDrawer() {
    confirmDiscardDrafts(() => {
      setDrawerOpen(false);
      setSelectedRequestId(null);
      setErrorText("");
    });
  }

  useEffect(() => {
    const next = buildAccessRequestHash(window.location.hash, {
      requestId: drawerOpen ? selectedRequestId ?? "" : "",
      status: statusFilter,
      query
    });
    if (next !== window.location.hash) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next}`);
    }
  }, [drawerOpen, query, selectedRequestId, statusFilter]);

  useEffect(() => {
    // A shared link (`#admin/access-requests?request=…`) opens that request directly.
    if (initialHashState.requestId) void openRequest(initialHashState.requestId);
  }, []);

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
      setErrorText(error instanceof Error ? error.message : "加载访问申请失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleSavePolicy() {
    const internalEmailDomains = parsePolicyList(policyDraft.internalEmailDomainsText);
    if (!internalEmailDomains.length) {
      setErrorText("至少保留一个内部邮箱域名。");
      return;
    }
    setSavingPolicy(true);
    setErrorText("");
    try {
      const nextPolicy = await updateAdminAccessRequestPolicy({
        internalEmailDomains,
        blockedApplicantEmailDomains: parsePolicyList(policyDraft.blockedApplicantEmailDomainsText),
        defaultTrialDays: Math.max(1, Number(policyDraft.defaultTrialDays || 14))
      });
      setPolicy(nextPolicy);
      setPolicyDraft(createPolicyDraft(nextPolicy));
      setPolicyDrawerOpen(false);
      void messageApi.success("访问申请规则已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "访问申请规则保存失败，请重试");
    } finally {
      setSavingPolicy(false);
    }
  }

  // Filters apply as the admin types or picks a status; typing is debounced.
  const loadedOnceRef = useRef(false);
  useEffect(() => {
    const silent = loadedOnceRef.current;
    const timer = window.setTimeout(() => {
      loadedOnceRef.current = true;
      void loadWorkspace(silent);
    }, silent && query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [statusFilter, query]);

  function selectRequest(requestId: string) {
    if (drawerOpen && requestId === selectedRequestId) return;
    confirmDiscardDrafts(() => void openRequest(requestId));
  }

  async function openRequest(requestId: string) {
    setActiveTab("request");
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
      setErrorText(error instanceof Error ? error.message : "申请详情加载失败，请重试");
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
    if (successMessage) void messageApi.success(successMessage);
  }

  async function handleSaveRequestDraft() {
    if (!selectedRequest) return;
    setSavingRequest(true);
    setErrorText("");
    try {
      const detail = await patchAdminAccessRequest(selectedRequest.id, {
        ownerUserId: requestDraft.ownerUserId ?? null,
        adminNote: requestDraft.adminNote?.trim() || null,
        requestedPlanId: requestDraft.requestedPlanId ?? null,
        approvedPlanId: requestDraft.approvedPlanId ?? null
      });
      applyDetail(detail, "申请配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "申请配置保存失败，请重试");
    } finally {
      setSavingRequest(false);
    }
  }

  async function handleSaveReviewDraft() {
    if (!selectedRequest) return;
    const problem = reviewerRowsProblem(reviewDraft.reviewers, { requireTo: false });
    if (problem) {
      setErrorText(problem);
      return;
    }
    setSavingReview(true);
    setErrorText("");
    try {
      const detail = await patchAdminAccessRequest(selectedRequest.id, {
        reviewMode: reviewDraft.reviewMode,
        minimumApprovals: reviewDraft.reviewMode === "minimum_approvals" ? reviewDraft.minimumApprovals ?? 1 : null,
        rejectionMode: reviewDraft.rejectionMode,
        reviewers: reviewDraft.reviewers
      });
      applyDetail(detail, "审核路由已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "审核路由保存失败，请重试");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleSendReview() {
    if (!selectedRequest) return;
    const problem = reviewerRowsProblem(reviewDraft.reviewers, { requireTo: true });
    if (problem) {
      setErrorText(problem);
      return;
    }
    setSendingReview(true);
    setErrorText("");
    try {
      const savedDetail = await patchAdminAccessRequest(selectedRequest.id, {
        reviewMode: reviewDraft.reviewMode,
        minimumApprovals: reviewDraft.reviewMode === "minimum_approvals" ? reviewDraft.minimumApprovals ?? 1 : null,
        rejectionMode: reviewDraft.rejectionMode,
        reviewers: reviewDraft.reviewers
      });
      applyDetail(savedDetail);
      const detail = await sendAdminAccessRequestReview(selectedRequest.id);
      applyDetail(detail, "审核邮件已发送");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "审核邮件发送失败，请重试");
    } finally {
      setSendingReview(false);
    }
  }

  async function handleProvision() {
    if (!selectedRequest) return;
    setProvisioning(true);
    setErrorText("");
    try {
      const detail = await provisionAdminAccessRequest(selectedRequest.id, {
        ...provisionDraft,
        startsAt: normalizeIsoOrNull(provisionDraft.startsAt),
        expiresAt: normalizeIsoOrNull(provisionDraft.expiresAt),
        cycleAnchorAt: normalizeIsoOrNull(provisionDraft.cycleAnchorAt)
      });
      applyDetail(detail, "套餐已开通，邀请已发送");
      setActiveTab("activity");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "开通失败，请重试");
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
      applyDetail(detail, "补资料通知已发送给申请人");
      setNeedsInfoOpen(false);
      setNeedsInfoMessage("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "补资料通知发送失败，请重试");
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
      applyDetail(detail, "申请已拒绝，已通知申请人");
      setRejectOpen(false);
      setRejectReason("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "拒绝申请失败，请重试");
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
        render: (_, record) =>
          record.reviewers.total ? (
            <div className="access-admin-cell-subtitle access-admin-tabular">
              <div>通过 {record.reviewers.approvedCount} / 待审 {record.reviewers.pendingCount}</div>
              {record.reviewers.rejectedCount || record.reviewers.needsInfoCount ? (
                <div>
                  {[
                    record.reviewers.rejectedCount ? `拒绝 ${record.reviewers.rejectedCount}` : "",
                    record.reviewers.needsInfoCount ? `要补资料 ${record.reviewers.needsInfoCount}` : ""
                  ].filter(Boolean).join(" / ")}
                </div>
              ) : null}
            </div>
          ) : (
            <span className="access-admin-cell-subtitle">未设置审核人</span>
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
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">访问申请</h1>
          <p className="admin-page-desc">处理公开试用申请、审核路由和开通动作。</p>
        </div>
      </div>
      <div className="access-admin-toolbar">
        <Space wrap size={12}>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={ACCESS_REQUEST_STATUS_FILTERS}
            aria-label="按状态筛选"
            style={{ minWidth: 160 }}
          />
          <Input
            allowClear
            prefix={<Search size={16} aria-hidden="true" style={{ color: "var(--admin-color-subtle)" }} />}
            placeholder="搜索公司、邮箱、PO 或 SN"
            aria-label="搜索访问申请"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 280 }}
          />
          <Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => void loadWorkspace(true)} loading={refreshing}>
            刷新
          </Button>
        </Space>
        <Space wrap size={12}>
          <Button
            onClick={() => {
              setPolicyDraft(createPolicyDraft(policy));
              setErrorText("");
              setPolicyDrawerOpen(true);
            }}
          >
            规则设置
          </Button>
        </Space>
      </div>

      {messageHolder}
      {feedbackSurface === "page" && errorText ? <Alert type="error" showIcon message={errorText} /> : null}

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
            rowClassName={(record) =>
              `access-admin-row${drawerOpen && record.id === selectedRequestId ? " access-admin-row-selected" : ""}`
            }
            onRow={(record) => ({
              tabIndex: 0,
              "aria-label": `打开 ${record.companyName} 的申请`,
              onClick: () => selectRequest(record.id),
              onKeyDown: (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectRequest(record.id);
                }
              }
            })}
            size="small"
          />
        ) : (
          <div className="access-admin-empty">
            <Empty
              description={
                statusFilter !== "all" || query.trim()
                  ? "没有符合筛选条件的申请，换个状态或关键词试试"
                  : "暂无申请单。客户在公开申请页提交后会出现在这里"
              }
            />
          </div>
        )}
      </div>

      <Drawer
        open={policyDrawerOpen}
        onClose={() => {
          setPolicyDrawerOpen(false);
          setErrorText("");
        }}
        width={isNarrowScreen ? "100%" : 460}
        title="访问申请规则"
        extra={
          <Space>
            <Button
              onClick={() => {
                setPolicyDrawerOpen(false);
                setErrorText("");
              }}
            >
              取消
            </Button>
            <Button type="primary" loading={savingPolicy} onClick={() => void handleSavePolicy()}>
              保存规则
            </Button>
          </Space>
        }
      >
        <div className="access-admin-tab">
          {feedbackSurface === "policy" ? errorAlert : null}
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
        onClose={closeRequestDrawer}
        width={isNarrowScreen ? "100%" : 860}
        title={selectedRequest ? `${selectedRequest.companyName} · ${selectedRequest.applicantEmail}` : "访问申请"}
        extra={
          selectedRequest ? (
            <Tag color={requestStatusTone(selectedRequest.status)}>{requestStatusLabel(selectedRequest.status)}</Tag>
          ) : undefined
        }
      >
        {feedbackSurface === "drawer" ? errorAlert : null}
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
                label: requestDraftDirty ? "申请 ·未保存" : "申请",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-kv-grid">
                      <div><span>品牌入口</span><strong>{selectedRequest.publicBrand?.name ?? "未归属品牌"}</strong></div>
                      <div><span>公司</span><strong>{selectedRequest.companyName}</strong></div>
                      <div><span>申请邮箱</span><strong>{selectedRequest.applicantEmail}</strong></div>
                      <div><span>联系人</span><strong>{selectedRequest.contactName ?? "—"}</strong></div>
                      <div><span>国家 / 地区</span><strong>{selectedRequest.countryRegion ?? "—"}</strong></div>
                      <div><span>SN 号</span><strong>{selectedRequest.snNumber ?? "—"}</strong></div>
                      <div><span>销售联系人</span><strong>{selectedRequest.salesContactEmail}</strong></div>
                      {selectedRequest.purchaseDate ? <div><span>购买时间</span><strong>{formatLocalDate(selectedRequest.purchaseDate)}</strong></div> : null}
                      {selectedRequest.poNumber ? <div><span>PO 号</span><strong>{selectedRequest.poNumber}</strong></div> : null}
                      <div>
                        <span>申请人状态页</span>
                        {selectedRequest.publicAccessUrl ? (
                          <Typography.Text className="access-admin-mono" copyable={{ text: selectedRequest.publicAccessUrl, tooltips: ["复制链接", "已复制"] }}>
                            {selectedRequest.publicAccessUrl}
                          </Typography.Text>
                        ) : (
                          <strong>—</strong>
                        )}
                      </div>
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
                        <span>负责人</span>
                        <Select
                          allowClear
                          value={requestDraft.ownerUserId ?? undefined}
                          onChange={(value) => setRequestDraft((current) => ({ ...current, ownerUserId: value ?? null }))}
                          options={reviewerCandidatesForBrand(lookups.reviewerCandidates, null).map((candidate) => ({
                            value: candidate.id,
                            label: `${candidate.displayName} · ${candidate.email}`
                          }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>申请套餐</span>
                        <Select
                          allowClear
                          value={requestDraft.requestedPlanId ?? undefined}
                          onChange={(value) => setRequestDraft((current) => ({ ...current, requestedPlanId: value ?? null }))}
                          options={lookups.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>批准套餐</span>
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
                      <span>内部备注（仅管理员可见）</span>
                      <textarea
                        className="access-admin-textarea"
                        value={requestDraft.adminNote ?? ""}
                        onChange={(event) => setRequestDraft((current) => ({ ...current, adminNote: event.target.value }))}
                      />
                    </label>
                    <div className="access-admin-action-row">
                      <Button loading={savingRequest} type="primary" disabled={!requestDraftDirty} onClick={() => void handleSaveRequestDraft()}>
                        保存申请配置
                      </Button>
                      <Tooltip title={actionAvailability.closeBlockedReason}>
                        <Button
                          disabled={Boolean(actionAvailability.closeBlockedReason)}
                          onClick={() => {
                            setErrorText("");
                            setNeedsInfoOpen(true);
                          }}
                        >
                          要求补资料
                        </Button>
                      </Tooltip>
                      <Tooltip title={actionAvailability.closeBlockedReason}>
                        <Button
                          danger
                          disabled={Boolean(actionAvailability.closeBlockedReason)}
                          onClick={() => {
                            setErrorText("");
                            setRejectOpen(true);
                          }}
                        >
                          拒绝申请
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                )
              },
              {
                key: "review",
                label: reviewDraftDirty ? "审核 ·未保存" : "审核",
                children: (
                  <div className="access-admin-tab">
                    <div className="access-admin-form-grid">
                      <label className="access-admin-field">
                        <span>通过规则</span>
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
                        <span>最少通过人数</span>
                        <InputNumber
                          min={1}
                          disabled={reviewDraft.reviewMode !== "minimum_approvals"}
                          value={reviewDraft.minimumApprovals ?? 1}
                          onChange={(value) => setReviewDraft((current) => ({ ...current, minimumApprovals: value ?? 1 }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>拒绝规则</span>
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
                      <strong>审核人</strong>
                      <Button icon={<Plus size={14} aria-hidden="true" />} onClick={() => setReviewDraft((current) => ({
                        ...current,
                        // Start empty: pre-filling the first directory entry sent reviews to whoever sorted first.
                        reviewers: [...current.reviewers, { reviewerEmail: "", reviewerUserId: null, deliveryType: "to" }]
                      }))}>
                        添加审核人
                      </Button>
                    </div>
                    <div className="access-admin-edit-table">
                      <div className="access-admin-edit-head">
                        <span>邮箱</span>
                        <span>送达方式</span>
                        <span />
                      </div>
                      {reviewDraft.reviewers.map((reviewer, index) => (
                        // Keyed by position only: keying by the typed email remounted the input on every keystroke.
                        <div className="access-admin-edit-row" key={index}>
                          <AutoComplete
                            aria-label={`第 ${index + 1} 位审核人邮箱`}
                            status={reviewRowsProblem.startsWith(`第 ${index + 1} 行`) ? "error" : undefined}
                            value={reviewer.reviewerEmail || undefined}
                            onChange={(value) => setReviewDraft((current) => ({
                              ...current,
                              reviewers: current.reviewers.map((item, itemIndex) => itemIndex === index ? { ...item, reviewerEmail: value, reviewerUserId: requestReviewerCandidates.find((candidate) => candidate.email === value)?.id ?? null } : item)
                            }))}
                            options={requestReviewerCandidates.map((candidate) => ({
                              value: candidate.email,
                              label: `${candidate.displayName} · ${candidate.email}`,
                              candidate
                            }))}
                            // AutoComplete does not filter on its own; without this every account is listed for any input.
                            filterOption={(input, option) => reviewerCandidateMatches(input, option?.candidate)}
                            placeholder="内部账号或品牌邮箱"
                          />
                          <Select
                            aria-label={`第 ${index + 1} 位审核人送达方式`}
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
                          <Button
                            danger
                            aria-label={`移除第 ${index + 1} 位审核人`}
                            onClick={() => setReviewDraft((current) => ({
                              ...current,
                              reviewers: current.reviewers.filter((_, itemIndex) => itemIndex !== index)
                            }))}
                          >
                            移除
                          </Button>
                        </div>
                      ))}
                    </div>
                    <p className="access-admin-muted">品牌邮箱审核人会收到仅限当前申请、7 天有效的安全审核链接，无需管理后台账号。</p>

                    <div className="access-admin-section-head">
                      <strong>审核结果</strong>
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
                      <Button loading={savingReview} disabled={!reviewDraftDirty} onClick={() => void handleSaveReviewDraft()}>
                        保存审核路由
                      </Button>
                      <Tooltip title={actionAvailability.sendReviewBlockedReason}>
                        <Button
                          type="primary"
                          icon={<Send size={14} aria-hidden="true" />}
                          loading={sendingReview}
                          disabled={Boolean(actionAvailability.sendReviewBlockedReason)}
                          onClick={() => void handleSendReview()}
                        >
                          {reviewDraftDirty ? "保存并发送审核" : "发送审核"}
                        </Button>
                      </Tooltip>
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
                        <span>开通对象</span>
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
                          <span>新组织名称</span>
                          <Input
                            value={provisionDraft.organizationName}
                            onChange={(event) => setProvisionDraft((current) => ({ ...current, organizationName: event.target.value }))}
                          />
                        </label>
                      ) : (
                        <label className="access-admin-field">
                          <span>已有组织</span>
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
                        <span>申请人角色</span>
                        <Select
                          value={provisionDraft.membershipType}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, membershipType: value }))}
                          options={[
                            { value: "customer_admin", label: "组织管理员" },
                            { value: "customer_member", label: "普通成员" }
                          ]}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>套餐</span>
                        <Select
                          value={provisionDraft.planId}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, planId: value }))}
                          options={lookups.plans.map((plan) => ({ value: plan.id, label: plan.name }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>开始时间</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.startsAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, startsAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>到期时间（留空按默认试用天数）</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.expiresAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, expiresAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>计费周期起点</span>
                        <input
                          className="access-admin-native-input"
                          type="datetime-local"
                          value={toDatetimeInput(provisionDraft.cycleAnchorAt)}
                          onChange={(event) => setProvisionDraft((current) => ({ ...current, cycleAnchorAt: event.target.value }))}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>AI 请求额度覆盖</span>
                        <InputNumber
                          min={0}
                          value={provisionDraft.completedTurnLimitOverride ?? undefined}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, completedTurnLimitOverride: value ?? null }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                      <label className="access-admin-field">
                        <span>Token 额度覆盖</span>
                        <InputNumber
                          min={0}
                          value={provisionDraft.tokenLimitOverride ?? undefined}
                          onChange={(value) => setProvisionDraft((current) => ({ ...current, tokenLimitOverride: value ?? null }))}
                          style={{ width: "100%" }}
                        />
                      </label>
                    </div>
                    <label className="access-admin-field">
                      <span>开通备注</span>
                      <textarea
                        className="access-admin-textarea"
                        value={provisionDraft.note ?? ""}
                        onChange={(event) => setProvisionDraft((current) => ({ ...current, note: event.target.value }))}
                      />
                    </label>
                    <div className="access-admin-action-row">
                      <Button
                        type="primary"
                        loading={provisioning}
                        onClick={() => {
                          if (!actionAvailability.provisionWarning) {
                            void handleProvision();
                            return;
                          }
                          Modal.confirm({
                            title: "确认开通？",
                            content: actionAvailability.provisionWarning,
                            okText: "开通并发送邀请",
                            cancelText: "取消",
                            onOk: () => handleProvision()
                          });
                        }}
                      >
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
        onCancel={() => {
          setNeedsInfoOpen(false);
          setErrorText("");
        }}
        onOk={() => void handleNeedsInfoSubmit()}
        okText="发送补资料通知"
        cancelText="取消"
        okButtonProps={{ disabled: !needsInfoMessage.trim() }}
        confirmLoading={postingNeedsInfo}
        title="要求补资料"
      >
        {feedbackSurface === "modal" ? errorAlert : null}
        <label className="access-admin-field">
          <span>需要申请人补充的内容</span>
          <Input.TextArea
            rows={6}
            value={needsInfoMessage}
            placeholder="例如：Please upload the invoice for the purchased devices."
            onChange={(event) => setNeedsInfoMessage(event.target.value)}
          />
        </label>
        <p className="access-admin-muted">
          这段文字会原样通过邮件发给 {selectedRequest?.applicantEmail ?? "申请人"}，邮件为英文，建议用英文填写。
        </p>
      </Modal>

      <Modal
        open={rejectOpen}
        onCancel={() => {
          setRejectOpen(false);
          setErrorText("");
        }}
        onOk={() => void handleRejectSubmit()}
        okText="拒绝并通知申请人"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
        confirmLoading={postingReject}
        title="拒绝申请"
      >
        {feedbackSurface === "modal" ? errorAlert : null}
        <label className="access-admin-field">
          <span>拒绝原因</span>
          <Input.TextArea rows={6} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
        </label>
        <p className="access-admin-muted">
          拒绝原因会通过邮件发给 {selectedRequest?.applicantEmail ?? "申请人"}，并显示在申请人状态页上。拒绝后不能再要求补资料。
        </p>
      </Modal>
    </section>
  );
}
