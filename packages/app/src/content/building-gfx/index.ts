/**
 * The building render binding: reduce the decoded `[GfxHouse]` IR joins to the renderer's per-type refs,
 * split by the render aspect each produces - the base bob binding, atlas families and shared canonical-row
 * helpers (`families.ts`), the working-state animated overlay (`overlays.ts`), the construction-stage
 * stack (`construction.ts`), and the sign anchors (`flag-points.ts`). The reducers are pure; the byte
 * loading lives in `../sprite-sheet/`.
 */

export * from './construction.js';
export * from './families.js';
export * from './flag-points.js';
export * from './overlays.js';
