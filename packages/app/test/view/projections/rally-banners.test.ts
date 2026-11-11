import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { rallyBanners } from '../../../src/view/projections/index.js';
import { snapshotOf } from '../../support/snapshot.js';

const OWN = 0;
const OTHER = 1;
const OWN_BARRACKS = 1;
const OTHER_BARRACKS = 2;
const PLAIN_BARRACKS = 3;
const OWN_FLAG = 10;
const OTHER_FLAG = 11;
const COLOURS = [0x112233, 0x445566];
const colourOf = (player: number): number => COLOURS[player] ?? 0;

const WORLD = snapshotOf([
  { id: OWN_BARRACKS, components: { Owner: { player: OWN }, RallyPoint: { flag: OWN_FLAG } } },
  { id: OTHER_BARRACKS, components: { Owner: { player: OTHER }, RallyPoint: { flag: OTHER_FLAG } } },
  { id: PLAIN_BARRACKS, components: { Owner: { player: OWN } } },
  { id: OWN_FLAG, components: { DeliveryFlag: {}, Position: { x: fx.fromInt(4), y: fx.fromInt(6) } } },
  { id: OTHER_FLAG, components: { DeliveryFlag: {}, Position: { x: fx.fromInt(9), y: fx.fromInt(2) } } },
]);

describe('rallyBanners', () => {
  it("stands a banner in the owner's colour where a selected own barracks keeps its flag", () => {
    const banners = rallyBanners(WORLD, new Set([OWN_BARRACKS, PLAIN_BARRACKS]), OWN, colourOf);
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ id: OWN_FLAG, colour: COLOURS[OWN] });
  });

  it("shows none for an unselected barracks or another seat's, and every selected one on the whole map", () => {
    expect(rallyBanners(WORLD, new Set(), OWN, colourOf)).toHaveLength(0);
    expect(rallyBanners(WORLD, new Set([OTHER_BARRACKS]), OWN, colourOf)).toHaveLength(0);
    expect(rallyBanners(WORLD, new Set([OTHER_BARRACKS]), null, colourOf)).toMatchObject([
      { id: OTHER_FLAG, colour: COLOURS[OTHER] },
    ]);
  });
});
