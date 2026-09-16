import {
  type DoorBadge,
  type ElevationField,
  makeElevationField,
  ONE,
  tileToScreen,
} from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { Pickable } from '../src/view/picking.js';
import { type ClickHitDeps, createClickHits } from '../src/view/unit-controls/click-hits.js';

/**
 * The hit priority behind a click: which of the five things that can share one pixel the player gets.
 * Every fixture answers the same world-px point, so nothing but the order can decide the winner.
 */

const HUMAN_PLAYER = 0;
const ENEMY_PLAYER = 1;

const SIGN_ROW_SETTLER = 40;
const GARRISON_TOWER = 50;
const OWNED_UNIT = 60;
const OWNED_BUILDING = 61;
const FLAG_GATHERER = 70;
const SIGNPOST = 80;

const DOOR_TILE = { col: 3, row: 5 } as const;
const DOOR = tileToScreen(DOOR_TILE.col, DOOR_TILE.row);
/** Inside the chain's base sign band, and on the mast foot of a flag planted at that same offset. */
const CLICK = { x: DOOR.x, y: DOOR.y - 10 };
const MAST = { stars: 3, dx: 0, dy: -10 };

const mannedDoor = (player: number = HUMAN_PLAYER): DoorBadge => ({
  id: GARRISON_TOWER,
  x: DOOR_TILE.col * ONE,
  y: DOOR_TILE.row * ONE,
  player,
  rows: [{ role: 'single', settler: SIGN_ROW_SETTLER }],
  garrison: MAST,
});

/** The same tower with an empty sign chain, so only its roof flag can answer. */
const flagOnlyDoor = (player: number = HUMAN_PLAYER): DoorBadge => ({ ...mannedDoor(player), rows: [] });

const under = (ref: number, kind: NonNullable<Pickable['kind']>): Pickable => ({
  ref,
  x: CLICK.x,
  y: CLICK.y,
  kind,
});

interface Arms {
  readonly badges?: readonly DoorBadge[];
  readonly owned?: readonly Pickable[];
  readonly flags?: readonly Pickable[];
  readonly signposts?: readonly Pickable[];
  readonly observer?: boolean;
  readonly elevation?: ElevationField;
}

const targetsOf = (arms: Arms): ClickHitDeps['targets'] => ({
  owned: () => [...(arms.owned ?? [])],
  flags: () => [...(arms.flags ?? [])],
  signposts: () => [...(arms.signposts ?? [])],
});

const hitsFor = (arms: Arms): ReturnType<typeof createClickHits> =>
  createClickHits({
    doorBadges: () => arms.badges ?? [],
    targets: targetsOf(arms),
    humanPlayer: HUMAN_PLAYER,
    observer: arms.observer ?? false,
    ...(arms.elevation !== undefined ? { elevation: arms.elevation } : {}),
  });

const OWNED_ARM = [under(OWNED_UNIT, 'settler')];
const FLAG_ARM = [under(FLAG_GATHERER, 'settler')];
const SIGNPOST_ARM = [under(SIGNPOST, 'signpost')];

/** A sign row, a garrison flag, a unit, a gatherer's drop-off flag and a signpost, all under one pixel. */
const ALL: Arms = {
  badges: [mannedDoor()],
  owned: OWNED_ARM,
  flags: FLAG_ARM,
  signposts: SIGNPOST_ARM,
};

const selected = (arms: Arms): number | null => hitsFor(arms).selectionAt(CLICK.x, CLICK.y);

