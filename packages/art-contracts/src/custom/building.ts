import { z } from 'zod';

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const pngName = z.string().regex(/^[a-zA-Z0-9_-]+\.png$/);
const shadow = z
  .object({
    sprite: pngName,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    entrancePixel: point,
  })
  .strict()
  .refine(
    (layer) =>
      layer.entrancePixel.x >= 0 &&
      layer.entrancePixel.x <= layer.width &&
      layer.entrancePixel.y >= 0 &&
      layer.entrancePixel.y <= layer.height,
    'Entrance outside shadow image',
  );
/** Largest overlay sheet edge in pixels: the WebGL texture limit of common integrated and mobile GPUs. */
export const OVERLAY_SHEET_MAX_EDGE = 4096;

/** A finished building's state overlay: a row-major grid of equally sized frames drawn above the body,
 *  registered by the body-canvas pixel its top-left corner sits on, at its own source scale. */
const overlay = z
  .object({
    sprite: pngName,
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
    frames: z.number().int().min(1).max(64),
    columns: z.number().int().positive(),
    scale: z.number().finite().positive(),
    bodyPixel: point,
    idle: z.number().int().min(0),
    working: z.array(z.number().int().min(0)).min(1),
    ticksPerFrame: z.number().int().positive(),
  })
  .strict()
  .refine(
    (layer) => layer.idle < layer.frames && layer.working.every((frame) => frame < layer.frames),
    'Overlay state frame outside the sheet',
  )
  .refine(
    (layer) =>
      layer.frameWidth * layer.columns <= OVERLAY_SHEET_MAX_EDGE &&
      layer.frameHeight * Math.ceil(layer.frames / layer.columns) <= OVERLAY_SHEET_MAX_EDGE,
    `Overlay sheet edge over ${OVERLAY_SHEET_MAX_EDGE} px`,
  );
const constructionStage = z
  .object({
    sprite: pngName,
    timeMask: pngName,
    fromPct: z.number().int().min(0).max(99),
    toPct: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((stage) => stage.fromPct < stage.toPct, 'Construction window must increase');
export const customBuildingManifest = z
  .object({
    tribeId: z.number().int().positive(),
    typeId: z.number().int().positive(),
    layer: z.string().min(1),
    sprite: pngName.default('B-sprite.png'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    scale: z.number().finite().positive(),
    entrancePixel: point,
    doorNode: point,
    sourceBasis: z.string().min(1),
    shadow: shadow.optional(),
    overlay: overlay.optional(),
    construction: z.array(constructionStage).min(1).max(8).optional(),
    selectionEllipse: z
      .object({
        cx: z.number().finite(),
        cy: z.number().finite(),
        rx: z.number().finite().positive(),
        ry: z.number().finite().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((manifest) => {
    const stages = manifest.construction;
    if (stages === undefined) return true;
    const last = stages[stages.length - 1];
    return (
      stages.some((stage) => stage.fromPct === 0) && last?.sprite === manifest.sprite && last.toPct === 100
    );
  }, 'Construction must start at zero and finish with the delivered sprite at 100');
export type CustomBuildingManifest = z.infer<typeof customBuildingManifest>;
export type CustomBuildingOverlay = z.infer<typeof overlay>;
