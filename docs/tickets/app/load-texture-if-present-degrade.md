# Make optional texture loading degrade on fetch and decode failures

**Area:** app · **Priority:** P2

`content/net.ts` documents optional assets as a degrade-to-fallback boundary. `loadTextureIfPresent`
returns `undefined` for an HTTP miss, but still rejects when the HEAD request fails or the image cannot
decode. Those failures escape from the player-LUT, GUI, font, and goods loaders and can abort a boot that
should work without generated content.

## Scope

Catch both request and texture-source failures and resolve `undefined`, matching the function's callers
and its sibling optional loaders. Add an injectable request/source seam only if needed for a focused
test; do not weaken required-asset loaders.

## Verify

Tests cover a rejected request and an unloadable image. A bare checkout reaches its fallback renderer;
`npm test`, `npm run check`, and `npm run build` pass.
