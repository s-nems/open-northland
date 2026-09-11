import { posix } from 'node:path';

export const ownArtRoot = 'packages/app/src/assets/own/';

function relativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.startsWith('/') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

export function ownArtPolicy(catalog, delivery, sharedSources, readJson, isTracked) {
  if (catalog.version !== 1 || !Array.isArray(catalog.assets)) throw new Error('Invalid art catalog');
  const ids = new Set();
  const sourceRoots = new Set();
  for (const entry of catalog.assets) {
    if (!relativePath(entry.id) || ids.has(entry.id)) throw new Error(`Invalid art id: ${entry.id}`);
    ids.add(entry.id);
    if (
      !relativePath(entry.recipe) ||
      !entry.recipe.startsWith('docs/art/') ||
      !entry.recipe.endsWith('/asset.json') ||
      !isTracked(entry.recipe)
    )
      throw new Error(`Invalid art recipe: ${entry.recipe}`);
    const recipe = readJson(entry.recipe);
    if (recipe.id !== entry.id || typeof recipe.sourceBasis !== 'string' || !recipe.sourceBasis.trim())
      throw new Error(`Missing source basis or mismatched id: ${entry.recipe}`);
    const directory = posix.dirname(entry.recipe);
    if (directory.split('/').length < 4) throw new Error(`Source root too broad: ${directory}`);
    sourceRoots.add(`${directory}/`);
  }
  for (const source of sharedSources) {
    if (
      !relativePath(source.directory) ||
      !source.directory.startsWith('docs/art/') ||
      source.directory.split('/').length < 5 ||
      !relativePath(source.provenance) ||
      !source.provenance.startsWith(`${source.directory}/`) ||
      !isTracked(source.provenance)
    )
      throw new Error(`Invalid shared art source: ${source.directory}`);
    sourceRoots.add(`${source.directory}/`);
  }
  const outputs = new Set();
  for (const [id, files] of Object.entries(delivery)) {
    if (!ids.has(id) || !Array.isArray(files)) throw new Error(`Unknown delivery owner: ${id}`);
    for (const file of files) {
      const path = `${ownArtRoot}${file}`;
      if (!relativePath(file) || outputs.has(path) || !isTracked(path))
        throw new Error(`Invalid, duplicate or missing art output: ${file}`);
      outputs.add(path);
    }
  }
  return (file) => outputs.has(file) || [...sourceRoots].some((root) => file.startsWith(root));
}
