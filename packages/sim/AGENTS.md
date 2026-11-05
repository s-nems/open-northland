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
- Component values form an ownership tree: mint each payload fresh, never stamp a shared module
  constant or an object another component already holds. Save export rejects the alias, because a
  restore would fork it into disconnected copies.
- A component name is unique per process and identifies the store in save files, so `defineComponent`
  belongs at module scope and throws on a second call with the same name.

External callers mutate a running simulation only through serializable commands. Systems mutate the
world during `step()`. Authored scenes and fixtures may assemble pre-tick-zero state directly.
Every in-place component mutation acquires the value through `World.mut`/`tryMut`; `get`/`tryGet`
return read-only views, and defeating them with a cast breaks snapshot and derived-cache
invalidation. In a hot loop, read first and acquire `mut` only when a field actually changes, so
version keys do not churn on idle entities. Clear an optional field by assigning `undefined`, typed
`field?: T | undefined`, never `delete`: a deleted key drops the value into V8's slow dictionary mode,
and the hash, digest, save and snapshot walks read an `undefined` key as absent.

Snapshots are detached plain-data read views. Do not expose live component objects through a read
seam or read presentation state back into sim logic. `Simulation.snapshotDeltas()` streams per tick,
cloned off the live world, each touched entity's written components and the names it lost, and
`SnapshotMirror` patches its entities from them, keeping an untouched entity's object and an unwritten
component's clone; a mirror snapshot's entity list is edited in place per delta, and a component added
to a held entity lands last in its record, so read components by name. `indexesOf(snapshot)` serves
the views a consumer registers as a `SnapshotIndexSpec` (kind lists, groups, counts, the position
buckets), maintained by the mirror from the same edits and built by one walk for a snapshot taken off
the sim; the lists it hands out are live and ascending by id. A spec declares the components it places
an entity by (`reads`, value or presence), so a change that wrote none of them only swaps the entity's
object; an undeclared read leaves the view stale, which `verifyIndexes` reports. A component defined
with `simOnly` (sim bookkeeping no snapshot reader needs) stays out of snapshots, deltas and the mirror,
and so do the record fields named in `simOnlyFields`; saves, the state hash and the sync digest keep
them. A snapshot reader that needs one drops its flag or field.

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
- `World.canonicalQuery(...)` for a component query in ascending id, and `World.canonicalEntities()`
  for every alive entity, when a shared canonical list is actually required.

The tick is one synchronous function: no workers, shared memory, async or parallel sections inside
the sim, ever. Parallelism can make state depend on core count, which desyncs multiplayer.

A group order starts every member moving in the tick it applies: cut its path cost with cheaper
searches, never by rationing its path requests across ticks.

Never mutate a shared cached list or empty sentinel; copy it first. Neither is frozen: once a frozen
array reaches a `for...of` site, that site allocates an iterator result per element for every array it
walks. `readonly` types are the guard, and `verifyCaches` reports an edit to a list it re-derives. Measure system scaling with `npm run bench:sim` (synthetic world,
isolated axes) or `npm run bench:map` (a real decoded map, reported as a growth curve); timing stays in
the caller through `Simulation.setInstrument`, never in sim source.

## Tests and goldens

- Add the narrowest unit or integration test that proves the rule, in the file that already covers
  the system. One test per rule, not per branch, tick count or threshold.
- Use a headless scenario for a multi-system player action, stepping the fewest ticks that show it.
- Determinism is owned by the hygiene scan, the fuzz suite and the goldens; a system test does not
  repeat a run to prove it.
- Treat state hashes and atomic traces as behavior contracts. Do not update them during a refactor.

The hygiene suite enforces the import and nondeterminism boundary. Normal changes run
`npm run check`, `npm run build`, and `npm test` from the repository root.

## Source layout

- `simulation.ts`: simulation facade and public read seams
- `core/`: deterministic primitives, commands, events, RNG, and fixed point
- `ecs/`: world and component storage
- `components/`: plain component definitions behind the `components/index.ts` barrel; `ai/` holds
  controller identity and saved state, `economy/` buildings and stock, `missions/` what a map script
  writes and shows, `players/` per-player tables
