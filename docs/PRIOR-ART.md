# Prior art — practices from other engine reimplementations

A survey of engineering practice across open-source rebuilds of old game engines — OpenRA (C&C),
OpenTTD (Transport Tycoon), OpenMW (Morrowind), devilutionX (Diablo), 0 A.D., Widelands, openage
(AoE2), Chrono Divide (RA2 in TypeScript), fheroes2/VCMI — read against Vinland's goals
(deterministic lockstep-ready sim, data-driven content, faithful-first). **This doc is the one place
external projects are cited**; code comments state the underlying rationale on its own terms.

Three sections: what Vinland already does (with the seam it lives in), what is deferred behind a
named trigger, and where we consciously differ. Review this occasionally; when a deferred entry
lands, move its one-liner to Adopted and prune anything the codebase makes obsolete.

## Adopted (the seam it lives in)

- **Commands are the only mutation, validated at execution time.** In lockstep any peer can send
  anything, and a command's target can change between issue and apply — so handlers validate when
  the command APPLIES and skip bad input deterministically (still logged, so replay is faithful),
  never throw. (OpenRA drops stale orders silently in `UnitOrders.ProcessOrder`; OpenTTD runs every
  command through an identical test-then-exec on all clients.) → `systems/command.ts`;
  the skip paths are fuzzed as first-class inputs (`test/core/fuzz-determinism.test.ts`).
- **Full-state canonical hash + human-readable behavior golden.** A state hash says *that* something
  changed; a diffable action transcript says *what*. (OpenTTD's regression suite diffs a scripted
  game's text output; Widelands dumps a typed "syncstream" of sync-relevant events precisely so a
  hash mismatch becomes a textual diff.) → `hashState()` + the golden atomic-action trace
  (`test/core/golden-trace.test.ts`). Note: our full-state hash is *stronger* than what most of these
  projects run per-tick (OpenRA hashes only annotated `[Sync]` fields; OpenTTD's per-tick token is
  just the RNG state) — see the tiered-hashing deferral below for when that cost bites.
- **Replay from the command log is the save/debug backbone.** (OpenRA's replays and even its SAVES
  are the recorded order stream fast-forwarded; OpenTTD debugs field desyncs by replaying a command
  log offline and bisecting.) → `replay()`, `localizeDivergence`, `scrubWindow`, `rebaseContent`.
- **Randomized-input determinism hunting.** Curated goldens never construct the inputs where
  nondeterminism hides; seeded-random command streams (including invalid ones) must stay
  run-twice-identical, replayable, and invariant-clean. (OpenTTD hunts desyncs with randomized games
  under a desync-debug mode.) → `test/core/fuzz-determinism.test.ts`.
