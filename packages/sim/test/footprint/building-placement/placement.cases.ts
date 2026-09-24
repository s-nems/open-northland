import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  BerryBush,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Resource,
  type ResourceFootprintData,
  Stump,
} from '../../../src/components/index.js';
import { halfCellMapFromCells, nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import {
  buildingBlockedCells,
  canPlaceBuilding,
  createBerryBush,
  placementProbe,
  stampResourceFootprintData,
} from '../../../src/systems/index.js';

import {
  BIO_HUT,
  buildingsPlaced,
  ctxOf,
  grassCells,
  grassMap,
  HQ,
  HUT,
  mappedSim,
  placementContent,
  referenceCanPlace,
  terrainOf,
  VIKING,
  WATER,
  WOODCUTTER,
} from './support.js';

/** A tree whose trunk fills just its anchor node: one walk cell, so a building's reserved ring may not
 *  cover that node and nothing else. */
function trunkOnlyFootprint(): ResourceFootprintData {
  return { walk: [{ dx: 0, dy: 0 }], build: [], work: [] };
}

describe('canPlaceBuilding - the free-placement collision rule', () => {
  it('accepts a footprinted type on open ground and places it through the command seam', () => {
    const sim = mappedSim();
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 5)).toBe(true);
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
  });

  it('rejects a placement whose reserved zone would overlap an existing building’s reserved zone', () => {
    const sim = mappedSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    // Odd-row anchors: a ring's odd-dy rows stamp one node +x (the parity shift). First hut ring:
    // x∈[4..7] on rows 5/7, x∈[5..8] on rows 4/6.
    // Anchor (3,5): its ring reaches x 5 (rows 5/7) and x 6 (rows 4/6) - overlaps on every row
    // (the first hut's body node (5,5) is inside too) - rejected.
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
    // Anchor (8,5): the new body (x∈[8..9]) clears the first zone, but its ring starts at x 7 on
    // rows 5/7 - touching that zone at x=7 - so the zone-vs-zone rule rejects it. (The old
    // body-vs-zone rule allowed this; it is exactly the tight packing the widened clearance removes.)
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 8, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(1);
    // Anchor (9,5): its ring starts at x 8 (rows 5/7) / x 9 (rows 4/6), past the first ring's
    // per-row ends (7 and 8) - accepted, the two reserved zones are disjoint on every row.
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 9, y: 5, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(2);
  });

  it('reserves the family’s FULL footprint from level 0 (the max-level body blocks neighbours)', () => {
    const sim = mappedSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();
    // (6,6) is the level-max growth node - blocked for OTHERS via the family zone even though the
    // level-0 walls don't cover it: a placement whose body would take it is rejected.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 6)).toBe(false);
  });

  it('keeps the reserved zone clear of blocking terrain (minimum distance from water)', () => {
    const cells = grassCells(16, 16);
    // A water CELL at (8,5) - nodes (16..17, 10..11): the hut's reserved ring at odd-row anchor
    // (15,9) covers x∈[14..17] on even-dy rows and x∈[15..18] on shifted odd-dy rows - too close.
    cells.typeIds[5 * 16 + 8] = WATER;
    const sim = new Simulation({ seed: 1, content: placementContent(), map: halfCellMapFromCells(cells) });
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 15, 9)).toBe(false);
    // Three nodes further west the ring (x≤14, shifted rows x≤15) misses the water - accepted.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 12, 9)).toBe(true);
    // And a zone hanging off the map edge is rejected, not clamped.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 0, 5)).toBe(false);
  });

  it('keeps the reserved zone clear of resource nodes (minimum distance from a tree)', () => {
    const sim = mappedSim();
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(7, 5));
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, trunkOnlyFootprint());
    // Anchor (6,5): reserved ring x∈[5..8] covers the tree at node (7,5) - rejected.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 6, 5)).toBe(false);
    // Anchor (4,5): ring x∈[3..6] misses it - accepted.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 4, 5)).toBe(true);
  });

  it('keeps a footprinted house away from a footprint-less building (1-cell body/zone) and vice versa', () => {
    const sim = mappedSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ, x: 6, y: 6, tribe: VIKING });
    sim.step();
    // The HQ (no footprint) occupies its anchor node (6,6); a hut at (5,5) would reserve that node.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 5, 5)).toBe(false);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 9, 9)).toBe(true);
  });

  it('places a footprint-less type freely (synthetic content keeps the pre-footprint behavior)', () => {
    const sim = mappedSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ, x: 5, y: 5, tribe: VIKING });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ, x: 5, y: 5, tribe: VIKING }); // same node!
    sim.step();
    expect(buildingsPlaced(sim)).toBe(2); // no collision model - both land, like before footprints
  });
});

