import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { useAuth } from "./AuthProvider";
import type { AuthUser } from "./api";

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
  const name = props.user.displayName?.trim() || props.user.email?.trim() || props.user.id;
  const email = props.user.email?.trim() || "未绑定邮箱";
  const activeOrganizationName = auth.activeOrganization?.name?.trim() || "未选择组织";
  const providerLabels = [...new Set(auth.identities.map((identity) => providerLabel(identity.provider)).filter(Boolean))];
  const organizationOptions = auth.memberships.filter((membership) => membership.organization);

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
    } finally {
      setSwitchingOrganization(false);
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
      </div>

      {props.onSignOut ? (
        <div className="user-identity-actions">
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
