import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const watchdog = path.join(path.dirname(fileURLToPath(import.meta.url)), "shared-runtime/chat-watchdog.sh");

// One local server plays both the chat slot (/internal/ready) and the admin alert endpoint.
const world = { ready: true, readyAfterRestart: true, alerts: [] };
let server;
let port;
let root;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/internal/ready") {
      res.writeHead(world.ready ? 200 : 503).end();
      return;
    }
    if (req.url === "/control/restart") {
      world.ready = world.readyAfterRestart;
      res.writeHead(200).end();
      return;
    }
    if (req.url === "/internal/ops/service-health-alert" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk)).on("end", () => {
        world.alerts.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(() => server.close());

beforeEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(path.join(tmpdir(), "chat-watchdog-"));
  writeFileSync(path.join(root, "chat.slot"), "b\n");
  writeFileSync(path.join(root, "jlist.json"), JSON.stringify([{ name: "agent-studio-chat-api-b", pm2_env: { status: "stopped" } }]));
  writeFileSync(path.join(root, "pm2.log"), "");
  const fakePm2 = path.join(root, "pm2");
  writeFileSync(
    fakePm2,
    `#!/usr/bin/env bash
echo "$*" >> "${root}/pm2.log"
case "$1" in
  jlist) cat "${root}/jlist.json" ;;
  restart|start) curl -fsS -X POST "http://127.0.0.1:${port}/control/restart" >/dev/null ;;
esac
`
  );
  chmodSync(fakePm2, 0o755);
  Object.assign(world, { ready: true, readyAfterRestart: true, alerts: [] });
});

function check(args = [], env = {}) {
  return run("bash", [watchdog, ...args], {
    env: {
      ...process.env,
      DEPLOY_STATE_DIR: root,
      CHAT_WATCHDOG_STATE_DIR: path.join(root, "state"),
      AGENT_STUDIO_DEPLOY_LOCK_FILE: path.join(root, "deploy.lock"),
      CHAT_API_PORT: String(port),
      CHAT_B_API_PORT: String(port),
      CHAT_WATCHDOG_ADMIN_URL: `http://127.0.0.1:${port}`,
      CHAT_WATCHDOG_READY_TIMEOUT_SECONDS: "1",
      CHAT_WATCHDOG_READY_POLL_SECONDS: "1",
      PM2_BIN: path.join(root, "pm2"),
      ...env
    }
  });
}

const pm2Calls = () => readFileSync(path.join(root, "pm2.log"), "utf8").split("\n").filter((line) => line && line !== "jlist");

test("a ready slot needs nothing", async () => {
  await check();
  assert.deepEqual(world.alerts, []);
  assert.deepEqual(pm2Calls(), []);
});

test("restarts the active slot after three failed checks and reports outage and recovery", async () => {
  world.ready = false;
  await check();
  await check();
  assert.deepEqual(world.alerts, [], "single blips do not alert");
  assert.deepEqual(pm2Calls(), []);

  await check();
  assert.deepEqual(pm2Calls(), ["restart agent-studio-chat-api-b", "save"]);
  assert.deepEqual(
    world.alerts.map((alert) => [alert.event, alert.slot, alert.consecutiveFailures, alert.pm2Status]),
    [
      ["down", "b", 3, "stopped"],
      ["restarted", "b", 3, "stopped"]
    ]
  );
  assert.match(world.alerts[1].downSince, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  await check();
  assert.equal(world.alerts.length, 2, "nothing more once it is back");
});

test("keeps alerting slowly while a restart does not help, then reports recovery", async () => {
  world.ready = false;
  world.readyAfterRestart = false;
  for (let i = 0; i < 3; i += 1) await check();
  assert.deepEqual(world.alerts.map((alert) => alert.event), ["down", "restart_failed"]);

  await check();
  assert.equal(world.alerts.length, 2, "no repeat inside the retry interval");
  assert.equal(pm2Calls().filter((call) => call.startsWith("restart")).length, 1);

  await check([], { CHAT_WATCHDOG_RETRY_INTERVAL_SECONDS: "0" });
  assert.deepEqual(world.alerts.map((alert) => alert.event), ["down", "restart_failed", "down", "restart_failed"]);

  world.ready = true;
  await check();
  assert.deepEqual(world.alerts.at(-1).event, "recovered");
});

test("starts a slot PM2 no longer knows from the ecosystem file", async () => {
  writeFileSync(path.join(root, "jlist.json"), "[]");
  world.ready = false;
  for (let i = 0; i < 3; i += 1) await check([], { PM2_ECOSYSTEM_FILE: "/srv/ecosystem.cjs" });
  assert.deepEqual(pm2Calls(), ["start /srv/ecosystem.cjs --only agent-studio-chat-api-b --update-env", "save"]);
});

test("a drill against another slot only detects and alerts once", async () => {
  world.ready = false;
  for (let i = 0; i < 4; i += 1) await check(["--slot", "a", "--no-restart"]);
  assert.deepEqual(pm2Calls(), []);
  assert.deepEqual(world.alerts.map((alert) => [alert.event, alert.slot]), [["down", "a"]]);
  assert.match(world.alerts[0].detail, /演练/);

  world.ready = true;
  await check(["--slot", "a", "--no-restart"]);
  assert.deepEqual(world.alerts.map((alert) => alert.event), ["down", "recovered"]);
});

test("--test-alert sends one test alert", async () => {
  await check(["--test-alert"]);
  assert.deepEqual(world.alerts.map((alert) => [alert.event, alert.slot]), [["test", "b"]]);
});