describe('the dense mask rule agrees with an independent derivation', () => {
  // The command gate and the overlay probe both read one memoized `Uint8Array` grid, so comparing them
  // against each other proves nothing - and the memo verifier re-stamps through that same code. The
  // oracle ({@link referenceCanPlace}) walks the blocker channels straight into sparse string sets, so a
  // wrong channel routing or wrong index arithmetic in the mask shows up here and nowhere else.
  it('matches the reference rule at every anchor with a tree, water, and a building on the map', () => {
    const cells = grassCells(16, 16);
    cells.typeIds[5 * 16 + 8] = WATER; // blocking terrain - cell (8,5), nodes (16..17, 10..11)
    const sim = new Simulation({ seed: 1, content: placementContent(), map: halfCellMapFromCells(cells) });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 11, y: 11, tribe: VIKING });
    sim.step();
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(3, 3));
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, trunkOnlyFootprint());

    const terrain = terrainOf(sim);
    const probe = placementProbe(sim.world, sim.content, terrain, HUT);
    let blocked = 0;
    let free = 0;
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const expected = referenceCanPlace(sim, terrain, HUT, x, y);
        expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, x, y)).toBe(expected);
        expect(probe.canPlace(x, y)).toBe(expected); // the overlay greys exactly what a click is refused
        expected ? free++ : blocked++;
      }
    }
    // Sanity: the obstacles + map edge really do split the grid both ways (not trivially all-true).
    expect(blocked).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
  });

  it('reports a footprint-less type placeable everywhere (its command-time behavior)', () => {
    const sim = mappedSim();
    const probe = placementProbe(sim.world, sim.content, terrainOf(sim), HQ);
    expect(probe.canPlace(0, 0)).toBe(true);
    expect(probe.canPlace(5, 5)).toBe(true);
  });

  it('returns null from Simulation.placementProbe on a mapless sim (no rule → no overlay)', () => {
    const sim = new Simulation({ seed: 1, content: placementContent() });
    expect(sim.placementProbe(HUT)).toBeNull();
  });
});

