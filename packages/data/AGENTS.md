# Data package contract

`packages/data` owns the validated runtime shape of generated content. The root
[`AGENTS.md`](../../AGENTS.md) applies in full.

## Boundaries

- Schemas and cross-reference checks define the load boundary. Consumers do not re-parse the same row.
- Keep schemas strict where unknown fields indicate version drift. A lane default stands in for a lane
  a synthetic or test set omits, never for one an older pipeline did not write: the served `ir.json`
  goes through `parseGeneratedContentSet`, which rejects a document missing any lane.
- Numeric ids retain their source scope. A lookup key must include tribe, record family, or other scope
  when the source does.
- This package contains data rules and pure helpers. It does not import app, sim, render, browser, or
  Node I/O code.
- Any schema change bumps `IR_VERSION`, a new lane included.

## Layout

- `src/schema/`: zod schemas by domain (`actors/`, `economy/`, `maps/`, ...) and `IR_VERSION`.
- `src/fingerprint/`: content and state identity hashes.
- `src/cross-references/`: the load-time dangling-reference check and its helpers.
- `src/missions/`: mission goal and result decoding. `src/names/`: personal-name tables.
  `src/catalog/`: committed tables no source file supplies.
- `src/map-modules/`: the rules a map adds to its script (siege, gear schedule, heroes, death drops,
  demobilized start), each module versioned on its own, naming content by slug and text by map string
  id, and the check that they fit a map and its content. Outside `IR_VERSION`, like the variants.
- `src/map-variants/`: committed per-map variants (one file each, a long briefing text beside it),
  their schema, the script patch and starting settlers they apply, the briefing pages they rewrite,
  the map strings they add, and the map modules they carry. A variant is our own authored data,
  outside `IR_VERSION`; it names missions by `debuginfo` label and never renumbers them.
- `src/` root: lookups and pure helpers over parsed content.

Tests mirror `src/`; `test/schema/` holds the schema tests flat.

## Verification

Add schema and cross-reference tests at the smallest failing path. Schema changes also run the normal
gates and `npm run test:pipeline`; consumers of real generated rows run `npm run test:content`.
