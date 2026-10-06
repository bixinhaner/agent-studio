import type { UsageUserTotals } from "../persistence/usage-event-repository.js";
import { isValidTimezone } from "../scheduled-tasks/schedule.js";
import { PERSONAL_USAGE_PERIODS, periodRange, type PersonalUsagePeriod, type PersonalUsageSummary } from "./personal-usage-service.js";

/**
 * Usage ranking and manager (team) views for the portal "my usage" drawer.
 *
 * Scope follows the synced DingTalk directory only:
 * - manager chain: everyone whose manager_userid (directly or indirectly) points at the viewer;
 * - department leader: everyone in a department (and its sub-departments) the viewer leads.
 * It is read-only over usage_events via the shared ledger and never records usage.
 */

type DirectoryUser = { id: string; displayName: string | null; email: string | null; dingtalkUserId: string | null };
type DirectoryProfile = { userId: string; managerDingTalkUserId: string | null; title: string | null };
type DirectoryMembership = { userId: string; departmentId: string; isPrimary: boolean; isLeader: boolean | null; sortOrder: number | null };
type DirectoryDepartment = { id: string; name: string; parentDepartmentId: string | null; status: string };

export type OrgDirectory = {
  users: DirectoryUser[];
  profiles: DirectoryProfile[];
  memberships: DirectoryMembership[];
  departments: DirectoryDepartment[];
};

export type TeamRelation = "direct" | "indirect" | "department";

type Db = {
  user: { findMany(args: unknown): Promise<DirectoryUser[]> };
  enterpriseUserProfile: { findMany(args: unknown): Promise<DirectoryProfile[]> };
  departmentMembership: { findMany(args: unknown): Promise<DirectoryMembership[]> };
  department: { findMany(args: unknown): Promise<DirectoryDepartment[]> };
};

type Ledger = { sumByUserInRange(input: { from: Date; to: Date; userIds?: string[] }): Promise<UsageUserTotals[]> };
type PersonalUsage = { summarize(input: { userId: string; period?: string; timezone?: string }): Promise<PersonalUsageSummary> };

export type UsageRankEntry = { rank: number | null; size: number; active: number };

export type UsageRankingResponse = {
  period: PersonalUsagePeriod;
  timezone: string;
  total_tokens: number;
  department: (UsageRankEntry & { id: string; name: string }) | null;
  company: UsageRankEntry;
  team: { available: boolean; size: number };
};

export type TeamUsageMember = {
  user_id: string;
  name: string;
  title: string | null;
  department: string | null;
  relation: TeamRelation;
  total_tokens: number;
  turns: number;
  tasks: number;
  last_active_at: string | null;
};

export type TeamUsageResponse = {
  period: PersonalUsagePeriod;
  timezone: string;
  totals: { members: number; active_members: number; total_tokens: number; turns: number; tasks: number };
  members: TeamUsageMember[];
};

export class TeamUsageAccessError extends Error {}

export function normalizePeriod(period: string | undefined): PersonalUsagePeriod {
  return (PERSONAL_USAGE_PERIODS as readonly string[]).includes(period ?? "") ? (period as PersonalUsagePeriod) : "month";
}

export function normalizeTimezone(timezone: string | undefined): string {
  return timezone && isValidTimezone(timezone) ? timezone : "Asia/Shanghai";
}

