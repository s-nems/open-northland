# The intermediate representation (IR) — content format

The original game stores rules in `.ini` (readable) and `.cif` (compiled/encrypted), and graphics
in `.bmd`/`.pcx`/`.hlt`/`.lib`. The **asset pipeline** converts all of it once into a modern,
versioned IR under `content/`. The `data` package owns the IR's zod schemas, which are the single
source of truth: they give us both runtime validation and inferred TS types.

```
content/
├── ir.json                 # manifest: { version, generatedFrom, locale, hashes }
├── types/
│   ├── goods.json          # GoodType[]
│   ├── goods-graph.json    # derived: the production DAG (raw -> processed -> consumed)
│   ├── buildings.json      # BuildingType[]  (houses/workplaces)
│   ├── jobs.json           # JobType[]  (each carries its allowatomic id list)
│   ├── atomics.json        # AtomicType[]: id, per-tribe animation binding, effect kind (timing TBD)
│   ├── experience.json     # ExperienceType[]: per-specialization XP factors (progression)
│   ├── tribes.json         # TribeType[]: incl. the needfor*/allow*/jobEnables* dependency graph
│   ├── weapons.json        # WeaponType[]  (per-armor-class damage)
│   ├── armor.json          # ArmorType[]   (armor class + blockingValue — the combat damage-vs-armor join)
│   ├── animals.json        # AnimalType[]  (non-controllable tribes)
│   ├── vehicles.json       # VehicleType[]  (incl. stock slots: handcart 15, oxcart 30, ships)
│   └── landscape.json      # LandscapeType[]: walk cost / valency / land-water (the NAV graph)
├── sprites/
│   ├── <name>.png          # texture atlas (decoded from .bmd/.pcx)
│   ├── <name>.atlas.json   # frames: {id, x,y,w,h, anchorX,anchorY}
│   └── <name>.anim.json    # animations: {name, fps, frames[], loop}
├── palettes/<name>.json    # decoded palettes / remap tables
├── maps/<name>.json        # terrain grid + initial entity placements
└── text/<locale>.json      # UI + content strings (pol/eng/ger/rus)
```

`content/` is **gitignored** — it is derived from your owned game copy. The schemas in
`packages/data` are committed; the generated JSON/PNG is not.

**Three content sources — which one to edit.** A cold agent meets three places "content" lives.
(1) Generated **`content/`** (repo root) — the pipeline's output: IR JSON, atlases, maps, GUI/fonts;
gitignored and fetched at runtime via the app's `vite.config.ts` routes. Never hand-edit it — change
the pipeline (`tools/asset-pipeline/`) or the schemas (`packages/data/src/schema/`) and regenerate.
(2) Committed fallback **`packages/app/src/catalog/`** — hand-authored balance/bindings (building
and goods rosters, farming/felling/mining constants, footprints, professions, labels); edit it for
balance or naming, and note its tests pin rows back to `ir.json` whenever `content/` is present.
(3) **`packages/app/src/game/sandbox/`** — the ONE global sandbox `ContentSet` (built from the
catalog) that scenes, `?map=`, and the vertical slice consume; edit it for the test/sandbox game
rules — scenes never define their own content (docs/SCENES.md).

## Design principles

1. **Readable & diffable.** IR is plain JSON with stable key order and meaningful names, so an
   agent can read a building definition and a balance change shows up as a clean diff.
2. **Provenance preserved.** Every IR record keeps where it came from (source file + original
   field names) so the conversion is auditable and re-runnable. Don't silently rename semantics.
3. **Mod-aware layering.** The primary readable rule source is **base `Data/logic/*.ini`** (which
   begin with a `<CULTURES_CIF_BEGIN>` header line, then plain text). Load base first, then overlay
   the `culturesnation` mod (`DataCnmd`), which provides a *subset* (`houses.ini`, `weapons.ini`,
   graphics) plus new campaigns/maps. The pipeline records which layer won for each record.
   (Note: `housetypes`/`weapontypes`/`trianglepatterntypes`/`atomicanimations` and all maps are
   `.cif`-only — these go through the `.cif` decoder, see docs/formats/CIF.md.)
4. **Versioned.** `ir.json.version` bumps on schema changes; the sim refuses to load a mismatched
   major version. Golden tests pin a sample content set.
   **Policy:** the version is a single integer, bumped whenever a schema in `packages/data` changes
   shape. There are **no migrations** — a version mismatch is a hard load error, not an upgrade path;
   the fix is to regenerate the IR from your owned game copy (`npm run pipeline -- --game … --mod …
   --out content`). Because `content/` is gitignored and always regenerated, the IR is produced by
   the same commit that consumes it, so a stale IR can never silently mis-feed the sim.

## Example schema → original mapping

Original `DataCnmd/types/houses.ini`:

```ini
[logichousetype]
debugname "headquarters"
logictype 1            # the building's type id (NOT a `type` line, unlike other tables)
logicmaintype 1        # 1 storage / 2 home / 3 workplace / 4 training / 5 tower / 6 vehicle / 7 wonder
logicworker 24 3       # jobType 24, count 3
logicstock 16 150 0    # goodType 16, capacity 150, initial 0
logicproduction 11     # (workplaces) output good id 11 — input side / amounts live in the goods-graph
```

IR `content/types/buildings.json` entry (schema: `BuildingType` in
`packages/data/src/schema/economy/buildings.ts` — the schemas live under `packages/data/src/schema/`,
split by domain: `actors/`, `audio/`, `content/`, `economy/`, `graphics/`, `landscape/`, `maps/`;
extracted by
`extractBuildings` in `tools/asset-pipeline/src/decoders/ini/types/buildings.ts`):

