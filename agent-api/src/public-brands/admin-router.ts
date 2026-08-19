import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";

import type { PublicBrandService } from "./service.js";
import type { PublicBrandEmailTransportService } from "./email-transport.js";

function detailFromError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : "Brand request failed";
}

export function createPublicBrandAdminRouter(
  brands: PublicBrandService,
  emailTransports: PublicBrandEmailTransportService
): Router {
  const router = Router();

  router.get("/brands", async (_req: Request, res: Response) => {
    try {
      res.json({ brands: await brands.listWithReadiness() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/brands/lookups", async (_req: Request, res: Response) => {
    try {
      res.json(await brands.lookups());
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/brands", async (req: Request, res: Response) => {
    try {
      const brand = await brands.create(req.body, req.currentUser!.id);
      res.status(201).json({ brand: { ...brand, readiness: await brands.readiness(brand) } });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/brands/:brandId", async (req: Request, res: Response) => {
    try {
      const brand = await brands.update(req.params.brandId, req.body, req.currentUser!.id);
      res.json({ brand: { ...brand, readiness: await brands.readiness(brand) } });
    } catch (error) {
      const detail = detailFromError(error);
      res.status(detail === "Brand does not exist" ? 404 : 400).json({ detail });
    }
  });

  router.post("/brands/:brandId/check", async (req: Request, res: Response) => {
    try {
      const brand = await brands.getById(req.params.brandId);
      if (!brand) {
        res.status(404).json({ detail: "Brand does not exist" });
        return;
      }
      res.json({ readiness: await brands.readiness(brand) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/brands/:brandId/email-transport", async (req: Request, res: Response) => {
    try {
      res.json({ transport: await emailTransports.get(req.params.brandId) });
    } catch (error) {
      const detail = detailFromError(error);
      res.status(detail === "Brand does not exist" ? 404 : 400).json({ detail });
    }
  });

  router.put("/brands/:brandId/email-transport", async (req: Request, res: Response) => {
    try {
      const transport = await emailTransports.update(req.params.brandId, req.body, req.currentUser!.id);
      const brand = await brands.getById(req.params.brandId);
      res.json({ transport, readiness: brand ? await brands.readiness(brand) : undefined });
    } catch (error) {
      const detail = detailFromError(error);
      res.status(detail === "Brand does not exist" ? 404 : 400).json({ detail });
    }
  });

  router.post("/brands/:brandId/email-transport/test", async (req: Request, res: Response) => {
    try {
      const transport = await emailTransports.test(req.params.brandId, req.body, req.currentUser!.id);
      const brand = await brands.getById(req.params.brandId);
      res.json({ transport, readiness: brand ? await brands.readiness(brand) : undefined });
    } catch (error) {
      const detail = detailFromError(error);
      res.status(detail === "Brand does not exist" ? 404 : 400).json({ detail });
    }
  });

  router.post("/brands/:brandId/knowledge-projection", async (req: Request, res: Response) => {
    try {
      const brand = await brands.regenerateKnowledgeProjection(req.params.brandId);
      res.json({ brand: { ...brand, readiness: await brands.readiness(brand) } });
    } catch (error) {
      const detail = detailFromError(error);
      res.status(detail === "Brand does not exist" ? 404 : 400).json({ detail });
    }
  });

  return router;
}
