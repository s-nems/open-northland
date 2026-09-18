import type { BuildingType } from '@open-northland/data';
import { constructionBillForType } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_KINDS } from '../src/hud/tool-panel/building-menu.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { buildingLabelsFromContent, menuEntriesFromContent } from '../src/view/game-tool-panel.js';

describe('construction catalogue entries from content', () => {
  const content = createSceneSim(sandboxScene).content;

  it('lists every house kind with a construction cost, and nothing else', () => {
    const [sample] = content.buildings;
    if (sample === undefined) throw new Error('no buildings in the sandbox content');
    // The real IR's outliers, which the fallback content lacks: a house that costs nothing (the
    // headquarters, the wall segment), a wonder and a vehicle.
    const FREE_STORAGE = 900;
    const WONDER = 901;
    const VEHICLE = 902;
    const buildings: BuildingType[] = [
      ...content.buildings,
      { ...sample, typeId: FREE_STORAGE, id: 'test_free', kind: 'storage', construction: [] },
      { ...sample, typeId: WONDER, id: 'test_wonder', kind: 'wonder' },
      { ...sample, typeId: VEHICLE, id: 'test_vehicle', kind: 'vehicle' },
    ];
    const entries = menuEntriesFromContent({ buildings }, 'pl');
    const listed = new Set(entries.map((entry) => entry.typeId));
    for (const building of buildings) {
      const bill = constructionBillForType(buildings, building.typeId);
      const expected = CATALOGUE_KINDS.has(building.kind) && bill.length > 0;
      expect(listed.has(building.typeId), `${building.id} (${building.kind})`).toBe(expected);
    }
    expect(listed.has(FREE_STORAGE)).toBe(false);
    expect(listed.has(WONDER)).toBe(false);
    expect(listed.has(VEHICLE)).toBe(false);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('charges the from-scratch bill the sim charges, a leveled tier summing its chain', () => {
    const entries = menuEntriesFromContent(content, 'pl');
    for (const entry of entries) {
      expect(entry.cost).toEqual(constructionBillForType(content.buildings, entry.typeId));
      expect(entry.cost.length).toBeGreaterThan(0);
    }
    const base = content.buildings.find((b) => b.upgradeTarget !== undefined);
    const tier = entries.find((entry) => entry.typeId === base?.upgradeTarget);
    const own = content.buildings.find((b) => b.typeId === base?.upgradeTarget);
    expect(tier).toBeDefined();
    if (tier === undefined || own === undefined || base === undefined) return;
    const sum = (lines: readonly { readonly amount: number }[]): number =>
      lines.reduce((total, line) => total + line.amount, 0);
    expect(sum(tier.cost)).toBe(sum(own.construction) + sum(base.construction));
  });

  it('names every building type, catalogue or not, so a note or a paper never shows a bare id', () => {
    const labels = buildingLabelsFromContent(content, 'pl');
    for (const building of content.buildings) {
      expect(labels.get(building.typeId), building.id).toBeTruthy();
    }
    for (const entry of menuEntriesFromContent(content, 'pl')) {
      expect(labels.get(entry.typeId)).toBe(entry.label);
    }
  });
});
