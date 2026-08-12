import fs from "node:fs/promises";
import path from "node:path";

import type { PrismaClient, SkillCatalogEntry, SkillCatalogTranslation } from "@prisma/client";

import { createDbClient } from "../db/client.js";
import {
  CURATED_SKILL_PRESENTATIONS,
  NATIVE_PRESENTATION_BACKFILL_NAMES,
  type CuratedSkillPresentation
} from "../skill-catalog/presentation-backfill-data.js";
import type { SkillCatalogLocalizedContent } from "../skill-catalog/types.js";

type CliOptions = {
  apply: boolean;
  report?: string;
};

type TranslationPlan = {
  entryId: string;
  canonicalName: string;
  locale: "zh-CN" | "en-US";
  action: "create" | "update" | "unchanged";
  content: SkillCatalogLocalizedContent;
};

type BackfillPlan = {
  mode: "dry-run" | "apply";
  activeManagedInstances: number;
  managedInstancesCovered: number;
  missingManagedNames: string[];
  nativeEntriesCovered: number;
  missingNativeEntries: string[];
  entriesToCreate: number;
  entriesToPublish: number;
  translationsToCreate: number;
  translationsToUpdate: number;
  unchangedTranslations: number;
  createdEntries: number;
  publishedEntries: number;
  createdTranslations: number;
  updatedTranslations: number;
  samples: Array<{
    sourceType: "managed" | "native";
    canonicalName: string;
    sourceRef: string;
    entryId: string;
    translations: Array<{ locale: string; action: string; displayName?: string }>;
  }>;
};

function usage(): never {
  console.error([
    "Usage: node dist/ops/backfill-skill-catalog-presentations.js [--dry-run|--apply] [--report <path>]",
    "",
    "Dry-run is the default. Apply mode creates missing catalog entries for active managed Skills,",
    "publishes curated bilingual presentation content, and updates only the explicitly curated native entries."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--report") {
      const value = argv[index + 1]?.trim();
      if (!value) usage();
      options.report = path.resolve(value);
      index += 1;
    } else usage();
  }
  return options;
}

function managedCatalogKey(skill: { id: string; organizationId: string | null }): string {
  return `${skill.organizationId ? `org:${skill.organizationId}` : "global"}:managed:${skill.id}`;
}

function translationData(content: SkillCatalogLocalizedContent): {
  displayName: string | null;
  summary: string | null;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope: string | null;
} {
  return {
    displayName: content.displayName ?? null,
    summary: content.summary ?? null,
    useCases: content.useCases,
    usageSteps: content.usageSteps,
    examplePrompts: content.examplePrompts,
    dataScope: content.dataScope ?? null
  };
}

