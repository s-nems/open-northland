import { dirname, join } from 'node:path';
import { atlasOutputs } from './atlas.js';
import { json } from './files.js';
import { sourcePath } from './paths.js';
import { catalogSchema, recipeSchema } from './recipe.js';
export async function loadAsset(root: string, id: string) {
  const catalog = catalogSchema.parse(await json(join(root, 'docs/art/assets.json')));
  const entry = catalog.assets.find((a) => a.id === id);
  if (!entry) throw new Error(`Unknown asset: ${id}`);
  const path = await sourcePath(root, root, entry.recipe);
  const authored = recipeSchema.parse(await json(path));
  const recipe = recipeSchema.parse({
    ...authored,
    outputs: [
      ...(authored.atlas ? atlasOutputs(authored.atlas, authored.sourceBasis) : []),
      ...authored.outputs,
    ],
  });
  if (recipe.id !== id) throw new Error('Catalog and recipe id disagree');
  const prefix = {
    building: 'buildings/',
    props: 'props/',
    terrain: 'terrain/',
    character: 'characters/',
    goods: 'goods/',
  }[recipe.kind];
  if (recipe.outputs.some((o) => !o.path.startsWith(prefix))) throw new Error('Output outside asset kind');
  return { recipe, path, directory: dirname(path) };
}
