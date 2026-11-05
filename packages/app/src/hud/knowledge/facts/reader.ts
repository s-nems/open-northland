import { systems, TICKS_PER_MINUTE, TICKS_PER_SECOND } from '@open-northland/sim';
import { VIKING } from '../../../catalog/buildings.js';
import { JOB_CIVILIST } from '../../../catalog/jobs.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { formatNumber } from '../entry-format.js';
import type { KnowledgeBase } from '../model.js';

export const PERCENT = 100;

const MAX_FRACTION_DIGITS = 2;

const SECONDS_PER_MINUTE = TICKS_PER_MINUTE / TICKS_PER_SECOND;

/** A Manhattan radius along the lattice's diagonal: each diagonal step there spends one and a half points. */
export const DIAGONAL_STEP_COST = 1.5;

/** The experience percent the articles quote as the first useful level of a track. */
export const QUOTED_EXPERIENCE_PCT = 51;

export type FactValue = number | undefined;

export type FactReader = (base: KnowledgeBase) => FactValue;

/** A number an article may name, and how many decimals the language writes it with. */
export interface Fact {
  readonly read: FactReader;
  readonly minFraction: number;
  readonly maxFraction: number;
  /** A length of time in seconds, written as minutes and seconds once it reaches a minute. */
  readonly duration?: boolean;
}

export const formatted =
  (minFraction: number, maxFraction: number) =>
  (value: FactReader | number): Fact => ({
    read: typeof value === 'number' ? () => value : value,
    minFraction,
    maxFraction,
  });

export const whole = formatted(0, 0);

export const oneDecimal = formatted(0, 1);

export const twoDecimals = formatted(0, 2);

export const fixedOneDecimal = formatted(1, 1);

export const duration = (value: FactReader | number): Fact => ({ ...whole(value), duration: true });

export const seconds = (ticks: number): number => ticks / TICKS_PER_SECOND;

export const minutes = (ticks: number): number => ticks / TICKS_PER_MINUTE;

export const needPct = (units: number): number => (units * PERCENT) / systems.NEED_RESERVE_UNITS;

export const diagonal = (radius: number): number => radius / DIAGONAL_STEP_COST;

/** The whole minutes and the seconds left over of a duration, rounded to the second. */
const minutePart = (secondsTotal: number): number =>
  Math.floor(Math.round(secondsTotal) / SECONDS_PER_MINUTE);

const secondPart = (secondsTotal: number): number => Math.round(secondsTotal) % SECONDS_PER_MINUTE;

export const equipOf = (base: KnowledgeBase, good: string) => base.goodById.get(good)?.equip ?? undefined;

export const buildingOf = (base: KnowledgeBase, id: string) => base.buildingById.get(id);

export function goodTypeOf(base: KnowledgeBase, good: string): number | undefined {
  return base.content.goods.find((row) => row.id === good)?.typeId;
}

export function stockOf(base: KnowledgeBase, building: string, good: string): FactValue {
  const goodType = goodTypeOf(base, good);
  return buildingOf(base, building)?.stock.find((slot) => slot.goodType === goodType)?.capacity;
}

export const vehicleOf = (base: KnowledgeBase, id: string) => base.vehicles.find((row) => row.id === id);

export const trackOf = (base: KnowledgeBase, id: string) =>
  base.content.jobExperience.find((row) => row.id === id);

/** The clip `tribe` plays for `atomicId` in `jobType`. */
export function clipOf(base: KnowledgeBase, atomicId: number, jobType: number, tribe: number = VIKING) {
  const name = base.content.tribes
    .find((row) => row.typeId === tribe)
    ?.atomicBindings.find((row) => row.jobType === jobType && row.atomicId === atomicId)?.animation;
  return base.content.atomicAnimations.find((row) => row.name === name);
}

export const clipSeconds = (
  base: KnowledgeBase,
  atomicId: number,
  jobType: number,
  tribe?: number,
): FactValue => {
  const length = clipOf(base, atomicId, jobType, tribe)?.length;
  return length === undefined ? undefined : seconds(length);
};

/** What a clip's events move a need bar by, in percent. */
export function clipNeedPct(
  base: KnowledgeBase,
  atomicId: number,
  jobType: number,
  channel: number,
): FactValue {
  const name = clipOf(base, atomicId, jobType)?.name;
  return name === undefined
    ? undefined
    : needPct(systems.atomicEventChannelDelta(base.content, name, channel));
}

export const weaponRow = (base: KnowledgeBase, tribe: number, id: string) =>
  base.weapons.get(tribe)?.find((row) => row.id === id);

/** A course's length: the drill plays whole clips until its time is spent. */
export function drillSeconds(base: KnowledgeBase, ticks: number): FactValue {
  const clip = clipOf(base, systems.EXERCISE_ATOMIC_ID, JOB_CIVILIST)?.length;
  return clip === undefined ? undefined : seconds(Math.ceil(ticks / clip) * clip);
}

/** A school course of `lessons`, in seconds. */
export function lessonSeconds(base: KnowledgeBase, lessons: number): FactValue {
  return drillSeconds(base, lessons * systems.SCHOOL_LESSON_TICKS);
}

const trackPoints = (base: KnowledgeBase, id: string): FactValue => {
  const factor = trackOf(base, id)?.experienceFactor;
  return factor === undefined ? undefined : factor / systems.EXPERIENCE_XP_PER_POINT;
};

function pointsToPct(pct: number): number {
  let points = 0;
  while (systems.experiencePercent(points) < pct) points++;
  return points;
}

const repeatsTo = (base: KnowledgeBase, id: string, points: number): FactValue => {
  const worth = trackPoints(base, id);
  return worth === undefined ? undefined : Math.ceil(points / worth);
};

export const trackFacts = (name: string, id: string): Readonly<Record<string, Fact>> => ({
  [`exp.${name}.repeatsQuoted`]: whole((base) => repeatsTo(base, id, pointsToPct(QUOTED_EXPERIENCE_PCT))),
  [`exp.${name}.repeatsFull`]: whole((base) => repeatsTo(base, id, systems.EXPERIENCE_MASTERY_POINTS)),
});

/** Points a vehicle crosses per second, `lossPct` of its pace gone under load. */
export function vehiclePace(roughness: number, siege: boolean, lossPct: number): number {
  const period = systems.vehicleMovePeriod(roughness, siege);
  return TICKS_PER_SECOND / (period + systems.cartDragTicks(period, lossPct));
}

/** A number as the reader's language writes it. */
export function formatFactNumber(value: number, maxFraction = MAX_FRACTION_DIGITS, minFraction = 0): string {
  return formatNumber(value, maxFraction, minFraction, false);
}

/** Seconds as the reader's language writes a time: "X s" under a minute, with `digits` decimals, else
 *  "X min Y s" in whole seconds. */
export function durationText(secondsTotal: number, digits = 0): string {
  const copy = messages().knowledge.mechanics;
  const scale = 10 ** digits;
  const shown = Math.round(secondsTotal * scale) / scale;
  if (shown < SECONDS_PER_MINUTE) {
    return formatMessage(copy.seconds, { seconds: formatFactNumber(shown, digits) });
  }
  const rounded = Math.round(shown);
  const minutes = formatFactNumber(minutePart(rounded));
  const rest = secondPart(rounded);
  if (rest === 0) return formatMessage(copy.wholeMinutes, { minutes });
  return formatMessage(copy.minutes, { minutes, seconds: formatFactNumber(rest) });
}
