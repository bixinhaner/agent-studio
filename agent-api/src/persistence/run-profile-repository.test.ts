import { describe, expect, it } from "vitest";

import { RunProfileRepository } from "./run-profile-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeRunProfileRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  defaultModel: string;
  allowedModels: unknown;
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  createdAt: Date;
  updatedAt: Date;
};

class FakeRunProfileDb {
  private counter = 0;

  constructor(readonly rows: FakeRunProfileRow[] = []) {}

  readonly runProfile = {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.rows.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } } = {}) => {
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
      const row: FakeRunProfileRow = {
        id: typeof data.id === "string" ? data.id : `run-profile-${++this.counter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        name: typeof data.name === "string" ? data.name : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : null,
        defaultModel: typeof data.defaultModel === "string" ? data.defaultModel : "",
        allowedModels: clone(data.allowedModels),
        defaultReasoningEffort: typeof data.defaultReasoningEffort === "string" ? data.defaultReasoningEffort : "",
        sandboxMode: typeof data.sandboxMode === "string" ? data.sandboxMode : "",
        approvalPolicy: typeof data.approvalPolicy === "string" ? data.approvalPolicy : "",
        networkAccessEnabled: Boolean(data.networkAccessEnabled),
        webSearchMode: typeof data.webSearchMode === "string" ? data.webSearchMode : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) throw new Error("run profile not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };
}

describe("RunProfileRepository", () => {
  it("creates and updates run profiles with allowed model lists", async () => {
    const repository = new RunProfileRepository(new FakeRunProfileDb() as never);

    const created = await repository.create({
      name: "Coding Default",
      slug: "coding-default",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "live"
    });

    expect(created.allowedModels).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(created.status).toBe("active");

    const updated = await repository.update(created.id, {
      description: " Standard coding profile ",
      allowedModels: ["gpt-5.4-mini"],
      defaultReasoningEffort: "medium",
      networkAccessEnabled: false,
      webSearchMode: "disabled"
    });

    expect(updated).toMatchObject({
      id: created.id,
      description: "Standard coding profile",
      allowedModels: ["gpt-5.4-mini"],
      defaultReasoningEffort: "medium",
      networkAccessEnabled: false,
      webSearchMode: "disabled"
    });

    await expect(repository.get(created.id)).resolves.toEqual(updated);
    await expect(repository.list()).resolves.toEqual([updated]);
  });
});
