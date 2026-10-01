import type { ChildOrderWait } from '../../../game/snapshot.js';
import { bcp47Tag, formatMessage, type Messages, pluralForm } from '../../../i18n/index.js';
import {
  type ProductionStallReason,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from './types.js';

/** The catalog section that words every notice, short and full. */
export type NoticeCopy = Messages['userMessages'];

/** A catalog line, or a pair whose wording agrees with a settler subject's sex. */
type CopyLine = string | { readonly he: string; readonly she: string };

/** The types worded by the per-type tables; `familyBlocked` and `productionStalled` have their own
 *  table per reason. */
type TabledTypeName = Exclude<UserMessageTypeName, 'familyBlocked' | 'productionStalled'>;

const TYPE_NAME_BY_ID: ReadonlyMap<UserMessageType, UserMessageTypeName> = new Map(
  (Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]).map((name) => [USER_MESSAGE_TYPE[name], name]),
);

export function userMessageTypeName(type: UserMessageType): UserMessageTypeName {
  const name = TYPE_NAME_BY_ID.get(type);
  if (name === undefined) throw new Error(`user-messages: unknown message type ${type}`);
  return name;
}

export interface MessageTextParts {
  /** The subject's display name (a settler, building, vehicle or seat), or null when there is no subject
   *  left to name. */
  readonly subjectName: string | null;
  /** A settler subject's trade, shown in parentheses after the name; null when it has none to show. */
  readonly jobLabel: string | null;
  /** A settler subject's sex, which the Polish wording agrees with; absent for any other subject. */
  readonly female?: boolean;
  readonly goodName: string | null;
  /** The stance a note about another seat reports; null for every note that names none. */
  readonly stanceName: string | null;
  /** Localized lists carried by one experience-unlock notification; a vehicle's build site is listed
   *  among the vehicles, not the buildings. */
  readonly technologySections?: {
    readonly jobs: readonly string[];
    readonly goods: readonly string[];
    readonly houses: readonly string[];
    readonly vehicles: readonly string[];
  };
  /** The found paper's name. */
  readonly detail?: string;
  /** The course a `canDoNewJob` note reports, and the trade it taught. */
  readonly training?: { readonly course: 'barracks' | 'school'; readonly profession: string };
  /** Why a `productionStalled` note's workshop stands still; `goodName` names the good it is about. */
  readonly stall?: ProductionStallReason;
  /** What holds a `familyBlocked` note's child order, and the spouse it names. */
  readonly family?: { readonly wait: ChildOrderWait; readonly partner: NamedSettler | null };
  /** What an attack note's fight has hit, and the named seats and creatures that struck. */
  readonly fight?: {
    readonly buildings: number;
    readonly walls: number;
    readonly settlers: number;
    readonly vehicles: number;
    readonly enemies: readonly string[];
    readonly wild: boolean;
  };
}

/** A settler as a note names it: its name, the trade label shown after it (null for none) and its sex. */
export interface NamedSettler {
  readonly name: string;
  readonly jobLabel: string | null;
  readonly female: boolean;
}

/** A message as the card shows it and as it reads in full. */
export interface MessageText {
  /** The card's event line: a short label that fits the card. */
  readonly short: string;
  /** The whole message, for the unfolded card and assistive text. */
  readonly full: string;
}

function nameWithTrade(name: string, jobLabel: string | null): string {
  return jobLabel === null ? name : `${name} (${jobLabel})`;
}

function inflect(line: CopyLine, female: boolean): string {
  if (typeof line === 'string') return line;
  return female ? line.she : line.he;
}

/** The short and full lines a type reads: a nameless death and a barracks course have their own, and
 *  an unlock that opens buildings heads itself by them. */
function linesOf(
  name: TabledTypeName,
  parts: MessageTextParts,
  copy: NoticeCopy,
): readonly [CopyLine, CopyLine] {
  if (name === 'humanDied' && parts.subjectName === null) {
    return [copy.short.humanDiedUnknown, copy.full.humanDiedUnknown];
  }
  if (name === 'canDoNewJob' && parts.training?.course === 'barracks') {
    return [copy.short.becameSoldier, copy.full.becameSoldier];
  }
  const sections = name === 'experienceUnlocks' ? parts.technologySections : undefined;
  const houses = sections?.houses.length ?? 0;
  if (houses > 0) {
    return [houses === 1 ? copy.short.experienceBuilding : copy.short.experienceBuildings, copy.full[name]];
  }
  const vehicles = sections?.vehicles.length ?? 0;
  if (vehicles > 0) {
    return [vehicles === 1 ? copy.short.experienceVehicle : copy.short.experienceVehicles, copy.full[name]];
  }
  return [copy.short[name], copy.full[name]];
}

