import { PrismaClient } from "@prisma/client";

import { getDbEnv } from "./env.js";

let sharedClient: PrismaClient | undefined;

export function createDbClient(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  const dbEnv = getDbEnv(env);
  return new PrismaClient({
    datasources: {
      db: {
        url: dbEnv.databaseUrl
      }
    }
  });
}

export function getDbClient(): PrismaClient {
  if (!sharedClient) {
    sharedClient = createDbClient();
  }

  return sharedClient;
}

export function resetDbClientForTests(): void {
  sharedClient = undefined;
}
