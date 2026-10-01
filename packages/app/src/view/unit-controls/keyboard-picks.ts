import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { type Entity, type PlayerCommand, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  isBoundByMarriage,
  isMarrying,
  isWildlife,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  settlersOwnedBy,
} from '../../game/snapshot.js';
import { ownedBuildingsOfType } from '../../hud/details-panel/model/building.js';
import type { KeybindingAction } from '../../hud/keybindings.js';
import { residentKindOf } from '../../hud/tool-panel/residents/projection.js';

/** The keys that pick the player's settlers off the whole map or narrow the selection to a kind. */
export const SELECTION_KEY_ACTIONS = [
  'nextCivilian',
  'nextScout',
  'nextSingleWoman',
  'selectSoldiers',
  'addSoldiers',
  'selectHeroes',
  'keepHeroes',
  'keepSoldiers',
] as const satisfies readonly KeybindingAction[];

export type SelectionKeyAction = (typeof SELECTION_KEY_ACTIONS)[number];

/** What a selection key does: the ids to select, whether they join the selection, and the one settler
 *  the camera centres on. */
export interface SelectionKeyEffect {
  readonly ids: readonly number[];
  readonly add: boolean;
  readonly centre: number | null;
}

type SettlerTest = (snapshot: WorldSnapshot, ent: SnapshotEntity) => boolean;

function kindTest(content: ContentSet, kind: 'civilian' | 'soldier' | 'hero'): SettlerTest {
  return (_, ent) => residentKindOf(content, ent, settlerJobType(ent) ?? null) === kind;
}

/** Original behavior for the CnMod `/` key is a filter we could not pin down; ours is a woman with
 *  neither a home nor a husband, the one a single man can marry and house. */
function singleWomanTest(content: ContentSet): SettlerTest {
  return (snapshot, ent) =>
    residentKindOf(content, ent, settlerJobType(ent) ?? null) === 'woman' &&
    residenceHomeOf(ent) === undefined &&
    !isBoundByMarriage(snapshot, ent) &&
    !isMarrying(ent);
}

function scoutTest(content: ContentSet): SettlerTest {
  return (_, ent) =>
    residentKindOf(content, ent, settlerJobType(ent) ?? null) !== 'child' &&
    systems.isScoutJob(content, settlerJobType(ent) ?? null);
}

/** The player's people that pass `test`, whole map, ascending by id; livestock and wild animals stay out. */
function ownPeople(snapshot: WorldSnapshot, player: number, test: SettlerTest): number[] {
  const ids: number[] = [];
  for (const ent of settlersOwnedBy(snapshot, player)) {
    if (isWildlife(ent) || ent.components.Livestock !== undefined) continue;
    if (test(snapshot, ent)) ids.push(ent.id);
  }
  return ids;
}

/** The candidate after the one selected settler, wrapping; the first without a single selection. */
function nextAfter(candidates: readonly number[], selected: ReadonlySet<number>): number | undefined {
  const [only] = selected;
  if (selected.size !== 1 || only === undefined) return candidates[0];
  return candidates.find((id) => id > only) ?? candidates[0];
}

/**
 * Original behavior (CnMod 1.3.2 keys included): `.` `,` and `/` select the next civilian, scout or single
 * woman after the current one, M selects every soldier and Shift+M adds them, F selects every hero, X and Y
 * keep only the heroes or the soldiers of the selection. Ours: the next-of-kind keys also centre the
 * camera, and a key that finds nobody leaves the selection as it was. Null when nothing changes.
 */
export function selectionKeyEffect(
  action: SelectionKeyAction,
  snapshot: WorldSnapshot,
  content: ContentSet,
  player: number,
  selected: ReadonlySet<number>,
): SelectionKeyEffect | null {
  const next = (test: SettlerTest): SelectionKeyEffect | null => {
    const id = nextAfter(ownPeople(snapshot, player, test), selected);
    return id === undefined ? null : { ids: [id], add: false, centre: id };
  };
  const all = (test: SettlerTest, add: boolean): SelectionKeyEffect | null => {
    const ids = ownPeople(snapshot, player, test);
    return ids.length === 0 ? null : { ids, add, centre: null };
  };
  const keep = (test: SettlerTest): SelectionKeyEffect | null => {
    const kept = ownPeople(snapshot, player, test).filter((id) => selected.has(id));
    return kept.length === selected.size ? null : { ids: kept, add: false, centre: null };
  };
  switch (action) {
    case 'nextCivilian':
      return next(kindTest(content, 'civilian'));
    case 'nextScout':
      return next(scoutTest(content));
    case 'nextSingleWoman':
      return next(singleWomanTest(content));
    case 'selectSoldiers':
      return all(kindTest(content, 'soldier'), false);
    case 'addSoldiers':
      return all(kindTest(content, 'soldier'), true);
    case 'selectHeroes':
      return all(kindTest(content, 'hero'), false);
    case 'keepHeroes':
      return keep(kindTest(content, 'hero'));
    case 'keepSoldiers':
      return keep(kindTest(content, 'soldier'));
    default: {
      const unreachable: never = action;
      throw new Error(`unhandled selection key: ${String(unreachable)}`);
    }
  }
}

/**
 * Where the store key jumps, in order: the player's standing headquarters, then its other standing stores,
 * each ascending by id. Original behavior: it always centres on the first of them; ours steps on to the next while the
 * camera still stands where the last press put it.
 */
export function storeJumpTargets(snapshot: WorldSnapshot, content: ContentSet, player: number): number[] {
  const headquarters: number[] = [];
  const stores: number[] = [];
  for (const def of content.buildings) {
    const hq = def.id === systems.HEADQUARTERS_BUILDING_ID;
    if (!hq && def.kind !== BUILDING_KIND.storage) continue;
    for (const ent of ownedBuildingsOfType(snapshot, player, def.typeId)) {
      if (ent.components.UnderConstruction === undefined) (hq ? headquarters : stores).push(ent.id);
    }
  }
  return [...headquarters, ...stores.sort((a, b) => a - b)];
}

/**
 * The orders that switch the defence mode of every building of `player` that has one. Original behavior:
 * V and Shift+V raise and lower a player-wide defence; ours sends the per-building order to each defence
 * building not already in the asked state, so a building raises no second alarm.
 */
export function globalDefenceOrders(
  snapshot: WorldSnapshot,
  content: ContentSet,
  player: number,
  enabled: boolean,
): PlayerCommand[] {
  const orders: PlayerCommand[] = [];
  for (const def of content.buildings) {
    if ((def.shelterCapacity ?? 0) === 0) continue;
    for (const ent of ownedBuildingsOfType(snapshot, player, def.typeId)) {
      if ((ent.components.DefenceMode !== undefined) === enabled) continue;
      if (enabled && ent.components.UnderConstruction !== undefined) continue;
      orders.push({ kind: 'setDefenceMode', building: ent.id as Entity, enabled });
    }
  }
  return orders;
}
