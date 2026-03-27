import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDbEnv, resetDbEnvForTests } from "../db/env.js";
import { createDbClient, getDbClient, resetDbClientForTests } from "../db/client.js";
import { importLegacyThreadsFromJson } from "./json-import.js";
import { SessionRepository } from "./session-repository.js";
import { ThreadRepository, type ThreadRecord } from "./thread-repository.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type FakeThreadRow = {
  id: string;
  userId: string | null;
  externalId: string | null;
  title: string | null;
  status: "active" | "archived";
  model: string | null;
  reasoningEffort: string | null;
  workspace: string | null;
  codexRunConfig: Record<string, unknown> | null;
  headId: string | null;
  feedback: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type FakeMessageRow = {
  id: string;
  threadId: string;
  externalId: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  parentId: string | null;
  runConfig: Record<string, unknown> | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

type FakeRuntimeSessionRow = {
  id: string;
  threadId: string | null;
  userId: string | null;
  externalId: string | null;
  status: "active" | "ended" | "failed";
  updatedAt: Date;
};

class FakePrismaClient {
  private threadCounter = 0;
  private messageCounter = 0;
  private runtimeCounter = 0;

  readonly threads: FakeThreadRow[] = [];
  readonly messages: FakeMessageRow[] = [];
  readonly runtimeSessions: FakeRuntimeSessionRow[] = [];

  readonly thread = {
    count: async () => this.threads.length,
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.threads.find((thread) => thread.id === where.id);
      return row ? clone(row) : null;
    },
    findMany: async ({ where, orderBy }: { where?: { status?: "active" | "archived"; userId?: string | null }; orderBy?: { updatedAt: "asc" | "desc" } } = {}) => {
      const rows = this.threads.filter(
        (thread) =>
          (where?.status ? thread.status === where.status : true) &&
          (where?.userId !== undefined ? thread.userId === where.userId : true)
      );
      rows.sort((left, right) => {
        const diff = left.updatedAt.getTime() - right.updatedAt.getTime();
        return orderBy?.updatedAt === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Partial<FakeThreadRow> & { feedback?: unknown } }) => {
      const now = new Date();
      const row: FakeThreadRow = {
        id: typeof data.id === "string" ? data.id : `thread-${++this.threadCounter}`,
        userId: typeof data.userId === "string" ? data.userId : null,
        externalId: data.externalId ?? null,
        title: data.title ?? null,
        status: data.status ?? "active",
        model: data.model ?? null,
        reasoningEffort: data.reasoningEffort ?? null,
        workspace: data.workspace ?? null,
        codexRunConfig: (data.codexRunConfig as Record<string, unknown> | null | undefined) ?? null,
        headId: data.headId ?? null,
        feedback: clone(data.feedback ?? []),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.threads.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeThreadRow> }) => {
      const row = this.threads.find((thread) => thread.id === where.id);
      if (!row) {
        throw new Error("thread not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = this.threads.findIndex((thread) => thread.id === where.id);
      if (index < 0) {
        throw new Error("thread not found");
      }
      const [row] = this.threads.splice(index, 1);
      return clone(row);
    }
  };

  readonly message = {
    findMany: async ({ where, orderBy }: { where: { threadId: string }; orderBy?: { position: "asc" | "desc" } } ) => {
      const rows = this.messages.filter((message) => message.threadId === where.threadId);
      rows.sort((left, right) => {
        const diff = left.position - right.position;
        return orderBy?.position === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.messages.find((message) => message.id === where.id);
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Partial<FakeMessageRow> & { threadId: string; content: unknown; role: FakeMessageRow["role"]; position: number } }) => {
      const now = new Date();
      const nextId = typeof data.id === "string" ? data.id : `message-${++this.messageCounter}`;
      if (this.messages.some((message) => message.id === nextId)) {
        throw new Error("duplicate message id");
      }
      if (
        typeof data.externalId === "string" &&
        this.messages.some(
          (message) => message.threadId === data.threadId && message.externalId === data.externalId
        )
      ) {
        throw new Error("duplicate message external id");
      }
      const row: FakeMessageRow = {
        id: nextId,
        threadId: data.threadId,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        role: data.role,
        content: clone(data.content),
        parentId: data.parentId ?? null,
        runConfig: (data.runConfig as Record<string, unknown> | null | undefined) ?? null,
        position: data.position,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.messages.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeMessageRow> }) => {
      const row = this.messages.find((message) => message.id === where.id);
      if (!row) {
        throw new Error("message not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    deleteMany: async ({ where }: { where: { threadId: string } }) => {
      const before = this.messages.length;
      const remaining = this.messages.filter((message) => message.threadId !== where.threadId);
      this.messages.splice(0, this.messages.length, ...remaining);
      return { count: before - this.messages.length };
    }
  };

  readonly runtimeSession = {
    findFirst: async ({ where, orderBy }: { where: { threadId: string; status?: "active" | "ended" | "failed" }; orderBy?: { updatedAt: "asc" | "desc" } }) => {
      const rows = this.runtimeSessions.filter((session) => session.threadId === where.threadId && (where.status ? session.status === where.status : true));
      rows.sort((left, right) => {
        const diff = left.updatedAt.getTime() - right.updatedAt.getTime();
        return orderBy?.updatedAt === "asc" ? diff : -diff;
      });
      return rows[0] ? clone(rows[0]) : null;
    },
    deleteMany: async ({ where }: { where: { threadId: string } }) => {
      const before = this.runtimeSessions.length;
      const remaining = this.runtimeSessions.filter((session) => session.threadId !== where.threadId);
      this.runtimeSessions.splice(0, this.runtimeSessions.length, ...remaining);
      return { count: before - this.runtimeSessions.length };
    },
    create: async ({ data }: { data: Partial<FakeRuntimeSessionRow> }) => {
      const row: FakeRuntimeSessionRow = {
        id: typeof data.id === "string" ? data.id : `runtime-${++this.runtimeCounter}`,
        threadId: data.threadId ?? null,
        userId: typeof data.userId === "string" ? data.userId : null,
        externalId: data.externalId ?? null,
        status: data.status ?? "active",
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date()
      };
      this.runtimeSessions.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakePrismaClient) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

class FakeImportRepository {
  constructor(private readonly existingIds = new Set<string>()) {}

  readonly imported: ThreadRecord[] = [];

  async count(): Promise<number> {
    return this.existingIds.size;
  }

  async get(threadId: string): Promise<ThreadRecord | undefined> {
    return this.existingIds.has(threadId)
      ? ({
          id: threadId
        } as ThreadRecord)
      : undefined;
  }

  async importThread(record: ThreadRecord): Promise<ThreadRecord> {
    if (!this.existingIds.has(record.id)) {
      this.existingIds.add(record.id);
      this.imported.push(record);
    }
    return record;
  }
}

type FakeSessionRow = {
  id: string;
  threadId: string | null;
  userId: string | null;
  externalId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

class FakeSessionDb {
  constructor(initialRows: FakeSessionRow[] = []) {
    this.rows = initialRows;
  }

  readonly rows: FakeSessionRow[];
  readonly updateCalls: Array<{ where: { externalId: string }; data: Record<string, unknown> }> = [];

  readonly runtimeSession = {
    count: async ({ where }: { where?: { status?: "active" | "ended" | "failed" } } = {}) => {
      return this.rows.filter((row) => {
        if (!where?.status) return true;
        return (row.metadata as { status?: string } | undefined)?.status === where.status;
      }).length;
    },
    findUnique: async ({ where }: { where: { externalId: string } }) => {
      const row = this.rows.find((item) => item.externalId === where.externalId);
      return row ? clone(row) : null;
    },
    findMany: async ({
      where,
      select
    }: {
      where: { updatedAt: { lt: Date } };
      select: { externalId: true };
    }) => {
      void select;
      return this.rows
        .filter((item) => item.updatedAt < where.updatedAt.lt)
        .map((item) => ({ externalId: item.externalId }));
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSessionRow = {
        id: typeof data.id === "string" ? data.id : `runtime-${this.rows.length + 1}`,
        threadId: typeof data.threadId === "string" ? data.threadId : null,
        userId: typeof data.userId === "string" ? data.userId : null,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        metadata: clone({ ...(data.metadata as Record<string, unknown> | undefined), status: data.status }),
        createdAt: now,
        updatedAt: now
      };
      this.rows.push(row);
      return clone(row);
    },
    update: async ({
      where,
      data
    }: {
      where: { externalId: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find((item) => item.externalId === where.externalId);
      if (!row) {
        throw new Error("session not found");
      }
      this.updateCalls.push({ where, data: clone(data) });
      if ("metadata" in data) {
        row.metadata = clone(data.metadata);
      }
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    deleteMany: async ({
      where
    }: {
      where: { externalId?: string; updatedAt?: { lt: Date } };
    }) => {
      const before = this.rows.length;
      const remaining = this.rows.filter((row) => {
        if (where.externalId && row.externalId === where.externalId) return false;
        if (where.updatedAt && row.updatedAt < where.updatedAt.lt) return false;
        return true;
      });
      this.rows.splice(0, this.rows.length, ...remaining);
      return { count: before - this.rows.length };
    }
  };
}

describe("thread persistence foundation", () => {
  afterEach(() => {
    resetDbEnvForTests();
    resetDbClientForTests();
    vi.unstubAllEnvs();
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => getDbEnv({})).toThrow(/DATABASE_URL/i);
  });

  it("fails when DATABASE_URL is only whitespace", () => {
    expect(() => getDbEnv({ DATABASE_URL: "   " })).toThrow(/DATABASE_URL/i);
  });

  it("does not reuse cached process env value for explicit env injection", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/from-process");
    expect(getDbEnv().databaseUrl).toBe(
      "postgresql://postgres:postgres@localhost:5432/from-process"
    );

    expect(
      getDbEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/from-explicit"
      }).databaseUrl
    ).toBe("postgresql://postgres:postgres@localhost:5432/from-explicit");
  });

  it("uses explicitly provided env when creating prisma client", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/from-process");

    expect(() => createDbClient({})).toThrow(/DATABASE_URL/i);
  });

  it("caches parsed env until explicitly reset", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/agent_studio");
    expect(getDbEnv().databaseUrl).toBe(
      "postgresql://postgres:postgres@localhost:5432/agent_studio"
    );

    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/changed");
    expect(getDbEnv().databaseUrl).toBe(
      "postgresql://postgres:postgres@localhost:5432/agent_studio"
    );

    resetDbEnvForTests();
    expect(getDbEnv().databaseUrl).toBe("postgresql://postgres:postgres@localhost:5432/changed");
  });

  it("reuses one prisma client instance per process", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/agent_studio");

    const first = getDbClient();
    const second = getDbClient();
    const direct = createDbClient();

    expect(first).toBe(second);
    expect(first).not.toBe(direct);
    expect(typeof first.$connect).toBe("function");
    expect(typeof first.$disconnect).toBe("function");
    expect(typeof direct.$disconnect).toBe("function");
  });
});

describe("ThreadRepository", () => {
  it("creates a thread with repository defaults", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);

    const thread = await repository.create({
      title: "  Task 2 thread  ",
      userId: "user-1",
      externalId: "external-1",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace",
      codexRunConfig: { approvalPolicy: "never" }
    });

    expect(thread.title).toBe("Task 2 thread");
    expect(thread.status).toBe("regular");
    expect(thread.headId).toBeNull();
    expect(thread.messages).toEqual([]);
    expect(thread.feedback).toEqual([]);

    const persisted = await repository.get(thread.id);
    expect(persisted).toMatchObject({
      id: thread.id,
      userId: "user-1",
      externalId: "external-1",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace",
      codexRunConfig: { approvalPolicy: "never" }
    } satisfies Partial<ThreadRecord>);
  });

  it("appends messages, deduplicates by message id, and exposes repository head id", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const thread = await repository.create({
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace"
    });

    await repository.appendMessage(thread.id, {
      parentId: null,
      message: { id: "message-1", role: "user", content: [{ type: "text", text: "hello" }] },
      runConfig: { model: "gpt-5" }
    });
    const updated = await repository.appendMessage(thread.id, {
      parentId: "message-1",
      message: { id: "message-1", role: "assistant", content: [{ type: "text", text: "updated" }] },
      runConfig: { model: "gpt-5", turn: 2 }
    });

    expect(updated.headId).toBe("message-1");

    const persisted = await repository.getRepository(thread.id);
    expect(persisted.headId).toBe("message-1");
    expect(persisted.messages).toEqual([
      {
        parentId: "message-1",
        message: { id: "message-1", role: "assistant", content: [{ type: "text", text: "updated" }] },
        runConfig: { model: "gpt-5", turn: 2 }
      }
    ]);
  });

  it("replaces messages and keeps the provided order plus head id", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const thread = await repository.create({
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "medium",
      workspace: "/tmp/workspace"
    });

    await repository.replaceMessages(thread.id, {
      headId: "message-2",
      messages: [
        {
          parentId: null,
          message: { id: "message-1", role: "user", content: [{ type: "text", text: "one" }] },
          runConfig: { step: 1 }
        },
        {
          parentId: "message-1",
          message: { id: "message-2", role: "assistant", content: [{ type: "text", text: "two" }] },
          runConfig: { step: 2 }
        }
      ]
    });

    const repositoryState = await repository.getRepository(thread.id);
    expect(repositoryState).toEqual({
      headId: "message-2",
      messages: [
        {
          parentId: null,
          message: { id: "message-1", role: "user", content: [{ type: "text", text: "one" }] },
          runConfig: { step: 1 }
        },
        {
          parentId: "message-1",
          message: { id: "message-2", role: "assistant", content: [{ type: "text", text: "two" }] },
          runConfig: { step: 2 }
        }
      ]
    });
  });

  it("persists feedback entries on the thread record", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const thread = await repository.create({
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "low",
      workspace: "/tmp/workspace"
    });

    const feedback = await repository.addFeedback(thread.id, {
      type: "negative",
      messageId: "message-9",
      contentPreview: "trimmed preview"
    });

    expect(feedback).toMatchObject({
      type: "negative",
      messageId: "message-9",
      contentPreview: "trimmed preview"
    });

    const persisted = await repository.get(thread.id);
    expect(persisted?.feedback).toEqual([feedback]);
  });

  it("allows the same incoming message id in different threads", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const firstThread = await repository.create({
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/first"
    });
    const secondThread = await repository.create({
      userId: "user-2",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/second"
    });

    await repository.appendMessage(firstThread.id, {
      parentId: null,
      message: { id: "shared-message", role: "user", content: [{ type: "text", text: "first" }] }
    });

    await expect(
      repository.appendMessage(secondThread.id, {
        parentId: null,
        message: { id: "shared-message", role: "user", content: [{ type: "text", text: "second" }] }
      })
    ).resolves.toMatchObject({
      id: secondThread.id,
      headId: "shared-message"
    });

    const firstRepository = await repository.getRepository(firstThread.id);
    const secondRepository = await repository.getRepository(secondThread.id);
    expect(firstRepository.messages).toHaveLength(1);
    expect(secondRepository.messages).toHaveLength(1);
    expect(firstRepository.messages[0]?.message).toMatchObject({ id: "shared-message" });
    expect(secondRepository.messages[0]?.message).toMatchObject({ id: "shared-message" });
  });

  it("replaces messages safely when one thread contains duplicate incoming message ids", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const thread = await repository.create({
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "medium",
      workspace: "/tmp/workspace"
    });

    await expect(
      repository.replaceMessages(thread.id, {
        headId: "dup-message",
        messages: [
          {
            parentId: null,
            message: { id: "dup-message", role: "user", content: [{ type: "text", text: "first" }] }
          },
          {
            parentId: "dup-message",
            message: { id: "dup-message", role: "assistant", content: [{ type: "text", text: "second" }] }
          }
        ]
      })
    ).resolves.toMatchObject({
      id: thread.id,
      headId: "dup-message"
    });

    const repositoryState = await repository.getRepository(thread.id);
    expect(repositoryState.messages).toEqual([
      {
        parentId: null,
        message: { id: "dup-message", role: "user", content: [{ type: "text", text: "first" }] },
        runConfig: undefined
      },
      {
        parentId: "dup-message",
        message: { id: "dup-message", role: "assistant", content: [{ type: "text", text: "second" }] },
        runConfig: undefined
      }
    ]);
  });

  it("imports legacy threads with duplicate incoming message ids in one thread", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);

    await expect(
      repository.importThread({
        id: "legacy-thread",
        userId: "user-legacy",
        status: "regular",
        model: "gpt-5",
        reasoningEffort: "high",
        workspace: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        headId: "legacy-message",
        messages: [
          {
            parentId: null,
            message: { id: "legacy-message", role: "user", content: [{ type: "text", text: "first" }] }
          },
          {
            parentId: "legacy-message",
            message: { id: "legacy-message", role: "assistant", content: [{ type: "text", text: "second" }] }
          }
        ],
        feedback: []
      })
    ).resolves.toMatchObject({
      id: "legacy-thread",
      headId: "legacy-message"
    });

    const repositoryState = await repository.getRepository("legacy-thread");
    expect(repositoryState.messages).toHaveLength(2);
    expect(repositoryState.messages[0]?.message).toMatchObject({ id: "legacy-message" });
    expect(repositoryState.messages[1]?.message).toMatchObject({ id: "legacy-message" });
  });

  it("lists and resolves only threads owned by the requested user", async () => {
    const db = new FakePrismaClient();
    const repository = new ThreadRepository(db as never);
    const first = await repository.create({
      userId: "user-a",
      title: "A",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/a"
    });
    await repository.create({
      userId: "user-b",
      title: "B",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/b"
    });

    const userAThreads = await repository.listForUser("user-a", true);
    const owned = await repository.getOwned(first.id, "user-a");
    const notOwned = await repository.getOwned(first.id, "user-b");

    expect(userAThreads.map((item) => item.id)).toEqual([first.id]);
    expect(owned?.id).toBe(first.id);
    expect(notOwned).toBeUndefined();
  });
});

