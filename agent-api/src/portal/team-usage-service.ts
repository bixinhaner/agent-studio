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

/** "self" marks the viewer's own row, shown when the viewer sits inside a department they lead. */
export type TeamRelation = "direct" | "indirect" | "department" | "self";

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
  /** Only belongs to a led department as a secondary ("兼") membership: listed, not counted in totals. */
  secondary: boolean;
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
  /** Empty unless the viewer leads departments in DingTalk. */
  departments: TeamDepartmentNode[];
};

export class TeamUsageAccessError extends Error {}

export function normalizePeriod(period: string | undefined): PersonalUsagePeriod {
  return (PERSONAL_USAGE_PERIODS as readonly string[]).includes(period ?? "") ? (period as PersonalUsagePeriod) : "month";
}

export function normalizeTimezone(timezone: string | undefined): string {
  return timezone && isValidTimezone(timezone) ? timezone : "Asia/Shanghai";
}

/**
 * Preview grants from TEAM_USAGE_PREVIEW_GRANTS, e.g.
 * "userId:departmentId|departmentId:2026-10-07;otherUser:dept" (no date = no expiry).
 * "*" as a department id stands for every active top-level department (whole-company preview).
 * Each grant treats the viewer as leader of those departments, until the end of the given
 * UTC date when one is set; malformed or expired entries are ignored.
 */
export function parsePreviewGrants(raw: string | undefined, now: Date): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const entry of (raw ?? "").split(";")) {
    const [userId, departments, until] = entry.split(":").map((part) => part?.trim() ?? "");
    if (!userId || !departments) continue;
    if (until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) continue;
      const expiresAt = Date.parse(`${until}T23:59:59.999Z`);
      if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) continue;
    }
    const ids = departments.split("|").map((id) => id.trim()).filter(Boolean);
    grants.set(userId, [...(grants.get(userId) ?? []), ...ids]);
  }
  return grants;
}

/** People the viewer may see, keyed by user id, with the closest relation. Never includes the viewer. */
export function resolveTeamScope(directory: OrgDirectory, viewerId: string, extraLedDepartmentIds: string[] = []): Map<string, TeamRelation> {
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

  const { led } = ledDepartmentTree(directory, viewerId, extraLedDepartmentIds);
  for (const membership of directory.memberships) {
    if (membership.userId === viewerId || !led.has(membership.departmentId)) continue;
    if (activeIds.has(membership.userId) && !scope.has(membership.userId)) scope.set(membership.userId, "department");
  }
  return scope;
}

/** Departments the viewer leads (DingTalk leader flag or preview grant) plus all active sub-departments. */
export function ledDepartmentTree(directory: OrgDirectory, viewerId: string, extraLedDepartmentIds: string[] = []) {
  const active = new Set(directory.departments.filter((item) => item.status === "active").map((item) => item.id));
  const children = new Map<string, string[]>();
  for (const department of directory.departments) {
    if (!active.has(department.id) || !department.parentDepartmentId) continue;
    children.set(department.parentDepartmentId, [...(children.get(department.parentDepartmentId) ?? []), department.id]);
  }
  const led = new Set<string>();
  const stack = [
    ...directory.memberships.filter((item) => item.userId === viewerId && item.isLeader).map((item) => item.departmentId),
    ...extraLedDepartmentIds.flatMap((id) =>
      id === "*" ? directory.departments.filter((item) => !item.parentDepartmentId).map((item) => item.id) : [id]
    )
  ].filter((id) => active.has(id));
  while (stack.length > 0) {
    const departmentId = stack.pop()!;
    if (led.has(departmentId)) continue;
    led.add(departmentId);
    stack.push(...(children.get(departmentId) ?? []));
  }
  return { led, children };
}

export type TeamDepartmentNode = {
  id: string;
  name: string;
  /** Parent within the viewer's led tree; null for the departments the viewer leads at the top. */
  parent_id: string | null;
  /**
   * People attributed to this department or its sub-departments. Each person is attributed
   * to exactly one department, so sibling departments add up to their parent.
   */
  member_ids: string[];
  /** People who also belong here ("兼") but are attributed to another department; listed, not counted. */
  secondary_ids: string[];
  members: number;
  active_members: number;
  total_tokens: number;
  turns: number;
  tasks: number;
};

