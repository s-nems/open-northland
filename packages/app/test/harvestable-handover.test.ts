import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { bindHarvestableHandover } from '../src/view/harvestable-handover.js';

/** The static→dynamic draw split for a decoded map's harvestables. The handover treats a sprite as an
 *  opaque handle, so these fixtures name themselves instead of standing up Pixi textures. */

/** A fake static layer recording what the handover retired, in order. */
function surfaceSpy() {
  const removed: string[] = [];
  const ghosts: number[] = [];
  let refs: ReadonlySet<number> = new Set();
  return {
    removed,
    ghosts,
    refs: (): ReadonlySet<number> => refs,
    surface: {
      setStaticallyDrawnRefs: (next: ReadonlySet<number>): void => {
        refs = next;
      },
      removeMapObject: (sprite: string): void => {
        removed.push(sprite);
      },
      adoptFogGhost: (entity: number): void => {
        ghosts.push(entity);
      },
    },
  };
}

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

/** Every event that means "this harvestable was worked for the first time", on a fitting fixture. */
const WORKED = [
  { kind: 'felled', event: felled, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'mined', event: mined, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'depleted', event: depleted, node: 10, sprite: 'tree', remaining: 11 },
  { kind: 'foraged', event: foraged, node: 11, sprite: 'bush', remaining: 10 },
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

    bindHarvestableHandover(spy.surface, BOUND, SPRITES);

    expect([...spy.refs()]).toEqual([10, 11]);
  });

  it.each(WORKED)('hands a $kind harvestable to the pool once, keeping its fog ghost', ({
    event,
    node,
    sprite,
    remaining,
  }) => {
    const spy = surfaceSpy();
    const onEvents = bindHarvestableHandover(spy.surface, BOUND, SPRITES);
    if (onEvents === null) throw new Error('expected a handover for bound sprites');

    onEvents([event(node)]);
    onEvents([event(node)]);

    expect(spy.removed).toEqual([sprite]);
    expect(spy.ghosts).toEqual([node]);
    expect([...spy.refs()]).toEqual([remaining]);
  });

  it('drops a razed bush without leaving a fog ghost', () => {
    const spy = surfaceSpy();
    const onEvents = bindHarvestableHandover(spy.surface, BOUND, SPRITES);
    if (onEvents === null) throw new Error('expected a handover for bound sprites');

    onEvents([razed(11)]);

    expect(spy.removed).toEqual(['bush']);
    expect(spy.ghosts).toEqual([]);
    expect([...spy.refs()]).toEqual([10]);
  });

  it('ignores events for entities it never drew statically', () => {
    const spy = surfaceSpy();
    const onEvents = bindHarvestableHandover(spy.surface, BOUND, SPRITES);
    if (onEvents === null) throw new Error('expected a handover for bound sprites');

    onEvents([foraged(12), felled(99)]);

    expect(spy.removed).toEqual([]);
    expect([...spy.refs()]).toEqual([10, 11]);
  });

  it('mutates the set the renderer holds instead of replacing it', () => {
    const spy = surfaceSpy();
    const onEvents = bindHarvestableHandover(spy.surface, BOUND, SPRITES);
    if (onEvents === null) throw new Error('expected a handover for bound sprites');
    const held = spy.refs();

    onEvents([foraged(11)]);

    expect(spy.refs()).toBe(held);
    expect([...held]).toEqual([10]);
  });

  it('reports no handover when nothing resolved to a static sprite', () => {
    const spy = surfaceSpy();

    expect(bindHarvestableHandover(spy.surface, BOUND, new Map())).toBeNull();
    expect([...spy.refs()]).toEqual([]);
  });
});
