import type { UnitPanelModel, VehicleCargoRow, VehiclePanelModel } from './model/index.js';

/** A wanted amount sent to the sim, shown while the live line still reads `base`. */
interface HeldWanted {
  readonly amount: number;
  readonly base: number;
}

/**
 * The hold's wanted amounts echoed locally until the snapshot carries them, as the extras window echoes
 * its counters: the next step reads the echo, so clicks within one snapshot or while paused add up.
 * Once the live line leaves the value it had at the click, the write has applied or been overtaken and
 * the live value shows.
 */
export interface CargoWantedEcho {
  /** Echo `amount` for `goodType` of the vehicle `live` shows. */
  hold(live: VehiclePanelModel, goodType: number, amount: number): void;
  /** `live` with the echoed amounts in place, dropping every echo the live model settled. */
  apply(live: UnitPanelModel): UnitPanelModel;
}

export function createCargoWantedEcho(): CargoWantedEcho {
  let vehicle: number | null = null;
  const held = new Map<number, HeldWanted>();

  return {
    hold(live, goodType, amount): void {
      if (live.entityId !== vehicle) {
        held.clear();
        vehicle = live.entityId;
      }
      const base = live.cargo.find((row) => row.goodType === goodType)?.wanted ?? 0;
      held.set(goodType, { amount, base });
    },
    apply(live): UnitPanelModel {
      if (held.size === 0) return live;
      if (live.kind !== 'vehicle' || live.entityId !== vehicle) {
        held.clear();
        return live;
      }
      let room = live.wantedRoom;
      const kept = new Set<number>();
      const cargo = live.cargo.map((row): VehicleCargoRow => {
        const echo = held.get(row.goodType);
        if (echo === undefined || row.wanted !== echo.base) return row;
        kept.add(row.goodType);
        room -= echo.amount - row.wanted;
        return { ...row, wanted: echo.amount, amount: Math.max(row.current, echo.amount, row.reserved) };
      });
      for (const good of held.keys()) if (!kept.has(good)) held.delete(good);
      if (held.size === 0) return live;
      return { ...live, cargo, wantedRoom: Math.max(0, room) };
    },
  };
}
