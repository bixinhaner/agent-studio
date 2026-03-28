import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeSetPicker } from "./KnowledgeSetPicker";

describe("KnowledgeSetPicker", () => {
  it("shows default knowledge sets and lets the user add optional ones", () => {
    const onChange = vi.fn();

    render(
      <KnowledgeSetPicker
        defaultKnowledgeSets={[{ id: "ks-faq", label: "FAQ", slug: "faq" }]}
        optionalKnowledgeSets={[{ id: "ks-runbook", label: "Runbooks", slug: "runbooks" }]}
        selectedIds={[]}
        onChange={onChange}
      />
    );

    expect(screen.getByText("FAQ")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox", { name: "Runbooks" });
    expect(checkbox).toBeTruthy();

    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(["ks-runbook"]);
  });
});
