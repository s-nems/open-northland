import { describe, expect, it } from 'vitest';
import { buildScene, type SceneTerrain } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** Unit tests for {@link buildScene}'s gathering-economy classification — resource nodes, ground drops,
 *  and stockpile piles/flags resolve to the right draw kind + fields. */

const FLAT_3x2: SceneTerrain = { width: 3, height: 2, typeIds: [1, 1, 2, 2, 1, 1] };

describe('buildScene — resource + stockpile (gathering economy) classification', () => {
  it("carries a resource node's goodType (the per-good node join key)", () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Resource: { goodType: 7, remaining: 5 } })]),
      FLAT_3x2,
    );
    const node = scene.find((d) => d.kind === 'resource');
    expect(node?.goodType).toBe(7);
    expect(node?.fill).toBeUndefined(); // a node has no fill amount (that's a pile's)
  });

  it('carries a MINED node its fill level (MineDeposit + Resource.remaining); a plain node carries none', () => {
    // A half-mined deposit: remaining 5 of 10 over 5 levels → level 3 (ceil(5·5/10)).
    const mined = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Resource: { goodType: 4, remaining: 5 }, MineDeposit: { initial: 10, levels: 5 } }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'resource');
    expect(mined?.level).toBe(3);
    expect(mined?.levels).toBe(5); // the ladder size rides along so the resolver can rescale it
    // A plain node (no MineDeposit) carries no level — the binding draws its full-state frame.
    const plain = buildScene(
      snapshotOf([entity(1, 1, 1, { Resource: { goodType: 4, remaining: 5 } })]),
      FLAT_3x2,
    ).find((d) => d.kind === 'resource');
    expect(plain?.level).toBeUndefined();
    expect(plain?.levels).toBeUndefined();
  });

  it('classifies a bare Stockpile (no Building) as a stockpile, carrying its dominant good + fill', () => {
    // The snapshot clones a Stockpile.amounts Map to an ascending-by-goodType [good, amount] array.
    const scene = buildScene(snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [[3, 4]] } })]), FLAT_3x2);
    const pile = scene.find((d) => d.kind === 'stockpile');
    expect(pile).toBeDefined();
    expect(pile?.goodType).toBe(3);
    expect(pile?.fill).toBe(4);
  });

  it('reads an EMPTY bare Stockpile as a flag: stockpile kind, no goodType, no fill', () => {
    const scene = buildScene(snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [] } })]), FLAT_3x2);
    const flag = scene.find((d) => d.kind === 'stockpile');
    expect(flag).toBeDefined();
    expect(flag?.goodType).toBeUndefined();
    expect(flag?.fill).toBeUndefined();
  });

  it('classifies a Stockpile carrying a GroundDrop marker as a grounddrop (the felled trunk), not a flag', () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Stockpile: { amounts: [[3, 9]] }, GroundDrop: { goodType: 3 } })]),
      FLAT_3x2,
    );
    const drop = scene.find((d) => d.kind === 'grounddrop');
    expect(drop?.goodType).toBe(3); // its held good keys the per-good pickup (trunk) graphic
    expect(scene.find((d) => d.kind === 'stockpile')).toBeUndefined(); // never the flag/heap path
  });

  it('picks the dominant good (most units, lowest goodType on a tie) for a mixed pile', () => {
    // amounts ascending by goodType: good 2 has 5 units (the max), good 5 has 3 → dominant is good 2.
    const most = buildScene(
      snapshotOf([
        entity(1, 1, 1, {
          Stockpile: {
            amounts: [
              [2, 5],
              [5, 3],
            ],
          },
        }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'stockpile');
    expect(most?.goodType).toBe(2);
    expect(most?.fill).toBe(5);
    // On a tie the first (lowest goodType) wins — deterministic, order-independent.
    const tie = buildScene(
      snapshotOf([
        entity(1, 1, 1, {
          Stockpile: {
            amounts: [
              [2, 3],
              [5, 3],
            ],
          },
        }),
      ]),
      FLAT_3x2,
    ).find((d) => d.kind === 'stockpile');
    expect(tie?.goodType).toBe(2);
  });

  it('keeps a building store (Building + Stockpile) a building, never a stockpile', () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 1, { Building: { buildingType: 7 }, Stockpile: { amounts: [[1, 10]] } })]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'building')).toBeDefined();
    expect(scene.find((d) => d.kind === 'stockpile')).toBeUndefined();
  });
});
