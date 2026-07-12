---
description: Perform a controlled, behavior-preserving refactor of a requested Vinland package, path, or feature — cleanup, restructuring, performance, duplication removal, readability, packaging.
argument-hint: <scope: sim|render|app|pipeline|path|feature> [focus, e.g. performance, packaging, type safety]
---

# Refactor Cleanup

Perform an evidence-driven refactor pass inside the scope supplied in `$ARGUMENTS`. The pass is
expected to deliver a real improvement: address every justified finding in the scope, not a single
token-cheap tweak. Preserve behavior unless the user explicitly requests a behavior change.

```text
/refactor-cleanup sim
/refactor-cleanup sim performance in navigation
/refactor-cleanup packages/app/src/hud packaging and readability
```

## 1. Resolve the scope

Treat the first argument as a hard ownership boundary:

- `sim` -> `packages/sim`
- `render` -> `packages/render`
- `app` -> `packages/app`
- `pipeline` -> `tools/asset-pipeline`
- an existing path or feature name -> resolve it from the repository

Treat remaining arguments as an optional focus, such as `performance`, `packaging`, `navigation`,
or `type safety`. If no scope is supplied, ask for one before inspecting the whole repository.

A package-sized scope authorizes cleaning up that whole package **including its public API and its
tests** — test files are code inside the scope, not a read-only verification fixture. Fix every
problem inside the scope that the diagnosis justifies — do not stop after the first
improvement, and do not shrink the pass to save effort. What bounds the pass is the scope and the
evidence, not diff size.

The boundary limits where you *diagnose*, not what you may *edit*: when a justified finding
reshapes the scope's exported surface (a leaky export, an awkward signature, ownership sitting in
the wrong package), updating the callers in other packages is part of completing that finding, not
a boundary violation. What stays out of bounds is opportunistic cleanup of other packages'
internals that no in-scope finding requires.

## 2. Establish the constraints

1. The root `AGENTS.md` contract applies in full. Also read the package-local `AGENTS.md` for every
   package the change may touch, and relevant architecture or testing docs only when the selected
   change depends on them.
2. Inspect `git status` and preserve all pre-existing user changes. Never revert unrelated work.
3. When a ticket (`docs/tickets/…`) is named, treat it as authoritative and keep the refactor
   within its scope.
4. Work in the current checkout. Do not create, merge, or remove a worktree; the user invokes the
   project's `/worktree` workflow separately when required.

## 3. Diagnose before editing

Read the implementation, real callers, tests, and dependency direction. Identify concrete problems
with file references. Distinguish maintenance risk from personal style preference.

Establish a green baseline: run the scope's focused tests before editing. A pre-existing failure is
reported to the user, not absorbed into the refactor or silently worked around.

Collect all justified findings in the scope, ordered by value:

1. Fragile invariants, unclear ownership, or boundary violations.
2. Degraded cross-package contracts: exports that leak scope internals, signatures grown by
   accretion, data or logic living in the wrong package, or seams (e.g. between `sim`, `render`,
   and `app`) that force callers into workarounds. Diagnose these by reading the real callers on
   the other side of the boundary.
3. Hot-path work with an avoidable scaling or allocation cost.
4. Mixed responsibilities, overgrown modules (files around 300 lines or more), and flat
   directories accumulating unrelated concerns side by side.
5. Real duplication with at least two callers.
6. Sprawling function signatures — parameter lists where several values always travel together
   (a context, a node, a config) and should collapse into an existing domain type or a parameter
   object threaded through the call chain.
7. Misleading names, weak types, dead code, and unnecessary indirection.
8. Test debt on the same footing as production debt: duplicated setup with no shared fixture or
   builder, overgrown test files mixing unrelated concerns, copy-pasted assertion blocks,
   dead or misnamed tests, and tests coupled to internals a refactor should be free to move.
   Refactoring tests preserves *what is proven* the way refactoring code preserves behavior —
   assertions may be restructured, never weakened or deleted to make a pass easier.

The plan for the pass is the full ranked list, not its top entry. Before editing, state the
findings, expected benefit, behavior that must remain stable, and regression risk. Drop a finding
only because the evidence does not support it or it requires a behavior change — never because the
pass already contains "enough" work. If the requested performance problem is not supported by
measurement, complexity analysis, or an obvious hot-path cost, do not invent an optimization;
proceed with the remaining evidence-backed findings or report that no justified change was found.

