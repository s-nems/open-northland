import type { DiplomacyState } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { NationEmblemPainter } from '../dom/diplomacy-window/emblems.js';
import { GLYPH } from '../dom/icons.js';
import {
  button,
  element,
  setAttribute,
  setClass,
  setDisabled,
  setStyleVar,
  setTip,
  write,
} from '../dom/parts/dom.js';
import { pictureSlot } from '../dom/static-picture.js';

/** One nation as the map labels it. `relation` is absent on the viewer's own and on a whole-map view,
 *  where no seat stands in a relation to anyone; `hasPage` tells whether the diplomacy window lists it. */
export interface DiplomacyMapNation {
  readonly player: number;
  readonly name?: string;
  readonly tribe?: number;
  readonly colour: number;
  readonly own: boolean;
  readonly hasPage: boolean;
  readonly relation?: { readonly towardYou: DiplomacyState; readonly yourStance: DiplomacyState };
}

/** Design px of the picture a plaque's emblem paints. */
const EMBLEM_PX = 34;

export interface NationPlaque {
  readonly element: HTMLButtonElement;
  update(nation: DiplomacyMapNation): void;
}

/** A nation's emblem, name and both stances. Pressing a nation with a diplomacy page answers `onPress`
 *  with its player; a plaque without one lets the press through to the map under it. */
export function createNationPlaque(
  className: string,
  paintEmblem: NationEmblemPainter,
  onPress: (player: number) => void,
): NationPlaque {
  const copy = messages().hud.diplomacyMap;
  const stances = messages().hud.diplomacyWindow.stances;
  const root = button(`on-dipmap-plaque ${className}`);
  const emblem = element('span', 'on-dip-emblem on-dipmap-plaque__emblem', GLYPH.banner);
  const picture = pictureSlot();
  emblem.append(picture);
  const name = element('strong', 'on-dipmap-plaque__name');
  const note = element('small', 'on-dipmap-plaque__note');
  const relation = element('small', 'on-dipmap-plaque__relation');
  const theirLabel = element('span', '');
  const theirs = element('b', '');
  const ourLabel = element('span', '');
  const ours = element('b', '');
  write(theirLabel, copy.theirs);
  write(ourLabel, copy.ours);
  relation.append(theirLabel, theirs, ourLabel, ours);
  const text = element('span', 'on-dipmap-plaque__text');
  text.append(name, note, relation);
  root.append(emblem, text);
  let player: number | null = null;
  let identity = '';
  root.addEventListener('click', () => {
    if (player !== null) onPress(player);
  });
  return {
    element: root,
    update: (nation) => {
      player = nation.hasPage ? nation.player : null;
      const shownName = nation.name ?? `${messages().hud.player} ${nation.player}`;
      write(name, shownName);
      setClass(root, 'on-dipmap-plaque--own', nation.own);
      setClass(root, 'on-dipmap-plaque--passive', !nation.hasPage);
      setDisabled(root, !nation.hasPage);
      root.tabIndex = nation.hasPage ? 0 : -1;
      const { relation: stance } = nation;
      relation.hidden = stance === undefined;
      note.hidden = !nation.own;
      write(note, nation.own ? copy.own : '');
      if (stance !== undefined) {
        write(theirs, stances[stance.towardYou]);
        setAttribute(theirs, 'data-stance', stance.towardYou);
        write(ours, stances[stance.yourStance]);
        setAttribute(ours, 'data-stance', stance.yourStance);
      }
      setTip(root, nation.hasPage ? copy.openDiplomacy : '');
      const next = `${nation.tribe}:${nation.colour}`;
      if (next === identity) return;
      identity = next;
      const drawn =
        nation.tribe !== undefined && paintEmblem(picture, nation.tribe, nation.player, EMBLEM_PX);
      setClass(emblem, 'on-dip-emblem--drawn', drawn);
      setStyleVar(emblem, '--nation-colour', `#${nation.colour.toString(16).padStart(6, '0')}`);
    },
  };
}
