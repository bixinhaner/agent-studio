import { isInternalPortalExperience } from "../auth/portal-experience";

export function canAccessPortalTraining(input: {
  userType?: string | null;
  organizationType?: string | null;
  membershipType?: string | null;
}): boolean {
  return isInternalPortalExperience(input);
}
