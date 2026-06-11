import { describe, expect, it } from "vitest";

import { resolveArtifactAccessPolicy } from "./thread-artifact-policy.js";
import { systemSettingsArtifactAccessSchema } from "../system-settings/types.js";

const baseArtifactAccess = {
  enabled: true,
  previewEnabled: true,
  downloadEnabled: true,
  autoRegisterGeneratedFiles: true,
  maxFileBytes: 25 * 1024 * 1024,
  retentionDays: 30,
  allowedExtensions: [".md"],
  blockHiddenPaths: true,
  blockUserUploadDirectory: true,
  blockKnowledgeSetCopies: true,
  secretScanEnabled: true,
  rules: []
};

describe("thread artifact policy", () => {
  it("accepts wildcard allowed extensions in system settings", () => {
    const parsed = systemSettingsArtifactAccessSchema.parse({
      ...baseArtifactAccess,
      allowedExtensions: ["*"]
    });

    expect(parsed.allowedExtensions).toEqual(["*"]);
  });

  it("preserves wildcard allowed extensions in resolved policy", () => {
    const policy = resolveArtifactAccessPolicy(
      {
        ...baseArtifactAccess,
        allowedExtensions: ["*"]
      },
      { id: "user-1", userType: "internal_employee" }
    );

    expect(policy.allowedExtensions).toEqual(["*"]);
  });
});
