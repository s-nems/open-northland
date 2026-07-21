# Simulation package contract

`packages/sim` is a deterministic, headless rules engine. The root
[`AGENTS.md`](../../AGENTS.md) applies in full.

## Purity and state

- No DOM, Web APIs, Node I/O, Pixi, app, or render imports.
- No `Math.random`, wall-clock time, locale-sensitive behavior, or gameplay state in module globals.
  Content- or world-keyed memo caches are allowed only when they cannot change simulation results.
- Random choices use the seeded `Rng` owned by `Simulation`.
- Simulation state uses `Fixed` values created through `fx.*`. Float math is acceptable only for a
  local calculation that is converted without accumulating float state and is proven deterministic.
- A `World` owns its component stores. `new World()` and `new Simulation()` are complete isolated
  resets; never add a global clearing ritual.

External callers mutate a running simulation only through serializable commands. Systems mutate the
world during `step()`. Authored scenes and fixtures may assemble pre-tick-zero state directly.

Snapshots are detached plain-data read views. Do not expose live component objects through a read
seam or read presentation state back into sim logic.

## Ordering

World queries use deterministic per-world insertion order. Canonicalize a decision when iteration
order selects a winner, changes a first-found mutation, or affects serialized output. Use ascending
entity id or an explicit tuple such as `(distance, id)`.

Do not sort membership checks, commutative sums, or loops whose result cannot change with order.
Unnecessary canonicalization costs time and hides the actual invariant.

`systems/schedule.ts` is the one tick schedule. A change in order is a behavior change and needs a
test for the required relationship.

## Fixed point

- Keep units visible in names and comments.
- Use the integer helpers in `core/fixed.ts`; do not cast a number to `Fixed`.
- Check multiplication and distance calculations against the safe integer range.
- Convert between visual cells and half-cell nodes only through `nav/halfcell.ts`.

## Scale

Per-tick work must scale with active work, never all entity pairs. Reuse:

- memoized content indexes for type lookup;
- `NodeBuckets` and canonical candidate lists for spatial search;
- dormancy or generation checks for provably unchanged work;
- `World.canonicalEntities()` when a shared canonical list is actually required.

Never mutate a shared cached list. Measure system scaling with `npm run bench:sim`; timing stays in
the caller through `Simulation.setInstrument`, never in sim source.

## Tests and goldens

- Add the narrowest unit or integration test that proves the rule.
- Use a headless scenario for a multi-system player action.
- Check same-seed repeated runs when randomness or ordering changes.
- Run invariant checks for long system chains.
- Treat state hashes and atomic traces as behavior contracts. Do not update them during a refactor.

The hygiene suite enforces the import and nondeterminism boundary. Normal changes run
`npm run check`, `npm run build`, and `npm test` from the repository root.

## Source layout

- `simulation.ts`: simulation facade and public read seams
- `core/`: deterministic primitives, commands, events, RNG, and fixed point
- `ecs/`: world and component storage
- `components/`: plain component definitions
- `systems/`: behavior grouped by domain, plus the schedule
- `nav/`: half-cell conversion, terrain graphs, and routing
- `replay/`: command replay and divergence tools
- `inspect/`: snapshots, hashes, and state diagnostics
- `harness/`: scenarios, population helpers, and invariants

Prefer the tree itself over expanding this into a file-by-file inventory.
