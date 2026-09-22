import { z } from 'zod';
export const materialSchema = z
  .object({
    id: z.string().min(1),
    image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/),
    layout: z.literal('mountain').optional(),
    sampling: z.literal('patches').optional(),
    tint: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    wear: z.number().min(0).max(1),
    pages: z.array(z.string()),
    names: z.array(z.string()),
    transitions: z.array(z.string()),
  })
  .strict();

export type CustomTerrainMaterial = z.infer<typeof materialSchema>;

export const terrainMaterialsSchema = z
  .object({ sourceBasis: z.string(), materials: z.array(materialSchema) })
  .strict();
export const grassBindingsSchema = z
  .object({
    sourceBasis: z.string(),
    pages: z.array(z.object({ source: z.string(), extent: z.number().positive() }).strict()),
  })
  .strict();

export function collectTerrainMaterials(
  manifests: readonly unknown[],
  images?: ReadonlySet<string>,
): CustomTerrainMaterial[] {
  const materials = manifests.flatMap((manifest) => terrainMaterialsSchema.parse(manifest).materials);
  const bindings = new Set<string>();
  for (const material of materials) {
    for (const key of [
      `material:${material.id}`,
      ...material.pages.map((page) => `terrain-page:${page}`),
      ...material.names.map((name) => `terrain-name:${name}`),
      ...material.transitions.map((name) => `terrain-transition:${name}`),
    ]) {
      if (bindings.has(key)) throw new Error(`Duplicate binding: ${key}`);
      bindings.add(key);
    }
    if (images && !images.has(material.image))
      throw new Error(`Missing terrain material image: ${material.image}`);
  }
  return materials;
}
