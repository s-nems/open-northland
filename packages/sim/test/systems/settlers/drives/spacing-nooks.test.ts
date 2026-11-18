import { describe, expect, it } from 'vitest';
import { Building, MoveGoal, Owner, Position } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../../src/index.js';
import { hexNeighboursOf } from '../../../../src/nav/halfcell.js';
import { hasOpenSide, nearestUnblockedNode } from '../../../../src/nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../../../src/nav/terrain/index.js';
import { constructionWorkCells } from '../../../../src/systems/footprint/index.js';
import { deStackIdle, loiterCell, nearestFreeCell } from '../../../../src/systems/settlers/drives/spacing.js';
import { PlannerSpacing } from '../../../../src/systems/settlers/planner/spacing.js';
import { NodeBuckets } from '../../../../src/systems/spatial/nodes.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { settlerAt } from '../../../fixtures/settler.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

// Walls on five lattice sides of a one-node nook N whose sixth side is the blocked node S west of it. N is
// S's east neighbour, the first in the canonical order E, SE, SW, W, NW, NE, so every stand picker reaches
// N first from S and must reject it on its exit.

const MAP_NODES = 16;
const PLAYER = 0;
const WOODCUTTER = 1;
const STACK = 3;
const VIKING = 1;
/** A test-content workplace with no footprint, so its site body is the anchor alone. */
const SITE_TYPE = 2;
/** A construction site clear of the nook's walls. */
const SITE = { x: 3, y: 3 } as const;
/** The blocked node the stack stands on and the nook's only neighbour not walled. */
const S = { x: 8, y: 8 } as const;
const NOOK = { x: S.x + 1, y: S.y } as const;
/** The walls closing the nook's other five sides. */
const NOOK_WALLS = hexNeighboursOf(NOOK.x, NOOK.y).filter(({ hx, hy }) => hx !== S.x || hy !== S.y);

interface Fixture {
  readonly sim: Simulation;
  readonly terrain: TerrainGraph;
  readonly blocked: ReadonlySet<NodeId>;
  readonly nook: NodeId;
  readonly from: NodeId;
}

function fixture(): Fixture {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: terrain missing');
  const from = terrain.nodeAt(S.x, S.y);
  const blocked = new Set<NodeId>([from, ...NOOK_WALLS.map(({ hx, hy }) => terrain.nodeAt(hx, hy))]);
  return { sim, terrain, blocked, nook: terrain.nodeAt(NOOK.x, NOOK.y), from };
}

/** Every node of the map except `open`. */
function everyNodeBut(terrain: TerrainGraph, open: ReadonlySet<NodeId>): Set<NodeId> {
  const walls = new Set<NodeId>();
  for (let y = 0; y < MAP_NODES; y++)
    for (let x = 0; x < MAP_NODES; x++) {
      const node = terrain.nodeAt(x, y);
      if (!open.has(node)) walls.add(node);
    }
  return walls;
}

function ownedAt(sim: Simulation, x: number, y: number): Entity {
  const e = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(x, y) });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function spacingOf(f: Fixture, settlers: readonly Entity[]): PlannerSpacing {
  return PlannerSpacing.overExplicit(
    f.sim.world,
    ctxOf(f.sim),
    f.terrain,
    new NodeBuckets(f.sim.world, settlers),
    f.blocked,
  );
}