function departmentDepths(directory: OrgDirectory): Map<string, number> {
  const parentById = new Map(directory.departments.map((item) => [item.id, item.parentDepartmentId]));
  const depths = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parent = parentById.get(id);
    const depth = parent && parentById.has(parent) && !seen.has(parent) ? depthOf(parent, seen.add(id)) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  for (const department of directory.departments) depthOf(department.id);
  return depths;
}

/**
 * The single active department a person's usage counts toward, independent of who is viewing:
 * 1. the highest department they lead; 2. their DingTalk primary department;
 * 3. their highest department, then DingTalk sort order.
 */
export function attributeDepartments(directory: OrgDirectory, userIds: Set<string>): Map<string, string> {
  const depths = departmentDepths(directory);
  const active = new Set(directory.departments.filter((item) => item.status === "active").map((item) => item.id));
  const candidates = new Map<string, DirectoryMembership[]>();
  for (const membership of directory.memberships) {
    if (!active.has(membership.departmentId) || !userIds.has(membership.userId)) continue;
    candidates.set(membership.userId, [...(candidates.get(membership.userId) ?? []), membership]);
  }
  const result = new Map<string, string>();
  for (const [userId, memberships] of candidates) {
    const [best] = [...memberships].sort(
      (left, right) =>
        Number(Boolean(right.isLeader)) - Number(Boolean(left.isLeader)) ||
        (left.isLeader ? (depths.get(left.departmentId) ?? 0) - (depths.get(right.departmentId) ?? 0) : 0) ||
        Number(right.isPrimary) - Number(left.isPrimary) ||
        (depths.get(left.departmentId) ?? 0) - (depths.get(right.departmentId) ?? 0) ||
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    );
    result.set(userId, best.departmentId);
  }
  return result;
}

/**
 * Per-department aggregates over the led tree. Usage is counted once, in each person's
 * attributed department; the viewer counts too when they sit inside the tree.
 */
export function buildDepartmentBreakdown(
  directory: OrgDirectory,
  tree: { led: Set<string>; children: Map<string, string[]> },
  scope: Map<string, TeamRelation>,
  totalsByUser: Map<string, Pick<UsageUserTotals, "totalTokens" | "turns" | "tasks">>,
  viewerId?: string
): TeamDepartmentNode[] {
  const activeUsers = new Set(directory.users.map((user) => user.id));
  const eligible = new Set(scope.keys());
  if (viewerId && activeUsers.has(viewerId)) eligible.add(viewerId);
  // People attributed outside the led tree are only listed as secondary, so every department
  // shows the same numbers no matter which leader is looking.
  const attributed = attributeDepartments(directory, eligible);
  const own = new Map<string, Set<string>>();
  const belongs = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, departmentId: string, userId: string) => {
    const set = map.get(departmentId) ?? new Set<string>();
    set.add(userId);
    map.set(departmentId, set);
  };
  for (const [userId, departmentId] of attributed) if (tree.led.has(departmentId)) add(own, departmentId, userId);
  for (const membership of directory.memberships) {
    if (tree.led.has(membership.departmentId) && eligible.has(membership.userId)) add(belongs, membership.departmentId, membership.userId);
  }
  const collect = (map: Map<string, Set<string>>, cache: Map<string, Set<string>>, departmentId: string): Set<string> => {
    const cached = cache.get(departmentId);
    if (cached) return cached;
    const result = new Set(map.get(departmentId) ?? []);
    cache.set(departmentId, result);
    for (const child of tree.children.get(departmentId) ?? []) {
      if (tree.led.has(child)) for (const userId of collect(map, cache, child)) result.add(userId);
    }
    return result;
  };
  const ownCache = new Map<string, Set<string>>();
  const belongsCache = new Map<string, Set<string>>();
  const byId = new Map(directory.departments.map((item) => [item.id, item]));
  const nodes: TeamDepartmentNode[] = [];
  for (const departmentId of tree.led) {
    const department = byId.get(departmentId);
    if (!department) continue;
    const members = collect(own, ownCache, departmentId);
    const memberIds = [...members];
    const secondaryIds = [...collect(belongs, belongsCache, departmentId)].filter((userId) => !members.has(userId));
    let totalTokens = 0;
    let turns = 0;
    let tasks = 0;
    let activeMembers = 0;
    for (const userId of memberIds) {
      const usage = totalsByUser.get(userId);
      if (!usage) continue;
      totalTokens += usage.totalTokens;
      turns += usage.turns;
      tasks += usage.tasks;
      if (usage.turns > 0) activeMembers += 1;
    }
    const parentId = department.parentDepartmentId && tree.led.has(department.parentDepartmentId) ? department.parentDepartmentId : null;
    nodes.push({
      id: departmentId,
      name: department.name,
      parent_id: parentId,
      member_ids: memberIds,
      secondary_ids: secondaryIds,
      members: memberIds.length,
      active_members: activeMembers,
      total_tokens: totalTokens,
      turns,
      tasks
    });
  }
  return nodes.sort((left, right) => right.total_tokens - left.total_tokens || right.members - left.members || left.name.localeCompare(right.name, "zh"));
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

