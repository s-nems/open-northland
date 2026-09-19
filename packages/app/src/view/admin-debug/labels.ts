import { formatMessage, type Messages, professionLabel } from '../../i18n/index.js';
import type { DebugAction, DebugTargetKind } from './actions-catalog.js';
import {
  type AnimalEntry,
  type GoodEntry,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  type UnitPreset,
  type VehicleEntry,
} from './spawn-catalog.js';

/** What the next map click will do. */
export type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'vehicle'; readonly entry: VehicleEntry }
  | { readonly kind: 'animal'; readonly entry: AnimalEntry }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction };

export function sameArmed(a: Armed, b: Armed | null): boolean {
  if (b === null) return false;
  if (a.kind === 'unit' && b.kind === 'unit') return a.preset.id === b.preset.id;
  if (a.kind === 'vehicle' && b.kind === 'vehicle') return a.entry.vehicleType === b.entry.vehicleType;
  if (a.kind === 'animal' && b.kind === 'animal') return a.entry.tribe === b.entry.tribe;
  if (a.kind === 'resource' && b.kind === 'resource') return a.good === b.good;
  if (a.kind === 'good' && b.kind === 'good') return a.good === b.good;
  if (a.kind === 'action' && b.kind === 'action') return a.action.id === b.action.id;
  return false;
}

export interface AdminLabels {
  /** The live localized name, else the catalog id. */
  readonly good: (entry: { readonly good: number; readonly id: string }) => string;
  readonly unit: (preset: UnitPreset) => string;
  /** The content tribe slug, not translated player copy. */
  readonly animal: (entry: AnimalEntry) => string;
  readonly action: (action: DebugAction) => string;
  readonly player: (player: number) => string;
  /** The status-footer line for the current arm. */
  readonly status: (armed: Armed | null, player: number) => string;
}

export function createAdminLabels(
  messages: Messages,
  goodLabel: ((typeId: number) => string | undefined) | undefined,
  goods: readonly GoodEntry[],
): AdminLabels {
  const copy = messages.admin;
  const goodNames = messages.goods;
  const targetNoun: Record<DebugTargetKind, string> = {
    settler: copy.targetSettler,
    building: copy.targetBuilding,
  };

  const goodLabelOf = (good: number, fallback: string): string => goodLabel?.(good) ?? fallback;
  const localizedGood = (entry: { readonly good: number; readonly id: string }): string =>
    goodLabelOf(entry.good, goodNames[entry.id as keyof Messages['goods']] ?? entry.id);
  const unitLabel = (preset: UnitPreset): string => {
    const direct = copy.units[preset.id as keyof Messages['admin']['units']];
    if (direct !== undefined) return direct;
    if (preset.id === 'collector') return professionLabel('collector');
    return preset.id;
  };
  const actionLabel = (action: DebugAction): string => copy.actionsCatalog[action.id];
  const animalLabel = (entry: AnimalEntry): string => entry.id.replace(/_/g, ' ');
  const playerName = (player: number): string => messages.animation.playerColors[player] ?? String(player);

  const status = (armed: Armed | null, player: number): string => {
    if (armed === null) return copy.nothingArmed;
    if (armed.kind === 'animal') {
      return formatMessage(copy.armedAnimal, { label: animalLabel(armed.entry) });
    }
    if (armed.kind === 'resource') {
      const good = armed.good;
      const entry = RESOURCE_ENTRIES.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.resourceFallback : localizedGood(entry);
      return formatMessage(copy.armedResource, { label });
    }
    if (armed.kind === 'good') {
      const good = armed.good;
      const entry = goods.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.goodFallback : localizedGood(entry);
      return formatMessage(copy.armedGood, { label });
    }
    if (armed.kind === 'action') {
      return formatMessage(copy.armedAction, {
        label: actionLabel(armed.action),
        target: targetNoun[armed.action.targetKind],
      });
    }
    // A vehicle is owned like a unit, so its line names the seat it is dropped for too.
    const who = PLAYER_SWATCHES.find((s) => s.player === player);
    return formatMessage(copy.armedUnit, {
      label: armed.kind === 'vehicle' ? armed.entry.label : unitLabel(armed.preset),
      player,
      name: who === undefined ? '?' : playerName(who.player),
    });
  };

  return {
    good: localizedGood,
    unit: unitLabel,
    animal: animalLabel,
    action: actionLabel,
    player: playerName,
    status,
  };
}
