import { describe, expect, it } from "vitest";

import { WorkspaceRepository } from "./workspace-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeWorkspaceRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  sourceType: string;
  rootPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeWorkspaceDb {
  private counter = 0;

  constructor(readonly rows: FakeWorkspaceRow[] = []) {}

  readonly workspace = {
    count: async () => this.rows.length,
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.rows.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      orderBy
    }: {
      orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
    } = {}) => {
      const rows = [...this.rows];
      const [field, direction] = orderBy?.updatedAt
        ? (["updatedAt", orderBy.updatedAt] as const)
        : orderBy?.createdAt
          ? (["createdAt", orderBy.createdAt] as const)
          : (["createdAt", "asc"] as const);
      rows.sort((left, right) => {
        const diff = left[field].getTime() - right[field].getTime();
        return direction === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeWorkspaceRow = {
        id: typeof data.id === "string" ? data.id : `workspace-${++this.counter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        name: typeof data.name === "string" ? data.name : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : null,
        sourceType: typeof data.sourceType === "string" ? data.sourceType : "",
        rootPath: typeof data.rootPath === "string" ? data.rootPath : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    }
  };
}

describe("WorkspaceRepository", () => {
  it("creates a workspace and normalizes nullable strings", async () => {
    const repository = new WorkspaceRepository(new FakeWorkspaceDb() as never);

    const workspace = await repository.create({
      organizationId: "  org-1  ",
      name: "Agent Files",
      slug: "agent-files",
      description: "  ",
      status: "  ",
      sourceType: "filesystem",
      rootPath: " /srv/agent-files "
    });

    expect(workspace).toMatchObject({
      organizationId: "org-1",
      name: "Agent Files",
      slug: "agent-files",
      description: undefined,
      status: "active",
      sourceType: "filesystem",
      rootPath: "/srv/agent-files"
    });
    expect(workspace.createdAt).toMatch(/\.\d{3}Z$/);
    expect(workspace.updatedAt).toMatch(/\.\d{3}Z$/);
  });

  it("lists workspaces in created order", async () => {
    const db = new FakeWorkspaceDb([
      {
        id: "workspace-1",
        organizationId: null,
        name: "Older",
        slug: "older",
        description: null,
        status: "active",
        sourceType: "filesystem",
        rootPath: "/older",
        createdAt: new Date("2026-03-27T00:00:00.000Z"),
        updatedAt: new Date("2026-03-27T00:00:00.000Z")
      },
      {
        id: "workspace-2",
        organizationId: null,
        name: "Newer",
        slug: "newer",
        description: "Recent",
        status: null,
        sourceType: "managed_upload",
        rootPath: null,
        createdAt: new Date("2026-03-28T00:00:00.000Z"),
        updatedAt: new Date("2026-03-28T00:00:00.000Z")
      }
    ]);
    const repository = new WorkspaceRepository(db as never);

    const workspaces = await repository.list();

    expect(workspaces.map((item) => item.slug)).toEqual(["older", "newer"]);
    expect(workspaces[1]).toMatchObject({
      status: "active",
      description: "Recent",
      rootPath: undefined
    });
  });
});