- **Cache re-derivation checks.** Incrementally-maintained caches are the classic lockstep-desync
  source; every memo must recompute from authoritative state to the same bytes, checked per tick.
  (OpenTTD's `-d desync` runs `CheckCaches()` every tick.) → `World.verifyCaches()` + the
  `cachesCoherent` core invariant; the shared `canonicalEntities()` memo is frozen so an in-place
  mutation throws at the offender. Register future caches (ring-search index, content indexes) there.
- **Strict content schemas — unknown key = error.** A key the schema doesn't know is a typo or an
  unmodeled extractor field; both must fail loudly, not be silently stripped. (OpenRA's
  `--check-yaml` lint fails CI on unknown trait fields and dangling references, warnings-as-errors.)
  → `z.strictObject` throughout `packages/data/src/schema.ts` + `validateCrossReferences`; proven
  against a full real-pipeline run.
- **Integer-only sim math, mechanically enforced.** Transcendental float ops and locale-dependent
  APIs may differ across engines/platforms — banned by source scan, not convention. (OpenRA avoids
  floats entirely: fixed-point coordinates, table-based trig at a power-of-two angle scale.)
  → `fixed.ts` (`fx.*`, `isqrt`) + the widened `test/core/hygiene.test.ts` scan.
- **Cross-platform CI for the determinism promise.** Byte-identical state across platforms is a
  testable claim only if CI runs the goldens on more than one OS. → the ubuntu+macos matrix in
  `.github/workflows/ci.yml`.
- **AI is a command producer, never a direct mutator.** Bot/populator logic reads the world and
  emits commands through the same seam as a player — deterministic, replayable, hash-safe by
  construction. (OpenRA sync-checks that bot modules never mutate state outside orders; both its
  field desyncs cited in issues were AI-related.) → `seedAnimalHerds` returns `Command[]`; keep this
  stance for every future AI.
- **Original data as the sole content source; the engine ships zero assets.** (OpenMW, VCMI,
  Chrono Divide, openage all decode a user-owned copy; openage names the same three-stage shape we
  use — source-shaped read → concept mapping → engine-shaped validated IR.) → the asset pipeline +
  gitignored `content/` + synthetic test fixture.
- **Faithful-first with named approximations.** A fidelity-chasing project needs explicit source
  basis precisely because no test oracle exists for "matches the original". (OpenMW ships vanilla
  behavior by default with every fix a named, documented toggle; devilutionX keeps original bugs
  annotated in-source and fixes them only as auditable, changelogged decisions; Chrono Divide
  confines divergence to a documented override layer.) → `AGENTS.md` golden rule 5 and compact plan
  progress notes.

## Deferred (trigger-gated)

- **Save/replay disk format: versioned, stamped, refuse-don't-guess.** When Phase 5 builds the disk
  format: stream the command log, append a versioned metadata trailer on close (players, duration,
  outcome — writable only at game end); stamp engine version + a content fingerprint (hash of the
  validated IR) + map hash + the final `hashState()` as an integrity check (a load that replays to a
  different hash is a DETECTED error, not silent corruption); partition stored replays by
  engine/content version and refuse mismatches gracefully. Format changes get an append-only version
  enum with one named mechanical migration per change. (OpenRA's replay trailer + version-keyed
  replay dirs + saves-are-replays; OpenTTD's `SaveLoadVersion` + afterload chain and
  content-identity-by-hash + declared min-compatible version.) *Trigger: Phase 5 save/load.*
- **Snapshot round-trip resume test.** Once a world can be RESUMED from a snapshot (fast-load):
  every N ticks serialize → resume into a fresh sim → both must hash-equal after K more ticks.
  Catches state that exists in memory but isn't (correctly) serialized — the bug class hashes can't
  see until someone loads. Also the prerequisite for using snapshots as replay-bisection
  checkpoints. (0 A.D. runs exactly this as `-serializationtest`.) *Trigger: the Phase-5
  snapshot-load slice — design the test WITH the loader, not after.*
- **Multiplayer order pipeline decisions** (write down now, build later): the HOST stamps each
  command's execution tick (latency is a host policy, not a client constant — enables dynamic
  latency); split sim-affecting commands (logged, hashed, replayed) from session traffic (chat,
  pings — never enters the log); pause/speed/player-disconnect are themselves logged commands so
  replays reproduce them; UI may keep a render-side "predicted" mirror for responsiveness. Dev
  cheats must also be commands, or using a debug tool during MP debugging causes the desync being
  hunted. (OpenRA's net-frame architecture, immediate-vs-synced orders, synced pause with
  `PredictedPaused`, sync-checked debug commands.) *Trigger: the Phase-5 lockstep stretch.*
- **Tiered hashing.** If per-tick `hashState()` ever shows up in a profile at scale: cheap digest
  every tick (the RNG state alone catches most divergence — every sim-affecting draw advances it),
  full canonical hash every N ticks. (OpenTTD broadcasts the RNG state as its per-frame sync token;
  0 A.D. runs quick positional hashes per turn and full hashes rarely.) *Trigger: profiling, not
  speculation.*
