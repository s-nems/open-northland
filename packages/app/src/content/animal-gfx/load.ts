import type { SettlerCharacter, SettlerCharacterSet } from '@open-northland/render';
import {
  ANIMAL_BODY_IMAGELIB,
  ANIMAL_PALETTE_BY_TRIBE,
  ANIMAL_SHADOW_STEM,
  animalBodyStem,
} from '../../catalog/animal-roster.js';
import { diag } from '../../diag/index.js';
import { sequencesFor } from '../ir/joins.js';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import { animalBinding } from './bindings.js';

/**
 * Load the wildlife species looks: every IR animal-record tribe whose roster recolour atlas and sequences
 * resolve gets a body + binding, and the rest stay listed but unbound (the resolution contract lives on
 * {@link SettlerCharacterSet.animals}). `undefined` when the IR carries no animal records at all, keeping
 * the sheet's human-only shape.
 */
export async function loadAnimalCharacters(
  ir: ContentIr | null,
): Promise<NonNullable<SettlerCharacterSet['animals']> | undefined> {
  const tribes = new Set<number>();
  for (const a of ir?.animals ?? []) {
    if (typeof a.tribeType === 'number') tribes.add(a.tribeType);
  }
  if (tribes.size === 0) return undefined;

  // One load per distinct recolour: bear01 serves bears and camels. A missing atlas drops the palette's
  // tribes to unbound; a real decode failure still propagates.
  const stems = new Map<string, Promise<Awaited<ReturnType<typeof loadLayer>> | undefined>>();
  for (const tribe of tribes) {
    const palette = ANIMAL_PALETTE_BY_TRIBE.get(tribe);
    if (palette === undefined || stems.has(animalBodyStem(palette))) continue;
    stems.set(
      animalBodyStem(palette),
      loadLayer(animalBodyStem(palette), ANIMAL_SHADOW_STEM).catch((err: unknown) => {
        if (err instanceof MissingAtlasError) return undefined;
        throw err;
      }),
    );
  }
  const layersByStem = new Map(
    await Promise.all([...stems].map(async ([stem, load]) => [stem, await load] as const)),
  );

  const seqByName = sequencesFor(ir, ANIMAL_BODY_IMAGELIB);
  const byTribe: Record<number, SettlerCharacter> = {};
  const unbound: number[] = [];
  for (const tribe of [...tribes].sort((a, b) => a - b)) {
    const palette = ANIMAL_PALETTE_BY_TRIBE.get(tribe);
    const body = palette !== undefined ? layersByStem.get(animalBodyStem(palette)) : undefined;
    const binding = body !== undefined ? animalBinding(ir, tribe, seqByName) : null;
    if (body === undefined || binding === null) {
      // A species the source gives no roster look draws as nothing by design; only a look that failed
      // to resolve is a content fault.
      if (palette !== undefined) unbound.push(tribe);
      continue;
    }
    byTribe[tribe] = { body, binding };
  }
  if (unbound.length > 0) {
    const slugById = new Map((ir?.tribes ?? []).map((t) => [t.typeId, t.id]));
    diag.warn(
      'content',
      `animal looks failed to resolve (drawn as nothing): ${unbound.map((t) => slugById.get(t) ?? `tribe ${t}`).join(', ')}`,
    );
  }
  return { byTribe, tribes };
}
