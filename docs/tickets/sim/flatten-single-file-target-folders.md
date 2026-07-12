# Flatten single-file target barrel folders

## Problem

After the agent-planner decomposition, `packages/sim/src/systems/agents/targets/` mixes two
structural conventions:

- Flat single-concern files: `candidates.ts`, `nearest.ts`, `workplaces.ts`.
- Folder-with-lone-`index.ts`: `targets/food/index.ts` (~140 lines) and
  `targets/resources/index.ts` (~206 lines) — each folder holds **only** its `index.ts`.
- A folder that legitimately earns nesting: `targets/stores/` (4 files: `index.ts`, `buildings.ts`,
  `outputs.ts`, `stock.ts`).

A folder wrapping a single `index.ts` adds a directory level and a longer import path
(`./food/index.js`) with no grouping payoff, and reads like a barrel over siblings that don't exist.
The inconsistency invites the next author to guess wrong about where a new target scan belongs.

## Options

1. **Flatten** to `targets/food.ts` and `targets/resources.ts`, matching the flat single-concern
   siblings. Both files are imported **only** through `targets/index.ts` (verified), so the change
   is: `git mv` each `index.ts` up a level, rewrite its ~9 relative imports (depth drops one:
   `../../../../components` → `../../../components`, `../nearest.js` → `./nearest.js`, etc.), remove
   the emptied folders, and update the two re-export paths in `targets/index.ts`.
2. **Keep the folders** only if a split of the food/resource scans is actually imminent (they are
   the largest single-concern target files, so growth is plausible) — in which case add a second
   file so the folder earns its `index.ts`.

## Source basis

Structural consistency only — no behavior change. Confirm goldens stay byte-identical after the
move (`npm test`), since import-path-only edits must not touch sim output.

## Origin

Deferred non-blocking finding from the `code-reviewer` pass on the
`refactor/sim-agent-planner-cleanup` decomposition (note #1). Left out of that merge as an
out-of-scope structural judgment call.
