import { describe, expect, it } from "vitest";

import { crestCommentaryEntryToThoughtPayload } from "./stream-events.js";

describe("Crest stream event projection", () => {
  it("keeps one completed commentary as one thought event with the original id", () => {
    expect(
      crestCommentaryEntryToThoughtPayload({
        id: "msg-commentary-1",
        text: "我会先查询客户数据。\n\n数据已经取回。",
        lines: ["我会先查询客户数据。", "数据已经取回。"],
        status: "completed"
      })
    ).toEqual({
      id: "msg-commentary-1",
      text: "我会先查询客户数据。\n\n数据已经取回。"
    });
  });

  it("uses different stable ids for separate commentary messages", () => {
    const first = crestCommentaryEntryToThoughtPayload({
      id: "msg-commentary-1",
      text: "我会先查询客户数据。",
      lines: ["我会先查询客户数据。"],
      status: "completed"
    });
    const second = crestCommentaryEntryToThoughtPayload({
      id: "msg-commentary-2",
      text: "我现在生成 Excel 文件。",
      lines: ["我现在生成 Excel 文件。"],
      status: "completed"
    });

    expect(first?.id).toBe("msg-commentary-1");
    expect(second?.id).toBe("msg-commentary-2");
    expect(first?.id).not.toBe(second?.id);
  });
});
