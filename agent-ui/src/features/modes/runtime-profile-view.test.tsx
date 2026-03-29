import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RuntimeProfileView } from "./runtime-profile-view";

describe("RuntimeProfileView", () => {
  it("renders a backend-provided runtime profile snapshot", () => {
    render(
      <RuntimeProfileView
        profile={{
          defaultModel: "gpt-5.4-pro",
          defaultReasoningEffort: "xhigh",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "live"
        }}
      />
    );

    expect(screen.getByText("gpt-5.4-pro")).toBeTruthy();
    expect(screen.getByText(/xhigh/i)).toBeTruthy();
    expect(screen.getByText(/workspace-write/i)).toBeTruthy();
    expect(screen.getByText(/never/i)).toBeTruthy();
    expect(screen.getByText(/live/i)).toBeTruthy();
  });
});
