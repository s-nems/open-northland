# Decode mission scripts into typed opcodes and keep mission object ids

**Area:** pipeline, data, content-resolver · **Focus:** map script sidecars · **Priority:** P2

Map-scripts epic, stage 1 of 10: 1 data, 2 sim core, 3 entities and ownership, 4 movement, areas and
behaviour flags, 5 economy and tech, 6 terrain, 7 diplomacy, vision and outcome, 8 tributes,
9 presentation, 10 enable by default. [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md) is the
format and semantics reference for every stage; read it first.

Every generated `maps/<id>.script.json` carries its missions as raw token lists
(`MapScriptLine = {key, values}`), so nothing downstream can tell a player id from a good name or an
object id, and the placed objects the scripts address lose their ids at extraction:
`TerrainEntities` exposes the last `sethouse` column as `rot` (it is the mission object id), drops the
last two `sethuman` and `setanimal` columns (object id and behaviour), and skips `setvehicle` and
`setguide` entirely. Corpus: 4,014 nonzero house ids in the sidecars, 855 `sethuman` lines with ids
such as 100 to 110 and 200 to 203 that `HumansDied`, `SendHuman`, and `ChangeHumanPlayerId` name.
String ids that results carry (`CreateTribute`, `InfoShowString`, `SetHumanName`) have no runtime
text source: only the map's menu strings reach a sidecar today. The sidecar consumer in
`packages/content-resolver/src/maps-index.ts` also re-parses the roster by hand instead of validating
with the zod schema, which gives malformed data plausible defaults (45 AI slots across 18 maps
claimable by a human and 47 Human/Closed-only rows would be lost silently).

## Scope

- Add an opcode registry to `packages/data`: the 63 goals and 103 results by index and name with
  their parameter kinds, exactly the tables in `MISSIONS.md`. Lookup ignores case; an unknown name
  resolves to index 0 (`True` or `None`) and reports a warning with the map, mission index, and
  line.
- Add a pure decoder from a raw goal or result line to a discriminated union keyed by opcode name,
  with fields typed by kind: player ids, points `{hx, hy}` (script coordinates are the same half-cell
  nodes as `TerrainEntities`), ranges, object ids, mission indexes, string and sound ids, booleans,
  and name references that keep either the name or the numeric id a script wrote (`{name}` or
  `{id}`). Surplus tokens are dropped, missing tokens read as 0, both with a warning. The sidecar
  stays raw and lossless; the decoder runs at load. Resolving names to content ids is not part of the
  decoder; it happens where `packages/app/src/game/world/authored-placements.ts` resolves placed
  tribes and jobs today, and only numeric ids cross into the sim.
- Emit the map's string table (`text/<lang>/strings.ini`, id to text, keyed by language) into the
  script sidecar so string ids render at runtime. If the victory-defeat branch's resolved
  `description` field is on `main` by then, keep both consistent.
- `TerrainEntities`: rename `rot` to `missionId` on buildings; add `missionId` and `behaviourFlags`
  to humans and `missionId` and `behaviour` to animals; add `vehicles` (player, tribe, type, hx, hy,
  missionId) and `guides` (player, hx, hy). Bump the map content schema version and make the schema
  error say that content must be regenerated. `authored-placements.ts` carries the new fields
  through to the entities it creates (as opaque values; stage 2 gives them a component).
- `content-resolver` depends on `@open-northland/data` and validates sidecars with `safeParse`; a
  present but invalid script warns and drops the roster, an absent table stays silent.
- Non-goals: interpreting any opcode, the sim, the app beyond carrying the fields.

## Where to look

`packages/data/src/schema/maps/{script,entities}.ts`, `tools/asset-pipeline/src/decoders/ini/
{map-script,maps,grammar}.ts` (the tokenizer strips quotes, so a numeric regex is the only token-type
signal left), `tools/asset-pipeline/src/stages/maps/script.ts` (already reads `strings.ini`),
`packages/content-resolver/src/maps-index.ts`, `packages/app/src/game/world/authored-placements.ts`.

## Verify

Synthetic decoder tests cover every parameter kind, an integer token for a name kind, an unknown
opcode, surplus and missing tokens, and case-insensitive names. `npm run test:content` asserts that
the decoder accepts every goal and result line of the local corpus and that the only unknown opcodes
are the known corpus misspellings (`setlandspace`, `missionmissionfailed`, `'explorearea`,
`StartSubmission` variants), and prints per-opcode line counts. Pipeline tests pin the new entity
columns and the string table on synthetic input; a real-content test matches a house id that a
script's `SetHouseBehaviourFlag` names. Run the normal gates plus `npm run test:pipeline` and
`npm run test:content`.
