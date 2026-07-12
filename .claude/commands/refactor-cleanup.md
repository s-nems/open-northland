---
description: Perform a controlled, behavior-preserving refactor of a requested Vinland package, path, or feature — cleanup, restructuring, performance, duplication removal, readability, packaging.
argument-hint: <scope: sim|render|app|pipeline|path|feature> [focus, e.g. performance, packaging, type safety]
---

# Refactor Cleanup

Perform one evidence-driven cleanup pass inside the scope supplied in `$ARGUMENTS`. Preserve
behavior unless the user explicitly requests a behavior change.

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

A package-sized scope authorizes inspection of that package, not a package-wide rewrite. Select the
smallest cohesive improvement that produces meaningful value. Do not cross the boundary except for
callers, tests, or public contracts required to understand and safely complete that improvement.

## 2. Establish the constraints

1. The root `AGENTS.md` contract applies in full. Also read the package-local `AGENTS.md` for every
   package the change may touch, and relevant architecture or testing docs only when the selected
   change depends on them.
2. Inspect `git status` and preserve all pre-existing user changes. Never revert unrelated work.
3. When a live plan step is named, treat it as authoritative and keep the refactor within that step.
4. Work in the current checkout. Do not create, merge, or remove a worktree; the user invokes the
   project's `/worktree` workflow separately when required.

## 3. Diagnose before editing

Read the implementation, real callers, tests, and dependency direction. Identify concrete problems
with file references. Distinguish maintenance risk from personal style preference.

Establish a green baseline: run the scope's focused tests before editing. A pre-existing failure is
reported to the user, not absorbed into the refactor or silently worked around.

Prioritize candidates in this order:

1. Fragile invariants, unclear ownership, or boundary violations.
2. Hot-path work with an avoidable scaling or allocation cost.
3. Mixed responsibilities, overgrown modules (files around 300 lines or more), and flat
   directories accumulating unrelated concerns side by side.
4. Real duplication with at least two callers.
5. Misleading names, weak types, dead code, and unnecessary indirection.

State the selected improvement, expected benefit, behavior that must remain stable, and regression
risk before editing. If the requested performance problem is not supported by measurement,
complexity analysis, or an obvious hot-path cost, do not invent an optimization; choose another
evidence-backed improvement or report that no justified change was found.

## 4. Refactor pragmatically

The repository's code-quality rules (feature grouping, second-caller deduplication, dead-code
deletion, strict TypeScript, comment discipline) are defined in `AGENTS.md`; follow them there
rather than from memory of this file. On top of that contract, this pass specifically requires:

- Preserve public APIs and observable behavior unless changing them is necessary and explicitly
  justified.
- Apply SOLID as a diagnostic tool, not as a requirement to introduce classes, interfaces,
  factories, or layers.
- Prefer existing repository patterns and domain-specific names over generic helpers.
- Add no dependency unless its concrete benefit exceeds its ownership and maintenance cost.
- Avoid speculative extensibility. Make the next likely change easier without designing for
  hypothetical callers.
- Keep the diff narrow. Do not fix unrelated findings or create a new debt ledger.

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

### Engine constraints

For `sim`, preserve determinism, fixed-point state, canonical decision ordering, and active-work
scaling. For render and app hot paths, keep per-frame work screen-bounded. Never update a golden
hash merely to make a refactor pass: a moved golden during a refactor means behavior changed.

## 5. Prove the change

1. Add or strengthen the lowest-level useful tests before changing risky behavior boundaries.
2. Implement the smallest coherent patch.
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

Lead with the concrete problem selected and why it was worth fixing. Then report changed files,
preserved behavior, verification results (including reviewer-agent triage when run), and remaining
risks. Mention other candidates only as a short, ranked list; do not expand the completed pass
after the fact.
