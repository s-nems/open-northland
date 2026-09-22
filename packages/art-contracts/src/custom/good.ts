import { z } from 'zod';

const frame = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    anchor: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
  })
  .strict();

export const customGoodManifest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    image: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    scale: z.number().finite().positive(),
    frames: z.array(frame).length(6),
    sourceBasis: z.string().min(1),
  })
  .strict()
  .refine(
    (m) =>
      m.frames.every(
        (f) =>
          f.x + f.width <= m.width &&
          f.y + f.height <= m.height &&
          f.anchor.x <= f.width &&
          f.anchor.y <= f.height,
      ),
    'Frame or anchor outside atlas',
  );

/** Frames 0–4 represent quantities 1–5; frame 5 is the independently painted UI icon. */
export type CustomGoodManifest = z.infer<typeof customGoodManifest>;
