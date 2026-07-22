#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const MAX_FALLBACK_TOKENS = 5;

function required(value, name) {
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function queryTokens(query) {
  return [...new Set(query
    .toLowerCase()
    .replace(/[./_:?&=\-]+/g, " ")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean))]
    .slice(0, MAX_FALLBACK_TOKENS);
}

function runCatalog(cliPath, query) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "catalog", query], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `catalog exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("catalog returned invalid JSON"));
      }
    });
  });
}

function hasCandidates(result) {
  return Array.isArray(result?.items) && result.items.length > 0;
}

export async function searchCatalog({ cliPath, query }) {
  const attempts = [];
  const fullResult = await runCatalog(cliPath, query);
  attempts.push(query);
  if (hasCandidates(fullResult)) {
    return { ...fullResult, requestedQuery: query, resolvedQuery: query, attempts };
  }

  for (const token of queryTokens(query)) {
    if (token === query.toLowerCase()) continue;
    const result = await runCatalog(cliPath, token);
    attempts.push(token);
    if (hasCandidates(result)) {
      return { ...result, requestedQuery: query, resolvedQuery: token, attempts };
    }
  }
  return { ...fullResult, requestedQuery: query, resolvedQuery: null, attempts };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  searchCatalog({
    cliPath: path.resolve(required(argument("--cli"), "--cli")),
    query: required(argument("--query"), "--query")
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
