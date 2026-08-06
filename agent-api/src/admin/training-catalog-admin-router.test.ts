import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createTrainingCatalogAdminRouter } from "./training-catalog-admin-router.js";

function createApp() {
  const service = {
    getConfigurationStatus: vi.fn().mockResolvedValue({
      enabled: true,
      sourceEmail: "like@baicells.com",
      rootFolderName: "员工AI培训",
      validationStatus: "valid",
      validationMessage: "配置有效",
      folderCount: 12,
      threadCount: 54
    }),
    saveConfiguration: vi.fn().mockResolvedValue({
      enabled: true,
      sourceEmail: "like@baicells.com",
      rootFolderName: "员工AI培训",
      validationStatus: "valid",
      validationMessage: "配置有效",
      folderCount: 12,
      threadCount: 54
    }),
    listRootFolderOptions: vi.fn().mockResolvedValue([
      { id: "folder-1", name: "员工AI培训", workspaceId: "workspace-1" }
    ])
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = { id: "admin-1" } as never;
    req.currentOrganization = { id: "org-1", type: "internal" } as never;
    next();
  });
  app.use("/api/admin", createTrainingCatalogAdminRouter({ service: service as never }));
  return { app, service };
}

describe("createTrainingCatalogAdminRouter", () => {
  it("reads and saves the organization training configuration", async () => {
    const { app, service } = createApp();

    const current = await request(app).get("/api/admin/training-catalog/config").expect(200);
    expect(current.body.configuration).toMatchObject({
      source_email: "like@baicells.com",
      validation_status: "valid",
      folder_count: 12
    });

    await request(app)
      .put("/api/admin/training-catalog/config")
      .send({
        enabled: true,
        source_email: "like@baicells.com",
        root_folder_name: "员工AI培训"
      })
      .expect(200);

    expect(service.saveConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "admin-1",
      sourceEmail: "like@baicells.com",
      rootFolderName: "员工AI培训"
    }));
  });

  it("lists selectable root folders for the selected source account", async () => {
    const { app } = createApp();

    const response = await request(app)
      .get("/api/admin/training-catalog/root-folders")
      .query({ source_email: "like@baicells.com" })
      .expect(200);

    expect(response.body.folders).toEqual([
      { id: "folder-1", name: "员工AI培训", workspace_id: "workspace-1" }
    ]);
  });
});