- `systems/`: behavior by folder, plus `schedule.ts`; `systems/missions/AGENTS.md` adds the mission
  engine's own rules
- `nav/`: half-cell conversion, terrain graphs, and routing
- `replay/`: command replay and divergence tools
- `save/`: the persisted SaveGame format, its export, and its validated restore path
- `inspect/`: snapshots, hashes, and state diagnostics
- `harness/`: scenarios, population helpers, and invariants

`systems/` folders:

| Folders | Own |
| --- | --- |
| `command`, `orders` | applying player commands; queued unit orders |
| `settlers` | the settler planner, its drives, targets and atomic actions |
| `economy`, `stores`, `trade` | construction, production, hauling and ground goods; stock and workers; trade routes |
| `conflict`, `defence`, `palisades` | combat, hunting and diplomacy; tower and shelter manning; walls and gates |
| `movement`, `vehicles`, `signposts`, `roads` | walking, groups and herds; carts and ships; signpost reach; road sites |
| `footprint`, `landscape`, `spatial`, `vision` | blocked cells and placement; landscape objects; spatial indexes; fog |
| `lifecycle`, `family`, `social`, `progression`, `equipment`, `assistant` | needs, ageing and death; households; gossip; experience and unlocks; gear; builder assistant |
| `spawn`, `livestock`, `wildlife`, `chests` | entity creation; farm animals; wild animals; chests |
| `missions`, `match` | map scripts and goals; match goals, standing and teardown |
| `computer-player`, `map-ai`, `ai-shared` | see AI ownership below |
| `map-escalation` | a map variant's siege schedule: attacks spawned at a keep, sea landings, an attack's aim past a fallen headquarters, the growing guard, gear steps, lost catapults raised again, the fortress's builders, carting porters and tower archers kept up, its defenders placed at the start and computer seats' soldiers retrained at the start |
| `readviews` | content read views shared across systems |

`test/` mirrors `src/`: system tests live in `test/systems/<system>/` and its subfolders (a
`missions/results/` executor's test sits in `test/systems/missions/results/`), a large suite splits into
`<name>.test.ts` plus `<name>/*.cases.ts`, and shared helpers go to `test/fixtures/`.

Prefer the tree itself over expanding this into a file-by-file inventory.

## AI ownership

`systems/computer-player` owns autonomous strategy. `systems/map-ai` owns authored tasks and
maintenance of the existing settlement. `systems/ai-shared` holds behavior used by both, without
starting autonomous expansion or campaigns. `AiControl` is machine-player identity, not proof that
either controller may run. The computer master permission gates every autonomous module, including
new ones; module permissions cannot override it. Map task soldiers have one active assignment.
Planner commands name their decision source so disabling a controller and diagnosing an order do
not depend on guessing its origin from command kind.

A computer seat reads other players' in-game state only through its own sight and its saved memory
(`computer-player/knowledge/`); the static map, the seats' starts and the map scripts are known to it.
A new computer-player read of another seat's entities goes through those seams, never a raw world
query. The scripted map AI keeps its own reads.

`computer-player/colony/` owns a seat's colonies over the sea. The rest of the computer player runs the
home settlement: it reads its own seat through `ai-shared/home-roster.ts` and `computer-player/home-stock.ts`
and the ships its colonies are owed through `colony/sea/fleet.ts`, Biome refuses the bare rosters and
`seatStockOf` in its folder, and a read of another seat or of everything a seat holds asks for
`everyBuildingOf` or `everySettlerOf` by name.

Map AI, computer player, and common unit rules must remain distinct in names, state, tests and debug
output. `systems/map-escalation` spawns, equips and
ships: an attack's men belong to a raider seat but stand off its scripted handler's list, and the
escalation alone orders them, as that seat's map-AI orders: an attack-move onto their seat's aim.
The guard it refills, the tower archers it posts and the catapults it raises again are posted and
crewed by the fortress seat's own program, which keeps a tower's escalation crew on the wall; its
placed defenders stand off every scripted list, and the builders and porters it keeps work through
that seat's map-AI town pass and the settlers' planner. Its one touch of a computer seat is the start's optional retraining of
that seat's soldiers as civilians; from then on the computer player employs them.
