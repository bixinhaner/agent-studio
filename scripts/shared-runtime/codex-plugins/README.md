# Repository-managed Codex plugins

Each directory here is a Codex plugin installed on the server by
`scripts/shared-runtime/sync-codex-plugins.mjs` during every backend deploy:

1. The plugin is copied into the local `agentstudio-office` marketplace (path from
   `[marketplaces.agentstudio-office]` in the base `config.toml`).
2. `codex plugin add <name>@agentstudio-office` installs it into the base
   `CODEX_HOME`. Conversation homes link to its plugin cache, so new conversations
   use it without a chat restart.
3. The result is written to `shared/state/codex-plugins.json` and shown on the admin
   page 上下文与记忆 → 共享运行环境 → 托管插件.

Rules:

- Bump `version` in `.codex-plugin/plugin.json` for every change (suffix
  `-agentstudio.N` on top of the upstream version), so installed copies are
  distinguishable.
- `visualize`: the host renders fragments with
  `agent-ui/src/features/inline-visualization/host-kit/`, which must stay identical
  to `skills/visualize/assets/` (enforced by `host-kit-alignment.test.ts`). The skill
  must send fragments to `.agent-studio/visualizations/`, the directory the backend
  serves (checked by the admin plugin health and `managed-plugins.test.ts`).
- Check a server without changing it:
  `node scripts/shared-runtime/sync-codex-plugins.mjs --source scripts/shared-runtime/codex-plugins --codex-home /home/agentstudio/.codex --check`