describe('placementBlockerVersion - the overlay memo key that decouples the blocker scan from the tick', () => {
  // The build-mode overlay and the work-flag blocker memo re-derive their views only when this value
  // moves; keying it on the tick (the old regression) re-scanned every RAF while the game played. So the
  // version MUST hold steady across ticks yet move the instant a building/resource enters or leaves the
  // world. The `placeBuilding` gate itself reads the journal-kept placement grid instead.
  it('holds steady across ticks while buildings and resources are unchanged', () => {
    const sim = mappedSim();
    const v0 = sim.placementBlockerVersion();
    sim.run(10); // ten empty ticks - no building/resource churn
    expect(sim.placementBlockerVersion()).toBe(v0);
  });

  it('moves when a building is placed and when a resource is added or removed', () => {
    const sim = mappedSim();
    const v0 = sim.placementBlockerVersion();

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 11, y: 11, tribe: VIKING });
    sim.step();
    const v1 = sim.placementBlockerVersion();
    expect(v1).not.toBe(v0); // a new building moved the obstacle set

    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(3, 3));
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, trunkOnlyFootprint());
    const v2 = sim.placementBlockerVersion();
    expect(v2).not.toBe(v1); // a new resource too

    sim.world.destroy(tree);
    expect(sim.placementBlockerVersion()).not.toBe(v2); // and its removal
  });

  it('keeps the memoized probe fresh after ticks and after a building appears mid-play', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);

    // Prime the memo on the empty map, then tick: a version-keyed memo must survive idle ticks…
    expect(placementProbe(sim.world, sim.content, terrain, HUT).canPlace(11, 11)).toBe(true);
    sim.run(5);

    // …but re-derive the instant a hut lands, so the overlay can never keep tinting a taken spot green.
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 11, y: 11, tribe: VIKING });
    sim.step();

    const probe = placementProbe(sim.world, sim.content, terrain, HUT);
    expect(probe.canPlace(11, 11)).toBe(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 11, 11));
    expect(probe.canPlace(11, 11)).toBe(false); // now sits on the just-placed hut's zone
  });

  it('re-derives the COMMAND GATE when a blocker appears and again when it is destroyed', () => {
    // The gate reads the same memoized grid, so a repeated probe must never answer from a stale stamp -
    // and `verifyCaches` must agree with a fresh derive at each step (the registered grid verifier).
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    // Anchor (6,5): reserved ring x∈[5..8] covers node (7,5).
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 6, 5)).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(7, 5));
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, trunkOnlyFootprint());
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 6, 5)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);

    sim.world.destroy(tree);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 6, 5)).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags a blocker move no generation can see', () => {
    // The version covers add/remove, not an in-place Position write - the gap the memo would otherwise
    // serve stale. Resources never move today; this proves the tripwire fires if one ever does, so the
    // three `toEqual([])` above are a coherent verifier agreeing, not a silent bail.
    const sim = mappedSim();
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(3, 3));
    sim.world.add(tree, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, trunkOnlyFootprint());
    canPlaceBuilding(sim.world, ctxOf(sim), terrainOf(sim), HUT, 6, 5); // stamps the memo
    expect(sim.world.verifyCaches()).toEqual([]);

    // Logged or not, an in-place move is invisible to the version key the grid memoizes on - the
    // verifier is what catches a mover violating the anchored-Position invariant.
    sim.world.mut(tree, Position).x = positionOfNode(9, 9).x;
    expect(sim.world.verifyCaches().join('\n')).toContain('placementBlockerGrid');
  });
});

describe('buildable terrain channel - walkable ground that rejects building', () => {
  /** A margin landscape class: walkable for navigation, NOT buildable (a real map's exclusion ring
   *  around a tree/rock - content/collision.ts's TERRAIN_MARGIN resolves to exactly these flags). */
  const MARGIN = 2;

  function marginContent(): ContentSet {
    const base = placementContent();
    return parseContentSet({
      ...base,
      landscape: [...base.landscape, { typeId: MARGIN, id: 'margin', walkable: true, buildable: false }],
    });
  }

  it('rejects a footprint whose reserved zone touches a walkable-but-unbuildable cell', () => {
    const cells = grassCells(16, 16);
    // One margin CELL at (7,5) - nodes (14..15, 10..11) - inside the hut's reserved ring at odd-row
    // anchor (13,9): x∈[12..15] on rows 9/11, x∈[13..16] on the parity-shifted rows 8/10.
    cells.typeIds[5 * 16 + 7] = MARGIN;
    const sim = new Simulation({ seed: 1, content: marginContent(), map: halfCellMapFromCells(cells) });
    const terrain = terrainOf(sim);
    expect(terrain.isWalkable(terrain.nodeAt(14, 10))).toBe(true); // nav still crosses it
    expect(terrain.isBuildable(terrain.nodeAt(14, 10))).toBe(false); // building may not
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 13, 9)).toBe(false);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 11, 13)).toBe(true); // clear ground
  });
});

describe('bio-pattern placement - wells and hives need grass', () => {
  const BARREN = 2;

  it('rejects a bio-pattern building on buildable barren ground in both the command gate and overlay probe', () => {
    const cells = grassCells(16, 16);
    cells.typeIds[3 * 16 + 3] = BARREN; // nodes (6..7, 6..7), under the fixture body's two cells
    const sim = new Simulation({
      seed: 1,
      content: placementContent(),
      map: halfCellMapFromCells(cells),
    });
    const terrain = terrainOf(sim);

    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, 6, 6)).toBe(true);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, BIO_HUT, 6, 6)).toBe(false);
    expect(placementProbe(sim.world, sim.content, terrain, BIO_HUT).canPlace(6, 6)).toBe(false);

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: BIO_HUT, x: 6, y: 6, tribe: VIKING });
    sim.step();
    expect(buildingsPlaced(sim)).toBe(0);
  });

  it('accepts the same bio-pattern building when its body stands on plantable grass', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, BIO_HUT, 6, 6)).toBe(true);
    expect(placementProbe(sim.world, sim.content, terrain, BIO_HUT).canPlace(6, 6)).toBe(true);
  });
});