function normalizedTranslation(row: SkillCatalogTranslation | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  return {
    displayName: row.displayName,
    summary: row.summary,
    useCases: row.useCases,
    usageSteps: row.usageSteps,
    examplePrompts: row.examplePrompts,
    dataScope: row.dataScope
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function translationPlans(input: {
  entryId: string;
  canonicalName: string;
  presentation: CuratedSkillPresentation;
  existing: SkillCatalogTranslation[];
}): TranslationPlan[] {
  const byLocale = new Map(input.existing.map((row) => [row.locale, row] as const));
  return ([
    ["zh-CN", input.presentation.zh],
    ["en-US", input.presentation.en]
  ] as const).map(([locale, content]) => {
    const existing = byLocale.get(locale);
    const next = translationData(content);
    return {
      entryId: input.entryId,
      canonicalName: input.canonicalName,
      locale,
      action: !existing ? "create" : sameJson(normalizedTranslation(existing), next) ? "unchanged" : "update",
      content
    };
  });
}

async function existingTranslations(db: PrismaClient, entryId: string): Promise<SkillCatalogTranslation[]> {
  return db.skillCatalogTranslation.findMany({ where: { catalogEntryId: entryId } });
}

async function applyTranslations(db: PrismaClient, plans: TranslationPlan[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const plan of plans) {
    if (plan.action === "unchanged") continue;
    const data = translationData(plan.content);
    await db.skillCatalogTranslation.upsert({
      where: { catalogEntryId_locale: { catalogEntryId: plan.entryId, locale: plan.locale } },
      create: { catalogEntryId: plan.entryId, locale: plan.locale, ...data },
      update: data
    });
    if (plan.action === "create") created += 1;
    else updated += 1;
  }
  return { created, updated };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const plan: BackfillPlan = {
    mode: options.apply ? "apply" : "dry-run",
    activeManagedInstances: 0,
    managedInstancesCovered: 0,
    missingManagedNames: [],
    nativeEntriesCovered: 0,
    missingNativeEntries: [],
    entriesToCreate: 0,
    entriesToPublish: 0,
    translationsToCreate: 0,
    translationsToUpdate: 0,
    unchangedTranslations: 0,
    createdEntries: 0,
    publishedEntries: 0,
    createdTranslations: 0,
    updatedTranslations: 0,
    samples: []
  };

  try {
    const activeManaged = await db.codexManagedSkill.findMany({
      where: { status: "active" },
      orderBy: [{ skillName: "asc" }, { id: "asc" }]
    });
    plan.activeManagedInstances = activeManaged.length;
    plan.missingManagedNames = [...new Set(activeManaged
      .map((skill) => skill.skillName)
      .filter((name) => !CURATED_SKILL_PRESENTATIONS[name]))].sort();

    const targets: Array<{
      sourceType: "managed" | "native";
      sourceRef: string;
      canonicalName: string;
      entry: SkillCatalogEntry;
      translationPlans: TranslationPlan[];
      created: boolean;
      publish: boolean;
    }> = [];

    for (const skill of activeManaged) {
      const presentation = CURATED_SKILL_PRESENTATIONS[skill.skillName];
      if (!presentation) continue;
      plan.managedInstancesCovered += 1;
      const catalogKey = managedCatalogKey(skill);
      const existing = await db.skillCatalogEntry.findUnique({ where: { catalogKey } });
      const syntheticEntry = existing ?? ({
        id: `dry-run:${catalogKey}`,
        catalogKey,
        organizationId: skill.organizationId,
        sourceType: "managed",
        sourceRef: skill.id,
        canonicalName: skill.skillName,
        defaultLocale: "zh-CN",
        iconKey: "sparkles",
        sortOrder: 1000,
        shortcutKey: null,
        status: "active",
        publishedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0)
      } satisfies SkillCatalogEntry);
      const entry = syntheticEntry;
      const translations = existing ? await existingTranslations(db, existing.id) : [];
      const plans = translationPlans({ entryId: entry.id, canonicalName: skill.skillName, presentation, existing: translations });
      targets.push({ sourceType: "managed", sourceRef: skill.id, canonicalName: skill.skillName, entry, translationPlans: plans, created: !existing, publish: !existing?.publishedAt });
    }

    for (const name of NATIVE_PRESENTATION_BACKFILL_NAMES) {
      const entry = await db.skillCatalogEntry.findUnique({ where: { catalogKey: `global:native:${name}` } });
      if (!entry) {
        plan.missingNativeEntries.push(name);
        continue;
      }
      plan.nativeEntriesCovered += 1;
      const plans = translationPlans({
        entryId: entry.id,
        canonicalName: name,
        presentation: CURATED_SKILL_PRESENTATIONS[name],
        existing: await existingTranslations(db, entry.id)
      });
      targets.push({ sourceType: "native", sourceRef: name, canonicalName: name, entry, translationPlans: plans, created: false, publish: !entry.publishedAt });
    }

    plan.entriesToCreate = targets.filter((target) => target.created).length;
    plan.entriesToPublish = targets.filter((target) => target.publish).length;
    const allTranslationPlans = targets.flatMap((target) => target.translationPlans);
    plan.translationsToCreate = allTranslationPlans.filter((item) => item.action === "create").length;
    plan.translationsToUpdate = allTranslationPlans.filter((item) => item.action === "update").length;
    plan.unchangedTranslations = allTranslationPlans.filter((item) => item.action === "unchanged").length;

    if (options.apply) {
      await db.$transaction(async (tx) => {
        for (const target of targets) {
          const entry = target.created
            ? await tx.skillCatalogEntry.create({
                data: {
                  catalogKey: target.entry.catalogKey,
                  organizationId: target.entry.organizationId,
                  sourceType: target.sourceType,
                  sourceRef: target.sourceRef,
                  canonicalName: target.canonicalName,
                  defaultLocale: "zh-CN",
                  iconKey: "sparkles",
                  sortOrder: 1000,
                  status: "active",
                  publishedAt: new Date()
                }
              })
            : target.entry;
          if (target.publish && !target.created) {
            await tx.skillCatalogEntry.update({
              where: { id: entry.id },
              data: { status: "active", publishedAt: new Date() }
            });
          }
          const result = await applyTranslations(
            tx as PrismaClient,
            target.translationPlans.map((item) => ({ ...item, entryId: entry.id }))
          );
          plan.createdTranslations += result.created;
          plan.updatedTranslations += result.updated;
        }
      });
      plan.createdEntries = plan.entriesToCreate;
      plan.publishedEntries = plan.entriesToPublish;
    }

    plan.samples = targets.slice(0, 12).map((target) => ({
      sourceType: target.sourceType,
      canonicalName: target.canonicalName,
      sourceRef: target.sourceRef,
      entryId: target.entry.id,
      translations: target.translationPlans.map((item) => ({
        locale: item.locale,
        action: item.action,
        displayName: item.content.displayName
      }))
    }));

    if (options.report) {
      await fs.mkdir(path.dirname(options.report), { recursive: true });
      await fs.writeFile(options.report, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify({ ...plan, report: options.report }, null, 2));
    if (plan.missingManagedNames.length > 0 || plan.missingNativeEntries.length > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

await main();
