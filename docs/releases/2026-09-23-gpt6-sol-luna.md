# GPT-6 Sol and Luna

- Pin Codex SDK/CLI to 0.156.0. Linux production-account preflight lists both models and completes a shell-tool turn for each.
- Add both models to backend/frontend catalogs with 1,050,000 context; medium default. Codex Sol supports low through ultra; Luna low through max. These are Codex catalog capabilities, not direct API reasoning settings.
- Add global Standard prices without overwriting custom prices: Sol 2/0.2/2.5/10; Luna 0.1/0.01/0.125/0.5 USD per million input/cached-input/cache-write/output tokens. Above 272K input, input/cache x2 and output x1.5.
- Add choices to active nonempty Run Profile allowlists; retain defaults, persisted thread models and sandbox permissions.
- Synchronize standalone local report, snapshot aliases and Standard/Batch/Flex/Fast pricing. Fast long-context prices now follow the explicit per-model table.
- No historical attachment migration or historical accounting rewrite is part of this release.

Sources: https://developers.openai.com/api/docs/models/gpt-6-sol and https://developers.openai.com/api/docs/models/gpt-6-luna (2026-09-23).

Validation: backend build; 86 targeted backend tests; 6 frontend model tests; frontend build; real Linux CLI tool calls and cache telemetry for both models. Cache-write zero remained explicit in both real responses.
