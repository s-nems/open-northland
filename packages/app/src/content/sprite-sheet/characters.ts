import type { ByJobTable, SettlerCharacter, SettlerCharacterSet } from '@open-northland/render';
import { ANIMAL_BODY_IMAGELIB } from '../../catalog/animal-roster.js';
import { BYZANTINE_SPEAR_VARIANTS } from '../../catalog/unit-variants.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { bodySequences, humanSequences, playableSequences, sequencesFor } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import { type GoodRef, isAnimalBody } from '../settler-gfx/index.js';
import { loadLookLayers, resolveAnimalJobLooks, resolveLooks } from './character-looks.js';
import { type TribeCharacterInputs, tribeAtomicPrograms, tribeCharacters } from './tribe-characters.js';
import { withPlayableCharacters } from './unit-variants.js';

/**
 * Load the per-job {@link SettlerCharacterSet} for every civilization in `tribes`, the first of which is
 * the base. Each composes the same character specs from its own `[jobbasegraphics]` bobs and its own
 * animation programs, and fills what it does not author from the base table. A head that 404s is skipped
 * and a body that 404s or does not bind advances the look's chain. Returns `undefined`, degrading the
 * sheet to the single-body settler path, when the IR carries no sequences or the base tribe cannot be
 * built.
 */
export async function loadCharacters(
  ir: ContentIr | null,
  goods: readonly GoodRef[],
  /** The skin every bob set loads in, or `undefined` to keep each record's own authored one. */
  palette: string | undefined,
  tribes: WorldTribes,
): Promise<SettlerCharacterSet | undefined> {
  if (ir?.bobSequences === undefined || ir.bobSequences.length === 0) return undefined;

  const looksByTribe = resolveLooks(ir, tribes, palette);
  const animalJobsByTribe = resolveAnimalJobLooks(ir, tribes);
  const looks = [
    ...[...looksByTribe.values()].flatMap((bySpec) => [...bySpec.values()].flat()),
    ...[...animalJobsByTribe.values()].flatMap((byJob) => [...byJob.values()].flat()),
  ];
  const layersByBody = await loadLookLayers(looks);
  const bmdByStem = new Map(looks.map((look) => [look.bodyStem, look.bodyBmd]));
  const sequences = humanSequences(ir);
  // An animal body plays the animal bob set's own table.
  const animalSequences = sequencesFor(ir, ANIMAL_BODY_IMAGELIB);
  const sequencesByBody = new Map(
    [...layersByBody].map(([stem, layers]) => [
      stem,
      isAnimalBody(stem)
        ? playableSequences(animalSequences, layers.body.atlas)
        : bodySequences(ir, bmdByStem.get(stem) ?? stem, layers.body.atlas),
    ]),
  );

  const basePrograms = tribeAtomicPrograms(ir, tribes[0]);
  const inputsFor = (tribe: number): TribeCharacterInputs => ({
    looks: looksByTribe.get(tribe) ?? new Map(),
    animalJobs: animalJobsByTribe.get(tribe) ?? new Map(),
    layersByBody,
    sequencesByBody,
    sequences,
    basePrograms,
  });
  const baseTable = tribeCharacters(ir, goods, tribes[0], inputsFor(tribes[0]));
  if (baseTable === undefined) return undefined;
  const byTribe: Record<number, ByJobTable<SettlerCharacter>> = { [tribes[0]]: baseTable };
  for (const tribe of tribes.slice(1)) {
    const table = tribeCharacters(ir, goods, tribe, inputsFor(tribe), baseTable);
    if (table !== undefined) byTribe[tribe] = table;
  }
  const byzantine = byTribe[3];
  if (byzantine !== undefined) byTribe[3] = withPlayableCharacters(byzantine, BYZANTINE_SPEAR_VARIANTS);
  return { ...(byTribe[tribes[0]] ?? baseTable), byTribe };
}
