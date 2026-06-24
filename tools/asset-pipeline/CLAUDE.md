# tools/asset-pipeline — build-tool notes

The pipeline turns an owned game copy into the validated IR under `content/`. It is a **build tool**,
not the sim — `node:zlib`/`node:fs` and floats are fine here; the determinism rules do **not** apply.
The root [`CLAUDE.md`](../../CLAUDE.md) carries the project-wide + legal rules; the IR shape is in
[`docs/DATA-FORMAT.md`](../../docs/DATA-FORMAT.md), the format → source map in
[`docs/SOURCES.md`](../../docs/SOURCES.md).

## Rules

- **Prefer the mod's readable `.ini`** over the encrypted base `.cif` (golden rule #4):
  `houses.ini`/`weapons.ini` and graphics ship readable under `DataCnmd/`. Many core types
  (`housetypes`/`weapontypes`/`trianglepatterntypes`/`atomicanimations`) and **all maps** are
  `.cif`-only — those go through `src/decoders/cif.ts`.
- **Validate visual decoders against the OpenVikings oracle** (`.pcx`/`.bmd`/palette → PNG/atlas):
  an agent can't self-judge pixels. Round-trip unit-test every decoder against tiny
  locally-generated fixtures.
- **Never commit decoded or copyrighted bytes.** `content/` is gitignored; tests use the synthetic
  fixture, never real game data. No original assets enter the repo (root `CLAUDE.md` Legal).
- The documented run: `npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`.
  `start` runs the compiled `dist/cli.js` (raw-TS strip-types can't resolve the `.js` import
  specifiers — see `docs/LESSONS.md`).
- **Provenance:** every IR record keeps its source file + original field names so the conversion is
  auditable and re-runnable. Don't silently rename semantics.
