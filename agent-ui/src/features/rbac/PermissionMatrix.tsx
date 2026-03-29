import type { PermissionSummary } from "./types";

export function PermissionMatrix(props: {
  permissions: PermissionSummary[];
  selectedPermissionIds: string[];
  onToggle(permissionId: string, checked: boolean): void;
}) {
  const groups = new Map<string, PermissionSummary[]>();
  for (const permission of props.permissions) {
    const bucket = groups.get(permission.category) ?? [];
    bucket.push(permission);
    groups.set(permission.category, bucket);
  }

  return (
    <div className="rbac-permission-matrix">
      {Array.from(groups.entries()).map(([category, permissions]) => (
        <section key={category} className="rbac-group">
          <h4>{category}</h4>
          <div className="rbac-option-list">
            {permissions.map((permission) => (
              <label key={permission.id} className="rbac-option">
                <input
                  type="checkbox"
                  aria-label={`permission ${permission.key}`}
                  checked={props.selectedPermissionIds.includes(permission.id)}
                  onChange={(event) => props.onToggle(permission.id, event.target.checked)}
                />
                <span>{permission.name}</span>
                <code>{permission.key}</code>
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