/** People the viewer may see, keyed by user id, with the closest relation. Never includes the viewer. */
export function resolveTeamScope(directory: OrgDirectory, viewerId: string): Map<string, TeamRelation> {
  const activeIds = new Set(directory.users.map((user) => user.id));
  const userIdByDingTalkId = new Map<string, string>();
  for (const user of directory.users) {
    if (user.dingtalkUserId) userIdByDingTalkId.set(user.dingtalkUserId, user.id);
  }
  const reports = new Map<string, string[]>();
  for (const profile of directory.profiles) {
    const managerId = profile.managerDingTalkUserId ? userIdByDingTalkId.get(profile.managerDingTalkUserId) : undefined;
    if (!managerId || managerId === profile.userId) continue;
    reports.set(managerId, [...(reports.get(managerId) ?? []), profile.userId]);
  }

  const scope = new Map<string, TeamRelation>();
  // Manager chain (BFS; the visited set also guards against cycles in directory data).
  let frontier = reports.get(viewerId) ?? [];
  let depth = 0;
  const visited = new Set<string>([viewerId]);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const userId of frontier) {
      if (visited.has(userId)) continue;
      visited.add(userId);
      if (activeIds.has(userId)) scope.set(userId, depth === 0 ? "direct" : "indirect");
      next.push(...(reports.get(userId) ?? []));
    }
    frontier = next;
    depth += 1;
  }

  // Department leadership covers the led department and all its sub-departments.
  const children = new Map<string, string[]>();
  for (const department of directory.departments) {
    if (department.status !== "active" || !department.parentDepartmentId) continue;
    children.set(department.parentDepartmentId, [...(children.get(department.parentDepartmentId) ?? []), department.id]);
  }
  const ledDepartments = new Set<string>();
  const stack = directory.memberships.filter((item) => item.userId === viewerId && item.isLeader).map((item) => item.departmentId);
  while (stack.length > 0) {
    const departmentId = stack.pop()!;
    if (ledDepartments.has(departmentId)) continue;
    ledDepartments.add(departmentId);
    stack.push(...(children.get(departmentId) ?? []));
  }
  for (const membership of directory.memberships) {
    if (membership.userId === viewerId || !ledDepartments.has(membership.departmentId)) continue;
    if (activeIds.has(membership.userId) && !scope.has(membership.userId)) scope.set(membership.userId, "department");
  }
  return scope;
}

export function primaryDepartmentId(directory: OrgDirectory, userId: string): string | null {
  const activeDepartments = new Set(directory.departments.filter((item) => item.status === "active").map((item) => item.id));
  const memberships = directory.memberships
    .filter((item) => item.userId === userId && activeDepartments.has(item.departmentId))
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  return memberships[0]?.departmentId ?? null;
}

/** Competition rank by total tokens ("1, 2, 2, 4"); viewers with no usage are unranked. */
export function rankAmong(memberIds: Iterable<string>, viewerId: string, tokensByUser: Map<string, number>): UsageRankEntry {
  const ids = [...new Set(memberIds)];
  const mine = tokensByUser.get(viewerId) ?? 0;
  let ahead = 0;
  let active = 0;
  for (const id of ids) {
    const tokens = tokensByUser.get(id) ?? 0;
    if (tokens > 0) active += 1;
    if (id !== viewerId && tokens > mine) ahead += 1;
  }
  return { rank: mine > 0 ? ahead + 1 : null, size: ids.length, active };
}

