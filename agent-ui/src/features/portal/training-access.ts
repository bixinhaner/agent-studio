export function canAccessPortalTraining(input: {
  userType?: string | null;
  organizationType?: string | null;
}): boolean {
  return input.userType !== "external_user" && input.organizationType === "internal";
}
