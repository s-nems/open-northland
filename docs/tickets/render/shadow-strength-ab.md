# Pin the cast-shadow strength against the running original

**Area:** pipeline (one constant) + human eyes · **Origin:** shadow fidelity research, 2026-07-16 ·
**Priority:** P3

`SHADOW_ALPHA = 0x50` (~31% black, `tools/asset-pipeline/src/decoders/atlas.ts`) is inherited from an
earlier decoder and has no accepted source basis. A local binary probe found a half-darkening pixel
operation, but did not prove that the original uses it for this shadow path. That makes `0x80` a useful
A/B candidate, not a pinned value.

A/B against the running original (side-by-side screenshots of the same building/tree scene): bake
once with `0x50`, once with `0x80`, let a human pick. Update the constant's source-basis comment in
`atlas.ts` with the outcome and re-bake (`npm run pipeline`). One-constant change either way.

## Verify

- Human comparison vs the original game; the losing candidate is recorded in the comment as rejected.
