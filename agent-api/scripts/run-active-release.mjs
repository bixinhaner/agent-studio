// PM2 entry point. agent-api/dist is a symlink to the active release; importing
// it by its real path pins this process's modules, node_modules and the Codex
// binary to the release it started with, even after a later deploy switches the
// symlink.
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const entry = realpathSync(path.resolve(process.cwd(), "dist/index.js"));
await import(pathToFileURL(entry).href);
