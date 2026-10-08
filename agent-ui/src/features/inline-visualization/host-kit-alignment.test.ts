import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
// The visualize plugin is kept in the repo and installed into Codex by the deploy.
const skillAssets = path.resolve(here, "../../../../scripts/shared-runtime/codex-plugins/visualize/skills/visualize/assets");

describe("inline visualization host kit", () => {
  it.each([
    ["visualize.css", "visualize.css"],
    ["visualize-kit.html", "visualize.html"]
  ])("keeps host-kit/%s identical to the visualize skill's %s", (hostFile, skillFile) => {
    // The model styles fragments against the skill's base classes; the host must render the same ones.
    expect(readFileSync(path.join(here, "host-kit", hostFile), "utf8")).toBe(
      readFileSync(path.join(skillAssets, skillFile), "utf8")
    );
  });
});
