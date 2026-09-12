import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  grassBindingsSchema,
  ownBuildingManifest,
  ownCharacterJobSelection,
  ownCharacterManifest,
  ownCharacterSelection,
  ownPropManifest,
  terrainMaterialsSchema,
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
  for (const file of files.filter((f) => f.endsWith('/runtime.json'))) {
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
      if (m.kind === 'stump') claim(identities, 'stump');
      await inspect(`${folder}/${m.image}`, m.width, m.height, true);
    } else if (file.startsWith('characters/')) {
      const m = ownCharacterManifest.parse(raw);
      claim(identities, `character:${m.id}`);
      if (folder !== `characters/${m.id}`) throw new Error('Character folder and id disagree');
      await inspect(`${folder}/atlas.png`, m.width, m.height, true);
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
  for (const file of files) {
    if (file.startsWith('terrain/')) {
      if (file.endsWith('.png')) {
        const metadata = await sharp(join(directory, file)).metadata();
        if (metadata.format !== 'png') throw new Error(`Invalid terrain PNG: ${file}`);
      } else if (file.endsWith('.json')) {
        const raw = await json(join(directory, file));
        if (file === 'terrain/map-bindings.json') grassBindingsSchema.parse(raw);
        else {
          const pack = terrainMaterialsSchema.parse(raw);
          for (const material of pack.materials) {
            if (complete && !available.has(`terrain/${material.image}`))
              throw new Error(`Missing terrain material image: ${material.image}`);
            claim(identities, `material:${material.id}`);
            for (const page of material.pages) claim(names, `terrain-page:${page}`);
            for (const name of material.names) claim(names, `terrain-name:${name}`);
            for (const transition of material.transitions) claim(names, `terrain-transition:${transition}`);
          }
        }
      } else throw new Error(`Unexpected terrain file: ${file}`);
    } else if (!used.has(file)) throw new Error(`Unreferenced delivery file: ${file}`);
  }
  return { files: files.length, bindings: identities.size };
}
