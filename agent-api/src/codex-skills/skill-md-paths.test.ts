import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { collectAbsoluteSkillMdPaths } from "./skill-md-paths.js";

describe("skill path scanning", () => {
  it("preserves quoted paths, escaped spaces, mixed case, and multiple reads", () => {
    const paths = collectAbsoluteSkillMdPaths(`cat "/skills/my skill/SKILL.md"; head /skills/other\\ skill/SKILL.md && cat /skills/third/skill.MD`);
    expect(paths).toContain("/skills/my skill/SKILL.md");
    expect(paths).toContain("/skills/other skill/SKILL.md");
    expect(paths).toContain("/skills/third/skill.MD");
    expect(collectAbsoluteSkillMdPaths("find /skills -name SKILL.md")).toEqual([]);
  });

  it("bounds hostile tool input in both live and historical readers", () => {
    // A separate process gives the regression a real deadline; a Vitest
    // promise timeout cannot interrupt a synchronous RegExp on the event loop.
    const code = `
      import assert from 'node:assert/strict';
      import { CodexInstructionReadObserver } from './src/codex-skills/instruction-read-observer.ts';
      import { parseHistoricalInstructionReadRollout } from './src/codex-skills/historical-instruction-read-backfill.ts';
      const noise = String.fromCharCode(92).repeat(100_000) + 'x'.repeat(100_000);
      const observer = new CodexInstructionReadObserver();
      const event = input => ({ type:'item.completed', raw:{ item:{ type:'mcp_tool_call', arguments:input, success:true, contentItems:[{ text:'ok' }] } } });
      assert.deepEqual(observer.push(event(noise)), []);
      const input = noise + '; cat /runtime/skills/safe/SKILL.md';
      assert.equal(observer.push(event(input))[0].name, 'safe');
      const lines = [
        { timestamp:'2026-09-14T00:00:00Z', type:'turn_context', payload:{ turn_id:'t', cwd:'/tmp/thread-demo' } },
        { timestamp:'2026-09-14T00:00:01Z', type:'response_item', payload:{ type:'custom_tool_call', call_id:'c', input } },
        { timestamp:'2026-09-14T00:00:02Z', type:'response_item', payload:{ type:'custom_tool_call_output', call_id:'c', output:'read ok' } }
      ].map(x => JSON.stringify(x)).join(String.fromCharCode(10));
      assert.equal(parseHistoricalInstructionReadRollout(lines).turns[0].reads[0].name, 'safe');
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: new URL("../../", import.meta.url), timeout: 5000, encoding: "utf8"
    }).trim()).toBe("ok");
  });
});
