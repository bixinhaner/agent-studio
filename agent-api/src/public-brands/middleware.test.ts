import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPublicBrandContextMiddleware, organizationMatchesRequestBrand } from "./middleware.js";

describe("public brand request context", () => {
  it("resolves the request host before route handling", async () => {
    const resolveByHostname = vi.fn(async () => ({ id: "brand-ranley", key: "ranley" }));
    const app = express();
    app.use(createPublicBrandContextMiddleware({ resolveByHostname } as never));
    app.get("/brand", (req, res) => res.json({ id: req.publicBrand?.id }));

    const response = await request(app).get("/brand").set("Host", "ranley.cloud-ran.ai");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "brand-ranley" });
    expect(resolveByHostname).toHaveBeenCalledWith("ranley.cloud-ran.ai");
  });

  it("requires every organization to match a resolved brand", () => {
    const ranleyRequest = { publicBrand: { id: "brand-ranley" } } as never;
    const baileyRequest = { publicBrand: { id: "brand-bailey" } } as never;
    const unknownRequest = {} as never;

    expect(organizationMatchesRequestBrand(ranleyRequest, { publicBrandId: "brand-ranley" })).toBe(true);
    expect(organizationMatchesRequestBrand(ranleyRequest, { publicBrandId: null })).toBe(false);
    expect(organizationMatchesRequestBrand(baileyRequest, { publicBrandId: "brand-bailey" })).toBe(true);
    expect(organizationMatchesRequestBrand(baileyRequest, { publicBrandId: "brand-ranley" })).toBe(false);
    expect(organizationMatchesRequestBrand(unknownRequest, { publicBrandId: "brand-bailey" })).toBe(false);
    expect(organizationMatchesRequestBrand(unknownRequest, { publicBrandId: null })).toBe(false);
  });
});
