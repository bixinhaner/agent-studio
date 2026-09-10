import type { AuthUser } from "../auth/api";

// 仅控制 Portal 入口显隐，不改变后端权限、已有连接或任务绑定。
// 添加可见用户的登录邮箱后重新发布前端；空名单表示隐藏所有用户的入口。
const LOCAL_BRIDGE_VISIBLE_EMAILS: readonly string[] = ["like@baicells.com"];

export function isLocalBridgeEntryVisible(user: Pick<AuthUser, "email"> | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && LOCAL_BRIDGE_VISIBLE_EMAILS.some(value => value.trim().toLowerCase() === email));
}