describe('forced placement - authored map imports load as-is', () => {
  it('places a rejected footprint when force is set (the original loads scenario houses verbatim)', () => {
    // Water under the reserved ring → the interactive rule rejects this anchor: the water CELL at
    // (5,5) covers nodes (10..11, 10..11), inside the ring of odd-row anchor (9,9) (x∈[8..11] on
    // rows 9/11, x∈[9..12] on the parity-shifted rows 8/10).
    const cells = grassCells(16, 16);
    cells.typeIds[5 * 16 + 5] = WATER;
    const wetSim = new Simulation({
      seed: 1,
      content: placementContent(),
      map: halfCellMapFromCells(cells),
    });
    expect(canPlaceBuilding(wetSim.world, ctxOf(wetSim), terrainOf(wetSim), HUT, 9, 9)).toBe(false);

    wetSim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 9, y: 9, tribe: VIKING });
    wetSim.step();
    expect(buildingsPlaced(wetSim)).toBe(0); // gated command: dropped

    wetSim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 9, y: 9, tribe: VIKING, force: true });
    wetSim.step();
    expect(buildingsPlaced(wetSim)).toBe(1); // authored import: placed as-is
  });
});

describe('building walk-block - houses have collision', () => {
  it('walk-blocks the body cells from the foundation tick and routes paths around them', () => {
    const sim = mappedSim(grassMap(8, 5));
    // A hut whose body occupies nodes (3,1)-(4,1): the straight west→east walk along node row 1 is
    // blocked. (The 8×5-cell map upsamples to 16×10 nodes, so the reserved ring y∈[0..3] fits.)
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      x: 3,
      y: 1,
      tribe: VIKING,
      underConstruction: true,
    });
    sim.step();
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    expect(blocked.has(terrainOf(sim).nodeAt(3, 1))).toBe(true); // a grey foundation already occupies
    expect(blocked.has(terrainOf(sim).nodeAt(4, 1))).toBe(true);
    expect(blocked.has(terrainOf(sim).nodeAt(2, 1))).toBe(false); // the door node stays walkable

    const walker = sim.world.create();
    sim.world.add(walker, Position, positionOfNode(0, 1));
    sim.world.add(walker, PathRequest, {
      start: terrainOf(sim).nodeAt(0, 1),
      goal: terrainOf(sim).nodeAt(7, 1),
      failed: false,
    });
    sim.step();
    // Waypoints back to node coords. A diagonal leg's mid-edge SEAM waypoint sits on an integer row
    // (even hy), so it can never alias the odd-row wall nodes checked below.
    const path = sim.world.get(walker, PathRoute).waypoints.map((w) => {
      const n = nodeOfPosition(w.x, w.y);
      return `${n.hx},${n.hy}`;
    });
    expect(path).not.toContain('3,1');
    expect(path).not.toContain('4,1');
    expect(path[path.length - 1]).toBe('7,1'); // still reaches the far side, routed around the walls
  });

  it('fails a path whose goal is inside a building', () => {
    const sim = mappedSim(grassMap(8, 5));
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 3, y: 1, tribe: VIKING });
    sim.step();
    const walker = sim.world.create();
    sim.world.add(walker, Position, positionOfNode(0, 1));
    sim.world.add(walker, PathRequest, {
      start: terrainOf(sim).nodeAt(0, 1),
      goal: terrainOf(sim).nodeAt(3, 1), // the wall node itself
      failed: false,
    });
    sim.step();
    expect(sim.world.get(walker, PathRequest).failed).toBe(true);
    expect(sim.world.has(walker, PathFollow)).toBe(false);
  });
});