export function createTeamUsageService(deps: { db: Db; ledger: Ledger; personalUsage: PersonalUsage; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function loadDirectory(): Promise<OrgDirectory> {
    const [users, profiles, memberships, departments] = await Promise.all([
      deps.db.user.findMany({
        where: { userType: "internal_employee", status: "active" },
        select: { id: true, displayName: true, email: true, dingtalkUserId: true }
      }),
      deps.db.enterpriseUserProfile.findMany({ select: { userId: true, managerDingTalkUserId: true, title: true } }),
      deps.db.departmentMembership.findMany({ select: { userId: true, departmentId: true, isPrimary: true, isLeader: true, sortOrder: true } }),
      deps.db.department.findMany({ select: { id: true, name: true, parentDepartmentId: true, status: true } })
    ]);
    return { users, profiles, memberships, departments };
  }

  function range(period: PersonalUsagePeriod, timezone: string) {
    const { from, to } = periodRange(period, now(), timezone);
    return { from, to };
  }

  function requireViewer(viewerId: string) {
    // An empty id would match nobody's scope but could widen ledger filters.
    if (!viewerId?.trim()) throw new Error("A signed-in user is required");
  }

  return {
    async ranking(input: { viewerId: string; period?: string; timezone?: string }): Promise<UsageRankingResponse> {
      requireViewer(input.viewerId);
      const period = normalizePeriod(input.period);
      const timezone = normalizeTimezone(input.timezone);
      const directory = await loadDirectory();
      const companyIds = directory.users.map((user) => user.id);
      const totals = await deps.ledger.sumByUserInRange({ ...range(period, timezone), userIds: companyIds });
      const tokensByUser = new Map(totals.map((row) => [row.userId, row.totalTokens]));

      const departmentId = primaryDepartmentId(directory, input.viewerId);
      const department = departmentId ? directory.departments.find((item) => item.id === departmentId) : undefined;
      const activeIds = new Set(companyIds);
      const departmentMembers = departmentId
        ? directory.memberships.filter((item) => item.departmentId === departmentId && activeIds.has(item.userId)).map((item) => item.userId)
        : [];
      const scope = resolveTeamScope(directory, input.viewerId);
      return {
        period,
        timezone,
        total_tokens: tokensByUser.get(input.viewerId) ?? 0,
        department: department
          ? { id: department.id, name: department.name, ...rankAmong([...departmentMembers, input.viewerId], input.viewerId, tokensByUser) }
          : null,
        company: rankAmong(activeIds.has(input.viewerId) ? companyIds : [...companyIds, input.viewerId], input.viewerId, tokensByUser),
        team: { available: scope.size > 0, size: scope.size }
      };
    },

    async team(input: { viewerId: string; period?: string; timezone?: string }): Promise<TeamUsageResponse> {
      requireViewer(input.viewerId);
      const period = normalizePeriod(input.period);
      const timezone = normalizeTimezone(input.timezone);
      const directory = await loadDirectory();
      const scope = resolveTeamScope(directory, input.viewerId);
      if (scope.size === 0) throw new TeamUsageAccessError("No team members in your DingTalk directory scope");
      const totals = await deps.ledger.sumByUserInRange({ ...range(period, timezone), userIds: [...scope.keys()] });
      const totalsByUser = new Map(totals.map((row) => [row.userId, row]));
      const usersById = new Map(directory.users.map((user) => [user.id, user]));
      const titleByUser = new Map(directory.profiles.map((profile) => [profile.userId, profile.title]));
      const departmentNames = new Map(directory.departments.map((item) => [item.id, item.name]));

      const members: TeamUsageMember[] = [...scope.entries()].map(([userId, relation]) => {
        const user = usersById.get(userId);
        const usage = totalsByUser.get(userId);
        const departmentId = primaryDepartmentId(directory, userId);
        return {
          user_id: userId,
          name: user?.displayName?.trim() || user?.email?.trim() || userId,
          title: titleByUser.get(userId)?.trim() || null,
          department: departmentId ? departmentNames.get(departmentId) ?? null : null,
          relation,
          total_tokens: usage?.totalTokens ?? 0,
          turns: usage?.turns ?? 0,
          tasks: usage?.tasks ?? 0,
          last_active_at: usage?.lastActiveAt ?? null
        };
      });
      members.sort((left, right) => right.total_tokens - left.total_tokens || right.turns - left.turns || left.name.localeCompare(right.name, "zh"));
      return {
        period,
        timezone,
        totals: {
          members: members.length,
          active_members: members.filter((item) => item.turns > 0).length,
          total_tokens: members.reduce((sum, item) => sum + item.total_tokens, 0),
          turns: members.reduce((sum, item) => sum + item.turns, 0),
          tasks: members.reduce((sum, item) => sum + item.tasks, 0)
        },
        members
      };
    },

    async member(input: { viewerId: string; memberId: string; period?: string; timezone?: string }) {
      requireViewer(input.viewerId);
      const directory = await loadDirectory();
      const relation = resolveTeamScope(directory, input.viewerId).get(input.memberId);
      if (!relation) throw new TeamUsageAccessError("This person is outside your DingTalk directory scope");
      const user = directory.users.find((item) => item.id === input.memberId);
      const departmentId = primaryDepartmentId(directory, input.memberId);
      const usage = await deps.personalUsage.summarize({ userId: input.memberId, period: input.period, timezone: input.timezone });
      return {
        member: {
          user_id: input.memberId,
          name: user?.displayName?.trim() || user?.email?.trim() || input.memberId,
          title: directory.profiles.find((item) => item.userId === input.memberId)?.title?.trim() || null,
          department: departmentId ? directory.departments.find((item) => item.id === departmentId)?.name ?? null : null,
          relation
        },
        usage
      };
    }
  };
}