describe('stands keep an exit', () => {
  it('reads the walled nook as sealed and the open neighbours of S as having a side', () => {
    const f = fixture();
    expect(hasOpenSide(f.terrain, f.nook, f.blocked)).toBe(false);
    const open = f.terrain.neighbours(f.from).filter((n) => !f.blocked.has(n) && n !== f.nook);
    expect(open.length).toBeGreaterThan(0);
    for (const n of open) expect(hasOpenSide(f.terrain, n, f.blocked)).toBe(true);
  });

  it('never offers the nook as the nearest free cell, though the ring reaches it first', () => {
    const f = fixture();
    expect(f.terrain.neighbours(f.from)[0]).toBe(f.nook);
    const stand = nearestFreeCell(f.terrain, f.from, spacingOf(f, []), ownedAt(f.sim, S.x, S.y));
    expect(stand).not.toBeNull();
    expect(stand).not.toBe(f.nook);
    if (stand !== null) expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
  });

  it('fans a stack beside the walled nook out onto cells with an exit', () => {
    const f = fixture();
    const stack = Array.from({ length: STACK }, () => ownedAt(f.sim, S.x, S.y));
    const spacing = spacingOf(f, stack);
    const [keeper, ...movers] = stack;
    if (keeper === undefined) throw new Error('setup: empty stack');
    const ctx = ctxOf(f.sim);
    expect(deStackIdle(f.sim.world, ctx, f.terrain, keeper, S.x, S.y, spacing)).toBeNull();
    const stands = movers.map((e) => {
      const sent = deStackIdle(f.sim.world, ctx, f.terrain, e, S.x, S.y, spacing);
      expect(sent).toBe(f.sim.world.get(e, MoveGoal).cell);
      return f.sim.world.get(e, MoveGoal).cell;
    });
    expect(new Set(stands).size).toBe(movers.length);
    for (const stand of stands) {
      expect(stand).not.toBe(f.nook);
      expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
    }
  });

  it('steps off beside the crowd when no node clear of it is in reach', () => {
    const f = fixture();
    const [keeper, mover] = [ownedAt(f.sim, S.x, S.y), ownedAt(f.sim, S.x, S.y)];
    if (keeper === undefined || mover === undefined) throw new Error('setup: no stack');
    // Only the stack's own ring stays open, and every node of it lies beside the keeper.
    const ring = new Set(f.terrain.neighbours(f.from));
    const blocked = everyNodeBut(f.terrain, ring);
    const spacing = PlannerSpacing.overExplicit(
      f.sim.world,
      ctxOf(f.sim),
      f.terrain,
      new NodeBuckets(f.sim.world, [keeper, mover]),
      blocked,
    );
    const sent = deStackIdle(f.sim.world, ctxOf(f.sim), f.terrain, mover, S.x, S.y, spacing);
    expect(sent === null ? false : ring.has(sent)).toBe(true);
  });

  it('moves a loiterer already alone in the nook off it', () => {
    const f = fixture();
    const loiterer = ownedAt(f.sim, NOOK.x, NOOK.y);
    // The yard grows from the blocked anchor below the nook, so the nook is a yard cell.
    const stand = loiterCell(f.sim.world, f.terrain, loiterer, f.nook, f.from, spacingOf(f, [loiterer]));
    expect(stand).not.toBe(f.nook);
    expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
  });

  it('lands a push off blocked ground beside the nook, never in it', () => {
    const f = fixture();
    const landing = nearestUnblockedNode(f.terrain, f.from, f.blocked);
    expect(landing).not.toBeNull();
    expect(landing).not.toBe(f.nook);
  });

  it('never returns an avoided node, though the ring reaches it first', () => {
    const f = fixture();
    const landing = nearestUnblockedNode(f.terrain, f.from, f.blocked);
    if (landing === null) throw new Error('setup: no landing');
    const avoided = nearestUnblockedNode(f.terrain, f.from, f.blocked, { avoid: new Set([landing]) });
    expect(avoided).not.toBeNull();
    expect(avoided).not.toBe(landing);
  });

  it('falls back to a sealed node only when asked and nothing open lies within the cap', () => {
    const f = fixture();
    // Every node but the nook blocks, so the only free node in reach keeps no open side.
    const walls = everyNodeBut(f.terrain, new Set([f.nook]));
    expect(nearestUnblockedNode(f.terrain, f.from, walls)).toBeNull();
    expect(nearestUnblockedNode(f.terrain, f.from, walls, { sealedFallback: true })).toBe(f.nook);
    expect(
      nearestUnblockedNode(f.terrain, f.from, walls, { sealedFallback: true, avoid: new Set([f.nook]) }),
    ).toBeNull();
  });

  it('keeps the perimeter cell of a site whose every open cell is wedged', () => {
    const f = fixture();
    const site = f.sim.world.create();
    f.sim.world.add(site, Position, positionOfNode(SITE.x, SITE.y));
    f.sim.world.add(site, Building, {
      buildingType: SITE_TYPE,
      tribe: VIKING,
      built: fx.fromInt(0),
      level: 0,
    });
    const ctx = ctxOf(f.sim);
    const [kept] = constructionWorkCells(f.sim.world, ctx, f.terrain, site, new Set<NodeId>());
    if (kept === undefined) throw new Error('setup: the site has no perimeter');
    // Everything but one perimeter cell blocks (the ring's cells neighbour each other, so two open ones
    // would keep a side), so the one left keeps no open side.
    const walls = everyNodeBut(f.terrain, new Set([kept]));
    expect(hasOpenSide(f.terrain, kept, walls)).toBe(false);
    const spacing = PlannerSpacing.overExplicit(
      f.sim.world,
      ctx,
      f.terrain,
      new NodeBuckets(f.sim.world, []),
      walls,
    );
    expect(spacing.workCells(site)).toEqual(constructionWorkCells(f.sim.world, ctx, f.terrain, site, walls));
    expect(spacing.workCells(site).length).toBeGreaterThan(0);
  });
});
