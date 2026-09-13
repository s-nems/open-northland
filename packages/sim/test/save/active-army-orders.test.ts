import { describe, expect, it } from 'vitest';
import { AttackOrder, CurrentAtomic, PlayerOrder, Position } from '../../src/components/index.js';
import {
  cellAnchorNode,
  exportSaveGame,
  fx,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from '../conflict/melee-engagement/support.js';
import { testContent } from '../fixtures/content.js';

function restored(original: Simulation, width: number, height: number): Simulation {
  expect(original.commands.pendingCount).toBe(0);
  const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(original))));
  const copy = restoreSimulation(save, { content: testContent(), map: grassMap(width, height) }).sim;
  expect(copy.hashState()).toBe(original.hashState());
  return copy;
}

function continueTogether(original: Simulation, copy: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    original.step();
    copy.step();
    expect(copy.hashState(), `tick ${original.tick}`).toBe(original.hashState());
    expect(copy.events.current()).toEqual(original.events.current());
  }
}

describe('save an army with already executing orders', () => {
  it('retains every active march and reaches the ordered destinations after loading', () => {
    const original = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 3) });
    const army = [0, 1, 2].map((y) => fighterAt(original, 0, y, VIKING, WOODCUTTER, { owner: P0 }));
    army.forEach((entity, y) => {
      const goal = cellAnchorNode(5, y);
      original.enqueue(playerCommand(P0, { kind: 'moveUnit', entity, x: goal.hx, y: goal.hy }));
    });
    original.run(12);
    for (const entity of army) {
      expect(original.world.has(entity, PlayerOrder)).toBe(true);
      expect(original.world.get(entity, Position).x).toBeGreaterThan(0);
      expect(original.world.get(entity, Position).x).toBeLessThan(fx.fromInt(5));
    }
    const copy = restored(original, 8, 3);
    continueTogether(original, copy, 105);
    army.forEach((entity, y) => {
      // Arrival releases the order; idle separation may shift soldiers slightly within the tile.
      const position = copy.world.get(entity, Position);
      expect(position.x).toBe(fx.fromInt(5));
      expect(Math.abs(position.y - fx.fromInt(y))).toBeLessThan(fx.fromInt(1) / 2);
      expect(copy.world.has(entity, PlayerOrder)).toBe(false);
    });
  });

  it('retains an explicit target and an unfinished attack swing, then finishes the fight', () => {
    const original = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(original, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const target = fighterAt(original, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 80 });
    original.enqueue(playerCommand(P0, { kind: 'attackUnit', entity: attacker, target }));
    original.step();
    expect(original.world.get(attacker, AttackOrder).target).toBe(target);
    expect(original.world.get(attacker, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target });
    expect(original.world.isAlive(target)).toBe(true);
    const copy = restored(original, 5, 1);
    continueTogether(original, copy, 60);
    expect(copy.world.isAlive(target)).toBe(false);
    expect(copy.world.has(attacker, AttackOrder)).toBe(false);
  });
});
