import type { EquipClass } from '@open-northland/data';
import { bcp47Tag, formatMessage, messages, type PluralForms, pluralForm } from '../../i18n/index.js';
import type { KnowledgeStatus } from '../dom/knowledge/context.js';
import { SECONDS_PER_TICK } from './base.js';
import { clipSeconds, isRanged, perSecond } from './combat.js';
import type { KnowledgeMeal, KnowledgeRequirement, KnowledgeWeapon } from './model.js';

const PERCENT = 100;
const WHOLE_DIGITS = 0;
const NUMBER_DIGITS = 1;
const PRECISE_DIGITS = 2;
/** Missing names a status line spells out before it counts the rest. */
const STATUS_NAME_LIMIT = 3;

const copy = () => messages().knowledge.entry;

function formatted(value: number, least: number, most: number): string {
  return new Intl.NumberFormat(bcp47Tag(), {
    minimumFractionDigits: least,
    maximumFractionDigits: most,
  }).format(value);
}

export const numberText = (value: number): string => formatted(value, WHOLE_DIGITS, NUMBER_DIGITS);
export const preciseText = (value: number): string => formatted(value, PRECISE_DIGITS, PRECISE_DIGITS);
export const wholeText = (value: number): string => formatted(Math.round(value), WHOLE_DIGITS, WHOLE_DIGITS);

/** A recipe or stock amount, written after its icon. */
export const amountText = (amount: number): string => `x${amount}`;

export const secondsText = (seconds: number): string =>
  formatMessage(copy().unit.seconds, { value: numberText(seconds) });
export const preciseSecondsText = (seconds: number): string =>
  formatMessage(copy().unit.seconds, { value: preciseText(seconds) });
export const ticksText = (ticks: number): string => secondsText(ticks * SECONDS_PER_TICK);

/** A percent multiplier as a factor: 125 reads ×1,25 in Polish. */
export const factorText = (percent: number): string => `×${numberTextOfFactor(percent / PERCENT)}`;
const numberTextOfFactor = (factor: number): string => formatted(factor, WHOLE_DIGITS, PRECISE_DIGITS);

export function counted(count: number, forms: PluralForms): string {
  return formatMessage(pluralForm(count, forms, bcp47Tag()), { count });
}

export function weaponClassText(weapon: Pick<KnowledgeWeapon, 'mainType'>, unarmedType: number): string {
  const names = copy().weaponClass;
  if (weapon.mainType === unarmedType) return names.unarmed;
  return isRanged(weapon) ? names.ranged : names.melee;
}

/** `value` in hexes, one hex being one node of the map's lattice; `count` picks the plural, the last number read. */
export function stepsText(count: number, value: string = String(count)): string {
  return formatMessage(pluralForm(count, copy().unit.steps, bcp47Tag()), { value });
}

export function rangeText({ minRange, maxRange }: Pick<KnowledgeWeapon, 'minRange' | 'maxRange'>): string {
  return stepsText(maxRange, minRange === maxRange ? String(maxRange) : `${minRange}-${maxRange}`);
}

/** How often a weapon strikes: its clip's length, with the blows named when one clip lands several. */
export function cadenceText(weapon: KnowledgeWeapon): string {
  const seconds = clipSeconds(weapon);
  if (seconds === null) return '-';
  const time = secondsText(seconds);
  if (weapon.blows === 1) return time;
  const { many, blows } = copy().cadence;
  return formatMessage(many, {
    blows: weapon.blows,
    word: pluralForm(weapon.blows, blows, bcp47Tag()),
    time,
  });
}

export function perSecondText(damage: number, weapon: KnowledgeWeapon): string {
  const value = perSecond(damage, weapon);
  return value === null ? '-' : wholeText(value);
}

export type SpeedVerdict = 'slower' | 'same' | 'faster';

/** A step period against a person's: a longer step is a slower walker. */
export function speedVerdict(stepTicks: number, humanTicks: number): SpeedVerdict {
  if (stepTicks === humanTicks) return 'same';
  return stepTicks > humanTicks ? 'slower' : 'faster';
}

