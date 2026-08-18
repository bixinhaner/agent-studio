import { useEffect, useMemo, useState } from "react";
import { FileText, UploadCloud } from "lucide-react";

import { BrandMark } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import { accessRequestFileUrl, createPublicAccessRequest, fetchPublicAccessRequest, updatePublicAccessRequest } from "./api";
import { formatFileSize, formatLocalTime } from "./presentation";
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
    purchaseDate: request?.purchaseDate ? request.purchaseDate.slice(0, 10) : null,
    poNumber: request?.poNumber ?? "",
    snNumber: request?.snNumber ?? "",
    salesContactEmail: request?.salesContactEmail ?? "",
    purchaseProofFiles: [],
    customerNote: request?.customerNote ?? ""
  };
}

function updatePath(pathname: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, document.title, pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function publicRequestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "needs_info":
      return "More Information Needed";
    case "review_conflict":
      return "Pending Resolution";
    case "approved_pending_provision":
      return "Approved, Pending Provisioning";
    case "provisioned":
      return "Provisioned";
    case "invited":
      return "Invitation Sent";
    case "activated":
      return "Activated";
    case "rejected":
      return "Rejected";
    case "closed":
      return "Closed";
    default:
      return status || "Unknown";
  }
}

function requiredFieldLabel(label: string): string {
  return `${label} *`;
}

