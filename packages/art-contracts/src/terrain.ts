import { z } from 'zod';
export const materialSchema = z
  .object({
    id: z.string().min(1),
    image: z.enum(['quiet.png', 'dark.png', 'soil.png', 'gravel.png', 'mountains.png', 'sand.png']),
    layout: z.literal('mountain').optional(),
    sampling: z.literal('patches').optional(),
    tint: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    wear: z.number().min(0).max(1),
    pages: z.array(z.string()),
    names: z.array(z.string()),
    transitions: z.array(z.string()),
  })
  .strict();

export type OwnTerrainMaterial = z.infer<typeof materialSchema>;

export const terrainMaterialsSchema = z
  .object({ sourceBasis: z.string(), materials: z.array(materialSchema) })
  .strict();
export const grassBindingsSchema = z
  .object({
    sourceBasis: z.string(),
    pages: z.array(z.object({ source: z.string(), extent: z.number().positive() }).strict()),
  })
  .strict();
