import { z } from 'zod';

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const pngName = z.string().regex(/^[a-zA-Z0-9_-]+\.png$/);
const constructionStage = z
  .object({
    sprite: pngName,
    timeMask: pngName,
    fromPct: z.number().int().min(0).max(99),
    toPct: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((stage) => stage.fromPct < stage.toPct, 'Construction window must increase');
export const ownBuildingManifest = z
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
export type OwnBuildingManifest = z.infer<typeof ownBuildingManifest>;
