import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { colonyStoreType } from '../../../../src/systems/computer-player/colony/store-type.js';
import { colonyContent, colonyWorld } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT, STOCK_TOP_TYPE, STOCK_TYPE, VIKING } from '../support.js';

/** `content` with the store chain joined, its top tier banned for the seat's tribe when `topBanned`. */
function chainedStores(content: ContentSet, topBanned = false): ContentSet {
  const buildings = content.buildings.map((b) =>
    b.typeId === STOCK_TYPE ? { ...b, upgradeTarget: STOCK_TOP_TYPE } : b,
  );
  if (!topBanned) return { ...content, buildings };
  const all = <T extends { readonly typeId: number }>(rows: readonly T[]) => rows.map((r) => r.typeId);
  const tribes = content.tribes.map((t) =>
    t.typeId === VIKING
      ? {
          ...t,
          permissions: {
            job: all(content.jobs),
            house: all(buildings).filter((id) => id !== STOCK_TOP_TYPE),
            good: all(content.goods),
          },
        }
      : t,
  );
  return { ...content, buildings, tribes };
}
describe('a colony warehouse', () => {
  it('is placed at the top tier once the tribe has it, else at the highest it has', () => {
    const top = colonyWorld(7, chainedStores(colonyContent()));
    expect(colonyStoreType(top.world, ctxOf(top), SEAT)?.typeId).toBe(STOCK_TOP_TYPE);
    const banned = colonyWorld(7, chainedStores(colonyContent(), true));
    expect(colonyStoreType(banned.world, ctxOf(banned), SEAT)?.typeId).toBe(STOCK_TYPE);
  });
});
