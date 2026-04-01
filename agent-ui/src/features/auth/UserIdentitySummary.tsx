import { LogOutIcon } from "lucide-react";

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

export function UserIdentitySummary(props: {
  user: AuthUser;
  compact?: boolean;
  onSignOut?: () => void;
}) {
  const name = props.user.displayName?.trim() || props.user.email?.trim() || props.user.id;
  const email = props.user.email?.trim() || "未绑定邮箱";

  const handleSignOut = () => {
    if (!props.onSignOut) return;
    if (!window.confirm("确认退出当前登录状态？")) return;
    props.onSignOut();
  };

  return (
    <section className={props.compact ? "user-identity-card compact" : "user-identity-card"} aria-label="当前登录用户">
      <div className="user-identity-copy">
        <p className="user-identity-name">{name}</p>
        <p className="user-identity-meta">
          <span className="user-identity-role">{roleLabel(props.user.role)}</span>
          <span className="user-identity-divider" aria-hidden="true">
            ·
          </span>
          <span className="user-identity-email">{email}</span>
        </p>
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
