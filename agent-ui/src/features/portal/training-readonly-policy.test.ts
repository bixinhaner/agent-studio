import { describe, expect, it } from "vitest";

import { resolveThreadReadOnlyPresentation } from "./training-readonly-policy";

describe("resolveThreadReadOnlyPresentation", () => {
  it("locks mutations without disabling training content", () => {
    expect(
      resolveThreadReadOnlyPresentation({
        trainingReadOnly: true,
        sharedThreadReadonly: false
      })
    ).toEqual({
      mutationReadOnly: true,
      contentAriaDisabled: false
    });
  });

  it("preserves the existing shared-thread disabled presentation", () => {
    expect(
      resolveThreadReadOnlyPresentation({
        trainingReadOnly: false,
        sharedThreadReadonly: true
      })
    ).toEqual({
      mutationReadOnly: true,
      contentAriaDisabled: true
    });
  });

  it("keeps the normal workspace fully interactive", () => {
    expect(
      resolveThreadReadOnlyPresentation({
        trainingReadOnly: false,
        sharedThreadReadonly: false
      })
    ).toEqual({
      mutationReadOnly: false,
      contentAriaDisabled: false
    });
  });
});
