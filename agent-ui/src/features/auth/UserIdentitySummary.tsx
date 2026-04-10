import { LogOutIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { useAuth } from "./AuthProvider";
import { createOrganizationInvite, type AuthUser } from "./api";

function roleLabel(role: string | undefined): string {
  switch ((role || "").trim()) {
    case "super_admin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "employee":
      return "员工";
    default:
      return role?.trim() || "未知角色";
  }
}

function userTypeLabel(userType: string | undefined): string {
  switch ((userType || "").trim()) {
    case "internal_employee":
      return "内部成员";
    case "external_user":
      return "外部成员";
    default:
      return userType?.trim() || "平台用户";
  }
}

function providerLabel(provider: string): string {
  switch (provider.trim()) {
    case "dingtalk":
      return "钉钉";
    case "email_magic_link":
      return "邮箱免密";
    default:
      return provider.trim() || "未知身份";
  }
}

export function UserIdentitySummary(props: {
  user: AuthUser;
  compact?: boolean;
  onSignOut?: () => void;
}) {
  const auth = useAuth();
  const [switchingOrganization, setSwitchingOrganization] = useState(false);
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMembershipType, setInviteMembershipType] = useState("customer_member");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const name = props.user.displayName?.trim() || props.user.email?.trim() || props.user.id;
  const email = props.user.email?.trim() || "未绑定邮箱";
  const activeOrganizationName = auth.activeOrganization?.name?.trim() || "未选择组织";
  const providerLabels = [...new Set(auth.identities.map((identity) => providerLabel(identity.provider)).filter(Boolean))];
  const organizationOptions = auth.memberships.filter((membership) => membership.organization);
  const canInviteToCustomerOrganization =
    auth.activeOrganization?.type === "customer" &&
    (props.user.role === "admin" ||
      props.user.role === "super_admin" ||
      auth.activeOrganization.membershipType === "customer_admin");

  const handleSignOut = () => {
    if (!props.onSignOut) return;
    if (!window.confirm("确认退出当前登录状态？")) return;
    props.onSignOut();
  };

  const handleOrganizationChange = async (nextOrganizationId: string) => {
    if (!nextOrganizationId || nextOrganizationId === auth.activeOrganization?.id) return;
    setSwitchingOrganization(true);
    try {
      await auth.selectOrganization(nextOrganizationId);
      setInviteComposerOpen(false);
      setInviteFeedback(null);
    } finally {
      setSwitchingOrganization(false);
    }
  };

  const handleInviteSubmit = async () => {
    const normalizedEmail = inviteEmail.trim();
    if (!normalizedEmail) {
      setInviteFeedback("请输入被邀请人的邮箱。");
      return;
    }
    setInviteSubmitting(true);
    setInviteFeedback(null);
    try {
      const invite = await createOrganizationInvite({
        email: normalizedEmail,
        membershipType: inviteMembershipType
      });
      setInviteEmail("");
      setInviteComposerOpen(false);
      setInviteFeedback(`已向 ${invite.email} 发送邀请。`);
    } catch (error) {
      setInviteFeedback(error instanceof Error ? error.message : "创建邀请失败");
    } finally {
      setInviteSubmitting(false);
    }
  };

  return (
    <section className={props.compact ? "user-identity-card compact" : "user-identity-card"} aria-label="当前登录用户">
      <div className="user-identity-stack">
        <div className="user-identity-copy">
          <p className="user-identity-name">{name}</p>
          <p className="user-identity-meta">
            <span className="user-identity-role">{roleLabel(props.user.role)}</span>
            <span className="user-identity-divider" aria-hidden="true">
              ·
            </span>
            <span>{userTypeLabel(props.user.userType)}</span>
            <span className="user-identity-divider" aria-hidden="true">
              ·
            </span>
            <span className="user-identity-email">{email}</span>
          </p>
        </div>

        <div className="user-identity-org-row">
          <span className="user-identity-org-label">当前组织</span>
          {organizationOptions.length > 1 ? (
            <select
              className="user-identity-org-select"
              value={auth.activeOrganization?.id ?? ""}
              disabled={switchingOrganization}
              onChange={(event) => void handleOrganizationChange(event.target.value)}
            >
              {organizationOptions.map((membership) =>
                membership.organization ? (
                  <option key={membership.organization.id} value={membership.organization.id}>
                    {membership.organization.name}
                  </option>
                ) : null
              )}
            </select>
          ) : (
            <span className="user-identity-org-name">{activeOrganizationName}</span>
          )}
        </div>

        {providerLabels.length ? (
          <div className="user-identity-provider-list" aria-label="已绑定登录方式">
            {providerLabels.map((label) => (
              <span key={label} className="user-identity-provider-badge">
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {auth.error ? <p className="user-identity-alert">{auth.error}</p> : null}
        {inviteFeedback ? <p className="user-identity-alert">{inviteFeedback}</p> : null}

        {canInviteToCustomerOrganization && inviteComposerOpen ? (
          <div className="user-identity-invite-form">
            <input
              className="user-identity-inline-input"
              type="email"
              placeholder="invitee@example.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <select
              className="user-identity-inline-select"
              value={inviteMembershipType}
              onChange={(event) => setInviteMembershipType(event.target.value)}
            >
              <option value="customer_member">客户成员</option>
              <option value="customer_admin">客户管理员</option>
            </select>
            <button
              type="button"
              className="user-identity-inline-btn"
              disabled={inviteSubmitting}
              onClick={() => void handleInviteSubmit()}
            >
              {inviteSubmitting ? "发送中..." : "发送邀请"}
            </button>
          </div>
        ) : null}
      </div>

      {props.onSignOut ? (
        <div className="user-identity-actions">
          {canInviteToCustomerOrganization ? (
            <button
              type="button"
              className="user-identity-action-btn"
              aria-label="邀请组织成员"
              title="邀请组织成员"
              onClick={() => {
                setInviteFeedback(null);
                setInviteComposerOpen((current) => !current);
              }}
            >
              <UserPlusIcon size={16} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            className="user-identity-action-btn"
            aria-label="退出登录"
            title="退出登录"
            onClick={handleSignOut}
          >
            <LogOutIcon size={16} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