export function createTeamUsageService(deps: {
  db: Db;
  ledger: Ledger;
  personalUsage: PersonalUsage;
  now?: () => Date;
  previewGrants?: () => string | undefined;
}) {
  const now = deps.now ?? (() => new Date());

  function previewDepartments(viewerId: string) {
    return parsePreviewGrants(deps.previewGrants?.(), now()).get(viewerId) ?? [];
  }

  function scopeFor(directory: OrgDirectory, viewerId: string) {
    return resolveTeamScope(directory, viewerId, previewDepartments(viewerId));
  }

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
      const scope = scopeFor(directory, input.viewerId);
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
      const scope = scopeFor(directory, input.viewerId);
      if (scope.size === 0) throw new TeamUsageAccessError("No team members in your DingTalk directory scope");
      const totals = await deps.ledger.sumByUserInRange({ ...range(period, timezone), userIds: [...scope.keys(), input.viewerId] });
      const totalsByUser = new Map(totals.map((row) => [row.userId, row]));
      const departments = buildDepartmentBreakdown(
        directory,
        ledDepartmentTree(directory, input.viewerId, previewDepartments(input.viewerId)),
        scope,
        totalsByUser,
        input.viewerId
      );
      // The viewer is counted in department stats (and listed as "self") when they sit inside the led tree.
      const rows = new Map<string, TeamRelation>(scope);
      const counted = new Set(departments.filter((node) => !node.parent_id).flatMap((node) => node.member_ids));
      const listedOnly = new Set(departments.filter((node) => !node.parent_id).flatMap((node) => node.secondary_ids));
      if (counted.has(input.viewerId)) rows.set(input.viewerId, "self");
      const usersById = new Map(directory.users.map((user) => [user.id, user]));
      const titleByUser = new Map(directory.profiles.map((profile) => [profile.userId, profile.title]));
      const departmentNames = new Map(directory.departments.map((item) => [item.id, item.name]));

      const members: TeamUsageMember[] = [...rows.entries()].map(([userId, relation]) => {
        const user = usersById.get(userId);
        const usage = totalsByUser.get(userId);
        const departmentId = primaryDepartmentId(directory, userId);
        return {
          user_id: userId,
          name: user?.displayName?.trim() || user?.email?.trim() || userId,
          title: titleByUser.get(userId)?.trim() || null,
          department: departmentId ? departmentNames.get(departmentId) ?? null : null,
          relation,
          secondary: relation === "department" && listedOnly.has(userId) && !counted.has(userId),
          total_tokens: usage?.totalTokens ?? 0,
          turns: usage?.turns ?? 0,
          tasks: usage?.tasks ?? 0,
          last_active_at: usage?.lastActiveAt ?? null
        };
      });
      members.sort((left, right) => right.total_tokens - left.total_tokens || right.turns - left.turns || left.name.localeCompare(right.name, "zh"));
      const countedMembers = members.filter((item) => !item.secondary);
      return {
        period,
        timezone,
        totals: {
          members: countedMembers.length,
          active_members: countedMembers.filter((item) => item.turns > 0).length,
          total_tokens: countedMembers.reduce((sum, item) => sum + item.total_tokens, 0),
          turns: countedMembers.reduce((sum, item) => sum + item.turns, 0),
          tasks: countedMembers.reduce((sum, item) => sum + item.tasks, 0)
        },
        members,
        departments
      };
    },

    async member(input: { viewerId: string; memberId: string; period?: string; timezone?: string }) {
      requireViewer(input.viewerId);
      const directory = await loadDirectory();
      const relation = scopeFor(directory, input.viewerId).get(input.memberId);
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
