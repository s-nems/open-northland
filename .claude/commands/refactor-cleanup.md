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

Choose exactly one cohesive hotspot with a clear verification seam. A successful run completes that
one finding; breadth is not a score. Do not make a cleanup tour through other ranked findings. Do not
optimize without a measured cost, an obvious complexity problem, or a repeated allocation in a known
hot path.

For every touched production module, classify its explanatory comments, regardless of focus:

- delete when code already states the fact;
- encode when the comment reveals a missing name, type, function, or boundary;
- retain for units, invariants, source basis, approximations, and necessary reasons.

`encode` is structural work, not successful comment deletion. Do not copy investigation, benchmark
results, caller inventories, or the commit rationale into source comments. In tests, prefer scenario,
fixture, and assertion names over prose that narrates the case.

When code is moved or extracted, treat the old module and every destination module as one comment
budget. Re-evaluate each moved comment instead of copying it mechanically, and do not add summary
JSDoc merely because a module or export is new. A behavior-preserving refactor may grow the combined
prose only for a previously unstated irreducible fact, which must be named in the final report.

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
- Prefer executable behavior tests, type boundaries, and existing repository hygiene rules. Do not
  build a one-off import walker or regex source scanner to prove the local cleanup.

Every hunk must trace to the selected finding. After that finding is complete, stop editing. Keep
nearby observations in the report rather than fixing or documenting them in the branch.

## Verify and report

Run focused tests first, then the applicable repository gates. Review the final diff with
`code-reviewer`, plus `engine-reviewer` for sim or hot frame paths, when the change is non-trivial.
For performance work, compare a benchmark or report the exact operation/complexity reduction without
inventing wall-clock gains.

Re-read each touched production module once with comments mentally hidden. For moved or extracted
code, compare the combined comment prose before and after rather than judging each destination in
isolation. Report scope, structure, and comment verdicts as shown below, naming any long comment
retained and the irreducible fact it carries:

```text
Scope: cohesive | fragmented
Structure: improved | neutral | regressed
Comments: improved | neutral | regressed
```

`Comments: neutral` is not available when narrative prose or long blocks grew without a newly required
irreducible fact. A refactor with fragmented scope or either `regressed` verdict is not ready for
handoff.

Do not create follow-up tickets during cleanup by default. Report other verified findings so the user
can choose the next run. File one only when the user requested backlog updates or a material blocker
would otherwise be lost; dedupe first and keep it compact.

Do not commit unless requested. Report the completed hotspot, changed files, verification, preserved
behavior, scope, structure and comment verdicts, reviewer triage, and remaining risk.
