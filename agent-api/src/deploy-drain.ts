import fs from "node:fs/promises";
import path from "node:path";

export type ServiceRole = "all" | "admin" | "chat";

const DEFAULT_DRAIN_REASON = "System is updating. Please retry in a few minutes.";

// The legacy shared file drains every role. Role files let a deploy that only
// restarts admin keep accepting new conversations on the chat service.
export function deployDrainFilesForRole(baseFile: string, role: ServiceRole): string[] {
  const parsed = path.parse(baseFile);
  const roleFile = (name: "admin" | "chat") => path.join(parsed.dir, `${parsed.name}-${name}${parsed.ext}`);
  const roles: Array<"admin" | "chat"> = role === "all" ? ["admin", "chat"] : [role];
  return [baseFile, ...roles.map(roleFile)];
}

export async function readDeploymentDrainReason(
  files: string[],
  onError?: (file: string, error: unknown) => void
): Promise<string | undefined> {
  for (const file of files) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      const reason =
        parsed && typeof parsed === "object" && typeof (parsed as { reason?: unknown }).reason === "string"
          ? (parsed as { reason: string }).reason.trim()
          : "";
      return reason || DEFAULT_DRAIN_REASON;
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") continue;
      onError?.(file, error);
    }
  }
  return undefined;
}
