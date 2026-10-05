import { isCivilizationTribe } from '@open-northland/data';
import { type DrawItem, resolveLayers, type SpriteSheet } from '@open-northland/render';
import { JOB_SOLDIER_UNARMED } from '../../../catalog/jobs.js';
import type { FigureFrames } from '../../figures/figure-frames.js';
import { growFigureBounds } from '../../figures/vehicle-fit.js';
import type { BuildingThumbs } from '../building-thumb.js';

export type NationEmblemPainter = (
  canvas: HTMLCanvasElement,
  tribe: number,
  player: number,
  size: number,
) => boolean;

/** Civilizations use their headquarters, as in the lobby; other peoples use their own standing
 *  character. Paint only when the roster identity changes, from the world's loaded sprite sheet. */
export function createNationEmblems(
  sheet: SpriteSheet | undefined,
  thumbs: BuildingThumbs,
  frames: FigureFrames,
  headquarters: number | undefined,
  colourOf: ((player: number) => number) | undefined,
): NationEmblemPainter {
  return (canvas, tribe, player, size) => {
    if (isCivilizationTribe(tribe))
      return headquarters !== undefined && thumbs.paint(canvas, headquarters, size, tribe);
    // An unloaded tribe must not silently acquire the base civilization's character.
    if (
      sheet?.characters?.byTribe?.[tribe] === undefined &&
      sheet?.characters?.animals?.byTribe[tribe] === undefined
    )
      return false;
    const item: DrawItem = {
      kind: 'settler',
      ref: tribe,
      x: 0,
      y: 0,
      depth: 0,
      tribe,
      player: colourOf?.(player) ?? player,
      state: 'idle',
      facing: 0,
      jobType: JOB_SOLDIER_UNARMED,
    };
    const layers = resolveLayers(sheet, item, 0);
    if (layers === null) return false;
    const bounds = growFigureBounds(null, layers);
    if (bounds === null) return false;
    const pixels = size * 2;
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return false;
    const zoom = (pixels - 4) / Math.max(1, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    frames.draw(
      ctx,
      layers,
      item,
      zoom,
      (pixels - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom,
      (pixels - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom,
    );
    return true;
  };
}
