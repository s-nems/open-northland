---
description: Clean redundant or historical comments in one file or tight feature without changing behavior.
argument-hint: <sim|render|app|pipeline|path|feature>
---

# Clean code comments

Apply the comment rules in [AGENTS.md](../../AGENTS.md) and the relevant package contract to
`$ARGUMENTS`. Resolve `sim`, `render`, and `app` to their packages, and `pipeline` to
`tools/asset-pipeline`. Preserve unrelated working changes.

With no scope, select one file with historical attribution, redundant narration or long comment
blocks. Read its implementation and relevant callers/tests before editing. Length alone is not a
reason to remove a comment; a pass with no useful changes is valid.

## Boundaries

- Change comments only. The sole code exception is an import made unused by removing a `{@link}`;
  name that deletion in the report. Strings, test titles, shaders and templates are executable data.
- Preserve source evidence, uncertainty and binding exceptions. Never strengthen a claim while
  shortening it. Use `authored` for a tuning decision and `observation` for a recollection;
  `approximation` describes divergence from the original game.
- If a comment needs a code or type change to become unnecessary, leave it for a separate refactor.
- Do not relocate discarded prose to another document or change surrounding code layout.

Review the diff against the implementation: useful facts survive, historical narration does not,
and behavior is unchanged. Run `git diff --check` and the applicable checks from
[TESTING.md](../../docs/TESTING.md). Follow existing commit authorization; an explicitly requested
autonomous cleanup loop commits each verified batch.

Report the scope, material exceptions and verification. List remaining candidates only if requested.
