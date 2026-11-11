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

export function flagHoldersOf(snapshot: WorldSnapshot) {
  return indexesOf(snapshot).get(FLAG_HOLDERS);
}

/** Markers carry no owner; their worker's current owner supplies the colour. */
export function flagOwnerOf(snapshot: WorldSnapshot, flag: number): number | undefined {
  const holder = flagHoldersOf(snapshot).get(flag)?.at(-1);
  return holder === undefined ? undefined : readOwnerPlayer(holder.components);
}
