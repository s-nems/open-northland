---
description: Clean all bloated, historical, or redundant code comments in one file or tight feature without changing behavior.
argument-hint: <sim|render|app|pipeline|path|feature>
---

# Clean code comments

Clean one batch in `$ARGUMENTS`; with no scope, take the top of the candidate queue below. The batch
unit is one file cleaned completely; extend to a tight feature folder when its files share one
vocabulary. Do not leave a file half-cleaned.

Resolve `sim`, `render`, and `app` to their packages, and `pipeline` to `tools/asset-pipeline`.

## Select the batch

1. Read the root and nearest package `AGENTS.md` files.
2. Check `git status`; preserve existing work and skip files whose unrelated edits cannot be isolated.
3. Build the candidate queue with deterministic searches, in priority order:
   1. banned history and attribution:
      `git grep -ilE '(//|\*).*(20[0-9]{2}-[0-9]{2}|user (decision|feedback|rule|request|order|recollection|observation)|as requested|revised)' -- 'packages/*/src' 'tools/*/src'`;
   2. the scope's most comment-heavy files: highest comment-to-code ratio, longest comment blocks,
      densest `{@link}` chains.
4. Read the selected file beside its implementation, types, and relevant tests or callers. Do not
   judge a comment by length alone.

## Classify before editing

- Delete history and prose already expressed by code, names, types, or tests.
- Shorten a useful comment to one current fact in one direct sentence, normally one to three lines.
- Rewrite provenance impersonally and keep the fact: a dated user decision becomes `authored`, a
  recollection becomes `observation`; preserve `.ini` keys, byte evidence, and approximation names.
- Keep indivisible protocol layouts, security or legal boundaries, and byte-level format evidence.
- Leave a comment unchanged when its real fix requires a rename, type, extraction, or behavior change;
  report that hotspot as a candidate for `/refactor-cleanup` instead.

## Keep the pass comment-only

- Change comment text only. Do not modify executable code, types, data, assertions, or snapshots.
- Do not move discarded prose into a new ticket or document.
- Do not perform blind replacements. Re-read every result beside the code.

## Verify, commit, report

Review the full diff and confirm every changed line belongs to a comment. Run `git diff --check` and
the normal repository gates required by `AGENTS.md`.

In an autonomous cleanup loop, commit each verified batch in the repository's Conventional Commit
style without asking. Otherwise do not commit unless requested.

Report the scope, comments deleted, shortened, and deliberately retained, verification, and the
remaining candidate queue in order, so the next run starts without re-scanning. A clean run with no
useful changes is valid.
