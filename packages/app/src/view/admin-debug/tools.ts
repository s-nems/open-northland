import type { Entity } from '@open-northland/sim';
import type {
  AdminAction,
  AdminArmed,
  AdminChoice,
  AdminKnob,
  AdminSpawnGroup,
  AdminTool,
} from '../../hud/dom/admin-panel/model.js';
import type { BuildingRecord, StandingStructure } from '../../hud/tool-panel/placement.js';
import { formatMessage, type Messages } from '../../i18n/index.js';
import { DEBUG_ACTIONS, type DebugAction } from './actions-catalog.js';
import type { AdminLabels } from './labels.js';
import {
  type AnimalEntry,
  type ArmorEntry,
  CREATURE_PRESETS,
  type CreaturePreset,
  type GoodEntry,
  PERSON_PRESETS,
  type PersonPreset,
  RESOURCE_ENTRIES,
  SOLDIER_WEAPONS,
  type VehicleEntry,
  weaponGoodSlug,
} from './spawn-catalog.js';

/** What the next map click will do. */
export type Armed =
  | { readonly kind: 'person'; readonly preset: PersonPreset }
  /** Its weapon and armor are the panel's, read as each spawn lands. */
  | { readonly kind: 'soldier' }
  | { readonly kind: 'creature'; readonly preset: CreaturePreset }
  | { readonly kind: 'vehicle'; readonly entry: VehicleEntry }
  | { readonly kind: 'animal'; readonly entry: AnimalEntry }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction }
  /** Two clicks: the settler to move (`target` null until picked), then its destination. */
  | { readonly kind: 'teleport'; readonly target: Entity | null };

/** A tool key's meaning: an arm for map clicks, or a finished structure the HUD's placement tools stand. */
export type AdminToolChoice = Armed | { readonly kind: 'standing'; readonly structure: StandingStructure };

const SOLDIER_KEY = 'soldier';
const TELEPORT_KEY = 'teleport';

const LEARNER_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints', 'skills'];
const PERSON_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints'];
const SOLDIER_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints', 'weapon', 'armor'];
/** Monsters fight with natural weapons, so they wear no armor. */
const CREATURE_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints'];
const OWNED_KNOBS: readonly AdminKnob[] = ['owner'];
/** Herds, deposits and ground piles belong to nobody. */
const UNOWNED_KNOBS: readonly AdminKnob[] = [];

/** The armor choice that spawns a soldier unarmored. */
export const NO_ARMOR = 0;

/** The key a tile carries for an arm; the teleport keeps one key through both of its clicks. */
export function armedKey(armed: Armed): string {
  switch (armed.kind) {
    case 'person':
    case 'creature':
      return `${armed.kind}:${armed.preset.id}`;
    case 'soldier':
      return SOLDIER_KEY;
    case 'vehicle':
      return `vehicle:${armed.entry.vehicleType}`;
    case 'animal':
      return `animal:${armed.entry.tribe}`;
    case 'resource':
    case 'good':
      return `${armed.kind}:${armed.good}`;
    case 'action':
      return `action:${armed.action.id}`;
    case 'teleport':
      return TELEPORT_KEY;
  }
}

function standingKey(structure: StandingStructure): string {
  return structure.kind === 'building'
    ? `standing:building:${structure.typeId}`
    : `standing:${structure.kind}`;
}

/** One building type the buildings group offers, with its localized name and every tribe's record of it,
 *  by ascending tribe. */
export interface BuildingEntry {
  readonly typeId: number;
  readonly label: string;
  readonly records: readonly BuildingRecord[];
}

export interface AdminToolSources {
  readonly goods: readonly GoodEntry[];
  readonly armors: readonly ArmorEntry[];
  readonly animals: readonly AnimalEntry[];
  readonly vehicles: readonly VehicleEntry[];
  /** The finished structures the HUD can stand; a group with none is left out. */
  readonly standing: {
    readonly wall: boolean;
    readonly road: boolean;
    readonly buildings: readonly BuildingEntry[];
  };
}

/** Every tool the panel offers, grouped as it shows them, and the footer's words for an arm. */
export interface AdminToolCatalogue {
  readonly groups: readonly AdminSpawnGroup[];
  readonly actions: readonly AdminAction[];
  /** A soldier's weapons, each `value` a {@link SOLDIER_WEAPONS} job. */
  readonly weapons: readonly AdminChoice[];
  /** {@link NO_ARMOR}, then each `value` an armor class. */
  readonly armors: readonly AdminChoice[];
  choiceOf(key: string): AdminToolChoice | undefined;
  /** `player` is the owner a spawn is dropped for. */
  describe(armed: Armed, player: number): AdminArmed;
}

