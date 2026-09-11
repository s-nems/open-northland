import { z } from 'zod';
import { assetId, relativePath } from './recipe-fields.js';

const size = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const cell = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().positive(),
  z.number().int().positive(),
]);
const point = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict();
const root = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const identity = {
  id: assetId.refine((v) => !v.includes('/'), 'Sprite id cannot contain slashes'),
  editNames: z.array(z.string().min(1)).nonempty(),
};
const sampling = z.enum(['canvas-high', 'lanczos3']).default('canvas-high');
const common = { sampling, scale: z.number().positive() };
export const atlasRecipe = z.discriminatedUnion('type', [
  z
    .object({
      ...common,
      type: z.literal('vegetation'),
      source: relativePath,
      fit: z.enum(['anchor', 'frame', 'contain', 'frame-contain']),
      props: z
        .array(
          z
            .object({
              ...identity,
              cell,
              size,
              anchor: point,
              brightness: z.number().positive().max(1).optional(),
            })
            .strict(),
        )
        .nonempty(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('trees'),
      source: relativePath,
      canvas: size,
      stride: z.number().int().positive(),
      padding: z.number().int().nonnegative(),
      props: z
        .array(
          z
            .object({
              ...identity,
              cell,
              states: z.array(size).nonempty(),
              root,
              sway: z.number().positive().max(0.02),
            })
            .strict(),
        )
        .nonempty(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('rocks'),
      sources: z.object({ dark: relativePath, light: relativePath }).strict(),
      cells: z.array(cell).nonempty(),
      stride: z.number().int().positive(),
      height: z.number().int().positive(),
      padding: z.number().int().nonnegative(),
      minimumFill: z.number().positive().max(1),
      restCells: z.array(z.number().int().nonnegative()).nonempty(),
      root,
      props: z
        .array(
          z
            .object({
              ...identity,
              cell: z.number().int().nonnegative(),
              size,
              states: z.number().int().positive(),
              kind: z.enum(['resource', 'decor']),
              palette: z.enum(['dark', 'light']),
            })
            .strict(),
        )
        .nonempty(),
    })
    .strict(),
]);
export type AtlasRecipe = z.infer<typeof atlasRecipe>;
