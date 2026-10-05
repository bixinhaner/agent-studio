const CATEGORY_LABELS: Record<string, string> = {
  admin_overview: "管理概览",
  resource_center: "资源中心",
  user_management: "用户管理",
  role_management: "角色管理",
  resource_authorization: "资源授权",
  org_sync: "组织同步",
  integration_management: "集成管理",
  audit: "审计",
  system_settings: "系统设置",
  monitoring: "监控",
  quota: "额度",
  alerting: "告警",
  collaboration: "协作"
};

const PERMISSION_LABELS: Record<string, string> = {
  "admin.overview.read": "查看管理概览",
  "resource_center.read": "查看资源中心",
  "user.read": "查看用户",
  "user.write": "编辑用户",
  "user.role.assign": "分配用户角色",
  "role.read": "查看角色",
  "role.write": "编辑角色",
  "role.clone": "复制角色",
  "role.disable": "停用角色",
  "permission.read": "查看权限",
  "permission.assign": "分配权限",
  "resource_policy.read": "查看资源授权",
  "resource_policy.write": "编辑资源授权",
  "workspace.read": "查看工作区",
  "workspace.write": "编辑工作区",
  "workspace.disable": "停用工作区",
  "knowledge_set.read": "查看资料集",
  "knowledge_set.write": "编辑资料集",
  "knowledge_set.upload": "上传资料集文件",
  "knowledge_set.reindex": "重建资料集索引",
  "knowledge_set.file_manage": "管理资料集文件",
  "org_sync.read": "查看组织同步",
  "org_sync.trigger": "触发组织同步",
  "integration.read": "查看集成",
  "integration.write": "编辑集成",
  "audit.read": "查看审计日志",
  "system_settings.read": "查看系统设置",
  "system_settings.write": "编辑系统设置草稿",
  "system_settings.publish": "发布系统设置",
  "monitoring.read": "查看监控看板",
  "quota.read": "查看额度策略",
  "quota.write": "编辑额度策略",
  "alert.read": "查看告警",
  "alert.write": "编辑告警",
  "collaboration.read": "查看协作视图",
  "collaboration.share": "管理会话共享",
  "collaboration.comment": "评论共享会话",
  "collaboration.assign": "分配协作负责人",
  "collaboration.broadcast.publish": "发布广播",
  "collaboration.capture_mark.write": "标记知识沉淀候选",
  "inbox.read": "查看收件箱",
  "inbox.write": "处理收件箱"
};

const SYSTEM_ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin: "受保护的系统超级管理员角色",
  admin: "受保护的系统管理员角色"
};

// Seeded English descriptions, also inherited by roles cloned from the system roles.
const SEEDED_DESCRIPTIONS: Record<string, string> = {
  "protected system super administrator role": "受保护的系统超级管理员角色",
  "protected system administrator role": "受保护的系统管理员角色"
};

export function permissionCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Built-in permissions are seeded in English; show the Chinese name and fall back to the stored name. */
export function permissionLabel(permission: { key: string; name: string }): string {
  return PERMISSION_LABELS[permission.key] ?? permission.name;
}

export function roleDescriptionLabel(role: { slug: string; description?: string | null; isSystem?: boolean }): string | null {
  const seeded = role.description ? SEEDED_DESCRIPTIONS[role.description.trim().toLowerCase()] : undefined;
  if (seeded) return seeded;
  if (!role.description) return SYSTEM_ROLE_DESCRIPTIONS[role.slug] ?? null;
  return role.description;
}
