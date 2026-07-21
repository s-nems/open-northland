# Generated content and the IR

The asset pipeline converts an owned game installation into a local `content/` directory. The
directory is ignored by Git because it contains derived game data.

Runtime rules are stored in one JSON document:

```text
content/
  ir.json                 validated rules and presentation bindings
  maps/
    <id>.json             decoded terrain
    <id>.meta.json        optional menu metadata
    <id>.script.json      optional player and mission data
    <id>.png              optional thumbnail
  Data/...                decoded atlases, palettes, fonts, and other runtime files
  gui/...                 decoded interface assets
  goods/...               decoded goods art
```

The exact asset tree grows as more decoders are connected. Code should use the shared resolver rather
than guessing paths.

## `ir.json`

`packages/data/src/schema/content/content-set.ts` defines the top-level `ContentSet`. Its main groups
are:

- economy: goods, jobs, job experience, buildings, weapons, armor, and vehicles;
- actors: tribes, animals, atomic animations, and body-animation bindings;
- landscape: logic types, graphics bindings, gathering joins, ground patterns, and transitions;
- buildings: bobs, construction layers, and animated overlays;
- maps and sound-bank bindings.

The document also contains a manifest:

```json
{
  "manifest": {
    "version": 1,
    "generatedFrom": {
      "game": "<local game path>",
      "mod": "<optional local mod path>"
    },
    "locale": "eng"
  },
  "goods": [],
  "jobs": [],
  "buildings": []
}
```

The remaining arrays are omitted from this example. Read the schema for the current complete list.

`parseContentSet(raw)` performs Zod validation and cross-reference checks. `IR_VERSION` records the
current schema version. A strict load-time version rejection is not implemented yet, so schema
validation remains the effective compatibility gate.

## Where content lives in the source tree

There are three distinct layers:

1. `content/` is generated output. Never edit it by hand or commit it.
2. `packages/app/src/catalog/` contains committed fallback balance and bindings used without an owned
   game copy.
3. `packages/app/src/game/sandbox/` assembles fallback content for scenes and development play.

When extracted data is wrong, change the pipeline or schema and regenerate. When fallback balance is
wrong, change the catalog. A scene should configure its setup, not define a private copy of the game
rules.

## Identifiers and references

Original tables use numeric ids extensively. The IR keeps those numeric join keys and adds readable
string ids where the source provides them.

Numeric ids are not always global. Before indexing by `typeId`, check the source table and the schema
to determine whether the id is scoped by tribe, record family, animation set, or another key.

Cross-reference validation catches many dangling ids, but it cannot prove that two equally numbered
rows have the intended meaning.

## Provenance

Extracted rows may include a `source` object with:

- `file`: the input path;
- `block`: the source record or section, when known;
- `layer`: base game or mod.

Not every schema carries provenance yet. The decoder is the authoritative mapping from source keys to
IR fields. Keep that mapping small, testable, and supported by the source evidence described in
[`SOURCES.md`](SOURCES.md).

## Layering

Prefer readable CulturesNation `.ini` files when they exist, then readable base-game `.ini` files.
Use decoded `.cif` tables only when no readable equivalent is available. The pipeline loads base data
and applies supported mod overrides.

Keys are case-sensitive. A repeated single-value key and a one-line list need different parsing
helpers. Test both shapes when a source table uses both.

## Maps, graphics, and audio

Map terrain is stored separately from `ir.json` because each map is loaded on demand. Map JSON is
validated with `parseTerrainMap`; optional sidecars provide menu, lobby, and mission information.

Graphics decoders turn palette-indexed source frames into atlases and manifests. IR tables such as
`bobSequences`, `gfxAtomics`, and `buildingBobs` connect logical state to those files. The simulation
does not load sprite data.

The sound bank follows the same boundary. The IR describes available groups and bindings, while the
audio package decides what to play and owns browser playback.

## Changing the format

For a schema or pipeline change:

1. update the schema and decoder together;
2. add a synthetic decoder or loader test;
3. update consumers without adding a second interpretation of the same field;
4. run `npm run test:pipeline` against the owned game copy;
5. run `npm run test:content` when existing local content consumers changed;
6. bump `IR_VERSION` for a breaking shape change.

Generated output stays local. Commit schemas, decoder code, synthetic fixtures, and concise format
notes only.
