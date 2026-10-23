import { describe, expect, it } from "vitest";

import { codexMemoryNotesDir, threadResumeParams, threadStartParams, turnStartParams } from "./codex-app-server-runtime.js";

const codexHome = "/srv/codex-homes/internal/user-1/agent-1";
const notesDir = `${codexHome}/memories/extensions/ad_hoc/notes`;
const memoryOn = { env: { CODEX_HOME: codexHome }, config: { features: { memories: true }, memories: { use_memories: true } } };
const memoryOff = { env: { CODEX_HOME: codexHome }, config: { features: { memories: false } } };
const threadOptions = {
  model: "gpt-6.1-sol",
  reasoningEffort: "high" as const,
  workspace: "/srv/sessions/user-1/thread-1",
  codexRunConfig: { sandboxMode: "workspace-write", approvalPolicy: "never", additionalDirectories: ["/srv/shared/tools"] }
};

describe("Codex memory notes in the sandbox", () => {
  it("lets the agent write only its own notes folder when memory is on", () => {
    expect(codexMemoryNotesDir(memoryOn)).toBe(notesDir);
    const turn = turnStartParams("thread-1", "请记住…", threadOptions, [], memoryOn);
    expect(turn.sandboxPolicy).toMatchObject({
      type: "workspaceWrite",
      writableRoots: [threadOptions.workspace, "/srv/shared/tools", notesDir]
    });
    expect((turn.sandboxPolicy as { writableRoots: string[] }).writableRoots).not.toContain(`${codexHome}/memories`);

    for (const params of [threadStartParams(threadOptions, memoryOn), threadResumeParams("thread-1", threadOptions, memoryOn)]) {
      const config = params.config as Record<string, any>;
      expect(config.sandbox_workspace_write.writable_roots).toEqual([threadOptions.workspace, "/srv/shared/tools", notesDir]);
      expect(config.features.memories).toBe(true);
    }
  });

  it("keeps the sandbox unchanged when memory is off or the home is unknown", () => {
    expect(codexMemoryNotesDir(memoryOff)).toBeUndefined();
    expect(codexMemoryNotesDir({ env: {}, config: memoryOn.config })).toBeUndefined();
    const turn = turnStartParams("thread-1", "hi", threadOptions, [], memoryOff);
    expect(turn.sandboxPolicy).toMatchObject({ writableRoots: [threadOptions.workspace, "/srv/shared/tools"] });
  });
});
