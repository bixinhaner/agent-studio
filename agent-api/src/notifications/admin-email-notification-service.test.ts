import { describe, expect, it, vi } from "vitest";

import { AdminEmailNotificationService } from "./admin-email-notification-service.js";
import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";

describe("AdminEmailNotificationService", () => {
  it("resolves published recipients, renders the template, records delivery, and deduplicates repeats", async () => {
    const records: Array<Record<string, any>> = [];
    const send = vi.fn(async () => ({ delivered: true, mode: "smtp" as const }));
    const service = new AdminEmailNotificationService({
      settings: {
        getCurrentPublished: vi.fn(async () => ({
          id: "settings-1",
          versionNumber: 1,
          revision: 1,
          status: "published" as const,
          payload: createDefaultSystemSettingsPayload(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))
      },
      notifications: {
        list: vi.fn(async (input) => records.filter((record) =>
          record.channelType === input.channelType &&
          record.targetRef === input.targetRef &&
          record.eventType === input.eventType
        ) as never),
        create: vi.fn(async (input) => {
          const record = {
            id: `notification-${records.length + 1}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...input
          };
          records.push(record);
          return record as never;
        }),
        update: vi.fn(async ({ id, changes }) => {
          const record = records.find((item) => item.id === id)!;
          Object.assign(record, changes);
          return record as never;
        })
      },
      emailSender: { send },
      findInternalUsers: vi.fn(async () => [
        { id: "admin-1", email: "admin@baicells.com", role: "admin" },
        { id: "super-1", email: "super@baicells.com", role: "super_admin" },
        { id: "employee-1", email: "employee@baicells.com", role: "employee" }
      ])
    });
    const input = {
      event: "access_request.submitted" as const,
      accessRequestId: "request-1",
      ownerEmail: "admin@baicells.com",
      salesContactEmail: "sales@baicells.com",
      variables: {
        company_name: "Example Corp",
        applicant_email: "applicant@example.com",
        sn_number: "SN-1",
        sales_contact_email: "sales@baicells.com",
        po_line: "",
        public_link_line: ""
      },
      dedupeKey: "revision-1"
    };

    await service.notify(input);
    await service.notify(input);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ["admin@baicells.com", "super@baicells.com", "sales@baicells.com"],
      subject: "New access request: Example Corp",
      text: expect.stringContaining("Applicant: applicant@example.com")
    }));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "sent", eventType: "access_request.submitted" });
  });

  it("retries only on delivery failure and records the final attempt", async () => {
    const payload = createDefaultSystemSettingsPayload();
    payload.adminEmailNotifications.maxAttempts = 2;
    let record: Record<string, any> | undefined;
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("temporary SMTP failure"))
      .mockResolvedValueOnce({ delivered: true, mode: "smtp" as const });
    const service = new AdminEmailNotificationService({
      settings: { getCurrentPublished: vi.fn(async () => ({
        id: "settings-1", versionNumber: 1, revision: 1, status: "published" as const,
        payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      })) },
      notifications: {
        list: vi.fn(async () => []),
        create: vi.fn(async (input) => {
          record = { id: "notification-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
          return record as never;
        }),
        update: vi.fn(async ({ changes }) => {
          Object.assign(record!, changes);
          return record as never;
        })
      },
      emailSender: { send },
      findInternalUsers: vi.fn(async () => [{ id: "admin-1", email: "admin@baicells.com", role: "admin" }])
    });

    await service.notify({
      event: "access_request.activated",
      accessRequestId: "request-1",
      variables: { company_name: "Example Corp", applicant_email: "applicant@example.com" }
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(record).toMatchObject({ status: "sent", payload: { attempts: 2 } });
  });

  it("does not let a stale pending audit record block a later delivery", async () => {
    const payload = createDefaultSystemSettingsPayload();
    const send = vi.fn(async () => ({ delivered: true, mode: "smtp" as const }));
    const stalePending = {
      id: "notification-stale",
      channelType: "email" as const,
      targetRef: "access_request:request-1:access_request.activated:current",
      eventType: "access_request.activated",
      status: "pending" as const,
      createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString()
    };
    const service = new AdminEmailNotificationService({
      settings: { getCurrentPublished: vi.fn(async () => ({
        id: "settings-1", versionNumber: 1, revision: 1, status: "published" as const,
        payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      })) },
      notifications: {
        list: vi.fn(async () => [stalePending]),
        create: vi.fn(async (input) => ({
          id: "notification-recovered",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...input
        }) as never),
        update: vi.fn(async ({ id, changes }) => ({
          id,
          channelType: "email",
          targetRef: stalePending.targetRef,
          eventType: stalePending.eventType,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...changes
        }) as never)
      },
      emailSender: { send },
      findInternalUsers: vi.fn(async () => [{ id: "admin-1", email: "admin@baicells.com", role: "admin" }])
    });

    await service.notify({
      event: "access_request.activated",
      accessRequestId: "request-1",
      variables: { company_name: "Example Corp", applicant_email: "applicant@example.com" }
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
