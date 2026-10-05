import { describe, expect, it } from 'vitest';
import { applyPanelClick, type PanelClickActions } from '../src/hud/details-panel/click-actions.js';
import type { PanelClick } from '../src/hud/details-panel/pointer-intent.js';

const ENTITY = 7;

type Call = readonly [name: string, ...args: unknown[]];

function recordingActions(calls: Call[]): PanelClickActions {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  return {
    onDemolishPalisade: record('onDemolishPalisade'),
  };
}

const ROUTES: readonly (readonly [PanelClick, Call])[] = [
  [{ kind: 'demolishPalisade', entityId: ENTITY }, ['onDemolishPalisade', ENTITY]],
];

describe('applyPanelClick', () => {
  it.each(ROUTES)('routes %o to its handler', (click, expected) => {
    const calls: Call[] = [];
    applyPanelClick(click, recordingActions(calls));
    expect(calls).toEqual([expected]);
  });
});
