import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Popconfirm, Select, Skeleton, Space, Table, Tag, message } from "antd";

import { formatAdminDate, formatAdminDateTime } from "../../lib/formatters";
import type { TeamOverview } from "../portal/roadmap/team-api";
import {
  adminChangeOrgMemberRole,
  adminDecideOrgJoinRequest,
  adminInviteOrgMember,
  adminRemoveOrgMember,
  adminRevokeOrgInvite,
  adminSetOrgInviteDomains,
  fetchAdminOrgTeam,
  orgTeamActorLabel,
  orgTeamEventLabel,
  orgTeamEventSummary,
  type OrgTeamEvent
} from "./org-team-api";

const ROLE_OPTIONS = [
  { value: "customer_member", label: "成员" },
  { value: "customer_admin", label: "组织管理员" }
];

/**
 * Platform-admin view of one customer organization's team: roles, seats, invite domains, join requests
 * and the audit trail of what customer admins did.
 */
export function OrganizationTeamDrawer(props: {
  organizationId: string | null;
  organizationName?: string;
  isNarrowScreen: boolean;
  onClose(): void;
  onChanged?(): void;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [events, setEvents] = useState<OrgTeamEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"customer_admin" | "customer_member">("customer_member");

  const organizationId = props.organizationId;
  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setErrorText("");
    try {
      const result = await fetchAdminOrgTeam(organizationId);
      setTeam(result.team);
      setEvents(result.events);
      // Allowed domains include the admin's own domain on the portal; the admin API returns only the extra ones.
      setDomains(result.team.allowedDomains);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setTeam(null);
    setEvents([]);
    setInviteEmail("");
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusyKey(key);
    setErrorText("");
    try {
      await action();
      void messageApi.success(success);
      await load();
      props.onChanged?.();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  const id = organizationId ?? "";
  const seatsText = team
    ? team.seats.limit === null
      ? `${team.seats.used}（不限）`
      : `${team.seats.used} / ${team.seats.limit}`
    : "";
  const quota = team?.subscription;

  return (
    <Drawer
      title={`团队管理 · ${team?.organization.name ?? props.organizationName ?? ""}`}
      placement="right"
      width={props.isNarrowScreen ? "100%" : 720}
      open={Boolean(organizationId)}
      onClose={props.onClose}
    >
      {contextHolder}
      {loading && !team ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {errorText ? <Alert type="error" showIcon message={errorText} closable onClose={() => setErrorText("")} style={{ marginBottom: 16 }} /> : null}
      {team ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="admin-entity-card-grid">
            <div>
              <div className="admin-entity-card-subtle">席位（成员 + 有效邀请）</div>
              <strong>{seatsText}</strong>
            </div>
            <div>
              <div className="admin-entity-card-subtle">套餐</div>
              <strong>{quota?.planName ?? "未分配"}</strong>
            </div>
            <div>
              <div className="admin-entity-card-subtle">本周期 AI Request</div>
              <strong>
                {quota ? `${quota.usedCompletedTurns ?? 0} / ${quota.completedTurnLimit ?? "不限"}` : "—"}
              </strong>
            </div>
            <div>
              <div className="admin-entity-card-subtle">套餐到期</div>
              <strong>{quota?.expiresAt ? formatAdminDate(quota.expiresAt) : "—"}</strong>
            </div>
          </div>
          <div style={{ color: "var(--admin-color-subtle)", fontSize: 12, marginTop: -12 }}>
            席位上限在“订阅与套餐”的套餐里设置（成员上限）；组织管理员邀请时受上限、同域名和每日 {team.invitesToday.limit} 个邀请限制，平台管理员不受限。
          </div>

          {team.joinRequests.length ? (
            <section>
              <div className="admin-page-summary-label" style={{ marginBottom: 8 }}>
                待处理的加入申请（{team.joinRequests.length}）
              </div>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={team.joinRequests}
                columns={[
                  {
                    title: "申请人",
                    render: (_, record) => (
                      <div>
                        <div>{record.contactName ? `${record.contactName} · ${record.email}` : record.email}</div>
                        {record.message ? <div style={{ color: "var(--admin-color-subtle)", fontSize: 12, whiteSpace: "pre-wrap" }}>{record.message}</div> : null}
                      </div>
                    )
                  },
                  { title: "时间", width: 150, render: (_, record) => formatAdminDateTime(record.createdAt) },
                  {
                    title: "操作",
                    width: 150,
                    render: (_, record) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          type="primary"
                          loading={busyKey === `approve:${record.id}`}
                          disabled={busyKey !== null}
                          onClick={() => void run(`approve:${record.id}`, () => adminDecideOrgJoinRequest(id, record.id, "approve"), `已批准并向 ${record.email} 发送邀请`)}
                        >
                          批准
                        </Button>
                        <Button
                          size="small"
                          loading={busyKey === `reject:${record.id}`}
                          disabled={busyKey !== null}
                          onClick={() => void run(`reject:${record.id}`, () => adminDecideOrgJoinRequest(id, record.id, "reject"), "已拒绝申请")}
                        >
                          拒绝
                        </Button>
                      </Space>
                    )
                  }
                ]}
              />
            </section>
          ) : null}

          <section>
            <div className="admin-page-summary-label" style={{ marginBottom: 8 }}>
              成员（{team.members.length}）
            </div>
            <Table
              size="small"
              rowKey="membershipId"
              pagination={false}
              dataSource={team.members}
              locale={{ emptyText: <Empty description="暂无成员" /> }}
              columns={[
                {
                  title: "成员",
                  render: (_, record) => (
                    <div>
                      <div>{record.displayName || record.email || record.userId}</div>
                      {record.displayName && record.email ? <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>{record.email}</div> : null}
                    </div>
                  )
                },
                {
                  title: "角色",
                  width: 150,
                  render: (_, record) => (
                    <Select
                      size="small"
                      style={{ width: 130 }}
                      value={record.membershipType}
                      options={ROLE_OPTIONS}
                      disabled={busyKey !== null}
                      onChange={(value) =>
                        void run(
                          `role:${record.membershipId}`,
                          () => adminChangeOrgMemberRole(id, record.membershipId, value),
                          `已将 ${record.email ?? "成员"} 调整为${value === "customer_admin" ? "组织管理员" : "成员"}`
                        )
                      }
                    />
                  )
                },
                { title: "加入时间", width: 120, render: (_, record) => (record.joinedAt ? formatAdminDate(record.joinedAt) : "—") },
                {
                  title: "",
                  width: 70,
                  render: (_, record) => (
                    <Popconfirm
                      title={`移除 ${record.email ?? "该成员"}？`}
                      description="移除后立即失去该组织的访问权限，可重新邀请。"
                      okText="移除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => run(`remove:${record.membershipId}`, () => adminRemoveOrgMember(id, record.membershipId), `已移除 ${record.email ?? "成员"}`)}
                    >
                      <Button size="small" type="link" danger disabled={busyKey !== null}>
                        移除
                      </Button>
                    </Popconfirm>
                  )
                }
              ]}
            />
            {!team.members.some((member) => member.membershipType === "customer_admin") ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="该组织还没有组织管理员，客户无法自助邀请同事，加入申请也只会通知平台管理员。可把负责人调整为组织管理员。"
              />
            ) : null}
          </section>

          <section>
            <div className="admin-page-summary-label" style={{ marginBottom: 8 }}>
              邀请成员
            </div>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="name@company.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <Select value={inviteRole} style={{ width: 130 }} options={ROLE_OPTIONS} onChange={setInviteRole} />
              <Button
                type="primary"
                disabled={!inviteEmail.trim() || busyKey !== null}
                loading={busyKey === "invite"}
                onClick={() =>
                  void run(
                    "invite",
                    async () => {
                      await adminInviteOrgMember(id, inviteEmail.trim(), inviteRole);
                      setInviteEmail("");
                    },
                    `已向 ${inviteEmail.trim()} 发送邀请`
                  )
                }
              >
                发送邀请
              </Button>
            </Space.Compact>
            {team.invites.length ? (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                style={{ marginTop: 12 }}
                dataSource={team.invites}
                columns={[
                  { title: "邀请邮箱", dataIndex: "email" },
                  {
                    title: "状态",
                    width: 150,
                    render: (_, record) =>
                      record.status === "expired" ? <Tag>已过期</Tag> : <Tag color="blue">{formatAdminDate(record.expiresAt)} 过期</Tag>
                  },
                  { title: "邀请人", width: 160, render: (_, record) => record.invitedByEmail ?? "—" },
                  {
                    title: "",
                    width: 70,
                    render: (_, record) => (
                      <Button
                        size="small"
                        type="link"
                        danger
                        disabled={busyKey !== null}
                        onClick={() => void run(`revoke:${record.id}`, () => adminRevokeOrgInvite(id, record.id), `已撤销发给 ${record.email} 的邀请`)}
                      >
                        撤销
                      </Button>
                    )
                  }
                ]}
              />
            ) : null}
          </section>

          <section>
            <div className="admin-page-summary-label" style={{ marginBottom: 4 }}>
              额外允许邀请的邮箱域名
            </div>
            <div style={{ color: "var(--admin-color-subtle)", fontSize: 12, marginBottom: 8 }}>
              组织管理员默认只能邀请与自己邮箱同域名的同事；客户有子公司或多个域名时在这里补充。公共邮箱（gmail.com 等）不能添加。该域名的人申请试用时也会被引导申请加入本组织。
            </div>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                mode="tags"
                style={{ width: "100%" }}
                value={domains}
                tokenSeparators={[",", " "]}
                placeholder="例如 opticoms.com"
                onChange={(values: string[]) => setDomains(values.map((value) => value.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))}
                open={false}
                suffixIcon={null}
              />
              <Button
                loading={busyKey === "domains"}
                disabled={busyKey !== null}
                onClick={() => void run("domains", () => adminSetOrgInviteDomains(id, domains), "已保存邀请域名")}
              >
                保存
              </Button>
            </Space.Compact>
          </section>

          <section>
            <div className="admin-page-summary-label" style={{ marginBottom: 8 }}>
              团队操作记录
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={events.length > 10 ? { pageSize: 10, size: "small" } : false}
              dataSource={events}
              locale={{ emptyText: <Empty description="暂无记录" /> }}
              columns={[
                { title: "时间", width: 150, render: (_, record) => formatAdminDateTime(record.createdAt) },
                { title: "操作", width: 100, render: (_, record) => orgTeamEventLabel(record.eventType) },
                {
                  title: "操作人",
                  width: 190,
                  render: (_, record) => (
                    <div>
                      <div>{orgTeamActorLabel(record.actorType)}</div>
                      {record.actorEmail ? <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>{record.actorEmail}</div> : null}
                    </div>
                  )
                },
                { title: "内容", render: (_, record) => orgTeamEventSummary(record) }
              ]}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