describe("importLegacyThreadsFromJson", () => {
  it("skips already imported threads and continues importing missing legacy threads", async () => {
    const tempDir = path.resolve(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `thread-import-${Date.now()}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        threads: [
          {
            id: "thread-existing",
            userId: "legacy-owner",
            model: "gpt-5",
            reasoningEffort: "high",
            workspace: "/tmp/workspace"
          },
          {
            id: "thread-missing",
            userId: "legacy-owner",
            model: "gpt-5",
            reasoningEffort: "medium",
            workspace: "/tmp/other-workspace"
          }
        ]
      }),
      "utf8"
    );

    const repository = new FakeImportRepository(new Set(["thread-existing"]));

    const result = await importLegacyThreadsFromJson({
      filePath,
      repository: repository as never
    });

    expect(repository.imported).toHaveLength(1);
    expect(repository.imported[0]?.id).toBe("thread-missing");
    expect(result.importedCount).toBe(1);
    expect(result.archivedPath).toMatch(/\.bak$/);
    await expect(fs.stat(result.archivedPath as string)).resolves.toBeTruthy();
  });

  it("assigns a default owner to imported legacy threads that do not carry userId", async () => {
    const tempDir = path.resolve(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `thread-import-owner-${Date.now()}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        threads: [
          {
            id: "thread-ownerless",
            model: "gpt-5",
            reasoningEffort: "high",
            workspace: "/tmp/workspace"
          }
        ]
      }),
      "utf8"
    );

    const repository = new FakeImportRepository();

    const result = await importLegacyThreadsFromJson({
      filePath,
      repository: repository as never,
      defaultUserId: "legacy-owner"
    });

    expect(result.importedCount).toBe(1);
    expect(repository.imported[0]).toMatchObject({
      id: "thread-ownerless",
      userId: "legacy-owner"
    });
  });
});

