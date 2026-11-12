import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { pickHint } from '../../../../src/view/unit-controls/action-hint/pick-hint.js';
import { snapshotOf } from '../../../support/snapshot.js';

const DEER = 40;
const DAMAGED = 100;
const FOUNDATION = 101;

const WORLD = snapshotOf([
  { id: DAMAGED, components: { Building: { built: ONE }, Damaged: {} } },
  { id: FOUNDATION, components: { Building: { built: 0 }, UnderConstruction: {} } },
]);

describe('the armed pick label', () => {
  it('names an attack-move march apart from a strike, which names the creature it hits', () => {
    expect(pickHint(WORLD, { kind: 'attackMove' })).toMatchObject({ tone: 'action', action: 'attackMove' });
    expect(pickHint(WORLD, { kind: 'strike', target: DEER, creature: true })).toEqual({
      tone: 'action',
      action: 'attack',
      job: null,
      target: { kind: 'creature', ref: DEER },
    });
  });

  it("mutes the refusal of a building the pick turns down, in the pick's own words", () => {
    const home = { kind: 'building', pick: 'home', fits: false, school: false, coinDrill: false } as const;
    expect(pickHint(WORLD, { ...home, building: DAMAGED })).toEqual({
      tone: 'refusal',
      refusal: 'cannotLiveHere',
    });
  });

  it("names the builders' pick a repair on a damaged building and a build on a foundation", () => {
    const site = {
      kind: 'building',
      pick: 'building-site',
      fits: true,
      school: false,
      coinDrill: false,
    } as const;
    expect(pickHint(WORLD, { ...site, building: DAMAGED })).toMatchObject({ action: 'repair' });
    expect(pickHint(WORLD, { ...site, building: FOUNDATION })).toMatchObject({ action: 'build' });
  });

  it("names the barracks' rally pick apart from a gatherer's work area", () => {
    expect(pickHint(WORLD, { kind: 'rallyPoint' })).toMatchObject({ tone: 'action', action: 'rallyPoint' });
    expect(pickHint(WORLD, { kind: 'workArea' })).toMatchObject({ tone: 'action', action: 'workArea' });
  });

  it('names nothing where the press names no target', () => {
    expect(pickHint(WORLD, null)).toBeNull();
  });
});
