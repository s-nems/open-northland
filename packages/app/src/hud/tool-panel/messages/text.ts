import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage } from '../../../i18n/index.js';
import { USER_MESSAGE_TYPE, type UserMessageType, type UserMessageTypeName } from './types.js';

/** The ingamegui string table the message texts read. */
export const MESSAGE_STRINGS_TABLE = 'messages';

/**
 * The `messages` row each type reads. The pairing follows the original's message wording; the
 * rows themselves are the owned copy's decoded `ingameguimessages.cif`.
 */
export const MESSAGE_STRING_ID: Readonly<Record<UserMessageTypeName, number>> = {
  taskCompleted: 15,
  taskFailed: 16,
  lostWithoutSignposts: 18,
  goodNotFound: 19,
  buildMaterialNotFound: 20,
  homeNotFound: 21,
  targetPersonNotFound: 22,
  workplaceNotFound: 23,
  vehicleSiteNotFound: 24,
  vehicleSiteOccupied: 25,
  nothingToDo: 17,
  waitingForGood: 26,
  stockFull: 27,
  noCoinsForTraining: 29,
  noVehicleForWork: 30,
  noTradeAgreement: 31,
  cannotDamageTarget: 32,
  experienceUnlocks: 33,
  canProduceNewGood: 38,
  canDoNewJob: 39,
  canBuildNewHouse: 40,
  canBuildNewVehicle: 41,
  canEquipNewItem: 42,
  producedOneGood: 43,
  producedAllGoods: 44,
  couldNotProduceOneGood: 45,
  couldNotProduceAnyGoods: 46,
  hungry: 10,
  tired: 12,
  bored: 13,
  wantsToPray: 14,
  starving: 11,
  willDie: 47,
  gaveBirthToSon: 48,
  gaveBirthToDaughter: 49,
  wasBorn: 50,
  grewUp: 51,
  cannotMarry: 52,
  noOneToMarry: 53,
  noWayToMarry: 54,
  cannotAttachHouse: 55,
  cannotDetachHouse: 56,
  cannotEnterVehicle: 57,
  equipmentNotFound: 58,
  backpackFull: 58,
  humanAttacked: 61,
  houseFinished: 90,
  houseUpgraded: 91,
  houseAttacked: 92,
  vehicleNoPath: 100,
  vehicleNoCommander: 101,
  vehicleAttacked: 102,
  vehicleNoAnimal: 103,
  vehicleNoPassengerRoom: 104,
  cannotAttachVehicle: 105,
  vehicleCannotNearShip: 106,
  cannotLeaveVehicle: 107,
  vehicleNoCarrier: 108,
  humanDied: 120,
  playerSighted: 131,
  diplomacyChanged: 132,
  playerDied: 133,
  specialItemFound: 134,
};

/** Rows a composite text appends or substitutes. */
const STOCK_FULL_NO_GOOD_STRING_ID = 28;
const EQUIPMENT_NOT_FOUND_DETAIL_STRING_ID = 59;
const BACKPACK_FULL_DETAIL_STRING_ID = 60;
const UNKNOWN_HERO_DIED_STRING_ID = 121;
const EXPERIENCE_JOB_STRING_ID = 34;
const EXPERIENCE_GOOD_STRING_ID = 35;
const EXPERIENCE_HOUSE_STRING_ID = 36;
/** The placeholder the stock-full row carries for the good's name. */
const GOOD_PLACEHOLDER = '%s';
const TYPE_NAME_BY_ID: ReadonlyMap<UserMessageType, UserMessageTypeName> = new Map(
  (Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]).map((name) => [USER_MESSAGE_TYPE[name], name]),
);

export function userMessageTypeName(type: UserMessageType): UserMessageTypeName {
  const name = TYPE_NAME_BY_ID.get(type);
  if (name === undefined) throw new Error(`user-messages: unknown message type ${type}`);
  return name;
}

/** The rows whose text ends in the good it is about. */
export const GOOD_APPENDED: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>([
  'goodNotFound',
  'waitingForGood',
  'canProduceNewGood',
  'canEquipNewItem',
  'producedOneGood',
  'couldNotProduceOneGood',
]);

/** The rows that end on a colon or a lead-in for the diplomatic stance they are about. */
const STANCE_APPENDED: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>([
  'playerSighted',
  'diplomacyChanged',
]);

/** The rows that name a building rather than a settler, so no trade label follows the name. */
const HOUSE_ROWS: ReadonlySet<UserMessageTypeName> = new Set<UserMessageTypeName>([
  'houseFinished',
  'houseUpgraded',
  'houseAttacked',
]);

