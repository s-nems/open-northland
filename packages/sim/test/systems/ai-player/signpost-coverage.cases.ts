import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Settler } from '../../../src/components/index.js';
import { fx, positionOfNode, Simulation } from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import {
  SIGNPOST_TARGET_TOLERANCE_NODES,
  scoutModule,
  signpostLatticeOffset,
} from '../../../src/systems/ai-player/index.js';
import { interactionNode } from '../../../src/systems/footprint/interaction.js';
import { signpostNetwork } from '../../../src/systems/index.js';
import { EAT_ATOMIC_ID } from '../../../src/systems/settlers/atomics/start.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  collectModule,
  ctxOf,
  doorHqContent,
  entityOfBuilding,
  HOME_TYPE,
  HQ_DOOR,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  placeHq,
  plantPost,
  plantPostAtHq,
  SCOUT,
  SEAT,
  VIKING,
  wallOver,
} from './support.js';

/** The scout's first duty: the outward signpost lattice and the navigation area it grows. */

describe('signpost-coverage module (guideBuild)', () => {
  it('starts the lattice beside the HQ, then walks the six-post ring outward', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    const commands = [...scoutModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands).toHaveLength(1);
    const order = commands[0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    // The first post lands beside the HQ (the lattice's centre target).
    expect(hexDistanceBetween(order.x, order.y, HQ_X, HQ_Y) <= SIGNPOST_TARGET_TOLERANCE_NODES).toBe(true);

    // With the centre post standing, the next order walks the first ring (its east corner fits
    // this map; the -22-row targets fall off it and are skipped).
    plantPostAtHq(sim);
    const next = [...scoutModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (next?.kind !== 'placeSignpost') throw new Error('expected a first-ring placement');
    const east = signpostLatticeOffset(1, 0);
    expect(
      hexDistanceBetween(next.x, next.y, HQ_X + east.dx, HQ_Y + east.dy) <= SIGNPOST_TARGET_TOLERANCE_NODES,
    ).toBe(true);
  });

  it('stands the centre post one cell west of a footprinted HQ door, never in the doorway', () => {
    // A door is the one passable gate in the walk-block, so an unguarded legal-spot search settles
    // exactly on it - the post then blocks where the HQ's settlers enter and leave.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...scoutModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    const doorway = interactionNode(sim.world, ctx, entityOfBuilding(sim, HQ_TYPE));
    expect(doorway).toEqual({ x: HQ_X + HQ_DOOR.dx, y: HQ_Y + HQ_DOOR.dy });
    expect({ x: order.x, y: order.y }).toEqual({ x: (doorway?.x ?? 0) - 2, y: doorway?.y });
  });

  it('skips a legal spot sealed inside a walk-block pocket instead of re-aiming at it every decision', () => {
    // The overlay-sealed-target loop: the spot beside the door is clear ground, but a blocker ring
    // seals it into a one-node pocket. The walk there fails, playerOrderSystem sheds the failed order
    // before the stranded pacing can note it, and the module re-picks the same spot every decision.
    // The chooser must refuse the provably sealed spot up front and settle nearby instead.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    // Seal the centre spot (doorway - 2, proven by the door test above) inside a ring of its eight
    // lattice neighbours, leaving the spot itself clear ground both overlays accept.
    const sealed = { x: HQ_X + HQ_DOOR.dx - 2, y: HQ_Y + HQ_DOOR.dy };
    wallOver(
      sim,
      [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 2 },
        { dx: 1, dy: -2 },
        { dx: -1, dy: 2 },
        { dx: -1, dy: -2 },
      ].map((o) => ({ x: sealed.x + o.dx, y: sealed.y + o.dy })),
    );

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...scoutModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    expect({ x: order.x, y: order.y }).not.toEqual(sealed);
    // Still the centre target: the pick settles on reachable ground within the same tolerance.
    expect(hexDistanceBetween(order.x, order.y, sealed.x, sealed.y) <= SIGNPOST_TARGET_TOLERANCE_NODES).toBe(
      true,
    );
  });

  it('fails open to the unvetoed search when the door itself is sealed in a pocket', () => {
    // The inversion hazard: the veto judges spots from the HQ door, so a door sealed inside its own
    // pocket would read every open-ground spot as unroutable and the module would stop erecting
    // entirely. A pocketed reference must disable the veto, not invert it.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    // Wall the door's seven open lattice neighbours (the eighth, east, is the HQ body): the door
    // becomes a one-node pocket.
    const door = { x: HQ_X + HQ_DOOR.dx, y: HQ_Y + HQ_DOOR.dy };
    wallOver(
      sim,
      [
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 2 },
        { dx: 1, dy: -2 },
        { dx: -1, dy: 2 },
        { dx: -1, dy: -2 },
      ].map((o) => ({ x: door.x + o.dx, y: door.y + o.dy })),
    );

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...scoutModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    expect(hexDistanceBetween(order.x, order.y, door.x - 2, door.y) <= SIGNPOST_TARGET_TOLERANCE_NODES).toBe(
      true,
    );
  });

  it('extends the lattice only where the settlement builds (the field grows with the buildings)', () => {
    const CENTER = { x: 128, y: 128 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, CENTER.x, CENTER.y);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 100, y: 100, tribe: VIKING, owner: SEAT });
    sim.step();
    // The centre and all six first-ring targets stand satisfied - the always-wanted lattice is done.
    plantPost(sim, positionOfNode(CENTER.x, CENTER.y));
    for (const [q, r] of [
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
    ] as const) {
      const o = signpostLatticeOffset(q, r);
      plantPost(sim, positionOfNode(CENTER.x + o.dx, CENTER.y + o.dy));
    }
    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A new building near the second ring's east corner makes exactly that outer target wanted.
    const reach = signpostLatticeOffset(2, 0);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: CENTER.x + reach.dx - 2,
      y: CENTER.y + reach.dy,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = [...scoutModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected an expansion placement');
    expect(
      hexDistanceBetween(order.x, order.y, CENTER.x + reach.dx, CENTER.y + reach.dy) <=
        SIGNPOST_TARGET_TOLERANCE_NODES,
    ).toBe(true);
  });

  it('chains the whole ring into one group, even with every post drifted a full tolerance off its target', () => {
    const CENTER = { x: 128, y: 128 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    plantPost(sim, positionOfNode(CENTER.x, CENTER.y));
    // Each ring post pushed outward along its own axis by the tolerance, the worst spread two
    // neighbours can reach; the legal-spot search walks Manhattan rings, which the hex metric never
    // under-counts.
    const ring = [
      { q: 1, r: 0, dx: SIGNPOST_TARGET_TOLERANCE_NODES, dy: 0 },
      { q: 0, r: 1, dx: 0, dy: SIGNPOST_TARGET_TOLERANCE_NODES },
      { q: -1, r: 1, dx: -SIGNPOST_TARGET_TOLERANCE_NODES, dy: 0 },
      { q: -1, r: 0, dx: -SIGNPOST_TARGET_TOLERANCE_NODES, dy: 0 },
      { q: 0, r: -1, dx: 0, dy: -SIGNPOST_TARGET_TOLERANCE_NODES },
      { q: 1, r: -1, dx: SIGNPOST_TARGET_TOLERANCE_NODES, dy: 0 },
    ];
    for (const { q, r, dx, dy } of ring) {
      const o = signpostLatticeOffset(q, r);
      plantPost(sim, positionOfNode(CENTER.x + o.dx + dx, CENTER.y + o.dy + dy));
    }
    const posts = signpostNetwork(sim.world).get(SEAT) ?? [];
    expect(posts).toHaveLength(7);
    expect(new Set(posts.map((p) => p.group)).size).toBe(1);
    // Every target reads satisfied, so the module asks for nothing more.
    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('does nothing without a scout', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('leaves a scout mid-action alone, so a meal longer than the decision beat can finish', () => {
    // The regression: both order markers are shed the moment a need drive starts an atomic, so an
    // eating scout used to read as idle. The module then re-ordered it every 24-tick beat and
    // `moveUnit` cancelled the half-eaten meal - the scout ate forever and never fed.
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('expected a spawned scout');
    // Work remains, and with no atomic running the module does want to order it.
    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);

    sim.world.add(scout, CurrentAtomic, {
      atomicId: EAT_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 50,
      effect: { kind: 'eat', goodType: 3, from: null },
      targetEntity: scout,
      targetTile: null,
    });

    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('does not retire a scout mid-action - setJob would cancel the running atomic', () => {
    // The retirement twin of the guard above, and the more destructive one: `setJob` cancels whatever
    // the settler is doing, so retiring an eating scout throws the meal away.
    const sim = aiSim();
    placeHq(sim);
    // No resources and one man: the lattice has no work left to want, so the scout is retirable.
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('expected a spawned scout');

    sim.world.add(scout, CurrentAtomic, {
      atomicId: EAT_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 50,
      effect: { kind: 'eat', goodType: 3, from: null },
      targetEntity: scout,
      targetTile: null,
    });

    const retires = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
      (c) => c.kind === 'setJob' && c.entity === scout,
    );
    expect(retires).toEqual([]);
  });
});
