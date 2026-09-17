import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  collectTerrainMaterials,
  grassBindingsSchema,
  ownBuildingManifest,
  ownCharacterJobSelection,
  ownCharacterManifest,
  ownCharacterSelection,
  ownGoodManifest,
  ownPropManifest,
  ownUiManifest,
} from '@open-northland/art-contracts';
import sharp from 'sharp';
import { json, listFiles } from './files.js';

export async function validateDelivery(directory: string, complete = false) {
  const files = await listFiles(directory),
    available = new Set(files),
    used = new Set<string>();
  const identities = new Set<string>(),
    layers = new Set<string>(),
    names = new Set<string>();
  const claim = (set: Set<string>, key: string) => {
    if (set.has(key)) throw new Error(`Duplicate binding: ${key}`);
    set.add(key);
  };
  // `stats()` reads the input image, so a region is materialised first; otherwise an empty cell
  // inherits the whole image's alpha maximum and the emptiness checks below never fire.
  const regionEmpty = async (
    file: string,
    region: { left: number; top: number; width: number; height: number },
  ): Promise<boolean> => {
    const cell = await sharp(join(directory, file)).extract(region).toBuffer();
    const stats = await sharp(cell).ensureAlpha().stats();
    return stats.channels[3]?.max === 0;
  };
  const inspect = async (file: string, width: number, height: number, transparent: boolean) => {
    if (!available.has(file)) throw new Error(`Missing image: ${file}`);
    used.add(file);
    const bytes = await readFile(join(directory, file));
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height)
      throw new Error(`Image dimensions disagree: ${file}`);
    const stats = await sharp(bytes).ensureAlpha().stats();
    const alpha = stats.channels[3];
    if (transparent && (!metadata.hasAlpha || !alpha || alpha.min !== 0 || alpha.max === 0))
      throw new Error(`Missing visible sprite or genuine alpha: ${file}`);
  };
  for (const file of files.filter((f) => !f.startsWith('terrain/') && f.endsWith('/runtime.json'))) {
    const raw = await json(join(directory, file)),
      folder = dirname(file);
    used.add(file);
    if (file.startsWith('buildings/')) {
      const m = ownBuildingManifest.parse(raw);
      claim(identities, `building:${m.tribeId}:${m.typeId}`);
      claim(layers, m.layer);
      if (
        m.entrancePixel.x < 0 ||
        m.entrancePixel.x > m.width ||
        m.entrancePixel.y < 0 ||
        m.entrancePixel.y > m.height
      )
        throw new Error('Entrance outside building image');
      await inspect(`${folder}/${m.sprite}`, m.width, m.height, true);
      if (m.shadow) {
        await inspect(`${folder}/${m.shadow.sprite}`, m.shadow.width, m.shadow.height, true);
      }
      if (m.overlay) {
        claim(layers, `${m.layer}-overlay`);
        const { frameWidth, frameHeight, frames, columns } = m.overlay;
        const sheet = `${folder}/${m.overlay.sprite}`;
        await inspect(sheet, frameWidth * columns, frameHeight * Math.ceil(frames / columns), true);
        for (const index of new Set([m.overlay.idle, ...m.overlay.working])) {
          const empty = await regionEmpty(sheet, {
            left: (index % columns) * frameWidth,
            top: Math.floor(index / columns) * frameHeight,
            width: frameWidth,
            height: frameHeight,
          });
          if (empty) throw new Error(`Empty overlay frame: ${m.layer}:${index}`);
        }
      }
      for (const [i, s] of (m.construction ?? []).entries()) {
        claim(layers, `${m.layer}-construction-${i}`);
        await inspect(`${folder}/${s.sprite}`, m.width, m.height, true);
        await inspect(`${folder}/${s.timeMask}`, m.width, m.height, false);
      }
    } else if (file.startsWith('props/')) {
      const m = ownPropManifest.parse(raw);
      claim(identities, `prop:${m.id}`);
      if (folder !== `props/${m.id}`) throw new Error('Prop folder and id disagree');
      for (const name of m.editNames) claim(names, name);
      if (m.kind === 'stump' || m.kind === 'flag') claim(identities, m.kind);
      await inspect(`${folder}/${m.image}`, m.width, m.height, true);
    } else if (file.startsWith('goods/')) {
      const m = ownGoodManifest.parse(raw);
      claim(identities, `good:${m.id}`);
      if (folder !== `goods/${m.id}`) throw new Error('Good folder and id disagree');
      await inspect(`${folder}/${m.image}`, m.width, m.height, true);
      for (const [index, frame] of m.frames.entries()) {
        const empty = await regionEmpty(`${folder}/${m.image}`, {
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
        });
        if (empty) throw new Error(`Empty good frame: ${m.id}:${index}`);
      }
    } else if (file.startsWith('ui/')) {
      const m = ownUiManifest.parse(raw);
      claim(identities, `ui:${m.id}`);
      if (folder !== `ui/${m.id}`) throw new Error('UI pack folder and id disagree');
      await inspect(`${folder}/${m.surface.file}`, m.surface.width, m.surface.height, false);
      await inspect(`${folder}/${m.icons.file}`, m.icons.width, m.icons.height, true);
      for (const [index, name] of m.icons.names.entries()) {
        const empty = await regionEmpty(`${folder}/${m.icons.file}`, {
          left: (index % m.icons.columns) * m.icons.cell,
          top: Math.floor(index / m.icons.columns) * m.icons.cell,
          width: m.icons.cell,
          height: m.icons.cell,
        });
        if (empty) throw new Error(`Empty icon cell: ${m.id}:${name}`);
      }
    } else if (file.startsWith('characters/')) {
      const m = ownCharacterManifest.parse(raw);
      claim(identities, `character:${m.id}`);
      if (folder !== `characters/${m.id}`) throw new Error('Character folder and id disagree');
      await inspect(`${folder}/atlas.png`, m.width, m.height, true);
      if (m.shadow) await inspect(`${folder}/${m.shadow.sprite}`, m.shadow.width, m.shadow.height, true);
    } else throw new Error(`Unknown manifest: ${file}`);
  }
  for (const name of ['selection.json', 'job-selection.json']) {
    const path = `characters/${name}`;
    if (!available.has(path)) continue;
    const raw = await json(join(directory, path));
    const selected =
      name === 'selection.json'
        ? ownCharacterSelection.parse(raw)
        : Object.values(ownCharacterJobSelection.parse(raw));
    if (complete)
      for (const id of selected)
        if (!identities.has(`character:${id}`)) throw new Error(`Selected character is missing: ${id}`);
    used.add(path);
  }
  const terrainManifests: unknown[] = [];
  for (const file of files) {
    if (file.startsWith('terrain/')) {
      if (dirname(file) !== 'terrain') throw new Error(`Terrain files must be flat: ${file}`);
      if (file.endsWith('.png')) {
        const metadata = await sharp(join(directory, file)).metadata();
        if (metadata.format !== 'png') throw new Error(`Invalid terrain PNG: ${file}`);
      } else if (file.endsWith('.json')) {
        const raw = await json(join(directory, file));
        if (file === 'terrain/map-bindings.json') grassBindingsSchema.parse(raw);
        else terrainManifests.push(raw);
      } else throw new Error(`Unexpected terrain file: ${file}`);
    } else if (!used.has(file)) throw new Error(`Unreferenced delivery file: ${file}`);
  }
  const materials = collectTerrainMaterials(
    terrainManifests,
    complete
      ? new Set(files.filter((file) => file.startsWith('terrain/')).map((file) => file.slice(8)))
      : undefined,
  );
  for (const material of materials) identities.add(`material:${material.id}`);
  return { files: files.length, bindings: identities.size };
}
