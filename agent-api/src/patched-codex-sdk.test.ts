import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("child_process", () => ({
  spawn: spawnMock
}));

type MockChildProcess = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: () => boolean;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

describe("patched Codex resume execution", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("passes '-' when resuming a thread so the prompt is read from stdin", async () => {
    const child = createMockChildProcess();
    let stdinContent = "";
    child.stdin.on("data", (chunk) => {
      stdinContent += chunk.toString("utf8");
    });

    spawnMock.mockImplementation((_command: string, _args: string[]) => {
      queueMicrotask(() => {
        child.stdout.end();
        child.emit("exit", 0, null);
      });
      return child;
    });

    const { Codex } = await import("./patched-codex-sdk.js");
    const codex = new Codex({ codexPathOverride: "/tmp/fake-codex" });
    const thread = codex.resumeThread("thread-123", {
      model: "gpt-5.5",
      skipGitRepoCheck: true,
      workingDirectory: "/tmp/workspace"
    });

    const { events } = await thread.runStreamed("hello from stdin");
    for await (const _event of events) {
      // drain stream
    }

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).toEqual(
      expect.arrayContaining(["exec", "--experimental-json", "--model", "gpt-5.5", "--skip-git-repo-check", "--cd", "/tmp/workspace", "resume", "thread-123", "-"])
    );
    expect(args.indexOf("resume")).toBeLessThan(args.lastIndexOf("-"));
    expect(stdinContent).toBe("hello from stdin");
  });
});
