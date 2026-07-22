# Use one source-path resolution policy in the pipeline

**Area:** pipeline + content-resolver · **Priority:** P1

The pipeline currently resolves source paths with four different case rules: exact paths in
`roots.ts`, leaf-only case folding in `stages/source-files.ts`, segment-wise folding for maps, and a
case-folded union walk in `collectSourceFiles`. The same `goodtypes.ini` and `landscapes.cif` inputs can
therefore resolve differently depending on the stage. There is also a current release failure:
`data0001.lib` stores lowercase `data/...` member names, while the content server reads exact-case
`Data/...` routes. A Linux conversion succeeds but the game cannot find the emitted atlases or sounds.

## Scope

- Define one segment-wise, case-insensitive resolver in `roots.ts` and route source-file reads and
  source-tree collection through it.
- Normalize extracted archive members to the canonical `Data/` output tree consumed by the content
  routes; do not add dual runtime lookup paths.
- Represent loose and archive layers explicitly and reject same-layer case collisions. Preserve each
  stage's current cross-layer winner until the original's precedence is observed in the dependent
  ticket.

## Verify

Synthetic tests cover mixed-case segments, collisions, layer identity, and a lowercase archive member
resolving through the canonical content route on Linux. Run `npm test`, `npm run check`, `npm run build`,
and `npm run test:pipeline`; the owned-copy regeneration remains byte-identical.
