# Give loose files precedence over `.lib`-embedded copies

**Area:** pipeline · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P2

The original engine reads a plain file first and falls back to `.lib` archives last
(**source basis:** `OpenVikings_reversing/Source/NXBasics/CFile.cs` `OpenForReading`:
`DexterFile.FileOpen` → `TryOpenWithAdditionalLoadPaths` → `TryOpenFromLibraries`), so loose
patch/mod files override archived ones. The pipeline resolves this precedence backwards, twice:

- **PCX** (`tools/asset-pipeline/src/run.ts:46-57`): the loose walk converts
  `Data/.../text_000.pcx` → `.png` first, then the lib-embedded walk converts the extracted copy to
  the case-folded **same output path** second — on case-insensitive filesystems (macOS/Windows
  default) the base-lib version overwrites the patched loose version. The comment claiming "the two
  walks are disjoint sources" is false for these collisions.
- **BMD** (`tools/asset-pipeline/src/stages/bmd/convert.ts:107-130`): `indexOutTree` reads `.bmd`
  only from the unpacked lib out-tree, so loose `.bmd` never enter the atlas stage at all.

Measured on the owned game copy: 66 `.pcx` exist both loose and inside `data0001.lib` with
different bytes — including essentially all ground-texture pages (`text_000.pcx`, `text_2xx.pcx`,
…) — and 4 `.bmd` differ (`cr_hum_body_32.bmd`, `cr_hum_head_33.bmd`, `cr_hum_body_74.bmd`,
`ls_menu_logos.bmd`). Converted ground pages and those human atlases come out as the stale
base-archive art instead of the patched art the original renders.

## Scope

- Make loose-vs-lib collisions resolve loose-first everywhere (PCX conversion order, BMD indexing,
  and audit any other stage joining both sources), matching the engine's load order.
- Mind case-folding: a collision is a case-insensitive path match, and the fix must not regress on
  case-sensitive filesystems (see `docs/tickets/pipeline/lib-lowercase-data-tree.md` — related but
  separate defect; fixing both together is reasonable if the seam is shared).
- Pin the precedence in a synthetic test (a fixture lib whose member collides with a loose file of
  different bytes → the loose bytes win).

## Verify

`npm test` (new synthetic precedence test), `npm run check`, `npm run build`, and a real
`npm run test:pipeline` run against the owned copy — spot-check that a known-differing page (e.g.
`text_000`) now matches the loose file's decode. Ground textures and human sprites are visual:
human sign-off on `?map=` / `?anim` after regenerating content.
