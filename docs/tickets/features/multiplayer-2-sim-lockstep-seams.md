# Give the sim its lockstep seams: tick-targeted commands, a per-tick sync digest, payload contracts, and a session seed

**Area:** sim, app · **Focus:** core/commands, simulation/hash · **Priority:** P2
**Blocked by:** [multiplayer-1-engine-determinism-spike.md](multiplayer-1-engine-determinism-spike.md)

Four things the deterministic lockstep client needs are missing from the sim, and all four are
behavior-preserving for single-player, so they land on `main` ahead of any network code.

1. **Commands apply on the next tick, never on an assigned tick.** `CommandQueue.drain` hands
   `commandSystem` everything enqueued since the last tick, in enqueue order. A lockstep client
   receives envelopes stamped by the server with the tick they must apply on and the order within that
   tick, possibly several ticks ahead, possibly out of arrival order. `stepReplaying` in
   `packages/sim/src/replay/replay.ts` already does the right thing for a recorded log; the live queue
   cannot.
2. **The state hash is too slow to check every tick.** `hashSimState` walks every component of every
   entity. Measured on `magiczny_las` with six AI seats at ticks 600 to 4000 (36.7k entities, mostly
   resource nodes; tick median 5 ms): `hashState()` takes about 510 ms. Even the current
   `HASH_TRACE_EVERY_TICKS` cadence of 20 costs 25 ms per tick amortized, five times the tick itself.
   A lockstep sync check must cost a fraction of a millisecond.
3. **Network commands are untrusted and the parser only reads `kind`.** `parseCommandEnvelope` in
   `packages/sim/src/core/commands/parse.ts` validates version, origin, seat, and issuer, then casts
   the payload. The sim-area ticket `imported-command-payload-validation.md` describes the gap for
   imported logs; for envelopes arriving from other players it is a hard requirement.
4. **The world seed is a constant.** `WORLD_SEED = 7` in `packages/app/src/entries/map.ts`. Every
   networked game must run on a seed the session carries, while scenes and goldens keep their fixed
   seeds.

## Scope

- Tick-targeted admission: the queue accepts an envelope together with a target tick and an
  externally assigned sequence; the envelope wire format and `COMMAND_ENVELOPE_VERSION` do not
  change. `commandSystem` applies, at tick T, exactly the envelopes due at T, in ascending sequence,
  before the untargeted envelopes in enqueue order. An envelope whose target tick is already past is
  recorded like an unauthorized one today (logged, never applied late). The replay log keeps recording
  `(applyTick, sequence)` so `stepReplaying`, `localizeDivergence`, and the diagnostics bundle work
  unchanged.
- Saves and in-flight commands: a lockstep game always has envelopes scheduled two to three ticks
  ahead, so a save exported in a networked session excludes tick-targeted pending envelopes; the
  snapshot's tick T plus the server's command frames after T reconstruct them. A loopback or
  single-player save keeps recording next-tick pending envelopes as today, and the `commands` section
  of the save format does not change.
- A per-tick sync digest on `Simulation`, computed at the end of `step()` from the tick, the RNG
  state, the entity counter and alive count, and the component values of the entities mutated during
  that tick, folded per domain (a short fixed list of component groups, e.g. rng, entities, economy,
  settlers, movement, combat, fog) so a mismatch names the domain. The tick's mutated set is owned by
  `step()`: cleared when the tick starts and filled by the same `World.mut`, add, and remove channel
  that feeds `TouchedLog`. Do not derive it from `TouchedLog`: that log is drained by `takeSnapshot`
  and dropped wholesale at its overflow limit, so its contents depend on how often a client
  snapshots, and two synchronized clients would digest differently. Use the same canonical value
  encoder as `hashSimState` so the two paths cannot disagree about supported shapes. `hashState()` and
  every golden stay unchanged; the full hash remains the rare cross-check. The digest is opt-in so a
  run that does not ask for it does no digest work.
- Payload contracts per command kind checked by the parser: required fields, primitive types, finite
  numbers, integer entity refs and content ids, homogeneous arrays, derived from one table the way
  `COMMAND_ISSUER` forces the issuer split to stay complete. This closes
  `imported-command-payload-validation.md` in the sim area; delete that ticket in the same commit.
- The map entry reads its seed from the session inputs (a `seed` parameter for now; the session
  descriptor of the next ticket replaces it), defaulting to the current constant so existing URLs,
  scenes, and goldens are byte-identical.
- Non-goals: no transport, no worker, no change to the save or envelope formats, no change to
  `hashSimState`.

## Verify

- Existing goldens, replays, scene hashes, and the save fixture are unchanged.
- Unit tests: a targeted envelope applies on exactly its tick and not before; two envelopes for one
  tick apply in sequence order regardless of enqueue order; a past-tick envelope is logged as rejected
  and the hash equals the run without it; untargeted envelopes keep next-tick semantics; a save
  exported with targeted envelopes pending omits them and restores to the same hash as the tick it was
  taken at.
- Digest tests: perturbing the RNG, one fog mask, and one component each change only their domain and
  leave the other domains stable; two runs with the same inputs produce identical digest sequences;
  the sequence is identical whether the run snapshots every tick, never, or past the touched-log
  overflow limit; a run with the digest off does no digest work.
- Cost: on `npm run bench:map` with `ON_BENCH_TICKS=4000` the digest adds under 0.2 ms per tick in
  the last window.
- The fuzz stream routes seat-issuable kinds through `playerCommand` so the parser and the authority
  gate are both exercised; type-confused payloads fail with a readable `at`-prefixed message.
- `npm run check`, `npm run build`, `npm test`.