## 4. Refactor pragmatically

The repository's code-quality rules (feature grouping, second-caller deduplication, dead-code
deletion, strict TypeScript, comment discipline) are defined in `AGENTS.md`; follow them there
rather than from memory of this file. On top of that contract, this pass specifically requires:

- Preserve observable behavior. Public APIs — including cross-package contracts between `sim`,
  `render`, and `app` — are *not* sacred: reshape them when a finding justifies it, and update
  every caller and test in the same pass so the repository never holds a half-migrated contract.
  Do not keep a compatibility shim or re-export alive for callers you can fix right now.
- Apply SOLID as a diagnostic tool, not as a requirement to introduce classes, interfaces,
  factories, or layers.
- Prefer existing repository patterns and domain-specific names over generic helpers.
- Add no dependency unless its concrete benefit exceeds its ownership and maintenance cost.
- Avoid speculative extensibility. Make the next likely change easier without designing for
  hypothetical callers.
- Every hunk must trace back to a stated finding. Outside the scope, fix nothing and create no new
  debt ledger; inside the scope, an untouched justified finding is a defect of the pass, not
  restraint.
- Work through the findings in ranked order and commit-sized units, so a partial pass still leaves
  the scope strictly better and mechanically verifiable.

### Packaging decomposition

Flat directories and ever-growing god modules are this repository's recurring failure mode; treat
decomposing them as first-class refactor value, not cosmetics. When the pass splits a module or
directory:

- Split by domain concern (what the code is about), never by kind (`utils/`, `helpers/`,
  `types/`). Prefer deepening an existing feature tree over widening a flat directory with
  another sibling file.
- Give the extracted feature a subfolder with an `index.ts` barrel so external import paths stay
  stable; files inside the folder import each other directly, not through the barrel.
- A split is a move, not a rewrite: bodies move verbatim, and any rename or logic change rides in
  its own clearly separable diff hunks so the move stays mechanically verifiable.
- Finish the extraction: leave no half-moved module where the old file survives as a grab-bag of
  leftovers with a vague name.
- Test files get the same treatment: split an overgrown spec by the concern it proves, extract
  shared fixtures and builders next to the tests that use them, and keep each test file paired
  with the feature it covers.

### Engine constraints

For `sim`, preserve determinism, fixed-point state, canonical decision ordering, and active-work
scaling. For render and app hot paths, keep per-frame work screen-bounded. Never update a golden
hash merely to make a refactor pass: a moved golden during a refactor means behavior changed.

## 5. Prove the change

1. Add or strengthen the lowest-level useful tests before changing risky behavior boundaries.
2. Implement each finding as its own coherent patch; small patches are a sequencing tool, not a
   licence to stop early.
3. Re-read the diff for accidental behavior changes, needless abstractions, packaging churn, and
   missed cleanup in code already touched.
4. For a non-trivial diff, spawn the project's `code-reviewer` agent on it — plus `engine-reviewer`
   when the diff touches `packages/sim` or a per-tick/per-frame hot path — and triage their
   findings before reporting. Skip for mechanical renames and small moves.
5. Run focused tests first, then the applicable project gates. Normal code changes should run
   `npm test`, `npm run check`, and `npm run build`; structural changes should also run
   `npm run scan:structure`.
6. For performance work, compare before and after using a benchmark when one exists; otherwise
   state the specific complexity, allocation, or operation-count improvement. Do not claim
   unmeasured wall-clock gains.
7. Follow the repository's visual, pipeline, scenario, and golden verification rules when the scope
   triggers them.

Do not commit unless the user or the active workflow explicitly requests a commit.

## 6. Report

Lead with the findings addressed and why they were worth fixing. Then report changed files,
preserved behavior, verification results (including reviewer-agent triage when run), and remaining
risks. List any finding that was diagnosed but dropped, with the concrete reason (insufficient
evidence, behavior change required); do not expand the completed pass after the fact.

A dropped finding that is still real work (needs a behavior change, is rooted in another package's
internals, or deserves its own session) does not evaporate into the report — but a finding about
the scope's own API is in scope even when fixing it touches callers elsewhere, so do not drop it as
"cross-boundary". File genuinely out-of-scope work as a self-contained ticket under
`docs/tickets/` (see `docs/tickets/README.md`, dedupe first) before reporting. Only findings
dismissed as not actually justified stay report-only.
