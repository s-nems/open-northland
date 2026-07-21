# Remove the unused bitmap-font runtime path

**Area:** app + pipeline · **Priority:** P3

`packages/app/src/hud/bitmap-text.ts` has no production importer. Its glyph-run factory and the related
`.fnt` loaders in `content/font-gfx.ts` are exercised only by their own tests, while the live HUD uses
the vector text kit. The old package-contract clause that justified retaining this alternative path no
longer exists, so this is dead runtime and pipeline surface rather than an open product decision.

## Scope

- Remove the unused bitmap glyph-run implementation and any `.fnt` loaders or emitted font artifacts
  left without a consumer.
- Keep the CP1250 mapping only if a live decoder still uses it; otherwise remove it with its isolated test.
- Remove comments that promise the deleted fallback. Do not change the live vector HUD text path.

## Verify

`npm test`, `npm run check`, and `npm run build`; run `npm run test:pipeline` if the font stage changes,
then confirm the normal HUD is unchanged in a browser.

