import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { useAuth } from "./AuthProvider";
import type { AuthUser, AuthUserType } from "./api";

type UserIdentityLocale = "zh" | "en";

function roleLabel(role: string | undefined, userType: AuthUserType | undefined, locale: UserIdentityLocale): string {
  switch ((role || "").trim()) {
    case "super_admin":
      return locale === "en" ? "Super admin" : "超级管理员";
    case "admin":
      return locale === "en" ? "Admin" : "管理员";
    case "employee":
      if (userType === "external_user") return "User";
      return locale === "en" ? "Employee" : "员工";
    default:
      return role?.trim() || (locale === "en" ? "Unknown role" : "未知角色");
  }
}

function userTypeLabel(userType: string | undefined, locale: UserIdentityLocale): string {
  switch ((userType || "").trim()) {
    case "internal_employee":
      return locale === "en" ? "Internal member" : "内部成员";
    case "external_user":
      return locale === "en" ? "External member" : "外部成员";
    default:
      return userType?.trim() || (locale === "en" ? "Platform user" : "平台用户");
  }
}

function providerLabel(provider: string, locale: UserIdentityLocale): string {
  switch (provider.trim()) {
    case "dingtalk":
      return locale === "en" ? "DingTalk" : "钉钉";
    case "email_magic_link":
      return locale === "en" ? "Email magic link" : "邮箱免密";
    default:
      return provider.trim() || (locale === "en" ? "Unknown identity" : "未知身份");
  }
}

export function UserIdentitySummary(props: {
  user: AuthUser;
  compact?: boolean;
  onSignOut?: () => void;
  locale?: UserIdentityLocale;
}) {
  const auth = useAuth();
  const [switchingOrganization, setSwitchingOrganization] = useState(false);
  const locale: UserIdentityLocale = props.locale || "zh";
  const name = props.user.displayName?.trim() || props.user.email?.trim() || props.user.id;
  const email = props.user.email?.trim() || (locale === "en" ? "No email linked" : "未绑定邮箱");
  const activeOrganizationName = auth.activeOrganization?.name?.trim() || (locale === "en" ? "No organization selected" : "未选择组织");
  const providerLabels = [...new Set(auth.identities.map((identity) => providerLabel(identity.provider, locale)).filter(Boolean))];
  const organizationOptions = auth.memberships.filter((membership) => membership.organization);

  const handleSignOut = () => {
    if (!props.onSignOut) return;
    if (!window.confirm(locale === "en" ? "Sign out of the current session?" : "确认退出当前登录状态？")) return;
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
    <section className={props.compact ? "user-identity-card compact" : "user-identity-card"} aria-label={locale === "en" ? "Current signed-in user" : "当前登录用户"}>
      <div className="user-identity-stack">
        <div className="user-identity-copy">
          <p className="user-identity-name" style={{ marginBottom: 4 }}>{name}</p>
          <p className="user-identity-meta" style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
            <span className="user-identity-role">{roleLabel(props.user.role, props.user.userType, locale)}</span>
            <span className="user-identity-divider" aria-hidden="true" style={{ margin: "0 6px" }}>·</span>
            {organizationOptions.length > 1 ? (
              <select
                style={{ appearance: "auto", border: "none", background: "transparent", padding: 0, color: "inherit", fontSize: "inherit", cursor: "pointer", outline: "none", maxWidth: 120, textOverflow: "ellipsis" }}
                title={locale === "en" ? "Switch organization" : "切换组织"}
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
              <span>{activeOrganizationName}</span>
            )}
          </p>
          <p className="user-identity-meta" style={{ marginTop: 2 }}>
            <span className="user-identity-email">{email}</span>
          </p>
        </div>

        {auth.error ? <p className="user-identity-alert" style={{ marginTop: 8 }}>{auth.error}</p> : null}
      </div>

      {props.onSignOut ? (
        <div className="user-identity-actions">
          <button
            type="button"
            className="user-identity-action-btn"
            aria-label={locale === "en" ? "Sign out" : "退出登录"}
            title={locale === "en" ? "Sign out" : "退出登录"}
            onClick={handleSignOut}
          >
            <LogOutIcon size={16} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
