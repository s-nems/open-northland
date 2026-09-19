import type { HypertextUserIcon } from '@open-northland/data';
import type { MapViewTarget } from '@open-northland/render';

/**
 * What the mission window's bitmap callback draws for one `<usericon:kind,a,b,c>`
 * (`an original routine`): kind 1 the map around half-cell node (a, b),
 * kind 2 the map around the first human stamped with mission id `a`, kind 0 that human alone on a card,
 * which stays an empty card when nobody carries the id. Any other kind, or kind 2 for an id nobody
 * carries, draws nothing.
 */

const ICON_FIGURE = 0;
const ICON_MAP_AT_NODE = 1;
const ICON_MAP_AT_HUMAN = 2;
/** The callback's bitmaps, allocated by the `CMissionInfoWindow` constructor (design px). */
const MAP_VIEW_W = 280;
const MAP_VIEW_H = 220;
const FIGURE_CARD_W = 50;
const FIGURE_CARD_H = 80;
/** The card draws its human's feet this far above its bottom edge, centred across it. */
const FIGURE_FEET_ABOVE_BOTTOM = 20;
/** The map around a human centres this far above its feet (world px). */
const HUMAN_VIEW_RAISE = 25;
/** The card's fill, RGB (196, 192, 159). */
const FIGURE_CARD_FILL = 0xc4c09f;

/** One icon's box on the page (design px) and the world view drawn into it. */
export interface UserIconBox {
  readonly w: number;
  readonly h: number;
  /** Null for a card whose human is gone: the box shows its fill alone. */
  readonly target: MapViewTarget | null;
  /** Where the target point lands, from the box's top-left (design px). */
  readonly focusX: number;
  readonly focusY: number;
  /** Set when the target draws alone over this fill instead of with the world around it. */
  readonly soloFill?: number;
}

/** The entity of the first human stamped with a mission id, or null when none carries it. */
export type MissionHumanLookup = (missionId: number) => number | null;

export function userIconBox(icon: HypertextUserIcon, missionHuman: MissionHumanLookup): UserIconBox | null {
  const [kind, a, b] = icon;
  if (kind === ICON_MAP_AT_NODE) {
    return {
      w: MAP_VIEW_W,
      h: MAP_VIEW_H,
      target: { kind: 'node', hx: a, hy: b },
      focusX: MAP_VIEW_W / 2,
      focusY: MAP_VIEW_H / 2,
    };
  }
  if (kind !== ICON_MAP_AT_HUMAN && kind !== ICON_FIGURE) return null;
  const ref = missionHuman(a);
  if (kind === ICON_MAP_AT_HUMAN) {
    if (ref === null) return null;
    return {
      w: MAP_VIEW_W,
      h: MAP_VIEW_H,
      target: { kind: 'entity', ref },
      focusX: MAP_VIEW_W / 2,
      focusY: MAP_VIEW_H / 2 + HUMAN_VIEW_RAISE,
    };
  }
  return {
    w: FIGURE_CARD_W,
    h: FIGURE_CARD_H,
    target: ref === null ? null : { kind: 'entity', ref },
    focusX: FIGURE_CARD_W / 2,
    focusY: FIGURE_CARD_H - FIGURE_FEET_ABOVE_BOTTOM,
    soloFill: FIGURE_CARD_FILL,
  };
}