```json
{
  "typeId": 1,
  "id": "headquarters",
  "kind": "storage",
  "homeSize": 0,
  "workers": [{ "jobType": 24, "count": 3 }],
  "stock":   [{ "goodType": 16, "capacity": 150, "initial": 0 }],
  "produces": [],
  "construction": [],
  "source":  { "file": "DataCnmd/types/houses.ini", "block": "logichousetype", "layer": "mod" }
}
```

`kind` is mapped from `logicmaintype` (the engine's classification); the specific building —
headquarters vs a stock, which workplace — is carried by `id` (the `debugname` slug). The full
production recipe (input goods + per-cycle amounts/timing) is a goods-graph artifact derived
from `goodtypes.productionInputGoods`; `produces` captures only the output good ids the house table
names today. `construction` is the build-material cost (`{goodType, amount}[]`) overlaid from the
**graphics** table (`DataCnmd/budynki12/houses/houses.ini` `[GfxHouse]` `LogicConstructionGoods`,
`extractConstructionCosts`) — the logic table above carries no cost key; empty for the always-present
headquarters/wonder. A home's level chain (typeIds 2..6) reads its tier's upgrade cost (reference
tribe; the per-tribe spread is a recorded source-basis deviation).

The sim consumes the IR; it never parses `.ini`. The mapping from raw fields to IR fields lives in
the pipeline decoder for that type, and is documented inline there.

## Numeric ids vs string ids

The original uses numeric type ids (`goodtype 16`, `jobtype 24`) and references them everywhere.
We keep the numeric ids as the stable cross-reference (so map/building/job data stays consistent),
but attach human-readable `id`/`debugname` strings for legibility. Schemas validate that every
referenced numeric id resolves to a defined type — catching dangling references at load time.

## Sprites & animations

`.bmd` "bob" files hold framed, palette-indexed animations (see `docs/formats/GRAPHICS.md`). The
pipeline unpacks them into a PNG atlas plus
JSON describing frames, per-frame anchor (feet position for correct isometric sorting), and named
animation sequences (walk/work/idle/fight per direction). `render` loads these; `sim` never does —
the sim only knows an entity's logical state, and `render` maps state → animation.

Two render-binding tables in `ir.json` carry the *joins* into those atlases (the sim ignores both):
`bobSequences` (the `[bobseq]` named frame ranges per bob set) and `buildingBobs` (the `[GfxHouse]`
building-type → house-bob join: `(tribeId, typeId, level) → (bmd, palette, bobId)`, pairing each
record's `LogicType`/`GfxBobId` level-tables — see `extractBuildingBobs`), so the renderer draws each
building its own house bob from data rather than a transcribed constant.

## Atomics, the goods graph & progression

Three derived/extracted IR artifacts encode the parts of Cultures that aren't obvious from a flat
type list (see docs/ECS.md for why these are central):

- **`atomics.json`** — the behavior vocabulary. Extracted from `tribetypes.ini` `setatomic`
  (atomic id → animation, per tribe), with each `JobType` carrying its `allowatomic` id list and
  each `GoodType` its `atomicFor*`. Atomic *timing/effects* are the `AtomicAnimation` records from
  `atomicanimations.ini` (`length`, `startdirection`, timed `event`/`eventx` tuples), joined to the
  `setatomic` bindings by animation name — see `extractAtomicAnimations`.
- **`goods-graph.json`** — the production DAG, mechanically derived from
  `goodtypes.productionInputGoods` (e.g. `bread ← flour + water`, `plank ← wood`). Materialized as
  an explicit artifact so agents and systems read one source of truth, not implicit cross-system logic.
- **`gatheringPipeline`** — the resolved map-*gathering* join (the raw side of the goods graph): per
  gathered good, the three `landscapeTo{Harvest,Pickup,Store}` lifecycle stages (`tree(4) → trunk(6)
  → wood(7)` for wood) each joined to the `[GfxLandscape]` records that place it (by `logicType`).
  Materialized from the new `GoodType.gathering` chain + the `landscape`/`landscapeGfx` tables so a
  later gathering system reads the stages and their placeable gfx directly — see `buildGatheringPipeline`
  and `buildGatheringPipeline`. The per-good source fields also land on `GoodType`
  (`landscapeType`, `gathering`) and the `[landscapetype]` lifecycle inputs on `LandscapeType`
  (`name`, raw `transitions`).
- **`experience.json` + the tribe dependency graph** — `humanjobexperiencetypes` XP factors plus
  `tribetypes.ini` `needfor*`/`allow*`/`jobEnables*`/`trainforjob`. This is the progression spine
  (`ProgressionSystem`) and the main expression of tribe asymmetry.

## Maps

A map IR is the terrain grid (per-cell landscape type + height + flags → the **nav graph**) plus
initial placements (buildings, settlers, resources, tribe ownership). Source: `map.cif` (encrypted —
needs the `.cif` decoder) alongside readable `.ini`/`.inc` parts, for base maps + `CnModMaps/`
(~125 mod maps). Format details land when the pipeline's map decoder is written.

## Text encoding

Original `.ini`/`.cif` strings are **CP1250** (Central-European Windows), not UTF-8 — the content
is Polish (`set_language 6`, campaigns `OsmyCudSwiata`/`WyprawaNaPolnoc`). The pipeline must decode
CP1250 → UTF-8 when emitting `text/<locale>.json`, or names like Łódź/ó/ż will corrupt.
