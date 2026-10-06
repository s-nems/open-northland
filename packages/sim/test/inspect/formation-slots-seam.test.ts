import { expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { fx, Simulation } from '../../src/index.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { testContent } from '../fixtures/content.js';

it('keeps a redirected soldier eligible for formation slots while crossing a legal bank diagonal', () => {
  const typeIds = new Array<number>(16).fill(0);
  typeIds[5] = 1; // one flank of the legal (1,0) -> (2,2) diagonal
  const sim = new Simulation({
    seed: 7,
    content: testContent(),
    map: { resolution: 'half-cell', width: 4, height: 4, typeIds },
  });
  const entity = fighterAt(sim, 0, 0, 1, 31, { owner: 0 });
  const position = sim.world.mut(entity, Position);
  position.x = fx.fromFloat(0.5);
  position.y = fx.fromFloat(0.7);
  const groups = sim.formationSlots({ hx: 3, hy: 3 }, [entity], 2);
  expect(groups?.flatMap((group) => group.members)).toEqual([entity]);
  expect(groups?.flatMap((group) => group.slots)).toHaveLength(1);
});
