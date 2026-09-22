import { defineComponent, type Entity, type World } from '../ecs/world.js';
import { isValidPlayer } from './ownership.js';

/**
 * The seven special-item kinds a player's papers list can hold (the original's kinds,
 * named by `misclogic` strings 180-186). `param` is the house, job or good `typeId` the paper names,
 * and 0 for the two kinds that name nothing.
 */
export const PAPER_KINDS = [
  'indulgence',
  'placeAny',
  'placeHouse',
  'placeStockedHouse',
  'buildPermit',
  'learnPermit',
  'producePermit',
] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

export interface Paper {
  readonly kind: PaperKind;
  readonly param: number;
}

/** The paper kinds a seat may spend on a placement; the rest are inert list entries. */
export const PLACING_PAPER_KINDS: ReadonlySet<PaperKind> = new Set<PaperKind>([
  'placeAny',
  'placeHouse',
  'placeStockedHouse',
]);

/** Slots per player: the original keeps a fixed 100 special-item entries. */
export const PAPER_SLOTS = 100;

/**
 * The per-player papers table: at most one carrier entity per player, created on the first paper and
 * destroyed when the last slot empties. `slots` keeps the original's slot semantics (original behavior: an
 * add takes the first empty entry, a use clears its entry), so a spent paper leaves a hole the next one
 * fills and the list order survives spending; trailing holes are trimmed.
 */
export const Papers = defineComponent<{
  /** The player slot the papers belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  slots: (Paper | null)[];
}>('Papers', 'players');

/** The {@link Papers} carrier for `player`, or null when it holds none. The lowest-id carrier wins
 *  should more than one ever exist. */
function papersEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(Papers)) {
    if (world.get(e, Papers).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

const NO_PAPERS: readonly (Paper | null)[] = [];

/** `player`'s paper slots in slot order, holes included; empty when the player holds none. */
export function playerPaperSlots(world: World, player: number): readonly (Paper | null)[] {
  const carrier = papersEntity(world, player);
  return carrier === null ? NO_PAPERS : world.get(carrier, Papers).slots;
}

function samePaper(a: Paper, b: Paper): boolean {
  return a.kind === b.kind && a.param === b.param;
}

/** Add `paper` to `player`'s first free slot. False for a slot outside `[0, MAX_PLAYERS)` or when all
 *  {@link PAPER_SLOTS} are taken. */
export function addPaper(world: World, player: number, paper: Paper): boolean {
  if (!isValidPlayer(player)) return false;
  const carrier = papersEntity(world, player);
  if (carrier === null) {
    const e = world.create();
    world.add(e, Papers, { player, slots: [{ ...paper }] });
    return true;
  }
  const slots = world.get(carrier, Papers).slots;
  const hole = slots.indexOf(null);
  if (hole === -1 && slots.length >= PAPER_SLOTS) return false;
  const live = world.mut(carrier, Papers).slots;
  if (hole === -1) live.push({ ...paper });
  else live[hole] = { ...paper };
  return true;
}

/** Spend the first slot holding `paper`. False when `player` holds no such paper. */
export function takePaper(world: World, player: number, paper: Paper): boolean {
  const carrier = papersEntity(world, player);
  if (carrier === null) return false;
  const index = world.get(carrier, Papers).slots.findIndex((s) => s !== null && samePaper(s, paper));
  if (index === -1) return false;
  const live = world.mut(carrier, Papers).slots;
  live[index] = null;
  while (live.length > 0 && live[live.length - 1] === null) live.pop();
  if (live.length === 0) world.destroy(carrier);
  return true;
}
