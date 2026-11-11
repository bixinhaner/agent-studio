import path from "node:path";

import "../config.js";
import { createDbClient } from "../db/client.js";
import { listConnectorApps, loadConnectorApp, registerConnectorApp, type ConnectorAppDb } from "../integrations/action-connector/app-registration.js";
import { createHostKey } from "../local-bridge-service.js";

const USAGE = `usage:
  npm run connector-apps:register -- --all
      Sync the Skill, skill package and Agent Mode of every app in connector-apps/ (run by deploy).
  npm run connector-apps:register -- <slug> [--create-connector] [--host-key "<label>"]
      Register one app; optionally create its connector (if missing) and issue a host access key.
      The key is printed once; give it to the business system's administrator with Bailey's URL.`;

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const createConnector = args.includes("--create-connector");
  const keyAt = args.indexOf("--host-key");
  const hostKeyLabel = keyAt >= 0 ? args[keyAt + 1] : undefined;
  if (keyAt >= 0 && !hostKeyLabel) throw new Error(USAGE);
  const slugs = args.filter((arg, index) => !arg.startsWith("--") && index !== keyAt + 1);
  if (all === Boolean(slugs.length) || slugs.length > 1) throw new Error(USAGE);

  const apiRoot = process.cwd();
  const appsRoot = path.join(apiRoot, "connector-apps");
  const bundledSkillsDir = path.join(apiRoot, "bundled-skills");
  const directories = all ? await listConnectorApps(appsRoot) : [path.join(appsRoot, slugs[0])];

  const db = createDbClient();
  try {
    for (const directory of directories) {
      const app = await loadConnectorApp(directory);
      const result = await registerConnectorApp(db as unknown as ConnectorAppDb, app, { bundledSkillsDir, createConnector });
      const output: Record<string, unknown> = { ...result };
      if (hostKeyLabel) {
        if (!result.connector) throw new Error(`${app.slug}: the connector does not exist; add --create-connector`);
        const issued = await createHostKey(db, result.connector.id, { label: hostKeyLabel });
        output.hostKey = { id: issued.id, label: issued.label, key: issued.key };
      }
      console.log(JSON.stringify(output));
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
