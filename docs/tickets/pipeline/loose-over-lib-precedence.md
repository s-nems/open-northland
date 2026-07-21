# Verify loose-file precedence over `.lib` copies and match it

**Area:** pipeline · **Priority:** P2
**Needs user:** compare a known-different loose/archive asset in the running original.
**Blocked by:** [shared source-path resolution](source-path-resolution.md)

Loose files and `.lib` members collide in the owned installation, but the original engine's precedence
has not been pinned by an allowed source. The pipeline currently lets archive data win in two places:

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
`ls_menu_logos.bmd`). The pipeline therefore needs a direct observation to decide which copy should
win before changing runtime output.

## Scope

- First compare a known-differing loose/archive asset with the running original and record which copy
  it uses. If loose wins, make collisions resolve loose-first everywhere (PCX conversion order, BMD
  indexing, and any other stage joining both sources). If archive wins, pin the current order in a test
  and narrow this ticket to the missing loose-BMD input path if that path is still needed.
- A collision is a case-insensitive path match; apply the observed layer order through the shared
  resolver on every filesystem and every stage.
- Pin the observed precedence in a synthetic collision test.

## Verify

`npm test` (new synthetic precedence test), `npm run check`, `npm run build`, and a real
`npm run test:pipeline` run against the owned copy. Spot-check a known-differing page such as
`text_000` against the observed winner. Ground textures and human sprites need human sign-off on
`?map=` and `?anim` after regenerating content.
