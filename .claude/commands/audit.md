---
description: Review a bounded diff and report verified findings without editing.
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

## Review

Follow root `AGENTS.md` for reviewer count, handoff and model selection. Use
[code-reviewer](../agents/code-reviewer.md); its engine and fidelity sections apply only when the diff
touches those concerns. The same checklist works for direct review or one independent reviewer.

For fidelity questions, verify the evidence using the reviewer's source procedure and available MCP
tools. A passing test or agreement between reviewers is not proof of original behavior.

## Triage and report

Verify proposed findings in the current source before accepting them. Follow the reviewer's concise
finding format; merge duplicates and drop preference-only comments.

Report material verification gaps and any exact scene or URL needing human acceptance. End with one
verdict: merge-ready, needs fixes, or needs verification. Do not claim merge-ready while a required
check remains unresolved.
