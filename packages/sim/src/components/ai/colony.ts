import { defineComponent, type Entity } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { BuildLineId } from './computer-player.js';

/** Where a colony stands, in order; `returning` turns a failed voyage for home; `abandoned` is terminal and
 *  keeps its land out of the home reads. */
export type ColonyPhase =
  | 'siteChosen'
  | 'scouting'
  | 'fittingOut'
  | 'loading'
  | 'sailing'
  | 'landing'
  | 'founding'
  | 'running'
  | 'returning'
  | 'abandoned';

/** The trip that looks over the site's coast before a colony sails. */
export interface ColonyScout {
  ship: Entity;
  helm: Entity;
  waypoints: HalfCellNode[];
  leg: number;
}

export type ColonyLineLeg =
  | 'unloadHome'
  | 'loadHome'
  | 'sailOut'
  | 'unloadColony'
  | 'loadColony'
  | 'sailHome';

/** The ship that carries goods between a seat's home and its colony. */
export interface ColonyLine {
  ship: Entity;
  crew: Entity[];
  leg: ColonyLineLeg;
  /** The tick the leg began. */
  since: number;
  /** The units aboard when last read, and the tick that figure last changed. */
  load: number;
  lastLoad: number;
  /** The hull when last read: a drop is fire the seat has felt. */
  hull: number;
}

/** A building the seat's build order handed to its colony, and the step it stood on. */
export interface ColonyOverflow {
  line: BuildLineId;
  step: number;
  building: string;
}

/** A build-order step held for ground, and the tick the colony first saw it held. */
export interface ColonyStall {
  line: BuildLineId;
  step: number;
  since: number;
}

/** One colony over the sea, from its chosen site on. */
export interface ColonyState {
  phase: ColonyPhase;
  /** The tick the phase began. */
  since: number;
  /** The static land component the colony stands on. */
  land: number;
  /** The centre of the site's block. */
  site: HalfCellNode;
  /** The site's mooring on `land`, and the home mooring its ships sail from. */
  shore: HalfCellNode | null;
  berth: HalfCellNode | null;
  scout: ColonyScout | null;
  ship: Entity | null;
  /** The colonists: those on the colony ship, and the rest the scout ship brings. */
  people: Entity[];
  rest: Entity[];
  failures: number;
  /** The tick its line last brought a load home, null until then. */
  delivered: number | null;
  builds: { building: string; placed: boolean }[];
  line: ColonyLine | null;
  overflow: ColonyOverflow[];
  stalls: ColonyStall[];
  /** Where its ships took fire, out of the seat's own experience. */
  dangers: HalfCellNode[];
}

/** A seat's colonies, oldest first, and what its survey has learned across them. */
export interface ComputerColonyState {
  colonies: ColonyState[];
  /** The sites given up on, by their zone. */
  rejected: number[];
  /** The tick the seat may try again. */
  retryAt: number;
}

/** A computer seat's colonies over the sea, held on its {@link AiControl} carrier: absent until a site is
 *  chosen. What it says about who and what is colony is read from it on demand, so a restored game agrees. */
export const ComputerColony = defineComponent<ComputerColonyState>('ComputerColony', 'players', {
  simOnly: true,
});
