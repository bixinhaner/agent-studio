import { Button, Typography } from "antd";

import type { AdminSection } from "./types";

export type AdminNavSection = AdminSection | "broadcasts";

type AdminNavItem = { id: AdminNavSection; label: string; description: string };
type AdminNavGroup = { id: string; label: string; items: AdminNavItem[] };

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "overview",
    label: "总览与运营",
    items: [
      { id: "overview", label: "概览", description: "查看平台核心规模和接入状态。" },
      { id: "monitoring", label: "审计监控", description: "查看请求、成本、告警与审计事件。" },
      { id: "broadcasts", label: "广播管理", description: "维护公告和运营广播触达策略。" }
    ]
  },
  {
    id: "org",
    label: "组织与权限",
    items: [
      { id: "users", label: "用户", description: "管理用户状态、身份和同步信息。" },
      { id: "organization", label: "组织同步", description: "同步部门树与组织结构变更。" },
      { id: "rbac", label: "角色权限", description: "维护角色模板与权限授权矩阵。" }
    ]
  },
  {
    id: "runtime",
    label: "资源与运行",
    items: [
      { id: "resources", label: "资源配置中心", description: "管理资料集、文件来源与授权策略。" },
      { id: "capabilities", label: "能力配置中心", description: "管理 Agent 模式、技能包、运行策略。" },
      { id: "integrations", label: "集成中心", description: "配置外部系统连接与健康状态。" },
      { id: "system-settings", label: "系统设置", description: "维护平台默认参数与发布版本。" }
    ]
  }
];

export function AdminNav(props: {
  section: AdminNavSection;
  onChange(section: AdminNavSection): void;
}) {
  return (
    <nav className="admin-shell-nav" aria-label="管理导航">
      <div className="admin-shell-nav-list" role="tablist" aria-label="管理导航分区">
        {ADMIN_NAV_GROUPS.map((group) => (
          <section key={group.id} className="admin-shell-nav-group">
            <p className="admin-shell-nav-group-title">{group.label}</p>
            <div className="admin-shell-nav-group-list">
              {group.items.map((item) => {
                const active = props.section === item.id;
                return (
                  <Button
                    key={item.id}
                    type={active ? "primary" : "default"}
                    role="tab"
                    aria-selected={active}
                    aria-label={item.label}
                    title={item.description}
                    className={active ? "admin-shell-nav-btn active" : "admin-shell-nav-btn"}
                    block
                    onClick={() => props.onChange(item.id)}
                  >
                    <span className="admin-shell-nav-btn-inner">
                      <span className="admin-shell-nav-btn-prefix" aria-hidden="true">
                        {item.label.slice(0, 1)}
                      </span>
                      <span className="admin-shell-nav-btn-copy">
                        <Typography.Text className="admin-shell-nav-btn-label">{item.label}</Typography.Text>
                        <Typography.Text className="admin-shell-nav-btn-desc">{item.description}</Typography.Text>
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </nav>
  );
}
