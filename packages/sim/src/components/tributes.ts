import type { DeepReadonly, World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';

/** The tribute table's slot count (reading); the corpus addresses slots 0 to 39. */
export const TRIBUTE_SLOTS = 44;
/** The most distinct goods one slot demands (reading); a further kind is dropped. */
export const TRIBUTE_DEMAND_KINDS = 5;

export interface TributeDemand {
  good: number;
  amount: number;
}

/** One slot of the map script's tribute table: what a `CreateTribute` opened and its `AddTributeGoods`
 *  lines ask for. A payment marks the slot paid and leaves the demands as they were listed. */
export interface TributeSlot {
  /** Cleared by `ClearTribute`: a closed slot keeps its data, lists nowhere and holds no goal. */
  active: boolean;
  /** Set on opening and by a payment, cleared by every demand added. */
  paid: boolean;
  payer: number;
  receiver: number;
  /** The description's id in the map's own string table. */
  stringId: number;
  /** Distinct goods in the order the script added them. */
  demands: TributeDemand[];
}

const tributes = defineWorldSingleton<{ slots: Map<number, TributeSlot> }>('Tributes', () => ({
  slots: new Map(),
}));

/** Keyed by slot; only a slot some `CreateTribute` opened is present. */
export const Tributes = tributes.component;

export function isTributeSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < TRIBUTE_SLOTS;
}

export function tributeSlot(world: World, slot: number): DeepReadonly<TributeSlot> | undefined {
  return tributes.read(world).slots.get(slot);
}

/** Open `slot` from `payer` to `receiver`, paid and with nothing demanded yet, over whatever it held. */
export function createTribute(
  world: World,
  slot: number,
  payer: number,
  receiver: number,
  stringId: number,
): void {
  tributes.write(world, (table) => {
    table.slots.set(slot, { active: true, paid: true, payer, receiver, stringId, demands: [] });
  });
}

export type TributeDemandOutcome = 'added' | 'closed' | 'full';

/** Ask for `amount` more of `good` on an open slot, which becomes unpaid: an existing demand for the
 *  good grows, and a new good takes a demand while the slot has fewer than {@link TRIBUTE_DEMAND_KINDS}. */
export function addTributeDemand(
  world: World,
  slot: number,
  good: number,
  amount: number,
): TributeDemandOutcome {
  const held = tributeSlot(world, slot);
  if (held === undefined || !held.active) return 'closed';
  if (!held.demands.some((d) => d.good === good) && held.demands.length >= TRIBUTE_DEMAND_KINDS) {
    return 'full';
  }
  tributes.write(world, (table) => {
    const live = table.slots.get(slot);
    if (live === undefined) return;
    const demand = live.demands.find((d) => d.good === good);
    if (demand === undefined) live.demands.push({ good, amount });
    else demand.amount += amount;
    live.paid = false;
  });
  return 'added';
}

export function closeTribute(world: World, slot: number): void {
  if (tributeSlot(world, slot)?.active !== true) return;
  tributes.write(world, (table) => {
    const live = table.slots.get(slot);
    if (live !== undefined) live.active = false;
  });
}

export function markTributePaid(world: World, slot: number): void {
  const held = tributeSlot(world, slot);
  if (held === undefined || held.paid) return;
  tributes.write(world, (table) => {
    const live = table.slots.get(slot);
    if (live !== undefined) live.paid = true;
  });
}

/** Whether `PayTribute` holds: the slot is open and paid. */
export function tributePaid(world: World, slot: number): boolean {
  const held = tributeSlot(world, slot);
  if (held === undefined) return false;
  return held.active && held.paid;
}

export interface UnpaidTribute {
  readonly slot: number;
  readonly tribute: DeepReadonly<TributeSlot>;
}

/** The open, unpaid slots `payer` owes, ascending by slot. */
export function unpaidTributes(world: World, payer: number): UnpaidTribute[] {
  const unpaid: UnpaidTribute[] = [];
  for (const [slot, tribute] of tributes.read(world).slots) {
    if (tribute.active && !tribute.paid && tribute.payer === payer) unpaid.push({ slot, tribute });
  }
  return unpaid.sort((a, b) => a.slot - b.slot);
}
