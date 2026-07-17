import { describe, expect, it } from 'vitest';
import { buildScene, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

/**
 * Unit tests for {@link buildScene}'s settler stance + component reads: the in-place attacker/harvester
 * swing (the anchor stays on the worker's own feet) and the engaged / state / owner / carrying / jobType
 * fields the draw item carries across for the sprite resolver to join on.
 */

describe('buildScene — settler stance & component reads', () => {
  it('a mid-swing attacker plays the swing IN PLACE: anchor untouched, facing its target', () => {
    // Attacker (1,1) swings (atomic 81) at a target one column EAST (2,1). The drawn anchor must
    // stay exactly on the attacker's own feet — the attack frames carry their authored advance in
    // per-frame foot offsets, and an extra positional nudge doubled it into a ground slide (the
    // rejected melee "lunge"). Facing still resolves toward the live target; the depth key is pinned
    // against an idle twin on the attacker's own cell.
    const attacker = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 6, duration: 12, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const idleTwin = entity(4, 1, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([attacker, target, idleTwin]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x); // swings where it stands
    expect(drawn?.y).toBeCloseTo(base.y);
    expect(drawn?.facing).toBe(4); // faces its mark (E)
    expect(drawn?.depth).toBe(scene.find((d) => d.kind === 'settler' && d.ref === 4)?.depth);
  });

  it('a RANGED attacker likewise stands its ground and faces its target', () => {
    // The archer at (1,1) draws on a target 5 columns east: anchor in place, the arrow crosses the
    // gap, not the archer.
    const archer = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 3, targetEntity: 2, targetTile: null },
    });
    const target = entity(2, 6, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([archer, target]), FLAT_3x2);
    const drawn = scene.find((d) => d.kind === 'settler' && d.ref === 1);
    const base = tileToScreen(1, 1);
    expect(drawn?.x).toBeCloseTo(base.x);
    expect(drawn?.facing).toBe(4); // still faces its mark (E)
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
        // idle: a Settler with neither a CurrentAtomic nor a PathFollow.
        entity(1, 0, 0, { Settler: { tribe: 0 } }),
        // moving: a live PathFollow, no CurrentAtomic.
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        // acting: a CurrentAtomic wins even with a (stale) PathFollow present.
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
    expect(byRef(3)?.atomicId).toBe(24); // the setatomic join key rides along
    expect(byRef(3)?.elapsed).toBe(6); // the atomic's tick clock rides along (the animation cadence)
  });

  it('reads a between-paths settler (MoveGoal / pending PathRequest) as moving, not a stutter', () => {
    // A chaser re-issuing its route drops PathFollow for a tick while it still holds a MoveGoal or a fresh
    // PathRequest — it is walking, not standing. Reading that gap as `idle` was the visible march stutter
    // (the walk animation snapping to the standing pose each tile). A FAILED PathRequest is the genuinely
    // stuck case and stays `idle` so the unit doesn't moonwalk against an unreachable goal.
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, MoveGoal: { cell: 5 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: false } }),
        entity(3, 2, 0, { Settler: { tribe: 0 }, PathRequest: { start: 0, goal: 5, failed: true } }),
        // MoveGoal present but its path already failed → still stuck, still idle (failure wins).
        entity(4, 2, 1, {
          Settler: { tribe: 0 },
          MoveGoal: { cell: 5 },
          PathRequest: { start: 0, goal: 5, failed: true },
        }),
      ]),
      FLAT_3x2,
    );
    const byRef = (r: number) => scene.find((d) => d.kind === 'settler' && d.ref === r);
    expect(byRef(1)?.state).toBe('moving'); // holding a goal, path not yet issued
    expect(byRef(2)?.state).toBe('moving'); // route queued, not yet a PathFollow
    expect(byRef(3)?.state).toBe('idle'); // unreachable goal — stuck, not moving
    expect(byRef(4)?.state).toBe('idle'); // failed route wins over the lingering goal
  });

  it('reads a settler’s owning player (the team-colour key) from its Owner component', () => {
    // The render team-colour join: Owner.player → DrawItem.player → the PalettedSprite LUT row. An UNOWNED
    // settler (no Owner) carries no player and draws the base palette (row 0).
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Settler: { tribe: 0 }, Owner: { player: 3 } }),
        entity(2, 1, 0, { Settler: { tribe: 0 } }), // wildlife / neutral — unowned
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
        // empty-handed walker: no Carrying component → flag omitted.
        entity(1, 0, 0, { Settler: { tribe: 0 }, PathFollow: { waypoints: [], index: 0 } }),
        // hauling a log home: a Carrying component present → carrying:true rides along orthogonal to state.
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
    expect(byRef(2)?.state).toBe('moving'); // still moving — carrying is orthogonal to the coarse state
    expect(byRef(2)?.carrying).toBe(true);
    expect(byRef(2)?.carryGood).toBe(1); // the hauled goodType rides along — the per-good look join key
  });

  it('carries the settler jobType + the young (Age) flag — the per-character body join keys', () => {
    const scene = buildScene(
      snapshotOf([
        // An adult with a job: jobType rides along, no young flag (no Age component).
        entity(1, 0, 0, { Settler: { tribe: 0, jobType: 31 } }),
        // A jobless adult (jobType null): the field is omitted → the binding's default look.
        entity(2, 1, 0, { Settler: { tribe: 0, jobType: null } }),
        // A born-young settler: the Age component flips young:true, disambiguating the age-class
        // jobType 1 from a fixture adult using the same number (AGENTS.md [dc3ef54]).
        entity(3, 2, 0, { Settler: { tribe: 0, jobType: 1 }, Age: { ticks: 5 } }),
        // A fixture ADULT whose job id collides with an age class: jobType 1 but NO Age → young omitted.
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

  it('draws a chopping settler at its cell centre — the swing plays in place, no positional nudge', () => {
    // The worker stands on the work cell BESIDE its tree (the planner's adjacent stance) and FACES it;
    // the swing's advance is authored into the frames. The old fixed −24 px chop nudge assumed the
    // settler shared the tree's cell and popped on/off across the between-swings replan gap — the
    // reported forward-back slide — so a chopping and a non-chopping settler now share the same anchor.
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
