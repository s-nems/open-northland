---
name: refactor-cleanup
description: Perform a controlled, behavior-preserving refactor of a requested Vinland package, path, or feature. Use for code cleanup, restructuring, performance work, technical-debt reduction, pragmatic SOLID improvements, duplication removal, and improvements to readability, packaging, or future extensibility.
---

# Refactor Cleanup

Perform one evidence-driven cleanup pass inside the scope supplied in `$ARGUMENTS`. Preserve behavior unless the user explicitly requests a behavior change.

## Resolve the Scope

Treat the first argument as a hard ownership boundary:

- `sim` -> `packages/sim`
- `render` -> `packages/render`
- `app` -> `packages/app`
- `pipeline` -> `tools/asset-pipeline`
- an existing path or feature name -> resolve it from the repository

Treat remaining arguments as an optional focus, such as `performance`, `packaging`, `navigation`, or `type safety`. If no scope is supplied, ask for one before inspecting the whole repository.

A package-sized scope authorizes inspection of that package, not a package-wide rewrite. Select the smallest cohesive improvement that produces meaningful value. Do not cross the boundary except for callers, tests, or public contracts required to understand and safely complete that improvement.

## Establish the Constraints

1. Read the root `AGENTS.md` and the package-local `AGENTS.md` for every package the change may touch.
2. Read relevant architecture or testing docs only when the selected change depends on them.
3. Inspect `git status` and preserve all pre-existing user changes. Never revert unrelated work.
4. When a live plan step is named, treat it as authoritative and keep the refactor within that step.
5. Work in the current checkout. Do not create, merge, or remove a worktree; the user invokes the project's `/worktree` workflow separately when required.

## Diagnose Before Editing

Read the implementation, real callers, tests, and dependency direction. Identify concrete problems with file references. Distinguish maintenance risk from personal style preference.

Prioritize candidates in this order:

1. Fragile invariants, unclear ownership, or boundary violations.
2. Hot-path work with an avoidable scaling or allocation cost.
3. Mixed responsibilities or overgrown modules, especially files around 300 lines or more.
4. Real duplication with at least two callers.
5. Misleading names, weak types, dead code, and unnecessary indirection.

State the selected improvement, expected benefit, behavior that must remain stable, and regression risk before editing. If the requested performance problem is not supported by measurement, complexity analysis, or an obvious hot-path cost, do not invent an optimization; choose another evidence-backed improvement or report that no justified change was found.

## Refactor Pragmatically

- Preserve public APIs and observable behavior unless changing them is necessary and explicitly justified.
- Apply SOLID as a diagnostic tool, not as a requirement to introduce classes, interfaces, factories, or layers.
- Prefer existing repository patterns and domain-specific names over generic helpers.
- Extract shared logic only at the second real caller, or when extraction establishes a clear ownership boundary.
- Group by feature. Split mixed or oversized modules into a feature subfolder with an `index.ts` barrel when that keeps stable import paths.
- Delete dead code, unused exports, obsolete shims, commented-out blocks, and comments that merely narrate syntax.
- Keep comments for units, invariants, source basis, and named approximations.
- Maintain strict TypeScript: avoid `any` and unproven non-null assertions; use `unknown` plus narrowing, `import type`, `readonly`, discriminated unions, and exhaustive switches where appropriate.
- Add no dependency unless its concrete benefit exceeds its ownership and maintenance cost.
- Avoid speculative extensibility. Make the next likely change easier without designing for hypothetical callers.
- Keep the diff narrow. Do not fix unrelated findings or create a new debt ledger.

For `sim`, preserve determinism, fixed-point state, canonical decision ordering, and active-work scaling. For render and app hot paths, keep per-frame work screen-bounded. Never update a golden hash merely to make a refactor pass.

## Prove the Change

1. Add or strengthen the lowest-level useful tests before changing risky behavior boundaries.
2. Implement the smallest coherent patch.
3. Re-read the diff for accidental behavior changes, needless abstractions, packaging churn, and missed cleanup in code already touched.
4. Run focused tests first, then the applicable project gates. Normal code changes should run `npm test`, `npm run check`, and `npm run build`; structural changes should also run `npm run scan:structure`.
5. For performance work, compare before and after using a benchmark when one exists; otherwise state the specific complexity, allocation, or operation-count improvement. Do not claim unmeasured wall-clock gains.
6. Follow the repository's visual, pipeline, scenario, and golden verification rules when the scope triggers them.

Do not commit unless the user or the active workflow explicitly requests a commit.

## Report

Lead with the concrete problem selected and why it was worth fixing. Then report changed files, preserved behavior, verification results, and remaining risks. Mention other candidates only as a short, ranked list; do not expand the completed pass after the fact.

Example invocations:

```text
/refactor-cleanup sim
/refactor-cleanup sim performance in navigation
/refactor-cleanup packages/app/src/hud packaging and readability
```
