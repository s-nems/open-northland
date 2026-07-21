# Decompose the settler planner orchestration

**Area:** sim · **Origin:** workflow readability audit, 2026-07-21 · **Priority:** P3

`packages/sim/src/systems/agents/ai.ts` is 304 physical lines, with 133 full comment lines and a
213-line `atomicPlanner` containing 26 conditionals and 21 `continue` sites. The function owns three
separate concerns: building shared per-tick indexes/claim state, deciding whether each settler may be
planned, and executing the adult economy priority ladder. Its comments currently supply phase names
and branch ownership that the code structure should expose.

The fixed priority order, canonical settler order, per-pass claim ownership, and dormancy gates are
behavioral and performance invariants. This is a behavior-preserving refactor; no golden may move.

## Scope

- Leave `aiSystem` as the small stable entry point that runs atomic planning before navigation.
- Extract construction of the shared per-tick targets, indexes, spacing, and claim state behind one
  domain-named planning-pass type and factory.
- Extract per-settler lifecycle/needs/ownership planning from the adult economy ladder so each
  function has one visible responsibility.
- Keep the economy ladder explicit and ordered. Do not replace it with a callback registry, generic
  rules engine, or allocation-heavy per-settler abstraction.
- Reclassify the existing comments: delete narration made redundant by names; keep concise source
  basis, approximation, canonical-order, and active-work scaling facts at their narrowest owner.
- Group new files by the planner concern and preserve the existing public import path through a
  stable entry point or barrel.

## Verify

- Focused agent/economy, child-needs, gossip, farming, construction, and determinism tests.
- `npm test`, `npm run check`, and `npm run build`.
- Golden hashes and atomic traces remain byte-identical; `ai.ts` no longer contains an over-budget
  orchestration function or relies on section-heading comments to expose its phases.
