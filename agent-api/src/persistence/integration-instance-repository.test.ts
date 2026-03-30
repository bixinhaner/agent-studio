import { describe, expect, it } from "vitest";

import { IntegrationInstanceRepository } from "./integration-instance-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeIntegrationInstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type FakeIntegrationInstanceConfigRow = {
  id: string;
  integrationInstanceId: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type FakeIntegrationInstanceSecretRow = {
  id: string;
  integrationInstanceId: string;
  hasSecrets: boolean;
  secretState: unknown;
  rotatedAt: Date | null;
  rotatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeIntegrationValidationRunRow = {
  id: string;
  integrationInstanceId: string;
  triggerType: string;
  status: string;
  summary: unknown;
  detail: unknown;
  triggeredByUserId: string | null;
  createdAt: Date;
};

type FakeIntegrationBindingRecordRow = {
  id: string;
  integrationInstanceId: string;
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: Date;
  updatedAt: Date;
};

class FakeIntegrationInstanceDb {
  private instanceCounter = 0;
  private configCounter = 0;
  private secretCounter = 0;
  private validationCounter = 0;
  private bindingCounter = 0;

  readonly instances: FakeIntegrationInstanceRow[] = [];
  readonly configs: FakeIntegrationInstanceConfigRow[] = [];
  readonly secrets: FakeIntegrationInstanceSecretRow[] = [];
  readonly validations: FakeIntegrationValidationRunRow[] = [];
  readonly bindings: FakeIntegrationBindingRecordRow[] = [];

  readonly integrationInstance = {
    findUnique: async ({ where }: { where: { id?: string; type_slug?: { type: string; slug: string } } }) => {
      const row = this.instances.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.type_slug) return item.type === where.type_slug.type && item.slug === where.type_slug.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { type?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.instances.filter((item) => (where?.type ? item.type === where.type : true));
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeIntegrationInstanceRow = {
        id: typeof data.id === "string" ? data.id : `integration-instance-${++this.instanceCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        type: typeof data.type === "string" ? data.type : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        name: typeof data.name === "string" ? data.name : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : "draft",
        isSystemSingleton: typeof data.isSystemSingleton === "boolean" ? data.isSystemSingleton : false,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.instances.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.instances.find((item) => item.id === where.id);
      if (!row) throw new Error("integration instance not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly integrationInstanceConfig = {
    findUnique: async ({ where }: { where: { integrationInstanceId: string } }) => {
      const row = this.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
      return row ? clone(row) : null;
    },
    upsert: async ({
      where,
      create,
      update
    }: {
      where: { integrationInstanceId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = this.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
      if (existing) {
        Object.assign(existing, clone(update));
        existing.updatedAt = update.updatedAt instanceof Date ? update.updatedAt : new Date();
        return clone(existing);
      }
      const now = new Date();
      const row: FakeIntegrationInstanceConfigRow = {
        id: typeof create.id === "string" ? create.id : `integration-instance-config-${++this.configCounter}`,
        integrationInstanceId:
          typeof create.integrationInstanceId === "string" ? create.integrationInstanceId : where.integrationInstanceId,
        config: clone(create.config),
        createdAt: create.createdAt instanceof Date ? create.createdAt : now,
        updatedAt: create.updatedAt instanceof Date ? create.updatedAt : now
      };
      this.configs.push(row);
      return clone(row);
    }
  };

  readonly integrationInstanceSecret = {
    findUnique: async ({ where }: { where: { integrationInstanceId: string } }) => {
      const row = this.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId);
      return row ? clone(row) : null;
    },
    upsert: async ({
      where,
      create,
      update
    }: {
      where: { integrationInstanceId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = this.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId);
      if (existing) {
        Object.assign(existing, clone(update));
        existing.updatedAt = update.updatedAt instanceof Date ? update.updatedAt : new Date();
        return clone(existing);
      }
      const now = new Date();
      const row: FakeIntegrationInstanceSecretRow = {
        id: typeof create.id === "string" ? create.id : `integration-instance-secret-${++this.secretCounter}`,
        integrationInstanceId:
          typeof create.integrationInstanceId === "string" ? create.integrationInstanceId : where.integrationInstanceId,
        hasSecrets: typeof create.hasSecrets === "boolean" ? create.hasSecrets : true,
        secretState: clone(create.secretState),
        rotatedAt: create.rotatedAt instanceof Date ? create.rotatedAt : null,
        rotatedByUserId: typeof create.rotatedByUserId === "string" ? create.rotatedByUserId : null,
        createdAt: create.createdAt instanceof Date ? create.createdAt : now,
        updatedAt: create.updatedAt instanceof Date ? create.updatedAt : now
      };
      this.secrets.push(row);
      return clone(row);
    }
  };

  readonly integrationValidationRun = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { integrationInstanceId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.validations.filter((item) => item.integrationInstanceId === where.integrationInstanceId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeIntegrationValidationRunRow = {
        id: typeof data.id === "string" ? data.id : `integration-validation-${++this.validationCounter}`,
        integrationInstanceId:
          typeof data.integrationInstanceId === "string" ? data.integrationInstanceId : "",
        triggerType: typeof data.triggerType === "string" ? data.triggerType : "",
        status: typeof data.status === "string" ? data.status : "",
        summary: clone(data.summary),
        detail: clone(data.detail),
        triggeredByUserId: typeof data.triggeredByUserId === "string" ? data.triggeredByUserId : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.validations.push(row);
      return clone(row);
    }
  };

  readonly integrationBindingRecord = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { integrationInstanceId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.bindings.filter((item) => item.integrationInstanceId === where.integrationInstanceId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { integrationInstanceId: string } }) => {
      const before = this.bindings.length;
      this.bindings.splice(0, this.bindings.length, ...this.bindings.filter((item) => item.integrationInstanceId !== where.integrationInstanceId));
      return { count: before - this.bindings.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeIntegrationBindingRecordRow = {
        id: typeof data.id === "string" ? data.id : `integration-binding-${++this.bindingCounter}`,
        integrationInstanceId:
          typeof data.integrationInstanceId === "string" ? data.integrationInstanceId : "",
        targetType: typeof data.targetType === "string" ? data.targetType : "",
        targetId: typeof data.targetId === "string" ? data.targetId : "",
        bindingType: typeof data.bindingType === "string" ? data.bindingType : "",
        bindingPayload: clone(data.bindingPayload),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.bindings.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeIntegrationInstanceDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("IntegrationInstanceRepository", () => {
  it("enforces singleton instance types for dingtalk and openai_codex while allowing zendesk multiples", async () => {
    const repository = new IntegrationInstanceRepository(new FakeIntegrationInstanceDb() as never);

    const dingtalk = await repository.createInstance({
      type: "dingtalk",
      slug: "corp-main",
      name: "Corp Main"
    });
    expect(dingtalk.isSystemSingleton).toBe(true);
    await expect(
      repository.createInstance({
        type: "dingtalk",
        slug: "corp-secondary",
        name: "Corp Secondary"
      })
    ).rejects.toThrow(/single-instance/i);

    await repository.createInstance({
      type: "openai_codex",
      slug: "codex-primary",
      name: "Codex Primary"
    });
    await expect(
      repository.createInstance({
        type: "openai_codex",
        slug: "codex-secondary",
        name: "Codex Secondary"
      })
    ).rejects.toThrow(/single-instance/i);

    const firstZendesk = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-a",
      name: "Zendesk A"
    });
    const secondZendesk = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-b",
      name: "Zendesk B"
    });
    expect(secondZendesk.id).not.toBe(firstZendesk.id);
  });

  it("stores secret rotation metadata without exposing secret payload in summary reads", async () => {
    const repository = new IntegrationInstanceRepository(new FakeIntegrationInstanceDb() as never);
    const instance = await repository.createInstance({
      type: "openai_codex",
      slug: "primary",
      name: "Primary"
    });

    await repository.rotateSecrets(instance.id, {
      payload: { apiKey: "sk-test" },
      rotatedByUserId: "user-1"
    });
    await repository.clearSecrets(instance.id, {
      clearedByUserId: "user-2"
    });

    const summary = await repository.getInstance(instance.id);
    expect(summary?.secretState.hasSecrets).toBe(false);
    expect(summary?.secretState.rotatedByUserId).toBe("user-1");
    expect(summary?.secretState.rotatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(summary)).not.toContain("sk-test");
  });

  it("updates integration instance fields for lifecycle changes", async () => {
    const repository = new IntegrationInstanceRepository(new FakeIntegrationInstanceDb() as never);
    const instance = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-main",
      name: "Zendesk Main",
      description: " Initial description ",
      status: "draft"
    });

    const updated = await repository.updateInstance(instance.id, {
      name: "Zendesk Primary",
      description: " Support line ",
      status: "disabled"
    });

    expect(updated).toMatchObject({
      name: "Zendesk Primary",
      description: "Support line",
      status: "disabled"
    });

    const detail = await repository.getInstance(instance.id);
    expect(detail).toMatchObject({
      name: "Zendesk Primary",
      description: "Support line",
      status: "disabled"
    });
  });

  it("records validation history in reverse chronological order", async () => {
    const repository = new IntegrationInstanceRepository(new FakeIntegrationInstanceDb() as never);
    const instance = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-main",
      name: "Zendesk Main"
    });

    await repository.recordValidation(instance.id, {
      triggerType: "automatic",
      status: "failed",
      summary: { checked: 2 },
      detail: { error: "timeout" },
      triggeredByUserId: null
    });
    await repository.recordValidation(instance.id, {
      triggerType: "manual",
      status: "success",
      summary: { checked: 5 },
      detail: { message: "ok" },
      triggeredByUserId: "admin-1"
    });

    const detail = await repository.getInstance(instance.id);
    expect(detail?.validationHistory).toEqual([
      expect.objectContaining({
        triggerType: "manual",
        status: "success",
        summary: { checked: 5 },
        detail: { message: "ok" },
        triggeredByUserId: "admin-1"
      }),
      expect.objectContaining({
        triggerType: "automatic",
        status: "failed",
        summary: { checked: 2 },
        detail: { error: "timeout" },
        triggeredByUserId: undefined
      })
    ]);
  });

  it("replaces bindings for an instance without affecting other instance bindings", async () => {
    const db = new FakeIntegrationInstanceDb();
    const repository = new IntegrationInstanceRepository(db as never);

    const first = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-a",
      name: "Zendesk A"
    });
    const second = await repository.createInstance({
      type: "zendesk",
      slug: "zendesk-b",
      name: "Zendesk B"
    });

    await repository.replaceBindings(first.id, [
      {
        targetType: "agent_mode",
        targetId: "mode-support",
        bindingType: "primary",
        bindingPayload: { priority: 1 }
      },
      {
        targetType: "workspace",
        targetId: "workspace-support",
        bindingType: "fallback",
        bindingPayload: { enabled: true }
      }
    ]);

    await repository.replaceBindings(first.id, [
      {
        targetType: "agent_mode",
        targetId: "mode-support",
        bindingType: "primary",
        bindingPayload: { priority: 2 }
      }
    ]);

    const detail = await repository.getInstance(first.id);
    expect(detail?.bindings).toEqual([
      expect.objectContaining({
        targetType: "agent_mode",
        targetId: "mode-support",
        bindingType: "primary",
        bindingPayload: { priority: 2 }
      })
    ]);
    expect(await repository.listBindings(second.id)).toEqual([]);
  });
});
