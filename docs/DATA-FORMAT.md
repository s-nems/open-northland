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
│   ├── buildings.json      # BuildingType[]  (houses/workplaces)
│   ├── jobs.json           # JobType[]
│   ├── weapons.json        # WeaponType[]
│   ├── animals.json        # AnimalType[]
│   ├── vehicles.json       # VehicleType[]
│   ├── landscape.json      # LandscapeType[] + pattern transitions
│   └── tribes.json         # TribeType[]
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

## Design principles

1. **Readable & diffable.** IR is plain JSON with stable key order and meaningful names, so an
   agent can read a building definition and a balance change shows up as a clean diff.
2. **Provenance preserved.** Every IR record keeps where it came from (source file + original
   field names) so the conversion is auditable and re-runnable. Don't silently rename semantics.
3. **Mod-aware layering.** Load base game first, then overlay the `culturesnation` mod (`DataCnmd`)
   — the mod often provides readable `.ini` for things the base game only ships as `.cif`, so
   prefer mod sources. The pipeline records which layer won for each record.
4. **Versioned.** `ir.json.version` bumps on schema changes; the sim refuses to load a mismatched
   major version. Golden tests pin a sample content set.

## Example schema → original mapping

Original `DataCnmd/types/houses.ini`:

```ini
[logichousetype]
debugname "headquarters"
logictype 1
logicworker 24 3       # jobType 24, count 3
logicstock 16 150 0    # goodType 16, capacity 150, initial 0
```

IR `content/types/buildings.json` entry (schema in `packages/data/src/schema.ts`):

```json
{
  "id": "headquarters",
  "kind": "headquarters",
  "workers": [{ "jobType": 24, "count": 3 }],
  "stock":   [{ "goodType": 16, "capacity": 150, "initial": 0 }],
  "source":  { "file": "DataCnmd/types/houses.ini", "block": "logichousetype#0" }
}
```

The sim consumes the IR; it never parses `.ini`. The mapping from raw fields to IR fields lives in
the pipeline decoder for that type, and is documented inline there.

## Numeric ids vs string ids

The original uses numeric type ids (`goodtype 16`, `jobtype 24`) and references them everywhere.
We keep the numeric ids as the stable cross-reference (so map/building/job data stays consistent),
but attach human-readable `id`/`debugname` strings for legibility. Schemas validate that every
referenced numeric id resolves to a defined type — catching dangling references at load time.

## Sprites & animations

`.bmd` "bob" files hold framed, palette-indexed animations (decoded by OpenVikings'
`CBobManager`/`CBitmap` — see `docs/SOURCES.md`). The pipeline unpacks them into a PNG atlas plus
JSON describing frames, per-frame anchor (feet position for correct isometric sorting), and named
animation sequences (walk/work/idle/fight per direction). `render` loads these; `sim` never does —
the sim only knows an entity's logical state, and `render` maps state → animation.

## Maps

A map IR is the terrain grid (per-cell landscape type + height + flags) plus initial placements
(buildings, settlers, resources, tribe ownership). Source: original map files +
`CnModMaps/` (~125 mod maps). Format details land when the pipeline's map decoder is written.
