import { groupedBy, indexesOf, type WorldSnapshot } from '@open-northland/sim';
import { readNumField } from '../snapshot/index.js';
import { readOwnerPlayer } from './snapshot-readers/index.js';

const FLAG_HOLDERS = groupedBy(
  (entity) =>
    readNumField(entity.components, 'WorkFlag', 'flag') ??
    readNumField(entity.components, 'HaulFlag', 'flag'),
  'render flag holders',
  { values: ['WorkFlag', 'HaulFlag'] },
);

/** The barracks flags: each `RallyPoint` building keyed by the `DeliveryFlag` marker it planted. */
const RALLY_FLAGS = groupedBy(
  (entity) => readNumField(entity.components, 'RallyPoint', 'flag'),
  'render rally flags',
  { values: ['RallyPoint'] },
);

export function flagHoldersOf(snapshot: WorldSnapshot) {
  return indexesOf(snapshot).get(FLAG_HOLDERS);
}

/** Markers carry no owner; their worker's current owner supplies the colour. */
export function flagOwnerOf(snapshot: WorldSnapshot, flag: number): number | undefined {
  const holder = flagHoldersOf(snapshot).get(flag)?.at(-1);
  return holder === undefined ? undefined : readOwnerPlayer(holder.components);
}

/** Whether `flag` is a barracks' rally marker, which draws over the units standing on it; the owner's
 *  visibility rule keeps it hidden from every other seat and off its owner's until the barracks is
 *  selected (`app`'s `foreign-flags.ts`). */
export function isRallyFlagOf(snapshot: WorldSnapshot, flag: number): boolean {
  return indexesOf(snapshot).get(RALLY_FLAGS).get(flag) !== undefined;
}
