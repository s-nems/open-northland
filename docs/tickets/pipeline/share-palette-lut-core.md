# Route every palette LUT producer through the shared writer

**Area:** pipeline · **Priority:** P3

`stages/palette-lut.ts` owns `buildPaletteLut` and `writeLutPng`, but the goods stage repeats the
resolve/warn/fallback loop and the vehicle-colour stage inlines the PNG writer. The copies need
different input shapes, which is why the current fixed `PaletteLutSource[]` helper does not fit them.

## Scope

- Let `buildPaletteLut` accept a resolver callback.
- Route the goods and vehicle-colour LUTs through the shared builder and writer.
- Keep warnings, fallbacks, row order, and emitted bytes unchanged.

## Verify

- Byte-compare LUT output before and after the refactor.
- `npm run test:pipeline`, `npm test`, `npm run check`, and `npm run build`.
