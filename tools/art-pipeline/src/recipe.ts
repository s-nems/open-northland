import { z } from 'zod';
import { atlasRecipe } from './atlas-recipe.js';
import { assetId, relativePath } from './recipe-fields.js';

export { assetId, relativePath } from './recipe-fields.js';

const rect = z.tuple([
  z.number().nonnegative(),
  z.number().nonnegative(),
  z.number().positive(),
  z.number().positive(),
]);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const draw = z
  .object({
    source: relativePath,
    crop: rect.optional(),
    alphaBounds: z.boolean().default(false),
    reference: relativePath.optional(),
    box: rect,
    fit: z.enum(['stretch', 'contain']).default('stretch'),
    align: z.enum(['start', 'center', 'bottom']).default('start'),
    round: z.boolean().default(false),
    frameAnchor: point.optional(),
  })
  .strict();
export const raster = z
  .object({
    operation: z.literal('raster'),
    sampling: z.enum(['canvas-high', 'lanczos3']).default('canvas-high'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    draws: z.array(draw).nonempty(),
    alpha: z.enum(['transparent', 'opaque', 'any']),
  })
  .strict();
export const output = z
  .object({
    path: relativePath,
    content: z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('copy'), source: relativePath }).strict(),
      z
        .object({
          operation: z.literal('json'),
          value: z.record(z.string(), z.unknown()),
          framesFrom: relativePath.optional(),
        })
        .strict(),
      raster,
      z
        .object({
          operation: z.literal('character'),
          source: relativePath,
          id: assetId,
          name: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();
export const recipeSchema = z
  .object({
    version: z.literal(1),
    id: assetId,
    kind: z.enum(['building', 'props', 'terrain', 'character']),
    sourceBasis: z.string().min(1),
    outputs: z.array(output).default([]),
    atlas: atlasRecipe.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.outputs.length && !value.atlas)
      ctx.addIssue({ code: 'custom', message: 'Recipe needs outputs or an atlas' });
    if (value.atlas && value.kind !== 'props')
      ctx.addIssue({ code: 'custom', message: 'Atlas recipes deliver props' });
    const paths = new Set<string>();
    for (const file of value.outputs) {
      if (paths.has(file.path)) ctx.addIssue({ code: 'custom', message: `Duplicate output: ${file.path}` });
      paths.add(file.path);
      if (file.content.operation === 'character') {
        const folder = `characters/${file.content.id}`;
        if (file.path !== `${folder}/atlas.png`)
          ctx.addIssue({ code: 'custom', message: 'Character output must be characters/<id>/atlas.png' });
        const manifest = value.outputs.find((output) => output.path === `${folder}/runtime.json`)?.content;
        if (
          manifest?.operation !== 'json' ||
          manifest.framesFrom !== undefined ||
          Object.keys(manifest.value).length !== 0
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Generated character needs an empty JSON runtime manifest',
          });
      }
    }
  });
export const catalogSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(z.object({ id: assetId, recipe: relativePath }).strict()),
  })
  .strict()
  .refine((c) => new Set(c.assets.map((a) => a.id)).size === c.assets.length, 'Duplicate asset id');
export type Recipe = z.infer<typeof recipeSchema>;
export type Raster = z.infer<typeof raster>;
