# Export a versioned SaveGame payload from the sim

**Area:** sim · **Priority:** P1
**Blocked by:** [content and map identity](save-load-content-map-identity.md)

The project has no persisted save format. Replay is explicitly not a load path
(`packages/sim/src/replay/replay.ts`), and `WorldSnapshot` is a presentation view: it flattens
per-store insertion order to ascending ids and omits RNG state, entity allocation, fog, and command
state (`packages/sim/src/inspect/snapshot.ts`).

## Scope

- An export API on the sim boundary producing a canonical plain-data `SaveGame` v1 at a tick
  boundary, outside the deterministic tick: header
  `{kind, formatVersion, irVersion, contentRevision, mapId, mapFingerprint, seed, tick}` plus
  sections with stable, append-only string identifiers. The header must be readable without
  parsing sections, so a later ticket can compress the payload without a format break.
- Sections cover every mutable resource:
  - entity allocation: `World.nextId` and the alive set (ids are never recycled, there is no free
    list);
  - one section per component store, preserving per-store insertion order (the query iteration
    contract in `packages/sim/src/ecs/world.ts`) and the component first-registration order
    (consumed by `hashSimState`);
  - RNG state via `Rng.getState()`; the seed stays in the header for provenance only. No draw
    counter: mulberry32 state alone continues the stream;
  - fog: per-player masks in ascending player order plus `activeMode` and `lastRebuildTick`
    (`packages/sim/src/systems/vision/state.ts`), which survive tick boundaries and drive the
    rebuild cadence. `visibleBounds` is derived and stays out;
  - pending command envelopes and `nextSequence` from `CommandQueue`. The applied log stays out of
    the payload; replay history is a separate diagnostic artifact.
- Canonical encoding: deterministic JSON with a defined key order, `Map`-valued component fields
  (`Settler.experience`, `Stockpile.amounts`, `Upgrading.savedStock`/`seeded`,
  `ProductionBonus.remainders`) as key-sorted entry arrays, `Fixed` as plain integers, and a hard
  throw naming the component for any unserializable shape, following the `clonePlain` and
  `hashValue` precedent.
- Document the persisted format in `docs/DATA-FORMAT.md`, separate from content and from
  `WorldSnapshot`.
- Non-goals: restore, migrations, compression, UI.

## Verify

- Serializing the same state twice is byte-identical; export, `JSON.parse`, re-export is
  byte-identical.
- Empty world and a populated scenario world both export; an unserializable component value throws
  with the component name in the message.
- Rules carrier components (`WorldRules`, `FogRules`, and peers) round-trip their presence exactly;
  an absent carrier stays absent in the payload.
- `npm test`, `npm run check`, `npm run build`.
