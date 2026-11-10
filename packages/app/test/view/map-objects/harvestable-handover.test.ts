import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindHarvestableHandover } from '../../../src/view/map-objects/harvestable-handover.js';
import { SightDeferral } from '../../../src/view/map-objects/sight-deferral.js';
import { testSight } from '../../support/sight.js';

/** The static→dynamic draw split for a decoded map's harvestables. The handover treats a sprite as an
 *  opaque handle, so these fixtures name themselves instead of standing up Pixi textures. */

/** A fake static layer recording what the handover retired, in order. */
function surfaceSpy() {
  const removed: string[] = [];
  let refs: ReadonlySet<number> = new Set();
  return {
    removed,
    refs: (): ReadonlySet<number> => refs,
    surface: {
      setStaticallyDrawnRefs: (next: ReadonlySet<number>): void => {
        refs = next;
      },
      removeMapObject: (sprite: string): void => {
        removed.push(sprite);
      },
    },
  };
}

/** A viewer whose sight the test moves: `seen` holds the watched placements' nodes as `hx,hy`. */
function sightOf(seen: Set<string> | 'all' = 'all') {
  const view = testSight((hx, hy) => seen === 'all' || seen.has(`${hx},${hy}`));
  return { sight: new SightDeferral(view), moved: () => view.look() };
}

/** Placement 0 stands on node (1, 2), placement 1 on (3, 4). */
const NODES = new Map([
  [0, { hx: 1, hy: 2 }],
  [1, { hx: 3, hy: 4 }],
]);
const nodeOf = (placement: number) => NODES.get(placement);
const bind = (spy: ReturnType<typeof surfaceSpy>, sight = sightOf().sight) =>
  bindHarvestableHandover(spy.surface, BOUND, SPRITES, sight, nodeOf);

const AT = { hx: 0, hy: 0 };
const entity = (id: number): Entity => id as Entity;

const felled = (node: number): SimEvent => ({
  kind: 'resourceFelled',
  node: entity(node),
  trunk: entity(900),
  stump: entity(901),
  goodType: 1,
  amount: 1,
  at: AT,
});
const mined = (node: number): SimEvent => ({
  kind: 'resourceMined',
  node: entity(node),
  goodType: 1,
  at: AT,
});
const depleted = (node: number): SimEvent => ({
  kind: 'resourceDepleted',
  node: entity(node),
  goodType: 1,
  at: AT,
});
const foraged = (bush: number): SimEvent => ({ kind: 'berryForaged', bush: entity(bush), at: AT });
const razed = (bush: number): SimEvent => ({ kind: 'berryBushRazed', bush: entity(bush), at: AT });
const grew = (bush: number): SimEvent => ({ kind: 'berryBushGrew', bush: entity(bush), at: AT });

/** Every event that means "this harvestable changed for the first time", worked or grown, on a fitting fixture. */
const WORKED = [
  { kind: 'felled', event: felled, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'mined', event: mined, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'depleted', event: depleted, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'foraged', event: foraged, node: 11, sprite: 'bush', remaining: 10 },
  { kind: 'grown', event: grew, node: 11, sprite: 'bush', remaining: 10 },
] as const;

/** Entities 10 and 11 sit on placements 0 and 1; entity 12's placement never resolved to a sprite. */
const BOUND: readonly (readonly [Entity, number])[] = [
  [entity(10), 0],
  [entity(11), 1],
  [entity(12), 9],
];
const SPRITES = new Map([
  [0, 'tree'],
  [1, 'bush'],
]);

describe('harvestable static-draw handover', () => {
  it('claims the bound entities as statically drawn, unresolved placements aside', () => {
    const spy = surfaceSpy();

    bind(spy);

    expect([...spy.refs()]).toEqual([10, 11]);
  });

  it.each(WORKED)('hands a $kind harvestable to the pool once', ({ event, node, sprite, remaining }) => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    if (handover === null) throw new Error('expected a handover for bound sprites');
    const { onEvents } = handover;

    onEvents([event(node)]);
    onEvents([event(node)]);

    expect(spy.removed).toEqual([sprite]);
    expect([...spy.refs()]).toEqual([remaining]);
  });

  it('drops a razed bush', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    if (handover === null) throw new Error('expected a handover for bound sprites');
    const { onEvents } = handover;

    onEvents([razed(11)]);

    expect(spy.removed).toEqual(['bush']);
    expect([...spy.refs()]).toEqual([10]);
  });

  it('drops every node a road or wall cleared', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    handover?.onEvents([{ kind: 'groundCleared', nodes: [AT], razed: [entity(10), entity(11), entity(12)] }]);

    expect(spy.removed.sort()).toEqual(['bush', 'tree']);
    expect([...spy.refs()]).toEqual([]);
  });

  it('retires a script-removed resource', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    handover?.onEvents([{ kind: 'missionLandscapeResourceRemoved', entity: entity(10) }]);
    expect(spy.removed).toEqual(['tree']);
    expect([...spy.refs()]).toEqual([11]);
  });

  it('keeps a node worked in the fog statically drawn until the viewer sees its node', () => {
    const spy = surfaceSpy();
    const seen = new Set<string>();
    const { sight, moved } = sightOf(seen);
    const handover = bindHarvestableHandover(spy.surface, BOUND, SPRITES, sight, nodeOf);
    handover?.onEvents([felled(10)]);
    sight.flush();
    expect(spy.removed).toEqual([]);
    expect(handover?.spriteOf(10)).toBe('tree');
    expect([...spy.refs()]).toEqual([10, 11]);
    seen.add('1,2');
    moved();
    sight.flush();
    expect(spy.removed).toEqual(['tree']);
    expect([...spy.refs()]).toEqual([11]);
  });

  it('ignores events for entities it never drew statically', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    if (handover === null) throw new Error('expected a handover for bound sprites');
    const { onEvents } = handover;

    onEvents([foraged(12), felled(99)]);

    expect(spy.removed).toEqual([]);
    expect([...spy.refs()]).toEqual([10, 11]);
  });

  it('mutates the set the renderer holds instead of replacing it', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    if (handover === null) throw new Error('expected a handover for bound sprites');
    const { onEvents } = handover;
    const held = spy.refs();

    onEvents([foraged(11)]);

    expect(spy.refs()).toBe(held);
    expect([...held]).toEqual([10]);
  });

  it('names the quad still drawing a node until that node is handed over', () => {
    const spy = surfaceSpy();
    const handover = bind(spy);
    if (handover === null) throw new Error('expected a handover for bound sprites');

    expect(handover.spriteOf(10)).toBe('tree');
    expect(handover.spriteOf(12)).toBeUndefined();
    handover.onEvents([felled(10)]);
    expect(handover.spriteOf(10)).toBeUndefined();
    expect(handover.spriteOf(11)).toBe('bush');
  });

  it('reports no handover when nothing resolved to a static sprite', () => {
    const spy = surfaceSpy();

    expect(bindHarvestableHandover(spy.surface, BOUND, new Map(), sightOf().sight, nodeOf)).toBeNull();
    expect([...spy.refs()]).toEqual([]);
  });
});
