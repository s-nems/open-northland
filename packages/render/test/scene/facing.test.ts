import { describe, expect, it } from 'vitest';
import { buildScene, ONE } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

/**
 * Unit tests for {@link buildScene}'s settler FACING derivation — the direction block a bob draws from.
 * Facing quantizes the PROJECTED (tileToScreen) heading, so it is parity-correct under the staggered
 * raster; a live action target overrides the path heading for the actions that aim.
 */

describe('buildScene — settler facing derivation', () => {
  it('derives a settler facing from its PROJECTED screen heading toward the next waypoint', () => {
    // Settler at (1,1) — an ODD (half-shifted) row; the waypoint it walks toward sets the screen-space
    // heading -> direction index. Facing quantizes the PROJECTED (tileToScreen) heading, so it is
    // parity-correct under the staggered raster — the same grid step reads differently per row parity.
    const pf = (wx: number, wy: number): Record<string, unknown> => ({
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: wx * ONE, y: wy * ONE }], index: 0 },
    });
    const facingOf = (wx: number, wy: number): number | undefined =>
      buildScene(snapshotOf([entity(1, 1, 1, pf(wx, wy))]), FLAT_3x2).find((d) => d.kind === 'settler')
        ?.facing;
    // Bob blocks face 0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N (source basis "Settler facing").
    // The six lattice headings from an odd-row cell:
    expect(facingOf(2, 1)).toBe(4); // E  column step          -> screen right      -> block 4
    expect(facingOf(0, 1)).toBe(1); // W  column step          -> screen left       -> block 1
    expect(facingOf(2, 2)).toBe(5); // SE lattice edge (+1,+1) -> screen down-right -> block 5
    expect(facingOf(1, 2)).toBe(0); // SW lattice edge (0,+1)  -> screen down-left  -> block 0
    expect(facingOf(2, 0)).toBe(3); // NE lattice edge (+1,-1) -> screen up-right   -> block 3
    expect(facingOf(1, 0)).toBe(2); // NW lattice edge (0,-1)  -> screen up-left    -> block 2
  });

  it('faces N/S on a vertical leg — the seam waypoint projects to a dead-vertical screen heading', () => {
    // A vertical lattice step is routed as cell centre -> SEAM -> cell centre (routing.ts): from the
    // odd row 1 the seam below sits at grid (1.5, 2), which projects to the SAME screen x as (1,1) —
    // heading straight down -> block 6 (S); the seam above at (1.5, 0) heads straight up -> block 7 (N).
    const walker = (ref: number, seamY: number): ReturnType<typeof entity> =>
      entity(ref, 1, 1, {
        Settler: { tribe: 0 },
        PathFollow: { waypoints: [{ x: 1.5 * ONE, y: seamY * ONE }], index: 0 },
      });
    const scene = buildScene(snapshotOf([walker(1, 2), walker(2, 0)]), FLAT_3x2);
    const settlers = scene.filter((d) => d.kind === 'settler');
    expect(settlers.find((d) => d.ref === 1)?.facing).toBe(6); // straight down -> S
    expect(settlers.find((d) => d.ref === 2)?.facing).toBe(7); // straight up   -> N
  });

  it('faces the same grid step by ROW PARITY: (0,+1) reads SW from an odd row, SE from an even one', () => {
    // The stagger flips which way a one-row-down step slides: odd row -> half a cell LEFT (SW), even
    // row -> half a cell RIGHT (SE). The old sign-pair table faced both "S" — a zigzag artifact.
    const walker = (ref: number, x: number, y: number): ReturnType<typeof entity> =>
      entity(ref, x, y, {
        Settler: { tribe: 0 },
        PathFollow: { waypoints: [{ x: x * ONE, y: (y + 1) * ONE }], index: 0 },
      });
    const scene = buildScene(snapshotOf([walker(1, 1, 1), walker(2, 1, 2)]), FLAT_3x2);
    const settlers = scene.filter((d) => d.kind === 'settler');
    expect(settlers.find((d) => d.ref === 1)?.facing).toBe(0); // odd row 1 -> screen down-left  (SW)
    expect(settlers.find((d) => d.ref === 2)?.facing).toBe(5); // even row 2 -> screen down-right (SE)
  });

  it('omits facing when a settler has no heading (no path, or already on the waypoint)', () => {
    const idle = entity(1, 1, 1, { Settler: { tribe: 0 } }); // no PathFollow
    const arrived = entity(2, 1, 1, {
      Settler: { tribe: 0 },
      PathFollow: { waypoints: [{ x: 1 * ONE, y: 1 * ONE }], index: 0 }, // waypoint == position
    });
    const scene = buildScene(snapshotOf([idle, arrived]), FLAT_3x2);
    expect(scene.find((d) => d.ref === 1)?.facing).toBeUndefined();
    expect(scene.find((d) => d.ref === 2)?.facing).toBeUndefined();
  });

  it('an attacker (atomic 81) faces its target LIVE tile, overriding any stale path heading', () => {
    // The attacker at odd row (1,1) swings at entity 2 one column EAST (2,1) → block 4 (E). Its lingering
    // path points the other way (west, block 1); combat facing must win so it never swings at empty air.
    const attacker = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 81, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([attacker, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(4); // faces E, not W
  });

  it('a harvester (atomic 24) likewise faces the node it works, overriding a stale path heading', () => {
    // The woodcutter at (1,1) chops the tree one column EAST (2,1) → block 4 (E); its lingering path
    // points west (block 1). Target facing must win or the axe swings into empty air beside the trunk.
    const chopper = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 24, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 }, // west → block 1
    });
    const target = entity(2, 2, 1, { Resource: { goodType: 1, remaining: 3 } });
    const scene = buildScene(snapshotOf([chopper, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(4); // faces E, into the tree
  });

  it('a builder (atomic 39) faces the construction site from either side', () => {
    // The builder stands EAST of the site and must face WEST (block 1), even though its stale path still
    // points east. Action 39 has authored per-direction hammer lists, so the facing selects real frames.
    const builder = entity(1, 2, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 39, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 3 * ONE, y: 1 * ONE }], index: 0 },
    });
    const site = entity(2, 1, 1, { Building: { buildingType: 1, built: 0 } });
    const scene = buildScene(snapshotOf([builder, site]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(1); // W, into the site
  });

  it('a NON-target atomic (a deposit) keeps its movement facing — target facing stays scoped', () => {
    // atomic 23 (pileup) is neither the attack nor a harvest action, so no target lookup applies.
    const depositor = entity(1, 1, 1, {
      Settler: { tribe: 0 },
      CurrentAtomic: { atomicId: 23, elapsed: 3, targetEntity: 2, targetTile: null },
      PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 }, // west → block 1
    });
    const target = entity(2, 2, 1, { Stockpile: { amounts: [[1, 2]] } });
    const scene = buildScene(snapshotOf([depositor, target]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'settler' && d.ref === 1)?.facing).toBe(1); // W from path, not E
  });
});
