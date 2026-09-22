import { z } from 'zod';

const propFrame = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    anchor: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
  })
  .strict();

export const customPropManifest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    kind: z.enum(['resource', 'stump', 'decor', 'flag']),
    image: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    anchor: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
    scale: z.number().finite().positive(),
    brightness: z.number().positive().max(1).optional(),
    sway: z.number().finite().positive().max(0.02).optional(),
    frames: z.array(propFrame).nonempty().optional(),
    editNames: z.array(z.string().min(1)).nonempty(),
    sourceBasis: z.string().min(1),
  })
  .strict()
  .refine((m) => m.anchor.x <= m.width && m.anchor.y <= m.height, 'Anchor outside sprite')
  .refine((m) => m.kind !== 'flag' || m.frames !== undefined, 'A flag needs its wave frames')
  .refine(
    (m) =>
      m.frames?.every(
        (f) =>
          f.x + f.width <= m.width &&
          f.y + f.height <= m.height &&
          f.anchor.x <= f.width &&
          f.anchor.y <= f.height,
      ) ?? true,
    'Frame outside atlas',
  );

export type CustomPropManifest = z.infer<typeof customPropManifest>;
