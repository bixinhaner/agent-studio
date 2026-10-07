#!/usr/bin/env node
// Blue-green chat keeps the previous release running against the migrated
// database until its in-flight runs finish, so every migration must stay
// compatible with the code that is still running ("expand, then contract").
// This check flags statements that break old code before they are applied.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATION_FILE = /^agent-api\/prisma\/migrations\/[^/]+\/migration\.sql$/;

// Each rule matches one SQL statement (comments stripped, whitespace collapsed).
const BREAKING_RULES = [
  { pattern: /\bDROP\s+TABLE\b/i, reason: "drops a table the running release may still query" },
  { pattern: /\bALTER\s+TABLE\b.*\bDROP\s+(COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b)"?\w)/i, reason: "drops a column the running release may still read or write" },
  { pattern: /\bRENAME\s+(COLUMN\b|TO\b)/i, reason: "renames a table or column the running release still uses" },
  { pattern: /\bALTER\s+(COLUMN\s+)?"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, reason: "changes a column type the running release may write" },
  { pattern: /\bALTER\s+(COLUMN\s+)?"?\w+"?\s+SET\s+NOT\s+NULL\b/i, reason: "makes a column required while the running release may still insert NULL" },
  { pattern: /\bDROP\s+TYPE\b/i, reason: "drops an enum or type the running release may use" },
  { pattern: /\bALTER\s+TYPE\b.*\b(RENAME|DROP)\b/i, reason: "renames or removes an enum value the running release may write" }
];

const WARNING_RULES = [
  { pattern: /\bDROP\s+INDEX\b/i, reason: "drops an index; old queries keep working but may slow down" }
];

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function statements(sql) {
  return stripComments(sql)
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function addsRequiredColumnWithoutDefault(statement) {
  if (!/\bALTER\s+TABLE\b/i.test(statement)) return false;
  // One ALTER TABLE may add several columns; check each ADD clause.
  return statement
    .split(/\bADD\s+(?:COLUMN\s+)?/i)
    .slice(1)
    .some((clause) => /\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause) && !/^\s*CONSTRAINT\b/i.test(clause));
}

/** @returns {{ breaking: Array<{ file: string, statement: string, reason: string }>, warnings: Array<{ file: string, statement: string, reason: string }> }} */
export function checkMigrationSql(file, sql) {
  const breaking = [];
  const warnings = [];
  for (const statement of statements(sql)) {
    const preview = statement.length > 160 ? `${statement.slice(0, 157)}...` : statement;
    // Creating tables (including their NOT NULL columns) never affects old code.
    if (/^CREATE\s+TABLE\b/i.test(statement)) continue;
    const rule = BREAKING_RULES.find((candidate) => candidate.pattern.test(statement));
    if (rule) {
      breaking.push({ file, statement: preview, reason: rule.reason });
      continue;
    }
    if (addsRequiredColumnWithoutDefault(statement)) {
      breaking.push({ file, statement: preview, reason: "adds a required column without a default; old inserts would fail" });
      continue;
    }
    const warning = WARNING_RULES.find((candidate) => candidate.pattern.test(statement));
    if (warning) warnings.push({ file, statement: preview, reason: warning.reason });
  }
  return { breaking, warnings };
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Migrations added between the running release and the commit being deployed. */
export function addedMigrationFiles(repo, base, head) {
  if (!base) return [];
  try {
    git(repo, ["cat-file", "-e", `${base}^{commit}`]);
  } catch {
    return [];
  }
  return git(repo, ["diff", "--name-only", "--diff-filter=AM", `${base}..${head}`, "--", "agent-api/prisma/migrations"])
    .split("\n")
    .filter((file) => MIGRATION_FILE.test(file));
}

export function checkMigrations({ repo, base, head }) {
  const result = { files: [], breaking: [], warnings: [] };
  for (const file of addedMigrationFiles(repo, base, head)) {
    const sql = git(repo, ["show", `${head}:${file}`]);
    const checked = checkMigrationSql(file, sql);
    result.files.push(file);
    result.breaking.push(...checked.breaking);
    result.warnings.push(...checked.warnings);
  }
  return result;
}

function parseArgs(argv) {
  const args = { allowBreaking: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--allow-breaking") {
      args.allowBreaking = true;
      continue;
    }
    const value = argv[index + 1] ?? "";
    index += 1;
    if (key === "--repo") args.repo = value;
    else if (key === "--base") args.base = value;
    else if (key === "--head") args.head = value;
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!args.repo || !args.head) throw new Error("--repo and --head are required");
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = checkMigrations(args);
  for (const item of result.warnings) console.error(`WARN ${item.file}: ${item.reason}\n  ${item.statement}`);
  for (const item of result.breaking) console.error(`BREAKING ${item.file}: ${item.reason}\n  ${item.statement}`);
  console.log(`checked ${result.files.length} new migration(s): ${result.breaking.length} breaking, ${result.warnings.length} warning(s)`);
  if (result.breaking.length && !args.allowBreaking) {
    console.error(
      "Old and new releases share the database during a blue-green switch. Split the change into an additive migration now and the removal in a later deploy, or rerun with --allow-breaking-migration after confirming the running release does not use the affected schema."
    );
    process.exitCode = 1;
  }
}
