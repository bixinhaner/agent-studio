import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { Request, Response } from "express";

type ByteRange = { start: number; end: number };

export type RawContentDelivery = {
  completed: boolean;
  partial: boolean;
  bytesSent: number;
};

export function parseSingleByteRange(value: unknown, size: number): ByteRange | null | "invalid" {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  const rawStart = match[1] || "";
  const rawEnd = match[2] || "";
  if (!rawStart && !rawEnd) return "invalid";

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function waitForDelivery(res: Response, bytesSent: number, partial: boolean): Promise<RawContentDelivery> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      res.removeListener("finish", onFinish);
      res.removeListener("close", onClose);
      resolve({ completed, partial, bytesSent });
    };
    const onFinish = () => finish(true);
    const onClose = () => finish(res.writableFinished);
    res.once("finish", onFinish);
    res.once("close", onClose);
  });
}

function prepareRawContentResponse(input: {
  req: Request;
  res: Response;
  size: number;
  contentType: string;
  contentDisposition: string;
  cacheControl: string;
}): { range: ByteRange | null; length: number } | null {
  const { req, res, size } = input;
  const parsedRange = parseSingleByteRange(req.headers.range, size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", input.cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", input.contentType);
  res.setHeader("Content-Disposition", input.contentDisposition);
  if (parsedRange === "invalid") {
    res.setHeader("Content-Range", `bytes */${size}`);
    res.status(416).end();
    return null;
  }
  const length = parsedRange ? parsedRange.end - parsedRange.start + 1 : size;
  if (parsedRange) {
    res.setHeader("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${size}`);
    res.status(206);
  } else {
    res.status(200);
  }
  res.setHeader("Content-Length", String(length));
  return { range: parsedRange, length };
}

export async function sendBufferContent(input: {
  req: Request;
  res: Response;
  content: Buffer;
  contentType: string;
  contentDisposition: string;
  cacheControl?: string;
}): Promise<RawContentDelivery> {
  const prepared = prepareRawContentResponse({
    ...input,
    size: input.content.length,
    cacheControl: input.cacheControl ?? "private, no-store"
  });
  if (!prepared) return { completed: false, partial: false, bytesSent: 0 };
  const body = prepared.range
    ? input.content.subarray(prepared.range.start, prepared.range.end + 1)
    : input.content;
  const delivery = waitForDelivery(input.res, prepared.length, Boolean(prepared.range));
  if (input.req.method === "HEAD") input.res.end();
  else input.res.end(body);
  return delivery;
}

export async function sendFileContent(input: {
  req: Request;
  res: Response;
  absolutePath: string;
  contentType: string;
  contentDisposition: string;
  cacheControl?: string;
}): Promise<RawContentDelivery> {
  const fileStat = await stat(input.absolutePath);
  const prepared = prepareRawContentResponse({
    ...input,
    size: fileStat.size,
    cacheControl: input.cacheControl ?? "private, no-store"
  });
  if (!prepared) return { completed: false, partial: false, bytesSent: 0 };
  const delivery = waitForDelivery(input.res, prepared.length, Boolean(prepared.range));
  if (input.req.method === "HEAD") {
    input.res.end();
    return delivery;
  }
  const stream = createReadStream(input.absolutePath, prepared.range ?? undefined);
  let deliveryFinished = false;
  input.res.once("finish", () => {
    deliveryFinished = true;
  });
  stream.once("error", (error) => {
    if (!input.res.headersSent) input.res.status(500);
    input.res.destroy(error);
  });
  input.res.once("close", () => {
    if (!deliveryFinished) stream.destroy();
  });
  stream.pipe(input.res);
  return delivery;
}
