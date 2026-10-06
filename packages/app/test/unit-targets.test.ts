import { buildSpriteScene, type DrawItem, ONE } from '@open-northland/render';
import { components, type WorldSnapshot } from '@open-northland/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import { isSettler, ownerPlayerOf } from '../src/game/snapshot.js';
import { fixedViewerSeat, overseerViewerSeat } from '../src/game/viewer-seat.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { pickInRect, pickNearestAt, pickTopAt } from '../src/view/picking.js';
import { createUnitTargets, type UnitTargetsDeps } from '../src/view/unit-controls/unit-targets.js';
import { snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

/**
 * A click may only reach what the renderer's frame actually drew, while an ORDER must reach the whole
 * selection - including units the camera panned away from and one standing inside a building. The siege
 * scene supplies both sides: a human warband facing a red base of enemy buildings and defenders.
 */
describe('unit-controls targets over the renderer frame', () => {
  let snapshot: WorldSnapshot;
  let fullScene: DrawItem[];

  beforeEach(() => {
    const scene = SCENES.find((s) => s.id === 'siege');
    if (scene === undefined) throw new Error('siege scene missing');
    const sim = createSceneSim(scene);
    sim.run(2); // drain the scene's spawn/placement commands
    snapshot = sim.snapshot();
    fullScene = buildSpriteScene(snapshot);
  });

  const targetsOver = (
    drawn: readonly DrawItem[],
    hostileToward: (owner: number) => boolean = () => true,
    resourceVisible?: (tileX: number, tileY: number) => boolean,
    boundsOf?: UnitTargetsDeps['boundsOf'],
    pixelHitOf?: UnitTargetsDeps['pixelHitOf'],
  ): ReturnType<typeof createUnitTargets> =>
    createUnitTargets({
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      hostileToward,
      drawnItems: () => drawn,
      boundsOf,
      pixelHitOf,
      resourceVisible,
    });

  const ownerOf = (ref: number): number | undefined => {
    const entity = snapshot.entities.find((e) => e.id === ref);
    return entity === undefined ? undefined : ownerPlayerOf(entity);
  };

  const firstDrawn = (kind: DrawItem['kind'], player: number): DrawItem => {
    const item = fullScene.find((it) => it.kind === kind && ownerOf(it.ref) === player);
    if (item === undefined) throw new Error(`siege scene drew no ${kind} for player ${player}`);
    return item;
  };

  it('hover uses current ownership, fog gates and bounds without selecting wildlife or livestock', () => {
    const own = { ...firstDrawn('settler', HUMAN_PLAYER), x: 100, y: 200 };
    const enemy = { ...firstDrawn('settler', ENEMY_PLAYER), x: 100, y: 200 };
    expect(targetsOver([own]).hasOwnedAt(100, 200)).toBe(true);
    expect(targetsOver([enemy]).hasOwnedAt(100, 200)).toBe(false);
    const observer = createUnitTargets({
      snapshot: () => snapshot,
      viewer: overseerViewerSeat(HUMAN_PLAYER),
      hostileToward: () => true,
      drawnItems: () => [enemy],
      boundsOf: undefined,
      pixelHitOf: undefined,
    });
    expect(observer.hasOwnedAt(100, 200)).toBe(true);
    for (const gate of [{ ghost: true }, { portraitOnly: true }, { inHouse: true }])
      expect(targetsOver([{ ...own, ...gate }]).hasOwnedAt(100, 200)).toBe(false);
    snapshot = {
      ...snapshot,
      entities: [
        ...snapshot.entities,
        { id: 90010, components: { Settler: {} } },
        { id: 90011, components: { Settler: {}, Owner: { player: HUMAN_PLAYER }, Livestock: {} } },
      ],
    };
    expect(
      targetsOver([
        { ...own, ref: 90010 },
        { ...own, ref: 90011 },
      ]).hasOwnedAt(100, 200),
    ).toBe(false);
    let drawn: readonly DrawItem[] = [own];
    let box = { minX: 90, maxX: 110, minY: 180, maxY: 210 };
    let verdict: boolean | undefined;
    const targets = createUnitTargets({
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      hostileToward: () => true,
      drawnItems: () => drawn,
      boundsOf: () => box,
      pixelHitOf: () => verdict,
    });
    expect(targets.hasOwnedAt(100, 200)).toBe(true);
    box = { minX: 300, maxX: 320, minY: 380, maxY: 410 };
    expect(targets.hasOwnedAt(100, 200)).toBe(false);
    drawn = [{ ...own, kind: 'building', x: 310, y: 400 }];
    verdict = false;
    expect(targets.hasOwnedAt(310, 400)).toBe(false);
    verdict = undefined;
    expect(targets.hasOwnedAt(310, 400)).toBe(true);
    for (const kind of ['settler', 'building', 'palisade', 'roadsite', 'vehicle'] as const) {
      drawn = [{ ...own, kind }];
      for (const [x, y] of [
        [310, 400],
        [322, 400],
        [323, 400],
        [100, 200],
      ] as const)
        expect(targets.hasOwnedAt(x, y)).toBe(pickTopAt(targets.owned(kind), x, y) !== null);
    }
    drawn = [{ ...own, kind: 'roadsite' }];
    expect(targets.hasOwnedAt(322, 400)).toBe(true);
    expect(targets.hasOwnedAt(323, 400)).toBe(false);
    drawn = [];
    expect(targets.hasOwnedAt(310, 400)).toBe(false);
  });

  it('hover excludes synthetic and enemy signposts and keeps the ungrown road fallback', () => {
    const own = {
      ...firstDrawn('settler', HUMAN_PLAYER),
      kind: 'signpost',
      x: 100,
      y: 200,
    } satisfies DrawItem;
    const enemy = {
      ...firstDrawn('settler', ENEMY_PLAYER),
      kind: 'signpost',
      x: 100,
      y: 200,
    } satisfies DrawItem;
    expect(targetsOver([own]).hasSignpostAt(100, 200)).toBe(true);
    expect(targetsOver([enemy]).hasSignpostAt(100, 200)).toBe(false);
    expect(targetsOver([{ ...own, ref: -own.ref }]).hasSignpostAt(100, 200)).toBe(false);
    expect(targetsOver([{ ...own, ghost: true }]).hasSignpostAt(100, 200)).toBe(false);
    const road = { ...own, kind: 'roadsite' } satisfies DrawItem;
    expect(targetsOver([road]).hasOwnedAt(109, 200)).toBe(true);
    expect(targetsOver([road]).hasOwnedAt(110, 200)).toBe(false);
  });

  it('splits the drawn frame into our units and the enemy, with nothing in both', () => {
    const targets = targetsOver(fullScene);
    const owned = targets.owned().map((t) => t.ref);
    const enemies = targets.enemies().map((t) => t.ref);

    expect(owned.length).toBeGreaterThan(0);
    expect(enemies.length).toBeGreaterThan(0);
    for (const ref of owned) expect(ownerOf(ref)).toBe(HUMAN_PLAYER);
    for (const ref of enemies) expect(ownerOf(ref)).toBe(ENEMY_PLAYER);
    expect(owned.filter((ref) => enemies.includes(ref))).toEqual([]);
  });

  it('marquees only visible owned settlers by their drawn sprite, excluding buildings and flags', () => {
    const settler = firstDrawn('settler', HUMAN_PLAYER);
    const building = firstDrawn('building', ENEMY_PLAYER);
    const enemy = firstDrawn('settler', ENEMY_PLAYER);
    const drawn = [settler, building, enemy].map((item) => ({ ...item, x: 100, y: 200 }));
    drawn.push(
      { ...settler, ref: 90001, inHouse: true },
      { ...settler, ref: 90002, ghost: true },
      { ...settler, ref: 90003, portraitOnly: true },
      { ...settler, ref: 90004, kind: 'grounddrop', isFlag: true },
    );
    snapshot = {
      ...snapshot,
      entities: [
        ...snapshot.entities.map((entity) =>
          entity.id === building.ref
            ? { ...entity, components: { ...entity.components, Owner: { player: HUMAN_PLAYER } } }
            : entity,
        ),
        ...drawn.slice(3).map((item) => ({
          id: item.ref,
          components: { Owner: { player: HUMAN_PLAYER } },
        })),
      ],
    };
    const targets = targetsOver(
      drawn,
      () => true,
      undefined,
      () => ({
        minX: 90,
        maxX: 110,
        minY: 80,
        maxY: 120,
      }),
    );
    expect(pickInRect(targets.owned('settler'), 95, 75, 105, 85)).toEqual([settler.ref]);
  });

  it('drops a non-enemy stance holder from the attack set, so an ally click falls through', () => {
    const allied = targetsOver(fullScene, (owner) => owner !== ENEMY_PLAYER);
    expect(allied.enemies()).toEqual([]);

    const atWar = targetsOver(fullScene, (owner) => owner === ENEMY_PLAYER);
    expect(atWar.enemies().length).toBeGreaterThan(0);
  });

  it('offers a neutral palisade to the explicit attack pick only, and never to an observer', () => {
    const neutral = {
      id: 90_040,
      components: {
        Palisade: { gfxIndex: 691 },
        Position: { x: 6 * ONE, y: 8 * ONE },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, neutral] };
    const wall = { ref: neutral.id, kind: 'palisade', x: 200, y: 300, depth: 300 } satisfies DrawItem;

    const targets = targetsOver([wall]);
    expect(targets.enemies({ neutralWalls: true }).map((target) => target.ref)).toEqual([neutral.id]);
    // A plain right-click beside an authored wall walks there instead of striking it.
    expect(targets.enemies()).toEqual([]);
    const observer = createUnitTargets({
      snapshot: () => snapshot,
      viewer: overseerViewerSeat(HUMAN_PLAYER),
      hostileToward: () => true,
      drawnItems: () => [wall],
      boundsOf: undefined,
      pixelHitOf: undefined,
    });
    expect(observer.enemies({ neutralWalls: true })).toEqual([]);
  });

  it('hits an own palisade anywhere in its sprite box, gaps between the posts included', () => {
    const own = {
      id: 90_041,
      components: {
        Palisade: { gfxIndex: 691 },
        Position: { x: 6 * ONE, y: 8 * ONE },
        Owner: { player: HUMAN_PLAYER },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, own] };
    const wall = { ref: own.id, kind: 'palisade', x: 200, y: 300, depth: 300 } satisfies DrawItem;
    const targets = createUnitTargets({
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      hostileToward: () => true,
      drawnItems: () => [wall],
      boundsOf: () => ({ minX: 180, maxX: 220, minY: 230, maxY: 305 }),
      pixelHitOf: () => false,
    });
    expect(pickTopAt(targets.owned('palisade'), 205, 280)).toBe(own.id);
  });

  it('reaches only what the frame drew - a culled unit is not clickable', () => {
    const dropped = firstDrawn('settler', HUMAN_PLAYER);
    const owned = targetsOver(fullScene.filter((it) => it !== dropped))
      .owned()
      .map((t) => t.ref);

    expect(owned).not.toContain(dropped.ref);
    expect(owned.length).toBe(targetsOver(fullScene).owned().length - 1);
  });

  it('exposes visible resource nodes as right-click targets', () => {
    const resource = {
      ref: 90_020,
      kind: 'resource',
      x: 120,
      y: 80,
      depth: 80,
      goodType: 4,
    } satisfies DrawItem;

    expect(targetsOver([resource]).resources()).toEqual([
      {
        ref: resource.ref,
        x: resource.x,
        y: resource.y,
        kind: 'resource',
        box: undefined,
        goodType: resource.goodType,
      },
    ]);
    expect(targetsOver([{ ...resource, ghost: true }]).resources()).toEqual([]);
  });

  it('projects retained map resources that are absent from the entity draw list', () => {
    const resource = {
      id: 90_021,
      components: {
        Position: { x: 4 * ONE, y: 6 * ONE },
        LandscapeResource: { id: 10 },
        Resource: { goodType: 5 },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, resource] };

    expect(targetsOver([]).resources()).toEqual([
      { ref: resource.id, x: 8 * 34, y: 6 * 38, kind: 'resource', goodType: 5 },
    ]);
    expect(
      targetsOver(
        [],
        () => true,
        () => false,
      ).resources(),
    ).toEqual([]);
  });

  it('hit-tests a resource on its drawn pixels, so the ground beside a mushroom is not the mushroom', () => {
    const drawn = { ref: 90_022, kind: 'resource', x: 120, y: 80, depth: 80, goodType: 4 } satisfies DrawItem;
    const retained = {
      id: 90_023,
      components: {
        Position: { x: 4 * ONE, y: 6 * ONE },
        LandscapeResource: { id: 10 },
        Resource: { goodType: 5 },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, retained] };
    const box = { minX: 100, maxX: 140, minY: 40, maxY: 90 };
    const solid = new Set<string>([`${drawn.ref}:120,70`, `${retained.id}:120,70`]);
    const targets = targetsOver(
      [drawn],
      () => true,
      undefined,
      () => box,
      (ref, wx, wy) => solid.has(`${ref}:${wx},${wy}`),
    );

    const resources = targets.resources();
    expect(resources.map((t) => t.box)).toEqual([box, box]);
    // Inside the box on a solid texel: hit. Inside the box on a transparent one: ground.
    for (const target of resources) {
      expect(pickNearestAt([target], 120, 70)).toBe(target.ref);
      expect(pickNearestAt([target], 125, 70)).toBeNull();
    }
  });

  it('hit-tests a drop-off flag against its drawn bounds, which ride the terrain lift', () => {
    const FLAG = 90_030;
    const GATHERER = 90_031;
    const LIFT = 80;
    const gatherer = {
      id: GATHERER,
      components: {
        Settler: {},
        Owner: { player: HUMAN_PLAYER },
        Position: { x: 6 * ONE, y: 8 * ONE },
        WorkFlag: { flag: FLAG, radius: 24 },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, gatherer] };
    const flag = {
      ref: FLAG,
      kind: 'stockpile',
      x: 200,
      y: 300,
      depth: 300,
      isFlag: true,
      lift: LIFT,
    } satisfies DrawItem;
    const drawnFlag = { minX: 190, minY: flag.y - LIFT - 50, maxX: 215, maxY: flag.y - LIFT + 4 };
    const targets = targetsOver([flag], undefined, undefined, (ref) =>
      ref === FLAG ? drawnFlag : undefined,
    );

    expect(pickTopAt(targets.flags(), 205, flag.y - LIFT - 40)).toBe(GATHERER);
    expect(targets.hasFlagAt(205, flag.y - LIFT - 40)).toBe(true);
    expect(targets.hasFlagAt(flag.x, flag.y)).toBe(false);
    expect(pickTopAt(targets.flags(), flag.x, flag.y)).toBeNull(); // the ground the flag was lifted off
  });

  it('never targets a fog ghost or the force-drawn portrait subject', () => {
    // A remembered enemy structure the fog has swallowed, and our own selected settler force-drawn for
    // the details-panel portrait: both are in the draw list, neither is under the cursor.
    const enemyBuilding = firstDrawn('building', ENEMY_PLAYER);
    const ownSettler = firstDrawn('settler', HUMAN_PLAYER);
    const targets = targetsOver(
      fullScene.map((it) => {
        if (it === enemyBuilding) return { ...it, ghost: true };
        if (it === ownSettler) return { ...it, portraitOnly: true };
        return it;
      }),
    );

    expect(targets.enemies().map((t) => t.ref)).not.toContain(enemyBuilding.ref);
    expect(targets.owned().map((t) => t.ref)).not.toContain(ownSettler.ref);
  });

  it('still issues orders to a selection the camera panned away from, front to back', () => {
    // Expected from the SNAPSHOT, not the projection - an order set derived from the draw list would
    // agree with itself about a settler both of them omit.
    const ourSettlers = snapshot.entities
      .filter((e) => isSettler(e) && ownerPlayerOf(e) === HUMAN_PLAYER)
      .map((e) => e.id);
    const enemySettler = firstDrawn('settler', ENEMY_PLAYER);
    expect(ourSettlers.length).toBeGreaterThan(0);

    // An empty frame: everything selected is off screen, and every one of ours must still take the order.
    const targets = targetsOver([]);
    const commanded = targets.ownedSettlersIn(new Set([...ourSettlers, enemySettler.ref]));
    expect([...commanded.map((t) => t.ref)].sort((a, b) => a - b)).toEqual(
      [...ourSettlers].sort((a, b) => a - b),
    );
    // …and in the drawn scene's own total order, which decides the formation slot each one is paired to.
    expect(commanded).toEqual([...commanded].sort((a, b) => a.y - b.y || a.x - b.x || a.ref - b.ref));
    expect(targets.owned()).toEqual([]); // the hit-test set stays screen-bounded
  });

  it('never picks or orders claimed livestock - the herd is property, not units', () => {
    // A claimed animal is a Settler-shaped entity with the Livestock marker and our Owner: drawn (and
    // heart-badged), but the herd drives itself, so neither a click/marquee nor an order may take it.
    const animal = {
      id: 90_002,
      components: {
        Settler: {},
        Livestock: {},
        Owner: { player: HUMAN_PLAYER },
        Position: { x: 6 * ONE, y: 8 * ONE },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, animal] };
    const drawnAnimal = { ...firstDrawn('settler', HUMAN_PLAYER), ref: animal.id };
    const targets = targetsOver([...fullScene, drawnAnimal]);

    expect(targets.owned().map((t) => t.ref)).not.toContain(animal.id);
    expect(targets.ownedSettlersIn(new Set([animal.id]))).toEqual([]);
  });

  it('picks wild game for the strike but never a person or claimed livestock', () => {
    // Wildlife shares the Settler model and carries no `Person` and no owner: it is the only thing the
    // "attack animal" order may reach.
    const deer = {
      id: 90_010,
      components: { Settler: {}, Position: { x: 6 * ONE, y: 8 * ONE } },
    };
    const cow = {
      id: 90_011,
      components: {
        Settler: {},
        Livestock: {},
        Owner: { player: HUMAN_PLAYER },
        Position: { x: 7 * ONE, y: 8 * ONE },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, deer, cow] };
    const template = firstDrawn('settler', HUMAN_PLAYER);
    const targets = targetsOver([...fullScene, { ...template, ref: deer.id }, { ...template, ref: cow.id }]);

    expect(targets.wildlife().map((t) => t.ref)).toEqual([deer.id]);
  });

  it('orders a settler the frame never draws, such as one standing inside a building', () => {
    // Indoor settlers (the `Resting` marker, or mid-exchange in a store) are deliberately not drawn, so
    // the frame cannot supply them - the order set reads the snapshot instead and still reaches them.
    const indoor = {
      id: 90_001,
      components: {
        Settler: {},
        Owner: { player: HUMAN_PLAYER },
        Position: { x: 5 * ONE, y: 7 * ONE },
        Resting: {},
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, indoor] };
    expect(buildSpriteScene(snapshot).some((it) => it.ref === indoor.id)).toBe(false);

    const commanded = targetsOver([]).ownedSettlersIn(new Set([indoor.id]));
    expect(commanded.map((t) => t.ref)).toEqual([indoor.id]);
  });

  it('never orders a settler a script put out of reach', () => {
    const escort = {
      id: 90_003,
      components: {
        Settler: {},
        Owner: { player: HUMAN_PLAYER },
        Position: { x: 5 * ONE, y: 7 * ONE },
        MissionBehaviour: { flags: components.MISSION_BEHAVIOUR.NOT_CONTROLLABLE },
      },
    };
    snapshot = { ...snapshot, entities: [...snapshot.entities, escort] };

    expect(targetsOver([]).ownedSettlersIn(new Set([escort.id]))).toEqual([]);
  });
});

describe('the ordered set', () => {
  it('looks the selection up instead of walking the world', () => {
    const WORLD_SIZE = 2000;
    const SELECTED = [7, 1500];
    const world = snapshotOf(
      Array.from({ length: WORLD_SIZE }, (_, id) => ({
        id,
        components: { Settler: {}, Owner: { player: HUMAN_PLAYER }, Position: { x: id * ONE, y: ONE } },
      })),
    );
    const { snapshot, visits } = visitCountingSnapshot(world);
    const targets = createUnitTargets({
      snapshot: () => snapshot,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      hostileToward: () => true,
      drawnItems: () => [],
      boundsOf: undefined,
      pixelHitOf: undefined,
    });

    expect(targets.ownedSettlersIn(new Set(SELECTED)).map((t) => t.ref)).toEqual(SELECTED);
    // Two binary searches, not one visit per entity.
    expect(visits()).toBeLessThan(WORLD_SIZE / 10);
  });
});
