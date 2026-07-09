import { describe, expect, it } from "vitest";

import { actionConnectorRuntimeEnvFromRunConfig } from "./runtime-env.js";

describe("actionConnectorRuntimeEnvFromRunConfig", () => {
  it("restores the persisted runtime config path for a resumed connector session", () => {
    expect(
      actionConnectorRuntimeEnvFromRunConfig({
        actionConnector: {
          integrationInstanceId: "connector-1",
          runtimeConfigPath: "/tmp/action-connector-runtime.json"
        }
      })
    ).toEqual({
      ACTION_CONNECTOR_RUNTIME_CONFIG: "/tmp/action-connector-runtime.json"
    });
  });

  it("does not add connector environment to unrelated or invalid run configs", () => {
    expect(actionConnectorRuntimeEnvFromRunConfig(undefined)).toEqual({});
    expect(actionConnectorRuntimeEnvFromRunConfig({ actionConnector: {} })).toEqual({});
    expect(
      actionConnectorRuntimeEnvFromRunConfig({
        actionConnector: { runtimeConfigPath: "   " }
      })
    ).toEqual({});
  });
});
