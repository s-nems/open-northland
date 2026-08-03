import { describe, expect, it } from 'vitest';
import { buildScene, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

describe('buildScene - settler stance & component reads', () => {
  it('a mid-swing attacker plays the swing IN PLACE: anchor untouched, facing its target', () => {
    // The attack frames carry their authored advance in per-frame foot offsets, so an extra positional
    // nudge would double it into a ground slide.
    const attacker = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 6, duration: 12, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const idleTwin = entity(4, 1, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([attacker, target, idleTwin]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x);
    expect(drawn?.y).toBeCloseTo(base.y);
    expect(drawn?.facing).toBe(4); // block 4 is east, where its mark stands
    expect(drawn?.depth).toBe(scene.find((d) => d.kind === 'settler' && d.ref === 4)?.depth);
  });

  it('a RANGED attacker likewise stands its ground and faces its target', () => {
    // The arrow crosses the five-column gap, not the archer.
    const archer = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 3, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 6, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([archer, target]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x);
    expect(drawn?.facing).toBe(4);
  });

  it('marks a settler engaged when it carries the Engagement component', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 }, Engagement: { repathAt: 0 } }),
        entity(2, 1, 1, { Settler: { tribe: 0 } }),
      ]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.engaged).toBe(true);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 2)?.engaged).toBeUndefined();
  });

  it('derives a settler state from its components: acting > moving > idle', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        // A CurrentAtomic wins even with a stale PathFollow present.
        entity(3, 2, 0, {
          Settler: { tribe: 0 },
          CurrentAtomic: { atomicId: 24, elapsed: 6 },
          PathFollow: { waypoints: [], index: 0 },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('idle');
    expect(byRef(1)?.atomicId).toBeUndefined();
    expect(byRef(1)?.elapsed).toBeUndefined();
    expect(byRef(2)?.state).toBe('moving');
    expect(byRef(2)?.atomicId).toBeUndefined();
    expect(byRef(3)?.state).toBe('acting');
    expect(byRef(3)?.atomicId).toBe(24); // the setatomic join key
    expect(byRef(3)?.elapsed).toBe(6); // the atomic's tick clock, which drives the animation cadence
  });

  it('reads a between-paths settler (MoveGoal / pending PathRequest) as moving, not a stutter', () => {
    // A chaser re-issuing its route drops PathFollow for a tick while it still holds a MoveGoal or a
    // fresh PathRequest: reading that gap as `idle` snaps the walk animation to the standing pose each
    // tile. A failed PathRequest is the genuinely stuck case, so it stays `idle` and does not moonwalk.
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, MoveGoal: { cell: 5 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: false } }),
        entity(3, 2, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: true } }),
        // A failed path wins over the lingering goal.
        entity(4, 2, 1, {
          Settler: { tribe: 0 },
          MoveGoal: { cell: 5 },
          PathRequest: { start: 0, goal: 5, failed: true },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('moving');
    expect(byRef(2)?.state).toBe('moving');
    expect(byRef(3)?.state).toBe('idle');
    expect(byRef(4)?.state).toBe('idle');
  });

  it('reads a settler’s owning player (the team-colour key) from its Owner component', () => {
    // The team-colour join: Owner.player → DrawItem.player → the PalettedSprite LUT row, where an
    // unowned settler draws the base palette in row 0.
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, Owner: { player: 3 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 } }),
        entity(3, 2, 0, { Settler: { tribe: 0 }, Owner: { player: 0 } }), // player 0 is a real slot, not "none"
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.player).toBe(3);
    expect(byRef(2)?.player).toBeUndefined();
    expect(byRef(3)?.player).toBe(0);
  });

  it('flags a settler hauling a good with carrying:true (the loaded-gait join key)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        entity(2, 1, 0, {
          Settler: { tribe: 0 },
          PathFollow: { waypoints: [], index: 0 },
          Carrying: { goodType: 1, amount: 1 },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('moving');
    expect(byRef(1)?.carrying).toBeUndefined();
    expect(byRef(1)?.carryGood).toBeUndefined();
    expect(byRef(2)?.state).toBe('moving'); // carrying is orthogonal to the coarse state
    expect(byRef(2)?.carrying).toBe(true);
    expect(byRef(2)?.carryGood).toBe(1); // the per-good look join key
  });

  it('carries the settler jobType + the young (Age) flag - the per-character body join keys', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0, jobType: 31 } }),
        entity(2, 1, 0, { Settler: { tribe: 0, jobType: null } }),
        // The Age component disambiguates the age-class jobType 1 from a fixture adult on the same number.
        entity(3, 2, 0, { Settler: { tribe: 0, jobType: 1 }, Age: { ticks: 5 } }),
        entity(4, 2, 1, { Settler: { tribe: 0, jobType: 1 } }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.jobType).toBe(31);
    expect(byRef(1)?.young).toBeUndefined();
    expect(byRef(2)?.jobType).toBeUndefined();
    expect(byRef(3)?.jobType).toBe(1);
    expect(byRef(3)?.young).toBe(true);
    expect(byRef(4)?.jobType).toBe(1);
    expect(byRef(4)?.young).toBeUndefined();
  });

  it('draws a chopping settler at its cell centre - the swing plays in place, no positional nudge', () => {
    // The worker stands on the work cell beside its tree and faces it, with the swing's advance authored
    // into the frames. A fixed chop nudge would instead pop on and off across the between-swings replan
    // gap, sliding the settler forward and back.
    const cellCentreX = tileToScreen(2, 0).x;
    const scene = buildScene(
      snapshotOf([
        entity(1, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 24, elapsed: 3 } }),
        entity(2, 2, 0, { Settler: { tribe: 0 }, CurrentAtomic: { atomicId: 23, elapsed: 3 } }),
      ]),
      FLAT_3x2,
    );
    const chopper = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const depositor = scene.find((d) => d.kind === 'settler' && d.ref === 2);
    expect(chopper?.x).toBe(cellCentreX);
    expect(depositor?.x).toBe(cellCentreX);
    expect(chopper?.depth).toBe(depositor?.depth);
  });

  it('marks buildings/resources idle with no atomicId (they do not animate per-state here)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 5 }, CurrentAtomic: { atomicId: 7 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 }, PathFollow: { waypoints: [], index: 0 } }),
      ]),
      FLAT_3x2,
    );
    const building = scene.find((d) => d.kind === 'building');
    const resource = scene.find((d) => d.kind === 'resource');
    expect(building?.state).toBe('idle');
    expect(building?.atomicId).toBeUndefined();
    expect(resource?.state).toBe('idle');
  });
});
