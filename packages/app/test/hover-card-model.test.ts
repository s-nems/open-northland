import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CHILD_MALE, JOB_JOINER } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  BUILDING_JOINERY,
  BUILDING_JOINERY_01,
  BUILDING_WAREHOUSE_00,
  BUILDING_WATCHTOWER,
  GOOD_IRON,
  GOOD_STONE,
  GOOD_WOOD,
} from '../src/game/sandbox/ids/index.js';
import { fixedViewerSeat, overseerViewerSeat, type ViewerSeat } from '../src/game/viewer-seat.js';
import { type BuildingHoverContext, buildingHoverModel } from '../src/hud/hover-card/building.js';
import { settlerHoverModel } from '../src/hud/hover-card/settler.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

/** A store holding these amounts, as the snapshot carries them. */
function stockpile(amounts: readonly (readonly [number, number])[]): Record<string, unknown> {
  return { Stockpile: { amounts: amounts.map(([goodType, amount]) => [goodType, amount]) } };
}

/** Another seat than the viewer's. */
const OTHER_PLAYER = HUMAN_PLAYER + 1;

/** The card's content, read by the human seat unless another viewer is given. */
function hoverCtx(viewer: ViewerSeat = fixedViewerSeat(HUMAN_PLAYER)): BuildingHoverContext {
  return { ...sandboxCtx(), viewer };
}

describe('building hover card model', () => {
  it('lists what a standing store holds, by good name, leaving its empty slots out', () => {
    const ctx = hoverCtx();
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WAREHOUSE_00, {
        components: stockpile([
          [GOOD_WOOD, 4],
          [GOOD_IRON, 0],
          [GOOD_STONE, 2],
        ]),
      }),
    ]);

    const model = buildingHoverModel(snapshot, 1, ctx);

    expect(model?.title).toBe('Magazyn (poziom 1)');
    expect(model?.state).toBeNull();
    expect(model?.rows).toEqual([
      { goodId: 'stone', label: 'stone', amount: 2 },
      { goodId: 'wood', label: 'wood', amount: 4 },
    ]);
  });

  it('reads a site as its bill against what is delivered, with the built percentage', () => {
    const ctx = hoverCtx();
    const snapshot = snapshotOf([
      buildingEntity(2, BUILDING_JOINERY, {
        built: ONE / 4,
        components: { UnderConstruction: { labor: 0 }, ...stockpile([[GOOD_WOOD, 2]]) },
      }),
    ]);

    const model = buildingHoverModel(snapshot, 2, ctx);

    expect(model?.state).toEqual({ kind: 'construction', pct: 25 });
    expect(model?.rows).toEqual([
      { goodId: 'stone', label: 'stone', amount: 0, needed: 2 },
      { goodId: 'wood', label: 'wood', amount: 2, needed: 3 },
    ]);
  });

  it('reads an upgrading building as the upgrade, against the target tier cost', () => {
    const ctx = hoverCtx();
    const target = ctx.buildings.find((b) => b.typeId === BUILDING_JOINERY_01);
    const snapshot = snapshotOf([
      buildingEntity(3, BUILDING_JOINERY, {
        components: { UnderConstruction: { labor: 0 }, Upgrading: {} },
      }),
    ]);

    const model = buildingHoverModel(snapshot, 3, ctx);

    const goodId = (typeId: number): string | undefined => ctx.goods.find((g) => g.typeId === typeId)?.id;
    expect(model?.state?.kind).toBe('upgrade');
    expect(new Map(model?.rows.map((row) => [row.goodId, row.needed]))).toEqual(
      new Map((target?.construction ?? []).map((line) => [goodId(line.goodType), line.amount])),
    );
  });

  it('names a building that holds nothing, so every kind answers the cursor', () => {
    const ctx = hoverCtx();
    const snapshot = snapshotOf([buildingEntity(4, BUILDING_WATCHTOWER)]);

    const model = buildingHoverModel(snapshot, 4, ctx);

    expect(model?.title).toBe('Wieża strażnicza (poziom 1)');
    expect(model?.rows).toEqual([]);
  });

  it("shows another seat's building by its health, keeping its store and bill to the owner", () => {
    const ctx = hoverCtx();
    const foreign = { Owner: { player: OTHER_PLAYER }, Health: { hitpoints: 30, max: 120 } };
    const snapshot = snapshotOf([
      buildingEntity(6, BUILDING_WAREHOUSE_00, {
        components: { ...foreign, ...stockpile([[GOOD_WOOD, 4]]) },
      }),
      buildingEntity(7, BUILDING_JOINERY, {
        built: ONE / 2,
        components: { ...foreign, UnderConstruction: { labor: 0 }, ...stockpile([[GOOD_WOOD, 2]]) },
      }),
    ]);

    const store = buildingHoverModel(snapshot, 6, ctx);
    const site = buildingHoverModel(snapshot, 7, ctx);

    expect(store?.rows).toEqual([]);
    expect(store?.health).toEqual({ label: 'Zdrowie', pct: 25, hover: '30/120' });
    expect(site?.rows).toEqual([]);
    expect(site?.state).toEqual({ kind: 'construction', pct: 50 });
  });

  it('lists the own store without a health line, and every store on the whole map', () => {
    const snapshot = snapshotOf([
      buildingEntity(8, BUILDING_WAREHOUSE_00, {
        components: { Health: { hitpoints: 30, max: 120 }, ...stockpile([[GOOD_WOOD, 4]]) },
      }),
      buildingEntity(9, BUILDING_WAREHOUSE_00, {
        components: { Owner: { player: OTHER_PLAYER }, ...stockpile([[GOOD_STONE, 1]]) },
      }),
    ]);

    const own = buildingHoverModel(snapshot, 8, hoverCtx());
    const overseen = buildingHoverModel(snapshot, 9, hoverCtx(overseerViewerSeat(HUMAN_PLAYER)));

    expect(own?.health).toBeNull();
    expect(own?.rows).toEqual([{ goodId: 'wood', label: 'wood', amount: 4 }]);
    expect(overseen?.health).toBeNull();
    expect(overseen?.rows).toEqual([{ goodId: 'stone', label: 'stone', amount: 1 }]);
  });

  it('has nothing to say about an entity that is not a building', () => {
    const ctx = hoverCtx();
    const snapshot = snapshotOf([{ id: 5, components: { Settler: { jobType: 1 } } }]);

    expect(buildingHoverModel(snapshot, 5, ctx)).toBeNull();
    expect(buildingHoverModel(snapshot, 99, ctx)).toBeNull();
  });
});

