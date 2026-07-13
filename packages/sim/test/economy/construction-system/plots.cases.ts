import { describe, expect, it } from 'vitest';
import { UnderConstruction } from '../../../src/components/index.js';
import { fx, nodeOfPosition, Simulation } from '../../../src/index.js';
import { constructionSystem } from '../../../src/systems/index.js';

import { constructionContent, ctxOf, HEADQUARTERS, HOUSE, placeSite } from './support.js';

describe('constructionPlots — the render decal cells for under-construction sites', () => {
  it("returns each site's footprint body cells (anchor + offsets), for a plot matching the building", () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    placeSite(sim, HOUSE); // Position (0,0); HOUSE footprint blocked = anchor + one cell east
    const { hx, hy } = nodeOfPosition(fx.fromInt(0), fx.fromInt(0));
    expect(sim.constructionPlots()).toEqual([
      {
        cells: [
          { col: hx, row: hy },
          { col: hx + 2, row: hy },
        ],
      },
    ]);
  });

  it('falls back to the anchor cell for a footprint-less type, and drops a site once it finishes', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const hq = placeSite(sim, HEADQUARTERS); // empty cost + no footprint
    const { hx, hy } = nodeOfPosition(fx.fromInt(0), fx.fromInt(0));
    expect(sim.constructionPlots()).toEqual([{ cells: [{ col: hx, row: hy }] }]);
    // A free (empty-cost) building finishes on the first construction tick → no longer a plot.
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hq, UnderConstruction)).toBe(false);
    expect(sim.constructionPlots()).toEqual([]);
  });
});
