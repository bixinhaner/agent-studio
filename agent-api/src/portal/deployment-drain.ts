export const DEPLOYMENT_DRAIN_ERROR_CODE = "DEPLOYMENT_DRAIN";

export class DeploymentDrainError extends Error {
  readonly code = DEPLOYMENT_DRAIN_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = "DeploymentDrainError";
  }
}

export function isDeploymentDrainError(error: unknown): error is DeploymentDrainError {
  return error instanceof DeploymentDrainError;
}

export async function assertDeploymentAllowsRuntimeStart(
  getDrainReason: () => Promise<string | undefined>
): Promise<void> {
  const reason = await getDrainReason();
  if (reason) throw new DeploymentDrainError(reason);
}
