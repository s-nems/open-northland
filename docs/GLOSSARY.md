# Glossary — domain vocabulary

One or two lines per term; the pointer is the detailed home. Formats first, then world/sim, then
project jargon.

## Original file formats

- **bob** — one framed, palette-indexed sprite image inside a `.bmd` container; animations are
  named bob ranges (`[bobseq]`). → docs/SOURCES.md, docs/DATA-FORMAT.md "Sprites & animations".
- **`.bmd`** — the bob container (oracle: `CBobManager`, storable id `0x3F4`): settlers, buildings,
  landscape objects, HUD chrome. Each `(bmd, palette)` pair decodes to its own PNG atlas.
  → docs/SOURCES.md.
- **`.cif`** — encrypted "Cultures Information File": a serialized `CStorable` object graph,
  decrypted with `(in − 1) ^ key`. Carries the `.cif`-only type tables, map logic headers, and UI
  strings. → docs/SOURCES.md "CIF container format".
- **hoix** — the `map.dat` chunk container: a flat sequence of chunks, each a 0x20-byte header
  (marker `"hoix"`, 4-char subtag, length, depth) plus payload. → docs/SOURCES.md "`map.dat` chunk
  container".
- **`.fnt`** — a bitmap font: a `CFont` (`0x3F5`) wrapping an ordinary `.bmd` bob container;
  character `c` draws bob `c − 0x20`. → docs/SOURCES.md "UI fonts".
- **lane** — one gridded data plane inside `map.dat` (its chunk subtag names it): `lmlt` logic
  object type, `empa`/`empb` per-triangle ground pattern, `emla` placed objects, `lmpa`/`lmpb`
  per-triangle walkability class, `lmhe` height, `embr` shading, `emt1..4` transition overlays.
  Resolutions differ per lane (cell / half-cell / triangle). → docs/SOURCES.md.

## World geometry & sim

- **staggered raster** — the original's cell layout: even rows sit on integer columns, odd rows
  shift half a column right; measured pitch 68 px cell width × 38 px row step. → docs/SOURCES.md
  "Terrain tessellation".
- **half-cell lattice** — the original's `2W×2H` logic grid: cell `(c,r)` ↔ node `(2c+(r&1), 2r)`.
  Every integer grid coordinate in sim commands, footprints, and nav is a half-cell node;
  `packages/sim/src/nav/halfcell.ts` is the one conversion seam. → docs/ECS.md "Terrain".
- **atomic (action)** — a numbered micro-action bound per tribe to an animation; a job is a list of
  allowed atomic ids, and all settler behavior is a planner sequencing atomics. → docs/ECS.md "The
  atomic-action model".
- **drive (settler AI)** — one rung of the AI planner's fixed priority ladder (needs, then economy
  drives); each drive decides a settler's next atomic and returns true when it takes the settler.
  → `packages/sim/src/systems/agents/ai.ts`.
- **valency** — a node's occupancy capacity (`[landscapetype] maximumValency`); the original gates
  movement and placement by walkability + valency, not per-cell walk cost. → docs/ECS.md "Terrain".
- **logictype** — the numeric join key from a graphics record (`[GfxHouse]`/`[GfxLandscape]`
  `LogicType`) to its logic type table entry (`housetypes`/`landscapetypes` id). → docs/SOURCES.md.

## Project jargon

- **IR / ContentSet** — the **IR** is the validated JSON content the pipeline emits under
  `content/` (zod schemas in `packages/data/src/schema/`); a **ContentSet** is that content loaded
  and validated in memory (`parseContentSet`), consumed by sim and render. → docs/DATA-FORMAT.md.
- **Fixed / fx** — the sim's branded fixed-point number type; scaled integers in a JS double, exact
  to 2^53. Mint only through the `fx.*` helpers (`packages/sim/src/core/fixed.ts`).
  → `packages/sim/AGENTS.md` "Fixed-point".
- **golden (test)** — a committed expected value (canonical state hash or atomic-action trace)
  pinning deterministic behavior; it moves only with an intentional, named mechanic change.
  → `packages/sim/AGENTS.md` "Proving your change".
- **team colour vs skin variant** — a **team colour** is a per-player recolour applied at draw time
  (an indexed atlas drawn through the player-colour LUT's row); a **skin variant** is a different
  palette baked at decode time (each `(bmd, palette)` is its own atlas — `house01`/`house02`
  building skins, settler skin/hair remaps from `randompalette.ini`). → docs/SOURCES.md,
  `packages/render/src/gpu/sprite-sheet.ts`.
- **clean-room** — the legal posture: file formats are read as documentation (OpenVikings is the
  format oracle), but no original assets, decoded content, or reversed source is ever copied or
  committed. → docs/SOURCES.md "Legal line".
