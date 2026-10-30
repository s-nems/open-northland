import { defineComponent, type Entity } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { BuildLineId, StepKey } from '../../systems/computer-player/build-order/entries.js';
import type { AttackLeash } from '../combat.js';

export interface MusterPlanState {
  /** Soldiers to gather before the wave marches. */
  waveSize: number;
  /** The tick this wave was drawn - the gathering window runs from here. */
  drawnAt: number;
  /** The tick the army first stood at its cap with this plan, or null: the men still walking in get one
   *  gather window from here, so the first capped wave leaves as whole as the later ones. */
  cappedAt: number | null;
}

/**
 * The wave one seat's barracks is gathering, held between decisions on the muster barracks itself, so it
 * dies with the door. The military decision mints it when a worthy band first stands there and retires it
 * when the wave marches, the army falls under a wave, or the campaign has no objective; a disabled military
 * leaves it in place, window and all.
 */
export const MusterPlan = defineComponent<MusterPlanState>('MusterPlan', 'players');

export interface WaveMarchState {
  /** The objective the wave was sent on; a new campaign target sends it again. */
  target: Entity;
  /** Where the wave gathers before it goes in; null once it has been sent in on its target. */
  gatherAt: HalfCellNode | null;
  /** The tick the wave set out for its gathering point, or was sent in: the march and siege timeouts
   *  count from it. */
  since: number;
  /** The tick the first man reached the gathering point, null before: the wait for the rest counts from
   *  it. */
  firstArrival: number | null;
  /** The men and catapults the wave marched with, ascending id. */
  men: Entity[];
  catapults: Entity[];
}

/**
 * The wave a seat's barracks has launched, gathering short of its objective and then sent in on it, held
 * on the muster barracks beside its {@link MusterPlan}. Minted at the launch, removed when the wave is
 * spent or the campaign loses its objective (`military/march/index.ts`).
 */
export const WaveMarch = defineComponent<WaveMarchState>('WaveMarch', 'players');

export interface StalledPlacementsState {
  /** The first tick each build-order step, by its line and index, searches a spot again after a search
   *  that found nothing. */
  retryTicks: Map<StepKey, number>;
  /** Per line, the step whose failed search holds it; a line placing freely has none. A passed-over
   *  serving step or a lane that finds nothing holds nothing. */
  holding: Map<BuildLineId, StepKey>;
}

/**
 * The build-order spot searches that last found nothing, held on the seat's {@link AiControl} carrier so
 * they die with the seat. The build order skips a step's search until its retry tick, drops the retry
 * once the step places or stands met, and drops a line's holding step's once another step of that line
 * acts. Absent while no search is pending.
 */
export const StalledPlacements = defineComponent<StalledPlacementsState>('StalledPlacements', 'players');

export interface LineFrontier {
  /** The line's first unmet step at the seat's last build-order decision that reached it. */
  step: number;
  /** The first tick a razed building's step, one below `step`, may be raised again; null until such a
   *  regression is seen. */
  rebuildTick: number | null;
}

/**
 * How far each line of the seat's build order had got, by line id, held on its {@link AiControl}
 * carrier, so a razed building shows as a step falling back below its line's frontier and waits out the
 * rebuild delay instead of being re-placed at once.
 */
export const BuildOrderFrontier = defineComponent<{ lines: Map<BuildLineId, LineFrontier> }>(
  'BuildOrderFrontier',
  'players',
);

/**
 * The tick before which the seat's build order starts nothing on a free construction site, held on its
 * {@link AiControl} carrier: a lower difficulty's pause, removed by the next site or upgrade it starts.
 */
export const BuildOrderPause = defineComponent<{ untilTick: number }>('BuildOrderPause', 'players');

export interface RoadTrafficState {
  /** The seat whose settlers walked here. */
  player: number;
  /** The bucket's index in the map's row-major grid of traffic buckets. */
  bucket: number;
  /** Off-road walks that entered the bucket, as of the start of half-life `epoch`. */
  walks: number;
  /** The sums of the half-cell node columns and rows those walks entered on, scaled down with `walks`
   *  so their mean, the walks' average entry node, holds. */
  sumX: number;
  sumY: number;
  /** The half-life period the counts were last brought up to; each one since halves them once. */
  epoch: number;
  /** The first tick the seat's road decision may route from this bucket again. */
  retryTick: number;
}

/**
 * How much one computer seat's settlers walk off-road through one square of the map, one entity per
 * (seat, bucket) the seat walks: counting touches only the bucket a step entered, so a tick's writes stay
 * as small as its steps. The road decision paves the busiest (`systems/computer-player/traffic.ts`).
 */
export const RoadTraffic = defineComponent<RoadTrafficState>('RoadTraffic', 'players');

/** One enemy unit a computer seat remembers for a blow on its people or buildings, or a theft of its
 *  stock, until `untilTick`. */
export interface SeatOffender {
  entity: Entity;
  untilTick: number;
  /** Whether civilians who struck back let him go at their leash since his last offence: none is sent at
   *  him again until he offends anew. */
  drivenOff: boolean;
}

/**
 * The enemy units that struck or robbed one computer seat lately, ascending entity id, held on its
 * {@link AiControl} carrier so a later defence decision still sees them (`conflict/offenders.ts`).
 * Absent while the seat remembers no one.
 */
export const SeatOffenders = defineComponent<{ offenders: SeatOffender[] }>('SeatOffenders', 'players');

/** A computer seat's civilian armed as a hunter while a zone of its settlement is desperate. */
export interface MilitiaState {
  /** The building whose zone he defends, and the leash his attack orders hold him to. */
  zone: Entity;
  leash: AttackLeash;
  /** The trade and the workplace he goes back to. */
  previousJob: number;
  previousWorkplace: Entity | null;
  /** The tick he goes back to work unless his zone is desperate again, or his quarry back inside his
   *  leash, before it. */
  releaseTick: number;
  /** The enemy scout he was armed to drive off, or null for a man armed against a desperate raid. */
  quarry: Entity | null;
}

/** The computer seat's emergency militia, one per armed civilian (`ai-shared/military/defence/militia.ts`).
 *  An extension of this engine: the original never arms its civilians. */
export const Militia = defineComponent<MilitiaState>('Militia', 'combat');