/** A person as the snapshot carries one: the `Settler` + `Person` preamble a name and a trade hang off. */
function settlerEntity(id: number, jobType: number, components: Record<string, unknown> = {}) {
  return {
    id,
    components: {
      Settler: { jobType, tribe: PRIMARY_TRIBE },
      Person: { person: true },
      Owner: { player: HUMAN_PLAYER },
      ...components,
    },
  };
}

describe('settler hover card model', () => {
  it('names the settler and the trade it works', () => {
    const ctx = sandboxCtx();
    const snapshot = snapshotOf([settlerEntity(1, JOB_JOINER)]);

    const model = settlerHoverModel(snapshot, 1, ctx);

    expect(model?.title).toMatch(/^\S+$/); // the given name alone, no surname
    expect(model?.profession).toBe('Cieśla');
  });

  it('calls a growing child by its life stage, which is the only trade it has', () => {
    const ctx = sandboxCtx();
    const snapshot = snapshotOf([settlerEntity(2, JOB_CHILD_MALE, { Age: { ticks: 0 } })]);

    expect(settlerHoverModel(snapshot, 2, ctx)?.profession).toBe('Chłopiec');
  });

  it('has nothing to say about an animal or a building, which draw as settlers or hold no name', () => {
    const ctx = sandboxCtx();
    const snapshot = snapshotOf([
      { id: 3, components: { Settler: { jobType: 0, tribe: PRIMARY_TRIBE } } },
      buildingEntity(4, BUILDING_WATCHTOWER),
    ]);

    expect(settlerHoverModel(snapshot, 3, ctx)).toBeNull();
    expect(settlerHoverModel(snapshot, 4, ctx)).toBeNull();
    expect(settlerHoverModel(snapshot, 99, ctx)).toBeNull();
  });
});
