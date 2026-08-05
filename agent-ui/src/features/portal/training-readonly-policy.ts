export type ThreadReadOnlyPresentation = {
  mutationReadOnly: boolean;
  contentAriaDisabled: boolean;
};

export function resolveThreadReadOnlyPresentation(input: {
  trainingReadOnly: boolean;
  sharedThreadReadonly: boolean;
}): ThreadReadOnlyPresentation {
  return {
    mutationReadOnly: input.trainingReadOnly || input.sharedThreadReadonly,
    // Training content remains interactive for preview, download, copy and navigation.
    // The legacy shared-thread shield still owns the disabled presentation for now.
    contentAriaDisabled: !input.trainingReadOnly && input.sharedThreadReadonly
  };
}
