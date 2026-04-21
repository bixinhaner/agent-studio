import { useEffect, useMemo, useState } from "react";

import { BrandMark } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import { createPublicAccessRequest, fetchPublicAccessRequest, updatePublicAccessRequest } from "./api";
import { formatLocalDate, formatLocalTime, requestStatusLabel } from "./presentation";
import type { PublicAccessRequest, PublicAccessRequestInput } from "./types";
import "./access-request.css";

type PublicAccessRequestPageProps = {
  token?: string;
};

type AccessRequestFormState = PublicAccessRequestInput;

function createFormState(request?: PublicAccessRequest | null): AccessRequestFormState {
  return {
    applicantEmail: request?.applicantEmail ?? "",
    contactName: request?.contactName ?? "",
    companyName: request?.companyName ?? "",
    countryRegion: request?.countryRegion ?? "",
    deviceInfoText: request?.deviceInfoText ?? "",
    purchaseDate: request?.purchaseDate ? request.purchaseDate.slice(0, 10) : "",
    poNumber: request?.poNumber ?? "",
    salesContactEmail: request?.salesContactEmail ?? "",
    customerNote: request?.customerNote ?? ""
  };
}

function updatePath(pathname: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, document.title, pathname);
}

export function PublicAccessRequestPage(props: PublicAccessRequestPageProps) {
  const { branding } = useBranding();
  const [loading, setLoading] = useState(Boolean(props.token));
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<PublicAccessRequest | null>(null);
  const [form, setForm] = useState<AccessRequestFormState>(createFormState());
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    let active = true;
    if (!props.token) {
      setLoading(false);
      setRequest(null);
      setForm(createFormState());
      return;
    }
    setLoading(true);
    setErrorText("");
    void fetchPublicAccessRequest(props.token)
      .then((nextRequest) => {
        if (!active) return;
        setRequest(nextRequest);
        setForm(createFormState(nextRequest));
      })
      .catch((error) => {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : "Failed to load access request");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.token]);

  const editable = !request || request.needsMoreInfo;
  const statusTitle = request ? requestStatusLabel(request.status) : "申请试用访问";
  const pageSubtitle = request
    ? request.needsMoreInfo
      ? "补充资料后重新提交，原申请单会继续流转。"
      : "申请单已创建，后续状态会在这里更新。"
    : "提交企业信息后进入内部审核，审核通过后发送正式邀请。";

  const statusRows = useMemo(
    () =>
      request
        ? [
            ["申请邮箱", request.applicantEmail],
            ["公司", request.companyName],
            ["销售邮箱", request.salesContactEmail],
            ["PO 号", request.poNumber],
            ["购买时间", formatLocalDate(request.purchaseDate)],
            ["更新时间", formatLocalTime(request.updatedAt)],
            ["目标组织", request.targetOrganization?.name ?? "待开通"]
          ]
        : [],
    [request]
  );

  async function handleSubmit() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      if (request?.needsMoreInfo && props.token) {
        const nextRequest = await updatePublicAccessRequest(props.token, form);
        setRequest(nextRequest);
        setForm(createFormState(nextRequest));
        setSuccessText("资料已更新，申请单已重新提交。");
      } else {
        const created = await createPublicAccessRequest(form);
        setRequest(created.request);
        setForm(createFormState(created.request));
        updatePath(`/access/apply/${created.publicToken}`);
        setSuccessText("申请已提交。");
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to submit access request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-modern-screen">
      <div className="auth-modern-card auth-access-card">
        <div className="auth-modern-header">
          <BrandMark
            className="auth-modern-brand-mark"
            imageClassName="auth-modern-brand-image"
            name={branding.platformName}
            logoUrl={branding.logoUrl || branding.iconUrl}
          />
          <p className="auth-access-eyebrow">Apply for Trial Access</p>
          <h1 className="auth-modern-logo">{statusTitle}</h1>
          <p className="auth-modern-subtitle">{pageSubtitle}</p>
        </div>

        {loading ? <div className="auth-modern-invite">Loading request...</div> : null}
        {errorText ? <p className="err-text auth-access-feedback">{errorText}</p> : null}
        {successText ? <p className="ok-text auth-access-feedback">{successText}</p> : null}
        {request?.reviewSummary && !request.needsMoreInfo ? (
          <div className="auth-modern-invite">审核备注：{request.reviewSummary}</div>
        ) : null}
        {request?.rejectionReason ? <div className="auth-modern-invite auth-access-danger">拒绝原因：{request.rejectionReason}</div> : null}

        {!loading && editable ? (
          <div className="auth-access-form-grid">
            <label className="auth-modern-field">
              <span>Business Email</span>
              <input
                className="auth-modern-input"
                type="email"
                value={form.applicantEmail}
                onChange={(event) => setForm((current) => ({ ...current, applicantEmail: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>Contact Name</span>
              <input
                className="auth-modern-input"
                value={form.contactName ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>Company</span>
              <input
                className="auth-modern-input"
                value={form.companyName}
                onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>Country / Region</span>
              <input
                className="auth-modern-input"
                value={form.countryRegion ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, countryRegion: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>Purchase Date</span>
              <input
                className="auth-modern-input"
                type="date"
                value={form.purchaseDate ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, purchaseDate: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>PO Number</span>
              <input
                className="auth-modern-input"
                value={form.poNumber}
                onChange={(event) => setForm((current) => ({ ...current, poNumber: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>Baicells Sales Email</span>
              <input
                className="auth-modern-input"
                type="email"
                value={form.salesContactEmail}
                onChange={(event) => setForm((current) => ({ ...current, salesContactEmail: event.target.value }))}
              />
            </label>
            <div />
            <label className="auth-modern-field auth-access-span-2">
              <span>Purchased Devices</span>
              <textarea
                className="auth-modern-input auth-access-textarea"
                value={form.deviceInfoText}
                onChange={(event) => setForm((current) => ({ ...current, deviceInfoText: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field auth-access-span-2">
              <span>Notes</span>
              <textarea
                className="auth-modern-input auth-access-textarea auth-access-textarea-sm"
                value={form.customerNote ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, customerNote: event.target.value }))}
              />
            </label>
            <div className="auth-access-actions auth-access-span-2">
              <button className="auth-modern-primary-btn auth-access-link-btn" onClick={() => updatePath("/")}>
                Return to Sign In
              </button>
              <button className="auth-modern-sso-btn auth-access-submit-btn" disabled={saving} onClick={() => void handleSubmit()}>
                {saving ? "Submitting..." : request?.needsMoreInfo ? "Resubmit Request" : "Submit Request"}
              </button>
            </div>
          </div>
        ) : null}

        {!loading && request && !editable ? (
          <div className="auth-access-status">
            <div className="auth-access-status-pill">{requestStatusLabel(request.status)}</div>
            <div className="auth-access-status-table">
              {statusRows.map(([label, value]) => (
                <div className="auth-access-status-row" key={label}>
                  <span>{label}</span>
                  <strong>{value || "—"}</strong>
                </div>
              ))}
            </div>
            <div className="auth-access-actions">
              <button className="auth-modern-primary-btn auth-access-link-btn" onClick={() => updatePath("/")}>
                Back to Sign In
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
