---
description: Review a diff with the project lenses and report ranked findings without editing.
argument-hint: [git range, branch, or paths; defaults to the current diff]
---

# Audit

Review the scope in `$ARGUMENTS`. This workflow is report-only. Do not edit files, create tickets, or
commit fixes unless the user asks in a later turn.

## Resolve the diff

- Explicit range, branch, or paths: review exactly that scope.
- Dirty tree with no argument: review staged and unstaged changes.
- Clean non-main branch: review `main...HEAD`.
- Clean `main`: review `HEAD~1..HEAD`.

State the exact scope and diff stat before starting.

## Apply the relevant lenses

Read the corresponding files under `.claude/agents/` and run independent reviewers in parallel when
the client supports it.

- `code-reviewer`: any source, test, tool, or configuration change.
- `engine-reviewer`: sim, fixed point, command flow, content schemas, or per-tick/per-frame paths.
- `gameplay-reviewer`: mechanics, extracted data, source claims, or player-facing UI/input.
- general correctness: broad or risky behavior not covered by the named lenses.

Skip lenses that cannot apply and say why. Documentation-only changes still need direct fact, link,
example, and readability checks even when all code lenses are skipped.

## Triage and report

Verify every proposed finding in the current source. Merge duplicates and drop preference-only
comments.

Rank findings as blocker, should-fix, or note. Use:

```text
file:line: defect; failure scenario; suggested fix
```

Add your own agree/disagree judgement for findings returned by reviewers. Name any visual or audio
checks that still need a human and give the exact scene or URL. Preserve the code reviewer's separate
structure and comment verdicts in the report; either `regressed` verdict makes a refactor need fixes.
End with one verdict: merge-ready, needs fixes, or needs human review.
