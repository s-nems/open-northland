import { z } from 'zod';

const image = z
  .object({
    file: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

/** A row-major grid of equal square cells; `names` lists the occupied cells in order. */
const iconAtlas = image
  .extend({
    cell: z.number().int().positive(),
    columns: z.number().int().positive(),
    names: z.array(z.string().regex(/^[a-z0-9-]+$/)).nonempty(),
  })
  .strict()
  .refine(
    (a) =>
      a.columns * a.cell <= a.width &&
      Math.ceil(a.names.length / a.columns) * a.cell <= a.height &&
      new Set(a.names).size === a.names.length,
    'Icon cells outside the atlas or duplicate names',
  );

/** HUD chrome pack: the leather/wood surface texture and the painted action-icon atlas. */
export const ownUiManifest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    surface: image,
    icons: iconAtlas,
    sourceBasis: z.string().min(1),
  })
  .strict();

export type OwnUiManifest = z.infer<typeof ownUiManifest>;
