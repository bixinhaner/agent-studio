import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkMigrationSql, checkMigrations } from "./check-migration-compat.mjs";

const reasons = (sql) => checkMigrationSql("m.sql", sql).breaking.map((item) => item.reason);

test("additive migrations pass", () => {
  const result = checkMigrationSql(
    "m.sql",
    `-- comment mentioning DROP COLUMN is ignored
CREATE TABLE "x" ("id" TEXT NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));
ALTER TABLE "zendesk_runs" ADD COLUMN "owner_instance_id" TEXT;
ALTER TABLE "t" ADD COLUMN "n" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "t_n_idx" ON "t"("n");
ALTER TABLE "t" ALTER COLUMN "n" DROP NOT NULL;
ALTER TABLE "t" ALTER COLUMN "n" DROP DEFAULT;
ALTER TABLE "t" DROP CONSTRAINT "t_fk";
ALTER TYPE "Status" ADD VALUE 'NEW';`
  );
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(result.warnings, []);
});

test("statements that break the running release are flagged", () => {
  assert.equal(reasons('DROP TABLE "old";').length, 1);
  assert.equal(reasons('ALTER TABLE "t" DROP COLUMN "c";').length, 1);
  assert.equal(reasons('ALTER TABLE "t" RENAME COLUMN "a" TO "b";').length, 1);
  assert.equal(reasons('ALTER TABLE "t" RENAME TO "u";').length, 1);
  assert.equal(reasons('ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE BIGINT;').length, 1);
  assert.equal(reasons('ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;').length, 1);
  assert.equal(reasons('ALTER TABLE "t" ADD COLUMN "c" TEXT NOT NULL;').length, 1);
  assert.equal(reasons('ALTER TABLE "t" ADD COLUMN "ok" TEXT, ADD COLUMN "c" TEXT NOT NULL;').length, 1);
  assert.equal(reasons('DROP TYPE "Status";').length, 1);
});

test("dropping an index only warns", () => {
  const result = checkMigrationSql("m.sql", 'DROP INDEX "t_n_idx";');
  assert.equal(result.breaking.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("only migrations added since the running release are checked", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "migration-compat-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const write = (name, sql) => {
    const dir = path.join(repo, "agent-api/prisma/migrations", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "migration.sql"), sql);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    write("1_old", 'ALTER TABLE "t" DROP COLUMN "legacy";');
    const base = commit();
    write("2_new", 'ALTER TABLE "t" ADD COLUMN "c" TEXT;');
    const head = commit();
    const result = checkMigrations({ repo, base, head });
    assert.deepEqual(result.files, ["agent-api/prisma/migrations/2_new/migration.sql"]);
    assert.deepEqual(result.breaking, []);
    assert.deepEqual(checkMigrations({ repo, base: "", head }).files, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
