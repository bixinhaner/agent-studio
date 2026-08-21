import { describe, expect, it } from "vitest";

import {
  buildDwsSandboxArguments,
  dwsUserHomePath,
  prepareDwsCommand,
  profileListContainsIdentity,
  selectDwsProfile
} from "./dws-executor.js";

const expectedProfile = "ding-corp:user-1";

describe("prepareDwsCommand", () => {
  it("binds product commands to the current Agent Studio DingTalk profile", () => {
    const prepared = prepareDwsCommand(
      ["chat", "+dm", "--to", "张三", "--content", "你好", "--format", "json"],
      expectedProfile
    );

    expect(prepared.requiresIdentityCheck).toBe(true);
    expect(prepared.args.slice(-2)).toEqual(["--profile", expectedProfile]);
  });

  it("turns login into the one-step headless device flow", () => {
    const prepared = prepareDwsCommand(["auth", "login", "--format", "json"], expectedProfile);

    expect(prepared.requiresIdentityCheck).toBe(false);
    expect(prepared.validatesIdentityAfterRun).toBe(true);
    expect(prepared.args).toEqual(expect.arrayContaining([
      "--device",
      "--no-browser",
      "--recommend",
      "--profile",
      "ding-corp"
    ]));

    const withoutKnownCorp = prepareDwsCommand(["auth", "login"], "unbound:user-1", {
      loginTargetCorpId: null
    });
    expect(withoutKnownCorp.args).not.toContain("--profile");
  });

  it("rejects credential injection, raw API access, and another user's profile", () => {
    expect(() => prepareDwsCommand(["auth", "login", "--token", "secret"], expectedProfile)).toThrow(
      "--token"
    );
    expect(() => prepareDwsCommand(["auth", "login", "--token-url=https://example.com"], expectedProfile)).toThrow(
      "--token-url"
    );
    expect(() => prepareDwsCommand(["api", "get", "/v1.0/contact/users/me"], expectedProfile)).toThrow(
      "not available"
    );
    expect(() => prepareDwsCommand(["chat", "+dm", "--profile", "other:user"], expectedProfile)).toThrow(
      "current Agent Studio user"
    );
  });
});

describe("DWS identity and sandbox isolation", () => {
  it("matches only an exact corpId and userId pair", () => {
    const payload = {
      success: true,
      profiles: [
        { corpId: "ding-corp", userId: "other-user" },
        { corpId: "other-corp", userId: "user-1" },
        { corpId: "ding-corp", userId: "user-1" }
      ]
    };

    expect(profileListContainsIdentity(payload, "ding-corp", "user-1")).toBe(true);
    expect(profileListContainsIdentity(payload, "ding-corp", "missing")).toBe(false);
  });

  it("uses the current DWS organization when Agent Studio only knows the DingTalk userId", () => {
    const payload = {
      profiles: [
        { profile: "corp-a:user-1", corpId: "corp-a", userId: "user-1", isOrgCurrent: false },
        { profile: "corp-b:user-1", corpId: "corp-b", userId: "user-1", isOrgCurrent: true },
        { profile: "corp-b:other-user", corpId: "corp-b", userId: "other-user", isOrgCurrent: true }
      ]
    };

    expect(selectDwsProfile(payload, { dingtalkUserId: "user-1" })?.profile).toBe("corp-b:user-1");
    expect(selectDwsProfile(payload, { dingtalkUserId: "user-1" }, "corp-a:user-1")?.profile).toBe(
      "corp-a:user-1"
    );
    expect(selectDwsProfile(payload, { dingtalkUserId: "user-1" }, "corp-b:other-user")).toBeUndefined();
  });

  it("uses opaque per-user homes and exposes only DWS state plus the bound workspace", () => {
    const firstHome = dwsUserHomePath("/var/lib/agent-studio/dws-users", "agent-user-1");
    const secondHome = dwsUserHomePath("/var/lib/agent-studio/dws-users", "agent-user-2");
    expect(firstHome).not.toBe(secondHome);
    expect(firstHome).not.toContain("agent-user-1");

    const args = buildDwsSandboxArguments({
      binaryPath: "/usr/local/bin/dws",
      userHome: firstHome,
      workspacePath: "/var/lib/agent-studio/workspaces/thread-1",
      dwsArgs: ["version"]
    });
    expect(args).toContain("--clearenv");
    expect(args).toContain(firstHome);
    expect(args).toContain("/var/lib/agent-studio/workspaces/thread-1");
    expect(args.join(" ")).not.toContain("--ro-bind / /");
    expect(args).toEqual(expect.arrayContaining(["DWS_CONFIG_DIR", "/dws-home/.dws"]));
    expect(args).toEqual(expect.arrayContaining(["DWS_KEYCHAIN_DIR", "/dws-home/.local/share/dws-cli"]));
  });
});
