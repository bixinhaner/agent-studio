import { Router, type Request, type Response } from "express";

import { derivePortalRuntimeOptions } from "./runtime-options.js";

export function createPortalRouter(options: {
  workspaceWhitelist: string[];
  defaultWorkspace: string;
}): Router {
  const router = Router();

  router.get("/runtime-options", (req: Request, res: Response) => {
    res.json(
      derivePortalRuntimeOptions({
        role: req.currentUser?.role,
        workspaceRoots: options.workspaceWhitelist,
        defaultWorkspace: options.defaultWorkspace
      })
    );
  });

  return router;
}