- **Spatial index bins + proximity triggers.** The existing ring-search path, plus two refinements:
  coarse fixed-size cell bins (~10 tiles) for range queries, and subscription-style cell/proximity
  triggers so "is anyone near me yet?" stops being a per-tick poll. Batch position-index updates at
  a defined point in the tick. (OpenRA's `ActorMap`.) *Trigger: a concrete plan step or profiling
  result.*
- **Hierarchical pathfinding with O(1) reachability rejection.** Partition the map into ~10×10
  grids, flood-fill connected regions into an abstract graph reused as the A* heuristic; dirty only
  affected grids on terrain/building change; keep a flood-fill domain index so "no path exists" is a
  dictionary lookup instead of a full-map search — the classic RTS pathing collapse is exhaustive
  A* on unreachable targets. (OpenRA's `HierarchicalPathFinder`.) *Trigger: pathfinding cost at
  scale on real maps.*
- **Cooperative cancellation for settler activities.** If interrupting atomics ever needs finesse
  (finish the swing before obeying a new order): a per-entity activity state machine with
  `Queued/Active/Canceling/Done`, where Active activities decide their own stopping point.
  (OpenRA's Activity system.) *Trigger: the first mechanic where mid-atomic interruption is
  player-visible.*
- **Two-phase command validation (shared `validate()`).** A pure `canApply(world, command)` used by
  the UI for affordances (gray out an illegal placement) AND asserted against the handler's actual
  outcome — the two must agree or they'll drift. (OpenTTD's test-then-exec with a test≡exec
  assertion.) *Trigger: the first UI affordance that needs can-place/can-afford.*
- **Content-format docs generated from the schemas.** Every zod field gets `.describe()`; a tool
  emits the DATA-FORMAT reference from the schema so docs can't drift from validation. (OpenRA
  generates its trait docs from in-code `[Desc]` attributes.) *Trigger: DATA-FORMAT.md drift pain,
  or external modders.*
- **Source-basis decisions as named data toggles.** Evolve player-visible approximations into
  schema-validated flags when useful — faithful by default, each divergence carrying the original
  behavior, the default, and the justification. Pair with a greppable in-code marker at each
  divergence site. (OpenMW's game settings; fheroes2 records the default-choice debate;
  devilutionX's in-source original-bug annotations.) *Trigger: the first deviation worth making
  switchable.*
- **Threshold-gated tick profiler.** App-side (wall-clock is banned in sim src): per-system timers
  that log a hierarchical "long tick" report only when a threshold is exceeded — attribution lands
  on the specific system/entity, and instrumentation is ~free until something is actually slow.
  *Trigger: the next recurring perf hunt.*

## Consciously different

- **Determinism is CI-enforced here, field-diagnosed there.** OpenRA ships no automated determinism
  tests; desyncs are found by players and diagnosed from sync reports. Vinland inverts this
  (goldens + fuzz + hygiene in CI) — keep it inverted; add the field-diagnosis half (sync report
  rings, peer trace diffing) only when MP exists.
- **Fidelity is the goal, not a constraint to shed.** OpenRA is openly a modernization ("not
  restricted by the technical limitations of the original"). That is the anti-model that validates
  ours: `AGENTS.md` has a source-basis rule because Vinland chases the original.
- **Compatibility boundaries are chosen per artifact.** devilutionX kept save-file compatibility
  with the original game but dropped wire-protocol compatibility. Vinland's equivalents (content IR,
  saves, replays, goldens) should each get an explicit keep/break policy when Phase 5 defines them —
  recorded in the save-format entry above.

## Sources

- OpenRA: `Sync.cs`, `SyncReport.cs`, `OrderManager.cs`, `UnitOrders.cs`, `GameSave.cs`,
  `ReplayMetadata.cs`, `CheckYaml.cs` + `OpenRA.Mods.Common/Lint/*`, `ActorMap.cs`,
  `HierarchicalPathFinder.cs`, `Activity.cs`, `PerfTimer.cs` — github.com/OpenRA/OpenRA;
  openra.net/about (modernization policy); PR #19632 (server-side order latency).
- OpenTTD: `docs/desync.md`, `src/cachecheck.cpp`, `src/command.cpp`, `src/core/random_func.hpp`,
  `src/saveload/saveload.h` — github.com/OpenTTD/OpenTTD.
- OpenMW: settings reference (vanilla-vs-fixed toggles) — openmw.readthedocs.io; integration-test
  framework with libre example-suite content (GitLab MR !1005).
- devilutionX: `Source/engine/demomode.cpp`, `test/timedemo_test.cpp` (input-log regression vs a
  reference end state, doubling as the perf benchmark) — github.com/diasurgical/devilutionX.
- 0 A.D.: `pyrogenesis -serializationtest` / `-rejointest` / quick-vs-full hash flags (man page).
- Widelands: syncstream (`src/logic/game.h` `SyncEntry`, `utils/syncstream/`) — typed, diffable
  sync-event logs.
- openage: converter blog series (reader → processor/concept-grouping → exporter).
- Chrono Divide (RA2 in TS, the closest analog): original `rules.ini` as source of truth, all
  divergence in one documented override layer — chronodivide.com.
