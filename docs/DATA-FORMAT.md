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
    "version": 3,
    "contentRevision": 5,
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

The optional manifest `modVersion` is an explicit pipeline caller label (`--mod-version` in the CLI).
Absence means unknown. It is never inferred from `generatedFrom.mod`, which records an installation
path. The lobby compares the label alongside fingerprints of the actual content.

`contentRevision` is the pipeline's conversion revision, embedded so a running game can name its
content identity (a save file records it). Synthetic content without pipeline provenance parses as
revision 0.

The remaining arrays are omitted from this example. Read the schema for the current complete list.
The `generatedFrom` paths are local provenance. Do not paste the manifest into an issue or diagnostic
report without removing them.

`parseContentSet(raw)` performs Zod validation and cross-reference checks. `IR_VERSION` records the
current schema version, and the manifest gate rejects any other stamp - older or newer - before the
rest of the document is validated. Any schema change bumps it, a new lane included. The served
`content/ir.json` goes through `parseGeneratedContentSet`, which also rejects a document missing any
lane: generated content is regenerated, never read with a lane defaulted, and the lane defaults serve
synthetic and test sets only. Both checks live on the parse seam; the app's raw graphics/atlas view of
the same document is a deliberate unchecked cast that falls back per lane.

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
`bobSequences`, `gfxAtomics`, `jobGraphics`, and `buildingBobs` connect logical state to those files.
Several of them are keyed by tribe as well as by type: each civilization skins the same building and
job ids with its own bob sets. The simulation does not load sprite data.

The sound bank follows the same boundary. The IR describes available groups and bindings, while the
audio package decides what to play and owns browser playback.

## Changing the format

For a schema or pipeline change:

1. update the schema and decoder together;
2. add a synthetic decoder or loader test;
3. update consumers without adding a second interpretation of the same field;
4. run `npm run test:pipeline` against the owned game copy;
5. run `npm run test:content` when existing local content consumers changed;
6. bump `IR_VERSION` for a breaking shape change, or for an addition generated content must carry
   for real rather than by default.

Generated output stays local. Commit schemas, decoder code, synthetic fixtures, and concise format
notes only.

## Save files

A save is one JSON document produced by `exportSaveGame` and `serializeSaveGame`
(`packages/sim/src/save/`). It is a distinct format: not content JSON, not the render-facing
`WorldSnapshot`, and not a replay log.

```json
{ "header": { "...": "..." }, "sections": [] }
```

- `header` holds `{kind, formatVersion, irVersion, contentRevision, contentFingerprint, savedAt, mapId, mapFingerprint, entry, session,
  seed, tick}` and is the document's first key, so a reader classifies compatibility without
  touching sections. A later format may compress the sections but never the header. `entry` is a
  caller-recorded relaunch token, opaque to the sim like `mapId`: the app stores the entry URL
  search that reboots the session, so a load launched outside a running world (the main menu's save
  list) can reproduce the seat and session flags.
- Format 4 adds `header.session`: caller-owned plain JSON or null. Simulation export/parse copy it
  without interpreting it; restore never applies it to gameplay. The shape is bounded to 4096 visited
  values/keys, depth 32 and 65536 UTF-16 text units. Non-JSON values, cycles and prototype keys are
  rejected. Null records the absence of caller session metadata; older format versions are rejected.
  Lockstep owns the version-1 metadata schema: `{version, descriptor, roster: [{player, nick}]}`.
  Its closed projection validates the descriptor and exact ascending seat roster, preserves modes,
  colors, teams, rules and local seat, and strips unknown fields (including authentication tokens).
  Only human seats may carry a nick; null also supports unnamed local humans. Display names are
  unique, printable, trimmed and at most 24 characters. A previous `initialSave` fingerprint is removed:
  it identifies the source artifact, not the newly exported save. Null metadata means unrecorded;
  malformed present metadata throws. The app checks map/seed coherence against the enclosing header.
- `sections` is an array of string-identified sections in a fixed order: `entities` (the
  allocation counter plus the alive list), one `component` section per store in first-registration
  order with entries in per-store insertion order (both orders are behavior contracts), `rng` (the
  whole mulberry32 state), `fog` (present exactly when the header names a map fingerprint:
  per-player masks ascending by player, one visibility digit per cell, plus the rebuild-cadence
  fields), and `commands` (pending envelopes, the next sequence number, and required `continuation`).
  In save format 5, continuation is an array of `{applyTick, envelope}` with future safe-integer ticks,
  ascending by tick and preserving same-tick order. It retains accepted input from the saved session
  independently of a new transport's sequence numbers. Each tick applies pending endogenous/setup
  commands, then inherited continuation, then fresh transport input. Export merges inherited commands
  with caller-supplied captures, retaining old-before-new order. Repeated saves retain unexecuted input.
  The applied log remains replay history and stays out. Live targeted transport commands are excluded
  unless explicitly captured by the session owner; reconnection snapshots rely on the relay's stream.
  `withSaveContinuation` completes an asynchronous capture on a detached save at its original tick.
- The encoding is canonical: object keys keep construction order, a `Map` component field becomes a
  single-key `{"$map": [[key, value], ...]}` wrapper holding its live insertion order (raw Map order
  is observable sim state a restore must reproduce; the `$map` key is reserved, and export rejects a
  plain record carrying it), `Fixed` values are plain integers, and export throws (naming the
  component) on any shape JSON would corrupt, such as `undefined`, a non-finite number, a class
  instance, or an object appearing twice in one export, since shared or cyclic state would restore
  as disconnected copies. The same state and export metadata serialize byte-identically, and parse plus
  re-serialize round-trips the bytes.

A save records simulation state only. Presentation state - camera, selection, game speed, the
render's fog ghosts - is not captured, so a loaded game reopens at the entry's default framing.
Approximation: the original also restores the camera.

Reading is split in two: `parseSaveGame` validates an untrusted document's structure (header
identity, the exact section order, allocation coherence, pending envelopes), and `restoreSimulation`
materializes it onto a fresh sim, validating value shapes as it goes plus everything that needs
loaded content or a map, and finally runs the core invariants over the rebuilt world. The IR version and map fingerprint must match exactly; a `contentRevision`
difference is reported to the caller, never a rejection, because the revision also bumps for
presentation-only decoder fixes. A non-null `contentFingerprint` must match the resolved content.
The shared `packages/data/src/content-fingerprint.ts` function hashes canonical JSON with SHA-256,
preserving table and array order while excluding installation paths, provenance, goods/job display
names, locale, map inventory and sound data. It includes balance and content bindings as well as ids.
The lobby uses the same function and additionally requires an exact pipeline revision match.

The current format carries nullable `contentFingerprint` and `savedAt` fields.
`savedAt` is the caller's Unix timestamp in milliseconds, supplied at export rather than read inside
the simulation. Browser and desktop lists prefer this timestamp over their storage write time or
file mtime; saves without a timestamp retain those fallback dates. Exports without a timestamp remain deterministic.

`SAVE_FORMAT_VERSION` is a single monotonic integer; any layout change bumps it, and `parseSaveGame`
rejects a document stamped with any other version, older or newer. There is no migration seam: the
game has no released saves to carry forward, so a layout change replaces the layout and regenerates
the committed fixture (`packages/sim/test/fixtures/save.golden`), which freezes the exact bytes of a
small populated world as the layout's tripwire; the regeneration workflow lives in
[`TESTING.md`](TESTING.md).