describe("SessionRepository", () => {
  it("refreshes ttl without rewriting metadata during get", async () => {
    const db = new FakeSessionDb([
      {
        id: "runtime-1",
        threadId: "thread-1",
        userId: "user-1",
        externalId: "session-1",
        metadata: {
          model: "gpt-5",
          reasoningEffort: "high",
          workspace: "/tmp/workspace",
          codexRunConfig: {
            mode: "safe"
          }
        },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date(Date.now() - 1000)
      }
    ]);
    const repository = new SessionRepository(db as never, 60_000);

    const session = await repository.get("session-1");

    expect(session?.sessionId).toBe("session-1");
    expect(db.updateCalls).toHaveLength(1);
    expect(db.updateCalls[0]).toMatchObject({
      where: { externalId: "session-1" },
      data: {
        updatedAt: expect.anything()
      }
    });
    expect(db.updateCalls[0]?.data).not.toHaveProperty("metadata");
    expect(db.rows[0]?.metadata).toEqual({
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace",
      codexRunConfig: {
        mode: "safe"
      }
    });
  });

  it("persists user ownership and blocks access from a different user", async () => {
    const db = new FakeSessionDb();
    const repository = new SessionRepository(db as never, 60_000);

    const created = await repository.create({
      threadId: "thread-1",
      userId: "user-1",
      model: "gpt-5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace"
    });

    expect(created.userId).toBe("user-1");
    await expect(repository.getOwned(created.sessionId, "user-1")).resolves.toMatchObject({
      sessionId: created.sessionId,
      userId: "user-1"
    });
    await expect(repository.getOwned(created.sessionId, "user-2")).resolves.toBeUndefined();
  });
});
