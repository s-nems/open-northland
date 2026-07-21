---
description: Make one evidence-backed, behavior-preserving cleanup in a requested scope.
argument-hint: <sim|render|app|pipeline|path|feature> [focus]
---

# Refactor cleanup

Improve one coherent hotspot in `$ARGUMENTS`. Preserve observable behavior unless the user explicitly
asks for a behavior change. If no scope is supplied, ask for it instead of scanning the repository.

## Establish the boundary

Resolve common names as follows:

- `sim` to `packages/sim`
- `render` to `packages/render`
- `app` to `packages/app`
- `pipeline` to `tools/asset-pipeline`

Read root and relevant package `AGENTS.md` files. Check `git status` and preserve existing user work.
Work in the current checkout; `/worktree` owns isolated branch setup.

The scope controls what to diagnose. A justified API change may update callers outside it, but does
not authorize unrelated cleanup in those callers.

## Diagnose before editing

Read the implementation, real callers, tests, and public imports. Run a focused baseline test when
one exists. Rank concrete findings by:

1. broken ownership, unclear invariants, or boundary violations;
2. mixed responsibilities, unreadable orchestration, and overgrown modules;
3. hot-path scaling or unnecessary allocation;
4. real duplication with at least two callers;
5. misleading names, weak types, dead code, or needless indirection;
6. test structure that prevents safe changes.

An explicit focus may reorder findings inside that focus: for example, measured scaling leads a
`performance` pass. Without one, do not select an easier optimization while comments are visibly
compensating for missing structure in a higher-value hotspot.

Choose one cohesive hotspot with a clear verification seam. Do not optimize without a measured cost,
an obvious complexity problem, or a repeated allocation in a known hot path.

For every touched production module, classify its explanatory comments, regardless of focus:

- delete when code already states the fact;
- encode when the comment reveals a missing name, type, function, or boundary;
- retain for units, invariants, source basis, approximations, and necessary reasons.

`encode` is structural work, not successful comment deletion. Do not copy investigation, benchmark
results, caller inventories, or the commit rationale into source comments. In tests, prefer scenario,
fixture, and assertion names over prose that narrates the case.

State the selected hotspot, expected benefit, preserved behavior, and risk before editing.

## Refactor

- Prefer existing domain patterns over generic helpers or new dependencies.
- Change a public contract only when it resolves the finding; update every caller in the same pass.
- Split by domain concern, not by file kind. Use a feature folder and a small barrel when it preserves
  a useful import boundary.
- Separate mechanical moves from renames or logic-shaped cleanup in the diff.
- Remove obsolete shims and old exports once all callers are updated.
- Keep assertions equivalent or stronger. Never weaken a test to preserve a refactor claim.
- Never update a sim golden during a behavior-preserving pass.
- Delete or tighten comments made redundant in the touched code. A pre-existing cleanup ticket is not
  a waiver to expand an overgrown file or add another narrative section.

Every hunk must trace to the selected finding. Do not turn nearby observations into a larger rewrite.

## Verify and report

Run focused tests first, then the applicable repository gates. Review the final diff with
`code-reviewer`, plus `engine-reviewer` for sim or hot frame paths, when the change is non-trivial.
For performance work, compare a benchmark or report the exact operation/complexity reduction without
inventing wall-clock gains.

Re-read each touched production module once with comments mentally hidden. Report separate structure
and comment verdicts as `improved`, `neutral`, or `regressed`, naming any long comment retained and the
irreducible fact it carries. A refactor with either verdict `regressed` is not ready for handoff.

File a ticket only for a verified, valuable, independently actionable finding that remains outside
the chosen slice. Dedupe first. Small observations and rejected preferences stay in the report.

Do not commit unless requested. Report the completed hotspot, changed files, verification, preserved
behavior, structure and comment verdicts, reviewer triage, and remaining risk.