export function createAdminToolCatalogue(
  messages: Messages,
  labels: AdminLabels,
  sources: AdminToolSources,
): AdminToolCatalogue {
  const copy = messages.admin;
  const choices = new Map<string, AdminToolChoice>();
  const toolLabels = new Map<string, string>();
  const register = (key: string, choice: AdminToolChoice, label: string): void => {
    choices.set(key, choice);
    toolLabels.set(key, label);
  };
  const tool = (choice: Armed, label: string, knobs: readonly AdminKnob[], goodId?: string): AdminTool => {
    const key = armedKey(choice);
    register(key, choice, label);
    return { key, label, knobs, ...(goodId === undefined ? {} : { goodId }) };
  };
  const standing = (structure: StandingStructure, label: string): AdminTool => {
    const key = standingKey(structure);
    register(key, { kind: 'standing', structure }, label);
    return { key, label, knobs: OWNED_KNOBS };
  };
  const group = (
    id: keyof Messages['admin']['groups'],
    tools: readonly AdminTool[],
    note?: string,
  ): AdminSpawnGroup => ({ id, title: copy.groups[id], tools, ...(note === undefined ? {} : { note }) });

  const goodBySlug = new Map(sources.goods.map((g) => [g.id, g]));
  const weapons: AdminChoice[] = SOLDIER_WEAPONS.map((weapon) => {
    const slug = weaponGoodSlug(weapon);
    const good = slug === undefined ? undefined : goodBySlug.get(slug);
    return good === undefined
      ? { value: weapon.jobType, label: copy.weaponNone }
      : { value: weapon.jobType, label: labels.good(good), goodId: good.id };
  });
  const armors: AdminChoice[] = [
    { value: NO_ARMOR, label: copy.armorNone },
    ...sources.armors.map((armor) => ({
      value: armor.armorClass,
      label: labels.good(armor),
      goodId: armor.id,
    })),
  ];

  const structures = [
    ...(sources.standing.wall ? [standing({ kind: 'wall' }, copy.standingPalisade)] : []),
    ...(sources.standing.road ? [standing({ kind: 'road' }, copy.standingRoad)] : []),
  ];
  const groups: AdminSpawnGroup[] = [
    group(
      'people',
      PERSON_PRESETS.map((preset) =>
        tool(
          { kind: 'person', preset },
          copy.people[preset.id],
          preset.learns === true ? LEARNER_KNOBS : PERSON_KNOBS,
        ),
      ),
      copy.notes.people,
    ),
    group('soldiers', [tool({ kind: 'soldier' }, copy.soldier, SOLDIER_KNOBS)], copy.notes.soldiers),
    group(
      'creatures',
      CREATURE_PRESETS.map((preset) =>
        tool({ kind: 'creature', preset }, labels.creature(preset), CREATURE_KNOBS),
      ),
      copy.notes.creatures,
    ),
    group(
      'animals',
      sources.animals.map((entry) => tool({ kind: 'animal', entry }, labels.animal(entry), UNOWNED_KNOBS)),
      copy.notes.animals,
    ),
    group(
      'vehicles',
      sources.vehicles.map((entry) => tool({ kind: 'vehicle', entry }, entry.label, OWNED_KNOBS)),
    ),
    group(
      'resources',
      RESOURCE_ENTRIES.map((entry) =>
        tool({ kind: 'resource', good: entry.good }, labels.good(entry), UNOWNED_KNOBS, entry.id),
      ),
    ),
    group(
      'goods',
      sources.goods.map((entry) =>
        tool({ kind: 'good', good: entry.good }, labels.good(entry), UNOWNED_KNOBS, entry.id),
      ),
      copy.notes.goods,
    ),
    group('structures', structures, copy.notes.structures),
    group(
      'buildings',
      sources.standing.buildings.map((entry) =>
        standing({ kind: 'building', typeId: entry.typeId, records: entry.records }, entry.label),
      ),
      copy.notes.buildings,
    ),
  ];

  const actions: AdminAction[] = [
    ...DEBUG_ACTIONS.map((action) => ({
      ...tool({ kind: 'action', action }, labels.action(action), UNOWNED_KNOBS),
      target: copy.actionHints[action.id],
      ...(action.id === 'health' ? { percent: true } : {}),
    })),
    {
      ...tool({ kind: 'teleport', target: null }, copy.actions.teleport, UNOWNED_KNOBS),
      target: copy.actionHints.teleport,
    },
  ];

  return {
    // A group with nothing to offer (no vehicles in this content) is left out.
    groups: groups.filter((entry) => entry.tools.length > 0),
    actions,
    weapons,
    armors,
    choiceOf: (key) => choices.get(key),
    describe(armed, player): AdminArmed {
      const key = armedKey(armed);
      const label = toolLabels.get(key) ?? key;
      switch (armed.kind) {
        case 'person':
        case 'soldier':
        case 'creature':
        case 'vehicle':
          return {
            key,
            name: formatMessage(copy.armedFor, { label, name: labels.player(player) }),
            hint: copy.hintSpawn,
          };
        case 'animal':
        case 'resource':
        case 'good':
          return { key, name: label, hint: copy.hintSpawn };
        case 'action':
          return { key, name: label, hint: copy.actionHints[armed.action.id] };
        case 'teleport':
          return {
            key,
            name: label,
            hint: armed.target === null ? copy.actionHints.teleport : copy.hintTeleportDestination,
          };
      }
    },
  };
}
