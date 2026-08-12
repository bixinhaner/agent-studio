import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { parseSingleByteRange, sendBufferContent } from "./raw-content-response.js";

describe("raw content response", () => {
  it("parses regular, open-ended and suffix byte ranges", () => {
    expect(parseSingleByteRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseSingleByteRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseSingleByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseSingleByteRange("bytes=12-15", 10)).toBe("invalid");
  });

  it("serves partial content for resumable browser downloads", async () => {
    const app = express();
    app.get("/file", async (req, res) => {
      await sendBufferContent({
        req,
        res,
        content: Buffer.from("0123456789"),
        contentType: "application/octet-stream",
        contentDisposition: "attachment; filename=test.bin"
      });
    });

    const response = await request(app).get("/file").set("Range", "bytes=4-7");
    expect(response.status).toBe(206);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe("bytes 4-7/10");
    expect(response.body).toEqual(Buffer.from("4567"));
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const app = express();
    app.get("/file", async (req, res) => {
      await sendBufferContent({
        req,
        res,
        content: Buffer.from("0123456789"),
        contentType: "application/octet-stream",
        contentDisposition: "attachment; filename=test.bin"
      });
    });

    const response = await request(app).get("/file").set("Range", "bytes=20-30");
    expect(response.status).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */10");
  });
});
