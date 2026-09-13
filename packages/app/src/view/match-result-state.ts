import type { MatchOutcome } from '@open-northland/sim';

export function matchResultState() {
  let shown = false;
  let finished = false;
  return {
    announce(outcome: MatchOutcome): boolean {
      if (shown || finished || outcome === 'undecided') return false;
      shown = true;
      return true;
    },
    finish(): boolean {
      if (finished) return false;
      finished = true;
      return true;
    },
  };
}
export function matchResultActions(shared: boolean, terminal: boolean) {
  return { pause: !shared, stay: !terminal, confirmQuit: !terminal };
}