describe('click hit priority', () => {
  it('is one point every arm answers to on its own, so only the order can decide', () => {
    expect(selected({ badges: [mannedDoor()] })).toBe(SIGN_ROW_SETTLER);
    expect(selected({ badges: [flagOnlyDoor()] })).toBe(GARRISON_TOWER);
    expect(selected({ owned: OWNED_ARM })).toBe(OWNED_UNIT);
    expect(selected({ flags: FLAG_ARM })).toBe(FLAG_GATHERER);
    expect(selected({ signposts: SIGNPOST_ARM })).toBe(SIGNPOST);
  });

  it('gives a sign row the click over every arm below it', () => {
    expect(selected(ALL)).toBe(SIGN_ROW_SETTLER);
  });

  it('falls to the garrison flag when the door flies no sign chain', () => {
    expect(selected({ ...ALL, badges: [flagOnlyDoor()] })).toBe(GARRISON_TOWER);
  });

  it('gives a drop-off flag priority over an overlapping unit or building', () => {
    expect(selected({ ...ALL, badges: [] })).toBe(FLAG_GATHERER);
    expect(selected({ flags: FLAG_ARM, owned: [under(OWNED_BUILDING, 'building')] })).toBe(FLAG_GATHERER);
  });

  it('falls to the unit under the cursor when the door carries no marker or drop-off flag', () => {
    expect(selected({ ...ALL, badges: [], flags: [] })).toBe(OWNED_UNIT);
  });

  it('resolves a signpost last', () => {
    expect(selected({ ...ALL, badges: [], flags: [], owned: [] })).toBe(SIGNPOST);
  });

  it('answers bare ground with null', () => {
    expect(hitsFor(ALL).selectionAt(CLICK.x + 400, CLICK.y)).toBeNull();
  });
});

describe('click hits on a door marker', () => {
  it('hands a sign row to its settler and a garrison flag to its building', () => {
    expect(hitsFor({ badges: [mannedDoor()] }).doorMarkerAt(CLICK.x, CLICK.y)).toEqual({
      kind: 'settler',
      ref: SIGN_ROW_SETTLER,
    });
    expect(hitsFor({ badges: [flagOnlyDoor()] }).doorMarkerAt(CLICK.x, CLICK.y)).toEqual({
      kind: 'building',
      ref: GARRISON_TOWER,
    });
    expect(hitsFor(ALL).doorMarkerAt(CLICK.x + 400, CLICK.y)).toBeNull();
  });

  it('reads the markers at the height the terrain lifted their door to', () => {
    const W = 8;
    const H = 8;
    const elev = new Array<number>(W * H).fill(0);
    elev[DOOR_TILE.row * W + DOOR_TILE.col] = 160; // a hill under the door
    const field = makeElevationField(elev, W, H);
    const hits = hitsFor({ badges: [mannedDoor()], elevation: field });
    const lift = field.liftAt(DOOR_TILE.col, DOOR_TILE.row);

    expect(lift).toBeGreaterThan(0);
    expect(hits.doorMarkerAt(CLICK.x, CLICK.y - lift)).toEqual({
      kind: 'settler',
      ref: SIGN_ROW_SETTLER,
    });
    expect(hits.doorMarkerAt(CLICK.x, CLICK.y)).toBeNull();
  });

  it('picks no marker at all when the frame publishes no badges', () => {
    const noBadges = createClickHits({
      targets: targetsOf(ALL),
      humanPlayer: HUMAN_PLAYER,
      observer: false,
    });
    expect(noBadges.doorMarkerAt(CLICK.x, CLICK.y)).toBeNull();
    expect(noBadges.selectionAt(CLICK.x, CLICK.y)).toBe(FLAG_GATHERER);
  });
});

describe('click hits on another player’s door', () => {
  it('never lets an enemy marker select the men behind it, or mask the arms below', () => {
    const hostile: Arms = { ...ALL, badges: [mannedDoor(ENEMY_PLAYER)] };
    expect(hitsFor(hostile).doorMarkerAt(CLICK.x, CLICK.y)).toBeNull();
    expect(selected(hostile)).toBe(FLAG_GATHERER);
    expect(selected({ badges: [flagOnlyDoor(ENEMY_PLAYER)] })).toBeNull();
  });

  it('drops a badge with no owner slot, which must not read as player 0', () => {
    const unowned: DoorBadge = {
      id: GARRISON_TOWER,
      x: DOOR_TILE.col * ONE,
      y: DOOR_TILE.row * ONE,
      rows: [{ role: 'single', settler: SIGN_ROW_SETTLER }],
    };
    expect(selected({ badges: [unowned] })).toBeNull();
  });

  it('opens every player’s markers to an observer', () => {
    expect(selected({ badges: [mannedDoor(ENEMY_PLAYER)], observer: true })).toBe(SIGN_ROW_SETTLER);
  });
});
