import { describe, expect, it, vi } from "vitest";

import { ZendeskBindingStore } from "./binding-store.js";
import { ZendeskRunStore } from "./run-store.js";

describe("Zendesk persistence stores", () => {
  it("scopes run records by integration instance", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: args.data.id as string,
      integrationInstanceId: args.data.integrationInstanceId as string,
      scopeKey: args.data.scopeKey as string,
      ticketId: args.data.ticketId as string,
      source: args.data.source as string,
      status: args.data.status as string,
      detail: args.data.detail as string,
      decision: null,
      commentId: null,
      requesterCommentId: null,
      ticketSubject: typeof args.data.ticketSubject === "string" ? args.data.ticketSubject : null,
      error: null,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z"
    }));
    const findMany = vi.fn(async () => []);
    const store = new ZendeskRunStore({
      zendeskRun: {
        create,
        findMany,
        update: vi.fn(async () => {
          throw new Error("not used");
        })
      }
    });

    await store.create({
      instanceId: "inst-1",
      ticketId: "123",
      source: "webhook",
      status: "received",
      detail: "received"
    });
    await store.listForInstance(50, "inst-1");

    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      integrationInstanceId: "inst-1",
      scopeKey: "inst-1",
      ticketId: "123"
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey: "inst-1" }
      })
    );
  });

  it("uses instance and ticket as the Zendesk idempotency key", async () => {
    const upsert = vi.fn(async (args: {
      where: { scopeKey_ticketId: { scopeKey: string; ticketId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      id: args.create.id as string,
      integrationInstanceId: args.create.integrationInstanceId as string,
      scopeKey: args.create.scopeKey as string,
      ticketId: args.create.ticketId as string,
      lastProcessedRequesterCommentId: args.create.lastProcessedRequesterCommentId as number,
      lastAction: args.create.lastAction as string,
      lastRunAt: args.create.lastRunAt as Date,
      lastRunId: args.create.lastRunId as string,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z"
    }));
    const store = new ZendeskBindingStore({
      zendeskTicketBinding: {
        findUnique: vi.fn(async () => null),
        upsert
      }
    });

    await store.upsert(
      "123",
      {
        lastProcessedRequesterCommentId: 456,
        lastAction: "public_reply",
        lastRunAt: "2026-05-18T10:00:00.000Z",
        lastRunId: "run-1"
      },
      "inst-1"
    );

    expect(upsert.mock.calls[0]?.[0].where).toEqual({
      scopeKey_ticketId: {
        scopeKey: "inst-1",
        ticketId: "123"
      }
    });
  });
});
