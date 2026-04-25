#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "agent-api");
const uiDir = path.join(root, "agent-ui");
const composeFile = path.join(root, "docker-compose.dev.yml");

const apiEnvDefaults = {
  NODE_ENV: "development",
  PORT: "8787",
  HOST: "0.0.0.0",
  DATABASE_URL: "postgresql://agent_studio:agent_studio_dev@127.0.0.1:55432/agent_studio?schema=public",
  DEFAULT_MODEL: "gpt-5.4",
  DEFAULT_REASONING_EFFORT: "high",
  DEFAULT_WORKSPACE: "..",
  SESSION_WORKSPACE_ROOT: "../sessions",
  SESSION_TTL_MINUTES: "0",
  SESSION_COOKIE_SECRET: randomBytes(32).toString("hex"),
  SESSION_COOKIE_SECURE: "false",
  WORKSPACE_WHITELIST: "..",
  APP_BASE_URL: "http://127.0.0.1:5173",
  AUTH_EMAIL_DEBUG: "true",
  ORG_SYNC_ENABLED: "false"
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return { lines: [], values: new Map() };
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return { lines, values };
}

function ensureEnvFile(filePath, defaults) {
  const parsed = parseEnvFile(filePath);
  const lines = parsed.lines.filter((line, index, all) => index < all.length - 1 || line.trim() !== "");
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    const current = parsed.values.get(key);
    if (current !== undefined && current.trim() !== "") continue;
    lines.push(`${key}=${value}`);
    changed = true;
  }
  if (changed || !fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
    console.log(`Updated ${path.relative(root, filePath)}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const result = spawnSync(
      "docker",
      ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_isready", "-U", "agent_studio", "-d", "agent_studio"],
      { cwd: root, stdio: "ignore" }
    );
    if (result.status === 0) return;
    await wait(1000);
  }
  throw new Error("Postgres did not become ready within 40 seconds.");
}

function spawnService(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit"
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${name} stopped by ${signal}`);
      return;
    }
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
    }
  });
  return child;
}

async function main() {
  ensureEnvFile(path.join(apiDir, ".env"), apiEnvDefaults);

  console.log("Starting local Postgres...");
  run("docker", ["compose", "-f", composeFile, "up", "-d", "postgres"]);
  await waitForPostgres();

  console.log("Applying Prisma migrations...");
  run("npm", ["run", "prisma:generate"], { cwd: apiDir });
  run("npm", ["run", "prisma:migrate:deploy"], { cwd: apiDir });
  run("npm", ["run", "dev:seed"], { cwd: apiDir });

  const children = [];
  if (await isPortListening(8787)) {
    console.log("API already listening on http://127.0.0.1:8787; leaving it running.");
  } else {
    children.push(spawnService("agent-api", "npm", ["run", "dev"], apiDir));
  }

  if (await isPortListening(5173)) {
    console.log("UI already listening on http://127.0.0.1:5173; leaving it running.");
  } else {
    children.push(spawnService("agent-ui", "npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"], uiDir));
  }

  console.log("");
  console.log("Local Agent Studio is starting:");
  console.log("  UI:  http://127.0.0.1:5173/");
  console.log("  API: http://127.0.0.1:8787/");
  console.log("  Login email: admin@local.agent-studio.test");
  console.log("  Verification code: read the API console line labelled [email-login-code].");

  if (children.length === 0) return;
  const stop = () => {
    for (const child of children) child.kill("SIGINT");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
