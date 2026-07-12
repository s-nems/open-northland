import { describe, expect, it } from 'vitest';
import { PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX } from '../../src/data/scene/index.js';
import { buildScene, ONE, type SceneTerrain, tileToScreen } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * Unit tests for {@link buildScene} — projectiles, combat stance & component state. Covers the ballistic
 * arc (peak lift, tangent tilt, cap), the in-place attacker/harvester swing, and the engaged / state /
 * owner / carrying / jobType component reads.
 */

const FLAT_3x2: SceneTerrain = { width: 3, height: 2, typeIds: [1, 1, 2, 2, 1, 1] };

describe('buildScene', () => {
  it('classifies an in-flight Projectile and aims its rotation at the target', () => {
    // The shot at (1,1) homes on a target one column EAST (2,1): the screen heading is (+x, 0) → 0 rad.
    const shot = entity(1, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.ref).toBe(1);
    expect(arrow?.rotation).toBeCloseTo(0); // points screen-east, along the flight
  });

  it('a projectile whose target left the snapshot draws with no rotation (never a throw)', () => {
    const shot = entity(1, 1, 1, {
      Projectile: { target: 99, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'projectile')?.rotation).toBeUndefined();
  });

  /** A Projectile payload homing on `target`, loosed from origin tile (ox, oy). */
  function projectileFrom(target: number, ox: number, oy: number): Record<string, unknown> {
    return {
      Projectile: {
        target,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
      },
    };
  }

  it('lobs a projectile with a readable origin: peak lift at mid-chord, level tangent, depth untouched', () => {
    // Origin (0,1) → target (2,1) on one row: chord = 2 cells = 136 px. The shot sits exactly halfway
    // (1,1) → p = 0.5: lift = the parabola's peak (chord × the peak fraction), tangent slope 0 → the
    // rotation is the flat straight-line heading (east).
    const shot = entity(1, 1, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    // A flat control shot (no readable origin → no arc) on the SAME cell: the arc must ride the LIFT
    // channel only, never the depth key, so mid-lob occlusion order can't reshuffle.
    const flatShot = entity(4, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot, target, flatShot]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile' && d.ref === 1);
    const chord = tileToScreen(2, 1).x - tileToScreen(0, 1).x;
    expect(arrow?.lift).toBeCloseTo(chord * PROJECTILE_ARC_PEAK_FRACTION); // 4·peak·½·½ = peak at mid-flight
    expect(arrow?.rotation).toBeCloseTo(0); // level at the apex — still the straight heading
    const flat = scene.find((d) => d.kind === 'projectile' && d.ref === 4);
    expect(arrow?.depth).toBe(flat?.depth); // arc never moves the depth key
  });

  it('caps the lob peak on a long chord (a max-range shot must not leave the screen)', () => {
    // Origin (0,1) → target (12,1): chord = 12 cells = 816 px, whose fractional peak (~98 px) exceeds
    // the cap — the drawn peak clamps to PROJECTILE_ARC_PEAK_MAX_PX exactly at mid-flight (6,1).
    const shot = entity(1, 6, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 12, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const chord = tileToScreen(12, 1).x - tileToScreen(0, 1).x;
    expect(chord * PROJECTILE_ARC_PEAK_FRACTION).toBeGreaterThan(PROJECTILE_ARC_PEAK_MAX_PX); // the cap really binds
    expect(scene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(PROJECTILE_ARC_PEAK_MAX_PX);
  });

  it('tilts a descending projectile nose-DOWN along the arc tangent past mid-flight', () => {
    // Same 2-cell chord, shot ¾ of the way (1.5, 1): the parabola is falling, so the drawn heading
    // tilts screen-down (positive rotation toward an eastbound target) instead of the flat 0.
    const shot = entity(1, 1.5, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.rotation ?? 0).toBeGreaterThan(0);
    expect(arrow?.lift ?? 0).toBeGreaterThan(0); // still airborne
  });

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

  it('is pure: the same snapshot yields a byte-identical draw list', () => {
    const snap = snapshotOf([
      entity(1, 1, 0, { Settler: { tribe: 0 } }),
      entity(2, 0, 2, { Building: { buildingType: 1 } }),
    ]);
    const a = buildScene(snap, FLAT_3x2);
    const b = buildScene(snap, FLAT_3x2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
