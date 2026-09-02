import { describe, expect, it } from "vitest";
import { CURATED_SKILL_PRESENTATIONS, NATIVE_PRESENTATION_BACKFILL_NAMES } from "./presentation-backfill-data.js";

const EXPECTED_MANAGED_NAMES = [
  "1-core-network-month-alarm-report",
  "analyze-kpi-evidence",
  "analyze-packet-capture-evidence",
  "analyze-telecom-competitors",
  "baicells-country-opportunity-assessment",
  "baicells-network-optimization-master",
  "baicells-config-guide-synthesis",
  "batch-template-docs",
  "bss-report",
  "build-baicells-network-health-report",
  "create-b26-market-proposal",
  "create-box-no-xlsx",
  "generate-cpe-rework-sql",
  "meeting-minutes-actions",
  "omc-operations",
  "oxm-operations",
  "parse-test-logs-to-xlsx",
  "power-outage-report",
  "ppt-gen",
  "recreate-image-as-pdf",
  "siteapp-surge-support",
  "ssh-device-inspector",
  "surge-vpn-manage",
  "test-daily-report",
  "text-metrics",
  "tp-generator",
  "use-cpe-manufacturing-db-schema",
  "weekly-alarm-operations-summary",
  "winforms-device-tool-maintainer",
  "write-weekly-report",
  "zendesk-data",
  "megrez-rf-planning"
];

describe("curated Skill presentation backfill data", () => {
  it("covers the active production managed Skill names and missing native entries", () => {
    for (const name of [...EXPECTED_MANAGED_NAMES, ...NATIVE_PRESENTATION_BACKFILL_NAMES]) {
      expect(CURATED_SKILL_PRESENTATIONS[name], name).toBeDefined();
    }
  });

  it("provides complete bilingual picker content", () => {
    for (const [name, presentation] of Object.entries(CURATED_SKILL_PRESENTATIONS)) {
      for (const [locale, value] of Object.entries(presentation)) {
        expect(value.displayName, `${name}:${locale}:displayName`).toBeTruthy();
        expect(value.summary, `${name}:${locale}:summary`).toBeTruthy();
        expect(value.useCases.length, `${name}:${locale}:useCases`).toBeGreaterThanOrEqual(2);
        expect(value.usageSteps.length, `${name}:${locale}:usageSteps`).toBeGreaterThanOrEqual(3);
        expect(value.examplePrompts.length, `${name}:${locale}:examplePrompts`).toBeGreaterThanOrEqual(2);
        expect(value.dataScope, `${name}:${locale}:dataScope`).toBeTruthy();
      }
    }
  });
});
