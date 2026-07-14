import type { LandscapeGfxRow } from '../../src/content/ir.js';

/** The normalized `/bobs/` prefix decoded asset paths carry in the `landscapeGfx` IR (the served-stem
 *  convention `<B>/<bmd>.bmd`). Shared by the gathering-binding and resource-gfx fixtures. */
export const B = 'data/engine2d/bin/bobs';

/**
 * Build a synthetic `[GfxLandscape]` IR row for the render-binding tests: `<B>/<bmd>.bmd` recoloured by
 * `palette`, with the given per-state frame lists. The one place these tests describe a decoded landscape
 * record, so a change to {@link LandscapeGfxRow} or the stem convention lands here.
 */
export function landscapeRow(
  index: number,
  logicType: number,
  palette: string,
  frames: LandscapeGfxRow['frames'],
  bmd = 'ls_ground',
  editName?: string,
): LandscapeGfxRow {
  return {
    index,
    logicType,
    bmd: `${B}/${bmd}.bmd`,
    paletteName: palette,
    frames,
    ...(editName !== undefined ? { editName } : {}),
  };
}
