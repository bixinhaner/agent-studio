import { Alert, Button, Input, Rate, Space, Spin, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchAiResponseReview, submitAiResponseReview } from "./api";
import type { AiResponseReviewRecord } from "./types";
import "./ai-response-review.css";

type AiResponseReviewPageProps = {
  reviewId: string;
};

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function statusColor(status: AiResponseReviewRecord["effectiveStatus"]) {
  if (status === "submitted") return "success";
  if (status === "overdue") return "error";
  if (status === "cancelled") return "default";
  return "processing";
}

function statusLabel(status: AiResponseReviewRecord["effectiveStatus"]) {
  if (status === "submitted") return "Submitted";
  if (status === "overdue") return "Overdue";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function snapshotText(review: AiResponseReviewRecord): string {
  const snapshot = review.snapshot && typeof review.snapshot === "object" ? (review.snapshot as Record<string, unknown>) : {};
  const body = typeof snapshot.zendeskCommentBody === "string" ? snapshot.zendeskCommentBody.trim() : "";
  if (body) return body;
  const internalNote = typeof snapshot.internalNote === "string" ? snapshot.internalNote.trim() : "";
  const publicReplyPreview = typeof snapshot.publicReplyPreview === "string" ? snapshot.publicReplyPreview.trim() : "";
  return [publicReplyPreview ? `Public reply preview:\n${publicReplyPreview}` : "", internalNote ? `Internal note:\n${internalNote}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

export function AiResponseReviewPage(props: AiResponseReviewPageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<AiResponseReviewRecord | null>(null);
  const [score, setScore] = useState(0);
  const [suggestion, setSuggestion] = useState("");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  async function loadReview() {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchAiResponseReview(props.reviewId);
      setReview(response.review);
      setScore(response.review.score ?? 0);
      setSuggestion(response.review.suggestion ?? "");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load review task");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReview();
  }, [props.reviewId]);

  async function handleSubmit() {
    if (!score) {
      setErrorText("Please choose a rating from 1 to 5.");
      return;
    }
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await submitAiResponseReview(props.reviewId, {
        score,
        suggestion: suggestion.trim() || null
      });
      setReview(response.review);
      setSuccessText("Review submitted.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setSaving(false);
    }
  }

  const aiOutput = useMemo(() => (review ? snapshotText(review) : ""), [review]);

  return (
    <section className="ai-review-page">
      <div className="ai-review-shell">
        {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon message={successText} /> : null}
        {loading ? (
          <div className="ai-review-panel" style={{ textAlign: "center" }}>
            <Spin />
          </div>
        ) : review ? (
          <>
            <header className="ai-review-hero">
              <div className="ai-review-kicker">AI Response Review</div>
              <h1>Zendesk #{review.ticketId || "-"} · {review.ticketSubject || "Untitled ticket"}</h1>
              <div className="ai-review-meta">
                <Tag color={statusColor(review.effectiveStatus)}>{statusLabel(review.effectiveStatus)}</Tag>
                {review.ticketUrl ? (
                  <Button size="small" href={review.ticketUrl} target="_blank" rel="noreferrer">
                    Open Zendesk
                  </Button>
                ) : null}
              </div>
            </header>

            <div className="ai-review-grid">
              <div className="ai-review-kv">
                <span>Reviewer</span>
                <strong>{review.reviewerDisplayName || review.reviewerEmail || review.reviewerDingTalkUserId || "-"}</strong>
              </div>
              <div className="ai-review-kv">
                <span>Due</span>
                <strong>{formatLocalDateTime(review.dueAt)}</strong>
              </div>
              <div className="ai-review-kv">
                <span>Submitted</span>
                <strong>{formatLocalDateTime(review.submittedAt)}</strong>
              </div>
              <div className="ai-review-kv">
                <span>Current score</span>
                <strong>{review.score ? `${review.score} / 5` : "Not rated"}</strong>
              </div>
            </div>

            <section className="ai-review-panel">
              <h2>Zendesk AI Output</h2>
              <div className="ai-review-zendesk-body">{aiOutput || "No AI output snapshot was saved."}</div>
            </section>

            <section className="ai-review-panel">
              <h2>Your Review</h2>
              <div className="ai-review-form">
                <div>
                  <div className="ai-review-kicker" style={{ marginBottom: 6 }}>Rating</div>
                  <Rate value={score} onChange={setScore} disabled={saving} />
                </div>
                <Input.TextArea
                  rows={5}
                  value={suggestion}
                  disabled={saving}
                  placeholder="Improvement suggestions, if any"
                  onChange={(event) => setSuggestion(event.target.value)}
                />
                <div className="ai-review-actions">
                  <Space>
                    <Button onClick={() => void loadReview()} disabled={saving}>Refresh</Button>
                    <Button type="primary" loading={saving} onClick={() => void handleSubmit()}>
                      Submit Review
                    </Button>
                  </Space>
                </div>
              </div>
            </section>
          </>
        ) : (
          <Alert type="warning" showIcon message="Review task was not found." />
        )}
      </div>
    </section>
  );
}

export default AiResponseReviewPage;
