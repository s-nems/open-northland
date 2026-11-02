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

/** Design px of the picture on a plaque's nation emblem, and on the two that say whose stance is whose. */
const EMBLEM_PX = 34;
const SIDE_EMBLEM_PX = 17;

interface EmblemSlot {
  readonly element: HTMLElement;
  show(nation: DiplomacyMapNation): void;
}

function emblemSlot(className: string, px: number, paintEmblem: NationEmblemPainter): EmblemSlot {
  const node = element('span', `on-dip-emblem ${className}`, GLYPH.banner);
  const picture = pictureSlot();
  node.append(picture);
  let identity = '';
  return {
    element: node,
    show: (nation) => {
      const next = `${nation.player}:${nation.tribe}:${nation.colour}`;
      if (next === identity) return;
      identity = next;
      const drawn = nation.tribe !== undefined && paintEmblem(picture, nation.tribe, nation.player, px);
      setClass(node, 'on-dip-emblem--drawn', drawn);
      setStyleVar(node, '--nation-colour', `#${nation.colour.toString(16).padStart(6, '0')}`);
    },
  };
}

export interface NationPlaque {
  readonly element: HTMLButtonElement;
  /** `viewer` is the viewer's own nation, whose emblem marks its side of the relation. */
  update(nation: DiplomacyMapNation, viewer: DiplomacyMapNation | undefined): void;
}

/** A nation's emblem and name, then each side's emblem beside its stance, so the plaque says whose
 *  stance is whose without a word; the words are in its tip. Pressing a nation with a diplomacy page
 *  answers `onPress` with its player; a plaque without one lets the press through to the map under it. */
export function createNationPlaque(
  className: string,
  paintEmblem: NationEmblemPainter,
  onPress: (player: number) => void,
): NationPlaque {
  const copy = messages().hud.diplomacyMap;
  const windowCopy = messages().hud.diplomacyWindow;
  const root = button(`on-dipmap-plaque ${className}`);
  const emblem = emblemSlot('on-dipmap-plaque__emblem', EMBLEM_PX, paintEmblem);
  const name = element('strong', 'on-dipmap-plaque__name');
  const note = element('small', 'on-dipmap-plaque__note');
  const relation = element('small', 'on-dipmap-plaque__relation');
  const theirEmblem = emblemSlot('on-dipmap-plaque__side-emblem', SIDE_EMBLEM_PX, paintEmblem);
  const ourEmblem = emblemSlot('on-dipmap-plaque__side-emblem', SIDE_EMBLEM_PX, paintEmblem);
  const theirs = element('b', '');
  const ours = element('b', '');
  const theirSide = element('span', 'on-dipmap-plaque__side');
  const ourSide = element('span', 'on-dipmap-plaque__side');
  theirSide.append(theirEmblem.element, theirs);
  ourSide.append(ourEmblem.element, ours);
  relation.append(theirSide, ourSide);
  const text = element('span', 'on-dipmap-plaque__text');
  text.append(name, note, relation);
  root.append(emblem.element, text);
  let player: number | null = null;
  root.addEventListener('click', () => {
    if (player !== null) onPress(player);
  });
  return {
    element: root,
    update: (nation, viewer) => {
      player = nation.hasPage ? nation.player : null;
      const shownName = nation.name ?? `${messages().hud.player} ${nation.player}`;
      write(name, shownName);
      setClass(root, 'on-dipmap-plaque--own', nation.own);
      setClass(root, 'on-dipmap-plaque--passive', !nation.hasPage);
      setDisabled(root, !nation.hasPage);
      root.tabIndex = nation.hasPage ? 0 : -1;
      emblem.show(nation);
      const { relation: stance } = nation;
      relation.hidden = stance === undefined;
      note.hidden = !nation.own;
      write(note, nation.own ? copy.own : '');
      const lines = [shownName];
      if (stance !== undefined) {
        write(theirs, windowCopy.stances[stance.towardYou]);
        setAttribute(theirs, 'data-stance', stance.towardYou);
        write(ours, windowCopy.stances[stance.yourStance]);
        setAttribute(ours, 'data-stance', stance.yourStance);
        theirEmblem.show(nation);
        if (viewer !== undefined) ourEmblem.show(viewer);
        lines.push(
          `${windowCopy.theirs}: ${windowCopy.stances[stance.towardYou]}`,
          `${windowCopy.ours}: ${windowCopy.stances[stance.yourStance]}`,
        );
      }
      setAttribute(root, 'aria-label', lines.join('\n'));
      setTip(root, nation.hasPage ? [...lines.slice(1), copy.openDiplomacy].join('\n') : '');
    },
  };
}
