import { z } from "zod";

const dbEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, "DATABASE_URL is required")
});

export type DbEnv = {
  databaseUrl: string;
};

let cachedProcessEnv: DbEnv | undefined;

export function getDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  const shouldUseCache = env === process.env;
  if (shouldUseCache && cachedProcessEnv) {
    return cachedProcessEnv;
  }

  const parsed = dbEnvSchema.parse(env);
  const resolvedEnv = {
    databaseUrl: parsed.DATABASE_URL
  };
  if (shouldUseCache) {
    cachedProcessEnv = resolvedEnv;
  }

  return resolvedEnv;
}

export function resetDbEnvForTests(): void {
  cachedProcessEnv = undefined;
}
