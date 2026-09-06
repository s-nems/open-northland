import type { ByJobTable, SettlerCharacter, SettlerCharacterSet } from '@open-northland/render';
import type { WorldTribes } from '../../game/world-tribes.js';
import { humanSequences, playableSequences } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import type { GoodRef } from '../settler-gfx/index.js';
import { loadLookLayers, resolveLooks } from './character-looks.js';
import { type TribeCharacterInputs, tribeCharacters } from './tribe-characters.js';

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
  const layersByBody = await loadLookLayers(
    [...looksByTribe.values()].flatMap((bySpec) => [...bySpec.values()].flat()),
  );
  // The `[bobseq]` name space is global across the human bodies; each body plays the subset its own bob
  // pool draws, so a name outside it falls back rather than resolving to a blank frame.
  const allSequences = humanSequences(ir);
  const sequencesByBody = new Map(
    [...layersByBody].map(([stem, layers]) => [stem, playableSequences(allSequences, layers.body.atlas)]),
  );

  const inputsFor = (tribe: number): TribeCharacterInputs => ({
    looks: looksByTribe.get(tribe) ?? new Map(),
    layersByBody,
    sequencesByBody,
  });
  const baseTable = tribeCharacters(ir, goods, tribes[0], inputsFor(tribes[0]));
  if (baseTable === undefined) return undefined;
  const byTribe: Record<number, ByJobTable<SettlerCharacter>> = { [tribes[0]]: baseTable };
  for (const tribe of tribes.slice(1)) {
    const table = tribeCharacters(ir, goods, tribe, inputsFor(tribe), baseTable);
    if (table !== undefined) byTribe[tribe] = table;
  }
  return { ...baseTable, byTribe };
}
