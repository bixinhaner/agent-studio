import type { NextFunction, Request, RequestHandler, Response } from "express";

export function createServiceTokenMiddleware(rawToken: string | undefined): RequestHandler {
  const expectedToken = (rawToken || "").trim();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!expectedToken) {
      res.status(503).json({ detail: "Service token is not configured" });
      return;
    }

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (token !== expectedToken) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    next();
  };
}