function experienceLists(
  sections: NonNullable<MessageTextParts['technologySections']>,
  copy: NoticeCopy,
): string {
  const lists = [
    [copy.experience.jobs, sections.jobs],
    [copy.experience.goods, sections.goods],
    [copy.experience.houses, sections.houses],
    [copy.experience.vehicles, sections.vehicles],
  ] as const;
  return lists
    .filter(([, values]) => values.length > 0)
    .map(([heading, values]) => `${heading}:\n${values.map((value) => `- ${value}`).join('\n')}`)
    .join('\n\n');
}

/** A fight's hit bodies ("2 buildings, 1 settler") and its strikers, as the attack lines read them. */
function fightValues(fight: NonNullable<MessageTextParts['fight']>, copy: NoticeCopy, localeTag: string) {
  const counts = [
    [fight.buildings, copy.attack.buildings],
    [fight.walls, copy.attack.walls],
    [fight.settlers, copy.attack.settlers],
    [fight.vehicles, copy.attack.vehicles],
  ] as const;
  const hits = counts
    .filter(([count]) => count > 0)
    .map(([count, forms]) => formatMessage(pluralForm(count, forms, localeTag), { count }))
    .join(', ');
  const enemy = [...fight.enemies, ...(fight.wild ? [copy.attack.wild] : [])].join(', ');
  return { hits, enemy };
}

/** A fight note's row in its stack: who struck and what they hit ("Wikingowie · 2 budynki"). */
export function fightSummary(
  fight: NonNullable<MessageTextParts['fight']>,
  copy: NoticeCopy,
  localeTag: string = bcp47Tag(),
): string {
  const { enemy, hits } = fightValues(fight, copy, localeTag);
  return [enemy, hits].filter((part) => part !== '').join(' · ');
}

/** `localeTag` is the language of `copy`, whose plural rules count a fight's hits. */
export function composeMessageText(
  type: UserMessageType,
  parts: MessageTextParts,
  copy: NoticeCopy,
  localeTag: string = bcp47Tag(),
): MessageText {
  const name = userMessageTypeName(type);
  const female = parts.female === true;
  const subject = parts.subjectName === null ? '' : nameWithTrade(parts.subjectName, parts.jobLabel);
  const values = {
    name: subject,
    building: subject,
    vehicle: subject,
    player: subject,
    good: parts.goodName ?? '',
    stance: parts.stanceName ?? '',
    item: parts.detail ?? '',
    profession: parts.training?.profession ?? '',
    ...(parts.fight === undefined ? {} : fightValues(parts.fight, copy, localeTag)),
  };
  if (name === 'familyBlocked') {
    if (parts.family === undefined) throw new Error('user-messages: a familyBlocked note needs its wait');
    const { wait, partner } = parts.family;
    const husband = partner === null ? '' : ` ${nameWithTrade(partner.name, partner.jobLabel)}`;
    return {
      short: copy.familyBlocked.short[wait],
      full: formatMessage(copy.familyBlocked.full[wait], { name: subject, partner: husband }),
    };
  }
  if (name === 'productionStalled') {
    if (parts.stall === undefined)
      throw new Error('user-messages: a productionStalled note needs its reason');
    return {
      short: formatMessage(copy.productionStalled.short[parts.stall], values),
      full: formatMessage(copy.productionStalled.full[parts.stall], values),
    };
  }
  const [shortLine, fullLine] = linesOf(name, parts, copy);
  const short = formatMessage(inflect(shortLine, female), values);
  const full = formatMessage(inflect(fullLine, female), values);
  if (name === 'experienceUnlocks' && parts.technologySections !== undefined) {
    const lists = experienceLists(parts.technologySections, copy);
    return { short, full: lists === '' ? full : `${full}\n\n${lists}` };
  }
  return { short, full };
}