export interface MessageTextParts {
  /** The subject's display name, or null when there is no subject left to name. */
  readonly subjectName: string | null;
  /** A settler subject's trade, shown in parentheses after the name; null when it has none to show. */
  readonly jobLabel: string | null;
  readonly goodName: string | null;
  /** The stance the row about another seat reports; null for every row that names none. */
  readonly stanceName: string | null;
  /** Localized lists carried by one experience-unlock notification. */
  readonly technologySections?: {
    readonly jobs: readonly string[];
    readonly goods: readonly string[];
    readonly houses: readonly string[];
  };
  /** The found paper's name, appended after a dash as the original formats its found-object note. */
  readonly detail?: string;
}

/** The card lines, from the app catalog: one per type, and `{good}` / `{stance}` templates for the rows
 *  whose card names what they are about. */
export interface ShortLabels {
  readonly byType: Readonly<Record<UserMessageTypeName, string>>;
  readonly withGood: Readonly<Partial<Record<UserMessageTypeName, string>>>;
  readonly withStance: Readonly<Partial<Record<UserMessageTypeName, string>>>;
  /** The death of a hero the seat cannot name. */
  readonly unknownHeroDied: string;
}

export interface MessageTextDeps {
  readonly uiString: UiString;
  /** The app catalog's stand-in for a `messages` row when the decoded strings are absent. */
  readonly fallbackRow: (id: number) => string;
  readonly short: ShortLabels;
}

/** A message as the card shows it and as it reads in full. */
export interface MessageText {
  /** The card's event line: a short label that fits the card, never the original's sentence. */
  readonly short: string;
  /** The whole message in the original's wording, for the unfolded card and assistive text. */
  readonly full: string;
}

export function composeMessageText(
  type: UserMessageType,
  parts: MessageTextParts,
  deps: MessageTextDeps,
): MessageText {
  const name = userMessageTypeName(type);
  const row = (id: number): string => deps.uiString(MESSAGE_STRINGS_TABLE, id, deps.fallbackRow(id));
  const base = row(MESSAGE_STRING_ID[name]);
  const who =
    parts.subjectName === null
      ? null
      : parts.jobLabel === null
        ? parts.subjectName
        : `${parts.subjectName} (${parts.jobLabel})`;
  const lead = (text: string): string => (who === null ? text : `${who} ${text}`);
  const short = shortLabel(name, parts, deps.short);
  const led = (body: string): MessageText => ({ short, full: lead(body) });

  if (name === 'humanDied') {
    if (who !== null) return led(base);
    const unknown = row(UNKNOWN_HERO_DIED_STRING_ID);
    return { short: deps.short.unknownHeroDied, full: unknown };
  }
  if (name === 'specialItemFound') {
    if (parts.detail === undefined) return { short, full: base };
    return { short, full: `${base} - ${parts.detail}` };
  }
  if (HOUSE_ROWS.has(name)) {
    return { short, full: parts.subjectName === null ? base : `${parts.subjectName} ${base}` };
  }
  if (name === 'stockFull') {
    return led(
      parts.goodName === null
        ? row(STOCK_FULL_NO_GOOD_STRING_ID)
        : base.replace(GOOD_PLACEHOLDER, parts.goodName),
    );
  }
  if (name === 'equipmentNotFound') return led(`${base} ${row(EQUIPMENT_NOT_FOUND_DETAIL_STRING_ID)}`);
  if (name === 'backpackFull') return led(`${base} ${row(BACKPACK_FULL_DETAIL_STRING_ID)}`);
  if (name === 'experienceUnlocks' && parts.technologySections !== undefined) {
    const sections = [
      [EXPERIENCE_JOB_STRING_ID, parts.technologySections.jobs],
      [EXPERIENCE_GOOD_STRING_ID, parts.technologySections.goods],
      [EXPERIENCE_HOUSE_STRING_ID, parts.technologySections.houses],
    ] as const;
    const details = sections
      .filter(([, values]) => values.length > 0)
      .map(([label, values]) => `${row(label)}:\n${values.map((value) => `- ${value}`).join('\n')}`)
      .join('\n\n');
    return { short, full: `${lead(base)}:\n${details}` };
  }
  if (GOOD_APPENDED.has(name) && parts.goodName !== null) return led(`${base} ${parts.goodName}`);
  if (STANCE_APPENDED.has(name) && parts.stanceName !== null) return led(`${base} ${parts.stanceName}`);
  return led(base);
}

/** The card's line: the type's label, or its template with the good or stance the row is about. */
function shortLabel(name: UserMessageTypeName, parts: MessageTextParts, labels: ShortLabels): string {
  const withGood = labels.withGood[name];
  if (withGood !== undefined && parts.goodName !== null)
    return formatMessage(withGood, { good: parts.goodName });
  const withStance = labels.withStance[name];
  if (withStance !== undefined && parts.stanceName !== null) {
    return formatMessage(withStance, { stance: parts.stanceName });
  }
  return labels.byType[name];
}
