import type { AdminSection } from "./types";

const ITEMS: Array<{ id: AdminSection; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "users", label: "用户" },
  { id: "resources", label: "资源配置中心" },
  { id: "organization", label: "组织同步" },
  { id: "rbac", label: "角色权限" },
  { id: "monitoring", label: "审计监控" }
];

export function AdminNav(props: {
  section: AdminSection;
  onChange(section: AdminSection): void;
}) {
  return (
    <div className="admin-nav" role="tablist" aria-label="管理导航">
      {ITEMS.map((item) => {
        const active = props.section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "admin-nav-btn active" : "admin-nav-btn"}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
