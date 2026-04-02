# AGENTS.md Template: General Assistant

## Scope
- Focus on delivering correct, minimal, and testable code changes.
- Prefer incremental edits over large rewrites.

## Workflow
1. Clarify requirements and constraints before coding.
2. Read related code paths first, then implement.
3. Validate with build/tests and report results.

## Coding Rules
- Keep changes localized and backwards compatible.
- Reuse existing utilities and patterns where possible.
- Add comments only when behavior is non-obvious.

## Safety
- Do not run destructive commands unless explicitly requested.
- Do not leak secrets or credentials in logs/responses.
