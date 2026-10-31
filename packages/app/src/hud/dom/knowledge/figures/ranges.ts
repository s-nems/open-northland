import { hexNeighboursOf, systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import { shownWeapons } from '../../../knowledge/combat.js';
import type { KnowledgeContext } from '../context.js';
import { fitScale, hexRing, NODE_PX, NODE_ROW_PX, nodePoint, type Point } from './geometry.js';
import { arrow, dot, drawing, FIGURE_WIDTH, line, number, outline, shape, text } from './svg.js';

const PANELS = 3;
const PANEL_WIDTH = FIGURE_WIDTH / PANELS;
const PANEL_ROOM = 168;
const LEASH_HEIGHT = 186;
const TITLE_Y = 18;
const RING_Y = 78;
const FIRST_NOTE_Y = 146;
const NOTE_STEP = 18;
const POINT_MARK = 5;
/** How far from his stance point the attacker of the first panel has walked, in nodes. */
const ATTACKER_OFFSET = 26;
const ATTACK_PANEL_SHIFT = 14;

function stancePoint(at: Point): SVGElement {
  return shape(
    'g',
    {},
    line(
      { x: at.x - POINT_MARK, y: at.y - POINT_MARK },
      { x: at.x + POINT_MARK, y: at.y + POINT_MARK },
      'kn-fig__cross',
    ),
    line(
      { x: at.x - POINT_MARK, y: at.y + POINT_MARK },
      { x: at.x + POINT_MARK, y: at.y - POINT_MARK },
      'kn-fig__cross',
    ),
  );
}

function longestReach(context: KnowledgeContext): number {
  const reaches = shownWeapons(context.base, context.tribe()).map((w) => w.maxRange);
  return Math.max(0, ...reaches);
}

export function leashFigure(context: KnowledgeContext): SVGElement {
  const t = messages().knowledge.figures.leash;
  const search = systems.DEFEND_RADIUS_NODES;
  const release = systems.DEFEND_LEASH_NODES;
  const ignoreRelease = systems.IGNORE_LEASH_NODES;
  const back = systems.ATTACK_RETURN_SLACK_NODES;
  const reach = longestReach(context);
  const scale = fitScale(2 * release * NODE_PX, PANEL_ROOM);
  const centre = (panel: number): Point => ({ x: PANEL_WIDTH * (panel + 1 / 2), y: RING_Y });
  const notes = (panel: number, lines: readonly string[]): SVGElement[] =>
    lines.map((note, i) =>
      text({ x: centre(panel).x, y: FIRST_NOTE_Y + i * NOTE_STEP }, note, 'kn-fig__t--small', 'middle'),
    );
  const title = (panel: number, name: string): SVGElement =>
    text({ x: centre(panel).x, y: TITLE_Y }, name, 'kn-fig__t--strong', 'middle');
  const attackPoint = { x: centre(0).x - ATTACK_PANEL_SHIFT, y: RING_Y };
  const attacker = { x: attackPoint.x + ATTACKER_OFFSET * NODE_PX * scale, y: RING_Y };
  return drawing(
    LEASH_HEIGHT,
    title(0, t.attack),
    outline(hexRing(back), attackPoint, scale, 'kn-fig__ring kn-fig__ring--dash'),
    outline(hexRing(systems.SIGHT_RADIUS_NODES), attacker, scale, 'kn-fig__zone'),
    line(attackPoint, attacker, 'kn-fig__guide'),
    stancePoint(attackPoint),
    dot(attacker, POINT_MARK - 1, 'kn-fig__mark'),
    ...notes(0, [
      formatMessage(t.searchesSelf, { nodes: number(systems.SIGHT_RADIUS_NODES) }),
      formatMessage(t.returns, { nodes: number(back) }),
    ]),
    title(1, t.defence),
    outline(hexRing(release), centre(1), scale, 'kn-fig__ring kn-fig__ring--dash'),
    outline(hexRing(search), centre(1), scale, 'kn-fig__zone'),
    stancePoint(centre(1)),
    ...notes(1, [
      formatMessage(t.searchesPoint, { nodes: number(search) }),
      formatMessage(t.releases, { nodes: number(release) }),
    ]),
    title(2, t.ignore),
    outline(hexRing(ignoreRelease), centre(2), scale, 'kn-fig__ring kn-fig__ring--dash'),
    outline(hexRing(reach), centre(2), scale, 'kn-fig__zone'),
    stancePoint(centre(2)),
    ...notes(2, [
      formatMessage(t.weaponOnly, { nodes: number(reach) }),
      formatMessage(t.releases, { nodes: number(ignoreRelease) }),
    ]),
  );
}

const SPLASH_HEIGHT = 244;
const BAND_CENTRE: Point = { x: 164, y: 92 };
const BAND_ROOM = 312;
const LANDING_NODES = { hx: 16, hy: 8 };
const LENS_CENTRE: Point = { x: 452, y: 112 };
const LENS_SCALE = 2;
const NODE_DISC = 21;
const NOTE_Y = 214;

function catapultReach(context: KnowledgeContext): { readonly min: number; readonly max: number } | null {
  const row = [...context.base.weapons.values()].flat().find((w) => w.id === 'catapult');
  return row === undefined ? null : { min: row.minRange, max: row.maxRange };
}

export function catapultSplashFigure(context: KnowledgeContext): SVGElement | null {
  const reach = catapultReach(context);
  if (reach === null) return null;
  const t = messages().knowledge.figures.catapultSplash;
  const scale = fitScale(2 * reach.max * NODE_PX, BAND_ROOM);
  const landingOffset = nodePoint(LANDING_NODES.hx, LANDING_NODES.hy);
  const landing = {
    x: BAND_CENTRE.x + landingOffset.x * scale,
    y: BAND_CENTRE.y + landingOffset.y * scale,
  };
  const struck = [{ hx: 0, hy: 0 }, ...hexNeighboursOf(0, 0)];
  const discs = struck.flatMap((node, i) => {
    const p = nodePoint(node.hx, node.hy);
    const at = { x: LENS_CENTRE.x + p.x * LENS_SCALE, y: LENS_CENTRE.y + p.y * LENS_SCALE };
    return [dot(at, NODE_DISC, i === 0 ? 'kn-fig__disc kn-fig__disc--hit' : 'kn-fig__disc')];
  });
  const arrowEnd = { x: LENS_CENTRE.x - 3 * NODE_DISC + 2, y: LENS_CENTRE.y };
  const maxY = BAND_CENTRE.y + reach.max * NODE_ROW_PX * scale;
  return drawing(
    SPLASH_HEIGHT,
    outline(hexRing(reach.max), BAND_CENTRE, scale, 'kn-fig__zone'),
    outline(hexRing(reach.min), BAND_CENTRE, scale, 'kn-fig__hole'),
    outline(hexRing(reach.min), BAND_CENTRE, scale, 'kn-fig__ring'),
    outline(hexRing(reach.max), BAND_CENTRE, scale, 'kn-fig__ring'),
    dot(BAND_CENTRE, POINT_MARK - 1, 'kn-fig__mark'),
    text({ x: BAND_CENTRE.x, y: BAND_CENTRE.y + NOTE_STEP }, t.catapult, 'kn-fig__t--small', 'middle'),
    text(
      { x: BAND_CENTRE.x, y: maxY + NOTE_STEP },
      formatMessage(t.band, { min: number(reach.min), max: number(reach.max) }),
      'kn-fig__t--strong',
      'middle',
    ),
    arrow(landing, arrowEnd, 'kn-fig__ink kn-fig__ink--thin'),
    dot(landing, POINT_MARK - 1, 'kn-fig__mark--enemy'),
    ...discs,
    dot(LENS_CENTRE, POINT_MARK, 'kn-fig__mark'),
    text({ x: arrowEnd.x - NOTE_STEP, y: arrowEnd.y - NOTE_STEP }, t.landing, 'kn-fig__t--small', 'middle'),
    text(
      { x: LENS_CENTRE.x, y: NOTE_Y - NOTE_STEP / 2 },
      formatMessage(t.points, { count: number(struck.length) }),
      'kn-fig__t--strong',
      'middle',
    ),
    text({ x: LENS_CENTRE.x, y: NOTE_Y + NOTE_STEP / 2 }, t.full, 'kn-fig__t--small', 'middle'),
  );
}
