import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import { realMapSessionWorld } from '../real-map-world.js';

/** A mission whose seat starts as a colony: a headquarters paper beside four workshop papers. */
const SEARCH = 'map=wonder-campaign_03_03&player=0&missions=off&seed=7';
const SEAT = 0;

describe.runIf(hasRealIr())('the paper ban', () => {
  it("keeps only a colony seat's starting headquarters paper", async () => {
    const [authored, banned] = await Promise.all([
      realMapSessionWorld(`?${SEARCH}`),
      realMapSessionWorld(`?${SEARCH}&papers=off`),
    ]);
    const headquarters = authored.content.buildings.find((b) => b.id === 'headquarters')?.typeId;
    const headquartersPaper = { kind: 'placeHouse', param: headquarters };
    expect(authored.papers(SEAT)).toHaveLength(5);
    expect(authored.papers(SEAT)).toContainEqual(headquartersPaper);
    expect(banned.papers(SEAT)).toEqual([headquartersPaper]);
  });
});
