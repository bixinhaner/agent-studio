import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { deployDrainFilesForRole, readDeploymentDrainReason } from "./deploy-drain.js";

describe("deploy drain files", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("scopes drain files to the service role while honoring the legacy shared file", () => {
    expect(deployDrainFilesForRole("/srv/temp/deploy-drain.json", "chat")).toEqual([
      "/srv/temp/deploy-drain.json",
      "/srv/temp/deploy-drain-chat.json"
    ]);
    expect(deployDrainFilesForRole("/srv/temp/deploy-drain.json", "all")).toEqual([
      "/srv/temp/deploy-drain.json",
      "/srv/temp/deploy-drain-admin.json",
      "/srv/temp/deploy-drain-chat.json"
    ]);
  });

  it("drains a blue-green chat slot without draining its peer", async () => {
    expect(deployDrainFilesForRole("/srv/temp/deploy-drain.json", "chat", "b")).toEqual([
      "/srv/temp/deploy-drain.json",
      "/srv/temp/deploy-drain-chat-b.json"
    ]);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-drain-"));
    const base = path.join(dir, "deploy-drain.json");
    await fs.writeFile(path.join(dir, "deploy-drain-chat-a.json"), JSON.stringify({ reason: "Slot a retiring" }));
    // A legacy single-instance chat drain must not reach slot-aware instances.
    await fs.writeFile(path.join(dir, "deploy-drain-chat.json"), JSON.stringify({ reason: "Legacy chat drain" }));

    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "chat", "a"))).toBe("Slot a retiring");
    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "chat", "b"))).toBeUndefined();
    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "chat"))).toBe("Legacy chat drain");
  });

  it("keeps chat open while only the admin service drains", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-drain-"));
    const base = path.join(dir, "deploy-drain.json");
    await fs.writeFile(path.join(dir, "deploy-drain-admin.json"), JSON.stringify({ reason: "Admin updating" }));

    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "chat"))).toBeUndefined();
    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "admin"))).toBe("Admin updating");

    await fs.writeFile(base, "{}");
    expect(await readDeploymentDrainReason(deployDrainFilesForRole(base, "chat"))).toBe(
      "System is updating. Please retry in a few minutes."
    );
  });
});
