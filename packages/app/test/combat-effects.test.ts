import { type Entity, type SimEvent, Simulation } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { presentCombatEffects } from '../src/view/runtime/combat-effects.js';

const hit: SimEvent = {
  kind: 'combatHit',
  attacker: 1 as Entity,
  target: 2 as Entity,
  damage: 10,
  targetMaxHealth: 1000,
  at: { hx: 4, hy: 6 },
};
const died: SimEvent = {
  kind: 'settlerDied',
  entity: 2 as Entity,
  cause: 'damage',
  player: 0,
  at: { hx: 4, hy: 6 },
};
const snapshot = { ...new Simulation({ seed: 1, content: sandboxContent() }).snapshot(), tick: 200 };

it('preserves individual impact clocks and a later death across a multi-tick display frame', () => {
  const presenter = { ingestCombatEffects: vi.fn() };
  presentCombatEffects(
    [
      { tick: 100, events: [hit] },
      { tick: 110, events: [died] },
    ],
    snapshot,
    presenter,
  );
  expect(presenter.ingestCombatEffects.mock.calls.map(([events, tick]) => ({ events, tick }))).toEqual([
    { events: [hit], tick: 100 },
    { events: [died], tick: 110 },
    { events: [], tick: 200 },
  ]);
});

it('applies the final visibility gate without changing clocks, and ages effects through quiet frames', () => {
  const presenter = { ingestCombatEffects: vi.fn() };
  const hidden = { ...hit, at: { hx: 100, hy: 6 } };
  presentCombatEffects([{ tick: 200, events: [hit, hidden] }], snapshot, presenter, (x) => x < 10);
  expect(presenter.ingestCombatEffects).toHaveBeenCalledExactlyOnceWith([hit], 200, snapshot);
  presenter.ingestCombatEffects.mockClear();
  presentCombatEffects([], snapshot, presenter);
  expect(presenter.ingestCombatEffects).toHaveBeenCalledExactlyOnceWith([], 200, snapshot);
});
