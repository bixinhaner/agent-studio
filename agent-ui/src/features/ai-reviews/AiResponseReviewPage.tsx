import { Alert, Button, Input, Rate, Space, Spin, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchAiResponseReview, submitAiResponseReview } from "./api";
import type { AiResponseReviewRecord } from "./types";
import "./ai-response-review.css";

type AiResponseReviewPageProps = {
  reviewId: string;
};

const LOW_SCORE_SUGGESTION_MIN_LENGTH = 10;

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

function todoStatusLabel(status: string | undefined) {
  if (status === "completed") return "DingTalk todo completed";
  if (status === "created") return "DingTalk todo active";
  if (status === "failed") return "DingTalk todo failed";
  if (status === "complete_failed") return "DingTalk todo completion failed";
  return "DingTalk todo not created";
}

function todoStatusColor(status: string | undefined) {
  if (status === "completed") return "success";
  if (status === "created") return "processing";
  if (status === "failed" || status === "complete_failed") return "error";
  return "default";
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("ai-response-review-route");
    return () => {
      document.body.classList.remove("ai-response-review-route");
    };
  }, []);

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
    const trimmedSuggestion = suggestion.trim();
    if (!score) {
      setErrorText("Please choose a rating from 1 to 5.");
      return;
    }
    if (score <= 3 && trimmedSuggestion.length < LOW_SCORE_SUGGESTION_MIN_LENGTH) {
      setErrorText("For ratings 1-3, please add a reason and improvement suggestion (at least 10 characters).");
      return;
    }
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await submitAiResponseReview(props.reviewId, {
        score,
        suggestion: trimmedSuggestion || null
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
  const lowScoreRequiresSuggestion = score > 0 && score <= 3;

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
                <Tag color={todoStatusColor(review.dingtalkTodoStatus)}>{todoStatusLabel(review.dingtalkTodoStatus)}</Tag>
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
                {lowScoreRequiresSuggestion ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Reason required"
                    description="Ratings 1-3 require a reason and improvement suggestion before submission."
                  />
                ) : null}
                <div className="ai-review-kicker">
                  {lowScoreRequiresSuggestion ? "Reason and improvement suggestion (required)" : "Improvement suggestion (optional)"}
                </div>
                <Input.TextArea
                  rows={5}
                  value={suggestion}
                  disabled={saving}
                  placeholder={
                    lowScoreRequiresSuggestion
                      ? "Explain why the AI response was rated low and what should be improved."
                      : "Improvement suggestions, if any"
                  }
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
