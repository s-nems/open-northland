import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { BUILDING_FARM, GOOD_STONE } from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import { type DetailsLayout, mapLayout } from '../src/hud/details-panel/layout/index.js';
import { goodLabel } from '../src/hud/details-panel/model/context.js';
import { panelViewFor } from '../src/hud/details-panel/selection-view.js';
import type { Rect } from '../src/hud/geometry.js';
import { formatMessage, messages } from '../src/i18n/index.js';
import { PANEL_SCREEN, viewOfKind } from './support/details-panel.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

describe('details panel layout', () => {
  it('pairs every selection kind with the geometry laid out for it', () => {
    const modelOf = (ids: number[], entities: EntitySnapshot[]): UnitPanelModel =>
      buildUnitPanelModel(snapshotOf(entities), new Set(ids), sandboxCtx());
    const settler = (id: number): EntitySnapshot => ({
      id,
      components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
    });

    expect(panelViewFor(modelOf([], []), PANEL_SCREEN, 1).kind).toBe('empty');
    // A single settler or building is a DOM panel's: this panel leaves it blank.
    expect(panelViewFor(modelOf([1], [buildingEntity(1, BUILDING_FARM)]), PANEL_SCREEN, 1).kind).toBe(
      'empty',
    );
    expect(panelViewFor(modelOf([1], [settler(1)]), PANEL_SCREEN, 1).kind).toBe('empty');
    expect(
      viewOfKind(modelOf([1], [{ id: 1, components: { Signpost: { player: 1 } } }]), 'signpost').model.kind,
    ).toBe('signpost');
    // A group is the DOM group panel's as well.
    const group = modelOf([1, 2], [settler(1), settler(2)]);
    expect(group.kind).toBe('group');
    expect(panelViewFor(group, PANEL_SCREEN, 1).kind).toBe('empty');
  });

  it('gives a road site one status row: its stone wanted, a builder coming, or the stone on site', () => {
    const ctx = sandboxCtx();
    const site = (reservation: unknown, stones: number): EntitySnapshot => ({
      id: 1,
      components: {
        RoadSite: { tribe: 1, construction: [{ goodType: GOOD_STONE, amount: 1 }], reservation },
        Stockpile: { amounts: stones > 0 ? [[GOOD_STONE, stones]] : [] },
        UnderConstruction: {},
      },
    });
    const view = (entity: EntitySnapshot) =>
      viewOfKind(buildUnitPanelModel(snapshotOf([entity]), new Set([1]), ctx), 'palisade');
    const stone = goodLabel(ctx, GOOD_STONE);
    const copy = messages().hud;

    const waiting = view(site(null, 0));
    expect(waiting.model.siteStatus).toBe(
      formatMessage(copy.roadSiteNeeds, { good: stone, have: 0, need: 1 }),
    );
    expect(waiting.layout.progress).not.toBeNull();
    expect(view(site({ builder: 9 }, 0)).model.siteStatus).toBe(copy.roadSiteBuilderComing);
    expect(view(site({ builder: 9 }, 1)).model.siteStatus).toBe(
      formatMessage(copy.roadSiteSupplied, { good: stone }),
    );
  });

  /** The rect every mapped field must have become - no real layout rect can carry these coords. */
  const SENTINEL: Rect = { x: -1, y: -1, w: -1, h: -1 };

  const isRect = (v: object): v is Rect =>
    ['x', 'y', 'w', 'h'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

  /** Every rect reachable in a layout, with the field path that led to it (so a miss names itself). */
  function collectRects(node: unknown, path: string, out: Array<{ path: string; rect: Rect }>): void {
    if (node === null || typeof node !== 'object') return;
    if (isRect(node)) {
      out.push({ path, rect: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        collectRects(v, `${path}[${i}]`, out);
      });
      return;
    }
    for (const [key, v] of Object.entries(node)) collectRects(v, `${path}.${key}`, out);
  }

  it('mapLayout transforms EVERY rect in a layout (an unmapped new field fails here)', () => {
    const modelOf = (entity: EntitySnapshot): UnitPanelModel =>
      buildUnitPanelModel(snapshotOf([entity]), new Set([entity.id]), sandboxCtx());
    const gate: EntitySnapshot = {
      id: 1,
      components: {
        Palisade: { gfxIndex: 696, tribe: 1, built: ONE, gate: { open: false, counterpartGfxIndex: 700 } },
        Health: { hitpoints: 75, max: 100 },
        UnderConstruction: {},
      },
    };
    // A gate site (the progress row and both buttons) and a signpost carry every rect a layout can.
    const layouts: readonly DetailsLayout[] = [
      viewOfKind(modelOf(gate), 'palisade').layout,
      viewOfKind(modelOf({ id: 2, components: { Signpost: { player: 1 } } }), 'signpost').layout,
    ];

    for (const layout of layouts) {
      const found: Array<{ path: string; rect: Rect }> = [];
      collectRects(
        mapLayout(layout, () => SENTINEL),
        layout.kind,
        found,
      );
      expect(found.length).toBeGreaterThan(0); // the walk must actually reach rects
      const untransformed = found.filter(({ rect }) => rect.x !== SENTINEL.x || rect.w !== SENTINEL.w);
      // A rect `mapLayout` misses passes through at hit-space coords onto a texture re-origined to (0,0).
      expect(untransformed.map(({ path }) => path)).toEqual([]);
    }
  });
});
