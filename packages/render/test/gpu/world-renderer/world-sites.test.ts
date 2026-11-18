import { type ConstructionPlot, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { FogGhost, RememberedSites, Sight } from '../../../src/data/fog/index.js';
import { ONE } from '../../../src/data/projection/index.js';
import type { ConstructionSign } from '../../../src/gpu/overlays/index.js';
import { type SiteFog, WorldSites } from '../../../src/gpu/world-renderer/world-sites.js';

/** The viewer watches the tiles west of this column. */
const SIGHT_EDGE = 6;
const ROW = 2;
const SEEN_ANCHOR = { col: 4, row: ROW };
const UNSEEN_ANCHOR = { col: 20, row: ROW };

/** A site in sight reaching past the sight edge, and one out of sight. */
const PLOTS: readonly ConstructionPlot[] = [
  { ref: 10, foundation: true, anchor: SEEN_ANCHOR, cells: [SEEN_ANCHOR, { col: 14, row: ROW }] },
  { ref: 20, foundation: true, anchor: UNSEEN_ANCHOR, cells: [UNSEEN_ANCHOR] },
];

function positionOf(node: { readonly col: number; readonly row: number }): { x: number; y: number } {
  return positionOfNode(node.col, node.row);
}

/** Site 10's sign stands out of sight, site 20's in sight, and site 50 has no plot. */
const SIGNS: readonly ConstructionSign[] = [
  { id: 10, x: 9 * ONE, y: positionOf(SEEN_ANCHOR).y, player: 1 },
  { id: 20, x: 3 * ONE, y: positionOf(UNSEEN_ANCHOR).y, player: 1 },
  { id: 50, x: 2 * ONE, y: ROW * ONE },
];

function sightOf(revision: number): Sight {
  return { seesNode: () => false, cellOfNode: () => 0, revision, newlyVisible: null };
}

function memoryOf(ghosts: readonly FogGhost[], version = 1): RememberedSites {
  return {
    version,
    sites: (out) => {
      out.push(...ghosts);
      return out;
    },
  };
}

function fogOf(memory: RememberedSites | null, revision = 1): SiteFog {
  return { sight: sightOf(revision), seesTile: (tileX) => tileX < SIGHT_EDGE, memory };
}

/** A remembered site with its foundation and sign, standing partly in sight. */
const REMEMBERED: readonly FogGhost[] = [
  {
    ref: 30,
    kind: 'building',
    tileX: 9,
    tileY: 6,
    owner: 2,
    plot: [
      { col: 5, row: 6 },
      { col: 18, row: 6 },
    ],
    sign: { x: 3 * ONE, y: 6 * ONE, dy: -20 },
  },
];

describe('WorldSites', () => {
  it('hands fog-off frames the live lists themselves and remembers nothing', () => {
    const sites = new WorldSites();
    sites.setPlots(PLOTS);
    sites.setSigns(SIGNS);
    expect(sites.livePlots(undefined)).toBe(PLOTS);
    expect(sites.signsDrawn(undefined)).toBe(SIGNS);
    expect(sites.rememberedPlots(undefined)).toEqual([]);
  });

  it('draws a live foundation and sign whole while its building is in sight, wherever their tiles lie', () => {
    const sites = new WorldSites();
    sites.setPlots(PLOTS);
    sites.setSigns(SIGNS);
    const fog = fogOf(null);
    const plots = sites.livePlots(fog);
    expect(plots).toEqual([PLOTS[0]]);
    expect(sites.signsDrawn(fog).map((sign) => sign.id)).toEqual([10, 50]);
    expect(sites.livePlots(fog)).toBe(plots);
    expect(sites.livePlots(fogOf(null, 2))).not.toBe(plots);
    sites.setPlots([...PLOTS]);
    expect(sites.livePlots(fogOf(null, 2))).not.toBe(plots);
  });

  it('draws a remembered foundation and sign whole, the sign dimmed in its owner colour', () => {
    const sites = new WorldSites();
    const memory = memoryOf(REMEMBERED);
    const fog = fogOf(memory);
    const plots = sites.rememberedPlots(fog);
    expect(plots).toEqual([{ ref: 30, foundation: true, cells: REMEMBERED[0]?.plot }]);
    expect(sites.signsDrawn(fog)).toEqual([
      { id: 30, x: 3 * ONE, y: 6 * ONE, dy: -20, player: 2, remembered: true },
    ]);
    expect(sites.rememberedPlots(fogOf(memory, 2))).toBe(plots);
    expect(sites.rememberedPlots(fogOf(memoryOf(REMEMBERED, 2)))).not.toBe(plots);
  });

  it('lists the live signs before the remembered ones, as one array while both hold', () => {
    const sites = new WorldSites();
    sites.setPlots(PLOTS);
    sites.setSigns(SIGNS);
    const fog = fogOf(memoryOf(REMEMBERED));
    const drawn = sites.signsDrawn(fog);
    expect(drawn.map((sign) => [sign.id, sign.remembered === true])).toEqual([
      [10, false],
      [50, false],
      [30, true],
    ]);
    expect(sites.signsDrawn(fog)).toBe(drawn);
  });

  it('looks a capture up in the latest live lists', () => {
    const sites = new WorldSites();
    sites.setPlots(PLOTS);
    sites.setSigns(SIGNS);
    expect(sites.plotOf(20)).toBe(PLOTS[1]);
    expect(sites.signOf(10)).toBe(SIGNS[0]);
    sites.setPlots([]);
    expect(sites.plotOf(20)).toBeUndefined();
  });
});
