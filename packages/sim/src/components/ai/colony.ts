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

/** The seat's trader for a colony and the ship pinned to its route, home's warehouse to the colony's. */
export interface ColonyRoute {
  /** The man who took the trade, null until one is chosen. */
  trader: Entity | null;
  /** The tick the trader was chosen: his trade change may wait out what he is doing. */
  chosen: number;
  /** The ship the route sails, null while the seat owes one. */
  ship: Entity | null;
  /** The ship's hull when last read: a drop is fire the seat has felt. */
  hull: number;
  /** The units aboard the ship and in the trader's cart when last read: a drop at home is a delivery. */
  load: number;
}

/** Where a colony's people ferry stands on its trip: taking riders on at `side`, or sailing for it. */
export type ColonyFerryLeg = 'board' | 'sail';

/** A free ship that carries a colony's people across, settlers out and men past work home. */
export interface ColonyFerry {
  ship: Entity;
  /** The side it boards at or sails for. */
  side: 'home' | 'colony';
  leg: ColonyFerryLeg;
  /** The tick the leg began. */
  since: number;
  /** The man at the helm who brings it back from the colony; null on a trip that ends there. */
  helm: Entity | null;
  /** The ship's hull when last read: a drop is fire the seat has felt. */
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

/** The largest band of enemy fighters a colony has seen about its buildings lately: where, and since when. */
export interface ColonyThreat {
  men: number;
  at: HalfCellNode;
  /** The tick it was last seen at that size or more. */
  since: number;
}

/** Where a colony's ship took fire, and the tick of the latest hit there. */
export interface SeaDanger {
  at: HalfCellNode;
  seen: number;
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
  /** The fighters home sent to hold it: aboard its ferry or on its land. */
  garrison: Entity[];
  threat: ColonyThreat | null;
  failures: number;
  /** The tick its trader last brought a load home, null until then. */
  delivered: number | null;
  builds: { building: string; placed: boolean }[];
  route: ColonyRoute | null;
  ferry: ColonyFerry | null;
  overflow: ColonyOverflow[];
  stalls: ColonyStall[];
  /** Where its ships took fire lately, out of the seat's own experience. */
  dangers: SeaDanger[];
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
 *  chosen, and dropped when the colony controller stops. What it says about who and what is colony is read from it on demand, so a restored game agrees. */
export const ComputerColony = defineComponent<ComputerColonyState>('ComputerColony', 'players', {
  simOnly: true,
});
