import { Alert, Button, Input, Space, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { fetchReviewerAccessRequest, submitReviewerAccessRequestDecision } from "./api";
import {
  deliveryTypeLabel,
  formatLocalDate,
  formatLocalTime,
  requestStatusLabel,
  requestStatusTone,
  reviewerDecisionLabel,
  reviewerDecisionTone
} from "./presentation";
import type { AccessRequestReviewer, ReviewerAccessRequestView } from "./types";
import "./access-request.css";

type ReviewAccessRequestPageProps = {
  requestId: string;
};

export function ReviewAccessRequestPage(props: ReviewAccessRequestPageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"approved" | "rejected" | "needs_info" | null>(null);
  const [view, setView] = useState<ReviewerAccessRequestView | null>(null);
  const [comment, setComment] = useState("");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  async function loadView() {
    setLoading(true);
    setErrorText("");
    try {
      const next = await fetchReviewerAccessRequest(props.requestId);
      setView(next);
      setComment("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load review request");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadView();
  }, [props.requestId]);

  async function handleDecision(decision: "approved" | "rejected" | "needs_info") {
    setSaving(decision);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await submitReviewerAccessRequestDecision(props.requestId, {
        decision,
        comment: comment.trim() || null
      });
      setView(next);
      setSuccessText("审核结果已提交。");
      setComment("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to submit review decision");
    } finally {
      setSaving(null);
    }
  }

  const reviewerColumns = useMemo<ColumnsType<AccessRequestReviewer>>(
    () => [
      {
        title: "审核人",
        render: (_, record) => (
          <div>
            <div className="access-admin-cell-title">{record.reviewerDisplayName ?? record.reviewerEmail}</div>
            <div className="access-admin-cell-subtitle">{record.reviewerEmail}</div>
          </div>
        )
      },
      {
        title: "送达",
        dataIndex: "deliveryType",
        width: 90,
        render: (value: string) => deliveryTypeLabel(value)
      },
      {
        title: "结果",
        dataIndex: "decision",
        width: 120,
        render: (value: string) => <Tag color={reviewerDecisionTone(value)}>{reviewerDecisionLabel(value)}</Tag>
      },
      {
        title: "时间",
        width: 180,
        render: (_, record) => formatLocalTime(record.decidedAt ?? record.notifiedAt)
      }
    ],
    []
  );

  return (
    <section className="access-review-page">
      {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon message={successText} /> : null}
      {loading ? (
        <div className="access-admin-empty">
          <Spin />
        </div>
      ) : view ? (
        <div className="access-review-shell">
          <div className="access-review-header">
            <div>
              <div className="access-review-kicker">Access Review</div>
              <h1>{view.request.companyName}</h1>
              <div className="access-review-meta">
                <Tag color={requestStatusTone(view.request.status)}>{requestStatusLabel(view.request.status)}</Tag>
                <span>{view.request.applicantEmail}</span>
              </div>
            </div>
          </div>

          <div className="access-admin-kv-grid">
            <div><span>申请邮箱</span><strong>{view.request.applicantEmail}</strong></div>
            <div><span>联系人</span><strong>{view.request.contactName ?? "—"}</strong></div>
            <div><span>公司</span><strong>{view.request.companyName}</strong></div>
            <div><span>国家 / 地区</span><strong>{view.request.countryRegion ?? "—"}</strong></div>
            <div><span>历史 SN 号</span><strong>{view.request.snNumber ?? "—"}</strong></div>
            <div><span>销售邮箱</span><strong>{view.request.salesContactEmail}</strong></div>
            <div><span>历史购买时间</span><strong>{formatLocalDate(view.request.purchaseDate)}</strong></div>
            <div><span>历史 PO 号</span><strong>{view.request.poNumber}</strong></div>
            <div><span>当前审核人</span><strong>{view.viewer.reviewerEmail}</strong></div>
          </div>

          <label className="access-admin-field">
            <span>Purchased Devices</span>
            <textarea readOnly className="access-admin-textarea access-admin-textarea-readonly" value={view.request.deviceInfoText} />
          </label>

          <Table
            rowKey="id"
            columns={reviewerColumns}
            dataSource={view.request.reviewersList}
            pagination={false}
            size="small"
          />

          <label className="access-admin-field">
            <span>Comment</span>
            <Input.TextArea rows={6} value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>

          <Space wrap>
            <Button type="primary" loading={saving === "approved"} onClick={() => void handleDecision("approved")}>
              Approve
            </Button>
            <Button danger loading={saving === "rejected"} onClick={() => void handleDecision("rejected")}>
              Reject
            </Button>
            <Button loading={saving === "needs_info"} onClick={() => void handleDecision("needs_info")}>
              Need More Info
            </Button>
          </Space>
        </div>
      ) : null}
    </section>
  );
}
