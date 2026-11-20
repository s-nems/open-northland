import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import { messages } from '../../../../src/i18n/index.js';
import { natureName, natureTargetOf } from '../../../../src/view/unit-controls/action-hint/nature-name.js';
import type { PointHits } from '../../../../src/view/unit-controls/unit-targets.js';
import { snapshotOf } from '../../../support/snapshot.js';

const CONTENT = sandboxContent();
const IRON = CONTENT.goods.find((good) => good.id === 'iron')?.typeId ?? -1;
/** The `misc` row the original names an iron deposit by. */
const IRON_DEPOSIT_ROW = 104;
const DEER = 10;
const RABBIT = 11;
const ORE = 20;
const CHEST = 30;
const FOOD_CHEST = 20;

const NOTHING: PointHits = {
  ownSettler: null,
  ownVehicle: null,
  ownBuilding: null,
  site: null,
  building: null,
  enemy: null,
  enemySettler: null,
  wildlife: null,
  claimableLivestock: null,
  creature: null,
  chest: null,
  pile: null,
  resource: null,
};

describe('the nature name', () => {
  it("names what the order aims at, else the frontmost animal, and nothing over a card's target", () => {
    const hit: PointHits = {
      ...NOTHING,
      creature: RABBIT,
      wildlife: DEER,
      resource: { ref: ORE, goodType: IRON },
    };
    const hunt = {
      tone: 'action',
      action: 'hunt',
      job: null,
      target: { kind: 'creature', ref: DEER },
    } as const;
    expect(natureTargetOf(hit, hunt)).toEqual({ kind: 'creature', ref: DEER });
    expect(natureTargetOf(hit, null)).toEqual({ kind: 'creature', ref: RABBIT });
    expect(natureTargetOf({ ...NOTHING, resource: { ref: ORE, goodType: IRON } }, null)).toEqual({
      kind: 'resource',
      ref: ORE,
    });
    expect(natureTargetOf({ ...hit, building: 1 }, null)).toBeNull();
  });

  it("names a deposit by the game's landscape string", () => {
    expect(IRON).toBeGreaterThan(0);
    const ctx = {
      snapshot: snapshotOf([]),
      content: CONTENT,
      uiString: (table: string, id: number, fallback: string) =>
        table === 'misc' && id === IRON_DEPOSIT_ROW ? 'Iron deposit' : fallback,
    };
    const hit = { ...NOTHING, resource: { ref: ORE, goodType: IRON } };
    expect(natureName(ctx, { kind: 'resource', ref: ORE }, hit)).toBe('Iron deposit');
  });

  it("adds what a chest holds only where the observer's line is given", () => {
    const snapshot = snapshotOf([
      { id: CHEST, components: { Chest: { kind: 'wooden', contents: FOOD_CHEST } } },
    ]);
    const ctx = {
      snapshot,
      content: CONTENT,
      uiString: (_t: string, _id: number, fallback: string) => fallback,
    };
    const hit = { ...NOTHING, chest: CHEST };
    const target = { kind: 'chest', ref: CHEST } as const;
    const name = messages().hud.chest.wooden;
    expect(natureName(ctx, target, hit)).toBe(name);
    const observer = { ...ctx, chestContents: (chest: { readonly id: number }) => `held ${chest.id}` };
    expect(natureName(observer, target, hit)).toBe(`${name} · held ${CHEST}`);
  });
});
