import type { MatchOutcome, PlayerCommand, SimEvent } from '@open-northland/sim';

export interface SeatSurrenderDeps {
  readonly player: number;
  readonly outcome: () => MatchOutcome;
  /** Whether the view already watches instead of commanding the seat. */
  readonly watching: () => boolean;
  readonly submit: (command: PlayerCommand) => void;
  readonly watch: () => void;
  /** Hands the seat back to the room. */
  readonly release: () => void;
}

export interface SeatSurrender {
  available(): boolean;
  start(): void;
  onEvents(events: readonly SimEvent[]): void;
}

/**
 * Giving a shared match up: the order goes out while the seat still commands, the view watches at once,
 * and the seat is handed back only once the world has decided it. The relay names a command's seat as
 * it arrives, so a seat handed back first would leave the surrender unsent.
 */
export function createSeatSurrender(deps: SeatSurrenderDeps): SeatSurrender {
  let awaitingVerdict = false;
  const available = (): boolean => !deps.watching() && deps.outcome() === 'undecided';
  return {
    available,
    start(): void {
      if (!available()) return;
      deps.submit({ kind: 'surrender', player: deps.player });
      awaitingVerdict = true;
      deps.watch();
    },
    onEvents(events): void {
      if (!awaitingVerdict) return;
      // A script's announcement under a goal table decides nothing until the table's check.
      const decided = events.some(
        (event) =>
          (event.kind === 'playerDefeated' || event.kind === 'playerWon') &&
          event.player === deps.player &&
          event.scripted !== true,
      );
      if (!decided) return;
      awaitingVerdict = false;
      deps.release();
    },
  };
}
