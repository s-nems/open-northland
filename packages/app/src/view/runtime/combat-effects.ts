import type { SimEvent, WorldSnapshot } from '@open-northland/sim';

export interface TickEffects {
  readonly tick: number;
  readonly events: readonly SimEvent[];
}

interface CombatPresenter {
  ingestCombatEffects(events: readonly SimEvent[], tick: number, snapshot: WorldSnapshot): void;
}

const NO_EVENTS: readonly SimEvent[] = [];

/** Preserve hit clocks through multi-tick display frames. Positions and visibility use the drawn snapshot. */
export function presentCombatEffects(
  frames: readonly TickEffects[],
  snapshot: WorldSnapshot,
  presenter: CombatPresenter,
  visible?: (hx: number, hy: number) => boolean,
): void {
  let lastTick = -1;
  for (const frame of frames) {
    if (frame.events.length === 0) continue;
    const events =
      visible === undefined
        ? frame.events
        : frame.events.filter((event) => !('at' in event) || visible(event.at.hx, event.at.hy));
    presenter.ingestCombatEffects(events, frame.tick, snapshot);
    lastTick = frame.tick;
  }
  // Paused/no-impact frames still retire effects against game time, never wall time.
  if (lastTick !== snapshot.tick) presenter.ingestCombatEffects(NO_EVENTS, snapshot.tick, snapshot);
}
