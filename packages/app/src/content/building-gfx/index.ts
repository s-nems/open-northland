/**
 * The building/resource render binding: reduce the decoded `[GfxHouse]` IR joins to the renderer's
 * per-building-type refs, split by the render aspect each produces — the base per-type bob binding +
 * the atlas families and shared canonical-row helpers (`families.ts`), the working-state animated
 * overlay (`overlays.ts`, the mill's rotor), and the construction-stage stack (`construction.ts`). Each
 * viking building type draws its own house bob from the extracted IR; the pure reducers are unit-tested
 * without a browser, and the byte loading lives in {@link import('../sprite-sheet/index.js')}.
 */

export * from './construction.js';
export * from './families.js';
export * from './overlays.js';
