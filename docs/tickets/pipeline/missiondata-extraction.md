# Decode map.cif MissionData/playerdata into a validated IR lane

**Area:** pipeline (+ data schema) · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P1

The map extractor deliberately skips the campaign/trigger payload, so authored mission goals,
triggers, and per-player setup are invisible to the game. Source basis (verified 2026-07-13):

- Inspection of decoded `map.cif` tables shows that a `CStringArray` carries, besides the already
  extracted `StaticObjects`, a **`MissionData` section per trigger (goal/result opcodes)** and a
  **`playerdata` section (per-player + diplomacy)** as readable `level`-tagged lines
  (`decoders/cif.ts` `decodeCifStringArray` already produces the plaintext).
- `tools/asset-pipeline/src/decoders/ini/maps.ts` (~lines 10-13) and
  `tools/asset-pipeline/src/stages/maps/info.ts` (~line 43) both state
  `MissionData`/`StaticObjects`/`playerdata` scripting is out of scope for the `MapInfo` slice.
- `tools/asset-pipeline/src/stages/maps/convert.ts` extracts only the `StaticObjects` section.

**Investigate first — the opcode structure is unknown.** The primary evidence is the decoded
plaintext itself:
enumerate `MissionData`/`playerdata` sections across all decodable maps — the 13 packed `map.cif`
maps, plus the unpacked `CnModMaps/` folders (123 top-level; 107 carry a plaintext `mission.inc`
that opens with `[MissionData]`, alongside sibling `ai.inc`/`player.inc`/`staticobjects.inc` —
verified 2026-07-13, and readable plaintext beats decrypting `map.cif`, so start there) —
catalog the opcode vocabulary and per-opcode argument shapes, and cross-check against
observed original campaign behavior where a mission's goals are known (e.g. the tutorial).

## Scope

1. Survey the opcode space: script a one-off dump (scratch, not committed) of every
   `MissionData`/`playerdata` line across the owned game copy; produce a frequency-ranked grammar.
2. Add a validated IR record for the decoded structure (schema in `packages/data`), extracted by a
   new `decoders/ini/` reducer + `stages/maps/` wiring alongside `MapInfo`/`StaticObjects`. Preserve
   unknown opcodes losslessly (opcode + raw args + source ref) rather than dropping them — consumers
   can interpret incrementally.
3. Update the "out of scope" comments in `maps.ts`/`info.ts` that this ticket makes stale.
4. If the opcode space is large, the legitimate deliverable is **decoded structure + follow-up
   tickets** (e.g. one per opcode family for sim-side interpretation); interpretation/semantics is
   NOT this ticket. `docs/tickets/features/victory-defeat-conditions.md`'s authored-goals half
   depends on this lane existing.

## Verify

- Extraction unit test on a synthetic fixture covering the observed line grammar.
- Real pipeline run against the owned game copy (`npm run pipeline -- --game "../Cultures 8th
  Wonder" --mod DataCnmd --out content`); spot-check one known map's decoded triggers against its
  in-game briefing/goals (human check).
- `npm test`, `npm run check`, `npm run build`. No copyrighted decoded content committed.
