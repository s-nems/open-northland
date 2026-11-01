import type { ContentSet, MapAiSeat } from '@open-northland/data';
import {
  components,
  type EntitySnapshot,
  entitiesWith,
  type MissionScript,
  systems,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { technologyName } from '../../game/technology.js';
import type { AdminAiTable } from '../../hud/dom/admin-panel/model.js';
import { formatMessage, type Messages } from '../../i18n/index.js';

/** The map's scripts as the session holds them, which the map intent reads. */
export interface AiScriptInputs {
  readonly content: ContentSet;
  readonly missions: MissionScript | undefined;
  readonly mapAiScript: readonly MapAiSeat[];
}

/** Another seat's start zone and how long ago the seat last saw into it; null for never. */
export interface StaleZone {
  readonly player: number;
  readonly zone: number;
  readonly staleTicks: number | null;
}

export interface PupilCount {
  readonly job: number;
  readonly label: string;
  readonly count: number;
}

/** What a computer seat knows and intends beyond its economy, as the snapshot and the scripts hold it. */
export interface SeatMind {
  readonly tick: number;
  /** Null before the seat's first intel pass. */
  readonly intel: systems.SeatIntelSummary | null;
  /** The other seats' start zones, stalest first, at most {@link STALE_ZONES_SHOWN}. */
  readonly staleZones: readonly StaleZone[];
  /** Null without the scripts to read. */
  readonly intent: systems.SeatMapIntent | null;
  /** The seat's men in a job lesson now, ascending job. */
  readonly pupils: readonly PupilCount[];
}

/** How many stale start zones a seat's block lists: a four-seat map's rivals and one more. */
export const STALE_ZONES_SHOWN = 4;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const NO_VALUE = '-';

/** The seat's men in a job lesson, by owner then job, from one pass over the indexed lessons. */
export function pupilsBySeat(snapshot: WorldSnapshot): Map<number, Map<number, number>> {
  const bySeat = new Map<number, Map<number, number>>();
  for (const e of entitiesWith(snapshot, 'TrainingOrder')) {
    const lesson = (e.components.TrainingOrder as { lesson?: { kind: string; typeId: number } }).lesson;
    const owner = (e.components.Owner as { player?: unknown } | undefined)?.player;
    if (lesson?.kind !== 'job' || typeof owner !== 'number') continue;
    let byJob = bySeat.get(owner);
    if (byJob === undefined) {
      byJob = new Map();
      bySeat.set(owner, byJob);
    }
    byJob.set(lesson.typeId, (byJob.get(lesson.typeId) ?? 0) + 1);
  }
  return bySeat;
}

/** One seat's mind off its `AiControl` carrier, the map brief and the session's scripts. */
export function readSeatMind(
  tick: number,
  carrier: EntitySnapshot,
  player: number,
  brief: components.MapBriefView | null,
  scripts: AiScriptInputs | null,
  pupils: ReadonlyMap<number, number> | undefined,
): SeatMind {
  const intel = carrier.components.ComputerIntel as components.ComputerIntelState | undefined;
  const territory = systems.seatTerritoryOf(brief, player);
  return {
    tick,
    intel: intel === undefined ? null : systems.summarizeIntel(intel, tick),
    staleZones: intel === undefined || brief === null ? [] : staleStartZones(brief, intel, player, tick),
    intent:
      scripts === null
        ? null
        : systems.seatMapIntentOf(
            {
              content: scripts.content,
              mapAiScript: scripts.mapAiScript,
              ...(scripts.missions !== undefined ? { missions: scripts.missions } : {}),
            },
            player,
            territory,
          ),
    pupils: [...(pupils ?? [])]
      .sort(([a], [b]) => a - b)
      .map(([job, count]) => ({
        job,
        label: scripts === null ? String(job) : (technologyName(scripts.content, 'job', job) ?? String(job)),
        count,
      })),
  };
}

/** The other seats' start zones, never seen first, then the longest unseen; ties to the lower slot. */
function staleStartZones(
  brief: components.MapBriefView,
  intel: components.ComputerIntelState,
  player: number,
  tick: number,
): StaleZone[] {
  const zones = brief.seats
    .filter((start) => start.player !== player)
    .map((start): StaleZone => {
      const zone = components.zoneOfNode(brief, start.hx, start.hy);
      const seenAt = intel.zoneSeenAt[zone] ?? components.NEVER_SEEN;
      return {
        player: start.player,
        zone,
        staleTicks: seenAt === components.NEVER_SEEN ? null : tick - seenAt,
      };
    });
  const age = (z: StaleZone): number => z.staleTicks ?? Number.POSITIVE_INFINITY;
  return zones.sort((a, b) => age(b) - age(a) || a.player - b.player).slice(0, STALE_ZONES_SHOWN);
}

const minutes = (ticks: number): string => (ticks / TICKS_PER_MINUTE).toFixed(1);
const ratio = (share: { num: number; den: number } | null): string =>
  share === null ? NO_VALUE : `${share.num}/${share.den}`;
const count = (value: number | null): string => (value === null ? NO_VALUE : String(value));

/** Minutes until a forecast trigger fires: 0 inside a window, a dash once past or without a forecast. */
export function triggerMinutes(trigger: systems.Trigger, tick: number): string {
  switch (trigger.kind) {
    case 'atTick':
      return tick <= trigger.tick ? minutes(trigger.tick - tick) : NO_VALUE;
    case 'window':
      if (tick < trigger.fromTick) return minutes(trigger.fromTick - tick);
      return tick <= trigger.toTick ? minutes(0) : NO_VALUE;
    case 'always':
    case 'never':
    case 'conditional':
      return NO_VALUE;
  }
}

/** The military section and the orders its posture gives, `flankSeat` when the seat sends periodic flank
 *  raids. Codes (plan, posture, evidence) show raw. */
export function militaryTable(
  military: components.MilitaryStrategyState | undefined,
  flankSeat: boolean,
  msgs: Messages,
): AdminAiTable {
  const copy = msgs.admin.ai;
  if (military === undefined) return { head: null, rows: [[copy.plan, copy.undecided]] };
  const orders = systems.ordersFor(military.plan, military.posture, military.evidence, flankSeat);
  return {
    head: null,
    rows: [
      [copy.plan, military.plan],
      [copy.posture, military.posture],
      [copy.evidence, military.evidence.length === 0 ? NO_VALUE : military.evidence.join(', ')],
      [copy.decided, formatMessage(copy.decidedAt, { tick: military.decidedAt })],
      ...(military.challenger === null
        ? []
        : [
            [
              copy.challenger,
              formatMessage(copy.postureChallengerValue, {
                posture: military.challenger.posture,
                reviews: military.challenger.reviews,
              }),
            ],
          ]),
      [
        copy.target,
        military.targetOwner === null
          ? NO_VALUE
          : formatMessage(copy.targetValue, {
              player: military.targetOwner,
              points: count(military.targetPoints),
            }),
      ],
      [copy.threatIn, military.threatInTicks === null ? NO_VALUE : minutes(military.threatInTicks)],
      [copy.launchRatio, ratio(orders.launchRatio)],
      [copy.raids, orders.raidsAllowed ? copy.yes : copy.no],
      [copy.towerRadius, `${orders.towerRadiusPct}%`],
    ],
  };
}

/** Own points against each other seat's believed ones, with what the seat remembers of it, then the
 *  stalest start zones; a seat without intel yet gets only its own row. */
export function intelTables(mind: SeatMind, ownPoints: number | null, msgs: Messages): AdminAiTable[] {
  const copy = msgs.admin.ai;
  const player = (p: number): string => formatMessage(copy.player, { player: p });
  const forces: string[][] = [[copy.own, count(ownPoints), NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE]];
  for (const owner of mind.intel?.owners ?? []) {
    forces.push([
      player(owner.owner),
      count(owner.points),
      count(owner.fighters),
      formatMessage(copy.buildingsValue, { buildings: owner.buildings, unseen: owner.unseenBuildings }),
      String(owner.posts),
      owner.fightersSeenAt === null ? NO_VALUE : minutes(mind.tick - owner.fightersSeenAt),
    ]);
  }
  const tables: AdminAiTable[] = [
    {
      head: [copy.seatColumn, copy.points, copy.fighters, copy.buildings, copy.posts, copy.fightersSeen],
      rows: forces,
    },
  ];
  if (mind.intel === null) return tables;
  tables.push({
    head: [copy.startZone, copy.zone, copy.unseenFor],
    rows: [
      [copy.zonesSeen, NO_VALUE, `${mind.intel.zonesSeen}/${mind.intel.zones}`],
      ...mind.staleZones.map((z) => [
        player(z.player),
        String(z.zone),
        z.staleTicks === null ? copy.never : minutes(z.staleTicks),
      ]),
    ],
  });
  return tables;
}

/** An objective's kind code; a held area adds its centre node and range, and the reward cadence in minutes
 *  with the checks it needs. */
function objectiveLabel(objective: systems.Objective): string {
  if (objective.kind !== 'holdArea') return objective.kind;
  const { point, range } = objective.area;
  const area = `${objective.kind} ${point.hx},${point.hy} r${range}`;
  const reward = objective.reward;
  return reward === null ? area : `${area} /${minutes(reward.everyTicks)} x${reward.checks}`;
}

/** The map's objectives for the seat and the scripted attacks forecast to reach it. */
export function intentTables(mind: SeatMind, msgs: Messages): AdminAiTable[] {
  const intent = mind.intent;
  if (intent === null) return [];
  const copy = msgs.admin.ai;
  const tables: AdminAiTable[] = [];
  if (intent.objectives.length > 0) {
    tables.push({
      head: [copy.objective, copy.verdict, copy.role, copy.mission],
      rows: intent.objectives.map((o) => [objectiveLabel(o.objective), o.verdict, o.role, String(o.mission)]),
    });
  }
  if (intent.threats.length > 0) {
    tables.push({
      head: [copy.threat, copy.attacker, copy.trigger, copy.inMinutes],
      rows: intent.threats.map((t) => [
        t.source,
        t.player === null ? NO_VALUE : formatMessage(copy.player, { player: t.player }),
        t.trigger.kind,
        triggerMinutes(t.trigger, mind.tick),
      ]),
    });
  }
  return tables;
}

/** The seat's pupils in school, by the trade they learn. */
export function technologyTables(mind: SeatMind, msgs: Messages): AdminAiTable[] {
  if (mind.pupils.length === 0) return [];
  const copy = msgs.admin.ai;
  return [{ head: [copy.lesson, copy.pupils], rows: mind.pupils.map((p) => [p.label, String(p.count)]) }];
}