describe('placement razes wild berry bushes in the reserved zone', () => {
  /** The bushes left standing after a step, ascending-id (bushes carry no footprint, so only a placement
   *  razes them). */
  function survivingBushes(sim: Simulation): number {
    return [...sim.world.query(BerryBush)].length;
  }

  it('destroys a bush inside the reserved zone and spares one outside it', () => {
    const sim = mappedSim();
    // HUT reserved ring at odd-row anchor (5,5): rows 4..7, x∈[4..7] on rows 5/7 and x∈[5..8] on the
    // parity-shifted rows 4/6. A bush at (6,6) sits inside it; a bush at (12,12) is well clear
    // (a walkable bush is not a placement obstacle, so both land under/near a house).
    const inside = createBerryBush(sim.world, { x: 6, y: 6 });
    const outside = createBerryBush(sim.world, { x: 12, y: 12 });
    expect(survivingBushes(sim)).toBe(2);

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();

    expect(buildingsPlaced(sim)).toBe(1);
    expect(sim.world.isAlive(inside)).toBe(false); // razed by the new building
    expect(sim.world.isAlive(outside)).toBe(true); // beyond the reserved zone - untouched
    expect(survivingBushes(sim)).toBe(1);
    // The razing announces itself so render can drop the bush's static-decor quad - one event, the razed bush.
    const razed = sim.events.current().filter((ev) => ev.kind === 'berryBushRazed');
    expect(razed.map((ev) => ev.bush)).toEqual([inside]);
  });

  it('razes bushes even under a forced (map-authored) placement', () => {
    const sim = mappedSim();
    const under = createBerryBush(sim.world, { x: 5, y: 5 }); // the anchor node itself
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING, force: true });
    sim.step();
    expect(sim.world.isAlive(under)).toBe(false);
  });
});

describe('placement razes felled-tree stumps in the reserved zone', () => {
  const STUMP_WOOD = 1;
  /** Place an inert felled-tree stump (a Position + Stump marker, as fellNode leaves behind) at a node. */
  function placeStump(sim: Simulation, x: number, y: number) {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(x, y));
    sim.world.add(e, Stump, { goodType: STUMP_WOOD });
    return e;
  }
  function survivingStumps(sim: Simulation): number {
    return [...sim.world.query(Stump)].length;
  }

  it('destroys a stump inside the reserved zone and spares one outside it', () => {
    const sim = mappedSim();
    // HUT reserved ring at odd-row anchor (5,5): rows 4..7, x∈[4..7] on rows 5/7 and x∈[5..8] on the
    // parity-shifted rows 4/6. A stump at (6,6) sits inside it; one at (12,12) is well clear
    // (a stump is inert non-blocking decor, so both land under/near a house).
    const inside = placeStump(sim, 6, 6);
    const outside = placeStump(sim, 12, 12);
    expect(survivingStumps(sim)).toBe(2);

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    sim.step();

    expect(buildingsPlaced(sim)).toBe(1);
    expect(sim.world.isAlive(inside)).toBe(false); // razed by the new building
    expect(sim.world.isAlive(outside)).toBe(true); // beyond the reserved zone - untouched
    expect(survivingStumps(sim)).toBe(1);

    // A stump is a live snapshot-drawn entity (never a static-decor quad), so razing it emits no event at all -
    // the sprite pool reaps its quad when it leaves the snapshot. Proven against a stumpless control: the same
    // placement with no stump present produces the identical event stream.
    const control = mappedSim();
    control.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
    control.step();
    expect(sim.events.current().map((ev) => ev.kind)).toEqual(control.events.current().map((ev) => ev.kind));
  });

  it('razes a stump even under a forced (map-authored) placement', () => {
    const sim = mappedSim();
    const under = placeStump(sim, 5, 5); // the anchor node itself
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING, force: true });
    sim.step();
    expect(sim.world.isAlive(under)).toBe(false);
  });
});

describe('determinism', () => {
  it('two same-seed runs through placement + rejection + pathing hash identically', () => {
    const run = (): string => {
      const sim = mappedSim();
      createBerryBush(sim.world, { x: 6, y: 6 }); // razed by the hut below - its removal must be deterministic
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 5, y: 5, tribe: VIKING });
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 6, y: 5, tribe: VIKING }); // rejected
      sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 5, tribe: VIKING });
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
