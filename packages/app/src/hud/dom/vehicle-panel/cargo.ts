import type { VehicleCargoRow, VehicleHoldModel } from '../../details-panel/model/index.js';

/** One manifest line: a good's live counts with the player's wanted amount echoed over them. `pinned`
 *  marks a line the player added from the picker, shown at its counts even while they are all zero. */
export interface CargoLine extends VehicleCargoRow {
  readonly pinned: boolean;
}

/** A wanted amount sent to the sim, shown while the live line still reads `base`. */
interface HeldWanted {
  readonly amount: number;
  readonly base: number;
}

/**
 * The hold's local state for the shown vehicle: the wanted amounts echoed until the snapshot carries
 * them, so steps within one snapshot or while paused add up; the goods the player added from the
 * picker; and the order the lines keep, so a line never jumps while its counts change. Another vehicle
 * starts it afresh.
 */
export interface CargoState {
  /** The vehicle the state belongs to; another one clears it. */
  show(vehicle: number): void;
  /** Echo `amount` for `goodType` over the live wanted amount `base`. */
  hold(goodType: number, amount: number, base: number): void;
  pin(goodType: number): void;
  unpin(goodType: number): void;
  isPinned(goodType: number): boolean;
  /** The lines to show, dropping every echo the live model settled. */
  lines(hold: VehicleHoldModel): CargoLine[];
}

/** Units the hold has not promised yet, with the echoed amounts in place. */
export function cargoRoom(hold: VehicleHoldModel, lines: readonly CargoLine[]): number {
  let wanted = 0;
  for (const line of lines) wanted += line.wanted;
  return Math.max(0, hold.slots - wanted);
}

export function createCargoState(): CargoState {
  let vehicle: number | null = null;
  const held = new Map<number, HeldWanted>();
  const pins = new Set<number>();
  let order: number[] = [];
  return {
    show(next): void {
      if (next === vehicle) return;
      vehicle = next;
      held.clear();
      pins.clear();
      order = [];
    },
    hold(goodType, amount, base): void {
      held.set(goodType, { amount, base });
    },
    pin(goodType): void {
      pins.add(goodType);
    },
    unpin(goodType): void {
      pins.delete(goodType);
    },
    isPinned: (goodType) => pins.has(goodType),
    lines(hold): CargoLine[] {
      const live = new Map(hold.rows.map((row) => [row.goodType, row]));
      for (const [good, echo] of held) {
        if ((live.get(good)?.wanted ?? 0) !== echo.base) held.delete(good);
      }
      const shown = (good: number): boolean => live.has(good) || pins.has(good) || held.has(good);
      order = order.filter(shown);
      const listed = new Set(order);
      for (const good of [...live.keys(), ...pins, ...held.keys()]) {
        if (listed.has(good)) continue;
        listed.add(good);
        order.push(good);
      }
      const goods = new Map(hold.goods.map((good) => [good.goodType, good]));
      return order.flatMap((good): CargoLine[] => {
        const echo = held.get(good);
        const carriable = goods.get(good);
        const base: VehicleCargoRow | undefined =
          live.get(good) ??
          (carriable === undefined ? undefined : { ...carriable, current: 0, wanted: 0, reserved: 0 });
        if (base === undefined) return [];
        return [
          {
            goodType: base.goodType,
            ...(base.goodId === undefined ? {} : { goodId: base.goodId }),
            label: base.label,
            current: base.current,
            wanted: echo?.amount ?? base.wanted,
            reserved: base.reserved,
            pinned: pins.has(good),
          },
        ];
      });
    },
  };
}
