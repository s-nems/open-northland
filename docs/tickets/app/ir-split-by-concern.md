# Split the app IR adapter by concern

**Area:** app · **Priority:** P3

`packages/app/src/content/ir.ts` is about 460 lines and owns three independent responsibilities: the
runtime IR row types, atlas/texture loading, and the memoized document fetch plus table readers. Adding
another content join would extend an already mixed module.

## Scope

Move those responsibilities to a `content/ir/` feature folder with a small barrel that preserves the
existing `content/ir.js` import surface. This is a structural move; do not rename rows, alter fetch
policy, or change loader behavior in the same task.

## Verify

`npm test`, `npm run check`, and `npm run build` pass with unchanged content joins and goldens.