export const speedText = (stepTicks: number, humanTicks: number): string =>
  copy().speed[speedVerdict(stepTicks, humanTicks)];

/** The share a step grows by, in whole percent. */
export const slowdownPercent = (step: number, plainStep: number): number =>
  Math.round((step / plainStep - 1) * PERCENT);

/** The line a chip shows for a status that is not plainly available; null when there is nothing to say. */
export function statusText(status: KnowledgeStatus): string | null {
  const text = copy().status;
  if (status.kind === 'available') return null;
  if (status.kind === 'mapForbidden') return text.mapForbidden;
  const names = status.missing.slice(0, STATUS_NAME_LIMIT).join(', ');
  const more = status.missing.length - STATUS_NAME_LIMIT;
  return more > 0 ? formatMessage(text.missingMore, { names, more }) : formatMessage(text.missing, { names });
}

/** One way a requirement is met by practice, naming the trade that earns it. */
export function practiceText(
  requirement: KnowledgeRequirement,
  jobName: (jobType: number) => string | null,
): string {
  const text = copy().job;
  const experience = requirement.experience.join(' + ');
  const jobs = requirement.fromJobs.flatMap((id) => jobName(id) ?? []);
  return jobs.length === 0
    ? formatMessage(text.practice, { amount: requirement.amount, experience })
    : formatMessage(text.practiceAs, { amount: requirement.amount, experience, job: jobs.join(', ') });
}

/** What a good does for its bearer, one clause each; `stepSeconds` is what the ticks a good saves come to. */
export function equipEffects(equip: EquipClass, stepSeconds: (ticks: number) => number): readonly string[] {
  const text = copy().equip;
  const pct = (template: string, value: number | undefined): readonly string[] =>
    value === undefined ? [] : [formatMessage(template, { pct: value })];
  const factor = (template: string, value: number | undefined): readonly string[] =>
    value === undefined ? [] : [formatMessage(template, { factor: factorText(value).slice(1) })];
  const { restorePct, productionBonusPct, criticalHit, walkStepTicksSaved } = equip;
  return [
    ...factor(text.work, equip.workFactorPct),
    ...(productionBonusPct === undefined
      ? []
      : [formatMessage(text.production, { amount: numberTextOfFactor(productionBonusPct / PERCENT) })]),
    ...pct(text.energy, restorePct?.hunger),
    ...pct(text.stamina, restorePct?.fatigue),
    ...pct(text.health, restorePct?.healthMax),
    ...factor(text.dealt, equip.damageDealtPct),
    ...factor(text.taken, equip.damageTakenPct),
    ...(criticalHit === undefined
      ? []
      : [
          formatMessage(text.critical, {
            chance: criticalHit.chancePct,
            factor: factorText(criticalHit.damagePct).slice(1),
          }),
        ]),
    ...(walkStepTicksSaved === undefined
      ? []
      : [formatMessage(text.step, { time: preciseSecondsText(stepSeconds(walkStepTicksSaved)) })]),
  ];
}

/** How long a worn or drunk good lasts. */
/** How long a piece lasts; null for one that never wears out. */
export function equipDurability(equip: EquipClass): string | null {
  const text = copy().equip;
  if (!equip.wears || equip.uses === undefined) return null;
  if (equip.category === 'boots') return formatMessage(text.usesBoots, { count: wholeText(equip.uses) });
  if (equip.category === 'tool') return formatMessage(text.usesTool, { count: equip.uses });
  return counted(equip.uses, text.usesSip);
}

/** A meal away from home and at home. */
export function mealText(meal: KnowledgeMeal): { readonly outside: string; readonly home: string } {
  const text = copy().equip;
  const line = (hungerPct: number): string =>
    [
      formatMessage(text.energy, { pct: wholeText(hungerPct) }),
      ...(meal.leisurePct > 0 ? [formatMessage(text.company, { pct: wholeText(meal.leisurePct) })] : []),
    ].join(', ');
  return { outside: line(meal.hungerPct), home: line(meal.homeHungerPct) };
}
