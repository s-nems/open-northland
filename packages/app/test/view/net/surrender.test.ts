import type { MatchOutcome, PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSeatSurrender } from '../../../src/view/net/surrender.js';

const SEAT = 1;
const RIVAL = 0;

describe('seat surrender', () => {
  it('orders the surrender while the seat commands, watches at once and hands the seat back on its verdict', () => {
    const steps: string[] = [];
    let watching = false;
    let outcome: MatchOutcome = 'undecided';
    const surrender = createSeatSurrender({
      player: SEAT,
      outcome: () => outcome,
      watching: () => watching,
      submit: (command: PlayerCommand) => steps.push(`submit ${command.kind} while watching=${watching}`),
      watch: () => {
        watching = true;
        steps.push('watch');
      },
      release: () => steps.push('release'),
    });

    surrender.start();
    expect(surrender.available()).toBe(false);
    surrender.start();
    surrender.onEvents([
      { kind: 'playerDefeated', player: RIVAL },
      { kind: 'playerWon', player: SEAT, scripted: true },
    ]);
    expect(steps).toEqual(['submit surrender while watching=false', 'watch']);

    outcome = 'defeat';
    surrender.onEvents([{ kind: 'playerDefeated', player: SEAT }]);
    surrender.onEvents([{ kind: 'playerDefeated', player: SEAT }]);
    expect(steps).toEqual(['submit surrender while watching=false', 'watch', 'release']);
  });
});
