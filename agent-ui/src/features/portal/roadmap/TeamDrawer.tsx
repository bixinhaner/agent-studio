import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Drawer, Input, Popconfirm, Skeleton, Tag } from "antd";
import { Mail, UserPlus, Users } from "lucide-react";

import { usePortalI18n } from "../i18n";
import {
  decideTeamJoinRequest,
  fetchTeam,
  inviteTeamMember,
  removeTeamMember,
  revokeTeamInvite,
  type TeamOverview
} from "./team-api";
import { formatDomainList, isTeamFull, teamQuotaParts } from "./team-presentation";

type Notice = { tone: "success" | "error"; text: string } | null;

/** Customer admins invite colleagues, handle join requests and see the shared seats and quota. */
export function TeamDrawer(props: { open: boolean; onClose(): void }) {
  const { t, intlLocale } = usePortalI18n();
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short", day: "numeric" }), [intlLocale]);
  const formatDate = (value?: string | null) => (value ? dateFormat.format(new Date(value)) : "");
  const numberFormat = useMemo(() => new Intl.NumberFormat(intlLocale), [intlLocale]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setTeam(await fetchTeam());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("team.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!props.open) return;
    setNotice(null);
    void load();
  }, [load, props.open]);

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyKey(null);
    }
  }

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    void run(
      "invite",
      async () => {
        await inviteTeamMember(target);
        setEmail("");
      },
      t("team.inviteSent", { email: target })
    );
  }

  const full = team ? isTeamFull(team) : false;
  const quota = team ? teamQuotaParts(team.subscription) : null;
  const domains = team ? formatDomainList(team.allowedDomains) : "";
  const placeholder = team?.allowedDomains[0] ? `name@${team.allowedDomains[0]}` : "name@company.com";

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={520}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <Users size={18} aria-hidden="true" />
          {t("team.title")}
        </span>
      }
    >
      <div className="team-drawer">
        {loading && !team ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {loadError && !team ? (
          <Alert
            type="error"
            showIcon
            message={t("team.loadFailed")}
            description={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                {t("team.retry")}
              </Button>
            }
          />
        ) : null}

        {team ? (
          <>
            <p className="roadmap-muted">{t("team.subtitle", { org: team.organization.name })}</p>

            <div className="team-summary">
              <div>
                <span>{t("team.seats")}</span>
                <strong>
                  {team.seats.limit === null
                    ? t("team.seatsUnlimited", { used: team.seats.used })
                    : t("team.seatsValue", { used: team.seats.used, limit: team.seats.limit })}
                </strong>
                <small>{t("team.seatsHint")}</small>
              </div>
              <div>
                <span>{t("team.quota")}</span>
                {quota ? (
                  <>
                    <strong>
                      {quota.limit === null
                        ? t("team.quotaUnlimited", { used: numberFormat.format(quota.used) })
                        : t("team.quotaValue", { used: numberFormat.format(quota.used), limit: numberFormat.format(quota.limit) })}
                    </strong>
                    <small>
                      {[
                        quota.cycleEndsAt ? t("team.cycleEnds", { date: formatDate(quota.cycleEndsAt) }) : null,
                        quota.planName
                          ? quota.expiresAt
                            ? t("team.planEnds", { plan: quota.planName, date: formatDate(quota.expiresAt) })
                            : t("team.planActive", { plan: quota.planName })
                          : null
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </>
                ) : (
                  <strong>{t("team.noPlan")}</strong>
                )}
              </div>
            </div>

            {notice ? (
              <Alert type={notice.tone} showIcon message={notice.text} closable onClose={() => setNotice(null)} role="status" />
            ) : null}

            <form className="team-invite" onSubmit={submitInvite}>
              <label htmlFor="team-invite-email">{t("team.inviteLabel")}</label>
              <div className="team-invite-row">
                <Input
                  id="team-invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={email}
                  placeholder={placeholder}
                  disabled={full}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Button type="primary" htmlType="submit" icon={<UserPlus size={15} />} loading={busyKey === "invite"} disabled={full || !email.trim()}>
                  {t("team.inviteButton")}
                </Button>
              </div>
              <p className="roadmap-muted">
                {full ? t("team.seatsFull") : domains ? t("team.inviteDomains", { domains }) : null}{" "}
                {t("team.invitesToday", { used: team.invitesToday.used, limit: team.invitesToday.limit })}
              </p>
            </form>

            {team.joinRequests.length ? (
              <section className="team-section">
                <h3>{t("team.joinRequests", { count: team.joinRequests.length })}</h3>
                <ul>
                  {team.joinRequests.map((request) => (
                    <li key={request.id} className="team-row">
                      <div className="team-row-main">
                        <strong>{request.contactName || request.email}</strong>
                        {request.contactName ? <span>{request.email}</span> : null}
                        {request.message ? <p className="team-row-message">{request.message}</p> : null}
                      </div>
                      <div className="team-row-actions">
                        <Button
                          size="small"
                          disabled={busyKey !== null}
                          loading={busyKey === `reject:${request.id}`}
                          onClick={() =>
                            void run(`reject:${request.id}`, () => decideTeamJoinRequest(request.id, "reject"), t("team.declined", { email: request.email }))
                          }
                        >
                          {t("team.decline")}
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          disabled={busyKey !== null || full}
                          loading={busyKey === `approve:${request.id}`}
                          onClick={() =>
                            void run(`approve:${request.id}`, () => decideTeamJoinRequest(request.id, "approve"), t("team.approved", { email: request.email }))
                          }
                        >
                          {t("team.approve")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="team-section">
              <h3>{t("team.members", { count: team.members.length })}</h3>
              <ul>
                {team.members.map((member) => {
                  const label = member.email ?? member.displayName ?? member.userId;
                  const isAdmin = member.membershipType === "customer_admin";
                  return (
                    <li key={member.membershipId} className="team-row">
                      <div className="team-row-main">
                        <strong>
                          {member.displayName || label}
                          {member.isSelf ? <Tag className="team-tag">{t("team.you")}</Tag> : null}
                        </strong>
                        {member.displayName && member.email ? <span>{member.email}</span> : null}
                      </div>
                      <div className="team-row-actions">
                        <Tag color={isAdmin ? "blue" : undefined}>{isAdmin ? t("team.roleAdmin") : t("team.roleMember")}</Tag>
                        {!member.isSelf && !isAdmin ? (
                          <Popconfirm
                            title={t("team.removeConfirm", { email: label })}
                            okText={t("team.remove")}
                            cancelText={t("team.cancel")}
                            okButtonProps={{ danger: true }}
                            onConfirm={() => run(`remove:${member.membershipId}`, () => removeTeamMember(member.membershipId), t("team.removed", { email: label }))}
                          >
                            <Button size="small" type="text" danger loading={busyKey === `remove:${member.membershipId}`} disabled={busyKey !== null}>
                              {t("team.remove")}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {team.members.some((member) => member.membershipType === "customer_admin") ? (
                <p className="roadmap-muted">{t("team.adminHint")}</p>
              ) : null}
            </section>

            {team.invites.length ? (
              <section className="team-section">
                <h3>{t("team.pending", { count: team.invites.filter((invite) => invite.status === "pending").length })}</h3>
                <ul>
                  {team.invites.map((invite) => (
                    <li key={invite.id} className="team-row">
                      <div className="team-row-main">
                        <strong>
                          <Mail size={14} aria-hidden="true" /> {invite.email}
                        </strong>
                        <span>
                          {invite.status === "expired" ? t("team.expired") : t("team.expiresOn", { date: formatDate(invite.expiresAt) })}
                        </span>
                      </div>
                      <div className="team-row-actions">
                        <Button
                          size="small"
                          disabled={busyKey !== null}
                          loading={busyKey === `resend:${invite.id}`}
                          onClick={() =>
                            void run(`resend:${invite.id}`, async () => void (await inviteTeamMember(invite.email)), t("team.inviteSent", { email: invite.email }))
                          }
                        >
                          {t("team.resend")}
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          danger
                          disabled={busyKey !== null}
                          loading={busyKey === `revoke:${invite.id}`}
                          onClick={() => void run(`revoke:${invite.id}`, () => revokeTeamInvite(invite.id), t("team.revoked", { email: invite.email }))}
                        >
                          {t("team.revoke")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
