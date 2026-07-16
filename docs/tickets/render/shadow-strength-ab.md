# Pin the cast-shadow strength against the running original

**Area:** pipeline (one constant) + human eyes · **Origin:** shadow fidelity research, 2026-07-16 ·
**Priority:** P4

`SHADOW_ALPHA = 0x50` (~31% black, `tools/asset-pipeline/src/decoders/atlas.ts`) is cultures2-wasm
parity, but the evidence conflicts: the original's dump-verified house-darkening op is a halve
(`(dst >> 1) & 0x7f7f7f`, OpenVikings `CBitmap.cs`), and its managed `PrintBob_Shadow_TimeMask` uses
`shade = 128` → `dst × 0.5` — which would be alpha `0x80`, noticeably darker. OpenVikings' type-2
shadow path itself is explicitly non-faithful, so neither constant is pinned.

A/B against the running original (side-by-side screenshots of the same building/tree scene): bake
once with `0x50`, once with `0x80`, let a human pick. Update the constant's source-basis comment in
`atlas.ts` with the outcome and re-bake (`npm run pipeline`). One-constant change either way.

## Verify

- Human comparison vs the original game; the losing candidate is recorded in the comment as rejected.
