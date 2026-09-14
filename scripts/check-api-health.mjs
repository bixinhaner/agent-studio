#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export async function checkApiHealth(targets, { timeoutMs = 5000 } = {}) {
  return Promise.all(targets.map(async ({ name, url }) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      const body = await response.json();
      return { name, ok: response.ok && body?.ok === true, status: response.status };
    } catch {
      // Do not echo response bodies or request URLs from operator configuration.
      return { name, ok: false, error: "unreachable, timed out, or invalid health response" };
    }
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const targets = [];
  for (let i = 0; i < args.length; i += 2) {
    const name = { "--admin-url": "admin", "--chat-url": "chat", "--public-chat-url": "public-chat" }[args[i]];
    if (!name || !args[i + 1]) throw new Error("Usage: check-api-health.mjs --admin-url URL --chat-url URL [--public-chat-url URL]");
    targets.push({ name, url: args[i + 1] });
  }
  if (!targets.some(target => target.name === "admin") || !targets.some(target => target.name === "chat")) {
    throw new Error("Both admin and chat health URLs are required");
  }
  const results = await checkApiHealth(targets);
  console.log(JSON.stringify({ ok: results.every(result => result.ok), services: results }));
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