export function PublicAccessRequestPage(props: PublicAccessRequestPageProps) {
  const { brand, branding } = useBranding();
  const [loading, setLoading] = useState(Boolean(props.token));
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState<PublicAccessRequest | null>(null);
  const [form, setForm] = useState<AccessRequestFormState>(createFormState());
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("access-request-route");
    return () => {
      document.body.classList.remove("access-request-route");
    };
  }, []);

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
  const statusTitle = request ? publicRequestStatusLabel(request.status) : "Request Trial Access";
  const pageSubtitle = request
    ? request.needsMoreInfo
      ? "Add the missing details and resubmit. Your original request will continue through the same workflow."
      : "Your request has been created. Future status updates will appear here."
    : "Submit your company details for internal review. A formal invitation will be sent after approval.";

  const statusRows = useMemo(
    () =>
      request
        ? [
            ["Applicant Email", request.applicantEmail],
            ["Contact Name", request.contactName ?? "—"],
            ["Company", request.companyName],
            ["Country / Region", request.countryRegion ?? "—"],
            ["SN Number", request.snNumber ?? "—"],
            [brand.accessSalesContactLabel, request.salesContactEmail],
            ["Last Updated", formatLocalTime(request.updatedAt)],
            ["Target Organization", request.targetOrganization?.name ?? "Pending Provisioning"]
          ]
        : [],
    [request]
  );

  async function handleSubmit() {
    if ((form.purchaseProofFiles ?? []).length === 0 && (request?.purchaseProofAttachments?.length ?? 0) === 0) {
      setErrorText("Purchase proof file is required.");
      setSuccessText("");
      return;
    }
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      if (request?.needsMoreInfo && props.token) {
        const nextRequest = await updatePublicAccessRequest(props.token, form);
        setRequest(nextRequest);
        setForm(createFormState(nextRequest));
        setSuccessText("Your request has been updated and resubmitted.");
      } else {
        const created = await createPublicAccessRequest(form);
        setRequest(created.request);
        setForm(createFormState(created.request));
        updatePath(`/access/apply/${created.publicToken}`);
        setSuccessText("Your request has been submitted.");
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to submit access request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-modern-screen auth-access-screen">
      <div className="auth-modern-card auth-access-card">
        <div className="auth-modern-header">
          <BrandMark
            className="auth-modern-brand-mark"
            imageClassName="auth-modern-brand-image"
            name={branding.platformName}
            logoUrl={branding.logoUrl || branding.iconUrl}
          />
          <h1 className="auth-modern-logo">{statusTitle}</h1>
          <p className="auth-modern-subtitle">{pageSubtitle}</p>
        </div>

        {loading ? <div className="auth-modern-invite">Loading request...</div> : null}
        {errorText ? <p className="err-text auth-access-feedback">{errorText}</p> : null}
        {successText ? <p className="ok-text auth-access-feedback">{successText}</p> : null}
        {request?.reviewSummary && !request.needsMoreInfo ? (
          <div className="auth-modern-invite">Review Note: {request.reviewSummary}</div>
        ) : null}
        {request?.rejectionReason ? <div className="auth-modern-invite auth-access-danger">Rejection Reason: {request.rejectionReason}</div> : null}

        {!loading && editable ? (
          <div className="auth-access-form-grid">
            <label className="auth-modern-field">
              <span>{requiredFieldLabel("Business Email")}</span>
              <input
                className="auth-modern-input"
                type="email"
                value={form.applicantEmail}
                onChange={(event) => setForm((current) => ({ ...current, applicantEmail: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>{requiredFieldLabel("Contact Name")}</span>
              <input
                className="auth-modern-input"
                value={form.contactName ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>{requiredFieldLabel("Company")}</span>
              <input
                className="auth-modern-input"
                value={form.companyName}
                onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>{requiredFieldLabel("Country / Region")}</span>
              <input
                className="auth-modern-input"
                value={form.countryRegion ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, countryRegion: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>{requiredFieldLabel("SN Number")}</span>
              <input
                className="auth-modern-input"
                value={form.snNumber}
                placeholder="At least one device SN"
                onChange={(event) => setForm((current) => ({ ...current, snNumber: event.target.value }))}
              />
            </label>
            <label className="auth-modern-field">
              <span>{requiredFieldLabel(brand.accessSalesContactLabel)}</span>
              <input
                className="auth-modern-input"
                value={form.salesContactEmail}
                onChange={(event) => setForm((current) => ({ ...current, salesContactEmail: event.target.value }))}
              />
            </label>
            <div className="auth-modern-field auth-access-span-2">
              <span>{requiredFieldLabel("Upload Purchase Proof")}</span>
              <label className="auth-access-upload-box" htmlFor="access-purchase-proof-files">
                <input
                  id="access-purchase-proof-files"
                  className="auth-access-file-input"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      purchaseProofFiles: Array.from(event.target.files ?? [])
                    }))
                  }
                />
                <span className="auth-access-upload-icon" aria-hidden="true">
                  <UploadCloud size={20} />
                </span>
                <span className="auth-access-upload-copy">
                  <strong>{(form.purchaseProofFiles ?? []).length > 0 ? `${form.purchaseProofFiles?.length} file(s) selected` : "Click to upload purchase proof"}</strong>
                  <span>PO, purchase record screenshot/photo, invoice, or other purchase record</span>
                </span>
                <span className="auth-access-upload-action">Choose files</span>
              </label>
              {(form.purchaseProofFiles ?? []).length > 0 ? (
                <div className="auth-access-file-list">
                  {(form.purchaseProofFiles ?? []).map((file) => (
                    <span key={`${file.name}-${file.size}`}>
                      <FileText size={14} aria-hidden="true" />
                      {file.name}
                    </span>
                  ))}
                </div>
              ) : request?.purchaseProofAttachments?.length ? (
                <div className="auth-access-file-list">
                  {request.purchaseProofAttachments.map((file) => (
                    <a key={file.id} href={accessRequestFileUrl(file.contentUrl)} target="_blank" rel="noreferrer">
                      <FileText size={14} aria-hidden="true" />
                      {file.name}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            <label className="auth-modern-field auth-access-span-2">
              <span>Notes (Optional)</span>
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
            <div className="auth-access-status-pill">{publicRequestStatusLabel(request.status)}</div>
            <div className="auth-access-status-table">
              {statusRows.map(([label, value]) => (
                <div className="auth-access-status-row" key={label}>
                  <span>{label}</span>
                  <strong>{value || "—"}</strong>
                </div>
              ))}
            </div>
            {request.purchaseProofAttachments?.length ? (
              <div className="auth-access-proof-panel">
                <span>Purchase Proof</span>
                <div className="auth-access-file-list">
                  {request.purchaseProofAttachments.map((file) => (
                    <a key={file.id} href={accessRequestFileUrl(file.contentUrl)} target="_blank" rel="noreferrer">
                      {file.name}
                      {formatFileSize(file.sizeBytes) ? ` · ${formatFileSize(file.sizeBytes)}` : ""}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
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
